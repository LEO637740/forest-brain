import test from 'node:test';
import assert from 'node:assert/strict';
import {createZoneScheduler} from '../src/zoneFleet.ts';
import {taskFleetControls} from '../src/workspace/taskFleetControlModel.ts';

const requestedAt='2026-10-18T02:00:00.000Z';
const job=(id='rail-one',patch={})=>({id,attemptId:`attempt-${id}`,planVersion:'fixture-v1',angle:30,requestedAt,...patch});
const task=(patch={})=>({id:'rail-one',site:'hainan',title:'割胶任务',block:'A',robot:'R-A',start:'10:00',end:'—',count:1,done:0,status:'待处理',kind:'割胶',treeIndices:[0],railJob:job(),...patch});
const batch=(patch={})=>task({id:'plan-batch',railJob:undefined,count:3,treeIndices:[0,1,2],railBatch:{baseDone:0,jobs:{0:job('job-0'),1:job('job-1'),2:job('job-2')},results:{}},...patch});
const receipt=(index,original,outcome='completed')=>({index,job:structuredClone(original),outcome,finishedAt:'2026-10-18T02:01:00.000Z'});
const source={treeId:'T-0001',strategyId:'strategy',runId:'run',revision:1,angle:30,adoptedAt:'2026-10-18T01:00:00.000Z',expiresAt:'2026-10-18T03:00:00.000Z',mode:'simulation',siteId:'demo-hainan'};
const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
function fleet(entries=[]){
 const scheduler=createZoneScheduler(routes);
 for(const [index,value] of entries)assert.equal(scheduler.enqueue(index,value),true);
 return {scheduler,snapshot:()=>({ready:true,error:null,jobs:structuredClone(scheduler.jobs),zones:structuredClone(scheduler.zones)})};
}
const closed={live:[],canRetry:false,message:null};
function assertReview(result){assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/需核对/);}

test('matching single-tree control returns the original job, not a live mutable snapshot',()=>{
 const original=task(),f=fleet([[0,original.railJob]]),snapshot=f.snapshot();
 snapshot.jobs[0].validation='invalid';snapshot.jobs[0].weatherBlock='降雨';
 const result=taskFleetControls(original,snapshot);
 assert.deepEqual(result.live,[{index:0,job:original.railJob}]);
 assert.equal(result.live[0].job,original.railJob);
 assert.equal(result.canRetry,false);assert.equal(result.message,null);
});

test('a recovered single-tree task can retry only while its target is genuinely free',()=>{
 const original=task(),f=fleet();
 assert.deepEqual(taskFleetControls(original,f.snapshot()),{live:[],canRetry:true,message:null});
 f.scheduler.enqueue(0,job('unrelated'));
 const result=taskFleetControls(original,f.snapshot());
 assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/树位已有其它执行/);
});

for(const patch of [
 {site:'xsbn'},{site:'xian'},{kind:'运输'},{dispatch:{phase:'queued'}},
 {status:'已取消'},{status:'已完成'},{dispatch:{phase:'cancelled'}},{dispatch:{phase:'completed'}},
])test(`unsupported or closed task exposes no controls: ${JSON.stringify(patch)}`,()=>{
 const original=task(patch),f=fleet([[0,job()]]);
 assert.deepEqual(taskFleetControls(original,f.snapshot()),closed);
});

test('an ordinary plan without a recorded rail dispatch has no control warning',()=>{
 assert.deepEqual(taskFleetControls(task({id:'plan',railJob:undefined,status:'待开始'}),fleet().snapshot()),closed);
});

for(const [name,patch] of [
 ['missing original job',{railJob:undefined}],['wrong job ID',{railJob:job('another')}],
 ['multiple targets',{count:2,treeIndices:[0,1]}],['missing targets',{treeIndices:undefined}],
 ['duplicate targets',{count:2,treeIndices:[0,0]}],['out-of-scene target',{treeIndices:[200]}],
 ['non-integer target',{treeIndices:[0.5]}],['unfinished task with completion progress',{done:1}],
 ['single-tree receipt already present',{railResult:receipt(0,job())}],
 ['invalid request time',{railJob:job('rail-one',{requestedAt:'invalid'})}],
 ['invalid attempt identity',{railJob:job('rail-one',{attemptId:''})}],
 ['foreign model source',{railJob:job('rail-one',{harnessSource:{...source,siteId:'demo-xsbn'}})}],
])test(`malformed single-tree records require review: ${name}`,()=>{
 const original=task(patch),f=fleet([[0,job()]]);
 assertReview(taskFleetControls(original,f.snapshot()));
});

