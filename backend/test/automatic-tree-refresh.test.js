import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {StrategyRefresh} from '../src/strategy-refresh.js';
import {prepareStrategySnapshots} from '../src/strategy-snapshot-preparation.js';
import {SimulationService} from '../src/simulation.js';

const kinds=['tapping_angle','surface_action','growth_plan','pest_risk'];
const modelLimits={maxRunsPer24Hours:50,maxModelRequestsPer24Hours:50,maxRequestsPerRun:2,maxConsecutiveFailures:2};

function fixture(t,{requestLimit=50,onGenerate,invalidCandidate=false}={}) {
  let now=new Date('2026-10-30T02:00:00.000Z'),sequence=0;
  const clock=()=>now,store=new Store(),calls=[];
  // The legacy loop stays disabled in fusion; the new scheduler must be the
  // authority enabling these budgeted model requests.
  store.saveAutomaticState({configuredEnabled:false});
  const refresh=new StrategyRefresh({store,clock,config:{enabled:true,modelsEnabled:true,treeModelsEnabled:true,
    maxTreeModelRequestsPer24Hours:requestLimit}});
  const generator={mode:'llm',modelVersion:'isolated-tree-model',async generate(args){
    args.onEvent('llm_request',{provider:'test',model:'isolated-tree-model',attempt:1});
    calls.push({kind:args.kind,treeIds:[...args.context.targetSnapshot.treeIds],siteId:args.context.siteId,runId:args.runId});
    assert.equal(store.automaticBudget(clock().toISOString()).modelRequests,calls.length,'reserve before provider work');
    await onGenerate?.(args);
    const candidate=await new RuleGenerator().generate(args);
    args.onEvent('llm_completed',{provider:'test',model:'isolated-tree-model',promptVersion:'test-v1',promptHash:'test-prompt',attempts:1});
    if(invalidCandidate)candidate.evidenceRefs=['nonexistent-evidence'];
    return candidate;
  }};
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator,clock,concurrency:0});
  const simulation=new SimulationService(store,clock);
  t.after(async()=>{await refresh.stop();await runtime.stop();store.close();});
  const current=(treeId,kind='tapping_angle',siteId='demo-hainan')=>{
    const binding=store.getTreeViewBinding(treeId,kind,'demo',siteId);return binding&&store.getRun(binding.runId);
  };
  const prepare=(options={})=>prepareStrategySnapshots({siteId:'demo-hainan',reason:'startup',cycleId:`test-cycle-${++sequence}`,
    store,runtime,makeContext:makeParkContext,dataMode:'demo',clock,modelsEnabled:true,modelLimits,treeIds:['T-0004'],...options});
  const publishRule=async(treeId,kind='tapping_angle',siteId='demo-hainan')=>{
    const context=makeParkContext({siteId,treeIds:[treeId],now});store.saveContext(context);
    const requestId=`manual-rule-${++sequence}`,accepted=runtime.submit({requestId,kind,siteId,
      targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},
      executionMode:'simulation',generatorMode:'demo_rules',trigger:{type:'user',eventId:requestId}});
    store.bindTreeView({treeId,siteId,kind,dataMode:'demo',preparationId:requestId,requestId,runId:accepted.runId,
      contextSnapshotId:context.snapshotId,asOf:context.asOf});
    await runtime.execute(accepted.runId);return store.getRun(accepted.runId);
  };
  return {store,runtime,refresh,simulation,calls,prepare,current,publishRule,clock,advance(ms){now=new Date(+now+ms);}};
}

