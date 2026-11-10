import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../backend/src/store.js';
import {SimulationService} from '../../backend/src/simulation.js';
import {TaskSync,fleetJobsToRetire} from '../src/workspace/taskSync.ts';
import {finishRailTask,syncRailTask} from '../src/workspace/railTaskState.ts';
import {createZoneScheduler} from '../src/zoneFleet.ts';

const now='2026-10-17T02:00:00.000Z';
const job=(id='rail-one')=>({id,planVersion:'saved-plan',angle:28,requestedAt:now});
const task=(patch={})=>({id:'rail-one',site:'hainan',title:'割胶任务',block:'A',robot:'R-A',start:'10:00',end:'—',count:1,done:0,status:'待开始',kind:'割胶',treeIndices:[0],railJob:job(),...patch});
const receipt=(index=0,id='rail-one')=>({index,job:job(id),outcome:'completed',finishedAt:now});
function setup(t,initial=task()){
 const store=new Store(':memory:');t.after(()=>store.close());
 const service=new SimulationService(store,()=>new Date(now));
 const saved=service.tasks({tasks:[initial]}).tasks[0];
 return {store,service,saved};
}
function acknowledge(sync,local,response,sent){return sync.receive(local,response.tasks,sent,response.conflicts);}

test('a lost successful response cannot erase the completion produced before the next GET',t=>{
 const {store,service,saved}=setup(t),sync=new TaskSync();sync.receive([saved],[saved]);
 const sent=sync.beginWrite([{...saved,status:'执行中'}]);
 service.tasks({tasks:sent}); // The server commits, but the response never reaches the browser.
 const completed=finishRailTask(sent[0],receipt());
 const recovered=sync.receive([completed],service.latestTasks());
 assert.equal(recovered[0].status,'已完成');assert.equal(recovered[0].done,1);
 assert.deepEqual(recovered[0].railResult,completed.railResult);
 assert.equal(recovered[0].revision,2);assert.deepEqual(sync.pendingWrites(),[]);
 const finalWrite=sync.beginWrite(sync.changes(recovered));
 const final=acknowledge(sync,recovered,service.tasks({tasks:finalWrite}),finalWrite);
 assert.equal(final[0].revision,3);assert.deepEqual(sync.changes(final),[]);
 assert.deepEqual(service.tasks({tasks:finalWrite}).conflicts,[]);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM simulation_task_receipts').get().n,3);
});

test('saved pending snapshots recover a lost response across a page reload',t=>{
 const {service,saved}=setup(t),before=new TaskSync();before.receive([saved],[saved]);
 const sent=before.beginWrite([{...saved,status:'执行中'}]);service.tasks({tasks:sent});
 const persisted=JSON.parse(JSON.stringify({tasks:[finishRailTask(sent[0],receipt())],pending:before.pendingWrites()}));
 const restored=new TaskSync(persisted.pending);
 persisted.pending[0].railJob.angle=99;
 const recovered=restored.receive(persisted.tasks,service.latestTasks());
 assert.equal(recovered[0].status,'已完成');assert.equal(recovered[0].revision,2);
 assert.equal(recovered[0].railResult.job.angle,28);assert.deepEqual(restored.pendingWrites(),[]);
 const final=restored.beginWrite(restored.changes(recovered));
 assert.deepEqual(service.tasks({tasks:final}).conflicts,[]);
});

test('an uncertain write is retried unchanged before a newer local receipt is sent',t=>{
 const {service,saved}=setup(t),sync=new TaskSync();sync.receive([saved],[saved]);
 const sent=sync.beginWrite([{...saved,status:'执行中'}]); // This request never reaches the server.
 const completed=finishRailTask(sent[0],receipt());
 const refreshed=sync.receive([completed],service.latestTasks());
 assert.equal(refreshed[0].status,'已完成');assert.deepEqual(sync.pendingWrites(),sent);
 const retried=sync.beginWrite(sync.changes(refreshed));
 assert.deepEqual(retried,sent);
 const confirmed=acknowledge(sync,refreshed,service.tasks({tasks:retried}),retried);
 assert.equal(confirmed[0].status,'已完成');assert.equal(confirmed[0].revision,2);
 assert.deepEqual(sync.pendingWrites(),[]);
 const final=sync.beginWrite(sync.changes(confirmed));
 assert.equal(final[0].status,'已完成');assert.deepEqual(service.tasks({tasks:final}).conflicts,[]);
});

