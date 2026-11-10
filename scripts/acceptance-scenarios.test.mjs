import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAcceptance, ACCEPTANCE_SCENARIOS, FIXED_TIME } from './acceptance-scenarios.mjs';

test('thirteen isolated scenarios use production state machines, retain evidence and never contact a service',async()=>{
  const original=globalThis.fetch;let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw Error('Network is forbidden during acceptance');};
  let report;
  try { report=await runAcceptance(); } finally { globalThis.fetch=original; }
  assert.equal(networkCalls,0);assert.equal(report.modelRequests,0);
  assert.equal(report.clock,FIXED_TIME);assert.equal(report.passed,true,JSON.stringify(report.scenarios.filter(s=>!s.passed)));
  assert.deepEqual(report.scenarios.map(s=>s.id),ACCEPTANCE_SCENARIOS.map(s=>s.id));
  assert.equal(report.scenarios.length,13);
  assert.equal(report.scenarios.slice(0,8).reduce((sum,scene)=>sum+scene.checks.length,0),129,'the original eight scenarios retain their checks');
  assert.equal(report.scenarios.slice(0,10).reduce((sum,scene)=>sum+scene.checks.length,0),189,'the existing operational scenarios retain their checks');
  assert.ok(report.scenarios.reduce((sum,scene)=>sum+scene.checks.length,0)>189);
  for(const scene of report.scenarios){
    assert.ok(scene.checks.length>0&&scene.checks.every(c=>c.passed));
    assert.ok(scene.evidence.runs.length>0);
    for(const run of scene.evidence.runs){
      assert.equal(run.request.generatorMode,'demo_rules');
      assert.ok(run.context&&run.events.length>0);
      assert.ok(run.events.every(e=>!['llm_request','candidate_request'].includes(e.stage)));
      assert.ok(scene.trace.every(e=>Date.parse(e.at)>=Date.parse(FIXED_TIME)));
    }
  }
  const scenes=Object.fromEntries(report.scenarios.map(s=>[s.id,s]));
  assert.equal(scenes.normal.outcome.taskStatus,'执行中');
  assert.equal(scenes.normal.evidence.receipts.length,0);
  assert.equal(scenes.missing.evidence.reviewJobs[0].evidence.circumferenceCm,66);
  assert.equal(scenes.missing.evidence.taskHistory.length,0);
  assert.equal(scenes.rain.evidence.adoptions.length,0);
  for(const id of ['fault','rejected']){
    assert.equal(scenes[id].outcome.taskStatus,'待处理');
    assert.equal(scenes[id].outcome.receiptCount,0);
    assert.equal(scenes[id].outcome.logistics,'暂缓计划');
  }
  assert.equal(scenes.cancelled.outcome.taskStatus,'已取消');
  assert.equal(scenes.cancelled.outcome.done,1);
  assert.deepEqual(scenes.cancelled.evidence.receipts.map(r=>r.outcome),['completed','cancelled']);
  const done=scenes.completed,receipt=done.evidence.receipts[0];
  assert.equal(done.outcome.logistics,'待收胶确认');
  assert.equal(receipt.job.harnessSource.strategyId,done.evidence.adoptions[0].strategyId);
  assert.equal(done.evidence.taskHistory.at(-1).task.railResult.job.id,receipt.job.id);
  const recovery=scenes.recovery,recoveredReceipt=recovery.evidence.receipts[0],dispatched=recovery.evidence.dispatchedJobs[0];
  assert.equal(recovery.outcome.taskStatus,'已完成');
  assert.equal(recovery.outcome.done,1);assert.equal(recovery.outcome.receiptCount,1);
  assert.equal(recovery.outcome.logistics,'待收胶确认');
  assert.equal(recoveredReceipt.outcome,'completed');
  assert.equal(recoveredReceipt.job.id,dispatched.id);assert.equal(recoveredReceipt.index,0);
  assert.equal(recoveredReceipt.job.angle,dispatched.angle);
  assert.deepEqual(recoveredReceipt.job.harnessSource,dispatched.harnessSource);
  assert.ok(recovery.trace.some(event=>event.event==='恢复模拟核验服务'&&event.details.hardwareFault===false));
  assert.ok(recovery.trace.some(event=>event.event==='明确继续暂停区域'));
  const rain=scenes['operational-rain'];
  assert.equal(rain.outcome.taskStatus,'已完成');assert.equal(rain.outcome.receiptCount,1);
  assert.equal(rain.outcome.logistics,'待收胶确认');
  assert.equal(rain.evidence.operationalEvents.length,2);
  assert.ok(rain.evidence.operationalEvents.every(event=>event.kind==='rain'&&event.status==='closed'&&event.resolutionNote&&event.resumeNote));
  assert.ok(rain.trace.some(event=>event.event==='登记异常解除，等待恢复确认'&&event.details.event.status==='resolved'));
  const fault=scenes['operational-fault'];
  assert.equal(fault.outcome.taskStatus,'已完成');assert.equal(fault.outcome.done,2);
  assert.deepEqual(fault.evidence.receipts.map(receipt=>receipt.index),[50,0]);
  assert.equal(fault.evidence.operationalEvents.find(event=>event.siteId==='demo-xsbn').status,'active');
  assert.ok(fault.evidence.operationalEvents.filter(event=>event.siteId==='demo-hainan').every(event=>event.status==='closed'));
  assert.ok(fault.trace.some(event=>event.event==='保留事件发生前的手动暂停'));
  assert.ok(fault.trace.some(event=>event.event==='人工继续原暂停区域'));
  const closed=scenes['logistics-complete'],completeBatch=closed.evidence.logisticsBatches[0];
  assert.equal(closed.outcome.logisticsStage,'received');
  assert.deepEqual([closed.outcome.netKg,closed.outcome.receivedKg],[18,17.8]);
  assert.equal(completeBatch.source.taskId,closed.evidence.taskHistory.at(-1).task.id);
  assert.deepEqual(completeBatch.source.receipts,[closed.evidence.taskHistory.at(-1).task.railResult]);
  assert.deepEqual(completeBatch.history.map(record=>record.action),['collect','weigh','inspect','plan','dispatch','receive']);
  assert.equal(completeBatch.transport.receipt.differenceKg,-0.2);
  const quality=scenes['logistics-quality'].evidence.logisticsBatches[0];
  assert.equal(quality.stage,'cancelled');
  assert.deepEqual(quality.inspections.map(record=>record.decision),['hold','pass']);
  assert.equal(quality.weighing.netKg,18);assert.equal(quality.transport.departure,undefined);
  const held=scenes['logistics-hold'],heldBatch=held.evidence.logisticsBatches[0];
  assert.equal(held.outcome.taskStatus,'已取消');assert.equal(held.outcome.done,1);
  assert.equal(heldBatch.source.taskStatus,'已取消');assert.deepEqual(heldBatch.source.treeIndices,[0]);
  assert.equal(heldBatch.stage,'received');assert.equal(heldBatch.manualHold,undefined);
  assert.ok(held.evidence.operationalEvents.some(event=>event.kind==='rain'&&event.status==='active'));
  assert.ok(heldBatch.history.some(record=>record.action==='pause')&&heldBatch.history.some(record=>record.action==='resume'));
});

