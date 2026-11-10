import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../backend/src/store.js';
import {SimulationService} from '../../backend/src/simulation.js';
import {TaskSyncController,parseTaskSyncJournal} from '../src/workspace/taskSyncController.ts';
import {finishRailTask} from '../src/workspace/railTaskState.ts';

const epoch=Date.parse('2026-10-17T02:00:00.000Z');
const timestamp=new Date(epoch).toISOString();
const job={id:'rail-one',planVersion:'saved-plan',angle:28,requestedAt:timestamp};
const task=(patch={})=>({id:'rail-one',site:'hainan',title:'割胶任务',block:'A',robot:'R-A',start:'10:00',end:'—',count:1,done:0,status:'待开始',kind:'割胶',treeIndices:[0],railJob:{...job},...patch});
const receipt={index:0,job,outcome:'completed',finishedAt:timestamp};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function serviceFor(t,seed=true){
 const store=new Store(':memory:');t.after(()=>store.close());
 const service=new SimulationService(store,()=>new Date(epoch));
 const saved=seed?service.tasks({tasks:[task()]}).tasks[0]:null;
 return {store,service,saved};
}
function harness(service,initial,{journal}={}){
 const h={tasks:structuredClone(initial),journal:structuredClone(journal??{pendingWrites:[],rejected:[]}),states:[],writes:[],reads:0,active:0,maxActive:0,applies:0,remoteMerges:0,persists:0,time:epoch};
 h.read=async()=>service.latestTasks();
 h.write=async tasks=>service.tasks({tasks});
 h.persist=value=>{h.journal=structuredClone(value);};
 const track=async fn=>{h.active++;h.maxActive=Math.max(h.maxActive,h.active);try{return await fn();}finally{h.active--;}};
 h.controller=new TaskSyncController({
  getTasks:()=>h.tasks,
  applyTasks:tasks=>{h.applies++;h.tasks=tasks;},
  readTasks:()=>track(()=>{h.reads++;return h.read();}),
  writeTasks:tasks=>track(()=>{h.writes.push(structuredClone(tasks));return h.write(tasks);}),
  persistJournal:value=>{h.persists++;h.persist(value);},
  onState:state=>h.states.push(structuredClone(state)),
  onRemote:()=>{h.remoteMerges++;},
  now:()=>h.time,
  journal,
 });
 h.edit=patch=>{h.tasks=h.tasks.map(current=>({...current,...patch}));h.controller.localChanged();};
 h.state=()=>h.states.at(-1);
 return h;
}

test('a committed write with a lost response reconnects and uploads a newer completion exactly once',async t=>{
 const {store,service,saved}=serviceFor(t),h=harness(service,[saved]),response=deferred();
 await h.controller.refresh();assert.equal(h.state().phase,'synced');
 h.edit({status:'执行中'});
 h.write=async tasks=>{service.tasks({tasks});return response.promise;};
 const sending=h.controller.refresh();await settle();
 assert.equal(h.writes.length,1);assert.equal(service.latestTasks()[0].revision,2);
 h.tasks=[finishRailTask(h.tasks[0],receipt)];h.controller.localChanged();
 response.reject(Error('响应丢失'));await sending;
 assert.equal(h.state().phase,'error');assert.equal(h.state().pendingCount,1);
 assert.equal(h.journal.pendingWrites[0].status,'执行中');
 assert.equal(h.tasks[0].status,'已完成');assert.deepEqual(h.tasks[0].railResult,receipt);
 h.write=async tasks=>service.tasks({tasks});await h.controller.refresh();
 assert.equal(h.reads,2);assert.equal(h.writes.length,2);
 assert.equal(h.writes[1][0].revision,2);assert.equal(h.writes[1][0].status,'已完成');
 assert.equal(h.tasks[0].revision,3);assert.equal(h.tasks[0].done,1);
 assert.deepEqual(service.latestTasks(),h.tasks);assert.deepEqual(h.journal.pendingWrites,[]);
 assert.equal(h.state().phase,'synced');assert.equal(h.state().pendingCount,0);
 await h.controller.refresh(true);
 assert.equal(h.writes.length,2);assert.equal(h.maxActive,1);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM simulation_task_receipts').get().n,3);
});

test('a reloaded journal reconciles an uncertain write before uploading the saved completion',async t=>{
 const {service,saved}=serviceFor(t),before=harness(service,[saved]);
 await before.controller.refresh();before.edit({status:'执行中'});
 before.write=async tasks=>{service.tasks({tasks});throw Error('连接已中断');};
 await before.controller.refresh();
 before.tasks=[finishRailTask(before.tasks[0],receipt)];before.controller.localChanged();
 const savedTasks=JSON.parse(JSON.stringify(before.tasks));
 const savedJournal=parseTaskSyncJournal(JSON.stringify(before.journal));
 before.controller.dispose();
 const restored=harness(service,savedTasks,{journal:savedJournal});
 await restored.controller.refresh();
 assert.equal(restored.writes.length,1);assert.equal(restored.writes[0][0].revision,2);
 assert.equal(restored.writes[0][0].status,'已完成');assert.equal(restored.tasks[0].revision,3);
 assert.deepEqual(restored.tasks[0].railResult,receipt);assert.equal(restored.tasks[0].railResult.job.angle,28);
 assert.deepEqual(restored.journal.pendingWrites,[]);assert.equal(restored.state().phase,'synced');
});