for(const [name,patch] of [
 ['attempt',{attemptId:'another-attempt'}],['request time',{requestedAt:'2026-10-18T02:00:01.000Z'}],
 ['angle',{angle:31}],['plan',{planVersion:'fixture-v2'}],
 ['added source',{harnessSource:source}],
])test(`same ID with different ${name} cannot be controlled or treated as free`,()=>{
 const original=task(),f=fleet([[0,job('rail-one',patch)]]),result=taskFleetControls(original,f.snapshot());
 assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/其它执行/);
});

test('a changed source record with the same adoption identity cannot be controlled',()=>{
 const original=task({railJob:job('rail-one',{harnessSource:source})});
 const f=fleet([[0,{...original.railJob,harnessSource:{...source,expiresAt:'2026-10-18T04:00:00.000Z'}}]]);
 assert.equal(taskFleetControls(original,f.snapshot()).live.length,0);
 assert.equal(taskFleetControls(original,f.snapshot()).canRetry,false);
});

test('legacy dispatches without attempt IDs remain controllable only when the full original job matches',()=>{
 const original=task({railJob:job('rail-one',{attemptId:undefined})}),f=fleet([[0,original.railJob]]);
 assert.equal(taskFleetControls(original,f.snapshot()).live.length,1);
 f.scheduler.jobs[0].requestedAt='2026-10-18T02:00:01.000Z';
 assert.equal(taskFleetControls(original,f.snapshot()).live.length,0);
});

test('not-ready fleets expose neither old controls nor recovery actions',()=>{
 const original=task(),f=fleet([[0,original.railJob]]),result=taskFleetControls(original,{...f.snapshot(),ready:false});
 assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/尚未就绪/);
});

test('a job entry without membership is held for review instead of exposing controls',()=>{
 const original=task(),snapshot=fleet().snapshot();snapshot.jobs[0]=original.railJob;
 const result=taskFleetControls(original,snapshot);
 assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/队列记录不一致/);
});

for(const placement of ['active','queue'])test(`orphan ${placement} membership blocks recovery even without a job entry`,()=>{
 const snapshot=fleet().snapshot();
 if(placement==='active')snapshot.zones[0].active=0;else snapshot.zones[0].queue=[0];
 const result=taskFleetControls(task(),snapshot);
 assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/其它执行/);
});

test('wrong-zone membership cannot grant control and still blocks admission',()=>{
 const original=task(),snapshot=fleet().snapshot();snapshot.jobs[0]=original.railJob;snapshot.zones[1].queue=[0];
 const result=taskFleetControls(original,snapshot);
 assert.deepEqual(result.live,[]);assert.equal(result.canRetry,false);assert.match(result.message,/队列记录不一致/);
});

test('zone lookup uses the recorded zone number even when snapshot order differs',()=>{
 const original=task(),f=fleet([[0,original.railJob]]),snapshot=f.snapshot();snapshot.zones.reverse();
 assert.equal(taskFleetControls(original,snapshot).live.length,1);
});

test('batch controls show active entries first, then remaining entries in tree order',()=>{
 const original=batch({treeIndices:[0,1,50],railBatch:{baseDone:0,jobs:{0:job('job-0'),1:job('job-1'),50:job('job-50')},results:{}}});
 const f=fleet([[1,original.railBatch.jobs[1]],[0,original.railBatch.jobs[0]],[50,original.railBatch.jobs[50]]]);
 const result=taskFleetControls(original,f.snapshot());
 assert.deepEqual(result.live.map(entry=>entry.index),[1,50,0]);
 for(const entry of result.live)assert.equal(entry.job,original.railBatch.jobs[entry.index]);
 assert.equal(result.canRetry,false);
});

test('batch history excludes received trees from control and from recovery occupancy',()=>{
 const original=batch();original.railBatch.results[0]=receipt(0,original.railBatch.jobs[0]);original.done=1;
 const f=fleet([[0,job('new-tree-0-task')],[1,original.railBatch.jobs[1]]]);
 assert.deepEqual(taskFleetControls(original,f.snapshot()).live.map(entry=>entry.index),[1]);
 f.scheduler.retire(1);
 assert.deepEqual(taskFleetControls(original,f.snapshot()),{live:[],canRetry:true,message:null});
});

