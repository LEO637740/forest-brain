import test from 'node:test';
import assert from 'node:assert/strict';
import {attachFleet,commitFleetDispatch,createZoneScheduler,detachFleet,dispatchFleetJobs,getFleetSnapshot,subscribeFleet} from '../src/zoneFleet.ts';
import {finishRailTask,syncRailTask} from '../src/workspace/railTaskState.ts';
import {RailDispatchController,findDueRailTask} from '../src/workspace/railDispatchController.ts';
import {Store} from '../../backend/src/store.js';
import {SimulationService} from '../../backend/src/simulation.js';

const epoch=Date.parse('2026-10-18T02:00:00.000Z');
const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
const task=(patch={})=>({id:'planned-a',site:'hainan',title:'A 区割胶',block:'A',robot:'R-A',date:'2026-10-18',start:'09:00',end:'—',count:2,done:0,status:'待开始',kind:'割胶',treeIndices:[0,1],...patch});
const job=(id='old-job',patch={})=>({id,planVersion:'fixture-v1',angle:28,requestedAt:new Date(epoch).toISOString(),...patch});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function withAttachedFleet(run){
 const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),memory=new Map(),subscriptions=[];
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}});
 const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch);
 try{
  attachFleet(scheduler);
  return run(scheduler,listener=>{const unsubscribe=subscribeFleet(listener);subscriptions.push(unsubscribe);return unsubscribe;});
 }finally{
  for(const unsubscribe of subscriptions)unsubscribe();
  detachFleet();
  if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;
 }
}

function fixture(initial=[task()],options={}){
 let tasks=structuredClone(initial),decisions={angle:'28'},enabled=true,ready=true,serial=0;
 const verifications=[],made=[],notices=[],retired=[],updates=[];
 const scheduler=createZoneScheduler(routes,(index,value)=>{
  tasks=tasks.map(t=>finishRailTask(t,{index,job:value,outcome:'completed',finishedAt:new Date(epoch).toISOString()}));
 },()=>{},()=>options.now?.()??epoch);
 const enqueue=scheduler.enqueue,retire=scheduler.retire;
 const getFleet=()=>({ready,error:null,zones:structuredClone(scheduler.zones),jobs:structuredClone(scheduler.jobs)});
 const publish=()=>{tasks=tasks.map(t=>syncRailTask(t,getFleet(),epoch));};
 const h={scheduler,enqueue,retire,verifications,made,notices,retired,updates,getFleet,publish,
  get tasks(){return tasks;},set tasks(value){tasks=value;},
  get decisions(){return decisions;},set decisions(value){decisions=value;},
  set enabled(value){enabled=value;},set ready(value){ready=value;},
  onEnqueue:null,beforeCommit:null,
 };
 scheduler.enqueue=(index,value)=>h.onEnqueue?h.onEnqueue(index,value):enqueue(index,value);
 scheduler.retire=index=>{retired.push(index);return retire(index);};
 h.controller=new RailDispatchController({
  getState:()=>({tasks,decisions}),
  updateTasks:fn=>{tasks=fn(tasks);updates.push(structuredClone(tasks));},
  getFleet,
  verify:indices=>{
   const attempt={indices:[...indices],...deferred()};verifications.push(attempt);
   if(!options.deferred)attempt.resolve();
   return attempt.promise;
  },
  makeJob:(index,id,currentTasks,currentDecisions)=>{
   made.push({index,id,tasks:structuredClone(currentTasks),decisions:structuredClone(currentDecisions)});
   return job(id,{angle:Number(currentDecisions.angle)});
  },
  dispatch:(entries,commit)=>{
   const accepted=commitFleetDispatch(scheduler,entries,snapshot=>{h.beforeCommit?.();return commit(snapshot);});
   publish();return accepted;
  },
  isEnabled:()=>enabled,
  notify:message=>notices.push(message),
  now:()=>options.now?.()??epoch,newId:()=>String(++serial),
 });
 return h;
}

