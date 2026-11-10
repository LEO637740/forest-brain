import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext,TREE_IDS} from '../src/adapters/park-demo.js';
import {SimulationService} from '../src/simulation.js';
import {prepareStrategySnapshots} from '../src/strategy-snapshot-preparation.js';

async function setup(t){
  let now=new Date('2026-10-29T00:00:00Z'),seq=0;
  const app=createApp({dbPath:':memory:',clock:()=>now,generator:{mode:'llm',modelVersion:'offline-rules-fixture',async generate(args){return new RuleGenerator().generate(args);}}});
  await new Promise((yes,no)=>{app.server.once('error',no);app.server.listen(0,'127.0.0.1',yes);});
  t.after(()=>app.close());
  const api=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Connection:'close'},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  const prepare=async(treeIds,kind='surface_action',extra={})=>{const value=await api('/api/demo/trees/prepare',{preparationId:'prepare-background-'+ ++seq,siteId:'demo-hainan',treeIds,kind,dataMode:'demo',generatorMode:'demo_rules',...extra});await app.runtime.idle();return value;};
  const current=(treeId,kind='surface_action',siteId='demo-hainan')=>{const b=app.store.getTreeViewBinding(treeId,kind,'demo',siteId);return b&&app.store.getRun(b.runId);};
  return {app,api,prepare,current,advance(ms){now=new Date(+now+ms);}};
}
const background={background:true,refreshReason:'scheduled',preserveConfigured:true};

test('background HTTP refresh preserves explicit surface skip, withdrawal and adopted angle without touching tasks',async t=>{
  const f=await setup(t);
  await f.prepare(['T-0006','T-0002']);await f.prepare(['T-0001'],'tapping_angle');
  const skipped=f.current('T-0006'),withdrawn=f.current('T-0002'),angle=f.current('T-0001','tapping_angle');
  await f.api('/api/simulation/actions',{requestId:'background-keep-skip',kind:'surface_review',siteId:'demo-hainan',treeId:'T-0006',strategyId:skipped.result.strategy.strategyId,disposition:'skip',dataMode:'demo'});
  await f.api(`/internal/harness/runs/${withdrawn.runId}/review`,{status:'withdrawn',reason:'人工撤回须保持'});
  await f.api('/api/simulation/actions',{requestId:'background-keep-angle',kind:'adopt_angle',siteId:'demo-hainan',treeId:'T-0001',strategyId:angle.result.strategy.strategyId,dataMode:'demo'});
  const beforeTasks=await f.api('/api/simulation/tasks?siteId=demo-hainan');
  const surface=await f.prepare(['T-0006','T-0002'],'surface_action',background),angles=await f.prepare(['T-0001'],'tapping_angle',background);
  assert.equal(surface.items.length,0);assert.deepEqual(new Set(surface.skipped.map(x=>x.reason)),new Set(['review_skip','withdrawn']));
  assert.equal(angles.items.length,0);assert.equal(angles.skipped[0].reason,'angle_adopted');
  assert.equal(f.current('T-0006').runId,skipped.runId);assert.equal(f.current('T-0002').runId,withdrawn.runId);assert.equal(f.current('T-0001','tapping_angle').runId,angle.runId);
  f.advance(2*3600000);
  assert.equal((await f.prepare(['T-0002'],'surface_action',background)).skipped[0].reason,'withdrawn');
  assert.equal((await f.prepare(['T-0001'],'tapping_angle',background)).skipped[0].reason,'angle_adopted','expired adopted angle still requires deliberate re-adoption');
  assert.deepEqual(await f.api('/api/simulation/tasks?siteId=demo-hainan'),beforeTasks);
  const manual=await f.prepare(['T-0002']);assert.equal(manual.items.length,1);assert.notEqual(f.current('T-0002').runId,withdrawn.runId,'explicit manual regeneration remains available');
});

