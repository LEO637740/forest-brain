import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { thresholdsFor, WEATHER_THRESHOLDS, assessWeatherWindow } from '../src/weather-policy.js';
import { checkChanges, PARAMETER_SPECS } from '../src/cerebellum.js';
import { calculateParkPlan, unpreparedTreeCount } from '../src/park-plan.js';
import { makeParkContext, TREE_IDS } from '../src/adapters/park-demo.js';
import { openServiceSession } from '../../frontend/scripts/service-session.mjs';
import { checkCandidate } from '../src/validation.js';
import {planModel,modelProposal} from './helpers/park-plan-model.js';

const NOW = new Date('2026-10-21T00:00:00Z');
async function fixture(t, options = {}) {
  const modelRequests=[],planner=planModel();
  const assistantModel={...planner,async complete(input){modelRequests.push(structuredClone(input));return planner.complete(input);}};
  const app = createApp({dbPath:':memory:', generator:new RuleGenerator(), assistantModel, seedTasks:true, clock:() => NOW, ...options});
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, {input, token, status = 200} = {}) => {
    const headers = {...(input === undefined ? {} : {'Content-Type':'application/json'}), ...(token ? {'X-Rubber-Session':token} : {})};
    const response = await fetch(base + path, input === undefined ? {headers} : {method:'POST', headers, body:JSON.stringify(input)});
    const data = await response.json();
    assert.equal(response.status, status, `${path} ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  };
  const login = async accountId => (await call('/api/auth/login', {input:{accountId}, status:201})).token;
  const turn = async (sessionId, input, token) => {
    const accepted = await call(`/api/assistant/sessions/${sessionId}/turns`, {input, token, status:202});
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await call(`/api/assistant/sessions/${sessionId}/turns/${accepted.turnId}`, {token});
      if (['completed','failed'].includes(result.status)) return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('assistant turn did not finish');
  };
  return {app, call, login, turn,modelRequests};
}

test('roles: demo accounts describe the meeting roles and a grower owns one mu of 33 trees', async t => {
  const {call} = await fixture(t);
  const {items, authentication} = await call('/api/auth/accounts');
  assert.equal(authentication, 'demo_identity_without_password');
  assert.deepEqual([...new Set(items.map(item => item.role))].sort(), ['executive','grower','manager','operator']);
  const grower = items.find(item => item.accountId === 'grower-hn-wang');
  assert.equal(grower.plot.treeCount, 33);
  assert.ok(!('treeIds' in grower.plot) || grower.plot.treeIds.length === 33);
  assert.ok(grower.permissions.includes('plot.read') && !grower.permissions.includes('site.read'));
});

test('roles: the server enforces park, plot and write scope for signed-in requests', async t => {
  const {call, login} = await fixture(t);
  const grower = await login('grower-hn-wang'), operator = await login('operator-hn'), managerXs = await login('manager-xs'), center = await login('center-hz');
  // Grower: own trees only, no park business data, no writes.
  await call('/api/demo/trees/T-0051/view?siteId=demo-hainan&kind=tapping_angle&dataMode=demo', {token:grower});
  const denied = await call('/api/demo/trees/T-0001/view?siteId=demo-hainan&kind=tapping_angle&dataMode=demo', {token:grower, status:403});
  assert.equal(denied.error.code, 'FORBIDDEN_TREE');
  await call('/api/simulation/sales-inventory?siteId=demo-hainan', {token:grower, status:403});
  await call('/api/demo/park?siteId=demo-xsbn', {token:grower, status:403});
  const park = await call('/api/demo/park?siteId=demo-hainan', {token:grower});
  assert.equal(park.trees.length, 33);
  assert.ok(park.trees.every(tree => Number(tree.treeId.slice(2)) >= 51 && Number(tree.treeId.slice(2)) <= 83));
  const tasks = await call('/api/simulation/tasks', {token:grower});
  assert.ok(tasks.items.every(task => task.site === 'hainan' && task.treeIndices.some(index => index >= 50 && index <= 82)));
  await call('/api/simulation/operational-events', {token:grower, input:{requestId:'g-1', siteId:'demo-hainan', kind:'rain', zone:null, note:'雨'}, status:403});
  // Operator: can register a rain event in its park, but not in another park and cannot touch sales.
  await call('/api/simulation/operational-events', {token:operator, input:{requestId:'o-1', siteId:'demo-hainan', kind:'rain', zone:1, note:'B区降雨'}});
  await call('/api/simulation/operational-events', {token:operator, input:{requestId:'o-2', siteId:'demo-xsbn', kind:'rain', zone:1, note:'雨'}, status:403});
  await call('/api/simulation/market-sales-plan', {token:operator, input:{modelId:'x', scenarioId:'sell_now', siteId:'demo-hainan'}, status:403});
  // A manager of another park cannot read Hainan; the center reads every park but does not write tasks.
  await call('/api/simulation/sales-inventory?siteId=demo-hainan', {token:managerXs, status:403});
  await call('/api/simulation/sales-inventory?siteId=demo-hainan', {token:center});
  const all = await call('/api/simulation/tasks', {token:managerXs});
  assert.ok(all.items.length > 0 && all.items.every(task => task.site === 'xsbn'));
  await call('/api/simulation/task-receipts', {token:center, input:{tasks:[]}, status:403});
  // A forged or expired session is rejected rather than treated as anonymous.
  await call('/api/simulation/tasks', {token:'rs-forged', status:401});
});

test('roles: requireIdentity closes business APIs until a login, while health and accounts stay open', async t => {
  const {call, login} = await fixture(t, {requireIdentity:true});
  await call('/health');
  await call('/api/auth/accounts');
  assert.equal((await call('/api/simulation/tasks', {status:401})).error.code, 'LOGIN_REQUIRED');
  const token = await login('manager-hn');
  await call('/api/simulation/tasks', {token});
});

test('roles: under requireIdentity the background service account can run every preparation call, then signs out', async t => {
  const {app} = await fixture(t, {requireIdentity:true});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = await openServiceSession(base);
  assert.equal(session.required, true);
  assert.equal(session.accountId, 'operator-hn');
  const call = async (path, body, status = null) => {
    const response = await fetch(base + path, {method:body ? 'POST' : 'GET', headers:{'Content-Type':'application/json', ...session.headers}, body:body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    if (status) assert.equal(response.status, status, path); else assert.ok(response.ok, `${path} ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  };
  // The same calls, in the same shapes, as frontend/scripts/prepare-harness.mjs and prepare-industry.mjs.
  const manifest = await call('/api/demo/trees/manifest?scope=park');
  assert.equal(manifest.items.length, 200);
  const prepared = await call('/api/demo/trees/prepare', {preparationId:'service-test', treeIds:['T-0001','T-0002'], kind:'surface_action', dataMode:'mixed_demo', generatorMode:'demo_rules', preserveConfigured:true});
  await call('/internal/harness/runs/' + prepared.items[0].runId);
  await call('/api/demo/scenarios/run', {scenarioId:'all', dataMode:'mixed_demo'});
  const context = await call('/api/demo/contexts', {treeIds:TREE_IDS, variant:'normal'});
  await call('/internal/harness/runs', {requestId:'service-test-market', kind:'market_scenario', siteId:context.siteId, targetSnapshotId:context.targetSnapshotId,
    inputSnapshot:context.inputSnapshot, executionMode:'simulation', generatorMode:'demo_rules', trigger:{type:'user', eventId:'service-test'}});
  await call('/internal/harness/runs?kind=industry_brief&dataMode=mixed_demo&generatorMode=configured&limit=1');
  // The industry brief belongs to no park; the permission still applies, park membership does not.
  const industry = await call('/api/sources/industry-context', {dataMode:'demo'});
  assert.equal(industry.siteId, 'public-rubber-industry');
  const industryRun = {requestId:'service-test-industry', kind:'industry_brief', siteId:industry.siteId, targetSnapshotId:industry.targetSnapshotId,
    inputSnapshot:industry.inputSnapshot, executionMode:'simulation', generatorMode:'demo_rules', trigger:{type:'user', eventId:'service-test-industry'}};
  await call('/internal/harness/runs', industryRun);
  for (const accountId of ['grower-hn-wang', 'center-hz']) {
    const other = await (await fetch(base + '/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({accountId})})).json();
    const refused = await fetch(base + '/internal/harness/runs', {method:'POST', headers:{'Content-Type':'application/json', 'X-Rubber-Session':other.token},
      body:JSON.stringify({...industryRun, requestId:`refused-${accountId}`})});
    assert.equal(refused.status, 403, `${accountId} has no strategy permission`);
  }
  // Passes the login and park checks; this test server simply has no public collector.
  assert.equal((await call('/api/sources', undefined, 503)).error.code, 'PUBLIC_SOURCES_DISABLED');
  // Least privilege: the service account cannot sell or reach another park.
  await call('/api/simulation/market-sales-plan', {siteId:'demo-hainan', modelId:'x', scenarioId:'x'}, 403);
  await call('/api/simulation/sales-inventory?siteId=demo-xsbn', undefined, 403);
  await session.close();
  const after = await fetch(base + '/api/demo/trees/manifest?scope=park', {headers:session.headers});
  assert.equal(after.status, 401, 'the closed session no longer works');
});

test('brief: each role gets decisions instead of dashboards; the grower sees plot income and care', async t => {
  const {call, login} = await fixture(t);
  const manager = await call('/api/workspace/brief?siteId=demo-hainan', {token:await login('manager-hn')});
  assert.ok(manager.items.some(item => item.id === 'park-plan' && item.action.type === 'park_plan'));
  assert.ok(manager.items.every(item => item.conclusion && item.reason && item.action));
  const grower = await call('/api/workspace/brief', {token:await login('grower-hn-wang')});
  assert.equal(grower.siteId, 'demo-hainan');
  assert.equal(grower.plot.treeCount, 33);
  assert.ok(grower.items.some(item => item.id === 'plot-income' && /元|报价/.test(item.conclusion)));
  assert.ok(!grower.items.some(item => item.id === 'park-plan' || item.id === 'inventory'));
  await call('/api/workspace/brief?siteId=demo-xsbn', {token:await login('grower-hn-wang'), status:403});
});

test('brief: lapsed tree strategies ask for a recompute instead of saving a false pause', async t => {
  let now = NOW;
  const {call, login, turn,modelRequests} = await fixture(t, {clock:() => now});
  let token = await login('manager-hn');
  const parkItem = async () => (await call('/api/workspace/brief?siteId=demo-hainan', {token})).items.find(item => item.id === 'park-plan');
  const latest = async () => (await call('/api/park-plan/latest?siteId=demo-hainan', {token})).plan;
  // No tree strategies yet: the read reports it and saves nothing.
  const missing = await parkItem();
  assert.equal(missing.title, '本周全园割胶：需由大模型生成');
  assert.match(missing.conclusion, /^\d+ 棵树的树表策略已过期或尚未生成/);
  assert.deepEqual(missing.action, {type:'park_plan', label:'请大模型生成策略'});
  assert.equal(modelRequests.length,0,'a read-only brief does not call the model');
  assert.equal(await latest(), null);
  // The explicit recompute prepares strategies first; its saved plan then leads the brief.
  const plan = await call('/api/park-plan', {token, input:{siteId:'demo-hainan'}, status:201});
  assert.equal(unpreparedTreeCount(plan.readiness), 0);
  assert.ok(plan.readiness.readyCount > 0);
  const ready = await parkItem();
  assert.equal(ready.title, `本周全园割胶：${plan.stanceLabel}`);
  assert.equal(ready.action.planId, plan.id);
  // A day later the saved plan is stale and the hour-long strategies have lapsed:
  // the brief must not recompute and store a plan that counts every tree as uncuttable.
  now = new Date(+NOW + 25 * 3600000);
  token = await login('manager-hn');
  const lapsed = await parkItem();
  assert.equal(lapsed.title, '本周全园割胶：需由大模型生成');
  assert.match(lapsed.reason, /^最近方案：本周全园/);
  assert.deepEqual(lapsed.sourceRefs, [plan.id]);
  assert.equal((await latest()).id, plan.id);
  // Demo mode must not quietly call the paid model or save a rules substitute.
  const session = await call('/api/assistant/sessions', {token, input:{siteId:'demo-hainan'}, status:201});
  const answer = await turn(session.sessionId, {message:'这周全园割胶要不要减产？', mode:'demo'}, token);
  assert.equal(answer.status, 'completed', answer.error);
  assert.match(answer.answer, /规则演示不会生成新的经营方案.*已配置模型/);
  assert.ok(!answer.tools.some(tool=>tool.name==='plan_park_tapping'));
  assert.equal(modelRequests.length,1,'only the explicit POST generated a plan');
  assert.equal((await latest()).id,plan.id);
});

test('park plan: the model chooses operating frequency while physical constraints limit execution', () => {
  const context = makeParkContext({siteId:'demo-hainan', now:NOW});
  const base = {siteId:'demo-hainan', now:NOW, context, plannedSalesKg:0, events:[], salesSource:'test',inventory:{stockKg:300,availableKg:200},storageKg:900};
  assert.throws(()=>calculateParkPlan(base),error=>error.code==='PLAN_MODEL_REQUIRED');
  for(const [frequency,stance] of [[0,'pause'],[1,'reduce'],[2,'hold'],[3,'increase']]) {
    const plan=calculateParkPlan({...base,modelProposal:modelProposal(frequency)});
    assert.equal(plan.stance,stance);
    assert.equal(plan.frequencyPerWeek,frequency);
    assert.ok(plan.zones.every(zone=>zone.requestedFrequency===frequency));
  }
  const full = calculateParkPlan({...base,modelProposal:modelProposal(3),inventory:{stockKg:900,availableKg:500}});
  assert.equal(full.stance, 'pause');
  assert.ok(full.zones.every(zone => zone.frequency === 0));
  assert.ok(full.constraintAdjustments.some(row=>row.kind==='capacity'));
  const tight=calculateParkPlan({...base,modelProposal:modelProposal(3),inventory:{stockKg:880,availableKg:480},plannedSalesKg:40});
  assert.equal(tight.stance,'pause','planned dispatch has not freed warehouse space');
  const falling=structuredClone(context);
  falling.modules.market.prices=falling.modules.market.prices.map((price,i)=>({...price,value:15-i*.1}));
  falling.modules.market.demand.value=85;
  const unchanged=calculateParkPlan({...base,context:falling,modelProposal:modelProposal(3)});
  assert.equal(unchanged.frequencyPerWeek,3,'economic scores must not override the actual model suggestion');
  const faulty=calculateParkPlan({...base,modelProposal:modelProposal(3),events:[
    {id:'e1',kind:'device_fault',zone:2,status:'active',note:'割胶头故障'},
    {id:'e2',kind:'rain',zone:null,status:'active',note:'全园雨'},
  ]});
  assert.equal(faulty.zones[2].frequency,0);
  assert.ok(faulty.constraintAdjustments.some(row=>row.zone==='C'&&row.kind==='device'));
  assert.ok(faulty.zones.every(zone=>!zone.dates.includes(faulty.outlook[0].date)));
  for(const zone of unchanged.zones)for(let i=1;i<zone.dates.length;i++)assert.ok(zone.dates[i]>zone.dates[i-1]);
});

test('park plan HTTP: a manager adopts it into zone tasks, replacement needs confirmation, others cannot adopt', async t => {
  const {call, login} = await fixture(t,{seedTasks:false});
  const manager = await login('manager-hn'), operator = await login('operator-hn');
  const plan = await call('/api/park-plan', {token:manager, input:{siteId:'demo-hainan'}, status:201});
  assert.ok(plan.zones.length === 4 && plan.modelProposal.mode==='llm' && plan.outlook.length === 7);
  await call(`/api/park-plan/${plan.id}/adopt`, {token:operator, input:{siteId:'demo-hainan'}, status:403});
  await call(`/api/park-plan/${plan.id}/adopt`, {token:await login('manager-xs'), input:{siteId:'demo-hainan'}, status:403});
  const adopted = await call(`/api/park-plan/${plan.id}/adopt`, {token:manager, input:{siteId:'demo-hainan'}});
  const expected = plan.zones.reduce((n, zone) => n + zone.dates.length, 0);
  assert.ok(adopted.adoption.tasks.length>0);
  assert.equal(adopted.adoption.tasks.length + adopted.adoption.skipped.length, expected);
  assert.ok(adopted.adoption.tasks.every(task => task.status === '待开始'));
  assert.deepEqual(await call(`/api/park-plan/${plan.id}/adopt`, {token:manager, input:{siteId:'demo-hainan'}}), adopted);
  // A different plan for the same week (zone C device fault) must not silently stack on top.
  await call('/api/simulation/operational-events', {token:manager, input:{requestId:'fault-c', siteId:'demo-hainan', kind:'device_fault', zone:2, note:'C区割胶头故障'}});
  const second = await call('/api/park-plan', {token:manager, input:{siteId:'demo-hainan'}, status:201});
  assert.notEqual(second.id, plan.id);
  assert.equal(second.zones[2].frequency, 0);
  const conflict = await call(`/api/park-plan/${second.id}/adopt`, {token:manager, input:{siteId:'demo-hainan'}, status:409});
  assert.equal(conflict.error.code, 'PLAN_CONFLICT');
  const replaced = await call(`/api/park-plan/${second.id}/adopt`, {token:manager, input:{siteId:'demo-hainan', replace:true}});
  assert.ok(replaced.adoption.replacedTaskIds.length > 0);
  const tasks = (await call('/api/simulation/tasks?siteId=demo-hainan', {token:manager})).items;
  assert.ok(replaced.adoption.replacedTaskIds.every(id => tasks.find(task => task.id === id)?.status === '已取消'));
  assert.ok(!tasks.some(task => task.sourceParkPlanId === second.id && task.block === 'C'));
});

test('cerebellum: proposals stay pending until approved, then drive rules and validation; rollback restores', async t => {
  const {app, call, login} = await fixture(t);
  const manager = await login('manager-xs'), operator = await login('operator-hn');
  const reflected = await call('/api/cerebellum/reflect', {token:manager, input:{siteId:'demo-xsbn'}, status:201});
  assert.equal(reflected.proposal.status, 'pending');
  assert.equal(thresholdsFor('demo-xsbn').soilWetPct, WEATHER_THRESHOLDS.soilWetPct, 'pending proposal must not apply');
  await call(`/api/cerebellum/proposals/${reflected.proposal.id}/decision`, {token:operator, input:{decision:'approve'}, status:403});
  await call(`/api/cerebellum/proposals/${reflected.proposal.id}/decision`, {token:await login('manager-hn'), input:{decision:'approve'}, status:403});
  const approved = await call(`/api/cerebellum/proposals/${reflected.proposal.id}/decision`, {token:manager, input:{decision:'approve', note:'高原雾湿'}});
  assert.equal(approved.status, 'approved');
  assert.equal(thresholdsFor('demo-xsbn').soilWetPct, 70);
  assert.equal(thresholdsFor('demo-hainan').soilWetPct, WEATHER_THRESHOLDS.soilWetPct, 'other parks keep their own parameters');
  // The same observation is a wet recovery under defaults but not under the approved highland set.
  const observed = {rainfallMm:0, soilMoisture:{value:67}, recentRainfall:[], dryRubberContent:{value:34}};
  const step = {rainfallMm:0, rainProbabilityPct:10};
  assert.equal(assessWeatherWindow({observed, step, siteId:'demo-hainan'}).suitability, 'review');
  assert.equal(assessWeatherWindow({observed, step, siteId:'demo-xsbn'}).suitability, 'suitable');
  const status = await call('/api/cerebellum?siteId=demo-xsbn', {token:manager});
  assert.equal(status.activeVersion, 'v1');
  const memories = app.assistant.memory.list({siteId:'demo-xsbn', role:'manager'});
  assert.ok(memories.some(item => item.topic === 'cerebellum'), 'approval becomes park experience');
  await call('/api/cerebellum/rollback', {token:manager, input:{siteId:'demo-xsbn', toVersion:0}});
  assert.equal(thresholdsFor('demo-xsbn').soilWetPct, WEATHER_THRESHOLDS.soilWetPct);
  assert.equal((await call('/api/cerebellum?siteId=demo-xsbn', {token:manager})).history.length, 2);
});

test('cerebellum: guard rails reject out-of-range or oversized model proposals', () => {
  assert.deepEqual(checkChanges(WEATHER_THRESHOLDS, [{key:'rainProbabilityDeferPct', to:65}]), []);
  assert.match(checkChanges(WEATHER_THRESHOLDS, [{key:'rainProbabilityDeferPct', to:85}]).join(), /40–80/);
  assert.match(checkChanges(WEATHER_THRESHOLDS, [{key:'soilWetPct', to:80}]).join(), /单次最多/);
  assert.match(checkChanges(WEATHER_THRESHOLDS, [{key:'unknown', to:1}]).join(), /未知参数/);
  assert.ok(Object.values(PARAMETER_SPECS).every(spec => spec.min < spec.max && spec.step > 0));
});

test('harness: the grower conversation stays on the plot, tools follow the role allowlist, memory is private', async t => {
  const {call, login, turn} = await fixture(t, {pauseModelsOnStart:true});
  const grower = await login('grower-hn-wang');
  const session = await call('/api/assistant/sessions', {token:grower, input:{siteId:'demo-hainan', role:'manager'}, status:201});
  assert.equal(session.role, 'grower', 'role comes from the identity, not the request');
  const answer = await turn(session.sessionId, {message:'我这亩地卖了多少钱？', mode:'demo'}, grower);
  assert.equal(answer.status, 'completed', answer.error);
  assert.match(answer.answer, /鲜胶乳/);
  assert.ok(answer.tools.some(tool => tool.name === 'read_my_plot' && tool.risk === 'read'));
  assert.ok(!answer.tools.some(tool => tool.name === 'read_sales_inventory'));
  const remembered = await turn(session.sessionId, {message:'记住：我上午十点后才有空巡树', mode:'demo'}, grower);
  assert.match(remembered.answer, /只有你本人/);
  const own = await call('/api/assistant/memories?siteId=demo-hainan', {token:grower});
  assert.ok(own.items.some(item => item.scope === 'private' && item.content.includes('十点')));
  const manager = await login('manager-hn');
  const theirs = await call('/api/assistant/memories?siteId=demo-hainan', {token:manager});
  assert.ok(!theirs.items.some(item => item.content.includes('十点')), 'private memory is not shared');
  await call(`/api/assistant/sessions/${session.sessionId}`, {token:manager, status:404});
  await call(`/api/assistant/sessions/${session.sessionId}/turns`, {token:grower, input:{message:'看看 T-0001', mode:'demo'}, status:403});
});

test('harness: managers can ask for the park plan and a cerebellum reflection in conversation; memory can be edited and archived', async t => {
  const {call, login, turn,app,modelRequests} = await fixture(t, {pauseModelsOnStart:true});
  const manager = await login('manager-xs');
  const session = await call('/api/assistant/sessions', {token:manager, input:{siteId:'demo-xsbn'}, status:201});
  const plan = await turn(session.sessionId, {message:'这周全园割胶要不要减产？', mode:'demo'}, manager);
  assert.equal(plan.status, 'completed', plan.error);
  assert.match(plan.answer,/规则演示不会生成新的经营方案.*已配置模型/);
  assert.ok(!plan.tools.some(tool=>tool.name==='plan_park_tapping'));
  assert.equal(app.parkPlans.latest('demo-xsbn'),null);assert.equal(modelRequests.length,0);
  assert.ok(plan.actions.some(action => action.type === 'park_plan'));
  const tuning = await turn(session.sessionId, {message:'根据最近执行情况，小脑参数要不要自我调整？', mode:'demo'}, manager);
  assert.match(tuning.answer, /待|审批|暂不建议/);
  assert.ok(tuning.tools.some(tool => tool.name === 'propose_cerebellum_tuning' && tool.risk === 'proposal'));
  const created = await call('/api/assistant/memories', {token:manager, input:{scope:'park', siteId:'demo-xsbn', title:'雾天经验', content:'雾天上午九点后再割'}, status:201});
  const edited = await call(`/api/assistant/memories/${created.id}`, {token:manager, input:{content:'雾散后（通常九点半）再割'}});
  assert.equal(edited.history[0].content, '雾天上午九点后再割');
  await call('/api/assistant/memories', {token:manager, input:{scope:'shared', siteId:'demo-xsbn', content:'公共经验'}, status:403});
  await call(`/api/assistant/memories/${created.id}/archive`, {token:manager, input:{reason:'已写入作业规程'}});
  const list = await call('/api/assistant/memories?siteId=demo-xsbn', {token:manager});
  assert.ok(!list.items.some(item => item.id === created.id));
});

test('harness: a configured model only sees role tools; a refused call is reported back instead of executed', async t => {
  const requests = [];
  const assistantModel = {
    describe: () => ({configured:true, model:'fixture-model'}),
    async complete(input) {
      requests.push(structuredClone(input));
      if (requests.length === 1) return {content:'', toolCalls:[{id:'m-1', name:'compare_market', arguments:{transportKgPerDay:30}}]};
      return {content:'结论：销售测算需要园区管理处理。\n下一步：先处理 B 区任务。', toolCalls:[]};
    },
  };
  const {call, login, turn} = await fixture(t, {assistantModel});
  const operator = await login('operator-hn');
  const session = await call('/api/assistant/sessions', {token:operator, input:{siteId:'demo-hainan'}, status:201});
  const result = await turn(session.sessionId, {message:'帮我比较销售方案', mode:'configured'}, operator);
  assert.equal(result.status, 'completed', result.error);
  const offered = requests[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('read_tasks') && offered.includes('search_memory'));
  assert.ok(!offered.includes('compare_market') && !offered.includes('propose_cerebellum_tuning') && !offered.includes('read_sales_inventory'));
  assert.match(requests[0].messages[0].content, /机器人运营/);
  const refusal = requests[1].messages.find(message => message.role === 'tool' && message.tool_call_id === 'm-1');
  assert.match(refusal.content, /TOOL_NOT_ALLOWED/);
  assert.ok(result.tools.some(tool => tool.name === 'compare_market' && tool.denied));
});

test('cerebellum: a weather strategy generated with an approved parameter set passes independent validation', async t => {
  const {app, call, login} = await fixture(t);
  const manager = await login('manager-xs');
  const {proposal} = await call('/api/cerebellum/reflect', {token:manager, input:{siteId:'demo-xsbn'}, status:201});
  await call(`/api/cerebellum/proposals/${proposal.id}/decision`, {token:manager, input:{decision:'approve'}});
  const context = makeParkContext({siteId:'demo-xsbn', treeIds:['T-0001'], now:NOW});
  const candidate = await new RuleGenerator().generate({kind:'weather_window', context, now:NOW});
  assert.equal(candidate.proposal.timingAssessment.thresholds.soilWetPct, 70);
  assert.doesNotThrow(() => checkCandidate('weather_window', candidate, context, NOW));
  assert.ok(app.cerebellum.status('demo-xsbn').history[0].proposalId === proposal.id);
});