test('a batch creates real scheduled jobs and records their exact identities and prior progress',async()=>{
 const h=fixture([task({count:3,done:1,treeIndices:[0,1,2]})]);
 await h.controller.startBatch('planned-a');
 assert.deepEqual(h.verifications.map(v=>v.indices),[[1,2]]);
 assert.deepEqual(Object.keys(h.scheduler.jobs),['1','2']);
 const saved=h.tasks[0];assert.equal(saved.done,1);assert.equal(saved.railBatch.baseDone,1);
 assert.deepEqual(saved.railBatch.results,{});
 for(const index of [1,2])assert.deepEqual(saved.railBatch.jobs[index],h.scheduler.jobs[index]);
 assert.equal(saved.status,'执行中');
 h.scheduler.update(1);h.scheduler.update(8);h.scheduler.update(1);h.scheduler.update(8);
 assert.equal(h.tasks[0].done,3);assert.equal(h.tasks[0].status,'已完成');
});

test('a recovered batch retries only missing receipts and preserves acknowledged work',async()=>{
 const first=job('first'),second=job('second'),receipt={index:0,job:first,outcome:'completed',finishedAt:new Date(epoch).toISOString()};
 const h=fixture([task({done:1,status:'待处理',railBatch:{baseDone:0,jobs:{0:first,1:second},results:{0:receipt}}})]);
 await h.controller.retry('planned-a');
 assert.deepEqual(h.verifications[0].indices,[1]);
 assert.equal(h.scheduler.jobs[0],undefined);assert.ok(h.scheduler.jobs[1]);
 assert.notEqual(h.scheduler.jobs[1].id,'second');
 assert.equal(h.tasks[0].done,1);assert.deepEqual(h.tasks[0].railBatch.results,{0:receipt});
 assert.deepEqual(h.tasks[0].railBatch.jobs[0],first);
});

test('single-tree retry restores the same task identity and receives one completion',async()=>{
 const h=fixture([task({id:'rail-single',count:1,status:'待处理',treeIndices:[0],railJob:job('rail-single')})]);
 await h.controller.retry('rail-single');
 assert.deepEqual(h.verifications[0].indices,[0]);assert.equal(h.scheduler.jobs[0].id,'rail-single');
 assert.deepEqual(h.tasks[0].railJob,h.scheduler.jobs[0]);
 h.scheduler.update(1);h.scheduler.update(8);h.scheduler.update(20);
 assert.equal(h.tasks[0].done,1);assert.equal(h.tasks[0].status,'已完成');
 assert.equal(h.tasks[0].railResult.job.id,'rail-single');
});

test('same-millisecond retries create distinct attempt identities and reject the retired attempt receipt',async()=>{
 const h=fixture([task({id:'rail-single',count:1,status:'待处理',treeIndices:[0],railJob:job('rail-single')})]);
 await h.controller.retry('rail-single');
 const first=structuredClone(h.scheduler.jobs[0]);
 h.scheduler.retire(0);
 await h.controller.retry('rail-single');
 const second=h.scheduler.jobs[0],current=h.tasks[0];
 assert.equal(first.id,second.id);assert.equal(first.requestedAt,second.requestedAt);
 assert.ok(first.attemptId);assert.ok(second.attemptId);assert.notEqual(first.attemptId,second.attemptId);
 const stale={index:0,job:first,outcome:'completed',finishedAt:new Date(epoch).toISOString()};
 assert.equal(finishRailTask(current,stale),current);
 h.scheduler.update(1);h.scheduler.update(8);
 assert.equal(h.tasks[0].status,'已完成');assert.equal(h.tasks[0].railResult.job.attemptId,second.attemptId);
});