test('valid cancelled receipts are preserved and never offered for another attempt',()=>{
 const original=batch();original.railBatch.results[0]=receipt(0,original.railBatch.jobs[0],'cancelled');
 const f=fleet([[0,original.railBatch.jobs[0]]]);
 assert.deepEqual(taskFleetControls(original,f.snapshot()),{live:[],canRetry:true,message:null});
});

test('a legacy batch preserves baseDone while recovering only its remaining recorded jobs',()=>{
 const original=batch({count:4,done:2,treeIndices:[0,1,2,3],railBatch:{baseDone:2,jobs:{2:job('job-2'),3:job('job-3')},results:{}}});
 const f=fleet([[0,job('older-tree-0-task')]]);
 assert.deepEqual(taskFleetControls(original,f.snapshot()),{live:[],canRetry:true,message:null});
 original.railBatch.results[2]=receipt(2,original.railBatch.jobs[2]);original.done=3;
 f.scheduler.enqueue(3,original.railBatch.jobs[3]);
 assert.deepEqual(taskFleetControls(original,f.snapshot()).live.map(entry=>entry.index),[3]);
});

for(const [name,mutate] of [
 ['mixed single-tree job',t=>{t.railJob=job();}],
 ['mixed single-tree receipt',t=>{t.railResult=receipt(0,t.railBatch.jobs[0]);}],
 ['missing job',t=>{delete t.railBatch.jobs[1];}],
 ['negative prior progress',t=>{t.railBatch.baseDone=-1;}],
 ['fractional prior progress',t=>{t.railBatch.baseDone=0.5;}],
 ['progress without receipt',t=>{t.done=1;}],
 ['wrong receipt attempt',t=>{t.railBatch.results[0]=receipt(0,{...t.railBatch.jobs[0],attemptId:'old'});t.done=1;}],
 ['misfiled receipt',t=>{t.railBatch.results[1]=receipt(0,t.railBatch.jobs[0]);t.done=1;}],
 ['receipt before request',t=>{t.railBatch.results[0]={...receipt(0,t.railBatch.jobs[0]),finishedAt:'2026-10-18T00:00:00.000Z'};t.done=1;}],
 ['unknown job target',t=>{t.railBatch.jobs[99]=t.railBatch.jobs[0];delete t.railBatch.jobs[0];}],
 ['noncanonical key',t=>{t.railBatch.jobs['00']=t.railBatch.jobs[0];delete t.railBatch.jobs[0];}],
 ['duplicate job ID',t=>{t.railBatch.jobs[1]={...t.railBatch.jobs[0]};}],
 ['invalid job hidden by no receipt',t=>{t.railBatch.jobs[2].requestedAt='invalid';}],
])test(`malformed batch records suppress all controls and recovery: ${name}`,()=>{
 const original=batch();mutate(original);
 const f=fleet([[0,job('job-0')],[1,job('job-1')],[2,job('job-2')]]);
 assertReview(taskFleetControls(original,f.snapshot()));
});

test('a batch with receipts for every assigned tree needs status review rather than empty retry',()=>{
 const original=batch();
 for(const [key,value] of Object.entries(original.railBatch.jobs))original.railBatch.results[key]=receipt(Number(key),value);
 original.done=3;
 assertReview(taskFleetControls(original,fleet().snapshot()));
});

test('a same-ID job on an unrelated tree does not suppress recovery of the real targets',()=>{
 const original=batch(),f=fleet([[99,original.railBatch.jobs[0]]]);
 assert.deepEqual(taskFleetControls(original,f.snapshot()),{live:[],canRetry:true,message:null});
});

test('partial batch ownership still exposes only matching controls and reports other occupied targets',()=>{
 const original=batch(),f=fleet([[0,original.railBatch.jobs[0]],[1,{...original.railBatch.jobs[1],attemptId:'replacement'}]]);
 const result=taskFleetControls(original,f.snapshot());
 assert.deepEqual(result.live.map(entry=>entry.index),[0]);assert.equal(result.canRetry,false);assert.match(result.message,/其它执行/);
});

for(const status of ['待开始','执行中'])test(`free targets do not expose recovery for status ${status}`,()=>{
 const result=taskFleetControls(task({status}),fleet().snapshot());
 assert.deepEqual(result,closed);
});

test('control derivation does not mutate the saved task or fleet snapshot',()=>{
 const original=batch(),snapshot=fleet([[0,original.railBatch.jobs[0]]]).snapshot();
 const before=structuredClone({original,snapshot});
 taskFleetControls(original,snapshot);
 assert.deepEqual({original,snapshot},before);
});
