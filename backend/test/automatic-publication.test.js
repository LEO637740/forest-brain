import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { createMhApp } from '../src/mh-app.js';
import { Store } from '../src/store.js';
import { AutomaticRunner } from '../src/automatic.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { makeMixedContext } from '../src/adapters/public-context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { AppError } from '../src/errors.js';

const NOW=new Date('2026-10-07T02:00:00Z'),HOUR=3600000;
const config={enabled:true,intervalMinutes:60,maxRunsPer24Hours:6,maxModelRequestsPer24Hours:12,maxRequestsPerRun:2,maxConsecutiveFailures:2,
  jobs:[{id:'tree',kind:'surface_action',treeIds:['T-0012']}]};
const sources=()=>({refreshes:0,async refresh(){this.refreshes++;},status:()=>({location:{confirmed:false},sources:[]})});
const model=()=>({mode:'llm',modelVersion:'offline-publication-fixture',calls:0,describe:()=>({configured:true}),async generate(args){
  args.onEvent('llm_request',{attempt:1});this.calls++;return new RuleGenerator().generate(args);
}});
const request=(context,id,kind='surface_action',generatorMode='configured')=>({requestId:id,kind,generatorMode,siteId:context.siteId,
  targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'});
async function setup({generator=model(),settings=config,dataMode='mixed_demo'}={}) {
  let now=NOW;const service=sources();
  const app=createApp({dbPath:':memory:',generator,publicDataService:service,automaticConfig:settings,automaticDataMode:dataMode,clock:()=>now});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  return {app,service,generator,advance(ms){now=new Date(+now+ms);},
    async view(treeId='T-0012',kind='surface_action',mode='mixed_demo'){return (await fetch(`${base}/api/demo/trees/${treeId}/view?kind=${kind}&dataMode=${mode}`)).json();}};
}

test('automatic publication: demo mode stays in demo tree/industry views and never refreshes public sources',async()=>{
  const f=await setup({dataMode:'demo',settings:{...config,jobs:[...config.jobs,{id:'industry',kind:'industry_brief',treeIds:[]}]}});try{
    await f.app.automatic.tick();
    assert.equal(f.app.automatic.status().dataMode,'demo');assert.equal(f.service.refreshes,0);assert.equal(f.generator.calls,2);
    assert.equal((await f.view('T-0012','surface_action','demo')).strategyStatus,'available');
    assert.equal((await f.view()).strategyStatus,'needs_generation');
    const industry=f.app.store.listRuns({kind:'industry_brief',dataMode:'demo'}).items;
    assert.equal(industry.length,1);assert.equal(industry[0].status,'succeeded');assert.equal(industry[0].result.strategy.dataPolicy.mode,'demo');
    assert.equal(f.app.store.listRuns({kind:'industry_brief',dataMode:'mixed_demo'}).items.length,0);
  }finally{await f.app.close();}
});

test('automatic publication: model results appear in read-only single-tree views, with withdrawal and expiry',async()=>{
  const f=await setup();try{
    await f.app.automatic.tick();
    const run=f.app.store.automaticRuns()[0],count=f.app.store.listRuns().items.length;
    assert.equal(run.request.generatorMode,'configured');
    const view=await f.view();assert.equal(view.strategyStatus,'available');assert.equal(view.run.runId,run.runId);
    assert.equal(view.strategy.strategyId,run.result.strategy.strategyId);assert.equal(view.dataPolicy.mode,'mixed_demo');
    assert.equal(f.generator.calls,1);await f.view();assert.equal(f.app.store.listRuns().items.length,count,'GET cannot submit another run');
    f.app.store.withdrawStrategy(run.runId,'offline regression',NOW.toISOString());
    assert.equal((await f.view()).strategyStatus,'withdrawn');assert.equal((await f.view()).strategy,null);
    f.advance(HOUR);await f.app.automatic.tick();assert.equal((await f.view()).strategyStatus,'available');
    f.advance(2*HOUR);assert.equal((await f.view()).strategyStatus,'expired');assert.equal((await f.view()).strategy,null);
  }finally{await f.app.close();}
});

test('automatic publication: later model failure publishes a labelled fallback and preserves the failure audit',async()=>{
  const generator=model(),generate=generator.generate;
  generator.generate=async function(args){if(this.calls){args.onEvent('llm_request',{});this.calls++;throw new AppError('CANDIDATE_SERVICE_UNAVAILABLE','offline failure',503);}return generate.call(this,args);};
  const f=await setup({generator});try{
    await f.app.automatic.tick();const first=(await f.view()).run.runId;
    f.advance(HOUR);await f.app.automatic.tick();const view=await f.view();
    assert.equal(view.strategyStatus,'available');assert.notEqual(view.run.runId,first);
    assert.equal(view.strategy.fallback.reasonCode,'CANDIDATE_SERVICE_UNAVAILABLE');assert.equal(view.strategy.fallback.reviewRequired,true);assert.equal(generator.calls,2);
    assert.equal(view.strategy.provenance.mode,'simulated');assert.equal(view.strategy.generationMetadata.provider,'harness-fallback');
    assert.ok(f.app.store.events(view.run.runId).some(e=>e.stage==='candidate_fallback'&&e.data.reasonCode==='CANDIDATE_SERVICE_UNAVAILABLE'));
    assert.equal(f.app.automatic.status().lastError.code,'CANDIDATE_SERVICE_UNAVAILABLE');
  }finally{await f.app.close();}
});

test('automatic publication: missing-data trees expose needs_data without a provider request; angle jobs cannot bind multiple trees',async()=>{
  const f=await setup({settings:{...config,jobs:[{id:'angle',kind:'tapping_angle',treeIds:['T-0042']}]}});try{
    await f.app.automatic.tick();const view=await f.view('T-0042','tapping_angle');
    assert.equal(view.strategyStatus,'needs_data');assert.equal(view.strategy,null);assert.equal(f.generator.calls,0);
    assert.ok(view.missingData.some(item=>item.field==='circumferenceCm'));
    assert.throws(()=>new AutomaticRunner({store:f.app.store,runtime:f.app.runtime,service:f.service,
      config:{...config,jobs:[{id:'angle',kind:'tapping_angle',treeIds:['T-0001','T-0012']}]}}),error=>error.code==='INVALID_CONFIG');
  }finally{await f.app.close();}
});

test('automatic publication: a slow older model never overwrites a newer manual binding',async()=>{
  let release,started;const hold=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
  const generator=model(),generate=generator.generate;
  generator.generate=async function(args){const first=this.calls===0;const candidate=await generate.call(this,args);if(first){started();await hold;}return candidate;};
  const f=await setup({generator});try{
    const cycle=f.app.automatic.tick();await entered;
    assert.equal((await f.view()).strategyStatus,'pending');
    const context=makeMixedContext({treeIds:['T-0012'],service:f.service,now:NOW});f.app.store.saveContext(context);
    const accepted=f.app.runtime.submit(request(context,'newer-manual'));
    f.app.store.bindTreeView({treeId:'T-0012',kind:'surface_action',dataMode:'mixed_demo',preparationId:'newer-manual',requestId:accepted.requestId,
      runId:accepted.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
    release();await cycle;await f.app.runtime.idle();
    assert.equal((await f.view()).run.runId,accepted.runId);assert.equal((await f.view()).strategyStatus,'available');
    const older=f.app.store.automaticRuns()[0];
    f.app.store.transaction(()=>f.app.store.publishAutomaticTreeViews(older.runId));
    assert.equal((await f.view()).run.runId,accepted.runId,'legacy repair and retry publication cannot move the index backward');
  }finally{release();await f.app.close();}
});

test('automatic publication: model pause allows data refresh and small-brain work but blocks all paid jobs',async()=>{
  const f=await setup({settings:{...config,jobs:[...config.jobs,{id:'simple',kind:'surface_action',treeIds:['T-0001']}]}});let release;try{
    f.app.store.setModelPaused(true,NOW.toISOString());await f.app.automatic.tick();
    assert.equal(f.service.refreshes,1);assert.equal(f.generator.calls,0);assert.equal(f.app.automatic.status().status,'model_paused');
    assert.equal((await f.view('T-0001')).strategyStatus,'available');
    assert.equal(f.app.store.automaticRuns().length,1);assert.equal(f.app.store.automaticRuns()[0].request.generatorMode,'demo_rules');
    let started;const entered=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
    f.service.refresh=async()=>{f.service.refreshes++;started();await hold;};
    f.advance(HOUR);f.app.store.setModelPaused(false,NOW.toISOString());const cycle=f.app.automatic.tick();await entered;
    f.app.store.setModelPaused(true,NOW.toISOString());release();await cycle;
    assert.equal(f.generator.calls,0);assert.equal(f.app.store.automaticRuns().length,2);
    assert.equal(f.app.store.getTreeViewBinding('T-0012','surface_action','mixed_demo'),null);
    assert.equal(f.app.store.automaticBudget(NOW.toISOString()).modelRequests,0);
  }finally{release?.();await f.app.close();}
});

test('MH startup: explicit automatic startup resumes persisted model queues and ordinary scheduler pause',async()=>{
  for(const paused of [true,false]){
    const path=join(mkdtempSync(join(tmpdir(),'rubber-mh-startup-')),'test.sqlite'),before=new Store(path),service=sources();
    const context=makeMixedContext({treeIds:['T-0012'],service,now:NOW});before.saveContext(context);
    before.setModelPaused(paused,NOW.toISOString());before.saveAutomaticState({paused:true});const queued=before.submit(request(context,'queued-before-restart'),NOW.toISOString()).run;before.close();
    const generator=model(),app=createMhApp({dbPath:path,generator,automaticConfig:config,enableAutomatic:true,publicDataService:service,clock:()=>NOW});
    try{
      await app.runtime.idle();assert.equal(app.store.getModelControl().paused,false);assert.equal(app.automatic.status().status,'waiting');
      assert.equal(generator.calls,1);assert.equal(service.refreshes,0);assert.equal(app.store.getRun(queued.runId).status,'succeeded');
      await app.automatic.tick();assert.equal(generator.calls,2);assert.equal(service.refreshes,1);
    }finally{await app.close();}
  }
});

test('MH startup: disabling automatic scheduling leaves persisted model controls unchanged',async()=>{
  for(const paused of [true,false]){
    const path=join(mkdtempSync(join(tmpdir(),'rubber-mh-manual-')),'test.sqlite'),before=new Store(path);
    before.setModelPaused(paused,NOW.toISOString());before.close();
    const generator=model(),app=createMhApp({dbPath:path,generator,automaticConfig:config,enableAutomatic:false,publicDataService:sources(),clock:()=>NOW});
    try{assert.equal(app.store.getModelControl().paused,paused);await app.automatic.tick();assert.equal(app.automatic.status().status,'disabled');assert.equal(generator.calls,0);}finally{await app.close();}
  }
});

test('MH startup: automatic opt-in cannot clear an account fault or consumed request budget',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-mh-circuit-')),'test.sqlite'),before=new Store(path),service=sources();
  const context=makeMixedContext({treeIds:['T-0012'],service,now:NOW});before.saveContext(context);
  const queued=before.submit(request(context,'automatic-before-restart'),NOW.toISOString(),{...config,jobId:'tree',cycleKey:'before-restart'}).run;
  before.reserveAutomaticRequest(queued.runId,NOW.toISOString());
  before.saveAutomaticState({paused:true,consecutiveFailures:1,circuitReason:{code:'LLM_ACCOUNT_UNAVAILABLE',message:'fixture account fault'}});before.close();
  const generator=model(),app=createMhApp({dbPath:path,generator,automaticConfig:config,enableAutomatic:true,publicDataService:service,clock:()=>NOW});
  try{
    await app.runtime.idle();await app.automatic.tick();assert.equal(generator.calls,0);assert.equal(service.refreshes,0);
    assert.equal(app.automatic.status().status,'error_paused');assert.equal(app.automatic.status().circuitReason.code,'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(app.automatic.status().consecutiveFailures,1);assert.equal(app.automatic.status().budget.modelRequests,1);
    app.automatic.setPaused(false);await app.automatic.tick();assert.equal(generator.calls,1);assert.equal(app.automatic.status().budget.modelRequests,2);
  }finally{await app.close();}
});

test('automatic publication: multi-tree surface output publishes each target in the same transaction',async()=>{
  const store=new Store(),service=sources(),context=makeMixedContext({treeIds:['T-0001','T-0012'],service,now:NOW});
  store.saveContext(context);
  try{
    const {run}=store.submit(request(context,'atomic-tree-index'),NOW.toISOString(),{...config,jobId:'tree',cycleKey:'atomic'});
    for(const treeId of context.targetSnapshot.treeIds)assert.equal(store.getTreeViewBinding(treeId,'surface_action','mixed_demo').runId,run.runId);
    assert.equal(store.getRun(run.runId).status,'queued');
    const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator:model(),clock:()=>NOW});
    const automatic=new AutomaticRunner({store,runtime,service,config,clock:()=>NOW});
    await automatic.stop();await runtime.stop();
    for(const treeId of context.targetSnapshot.treeIds)assert.equal(store.getTreeViewBinding(treeId,'surface_action','mixed_demo').runId,run.runId);
  }finally{store.close();}
});

test('automatic publication: a version-two input is read from its exact frozen version',async()=>{
  const f=await setup();try{
    const first=makeMixedContext({treeIds:['T-0012'],service:f.service,now:NOW});f.app.store.saveContext(first);
    const second=structuredClone(first);second.version=2;second.modules.trees[0].circumferenceCm=77.7;f.app.store.saveContext(second);
    const accepted=f.app.runtime.submit(request(second,'version-two-auto'),{...config,jobId:'tree',cycleKey:'version-two'});
    await f.app.runtime.idle();const view=await f.view();
    assert.equal(view.strategyStatus,'available');assert.equal(view.run.runId,accepted.runId);assert.equal(view.tree.circumferenceCm,77.7);
    assert.equal(view.strategy.inputSnapshot.version,2);assert.equal(f.app.store.getContext(first.snapshotId,1).modules.trees[0].circumferenceCm,first.modules.trees[0].circumferenceCm);
    await f.view();assert.equal(f.generator.calls,1);
  }finally{await f.app.close();}
});
