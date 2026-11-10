import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {makeDemoContext} from '../src/adapters/context.js';
import {LlmGenerator} from '../src/adapters/llm.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {AppError} from '../src/errors.js';

const now=new Date('2026-10-02T09:00:00Z');
const request=(c,id,mode='configured')=>({requestId:id,kind:'surface_action',siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version},executionMode:'simulation',generatorMode:mode});
const config={enabled:true,intervalMinutes:60,maxRunsPer24Hours:6,maxModelRequestsPer24Hours:12,maxRequestsPerRun:2,maxConsecutiveFailures:2,jobs:[{id:'tree',kind:'surface_action',treeIds:['T-0012']}]};
const service={refresh:async()=>{},status:()=>({location:{confirmed:false},sources:[]})};
function model() {return {mode:'llm',modelVersion:'offline-pause-test',calls:0,describe:()=>({configured:true}),async generate(args){args.onEvent('llm_request',{attempt:1});this.calls++;return new RuleGenerator().generate(args);}};}
function setup(options={}) {const generator=options.generator??model(),a=createApp({dbPath:':memory:',clock:()=>now,generator,...options}),c=makeDemoContext({now});a.store.saveContext(c);return{a,c,generator};}
async function run(a,c,id,mode='configured',automatic) {const accepted=a.runtime.submit(request(c,id,mode),automatic);await a.runtime.idle();return a.store.getRun(accepted.runId);}

test('model pause: unset preserves behavior; paused manual models stop but offline rules still run',async()=>{
  const{a,c,generator}=setup();try{
    assert.deepEqual(a.store.getModelControl(),{paused:false,updatedAt:null});
    assert.equal((await run(a,c,'before-pause')).status,'succeeded');assert.equal(generator.calls,1);
    a.store.setModelPaused(true,now.toISOString());
    const blocked=await run(a,c,'manual-paused');assert.equal(blocked.result.error.code,'MODEL_PAUSED');assert.equal(blocked.result.error.retryable,false);assert.equal(generator.calls,1);
    assert.ok(!a.store.events(blocked.runId).some(e=>e.stage==='llm_request'));
    assert.equal((await run(a,c,'offline-paused','demo_rules')).status,'succeeded');assert.equal(generator.calls,1);
    a.store.setModelPaused(false,now.toISOString());assert.equal((await run(a,c,'explicit-resume')).status,'succeeded');assert.equal(generator.calls,2);
  }finally{await a.close();}
});

test('model pause: remote candidate service cannot bypass the global switch without llm_request events',async()=>{
  const generator={mode:'candidate_service',modelVersion:'offline-remote-fixture',calls:0,async generate(args){this.calls++;return new RuleGenerator().generate(args);}};
  const{a,c}=setup({generator});try{a.store.setModelPaused(true,now.toISOString());assert.equal((await run(a,c,'remote-paused')).result.error.code,'MODEL_PAUSED');assert.equal(generator.calls,0);}finally{await a.close();}
});

test('model pause: a fallback is not retried in place and a new paid request remains blocked',async()=>{
  const generator=model();generator.generate=async function(args){args.onEvent('llm_request',{});this.calls++;throw new AppError('CANDIDATE_SERVICE_UNAVAILABLE','offline fixture',503);};
  const{a,c}=setup({generator});try{
    const fallback=await run(a,c,'manual-fallback');assert.equal(fallback.status,'succeeded');assert.equal(fallback.result.strategy.fallback.reasonCode,'CANDIDATE_SERVICE_UNAVAILABLE');assert.equal(generator.calls,1);
    assert.throws(()=>a.runtime.retry(fallback.runId),e=>e.code==='RETRY_NOT_ALLOWED');
    a.store.setModelPaused(true,now.toISOString());const blocked=await run(a,c,'new-request-after-fallback');
    assert.equal(blocked.result.error.code,'MODEL_PAUSED');assert.equal(generator.calls,1);
  }finally{await a.close();}
});

