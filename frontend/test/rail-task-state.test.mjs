import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {finishRailTask,syncRailTask} from '../src/workspace/railTaskState.ts';

const finishedAt='2026-10-17T01:00:00.000Z';
const job=(id='rail-one')=>({id,planVersion:'fixture-v1',angle:30,requestedAt:'2026-10-17T00:00:00.000Z'});
const task=(patch={})=>({id:'rail-one',site:'hainan',title:'验收割胶',block:'A',robot:'R-A',start:'08:00',end:'08:15',count:1,done:0,status:'执行中',kind:'割胶',treeIndices:[0],railJob:job(),...patch});
const receipt=(patch={})=>({index:0,job:job(),outcome:'completed',finishedAt,...patch});
const batch=()=>task({id:'batch-one',railJob:undefined,count:3,done:1,treeIndices:[0,1,2],railBatch:{baseDone:1,jobs:{1:job('rail-two'),2:job('rail-three')},results:{}}});

test('a matching completion or cancellation receipt closes the single-tree task',()=>{
 for(const outcome of ['completed','cancelled']){
  const before=task(),result=receipt({outcome}),after=finishRailTask(before,result);
  assert.equal(after.status,outcome==='completed'?'已完成':'已取消');
  assert.equal(after.done,outcome==='completed'?1:0);
  assert.equal(after.railResult,result);
  assert.equal(after.railJob,before.railJob);
  assert.equal(after.end,'09:00');
  assert.equal(before.status,'执行中');
 }
});

test('single-tree duplicate and foreign task receipts do not advance or replace the result',()=>{
 const before=task();
 assert.equal(finishRailTask(before,receipt({job:job('other-task')})),before);
 assert.equal(finishRailTask(before,receipt({job:undefined})),before);
 assert.equal(finishRailTask(before,receipt({index:1})),before);
 const unlinked=task({treeIndices:undefined});
 assert.equal(finishRailTask(unlinked,receipt()),unlinked);
 for(const outcome of ['completed','cancelled']){
  const after=finishRailTask(before,receipt({outcome}));
  assert.equal(finishRailTask(after,receipt()),after);
  assert.equal(finishRailTask(after,receipt({outcome:'cancelled'})),after);
 }
});

test('batch receipts preserve prior progress and close only after every assigned job replies',()=>{
 const before=batch();
 const partial=finishRailTask(before,receipt({index:1,job:job('rail-two')}));
 assert.equal(partial.done,2);
 assert.equal(partial.status,'执行中');
 assert.equal(partial.end,before.end);
 assert.deepEqual(before.railBatch.results,{});
 const completed=finishRailTask(partial,receipt({index:2,job:job('rail-three')}));
 assert.equal(completed.done,3);
 assert.equal(completed.status,'已完成');
 assert.equal(Object.keys(completed.railBatch.results).length,2);
 const cancelled=finishRailTask(partial,receipt({index:2,job:job('rail-three'),outcome:'cancelled'}));
 assert.equal(cancelled.done,2);
 assert.equal(cancelled.status,'已取消');
 assert.equal(cancelled.railBatch.results[2].outcome,'cancelled');
});

test('duplicate, wrong-job and wrong-index batch receipts cannot count progress',()=>{
 const before=batch();
 for(const result of [
  receipt({index:1,job:job('other-task')}),
  receipt({index:1,job:job('rail-three')}),
  receipt({index:99,job:job('rail-two')}),
  receipt({index:1,job:undefined}),
  receipt({index:99,job:undefined}),
 ])assert.equal(finishRailTask(before,result),before);
 const partial=finishRailTask(before,receipt({index:1,job:job('rail-two')}));
 assert.equal(finishRailTask(partial,receipt({index:1,job:job('rail-two')})),partial);
 assert.equal(finishRailTask(partial,receipt({index:1,job:job('rail-two'),outcome:'cancelled'})),partial);
 assert.equal(partial.done,2);
});

const now=Date.parse('2026-10-17T00:00:00.000Z');
const fleet=(jobs,patch={})=>({ready:true,error:null,jobs,zones:[{zone:0,active:0,paused:false,...patch}]});

test('single-tree synchronization uses the supplied clock for waiting, running and held states',()=>{
 const before=task({status:'待开始'}),scheduled={...job(),notBefore:now+60000};
 const waiting=syncRailTask(before,fleet({0:scheduled}),now);
 assert.equal(waiting.status,'待开始');
 assert.equal(waiting.start,'08:01');
 assert.equal(syncRailTask(waiting,fleet({0:scheduled}),now+60000).status,'执行中');
 assert.equal(syncRailTask(before,fleet({0:job()}),now).status,'执行中');
 assert.equal(syncRailTask(before,fleet({0:job()},{paused:true}),now).status,'待处理');
 assert.equal(syncRailTask(before,fleet({0:{...job(),weatherBlock:'降雨暂缓'}}),now).status,'待处理');
 const expiring={...job(),notAfter:now+60000};
 assert.equal(syncRailTask(before,fleet({0:expiring}),now).status,'执行中');
 assert.equal(syncRailTask(before,fleet({0:expiring}),now+60000).status,'待处理');
 assert.equal(syncRailTask(before,fleet({0:job('different-task')}),now),before);
});

test('batch synchronization uses the same fixed clock and ignores already received jobs',()=>{
 const before=batch(),scheduled={...job('rail-two'),notBefore:now+60000};
 const snapshot=fleet({1:scheduled},{active:1});
 assert.equal(syncRailTask(before,snapshot,now).status,'待开始');
 assert.equal(syncRailTask(before,snapshot,now+60000).status,'执行中');
 assert.equal(syncRailTask(before,fleet({1:scheduled},{active:1,paused:true}),now).status,'待处理');
 assert.equal(syncRailTask(before,fleet({1:{...job('rail-two'),notAfter:now}},{active:1}),now).status,'待处理');
 const partial=finishRailTask(before,receipt({index:1,job:job('rail-two')}));
 assert.equal(syncRailTask(partial,snapshot,now),partial);
});

test('task times stay in China time when the process runs in other time zones',()=>{
 const moduleUrl=new URL('../src/workspace/railTaskState.ts',import.meta.url).href;
 const scheduled={...job(),notBefore:now+60000};
 const script=`
  import {finishRailTask,syncRailTask} from ${JSON.stringify(moduleUrl)};
  const single=finishRailTask(${JSON.stringify(task())},${JSON.stringify(receipt())});
  let batch=finishRailTask(${JSON.stringify(batch())},${JSON.stringify(receipt({index:1,job:job('rail-two')}))});
  batch=finishRailTask(batch,${JSON.stringify(receipt({index:2,job:job('rail-three')}))});
  const waiting=syncRailTask(${JSON.stringify(task())},${JSON.stringify(fleet({0:scheduled}))},${now});
  console.log(JSON.stringify({single:single.end,batch:batch.end,waiting:waiting.start}));
 `;
 for(const timeZone of ['UTC','America/Los_Angeles']){
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ:timeZone}});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{single:'09:00',batch:'09:00',waiting:'08:01'},timeZone);
 }
});