test('retry attempt identity survives server persistence and scheduler checkpoint restoration',async()=>{
 const store=new Store(':memory:'),service=new SimulationService(store,()=>new Date(epoch));
 try{
  const h=fixture([task({id:'rail-single',count:1,status:'待处理',treeIndices:[0],railJob:job('rail-single')})]);
  await h.controller.retry('rail-single');
  const first=structuredClone(h.scheduler.jobs[0]);
  let saved=service.tasks({tasks:h.tasks});assert.deepEqual(saved.conflicts,[]);h.tasks=saved.tasks;
  h.scheduler.retire(0);await h.controller.retry('rail-single');
  saved=service.tasks({tasks:h.tasks});assert.deepEqual(saved.conflicts,[]);
  const restored=service.latestTasks()[0],second=structuredClone(h.scheduler.jobs[0]);
  assert.equal(restored.railJob.attemptId,second.attemptId);assert.notEqual(first.attemptId,second.attemptId);
  const scheduler=createZoneScheduler(routes);
  assert.equal(scheduler.restore(structuredClone({zones:h.scheduler.zones,jobs:h.scheduler.jobs})),true);
  assert.equal(scheduler.jobs[0].attemptId,second.attemptId);
  const result=value=>({index:0,job:value,outcome:'completed',finishedAt:new Date(epoch).toISOString()});
  assert.equal(finishRailTask(restored,result(first)),restored);
  const complete=finishRailTask(restored,result(second));assert.equal(complete.status,'已完成');
  assert.deepEqual(service.tasks({tasks:[complete]}).conflicts,[]);
  assert.equal(service.latestTasks()[0].railResult.job.attemptId,second.attemptId);
 }finally{store.close();}
});

test('new tree requests deduplicate targets and create only accepted, linked task records',async()=>{
 const h=fixture([]);await h.controller.queueTrees([0,0,50]);
 assert.deepEqual(h.verifications.map(v=>v.indices),[[0,50]]);
 assert.equal(h.tasks.length,2);assert.equal(new Set(h.tasks.map(t=>t.id)).size,2);
 for(const saved of h.tasks){
  assert.equal(saved.site,'hainan');assert.equal(saved.kind,'割胶');assert.equal(saved.date,'2026-10-18');
  assert.equal(saved.railJob.id,saved.id);assert.deepEqual(saved.railJob,h.scheduler.jobs[saved.treeIndices[0]]);
 }
});

for(const entry of ['startBatch','retry'])for(const terminal of ['已取消','已完成'])test(`${entry} cannot resurrect a task that becomes ${terminal} during verification`,async()=>{
 const initial=entry==='retry'?task({id:'rail-single',count:1,treeIndices:[0],status:'待处理',railJob:job('rail-single')}):task();
 const h=fixture([initial],{deferred:true}),pending=h.controller[entry](initial.id);await settle();
 const latest={...h.tasks[0],revision:7,status:terminal,done:terminal==='已完成'?initial.count:0};h.tasks=[latest];
 h.verifications[0].resolve();await pending;
 assert.deepEqual(h.scheduler.jobs,{});assert.deepEqual(h.tasks,[latest]);assert.equal(h.made.length,0);
});

for(const change of ['edit','receipt','remove'])test(`batch verification discards a stale intent after task ${change}`,async()=>{
 const h=fixture([task()],{deferred:true}),pending=h.controller.startBatch('planned-a');await settle();
 if(change==='edit')h.tasks=[{...h.tasks[0],treeIndices:[2,3],title:'远端修改后的任务',revision:2}];
 else if(change==='receipt')h.tasks=[{...h.tasks[0],done:1,revision:2}];
 else h.tasks=[];
 const current=structuredClone(h.tasks);h.verifications[0].resolve();await pending;
 assert.deepEqual(h.tasks,current);assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.made.length,0);
});

test('late verification failure cannot reopen a cancelled task or erase its newest fields',async()=>{
 const h=fixture([task()],{deferred:true}),pending=h.controller.startBatch('planned-a');await settle();
 const latest={...h.tasks[0],status:'已取消',revision:9,end:'10:01'};h.tasks=[latest];
 h.verifications[0].reject(Error('旧请求连接中断'));await pending;
 assert.deepEqual(h.tasks,[latest]);assert.deepEqual(h.scheduler.jobs,{});
});

test('an in-place task edit is detected against the frozen intent, not only object identity',async()=>{
 const h=fixture([task()],{deferred:true}),pending=h.controller.startBatch('planned-a');await settle();
 h.tasks[0].treeIndices.splice(0,2,2,3);h.tasks[0].revision=5;
 h.verifications[0].resolve();await pending;
 assert.deepEqual(h.tasks[0].treeIndices,[2,3]);assert.equal(h.tasks[0].revision,5);assert.deepEqual(h.scheduler.jobs,{});
});