test('model pause: legacy retryable failures cannot send another request while paused',async()=>{
  const{a,c,generator}=setup();try{
    const failed=a.store.submit(request(c,'legacy-manual-retry'),now.toISOString()).run;
    a.store.start(failed.runId,now.toISOString());
    a.store.finish(failed.runId,{runId:failed.runId,requestId:failed.requestId,status:'failed',updatedAt:now.toISOString(),error:{code:'CANDIDATE_SERVICE_UNAVAILABLE',message:'persisted failure before fallback support',retryable:true}});
    a.store.setModelPaused(true,now.toISOString());a.runtime.retry(failed.runId);await a.runtime.idle();
    assert.equal(a.store.getRun(failed.runId).result.error.code,'MODEL_PAUSED');assert.equal(generator.calls,0);
    assert.equal(a.store.getRun(failed.runId).attempt,2);
  }finally{await a.close();}
});

test('model pause: a pause while an actual adapter awaits its first response blocks the repair HTTP request',async()=>{
  let release,started;const pending=new Promise(r=>release=r),requestStarted=new Promise(r=>started=r);let httpCalls=0;
  const generator=new LlmGenerator({baseUrl:'https://example.invalid/v1',apiKey:'offline-fixture',model:'offline-fixture',fetchImpl:async()=>{httpCalls++;started();await pending;return Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}]});}});
  const{a,c}=setup({generator});try{
    const accepted=a.runtime.submit(request(c,'repair-after-pause'));await requestStarted;
    a.store.setModelPaused(true,now.toISOString());release();await a.runtime.idle();
    assert.equal(httpCalls,1);assert.equal(a.store.getRun(accepted.runId).result.error.code,'MODEL_PAUSED');
    assert.equal(a.store.events(accepted.runId).filter(e=>e.stage==='llm_request').length,1);
  }finally{release();await a.close();}
});

test('model pause: fresh manual and automatic crash recovery both obey persisted pause across reopen',async()=>{
  const dbPath=join(mkdtempSync(join(tmpdir(),'rubber-model-pause-')),'test.sqlite'),before=new Store(dbPath),c=makeDemoContext({now});before.saveContext(c);
  const manual=before.submit(request(c,'crashed-manual'),now.toISOString()).run;
  const automatic=before.submit(request(c,'crashed-automatic'),now.toISOString(),{...config,cycleKey:'crashed',jobId:'tree'}).run;
  for(const r of[manual,automatic])before.start(r.runId,now.toISOString());
  before.setModelPaused(true,now.toISOString());before.close();
  const generator=model(),a=createApp({dbPath,clock:()=>now,generator,publicDataService:service,automaticConfig:config});
  try{
    await a.runtime.idle();assert.equal(a.store.getModelControl().paused,true);assert.equal(generator.calls,0);
    for(const r of[manual,automatic])assert.equal(a.store.getRun(r.runId).result.error.code,'MODEL_PAUSED');
    assert.equal(a.store.automaticBudget(now.toISOString()).modelRequests,0);
  }finally{await a.close();}
});

test('model pause: automatic resume never restores the independent model switch or reserves a paid call',async()=>{
  const{a,generator}=setup({publicDataService:service,automaticConfig:config});try{
    a.store.setModelPaused(true,now.toISOString());a.automatic.setPaused(true);a.automatic.setPaused(false);await a.automatic.tick();await a.runtime.idle();
    assert.equal(a.store.getModelControl().paused,true);assert.equal(generator.calls,0);assert.equal(a.store.automaticBudget(now.toISOString()).modelRequests,0);
    a.automatic.setPaused(true);a.store.setModelPaused(false,now.toISOString());assert.equal(a.automatic.status().status,'paused','model resume also leaves scheduler pause alone');
  }finally{await a.close();}
});

test('model control HTTP: authenticated read/write, strict payload, no calls while changing or reading the switch',async()=>{
  const{a,generator}=setup({token:'model-control-test-token'});try{
    await new Promise((resolve,reject)=>{a.server.once('error',reject);a.server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${a.server.address().port}`,path='/api/model/control';
    assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"paused":false}'})).status,401);
    const headers={Authorization:'Bearer model-control-test-token','Content-Type':'application/json'},post=body=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await(await fetch(base+path,{headers})).json()).paused,false);
    assert.equal((await(await post({paused:true})).json()).paused,true);
    for(const body of[{paused:'false'},{paused:false,resetBudget:true},{}])assert.equal((await post(body)).status,422);
    assert.equal((await(await fetch(base+path,{headers})).json()).paused,true);assert.equal(generator.calls,0);
    assert.equal((await(await post({paused:false})).json()).paused,false);assert.equal(generator.calls,0);
  }finally{await a.close();}
});