test('an uncertain journal remains pending when the local edit returns to the acknowledged server state',async t=>{
 const {store,service,saved}=serviceFor(t),h=harness(service,[saved]),response=deferred();
 await h.controller.refresh();h.edit({status:'执行中'});
 // The transport fails before reaching the service, so GET still returns revision 1.
 h.write=async()=>{throw Error('请求未送达');};await h.controller.refresh();
 assert.equal(h.journal.pendingWrites[0].status,'执行中');assert.equal(h.writes.length,1);
 h.edit({status:'待开始'});
 assert.deepEqual(h.tasks,[saved]);assert.equal(h.state().pendingCount,1);
 const statesBeforeRecovery=h.states.length;
 let committed;h.write=async tasks=>{committed=service.tasks({tasks});return response.promise;};
 const recovery=h.controller.refresh();await settle();
 assert.equal(h.writes.length,2);assert.deepEqual(h.writes[1],h.writes[0]);
 assert.equal(h.writes[1][0].status,'执行中');assert.equal(h.writes[1][0].revision,1);
 assert.equal(h.journal.pendingWrites.length,1);assert.equal(h.state().pendingCount,1);
 assert.notEqual(h.state().phase,'synced');
 response.resolve(committed);await recovery;
 assert.equal(service.latestTasks()[0].status,'执行中');
 assert.equal(h.tasks[0].status,'待开始');assert.equal(h.tasks[0].revision,2);
 assert.deepEqual(h.journal.pendingWrites,[]);assert.equal(h.state().phase,'pending');
 assert.equal(h.state().pendingCount,1);
 assert.ok(h.states.slice(statesBeforeRecovery).every(state=>state.phase!=='synced'));
 h.write=async tasks=>service.tasks({tasks});await h.controller.refresh();
 assert.equal(h.writes.length,3);assert.equal(h.writes[2][0].status,'待开始');
 assert.equal(h.writes[2][0].revision,2);assert.equal(h.tasks[0].revision,3);
 assert.deepEqual(service.latestTasks(),h.tasks);assert.equal(h.tasks[0].status,'待开始');
 assert.equal(h.state().phase,'synced');assert.equal(h.state().pendingCount,0);
 assert.deepEqual(h.journal.pendingWrites,[]);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM simulation_task_receipts').get().n,3);
});

test('overlapping refreshes share one operation while a forced refresh queues another read',async t=>{
 const {service,saved}=serviceFor(t),h=harness(service,[saved]),response=deferred();
 h.read=async()=>h.reads===1?response.promise:service.latestTasks();
 const first=h.controller.refresh();
 assert.equal(h.controller.refresh(),first);assert.equal(h.controller.refresh(true),first);
 await settle();assert.equal(h.reads,1);assert.equal(h.active,1);
 response.resolve(service.latestTasks());await first;
 assert.equal(h.reads,2);assert.equal(h.writes.length,0);assert.equal(h.maxActive,1);
 assert.equal(h.state().phase,'synced');assert.equal(h.state().busy,false);
});

test('a forced refresh during a write waits for the response and is not swallowed',async t=>{
 const {service,saved}=serviceFor(t),h=harness(service,[saved]),response=deferred();
 await h.controller.refresh();h.edit({status:'执行中'});
 h.write=async tasks=>{const result=service.tasks({tasks});await response.promise;return result;};
 const first=h.controller.refresh();await settle();
 assert.equal(h.controller.refresh(true),first);assert.equal(h.reads,1);assert.equal(h.writes.length,1);
 response.resolve();await first;
 assert.equal(h.reads,2);assert.equal(h.writes.length,1);assert.equal(h.maxActive,1);
 assert.equal(h.tasks[0].revision,2);assert.equal(h.state().phase,'synced');
});