test('fresh reruns produce the same business outcome but independent audit identifiers',async()=>{
  const first=await runAcceptance(),second=await runAcceptance();
  assert.equal(first.passed,true);assert.equal(second.passed,true);
  assert.equal(first.repeatabilityDigest,second.repeatabilityDigest);
  assert.deepEqual(first.scenarios.map(s=>s.outcome),second.scenarios.map(s=>s.outcome));
  assert.notEqual(first.scenarios[0].evidence.runs[0].runId,second.scenarios[0].evidence.runs[0].runId);
  assert.deepEqual(first.scenarios[0].evidence.runs[0].context,second.scenarios[0].evidence.runs[0].context);
  assert.deepEqual(first.scenarios[2].evidence.runs.map(r=>r.result.strategy.proposal),second.scenarios[2].evidence.runs.map(r=>r.result.strategy.proposal));
});

test('unknown, duplicate or empty selections cannot silently pass',async()=>{
  for(const ids of [[],['unknown'],['normal','normal']])await assert.rejects(runAcceptance(ids),/场景编号/);
  const selected=await runAcceptance(['rain']);
  assert.equal(selected.passed,true);assert.deepEqual(selected.scenarios.map(s=>s.id),['rain']);
});

test('host timezone cannot change task times or the replay fingerprint',async()=>{
  const moduleUrl=new URL('./acceptance-scenarios.mjs',import.meta.url).href;
  const source=`import {runAcceptance} from ${JSON.stringify(moduleUrl)}; const r=await runAcceptance(['completed']);console.log(JSON.stringify({passed:r.passed,digest:r.repeatabilityDigest,outcome:r.scenarios[0].outcome}));`;
  const results=[];
  for(const TZ of ['UTC','Asia/Shanghai']){
    const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{env:{...process.env,TZ}});
    results.push(JSON.parse(stdout));
  }
  assert.equal(results[0].passed,true);assert.deepEqual(results[0],results[1]);
  assert.equal(results[0].outcome.taskStart,'10:00');assert.equal(results[0].outcome.taskEnd,'10:00');
});