test('write and persistence snapshots are detached from caller mutations',()=>{
 const initial=task(),sync=new TaskSync();
 const sent=sync.beginWrite([initial]);initial.railJob.angle=99;sent[0].railJob.angle=77;
 const persisted=sync.pendingWrites();assert.equal(persisted[0].railJob.angle,28);
 persisted[0].railJob.angle=66;assert.equal(sync.pendingWrites()[0].railJob.angle,28);
 assert.equal(sync.beginWrite([{...initial,status:'已取消'}])[0].status,'待开始');
});

test('a successful in-flight acknowledgement preserves the newer local completion',t=>{
 const {service,saved}=setup(t),sync=new TaskSync();sync.receive([saved],[saved]);
 const sent=sync.beginWrite([{...saved,status:'执行中'}]);
 const response=service.tasks({tasks:sent});
 const completed=finishRailTask(sent[0],receipt());
 const next=acknowledge(sync,[completed],response,sent);
 assert.equal(next[0].status,'已完成');assert.equal(next[0].revision,2);
 assert.deepEqual(next[0].railResult,completed.railResult);assert.deepEqual(sync.pendingWrites(),[]);
});

test('a genuinely different newer server revision wins over an uncertain local write',t=>{
 const {service,saved}=setup(t),sync=new TaskSync();sync.receive([saved],[saved]);
 const sent=sync.beginWrite([{...saved,status:'执行中'}]);
 const remote=service.tasks({tasks:[{...saved,status:'已取消'}]}).tasks;
 const local=finishRailTask(sent[0],receipt());
 const next=sync.receive([local],remote);
 assert.deepEqual(next,remote);assert.deepEqual(sync.pendingWrites(),[]);assert.deepEqual(sync.changes(next),[]);
});

test('an explicit same-revision refusal wins even before the first successful read',t=>{
 const {service,saved}=setup(t),sync=new TaskSync();
 const invalid={...saved,done:2};const sent=sync.beginWrite([invalid]);
 const response=service.tasks({tasks:sent});
 assert.equal(response.conflicts[0].code,'INVALID_PROGRESS');
 const next=acknowledge(sync,[invalid],response,sent);
 assert.deepEqual(next,[saved]);assert.deepEqual(sync.changes(next),[]);assert.deepEqual(sync.pendingWrites(),[]);
});

test('a refusal with no server record clears the pending write but preserves the local record',t=>{
 const {service}=setup(t),sync=new TaskSync();
 const local=task({id:'not-on-server',revision:9});const sent=sync.beginWrite([local]);
 const response=service.tasks({tasks:sent});assert.equal(response.conflicts[0].task,null);
 const next=acknowledge(sync,[local],response,sent);
 assert.deepEqual(next.find(item=>item.id===local.id),local);assert.deepEqual(sync.pendingWrites(),[]);
 assert.deepEqual(sync.changes(next),[local]);
});

const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
const batch=()=>task({id:'planned-batch',count:2,treeIndices:[0,1],railJob:undefined});
const runningBatch=saved=>({...saved,status:'执行中',railBatch:{jobs:{0:job('batch-zero'),1:job('batch-one')},results:{},baseDone:0}});

test('remote cancellation without job IDs retires the local batch and emits no new receipts',t=>{
 const {service,saved}=setup(t,batch()),sync=new TaskSync();sync.receive([saved],[saved]);
 const local=runningBatch(saved),results=[];
 const fleet=createZoneScheduler(routes,(_,j)=>results.push(j),(_,j)=>results.push(j),()=>Date.parse(now));
 for(const [index,j] of Object.entries(local.railBatch.jobs))fleet.enqueue(+index,j);
 fleet.update(1);
 const remote=service.tasks({tasks:[{...saved,status:'已取消'}]}).tasks;
 const after=sync.receive([local],remote);
 const retire=fleetJobsToRetire([local],after,remote,fleet.jobs);
 assert.deepEqual(retire,[0,1]);for(const index of retire)fleet.retire(index);
 fleet.update(20);assert.deepEqual(results,[]);assert.deepEqual(fleet.jobs,{});
 assert.equal(after[0].status,'已取消');
});