test('a newly arrived batch receipt is retained when a recovery request returns late',async()=>{
 const first=job('first'),second=job('second');
 const h=fixture([task({status:'待处理',railBatch:{baseDone:0,jobs:{0:first,1:second},results:{}}})],{deferred:true});
 const pending=h.controller.retry('planned-a');await settle();
 const receipt={index:0,job:first,outcome:'completed',finishedAt:new Date(epoch).toISOString()};
 h.tasks=h.tasks.map(t=>finishRailTask(t,receipt));const latest=structuredClone(h.tasks);
 h.verifications[0].resolve();await pending;
 assert.deepEqual(h.tasks,latest);assert.equal(h.tasks[0].done,1);assert.deepEqual(h.scheduler.jobs,{});
});

test('an unchanged failed request creates no jobs and can be retried after the request settles',async()=>{
 const h=fixture([task()],{deferred:true}),first=h.controller.startBatch('planned-a');await settle();
 h.verifications[0].reject(Error('天气服务暂不可用'));await first;
 assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.tasks[0].railBatch,undefined);assert.ok(h.notices.some(v=>String(v).includes('天气服务暂不可用')));
 const next=h.controller.startBatch('planned-a');await settle();assert.equal(h.verifications.length,2);
 h.verifications[1].resolve();await next;assert.equal(Object.keys(h.scheduler.jobs).length,2);
});

test('a blocked batch saves its reason through server hydration and records a successful recheck before execution',async()=>{
 const store=new Store(':memory:'),service=new SimulationService(store,()=>new Date(epoch));
 try{
  const original=service.tasks({tasks:[task()]}).tasks[0];
  const h=fixture([original],{deferred:true});
  const pending=h.controller.startBatch(original.id);await settle();
  const reason='HN-A-0002 存在树表标记，请在一树一策中复核后再安排';
  h.verifications[0].reject(Error(reason));await pending;
  assert.equal(h.tasks[0].status,'待处理');assert.equal(h.tasks[0].done,0);
  assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.tasks[0].railBatch,undefined);
  assert.deepEqual(h.tasks[0].railDispatchChecks,[{time:new Date(epoch).toISOString(),outcome:'blocked',message:reason}]);
  const written=service.tasks({tasks:h.tasks});assert.equal(written.accepted,1);assert.deepEqual(written.conflicts,[]);
  const hydrated=service.latestTasks('demo-hainan')[0];
  assert.deepEqual(hydrated.railDispatchChecks,h.tasks[0].railDispatchChecks);
  const resumed=fixture([hydrated]);await resumed.controller.startBatch(original.id);
  assert.equal(resumed.verifications.length,1);assert.deepEqual(resumed.verifications[0].indices,[0,1]);
  assert.equal(resumed.tasks[0].status,'执行中');assert.equal(resumed.tasks[0].done,0);
  assert.deepEqual(Object.keys(resumed.scheduler.jobs),['0','1']);
  assert.equal(resumed.tasks[0].railDispatchChecks[0].message,reason);
  assert.equal(resumed.tasks[0].railDispatchChecks.at(-1).outcome,'passed');
  const passed=service.tasks({tasks:resumed.tasks});assert.equal(passed.accepted,1);assert.deepEqual(passed.conflicts,[]);
  assert.equal(service.latestTasks()[0].railDispatchChecks.at(-1).outcome,'passed');
  resumed.scheduler.update(1);resumed.scheduler.update(8);resumed.scheduler.update(1);resumed.scheduler.update(8);
  assert.equal(resumed.tasks[0].done,2);assert.equal(resumed.tasks[0].status,'已完成');
  assert.equal(Object.keys(resumed.tasks[0].railBatch.results).length,2);
 }finally{store.close();}
});

