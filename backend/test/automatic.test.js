import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { AutomaticRunner } from '../src/automatic.js';
import { AppError } from '../src/errors.js';
import { createApp } from '../src/server.js';
const config={enabled:true,intervalMinutes:60,maxRunsPer24Hours:4,maxModelRequestsPer24Hours:8,maxRequestsPerRun:2,maxConsecutiveFailures:2,jobs:[{id:'tree',kind:'surface_action',treeIds:['T-0012']},{id:'industry',kind:'industry_brief',treeIds:[]}]};
const start=new Date('2026-10-01T09:00:00Z');
function service(){return {refreshes:0,async refresh(){this.refreshes++;},status:()=>({location:{confirmed:false},sources:[]})};}
function model({fail=false,errorCode='LLM_ACCOUNT_UNAVAILABLE',attempts=1,hold}={}){return {mode:'llm',modelVersion:'automatic-test-model',calls:0,describe:()=>({configured:true}),async generate(args){
  for(let i=0;i<attempts;i++){args.onEvent('llm_request',{attempt:i+1});this.calls++;}
  if(hold)await hold;if(fail)throw new AppError(errorCode,'模拟服务故障',502);
  if(args.kind!=='industry_brief')return new RuleGenerator().generate(args);
  const ref=args.context.modules.industry.records[0].observationId;
  return {summary:'模拟行业研判',reasons:[{text:'模拟生产记录',sourceRefs:[ref]}],evidenceRefs:[ref],proposal:{horizon:{start:args.now.toISOString(),end:new Date(+args.now+86400000).toISOString()},findings:[{topic:'production',assessment:'演示产量',sourceRefs:[ref],limitation:'模拟记录'}],recommendations:[{priority:'medium',action:'复核批次',reason:'模拟记录需复核',sourceRefs:[ref]}],missingData:args.context.modules.industry.gaps,uncertainty:'演示假设',reviewRequired:true}};
}};}
function candidateServiceModel(){return {mode:'candidate_service',modelVersion:'candidate-test-model',calls:0,describe:()=>({configured:true}),async generate(args){
  this.calls++;args.onEvent('candidate_request',{provider:'candidate_service',model:this.modelVersion,attempt:1});
  const candidate=await new RuleGenerator().generate(args);args.onEvent('candidate_completed',{provider:'candidate_service',model:this.modelVersion,attempts:1});return candidate;
}};}
function setup(options={}){let now=new Date(start);const store=new Store(options.path),sources=service(),generator=options.generator??model();const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator,clock:()=>now});const auto=new AutomaticRunner({store,runtime,service:sources,config:options.config??config,clock:()=>now,outputDirectory:options.outputDirectory});runtime.start();return {store,runtime,sources,generator,auto,advance:ms=>{now=new Date(+now+ms)},async close(){await auto.stop();await runtime.stop();store.close();}};}

