import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { AutomaticRunner } from '../src/automatic.js';
import { LocalContextProvider, makeDemoContext } from '../src/adapters/context.js';
import { makeMixedContext } from '../src/adapters/public-context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { AppError } from '../src/errors.js';

const HOUR=3600000,DAY=24*HOUR,NOW=new Date('2026-10-02T08:00:00Z');
const config={enabled:true,intervalMinutes:60,maxRunsPer24Hours:6,maxModelRequestsPer24Hours:12,maxRequestsPerRun:2,maxConsecutiveFailures:2,jobs:[{id:'tree',kind:'surface_action',treeIds:['T-0012']}]};
const service=()=>({refreshes:0,async refresh(){this.refreshes++;},status:()=>({location:{confirmed:false},sources:[]})});
const request=(context,id,kind='surface_action')=>({requestId:id,kind,siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'});
const model=(errors=[])=>({mode:'llm',modelVersion:'offline-workflow-fixture',calls:0,describe:()=>({configured:true}),async generate(args){
  args.onEvent('llm_request',{attempt:1});this.calls++;
  const code=errors[this.calls-1];if(code)throw new AppError(code,'本地测试错误',503);
  return new RuleGenerator().generate(args);
}});
function setup({path,outputDirectory,now=NOW,generator=model(),settings=config}={}) {
  let current=new Date(now);const store=new Store(path),sources=service();
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator,clock:()=>current});
  const auto=new AutomaticRunner({store,runtime,service:sources,config:settings,clock:()=>current,outputDirectory});runtime.start();
  return{store,runtime,auto,generator,sources,advance(ms){current=new Date(+current+ms);},async close(){await auto.stop();await runtime.stop();store.close();}};
}
function seedRun(store,{id='orphan',now=NOW,context,requests=0,requestAt=now,status='running',settings=config}={}) {
  context??=makeMixedContext({treeIds:['T-0012'],service:service(),now});store.saveContext(context);
  const run=store.submit(request(context,id),now.toISOString(),{...settings,jobId:'tree',cycleKey:id}).run;
  store.start(run.runId,now.toISOString());
  for(let i=0;i<requests;i++)store.reserveAutomaticRequest(run.runId,requestAt.toISOString());
  if(status==='needs_data')store.finish(run.runId,{runId:run.runId,requestId:id,status,updatedAt:requestAt.toISOString(),missingData:[{module:'inspection',field:'evidence',objectId:'T-0012',reason:'离线恢复测试'}]});
  return run;
}

test('workflow: retrying a persisted failure archives each attempt without overwriting the first failure',async()=>{
  const outputDirectory=mkdtempSync(join(tmpdir(),'rubber-retry-archives-'));
  const path=join(outputDirectory,'test.sqlite'),before=new Store(path),seed=seedRun(before,{requests:1});
  before.stage(seed.runId,'candidate_fallback',NOW.toISOString(),{reasonCode:'CANDIDATE_SERVICE_UNAVAILABLE',message:'previous attempt provider fault'});
  before.finish(seed.runId,{runId:seed.runId,requestId:seed.requestId,status:'failed',updatedAt:NOW.toISOString(),error:{code:'CANDIDATE_SERVICE_UNAVAILABLE',message:'persisted failure before fallback support',retryable:true}});before.close();
  const f=setup({path,outputDirectory,generator:model()});
  try{
    const first=f.store.automaticRuns()[0];assert.equal(first.status,'failed');
    const firstPath=join(outputDirectory,`${first.runId}.json`),original=readFileSync(firstPath,'utf8');
    assert.equal(JSON.parse(original).attempt,1);assert.equal(f.auto.status().consecutiveFailures,1);
    f.runtime.retry(first.runId);await f.runtime.idle();const second=f.store.getRun(first.runId);
    assert.equal(second.status,'succeeded');assert.equal(second.attempt,2);assert.equal(f.generator.calls,1);
    assert.equal(f.auto.status().budget.modelRequests,2);assert.equal(f.auto.status().consecutiveFailures,0);
    const retried=JSON.parse(readFileSync(join(outputDirectory,`${first.runId}-attempt-2.json`),'utf8'));
    assert.equal(retried.attempt,2);assert.deepEqual(retried.result,second.result);assert.equal(retried.result.status,'succeeded');
    assert.equal(readFileSync(firstPath,'utf8'),original,'first attempt remains immutable');
    f.auto.finalizeRun(second);f.auto.finalizeRun(second);
    assert.deepEqual(f.store.events(first.runId).filter(e=>e.stage==='automatic_finished').map(e=>e.data.attempt),[1,2]);
  }finally{await f.close();}
});