test('rechecks retain the latest bounded history and never dispatch while a blocker remains',async()=>{
 const previous=Array.from({length:20},(_,index)=>({time:new Date(epoch-index).toISOString(),outcome:'blocked',message:`旧原因 ${index}`}));
 const h=fixture([task({status:'待处理',railDispatchChecks:previous})],{deferred:true});
 const pending=h.controller.startBatch('planned-a');await settle();
 h.verifications[0].reject(Error('新的核验原因'));await pending;
 assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.tasks[0].done,0);assert.equal(h.tasks[0].status,'待处理');
 assert.equal(h.tasks[0].railDispatchChecks.length,20);
 assert.deepEqual(h.tasks[0].railDispatchChecks.slice(0,-1),previous.slice(1));
 assert.equal(h.tasks[0].railDispatchChecks.at(-1).message,'新的核验原因');
});

test('repeated batch clicks and retry share a single pending task lock',async()=>{
 const h=fixture([task()],{deferred:true}),first=h.controller.startBatch('planned-a');await settle();
 const duplicate=h.controller.startBatch('planned-a'),retry=h.controller.retry('planned-a');await settle();
 assert.equal(h.verifications.length,1);h.verifications[0].resolve();await Promise.all([first,duplicate,retry]);
 assert.equal(h.tasks.length,1);assert.equal(h.made.length,2);assert.equal(Object.keys(h.scheduler.jobs).length,2);
});

for(const firstEntry of ['batch','trees'])test(`a pending ${firstEntry} request locks its trees against other dispatch entry points`,async()=>{
 const h=fixture([task()],{deferred:true});
 const first=firstEntry==='batch'?h.controller.startBatch('planned-a'):h.controller.queueTrees([0]);await settle();
 const second=firstEntry==='batch'?h.controller.queueTrees([0,50]):h.controller.startBatch('planned-a');await settle();
 assert.equal(h.verifications.length,1);h.verifications[0].resolve();await Promise.all([first,second]);
 assert.equal(h.scheduler.jobs[50],undefined);assert.equal(h.made.filter(v=>v.index===0).length,1);
});

test('independent zones can finish verification in either order without losing either new task',async()=>{
 const h=fixture([],{deferred:true}),first=h.controller.queueTrees([0]),second=h.controller.queueTrees([50]);await settle();
 assert.equal(h.verifications.length,2);h.verifications[1].resolve();await second;h.verifications[0].resolve();await first;
 assert.equal(h.tasks.length,2);assert.deepEqual(h.tasks.flatMap(t=>t.treeIndices).sort((a,b)=>a-b),[0,50]);
 assert.equal(Object.keys(h.scheduler.jobs).length,2);
});

test('job generation reads the latest unrelated task and decision state after verification',async()=>{
 const other=task({id:'other',site:'xsbn',treeIndices:[50],count:1}),h=fixture([task(),other],{deferred:true});
 const pending=h.controller.startBatch('planned-a');await settle();
 const updated={...other,title:'其他园区最新任务',revision:4};h.tasks=[h.tasks[0],updated];h.decisions={angle:'37'};
 h.verifications[0].resolve();await pending;
 assert.equal(h.scheduler.jobs[0].angle,37);assert.equal(h.scheduler.jobs[1].angle,37);
 assert.equal(h.made[0].tasks.find(t=>t.id==='other').title,updated.title);assert.deepEqual(h.tasks.find(t=>t.id==='other'),updated);
});

for(const invalidation of ['cancelPending','dispose','disabled','fleetUnavailable'])test(`${invalidation} invalidates pending verification before any dispatch`,async()=>{
 const h=fixture([task()],{deferred:true}),pending=h.controller.startBatch('planned-a');await settle();
 if(invalidation==='disabled')h.enabled=false;
 else if(invalidation==='fleetUnavailable')h.ready=false;
 else h.controller[invalidation]();
 h.verifications[0].resolve();await pending;
 assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.tasks[0].railBatch,undefined);assert.equal(h.made.length,0);
});

test('cancelling pending intent permits a new request while the stale network promise remains unresolved',async()=>{
 const h=fixture([task()],{deferred:true}),old=h.controller.startBatch('planned-a');await settle();h.controller.cancelPending();
 const current=h.controller.startBatch('planned-a');await settle();assert.equal(h.verifications.length,2);
 h.verifications[0].resolve();await old;assert.deepEqual(h.scheduler.jobs,{});
 h.verifications[1].resolve();await current;assert.equal(Object.keys(h.scheduler.jobs).length,2);
});

