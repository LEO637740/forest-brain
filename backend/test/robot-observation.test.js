import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {ReviewWorkflow} from '../src/review-workflow.js';
import {RobotObservation} from '../src/robot-observation.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const clock=()=>new Date('2026-10-26T03:00:00.000Z');
const frame=(job,captureId,patch={})=>({captureId,treeId:job.treeId,siteId:job.siteId,
  image:'data:image/jpeg;base64,/9j/2Q==',width:640,height:480,position:[1,1.35,2],...patch});
function fixture(t){
  const store=new Store(),simulation=new SimulationService(store,clock);
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock});
  const reviews=new ReviewWorkflow(store,clock,runtime);reviews.simulation=simulation;
  const observations=new RobotObservation(reviews);
  t.after(async()=>{await runtime.stop();store.close();});
  const create=(patch={})=>reviews.create({treeIds:['T-0006'],siteId:'demo-hainan',kind:'capture',assignee:'robot',captureRequest:true,...patch})[0];
  return {store,simulation,runtime,reviews,observations,create};
}

test('camera return saves a review-required image without clearing findings or creating cutting receipts',async t=>{
  const f=fixture(t),job=f.create(),original=f.reviews.apply(makeParkContext({siteId:job.siteId,now:clock()}));
  const capture=f.observations.start(job.id,{requestId:'camera-return'}).observation.captureId;
  const received=f.observations.collect(job.id,frame(job,capture));
  assert.equal(received.status,'collected');assert.equal(received.evidence.quality,'review_required');
  assert.equal(received.conclusion,undefined);
  const before=original.modules.inspection.evidence.find(item=>item.treeId===job.treeId);
  const after=f.reviews.apply(makeParkContext({siteId:job.siteId,now:clock()})).modules.inspection.evidence.find(item=>item.treeId===job.treeId);
  assert.deepEqual(after,before);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM simulation_actions').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM simulation_task_receipts').get().n,0);
  const image=f.observations.image(job.id,capture);
  assert.equal(image.siteId,job.siteId);assert.equal(image.reviewId,job.id);
  assert.ok(image.annotations.every(item=>item.source==='existing_demo_record'));
  await f.reviews.complete(job.id,{conclusion:'clear',note:'人工核对本轮画面后确认清除'});await f.runtime.idle();
  const reviewed=f.reviews.apply(makeParkContext({siteId:job.siteId,now:clock()})).modules.inspection.evidence.find(item=>item.treeId===job.treeId);
  assert.equal(reviewed.geometryRegistered,true);assert.ok(reviewed.detections.every(item=>item.reviewStatus==='rejected'));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM simulation_actions').get().n,0);
});

test('capture retries are idempotent and retakes reject stale frames while preserving earlier images',async t=>{
  const f=fixture(t),job=f.create();
  const first=f.observations.start(job.id,{requestId:'camera-first'});
  assert.equal(f.observations.start(job.id,{requestId:'camera-second-click'}).observation.captureId,first.observation.captureId);
  const request=frame(job,first.observation.captureId);
  f.observations.collect(job.id,request);f.observations.collect(job.id,request);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM review_images').get().n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM review_events WHERE json_extract(body,'$.event')='camera_returned'").get().n,1);
  const retake=f.observations.start(job.id,{requestId:'camera-retake'});
  assert.notEqual(retake.observation.captureId,first.observation.captureId);
  await assert.rejects(f.reviews.complete(job.id,{conclusion:'clear',note:'尚未收到新图'}),error=>error.code==='CAMERA_PENDING');
  assert.throws(()=>f.observations.collect(job.id,request),error=>error.code==='CAPTURE_STALE');
  assert.equal(f.observations.image(job.id,first.observation.captureId).captureId,first.observation.captureId);
  f.observations.fail(job.id,{captureId:retake.observation.captureId,message:'停止本轮补拍'});
  const replacement=f.observations.start(job.id,{requestId:'camera-after-stop'});
  assert.notEqual(replacement.observation.captureId,retake.observation.captureId);
  f.observations.collect(job.id,frame(job,replacement.observation.captureId));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM review_images').get().n,2);
});