test('retiring batch jobs one at a time cannot reopen an adopted server cancellation',t=>{
 const {service,saved}=setup(t,runningBatch(batch())),sync=new TaskSync();sync.receive([saved],[saved]);
 const results=[],fleet=createZoneScheduler(routes,(_,j)=>results.push(j),(_,j)=>results.push(j),()=>Date.parse(now));
 for(const [index,j] of Object.entries(saved.railBatch.jobs))fleet.enqueue(+index,j);
 fleet.update(1);
 const remote=service.tasks({tasks:[{...saved,status:'已取消'}]}).tasks;
 let after=sync.receive([saved],remote);
 const retire=fleetJobsToRetire([saved],after,remote,fleet.jobs);
 assert.deepEqual(retire,[0,1]);
 for(const index of retire){
  fleet.retire(index);
  // retireFleetJob publishes after each removal, so Workspace immediately
  // synchronizes while another job from this cancelled batch can still exist.
  after=after.map(item=>syncRailTask(item,{ready:true,error:null,zones:fleet.zones,jobs:fleet.jobs},Date.parse(now)));
  assert.equal(after[0],remote[0]);assert.equal(after[0].status,'已取消');
 }
 fleet.update(20);assert.deepEqual(results,[]);assert.deepEqual(sync.changes(after),[]);
});

test('late completion and cancellation receipts cannot change terminal single or batch records',()=>{
 for(const status of ['已完成','已取消'])for(const outcome of ['completed','cancelled']){
  const single=task({status,done:status==='已完成'?1:0});
  const singleReceipt={...receipt(),outcome};
  assert.equal(finishRailTask(single,singleReceipt),single);
  const terminalBatch={...runningBatch(batch()),status,done:status==='已完成'?2:0};
  const batchReceipt={...receipt(0,'batch-zero'),outcome};
  assert.equal(finishRailTask(terminalBatch,batchReceipt),terminalBatch);
  assert.deepEqual(terminalBatch.railBatch.results,{});
 }
});

test('adopted partial batch receipts retire only their completed jobs',t=>{
 const initial=runningBatch(batch()),{service,saved}=setup(t,initial),sync=new TaskSync();sync.receive([saved],[saved]);
 const partial=finishRailTask(saved,receipt(0,'batch-zero'));
 const remote=service.tasks({tasks:[partial]}).tasks,after=sync.receive([saved],remote);
 const fleetJobs={...saved.railBatch.jobs,2:job('unrelated-task')};
 assert.deepEqual(fleetJobsToRetire([saved],after,remote,fleetJobs),[0]);
 assert.equal(after[0].done,1);assert.equal(after[0].status,'执行中');
});

test('a replacement task on the same tree is never retired by an older terminal task',t=>{
 const {service,saved}=setup(t),sync=new TaskSync();sync.receive([saved],[saved]);
 const remote=service.tasks({tasks:[{...saved,status:'已取消'}]}).tasks;
 const after=sync.receive([saved],remote);
 assert.deepEqual(fleetJobsToRetire([saved],after,remote,{0:job('rail-different-task')}),[]);
});

test('preserved in-flight local jobs are not retired by the acknowledgement of an earlier edit',t=>{
 const {service,saved}=setup(t,batch()),sync=new TaskSync();sync.receive([saved],[saved]);
 const sent=sync.beginWrite([{...saved,title:'修改后的计划'}]);
 const remote=service.tasks({tasks:sent});
 const local=runningBatch(sent[0]);
 const after=acknowledge(sync,[local],remote,sent);
 assert.equal(after[0].revision,2);assert.ok(after[0].railBatch);
 assert.deepEqual(fleetJobsToRetire([local],after,remote.tasks,local.railBatch.jobs),[]);
});

test('adopted replacement jobs retire obsolete local jobs without stopping the server jobs',t=>{
 const {service,saved}=setup(t,runningBatch(batch())),sync=new TaskSync();sync.receive([saved],[saved]);
 const replacement={...saved,railBatch:{...saved.railBatch,jobs:{0:job('batch-replacement'),1:saved.railBatch.jobs[1]}}};
 const remote=service.tasks({tasks:[replacement]}).tasks,after=sync.receive([saved],remote);
 assert.deepEqual(fleetJobsToRetire([saved],after,remote,{0:job('batch-zero'),1:job('batch-one'),2:job('batch-replacement')}),[0]);
});

test('an ignored stale remote state cannot retire any current job',()=>{
 const current=runningBatch({...batch(),revision:3}),stale={...current,revision:2,status:'已取消'};
 const sync=new TaskSync();sync.receive([current],[current]);
 const after=sync.receive([current],[stale]);
 assert.deepEqual(fleetJobsToRetire([current],after,[stale],current.railBatch.jobs),[]);
});