test('a disposed controller refuses new dispatch work',async()=>{
 const h=fixture([task()]);h.controller.dispose();
 await h.controller.startBatch('planned-a');await h.controller.retry('planned-a');await h.controller.queueTrees([50]);
 assert.equal(h.verifications.length,0);assert.deepEqual(h.scheduler.jobs,{});
});

test('batch enqueue refusal rolls back previously accepted jobs and records no invented assignment',async()=>{
 const h=fixture([task()]);h.onEnqueue=(index,value)=>index===1?false:h.enqueue(index,value);
 await h.controller.startBatch('planned-a');
 assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.tasks[0].railBatch,undefined);assert.equal(h.tasks[0].done,0);
 assert.deepEqual(h.retired,[0]);assert.equal(h.scheduler.zones[0].active,null);
});

test('rollback retires only this request’s accepted job identities',async()=>{
 const h=fixture([task()]),replacement=job('newer-independent-job');
 h.onEnqueue=(index,value)=>{
  if(index===0)return h.enqueue(index,value);
  h.retire(0);h.enqueue(0,replacement);return false;
 };
 await h.controller.startBatch('planned-a');
 assert.equal(h.scheduler.jobs[0].id,replacement.id);assert.equal(h.scheduler.jobs[1],undefined);
 assert.deepEqual(h.retired,[]);assert.equal(h.tasks[0].railBatch,undefined);
});

test('a task cancellation immediately before atomic commit rejects the assignment and rolls back all jobs',async()=>{
 const h=fixture([task()]);h.beforeCommit=()=>{h.tasks=[{...h.tasks[0],status:'已取消',revision:8}];};
 await h.controller.startBatch('planned-a');
 assert.equal(h.tasks[0].status,'已取消');assert.equal(h.tasks[0].revision,8);assert.equal(h.tasks[0].railBatch,undefined);
 assert.deepEqual(h.scheduler.jobs,{});assert.deepEqual(h.retired.sort((a,b)=>a-b),[0,1]);
});

test('a partially refused new-tree selection leaves no task records or scheduled work',async()=>{
 const h=fixture([]);h.onEnqueue=(index,value)=>index===50?false:h.enqueue(index,value);
 await h.controller.queueTrees([0,50]);assert.deepEqual(h.tasks,[]);assert.deepEqual(h.scheduler.jobs,{});
 assert.deepEqual(h.retired,[0]);
});

for(const outcome of ['refuse','throw'])test(`atomic fleet admission rolls back a ${outcome} at commit without emitting completion or cancellation receipts`,()=>{
 const receipts=[],scheduler=createZoneScheduler(routes,(index,value)=>receipts.push({index,value,outcome:'completed'}),(index,value)=>receipts.push({index,value,outcome:'cancelled'}),()=>epoch);
 const entries=[{index:0,job:job('atomic-0')},{index:50,job:job('atomic-50')}];
 const apply=()=>commitFleetDispatch(scheduler,entries,()=>{if(outcome==='throw')throw Error('任务提交失败');return false;});
 if(outcome==='throw')assert.throws(apply,/任务提交失败/);else assert.equal(apply(),false);
 assert.deepEqual(scheduler.jobs,{});assert.deepEqual(receipts,[]);
 assert.equal(scheduler.zones[0].active,null);assert.equal(scheduler.zones[1].active,null);
 scheduler.update(20);assert.deepEqual(receipts,[]);
});

test('atomic admission provides an isolated fleet snapshot and preserves a successful batch',()=>{
 const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch),entries=[{index:0,job:job('atomic-0')}];
 const accepted=commitFleetDispatch(scheduler,entries,snapshot=>{
  assert.equal(snapshot.jobs[0].id,'atomic-0');assert.equal(snapshot.zones[0].active,0);
  snapshot.jobs[0].angle=45;snapshot.zones[0].queue.push(49);return true;
 });
 assert.equal(accepted,true);assert.equal(scheduler.jobs[0].angle,28);assert.deepEqual(scheduler.zones[0].queue,[]);
});