test('camera target and review ownership are checked, and other parks keep their independent review jobs',t=>{
  const f=fixture(t),job=f.create(),foreign=f.create({siteId:'demo-xsbn',captureRequest:false});
  assert.notEqual(job.id,foreign.id);
  assert.equal(f.reviews.jobs('xsbn')[0].id,foreign.id);
  assert.equal(f.reviews.issues('demo','xsbn').find(item=>item.treeId===job.treeId).job.id,foreign.id);
  assert.throws(()=>f.observations.start(foreign.id),error=>error.code==='CAPTURE_UNAVAILABLE');
  const capture=f.observations.start(job.id).observation.captureId;
  assert.throws(()=>f.observations.collect(job.id,frame(job,capture,{treeId:'T-0007'})),error=>error.code==='WRONG_TARGET');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM review_images').get().n,0);
  f.observations.collect(job.id,frame(job,capture));
  assert.throws(()=>f.observations.image(foreign.id,capture),error=>error.code==='NOT_FOUND');
  assert.equal(f.reviews.get(foreign.id).status,'queued');
});

test('entered growth measurements replace only the same park tree and health review does not clear surface evidence',async t=>{
  const f=fixture(t),treeId='T-0042';
  const measure=f.create({treeIds:[treeId],siteId:'demo-xsbn',kind:'measure',assignee:'human',purpose:'growth'});
  f.reviews.collect(measure.id,{circumferenceCm:73.4});
  await f.reviews.complete(measure.id,{note:'人工复测树围为73.4厘米'});await f.runtime.idle();
  const measured=f.reviews.apply(makeParkContext({siteId:'demo-xsbn',now:clock()}));
  assert.equal(measured.modules.trees.find(tree=>tree.treeId===treeId).circumferenceCm,73.4);
  assert.equal(f.reviews.apply(makeParkContext({siteId:'demo-hainan',now:clock()})).modules.trees.find(tree=>tree.treeId===treeId).circumferenceCm,null);
  const health=f.create({kind:'inspect',assignee:'human',purpose:'health'});
  const capture=f.observations.start(health.id).observation.captureId;
  f.observations.collect(health.id,frame(health,capture));
  const before=f.reviews.apply(makeParkContext({siteId:'demo-hainan',now:clock()})).modules.inspection;
  await f.reviews.complete(health.id,{conclusion:'clear',note:'仅确认健康症状，树表仍需单独核查'});await f.runtime.idle();
  const after=f.reviews.apply(makeParkContext({siteId:'demo-hainan',now:clock()}));
  assert.deepEqual(after.modules.inspection,before);
  assert.ok(after.modules.health.records.some(record=>record.recordId===health.id&&record.symptomCodes.length===0));
});

test('HTTP photo read and write enforce account park, role and explicitly selected site',async t=>{
  const app=createApp({dbPath:':memory:',clock,generator:new RuleGenerator(),pauseModelsOnStart:true,requireIdentity:true});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=async(path,{input,token,status=200}={})=>{
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{...(input===undefined?{}:{'Content-Type':'application/json'}),...(token?{'X-Rubber-Session':token}:{})},body:input===undefined?undefined:JSON.stringify(input)});
    const result=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);return result;
  };
  const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
  const hn=await login('manager-hn'),xs=await login('manager-xs'),grower=await login('grower-hn-wang'),center=await login('center-hz');
  const job=(await call('/api/simulation/reviews',{token:hn,status:201,input:{treeIds:['T-0006'],kind:'capture',assignee:'robot',siteId:'demo-hainan',captureRequest:true}})).items[0];
  const path=`/api/simulation/reviews/${job.id}/photo`;
  await call(path+'/start',{token:xs,input:{siteId:'demo-xsbn'},status:403});
  await call(path+'/start',{token:center,input:{siteId:'demo-hainan'},status:403});
  await call(path+'/start',{token:grower,input:{siteId:'demo-hainan'},status:403});
  const start=await call(path+'/start',{token:hn,input:{siteId:'demo-hainan'}}),capture=start.observation.captureId;
  await call(path+'/collect',{token:hn,input:frame(job,capture)});
  await call(path+'/'+capture,{token:xs,status:403});
  await call(path+'/'+capture,{token:grower,status:403});
  await call(path+'/'+capture+'?siteId=demo-xsbn',{token:center,status:404});
  assert.equal((await call(path+'/'+capture,{token:center})).treeId,job.treeId);
  assert.equal((await call(path+'/'+capture,{token:hn})).captureId,capture);
});
