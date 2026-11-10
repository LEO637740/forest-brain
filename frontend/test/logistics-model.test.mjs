import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionSource,collectionIssue,batchActionIssue,batchHoldReason} from '../../shared/logistics.ts';

const at='2026-10-19T02:00:00Z';
const job=index=>({id:'job-'+index,attemptId:'attempt-'+index,planVersion:'baseline-v1',angle:30,requestedAt:at});
function sourceTask(cancelled=false){
 const jobs={0:job(0),50:job(50)},results=Object.fromEntries(Object.entries(jobs).map(([index,job])=>[index,{index:+index,job,outcome:cancelled&&+index===50?'cancelled':'completed',finishedAt:at}]));
 return {id:'source',site:'hainan',revision:3,title:'两区割胶',kind:'割胶',status:cancelled?'已取消':'已完成',block:'A',robot:'R-A',start:'08:00',end:'09:00',treeIndices:[0,50],count:2,done:cancelled?1:2,railBatch:{jobs,results,baseDone:0}};
}
const event=patch=>({id:'rain',siteId:'demo-hainan',kind:'rain',zone:0,status:'active',note:'A区雨情',createdAt:at,mode:'simulation',...patch});
const batch=(stage='collected',patch={})=>({id:'batch',siteId:'demo-hainan',stage,revision:1,source:collectionSource(sourceTask(true)),...patch});

test('collection source snapshots verified completed trees after a partial cancellation, without estimating kilograms',()=>{
 const task=sourceTask(true),before=structuredClone(task),source=collectionSource(task);
 assert.deepEqual(source.treeIndices,[0]);assert.equal(source.completedTrees,1);assert.equal(source.taskRevision,3);
 assert.equal(source.taskStatus,'已取消');assert.equal(source.receipts.length,1);assert.equal(source.receipts[0].outcome,'completed');
 assert.equal('kg' in source,false);assert.deepEqual(task,before);
});
test('collection requires a closed tapping task and verified receipts, rather than a completion label or count',()=>{
 for(const task of [
  {...sourceTask(),status:'执行中'}, {...sourceTask(),kind:'巡检'}, {...sourceTask(),site:'xian'},
  {...sourceTask(),railBatch:undefined}, {...sourceTask(),done:1},
 ])assert.equal(collectionSource(task),null);
 const stale=sourceTask();stale.railBatch.results[0].job={...stale.railBatch.jobs[0],attemptId:'old-attempt'};
 assert.equal(collectionSource(stale),null);
 const missing=sourceTask();delete missing.railBatch.results[50];assert.equal(collectionSource(missing),null);
});
test('an explicit completed demo flow is eligible and skipped trees are excluded',()=>{
 const task={...sourceTask(),railBatch:undefined,count:2,done:1,dispatch:{phase:'completed',skipped:[50],history:[{time:at,label:'模拟流程结束'}]}};
 assert.deepEqual(collectionSource(task).treeIndices,[0]);assert.equal(collectionSource(task).completionKind,'flow');
 assert.equal(collectionSource({...task,treeIndices:undefined}),null);
});
test('new collection respects only the completed source trees, current park and unclosed rain facts',()=>{
 const task=sourceTask(true);
 assert.match(collectionIssue(task,[event({})]),/A区雨情/);
 assert.match(collectionIssue(task,[event({status:'resolved'})]),/待确认恢复/);
 for(const e of [event({zone:1}),event({siteId:'demo-xsbn'}),event({status:'closed'}),event({kind:'device_fault'})])assert.equal(collectionIssue(task,[e]),null);
 assert.match(collectionIssue(task,[],[batch()]),/已登记/);
});
test('step eligibility is sequential, and quality hold can only progress through an explicit retest',()=>{
 for(const [stage,action] of [['collected','weigh'],['weighed','inspect'],['quality-held','inspect'],['ready','plan'],['planned','dispatch'],['in-transit','receive']])assert.equal(batchActionIssue(batch(stage),action,[]),null);
 for(const [stage,action] of [['collected','inspect'],['weighed','dispatch'],['quality-held','plan'],['planned','receive'],['ready','weigh']])assert.ok(batchActionIssue(batch(stage),action,[]));
 assert.match(batchHoldReason(batch('quality-held'),[]),/复检/);
});
test('rain holds departure while allowing indoor records and an arrival that has already happened',()=>{
 const events=[event({status:'resolved'})];
 assert.match(batchActionIssue(batch('planned'),'dispatch',events),/待确认恢复/);
 for(const [stage,action] of [['collected','weigh'],['weighed','inspect'],['ready','plan'],['in-transit','receive']])assert.equal(batchActionIssue(batch(stage),action,events),null);
 assert.match(batchHoldReason(batch('in-transit'),events),/A区雨情/);
 assert.equal(batchActionIssue(batch('planned'),'dispatch',[event({kind:'device_fault'})]),null);
});
test('manual pause and rain are independent; resuming one never fabricates a later business step',()=>{
 const paused=batch('planned',{manualHold:{at,operator:'经办人',note:'待交接'}}),before=structuredClone(paused),events=[event({})];
 assert.match(batchActionIssue(paused,'dispatch',[]),/手工暂停/);
 assert.equal(batchActionIssue(paused,'resume',events),null);
 assert.match(batchHoldReason(paused,events),/待交接.*A区雨情/);
 const {manualHold,...resumed}=paused;assert.match(batchActionIssue(resumed,'dispatch',events),/A区雨情/);
 assert.deepEqual(paused,before);assert.equal(resumed.stage,'planned');
});
test('cancellation cannot erase an in-transit shipment or rewrite a terminal batch',()=>{
 assert.equal(batchActionIssue(batch('planned'),'cancel',[]),null);
 assert.match(batchActionIssue(batch('in-transit'),'cancel',[]),/不能取消/);
 for(const stage of ['received','cancelled']){
  assert.ok(batchActionIssue(batch(stage),'pause',[]));assert.ok(batchActionIssue(batch(stage),'weigh',[]));
  assert.equal(batchHoldReason(batch(stage),[event({})]),null);
 }
});