test('automatic tree refresh upgrades a fresh T4 rule at startup, routes ordinary/blocked trees without a model, and only publishes advice',async t=>{
  const f=fixture(t);
  f.simulation.tasks({tasks:[{id:'existing-completed-task',site:'hainan',siteId:'demo-hainan',date:'2026-10-29',
    title:'历史已完成作业',block:'A',robot:'R-A',start:'06:00',end:'06:15',kind:'割胶',count:1,done:1,status:'已完成',treeIndices:[0]}]});
  const tasks=f.simulation.latestTasks(),before=await f.publishRule('T-0004');
  assert.equal(before.result.strategy.provenance.mode,'simulated');
  assert.ok(Date.parse(before.result.strategy.expiresAt)>+f.clock());
  const result=await f.prepare({treeIds:['T-0001','T-0004','T-0006']});
  assert.equal(result.modelRequests,3,'T4 angle, surface and health are complex');
  assert.ok(f.calls.every(call=>call.treeIds.length===1&&call.treeIds[0]==='T-0004'));
  assert.deepEqual(new Set(f.calls.map(call=>call.kind)),new Set(['tapping_angle','surface_action','pest_risk']));
  for(const kind of ['tapping_angle','surface_action','pest_risk']){
    const run=f.current('T-0004',kind);
    assert.equal(run.status,'succeeded');assert.equal(run.request.generatorMode,'configured');
    assert.equal(run.result.strategy.provenance.mode,'estimated');assert.equal(run.result.strategy.generationMetadata.provider,'test');
    assert.ok(!run.result.strategy.fallback);assert.notEqual(run.runId,before.runId);
  }
  for(const treeId of ['T-0001','T-0006'])for(const kind of kinds)assert.equal(f.current(treeId,kind).request.generatorMode,'demo_rules');
  assert.deepEqual(f.simulation.latestTasks(),tasks);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM simulation_actions').get().n,0,'no automatic adoption');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM simulation_market_sales_plans').get().n,0);
});

test('a current actual brain result is reused across startup and hourly refresh, then refreshed after expiry',async t=>{
  const f=fixture(t);await f.prepare();
  const first=f.current('T-0004').runId,calls=f.calls.length;
  const startup=await f.prepare(),scheduled=await f.prepare({reason:'scheduled'});
  assert.equal(startup.modelRequests,0);assert.equal(scheduled.modelRequests,0);
  assert.equal(f.calls.length,calls);assert.equal(f.current('T-0004').runId,first);
  assert.equal(scheduled.items.find(item=>item.kind==='tapping_angle').preserved,1);
  f.advance(2*3600000);
  const expired=await f.prepare();assert.equal(expired.modelRequests,3);assert.notEqual(f.current('T-0004').runId,first);
});

test('model pause defers complex trees and keeps free work available; resume fills the pending analysis',async t=>{
  const f=fixture(t);f.store.setModelPaused(true,f.clock().toISOString());
  const result=await f.prepare({treeIds:['T-0001','T-0004']});
  assert.equal(f.calls.length,0);assert.equal(result.modelRequests,0);
  for(const kind of ['tapping_angle','surface_action','pest_risk']){
    const item=result.items.find(item=>item.kind===kind);
    assert.equal(item.deferred,1);assert.equal(item.status,'partial');assert.match(item.error,/暂停/);
    assert.ok(f.current('T-0001',kind));assert.equal(f.current('T-0004',kind),null);
  }
  f.store.setModelPaused(false,f.clock().toISOString());
  assert.equal((await f.prepare()).modelRequests,3);assert.equal(f.calls.length,3);
});

test('rolling model quota defers the remaining complex dimensions without unbudgeted calls or fake brain results',async t=>{
  const f=fixture(t,{requestLimit:1});
  const result=await f.prepare({modelLimits:{...modelLimits,maxModelRequestsPer24Hours:1}});
  assert.equal(f.calls.length,1);assert.equal(result.modelRequests,1);
  assert.equal(f.current('T-0004').result.strategy.provenance.mode,'estimated');
  for(const kind of ['surface_action','pest_risk']){
    const item=result.items.find(item=>item.kind===kind);
    assert.equal(item.deferred,1);assert.equal(item.status,'partial');assert.match(item.error,/额度/);
    assert.equal(f.current('T-0004',kind),null);
  }
  assert.ok(f.current('T-0004','growth_plan'),'free growth work still finishes');
  assert.equal(f.store.automaticBudget(f.clock().toISOString()).modelRequests,1);
});