test('workflow: recovered account failure opens the circuit and archives exactly once',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'rubber-recovered-account-')),path=join(directory,'test.sqlite');
  const before=new Store(path),run=seedRun(before,{requests:1});
  before.saveAutomaticState({...before.getAutomaticState(),lastStartedAt:NOW.toISOString(),terminalBookkeepingVersion:1});before.close();
  const f=setup({path,outputDirectory:directory,generator:model(['LLM_ACCOUNT_UNAVAILABLE'])});
  try{
    await f.runtime.idle();const result=f.store.getRun(run.runId);
    assert.equal(result.status,'succeeded');assert.equal(result.result.strategy.fallback.reasonCode,'LLM_ACCOUNT_UNAVAILABLE');assert.equal(result.attempt,2);assert.equal(f.generator.calls,1);
    assert.equal(f.auto.status().status,'error_paused');assert.equal(f.auto.status().circuitReason.code,'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(f.auto.status().budget.modelRequests,2);assert.equal(f.auto.status().consecutiveFailures,1);
    f.auto.finalizeRun(result);assert.equal(f.auto.status().consecutiveFailures,1);
    assert.equal(f.store.events(run.runId).filter(e=>e.stage==='automatic_finished').length,1);
    const archived=JSON.parse(readFileSync(join(directory,`${run.runId}-attempt-2.json`),'utf8'));
    assert.equal(archived.result.strategy.fallback.reasonCode,'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(archived.result.strategy.fallback.reviewRequired,true);
    f.advance(HOUR);await f.auto.tick();assert.equal(f.generator.calls,1,'account failure does not trigger another cycle');
  }finally{await f.close();}
});

test('workflow: recovered run cannot spend a third request after two pre-crash reservations',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'rubber-recovered-budget-')),path=join(directory,'test.sqlite');
  const before=new Store(path),run=seedRun(before,{requests:2});before.close();
  const f=setup({path});try{
    await f.runtime.idle();assert.equal(f.generator.calls,0);
    assert.equal(f.store.getRun(run.runId).result.error.code,'AUTO_BUDGET_EXHAUSTED');
    assert.equal(f.auto.status().budget.modelRequests,2);
    assert.equal(f.store.events(run.runId).filter(e=>e.stage==='automatic_finished').length,1);
  }finally{await f.close();}
});

test('workflow: recovery honours a persisted pause and archives needs_data without any model request',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'rubber-recovered-stale-')),path=join(directory,'test.sqlite');
  const before=new Store(path),context=makeMixedContext({treeIds:['T-0012'],service:service(),now:NOW});
  context.validUntil=new Date(+NOW+HOUR/2).toISOString();const run=seedRun(before,{context});
  before.saveAutomaticState({paused:true,configuredEnabled:true});before.close();
  const f=setup({path,outputDirectory:directory,now:new Date(+NOW+HOUR)});try{
    await f.runtime.idle();assert.equal(f.generator.calls,0);assert.equal(f.auto.status().status,'paused');
    assert.equal(f.store.getRun(run.runId).status,'needs_data');
    assert.equal(JSON.parse(readFileSync(join(directory,`${run.runId}-attempt-2.json`),'utf8')).result.status,'needs_data');
  }finally{await f.close();}
});

test('workflow: restart does not erase six analyses or nine requests; only the rolling boundary restores capacity',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-rolling-runs-')),'test.sqlite'),before=new Store(path);
  for(let i=0;i<6;i++)seedRun(before,{id:`seed-${i}`,requests:i<3?2:1,status:'needs_data'});
  before.saveAutomaticState({paused:true,configuredEnabled:true,lastStartedAt:NOW.toISOString(),lastFinishedAt:NOW.toISOString()});before.close();
  const f=setup({path,now:new Date(+NOW+HOUR)});try{
    assert.equal(f.auto.status().budget.runs,6);assert.equal(f.auto.status().budget.modelRequests,9);
    f.auto.setPaused(false);await f.auto.tick();assert.equal(f.auto.status().status,'budget_wait');assert.equal(f.generator.calls,0);
    f.advance(23*HOUR-1);await f.auto.tick();assert.equal(f.generator.calls,0);
    f.advance(1);await f.auto.tick();assert.equal(f.generator.calls,1);
    assert.equal(f.auto.status().budget.runs,1);assert.equal(f.auto.status().budget.modelRequests,1);
  }finally{await f.close();}
});