test('automatic: collect → mixed context → model → validated strategy; no duplicate cycle and persistent rolling caps',async()=>{
  const outputDirectory=mkdtempSync(join(tmpdir(),'rubber-auto-archive-'));const f=setup({outputDirectory});try{
    await Promise.all([f.auto.tick(),f.auto.tick(),f.auto.tick()]);
    assert.equal(f.sources.refreshes,1);assert.equal(f.generator.calls,2);assert.equal(f.auto.status().runs.length,2);
    for(const run of f.store.automaticRuns()){
      assert.equal(run.status,'succeeded');assert.equal(run.request.trigger.type,'scheduled');assert.equal(run.result.strategy.dataPolicy.mode,'mixed_demo');
      const saved=JSON.parse(readFileSync(join(outputDirectory,`${run.runId}.json`),'utf8'));assert.deepEqual(saved.result,run.result);assert.equal(saved.context.dataPolicy.mode,'mixed_demo');assert.ok(saved.events.some(e=>e.stage==='llm_request'));
    }
    await f.auto.tick();assert.equal(f.generator.calls,2);
    f.advance(3600000);await f.auto.tick();assert.equal(f.generator.calls,4);assert.equal(f.auto.status().status,'budget_wait');
    f.advance(3600000);await f.auto.tick();assert.equal(f.generator.calls,4);
    f.advance(22*3600000);await f.auto.tick();assert.equal(f.generator.calls,6,'old reservations expire at rolling 24h boundary');
  }finally{await f.close();}
});
test('automatic: configured candidate service is schedulable and reserves model budget',async()=>{
  const f=setup({generator:candidateServiceModel(),config:{...config,maxModelRequestsPer24Hours:1}});try{
    await f.auto.tick();
    assert.equal(f.generator.calls,1);
    assert.equal(f.auto.status().runs.length,1,'the second job waits for the per-day request cap');
    assert.equal(f.auto.status().budget.modelRequests,1);
    assert.equal(f.store.automaticRuns()[0].result.strategy.provenance.mode,'estimated');
    assert.ok(f.store.events(f.store.automaticRuns()[0].runId).some(e=>e.stage==='candidate_request'));
  }finally{await f.close();}
});
test('automatic: repairs count toward request cap; pause/resume does not reset budget',async()=>{
  const f=setup({generator:model({attempts:2}),config:{...config,maxRunsPer24Hours:8,maxModelRequestsPer24Hours:4}});try{
    await f.auto.tick();assert.equal(f.generator.calls,4);assert.equal(f.auto.status().budget.modelRequests,4);
    f.auto.setPaused(true);f.advance(3600000);f.auto.setPaused(false);await f.auto.tick();assert.equal(f.generator.calls,4);assert.equal(f.auto.status().status,'budget_wait');
  }finally{await f.close();}
});
test('automatic: account errors open circuit and do not try the second job or retry silently',async()=>{
  const f=setup({generator:model({fail:true})});try{
    await f.auto.tick();assert.equal(f.generator.calls,1);assert.equal(f.auto.status().status,'error_paused');assert.equal(f.auto.status().circuitReason.code,'LLM_ACCOUNT_UNAVAILABLE');
    const run=f.store.automaticRuns()[0];assert.equal(run.status,'succeeded');assert.equal(run.result.strategy.fallback.reasonCode,'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(run.result.strategy.fallback.reviewRequired,true);assert.equal(f.auto.status().lastError.code,'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(f.auto.status().lastResultStatus,'succeeded');assert.equal(f.auto.status().budget.modelRequests,1);
    f.auto.finalizeRun(run);assert.equal(f.auto.status().consecutiveFailures,1);
    f.advance(3600000);await f.auto.tick();assert.equal(f.generator.calls,1);
  }finally{await f.close();}
});

for(const errorCode of ['LLM_NOT_CONFIGURED','LLM_REQUEST_REJECTED'])test(`automatic: ${errorCode} fallback stops the remaining model queue`,async()=>{
  const f=setup({generator:model({fail:true,errorCode})});try{
    await f.auto.tick();assert.equal(f.generator.calls,1);assert.equal(f.auto.status().circuitReason.code,errorCode);
    assert.equal(f.store.automaticRuns()[0].result.strategy.fallback.reasonCode,errorCode);
  }finally{await f.close();}
});

test('automatic: rule success between provider fallbacks cannot clear the consecutive-failure circuit',async()=>{
  const jobs=[config.jobs[0],{id:'simple',kind:'surface_action',treeIds:['T-0001']},config.jobs[1],{id:'extra',kind:'surface_action',treeIds:['T-0004']}];
  const f=setup({generator:model({fail:true,errorCode:'CANDIDATE_SERVICE_UNAVAILABLE'}),config:{...config,jobs}});try{
    await f.auto.tick();assert.equal(f.generator.calls,2);assert.equal(f.auto.status().status,'error_paused');
    assert.equal(f.auto.status().consecutiveFailures,2);assert.equal(f.auto.status().budget.modelRequests,2);
    assert.equal(f.store.automaticRuns().length,3);assert.ok(f.store.automaticRuns().some(r=>r.request.generatorMode==='demo_rules'&&r.status==='succeeded'));
    f.advance(3600000);await f.auto.tick();assert.equal(f.generator.calls,2);
  }finally{await f.close();}
});

test('automatic: candidate-content fallback is reviewable and does not trip the provider fault circuit',async()=>{
  const f=setup({generator:model({fail:true,errorCode:'LLM_INCOMPLETE'})});try{
    await f.auto.tick();assert.equal(f.generator.calls,2);assert.equal(f.auto.status().consecutiveFailures,0);
    assert.equal(f.auto.status().circuitReason,undefined);
    for(const run of f.store.automaticRuns())assert.equal(run.result.strategy.fallback.reasonCode,'LLM_INCOMPLETE');
  }finally{await f.close();}
});

test('automatic: account failure still opens the circuit when fallback input expires before publication',async()=>{
  const generator=model(),f=setup({generator});
  generator.generate=async function(args){args.onEvent('llm_request',{});this.calls++;f.advance(3*3600000);throw new AppError('LLM_ACCOUNT_UNAVAILABLE','delayed account fault',502);};
  try{
    await f.auto.tick();const run=f.store.automaticRuns()[0];
    assert.equal(run.status,'needs_data');assert.equal(run.result.strategy,undefined);
    assert.ok(f.store.events(run.runId).some(e=>e.stage==='candidate_fallback'&&e.data.reasonCode==='LLM_ACCOUNT_UNAVAILABLE'));
    assert.equal(f.auto.status().circuitReason.code,'LLM_ACCOUNT_UNAVAILABLE');assert.equal(f.generator.calls,1);
    assert.equal(f.auto.status().lastResultStatus,'needs_data');assert.equal(f.auto.status().budget.modelRequests,1);
    f.auto.finalizeRun(run);assert.equal(f.auto.status().consecutiveFailures,1);
  }finally{await f.close();}
});
test('automatic: pause during an in-flight call allows its result but prevents next job',async()=>{
  let release;const hold=new Promise(r=>release=r);const f=setup({generator:model({hold})});
  try{const task=f.auto.tick();while(!f.generator.calls)await new Promise(r=>setTimeout(r,2));f.auto.setPaused(true);release();await task;assert.equal(f.generator.calls,1);assert.equal(f.auto.status().status,'paused');assert.equal(f.store.automaticRuns()[0].status,'succeeded');}finally{release();await f.close();}
});
test('automatic: restart preserves pause, history and consumed requests; resumed generation cannot exceed per-run cap',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-auto-')),'test.sqlite');let f=setup({path,generator:model({attempts:2})});
  await f.auto.tick();f.auto.setPaused(true);const run=f.store.automaticRuns()[0];await f.close();
  f=setup({path});try{await f.auto.tick();assert.equal(f.generator.calls,0);assert.equal(f.auto.status().status,'paused');assert.equal(f.auto.status().budget.modelRequests,4);
    f.store.saveAutomaticState({...f.store.getAutomaticState(),paused:false});assert.throws(()=>f.store.reserveAutomaticRequest(run.runId,start.toISOString()),e=>e.code==='AUTO_BUDGET_EXHAUSTED');
  }finally{await f.close();}
});
test('automatic: runtime crash recovery cannot bypass per-run model request cap',async()=>{
  const f=setup({generator:model({attempts:2})});try{
    await f.auto.tick();const run=f.store.automaticRuns().find(r=>r.request.kind==='surface_action');
    // Simulate an interrupted attempt after both reservations, before publication.
    f.store.db.prepare("UPDATE runs SET status='running', result=NULL WHERE id=?").run(run.runId);
    f.runtime.start();await f.runtime.idle();assert.equal(f.store.getRun(run.runId).result.error.code,'AUTO_BUDGET_EXHAUSTED');assert.equal(f.generator.calls,4);
  }finally{await f.close();}
});
test('automatic HTTP: protected status/control, malformed controls rejected, no model call from GET',async()=>{
  const a=createApp({dbPath:':memory:',token:'test-token',generator:model(),publicDataService:service(),automaticConfig:config,clock:()=>start});
  try{await new Promise((resolve,reject)=>{a.server.once('error',reject);a.server.listen(0,'127.0.0.1',resolve)});const url=`http://127.0.0.1:${a.server.address().port}`;
    assert.equal((await fetch(url+'/api/automatic')).status,401);
    const headers={'Content-Type':'application/json',Authorization:'Bearer test-token'};
    const status=await (await fetch(url+'/api/automatic',{headers})).json();assert.equal(status.status,'waiting');assert.equal(a.runtime.generator.calls,0);
    const pause=await fetch(url+'/api/automatic/control',{method:'POST',headers,body:JSON.stringify({paused:true})});assert.equal((await pause.json()).status,'paused');
    assert.equal((await fetch(url+'/api/automatic/control',{method:'POST',headers,body:'{"paused":false,"resetBudget":true}'})).status,422);
  }finally{await a.close();}
});
