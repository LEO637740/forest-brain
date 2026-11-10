import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {AutomaticRunner} from '../src/automatic.js';
import {AppError} from '../src/errors.js';
import {LocalContextProvider,makeDemoContext} from '../src/adapters/context.js';
import {makeIndustryContext} from '../src/adapters/public-context.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {checkCandidate,projectContext,checkContext} from '../src/validation.js';
import {createApp} from '../src/server.js';
import {resultSchema} from '../src/contracts.js';
import {validate} from '../src/schema.js';
import {createHarnessClient} from '../contracts/client.ts';

const now=new Date('2026-10-02T02:00:00.000Z');
const request=(c,kind)=>({requestId:`audit-${kind}`,kind,siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version},executionMode:'simulation'});
const generator=new RuleGenerator();
function industry(){
  const service={status:()=>({location:{confirmed:false},sources:[
    {id:'weather',title:'天气',snapshotId:'weather-test',sourceUrl:'https://weather.example/',retrievedAt:now.toISOString(),validUntil:'2026-10-02T04:00:00Z',data:{location:{name:'海口参考点',confirmed:false},forecast:[{validFrom:'2026-10-02T03:00:00Z',validTo:'2026-10-02T04:00:00Z',rainfallMm:0,rainProbabilityPct:0}]}},
    {id:'market',title:'期货',snapshotId:'market-test',sourceUrl:'https://market.example/',retrievedAt:now.toISOString(),validUntil:'2026-10-10T00:00:00Z',data:{tradeDate:'2026-09-30',contracts:[{contract:'RU2701',closeCnyPerTonne:20095,settlementCnyPerTonne:19710}]}}
  ]})};
  const c=makeIndustryContext({service,now,supplementSimulated:true}),refs=['weather-test','market-test'];
  const p={summary:'模拟行业数据与真实区域参考',reasons:[{text:'RU2701结算价为19710元/吨',sourceRefs:['market-test']}],evidenceRefs:refs,proposal:{horizon:{start:now.toISOString(),end:'2026-10-03T02:00:00Z'},findings:[{topic:'weather',assessment:'需核实园区坐标，不能据参考点判断是否适合割胶。',sourceRefs:['weather-test'],limitation:'仅区域参考'}],recommendations:[{priority:'medium',action:'补采现场观测',reason:'确认园区位置后再评估是否适合割胶',sourceRefs:['weather-test']}],missingData:c.modules.industry.gaps,uncertainty:'须复核',reviewRequired:true}};
  return {c,p};
}
test('quality: revoked historical strategy is marked in every run view and blocked from normal export/strategy API',async()=>{
  const a=createApp({dbPath:':memory:',clock:()=>now});
  try{
    await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${a.server.address().port}`;
    const c=makeDemoContext({now});a.store.saveContext(c);const accepted=a.runtime.submit(request(c,'surface_action'));await a.runtime.idle();
    const before=a.store.getRun(accepted.runId).result;assert.equal(before.strategy.qualityReview.status,'pending');
    const original=a.store.db.prepare('SELECT result FROM runs WHERE id=?').get(accepted.runId).result;
    const review = await fetch(`${url}/internal/harness/runs/${accepted.runId}/review`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status: 'withdrawn', reason: '复核：示例数量不正确'}),
    });
    assert.equal(review.status, 200);
    assert.equal((await review.json()).qualityReview.status, 'withdrawn');
    const read=await (await fetch(`${url}/internal/harness/runs/${accepted.runId}`)).json();
    validate(resultSchema,read);assert.equal(read.strategy.qualityReview.status,'withdrawn');assert.ok(read.strategy.qualityReview.notes[0].includes('数量不正确'));
    const list=await (await fetch(url+'/internal/harness/runs')).json();assert.equal(list.items[0].qualityReview.status,'withdrawn');
    for(const path of [`/internal/harness/runs/${accepted.runId}/export`,`/internal/harness/strategies/${before.strategy.strategyId}`]){
      const response=await fetch(url+path);assert.equal(response.status,409);assert.equal((await response.json()).error.code,'STRATEGY_WITHDRAWN');
    }
    assert.equal(a.store.db.prepare('SELECT result FROM runs WHERE id=?').get(accepted.runId).result,original,'original committed result must remain immutable');
    const client=createHarnessClient({baseUrl:url});await assert.rejects(client.wait(accepted.runId),e=>e.code==='STRATEGY_WITHDRAWN');
  }finally{await a.close();}
});
test('industry: government records remain web sources, reference location and forecast coverage are explicit',()=>{
  const {c}=industry();const w=c.modules.industry.records.find(x=>x.topic==='weather');
  assert.equal(w.provenance.sourceClass,'web_service');const body=JSON.parse(w.content);assert.equal(body.referenceOnly,true);assert.equal(body.forecastCoverage.timezone,'Asia/Shanghai');assert.equal(body.forecastCoverage.completeHours,1);
});
test('industry: reject invented main contract, price basis and unconfirmed-site operational advice, allow cautious review',()=>{
  const {c,p}=industry();assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
  for(const text of ['RU2701为主力合约','RU2701结算价为20095元/吨','RU2701结算价为19710元/千克','参考点天气适宜割胶，建议提前安排割胶时间']){
    const bad=structuredClone(p);bad.summary='模拟：'+text;assert.throws(()=>checkCandidate('industry_brief',bad,c,now),e=>e.code==='CANDIDATE_REJECTED');
  }
  const good=structuredClone(p);good.summary='模拟分析：不能判断主力合约；应先核实园区位置后评估是否适合割胶。';assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now));
  good.summary='模拟：应逐一查看RU2701合约行情，严禁使用“主力合约”称谓。';assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now));
  good.summary='模拟：降雨概率>=60%或现场有雨均不适合割胶，此处仅转述约束，尚未获取园区观测。';assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now));
});
test('industry: reject reversed horizon and mixed stock quantities; allow exact totals and per-batch stock',()=>{
  const {c,p}=industry();const q=structuredClone(p);q.proposal.horizon.end=q.proposal.horizon.start;assert.throws(()=>checkCandidate('industry_brief',q,c,now));
  const stock=c.modules.industry.records.find(r=>r.topic==='inventory').observationId;
  p.evidenceRefs.push(stock);p.summary='模拟：企业可用库存合计200kg。SIM-B02在库400kg，可用库存0kg。企业总库存800kg，质检冻结400kg。';assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
  for(const text of ['企业总库存1200kg','质检冻结200kg','SIM-B02在库400kg，可用库存400kg']){const bad=structuredClone(p);bad.summary='模拟：'+text;assert.throws(()=>checkCandidate('industry_brief',bad,c,now));}
});
test('industry: old report outlooks must not become current forecasts or undefined contract ranges',()=>{
  const {c,p}=industry();
  for(const text of ['9月预计高位震荡','预计2026年9月高位震荡','2025年12月有望上涨','近月合约结算价在19000-19710元/吨区间']){
    const bad=structuredClone(p);bad.summary='模拟：'+text;assert.throws(()=>checkCandidate('industry_brief',bad,c,now));
  }
  for(const text of ['报告当时预计2026年9月高位震荡，该预测已过期、不代表当前趋势','预计2027年9月走势待验证','8月价格上涨，这是历史统计']){
    const good=structuredClone(p);good.summary='模拟：'+text;assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now));
  }
});
test('weather: exact future forecast segments pass, merged adjacent windows are rejected',async()=>{
  const c=projectContext(makeDemoContext({now}),'weather_window'),p=await generator.generate({kind:'weather_window',context:c,now});
  assert.ok(p.proposal.windows.length>1);assert.doesNotThrow(()=>checkCandidate('weather_window',p,c,now));
  const merged=structuredClone(p);merged.proposal.windows=[{...p.proposal.windows[0],end:p.proposal.windows.at(-1).end}];
  assert.throws(()=>checkCandidate('weather_window',merged,c,now),e=>e.code==='CANDIDATE_REJECTED');
});
test('industry: small forecast rainfall is not no rain, and reference weather cannot establish site agronomy',()=>{
  const {c,p}=industry(),weather=c.modules.industry.records.find(r=>r.topic==='weather');
  const data=JSON.parse(weather.content);data.forecast[0].rainfallMm=0.1;weather.content=JSON.stringify(data);
  for(const text of ['参考点天气预报显示未来24小时无雨','土壤水分充足','当前处于高温高湿季节','宏观指导提示当前气候条件易诱发病害','参考点08:00-10:00 UTC+8有小雨']){
    const bad=structuredClone(p);bad.summary='模拟：'+text;assert.throws(()=>checkCandidate('industry_brief',bad,c,now));
  }
  p.summary='模拟：参考点预报有少量降雨；6月公告介绍高温多雨条件下的风险，需先核实园区实际条件。';
  assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
});
test('growth: independently reject invented numeric output, method and unsupported horizon',async()=>{
  const c=projectContext(makeDemoContext({now}),'growth_plan'),p=await generator.generate({kind:'growth_plan',context:c,now});assert.doesNotThrow(()=>checkCandidate('growth_plan',p,c,now));
  for(const edit of [p=>p.proposal.predictions[0].value+=1,p=>p.proposal.predictions[0].method='trust-me-neural-model',p=>p.proposal.predictions[0].at='2030-01-01T00:00:00Z']){const bad=structuredClone(p);edit(bad);assert.throws(()=>checkCandidate('growth_plan',bad,c,now),e=>e.code==='CANDIDATE_REJECTED');}
});
test('health: do not omit symptomatic trees, invent symptoms or replace recent evidence with old records',async()=>{
  const c=structuredClone(projectContext(makeDemoContext({now}),'pest_risk')),p=await generator.generate({kind:'pest_risk',context:c,now});assert.doesNotThrow(()=>checkCandidate('pest_risk',p,c,now));
  const omitted=structuredClone(p);omitted.proposal.findings=[];omitted.proposal.inspectionTargets=[];assert.throws(()=>checkCandidate('pest_risk',omitted,c,now));
  const invented=structuredClone(p);invented.proposal.findings[0].symptomCodes.push('invented_disease');assert.throws(()=>checkCandidate('pest_risk',invented,c,now));
  const old={...c.modules.health.records[0],recordId:'old-symptom',observedAt:'2026-09-01T00:00:00Z',symptomCodes:['old_only']};c.modules.health.records.push(old);
  const stale=structuredClone(p);stale.proposal.findings[0].sourceRefs=[old.recordId];stale.proposal.findings[0].symptomCodes=old.symptomCodes;assert.throws(()=>checkCandidate('pest_risk',stale,c,now));
});
for(const kind of ['surface_action','market_scenario','pest_risk'])test(`${kind}: strategy expiry cannot outlive implicit evidence freshness`,async()=>{
  const store=new Store(),runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock:()=>now});
  try{
    const c=makeDemoContext({now});
    if(kind==='surface_action')for(const e of c.modules.inspection.evidence){e.capturedAt=new Date(+now-24*3600000+30000).toISOString();e.expiresAt=null;}
    if(kind==='market_scenario')c.modules.market.prices=[{...c.modules.market.prices[0],observedAt:new Date(+now-7*86400000+30000).toISOString()}];
    if(kind==='pest_risk')for(const r of c.modules.health.records)r.observedAt=new Date(+now-7*86400000+30000).toISOString();
    assert.equal(checkContext(request(c,kind),c,now).missing.length,0);
    store.saveContext(c);const accepted=runtime.submit(request(c,kind));await runtime.idle();const result=store.getRun(accepted.runId).result;
    assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(Date.parse(result.strategy.expiresAt),+now+30000);
  }finally{await runtime.stop();store.close();}
});
test('automatic recovery: recovered account failure opens circuit immediately and finalizes exactly once',async()=>{
  const store=new Store();let clock=new Date(now),calls=0;
  const config={enabled:true,intervalMinutes:60,maxRunsPer24Hours:6,maxModelRequestsPer24Hours:12,maxRequestsPerRun:2,maxConsecutiveFailures:2,jobs:[{id:'surface',kind:'surface_action',treeIds:['T-0012']}]};
  const c=makeDemoContext({now});store.saveContext(c);
  const {run}=store.submit(request(c,'surface_action'),now.toISOString(),{...config,cycleKey:'crash-cycle',jobId:'surface'});store.start(run.runId,now.toISOString());
  store.saveAutomaticState({lastStartedAt:now.toISOString()});
  const runtime=new HarnessRuntime({store,clock:()=>clock,contextProvider:new LocalContextProvider(store),generator:{mode:'llm',describe:()=>({configured:true}),async generate(a){a.onEvent('llm_request',{});calls++;throw new AppError('LLM_ACCOUNT_UNAVAILABLE','模拟账户不可用',502);}}});
  const outputDirectory=mkdtempSync(join(tmpdir(),'rubber-recovery-audit-'));
  const auto=new AutomaticRunner({store,runtime,config,clock:()=>clock,outputDirectory,service:{refresh:async()=>{},status:()=>({location:{confirmed:false},sources:[]})}});
  try{
    runtime.start();await runtime.idle();assert.equal(calls,1);assert.equal(auto.status().status,'error_paused');assert.equal(auto.status().consecutiveFailures,1);
    auto.finalizeRun(store.getRun(run.runId));assert.equal(auto.status().consecutiveFailures,1);assert.equal(store.events(run.runId).filter(e=>e.stage==='automatic_finished').length,1);
    assert.ok(existsSync(join(outputDirectory,run.runId+'-attempt-2.json')));
    clock=new Date(+now+3600000);await auto.tick();assert.equal(calls,1,'must not send another request after recovery failure');
  }finally{await auto.stop();await runtime.stop();store.close();}
});