test('background startup fills missing/expired views and scheduled refresh updates rules, not fresh configured advice',async t=>{
  const f=await setup(t);
  await f.prepare(['T-0001']);await f.prepare(['T-0003'],'tapping_angle',{generatorMode:'configured'});
  const existing=f.current('T-0001'),configured=f.current('T-0003','tapping_angle');
  const startup=await f.prepare(['T-0001','T-0002'],'surface_action',{...background,refreshReason:'startup'});
  assert.deepEqual(startup.items.map(x=>x.treeId),['T-0002']);assert.equal(f.current('T-0001').runId,existing.runId);
  const scheduled=await f.prepare(['T-0001'],'surface_action',background);assert.equal(scheduled.items.length,1);
  assert.equal((await f.prepare(['T-0003'],'tapping_angle',background)).items.length,0);
  f.advance(2*3600000);
  const expired=await f.prepare(['T-0003'],'tapping_angle',{...background,refreshReason:'startup'});
  assert.equal(expired.items.length,1);assert.notEqual(f.current('T-0003','tapping_angle').runId,configured.runId);
  assert.equal(f.current('T-0003','tapping_angle').request.generatorMode,'demo_rules','new fallback is visibly a rule run, not an invented model result');
});

test('a skip in Hainan does not block the same tree identifier in another park',async t=>{
  const f=await setup(t);await f.prepare(['T-0006']);
  await f.api('/api/simulation/actions',{requestId:'skip-only-hainan',kind:'surface_review',siteId:'demo-hainan',treeId:'T-0006',strategyId:f.current('T-0006').result.strategy.strategyId,disposition:'skip',dataMode:'demo'});
  const other=await f.prepare(['T-0006'],'surface_action',{...background,siteId:'demo-xsbn'});
  assert.equal(other.items.length,1);assert.equal(f.current('T-0006','surface_action','demo-xsbn').request.siteId,'demo-xsbn');
});

test('internal snapshot preparation covers another park with bounded rules and preserves existing completed tasks',async t=>{
  let now=new Date('2026-10-29T00:00:00Z'),paid=0;
  const clock=()=>now,store=new Store(),runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock,concurrency:0,generator:{mode:'llm',async generate(){paid++;throw Error('No paid calls');}}});
  const simulation=new SimulationService(store,clock);
  t.after(async()=>{await runtime.stop();store.close();});
  simulation.tasks({tasks:[{id:'historical-completed',site:'xsbn',siteId:'demo-xsbn',date:'2026-10-28',title:'已完成',block:'A',robot:'R-A',start:'06:00',end:'06:15',kind:'割胶',count:1,done:1,status:'已完成',treeIndices:[0]}]});
  const tasks=simulation.latestTasks('demo-xsbn');
  const options={siteId:'demo-xsbn',reason:'startup',store,runtime,makeContext:makeParkContext,dataMode:'demo',clock};
  const first=await prepareStrategySnapshots(options);assert.ok(first.items.every(x=>['succeeded','partial'].includes(x.status)&&x.failed===0),JSON.stringify(first.items));assert.equal(paid,0);
  assert.ok(first.items.some(x=>x.status==='partial'&&x.needsData>0),'missing business inputs stay visibly partial');
  for(const kind of ['tapping_angle','surface_action','growth_plan','pest_risk'])for(const treeId of TREE_IDS){
    const b=store.getTreeViewBinding(treeId,kind,'demo','demo-xsbn');assert.ok(b,kind+' '+treeId);assert.equal(store.getRun(b.runId).request.siteId,'demo-xsbn');
    assert.equal(store.getTreeViewBinding(treeId,kind,'demo','demo-hainan'),null);
  }
  const runs=store.listRuns({siteId:'demo-xsbn',limit:1000}).items;
  assert.ok(runs.length<=262,'angle 200 + other tree batches 60 + weather/market 2');
  const before=store.getTreeViewBinding('T-0001','surface_action','demo','demo-xsbn');
  await prepareStrategySnapshots(options);assert.equal(store.getTreeViewBinding('T-0001','surface_action','demo','demo-xsbn').runId,before.runId,'fresh startup view retained');
  now=new Date(+now+2*3600000);await prepareStrategySnapshots(options);
  assert.notEqual(store.getTreeViewBinding('T-0001','surface_action','demo','demo-xsbn').runId,before.runId,'expired startup view renewed');
  assert.deepEqual(simulation.latestTasks('demo-xsbn'),tasks);assert.equal(paid,0);
});