test('the attached fleet publishes one complete batch only after its task records have committed',()=>withAttachedFleet((scheduler,subscribe)=>{
 const entries=[{index:0,job:job('published-0')},{index:50,job:job('published-50')}],before=getFleetSnapshot(),observed=[];
 let tasks=[];const enqueue=scheduler.enqueue;
 scheduler.enqueue=(index,value)=>{
  const accepted=enqueue(index,value);
  assert.equal(getFleetSnapshot(),before);assert.equal(observed.length,0);return accepted;
 };
 subscribe(()=>observed.push({fleet:getFleetSnapshot(),tasks:structuredClone(tasks)}));
 assert.equal(dispatchFleetJobs(entries,snapshot=>{
  assert.equal(getFleetSnapshot(),before);assert.equal(observed.length,0);
  assert.deepEqual(Object.keys(snapshot.jobs),['0','50']);
  tasks=entries.map(({index,job:value})=>task({id:value.id,count:1,block:'ABCD'[Math.floor(index/50)],treeIndices:[index],railJob:snapshot.jobs[index]}));
  return true;
 }),true);
 assert.equal(observed.length,1);assert.deepEqual(Object.keys(observed[0].fleet.jobs),['0','50']);
 assert.equal(observed[0].tasks.length,2);
 for(const saved of observed[0].tasks)assert.deepEqual(saved.railJob,observed[0].fleet.jobs[saved.treeIndices[0]]);
}));

test('a rejected attached-fleet commit restores the original snapshot without publishing temporary jobs',()=>withAttachedFleet((_scheduler,subscribe)=>{
 const before=getFleetSnapshot(),observed=[],entries=[{index:0,job:job('rejected-0')},{index:50,job:job('rejected-50')}];
 subscribe(()=>observed.push(getFleetSnapshot()));
 assert.equal(dispatchFleetJobs(entries,snapshot=>{
  assert.deepEqual(Object.keys(snapshot.jobs),['0','50']);assert.equal(getFleetSnapshot(),before);assert.equal(observed.length,0);return false;
 }),false);
 assert.equal(getFleetSnapshot(),before);assert.deepEqual(getFleetSnapshot().jobs,{});assert.deepEqual(observed,[]);
}));

test('target occupation acquired while verification is pending prevents dispatch and preserves the existing fleet job',async()=>{
 const h=fixture([task()],{deferred:true}),pending=h.controller.startBatch('planned-a');await settle();
 h.scheduler.enqueue(1,job('another-task'));h.verifications[0].resolve();await pending;
 assert.equal(h.scheduler.jobs[1].id,'another-task');assert.equal(h.scheduler.jobs[0],undefined);assert.equal(h.tasks[0].railBatch,undefined);
});

for(const patch of [
 {site:'xsbn'},{site:'xian'},{kind:'集胶'},{status:'已取消'},{status:'已完成'},
 {dispatch:{phase:'queued'}},{railResult:{outcome:'completed'}},
 {treeIndices:[-1,0]},{treeIndices:[0,200]},{treeIndices:[0,1.5]},
])test(`manual dispatch rejects unsupported or invalid tasks before verification: ${JSON.stringify(patch)}`,async()=>{
 const h=fixture([task(patch)]);await h.controller.startBatch('planned-a');await h.controller.retry('planned-a');
 assert.equal(h.verifications.length,0);assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.made.length,0);
});

test('new tree dispatch refuses invalid indices instead of partially executing a malformed selection',async()=>{
 for(const indices of [[-1,0],[0,200],[0,1.5],[NaN,0],[]]){
  const h=fixture([]);await h.controller.queueTrees(indices);
  assert.equal(h.verifications.length,0);assert.deepEqual(h.scheduler.jobs,{});assert.deepEqual(h.tasks,[]);
 }
});