test('workflow: request reservations outlive the run window and still block a new cycle',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-rolling-calls-')),'test.sqlite'),before=new Store(path);
  for(let i=0;i<6;i++)seedRun(before,{id:`late-request-${i}`,requests:2,requestAt:new Date(+NOW+HOUR),status:'needs_data'});
  before.close();const f=setup({path,now:new Date(+NOW+DAY)});try{
    assert.equal(f.auto.status().budget.runs,0);assert.equal(f.auto.status().budget.modelRequests,12);
    await f.auto.tick();assert.equal(f.generator.calls,0);assert.equal(f.auto.status().status,'budget_wait');
    f.advance(HOUR-1);await f.auto.tick();assert.equal(f.generator.calls,0);
    f.advance(1);await f.auto.tick();assert.equal(f.generator.calls,1);assert.equal(f.auto.status().budget.modelRequests,1);
  }finally{await f.close();}
});

test('workflow: a recovered in-flight run completes before a new automatic cycle can be submitted',async()=>{
  let release;const held=new Promise(resolve=>release=resolve),generator=model();
  const generate=generator.generate;generator.generate=async function(args){await held;return generate.call(this,args);};
  const path=join(mkdtempSync(join(tmpdir(),'rubber-recovery-order-')),'test.sqlite'),before=new Store(path);seedRun(before);before.close();
  const f=setup({path,generator});try{
    await new Promise(resolve=>setImmediate(resolve));assert.equal(f.auto.status().status,'running');
    await f.auto.tick();assert.equal(f.sources.refreshes,0);assert.equal(f.auto.status().budget.runs,1);
    release();await f.runtime.idle();assert.equal(generator.calls,1);
  }finally{release();await f.close();}
});

test('workflow: terminal result committed before a crash is finalized even at the previous completion timestamp',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-terminal-crash-')),'test.sqlite');let f=setup({path});
  await f.auto.tick();const unfinished=seedRun(f.store,{id:'committed-before-hook'});
  f.store.finish(unfinished.runId,{runId:unfinished.runId,requestId:'committed-before-hook',status:'failed',updatedAt:NOW.toISOString(),error:{code:'LLM_ACCOUNT_UNAVAILABLE',message:'离线账户错误',retryable:false}});
  await f.close();f=setup({path});try{
    assert.equal(f.auto.status().status,'error_paused');assert.equal(f.auto.status().circuitReason.code,'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(f.store.events(unfinished.runId).filter(e=>e.stage==='automatic_finished').length,1);assert.equal(f.generator.calls,0);
  }finally{await f.close();}
});

for(const [kind,modify] of [
  ['surface_action',c=>{c.modules.inspection.evidence[0].capturedAt=new Date(+NOW-DAY+30000).toISOString();}],
  ['pest_risk',c=>{for(const r of c.modules.health.records)r.observedAt=new Date(+NOW-7*DAY+30000).toISOString();}],
  ['market_scenario',c=>{c.modules.market.prices=[{...c.modules.market.prices.at(-1),observedAt:new Date(+NOW-7*DAY+30000).toISOString()}];}],
  ['weather_window',c=>{c.modules.weather.forecast.issuedAt=new Date(+NOW-2*HOUR+30000).toISOString();c.modules.weather.forecast.issuedAtBasis='retrieved';}],
])test(`workflow: ${kind} strategy cannot outlive implicit evidence lifetime`,async()=>{
  const store=new Store(),context=makeDemoContext({treeIds:['T-0012'],now:NOW});modify(context);store.saveContext(context);
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock:()=>NOW});
  try{
    const accepted=runtime.submit(request(context,`expiry-${kind}`,kind));await runtime.idle();const result=store.getRun(accepted.runId).result;
    assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.strategy.expiresAt,new Date(+NOW+30000).toISOString());
  }finally{await runtime.stop();store.close();}
});

test('workflow: reaching the implicit image deadline during generation publishes no usable strategy',async()=>{
  let now=NOW;const store=new Store(),context=makeDemoContext({treeIds:['T-0012'],now:NOW});
  context.modules.inspection.evidence[0].capturedAt=new Date(+NOW-DAY+30000).toISOString();store.saveContext(context);
  const generator={mode:'demo_rules',modelVersion:null,async generate(args){const candidate=await new RuleGenerator().generate(args);now=new Date(+NOW+30000);return candidate;}};
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator,clock:()=>now});
  try{const accepted=runtime.submit(request(context,'expiry-at-publish'));await runtime.idle();const result=store.getRun(accepted.runId).result;assert.equal(result.status,'needs_data');assert.equal(result.strategy,undefined);}
  finally{await runtime.stop();store.close();}
});
