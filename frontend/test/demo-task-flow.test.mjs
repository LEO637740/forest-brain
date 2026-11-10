import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemoTasks} from '../../backend/src/adapters/demo-tasks.js';
import {adoptDemoTaskStrategy,advanceDemo,resolveSurface,transitionTask} from '../src/workspace/taskFlow.ts';
import {taskEvidence} from '../src/workspace/taskLifecycleModel.ts';

const now=Date.parse('2026-10-19T02:00:00Z');
const sample=block=>makeDemoTasks(new Date(now)).find(task=>task.site==='hainan'&&task.block===block);
const play=task=>({...task,dispatch:{...task.dispatch,auto:{stage:'travel',startedAt:now,nextAt:now+1000}}});
function finish(task){
 for(let steps=0;task.dispatch.phase!=='completed';steps++){
  assert.ok(steps<100,'The finite target list must finish');
  task=advanceDemo(task,task.dispatch.auto.nextAt);
 }
 return task;
}

test('a pending sample adopts its generated strategy and returns every tree result through the demo clock',()=>{
 const pending=sample('A');
 assert.equal(pending.demoStrategy.adoptedAt,null);
 const adopted=adoptDemoTaskStrategy(pending,new Date(now+500).toISOString());
 assert.equal(adoptDemoTaskStrategy(adopted),adopted);
 assert.equal(pending.demoStrategy.adoptedAt,null);
 assert.equal(adopted.dispatch.history.at(-1).label,`采用模拟作业方案：${adopted.demoStrategy.title}`);
 const completed=finish(play(adopted));
 assert.equal(completed.done,30);
 assert.equal(completed.demoReceipts.length,30);
 assert.deepEqual(completed.demoReceipts.map(r=>r.treeIndex),pending.treeIndices);
 assert.ok(completed.demoReceipts.every(r=>r.strategyId===pending.demoStrategy.strategyId&&r.strategyRevision===1&&r.angleDeg===pending.demoStrategy.parameters.angleDeg&&r.outcome==='completed'));
 assert.equal(taskEvidence(JSON.parse(JSON.stringify(completed))).hasCompletionRecord,true);
 assert.deepEqual(taskEvidence(completed).issues,[]);
 assert.equal(advanceDemo(completed,now+1e6),completed);
});

test('continuing a seeded task preserves existing receipts and appends the remaining results',()=>{
 const running=sample('B'),completed=finish(play(running));
 assert.equal(completed.demoReceipts.length,running.count);
 assert.deepEqual(completed.demoReceipts.slice(0,running.done),running.demoReceipts);
 assert.equal(taskEvidence(completed).demoCompletedReceipts,36);
});

for(const action of ['adopt','skip'])test(`surface ${action} continues the same strategy and records the actual tree decision`,()=>{
 const review=sample('C'),index=review.dispatch.incident.treeIndex;
 const resumed=resolveSurface(play(review),action,now+1000);
 const completed=finish(resumed),receipt=completed.demoReceipts.find(r=>r.treeIndex===index);
 assert.equal(receipt.outcome,action==='skip'?'skipped':'completed');
 assert.match(receipt.note,action==='skip'?/跳过/:/避让/);
 assert.equal(completed.done,action==='skip'?27:28);
 assert.equal(completed.demoReceipts.length,28);
 assert.equal(taskEvidence(completed).hasCompletionRecord,true);
});

test('cancel acknowledgement keeps finished results and returns cancellation for the remaining targets',()=>{
 const running=sample('B');
 const requested=transitionTask(running,'cancel',new Date(now+1000).toISOString());
 assert.deepEqual(requested.demoReceipts,running.demoReceipts);
 const cancelled=transitionTask(requested,'ack',new Date(now+2000).toISOString());
 assert.equal(cancelled.done,12);
 assert.deepEqual(cancelled.demoReceipts.slice(0,12),running.demoReceipts);
 assert.equal(cancelled.demoReceipts.filter(r=>r.outcome==='cancelled').length,24);
 assert.equal(taskEvidence(cancelled).hasCompletionRecord,false);
 assert.equal(transitionTask(cancelled,'ack'),cancelled);
});