test('a rejected brain candidate is a visibly partial rule fallback, while its model request remains accounted',async t=>{
  const f=fixture(t,{invalidCandidate:true}),result=await f.prepare();
  assert.equal(f.calls.length,3);assert.equal(result.modelRequests,3);
  for(const kind of ['tapping_angle','surface_action','pest_risk']){
    const item=result.items.find(item=>item.kind===kind),run=f.current('T-0004',kind);
    assert.equal(item.status,'partial');assert.equal(item.fallbacks,1);assert.match(item.error,/规则保底/);
    assert.equal(run.status,'succeeded');assert.ok(run.result.strategy.fallback);
    assert.equal(run.result.strategy.provenance.mode,'simulated');assert.equal(run.result.strategy.generationMetadata.provider,'harness-fallback');
    assert.ok(f.store.events(run.runId).some(event=>event.stage==='candidate_fallback'));
  }
});

test('another park has isolated bindings and a late model cannot overwrite newer human-requested advice',async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let held=false;
  const f=fixture(t,{onGenerate:async args=>{if(!held&&args.context.siteId==='demo-xsbn'&&args.kind==='tapping_angle'){held=true;entered();await gate;}}});
  const hainan=await f.publishRule('T-0004'),work=f.prepare({siteId:'demo-xsbn'});
  try {
    await started;
    const pending=f.current('T-0004','tapping_angle','demo-xsbn');assert.equal(pending.status,'running');
    assert.equal(f.current('T-0004').runId,hainan.runId);
    const manual=await f.publishRule('T-0004','tapping_angle','demo-xsbn');
    release();await work;
    assert.equal(f.current('T-0004','tapping_angle','demo-xsbn').runId,manual.runId);
    assert.equal(f.store.getRun(pending.runId).result.strategy.provenance.mode,'estimated','late result remains in audit history');
    assert.equal(f.current('T-0004').runId,hainan.runId);
    assert.ok(f.calls.every(call=>call.siteId==='demo-xsbn'));
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM simulation_actions').get().n,0);
    assert.deepEqual(f.simulation.latestTasks(),[]);
  } finally {release();await work;}
});

test('offline snapshot preparation keeps complex examples in explicit rules mode without provider requests',async t=>{
  const f=fixture(t),result=await f.prepare({modelsEnabled:false});
  assert.equal(f.calls.length,0);assert.equal(result.modelRequests,0);
  for(const kind of kinds)assert.equal(f.current('T-0004',kind).request.generatorMode,'demo_rules');
});

for(const newerManual of [false,true])test(`withdrawing the previously displayed rule while the model is running ${newerManual?'does not replace a newer manual view':'keeps the withdrawal authoritative'}`,async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let held=false;
  const f=fixture(t,{onGenerate:async args=>{if(!held&&args.kind==='tapping_angle'){held=true;entered();await gate;}}});
  const previous=await f.publishRule('T-0004'),work=f.prepare();
  try {
    await started;
    const pending=f.current('T-0004');assert.equal(pending.status,'running');assert.notEqual(pending.runId,previous.runId);
    f.store.withdrawStrategy(previous.runId,'人工核查发现旧建议不适用，停止自动替换',f.clock().toISOString());
    const manual=newerManual?await f.publishRule('T-0004'):null;
    release();await work;
    const visible=f.current('T-0004');
    assert.equal(visible.runId,manual?.runId??previous.runId);
    assert.equal(visible.result.strategy.qualityReview.status,newerManual?'pending':'withdrawn');
    assert.equal(f.store.getRun(pending.runId).status,'succeeded','background result remains saved for audit');
    assert.equal(f.store.getRun(previous.runId).result.strategy.qualityReview.status,'withdrawn');
    f.store.publishAutomaticTreeViews(pending.runId);
    assert.equal(f.current('T-0004').runId,manual?.runId??previous.runId,'recovery cannot republish over a human withdrawal or a newer manual view');
    assert.equal(f.current('T-0004').result.strategy.qualityReview.status,newerManual?'pending':'withdrawn');
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM simulation_actions').get().n,0);
  } finally {release();await work;}
});