test('automatic planning selects only due, explicit Hainan rail schedules',()=>{
 const h=fixture([]),base=task({autoPlanned:true});
 const rejected=[
  {site:'xsbn'},{site:'xian'},{kind:'集胶'},{autoPlanned:false},{status:'已完成'},{status:'已取消'},{status:'待处理'},
  {date:undefined},{date:''},{date:'2026-02-30'},{date:'2026-10-19'},
  {start:'10:01'},{start:'9:00'},{start:'24:00'},{start:'09:60'},
  {railJob:job()},{railBatch:{jobs:{},results:{},baseDone:0}},{dispatch:{phase:'queued'}},
 ];
 const valid=task({id:'due',autoPlanned:true,start:'10:00'});
 const inputs=[...rejected.map((patch,index)=>({...base,id:'invalid-'+index,...patch})),valid];
 assert.equal(findDueRailTask(inputs,h.getFleet(),epoch)?.id,'due');
 assert.equal(findDueRailTask([task({id:'overdue',autoPlanned:true,date:'2026-10-17',start:'23:59'})],h.getFleet(),epoch)?.id,'overdue');
});

test('automatic planning waits for a ready, unoccupied zone and may select another free zone',()=>{
 const h=fixture([]),a=task({id:'a',autoPlanned:true}),b=task({id:'b',autoPlanned:true,block:'B',treeIndices:[50,51]});
 h.scheduler.enqueue(49,job('occupied-a'));
 assert.equal(findDueRailTask([a,b],h.getFleet(),epoch)?.id,'b');
 h.ready=false;assert.equal(findDueRailTask([a,b],h.getFleet(),epoch),undefined);
});

test('automatic planning skips event-held empty zones until explicit event recovery',()=>{
 const h=fixture([]),a=task({id:'a',autoPlanned:true}),b=task({id:'b',autoPlanned:true,block:'B',treeIndices:[50,51]});
 for(const reason of ['A区降雨影响中','A区降雨已解除，待确认恢复']){
  h.scheduler.setEventHold(0,reason);
  assert.equal(findDueRailTask([a],h.getFleet(),epoch),undefined);
  assert.equal(findDueRailTask([a,b],h.getFleet(),epoch),b);
 }
 h.scheduler.setEventHold(0,'');
 assert.equal(findDueRailTask([a,b],h.getFleet(),epoch),a);
 assert.deepEqual(h.scheduler.jobs,{});assert.equal(h.verifications.length,0);
});

test('manual rail start rejects tomorrow or a later start time before validating weather',async()=>{
 for(const patch of [{date:'2026-10-19'},{start:'10:01'}]){
  const h=fixture([task(patch)]);
  await h.controller.startBatch('planned-a');
  assert.equal(h.verifications.length,0);
  assert.deepEqual(h.scheduler.jobs,{});
  assert.equal(h.tasks[0].status,'待开始');
  assert.match(h.notices.at(-1),/不能提前执行/);
 }
});

test('expired adopted plan is neither automatically selected nor manually dispatched',async()=>{
 const expired=task({autoPlanned:true,sourceParkPlanId:'plan-a',end:'09:59'});
 const h=fixture([expired]);
 assert.equal(findDueRailTask([expired],h.getFleet(),epoch),undefined);
 await h.controller.startBatch('planned-a');
 assert.equal(h.verifications.length,0);
 assert.deepEqual(h.scheduler.jobs,{});
 assert.match(h.notices.at(-1),/窗口已结束/);
});

test('rail plan jobs carry their original schedule through dispatch and an HTTP delay cannot overrun it',async()=>{
 const plan=task({sourceParkPlanId:'plan-a',end:'10:01'});
 const h=fixture([plan]);
 await h.controller.startBatch('planned-a');
 for(const value of Object.values(h.scheduler.jobs)){
  assert.deepEqual(value.taskWindow,{notBefore:epoch-3600000,notAfter:epoch+60000});
  assert.equal(value.notAfter,epoch+60000);
 }
 let now=epoch;
 const delayed=fixture([plan],{deferred:true,now:()=>now});
 const result=delayed.controller.startBatch('planned-a');
 now=epoch+60000;
 delayed.verifications[0].resolve();await result;
 assert.deepEqual(delayed.scheduler.jobs,{});
 assert.match(delayed.notices.at(-1),/窗口已结束/);
});