test('a refusal without a server record preserves local work and suppresses unchanged retries across reloads',async t=>{
 const {service}=serviceFor(t,false),h=harness(service,[task({count:-1})]);
 await h.controller.refresh();
 assert.equal(h.writes.length,1);assert.equal(h.state().phase,'conflict');
 assert.equal(h.state().pendingCount,1);assert.equal(h.state().conflicts.length,1);
 assert.equal(h.state().conflicts[0].task,null);assert.equal(h.tasks[0].count,-1);
 assert.deepEqual(service.latestTasks(),[]);assert.deepEqual(h.journal.pendingWrites,[]);
 assert.equal(h.journal.rejected.length,1);
 await h.controller.refresh();await h.controller.refresh(true);
 assert.equal(h.writes.length,1);assert.equal(h.state().phase,'conflict');
 const restored=harness(service,h.tasks,{journal:parseTaskSyncJournal(JSON.stringify(h.journal))});
 h.controller.dispose();await restored.controller.refresh();
 assert.equal(restored.writes.length,0);assert.equal(restored.state().phase,'conflict');
 restored.edit({count:1});await restored.controller.refresh();
 assert.equal(restored.writes.length,1);assert.equal(restored.tasks[0].revision,1);
 assert.equal(restored.state().phase,'synced');assert.deepEqual(restored.state().conflicts,[]);
 assert.deepEqual(restored.journal.rejected,[]);assert.equal(service.latestTasks()[0].count,1);
});

test('a later read failure cannot display synced and the next successful read clears the error',async t=>{
 const {service,saved}=serviceFor(t),h=harness(service,[saved]);
 await h.controller.refresh();assert.equal(h.state().lastSuccessAt,epoch);
 h.time+=10001;h.read=async()=>{throw Error('任务服务不可用');};
 await h.controller.refresh();
 assert.equal(h.state().phase,'error');assert.match(h.state().error,/任务服务不可用/);
 assert.equal(h.state().lastSuccessAt,epoch);assert.equal(h.state().hydrated,true);assert.equal(h.state().busy,false);
 h.read=async()=>service.latestTasks();await h.controller.refresh();
 assert.equal(h.state().phase,'synced');assert.equal(h.state().error,null);
 assert.equal(h.state().lastSuccessAt,h.time);assert.equal(h.reads,3);assert.equal(h.writes.length,0);
});

test('journal persistence must succeed before a POST starts and can recover without losing the edit',async t=>{
 const {service,saved}=serviceFor(t),h=harness(service,[saved]);
 await h.controller.refresh();h.edit({status:'执行中'});
 h.persist=value=>{if(value.pendingWrites.length)throw Error('本地存储已满');h.journal=structuredClone(value);};
 await h.controller.refresh();
 assert.equal(h.writes.length,0);assert.equal(service.latestTasks()[0].status,'待开始');
 assert.equal(h.state().phase,'error');assert.match(h.state().error,/本地存储已满/);
 assert.equal(h.tasks[0].status,'执行中');assert.equal(h.state().pendingCount,1);
 h.persist=value=>{h.journal=structuredClone(value);};
 h.write=async tasks=>{assert.deepEqual(h.journal.pendingWrites,tasks);return service.tasks({tasks});};
 await h.controller.refresh();
 assert.equal(h.writes.length,1);assert.equal(h.tasks[0].revision,2);
 assert.equal(h.state().phase,'synced');assert.deepEqual(h.journal.pendingWrites,[]);
});

test('a disposed controller ignores a late read response and subsequent refresh requests',async t=>{
 const {service,saved}=serviceFor(t),h=harness(service,[saved]),response=deferred();
 h.read=()=>response.promise;const inFlight=h.controller.refresh();await settle();
 h.controller.dispose();
 const before={states:h.states.length,applies:h.applies,merges:h.remoteMerges,persists:h.persists};
 response.resolve(service.tasks({tasks:[{...saved,status:'已取消'}]}).tasks);await inFlight;
 await h.controller.refresh(true);h.controller.localChanged();
 assert.deepEqual({states:h.states.length,applies:h.applies,merges:h.remoteMerges,persists:h.persists},before);
 assert.deepEqual(h.tasks,[saved]);assert.equal(h.reads,1);assert.equal(h.writes.length,0);
});

test('a disposed controller leaves an in-flight write journal recoverable without applying its late response',async t=>{
 const {service,saved}=serviceFor(t),h=harness(service,[saved]),response=deferred();
 await h.controller.refresh();h.edit({status:'执行中'});
 let committed;h.write=async tasks=>{committed=service.tasks({tasks});return response.promise;};
 const inFlight=h.controller.refresh();await settle();h.controller.dispose();
 const before={states:h.states.length,applies:h.applies,merges:h.remoteMerges,persists:h.persists};
 response.resolve(committed);await inFlight;
 assert.deepEqual({states:h.states.length,applies:h.applies,merges:h.remoteMerges,persists:h.persists},before);
 assert.equal(h.tasks[0].revision,1);assert.equal(h.journal.pendingWrites[0].status,'执行中');
 const restored=harness(service,h.tasks,{journal:parseTaskSyncJournal(JSON.stringify(h.journal))});
 await restored.controller.refresh();
 assert.equal(restored.writes.length,0);assert.equal(restored.tasks[0].revision,2);
 assert.equal(restored.state().phase,'synced');assert.deepEqual(restored.journal.pendingWrites,[]);
});
