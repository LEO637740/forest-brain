import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPurpose,selectReviewJob} from '../src/integration/reviewPurpose.ts';
import {Store} from '../../backend/src/store.js';
import {SimulationService} from '../../backend/src/simulation.js';
import {ReviewWorkflow} from '../../backend/src/review-workflow.js';
import {makeParkContext} from '../../backend/src/adapters/park-demo.js';

const healthy={health:[],reason:'树表存在障碍，需要现场评估'};
const healthIssue={health:[{symptomCodes:['leaf_spot']}],reason:'健康状态需复核'};

test('review purpose follows the operation, preserving health inspection and growth measurement',()=>{
 assert.equal(reviewPurpose('capture',false,healthIssue),'surface');
 assert.equal(reviewPurpose('measure',false,healthIssue),'growth');
 assert.equal(reviewPurpose('inspect',false,healthy),'surface');
 assert.equal(reviewPurpose('inspect',false,healthIssue),'health');
 assert.equal(reviewPurpose('inspect',false,{health:[],reason:'健康状态未知'}),'health');
 assert.equal(reviewPurpose('inspect',true,healthy),'health');
});

test('review selection keeps tree, kind and purpose together while retaining legacy inspect history',()=>{
 const items=[
  {id:'another-tree',treeId:'T-0006',kind:'inspect',purpose:'health'},
  {id:'growth',treeId:'T-0005',kind:'measure',purpose:'growth'},
  {id:'surface-inspect',treeId:'T-0005',kind:'inspect',purpose:'surface'},
  {id:'capture',treeId:'T-0005',kind:'capture',purpose:'surface'},
  {id:'legacy-inspect',treeId:'T-0005',kind:'inspect'},
 ];
 assert.equal(selectReviewJob(items,'T-0005','inspect','health').id,'legacy-inspect');
 assert.equal(selectReviewJob(items,'T-0005','inspect','surface').id,'surface-inspect');
 assert.equal(selectReviewJob(items,'T-0005','capture','surface').id,'capture');
 assert.equal(selectReviewJob(items,'T-0005','measure','growth').id,'growth');
 assert.equal(selectReviewJob(items,'T-0005',undefined,'surface',true).id,'growth');
 assert.equal(selectReviewJob([{treeId:'T-0005',kind:'measure'}],'T-0005','measure','growth').kind,'measure');
 assert.equal(selectReviewJob(items,'T-0099','inspect','health'),undefined);
});

test('a health inspection created from the generic desk writes health evidence when completed',async()=>{
 const store=new Store(),clock=()=>new Date('2026-10-26T02:00:00Z');
 const simulation=new SimulationService(store,clock,{contextFactory:makeParkContext});
 const reviews=new ReviewWorkflow(store,clock,{submit(){throw Error('strategy submission is outside this test');}});
 reviews.simulation=simulation;reviews.refresh=async()=>[];
 try{
  const issue=reviews.issues('demo','demo-hainan').find(item=>item.code==='inspect'&&item.health.length);
  assert.ok(issue,'fixture includes an inspect issue with health observations');
  const purpose=reviewPurpose(issue.code,false,issue);
  const [job]=reviews.create({siteId:'demo-hainan',treeIds:[issue.treeId],kind:issue.code,assignee:'human',purpose});
  reviews.collect(job.id);
  await reviews.complete(job.id,{conclusion:'clear',note:'本次模拟现场核查未见原有健康异常'});
  const context=reviews.apply(makeParkContext({siteId:'demo-hainan',now:clock()}));
  assert.deepEqual(context.modules.health.records.find(record=>record.recordId===job.id)?.symptomCodes,[]);
  assert.equal(selectReviewJob(reviews.jobs('demo-hainan'),issue.treeId,'inspect','health').id,job.id);
 }finally{store.close();}
});
