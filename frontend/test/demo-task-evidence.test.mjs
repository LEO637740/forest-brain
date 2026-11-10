import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemoTaskReceipt} from '../../shared/demoTaskChain.ts';
import {taskEvidence, logisticsDependency} from '../src/workspace/taskLifecycleModel.ts';
import {treeWorkRecords} from '../src/workspace/treeWorkModel.ts';
import {createTaskEvidenceSnapshot, renderTaskEvidenceHtml, taskEvidenceArtifact} from '../src/workspace/taskEvidenceExport.ts';

const generatedAt = '2026-10-19T00:00:00.000Z';
const adoptedAt = '2026-10-19T00:01:00.000Z';
const finishedAt = '2026-10-19T00:02:00.000Z';
function demoTask(site = 'hainan') {
  const task = {id: `demo-${site}-A`, site, title: 'A 区常规割胶', block: 'A', robot: 'R-A',
    start: '08:00', end: '09:00', count: 3, done: 0, status: '执行中', kind: '割胶', treeIndices: [0, 1, 2],
    dispatch: {phase: 'running', skipped: [], history: [{time: adoptedAt, label: '已采用模拟策略'}]},
    demoReceipts: []};
  task.demoStrategy = {strategyId: `${task.id}-strategy`, taskId: task.id, siteId: `demo-${site}`, revision: 1,
    mode: 'simulation', generator: 'demo_rules', generatedAt, adoptedAt, adoptedBy: '演示管理员',
    title: 'A 区常规割胶策略', summary: '按 30° 割胶，完成后逐树回传。', basis: ['模拟天气适合作业'],
    treeIndices: [...task.treeIndices], parameters: {angleDeg: 30, cutDepthMm: 1.2, speedMmPerSec: 12}, surfaceAction: '异常树先复核'};
  return task;
}
function addReceipt(task, index, outcome, note = '模拟机器人已回传') {
  task.demoReceipts.push(makeDemoTaskReceipt(task.demoStrategy, index, outcome, finishedAt, note));
  if (outcome === 'completed') task.done++;
  if (outcome === 'skipped') task.dispatch.skipped.push(index);
}

test('demo progress exposes its strategy and per-tree completion without changing rail evidence', () => {
  const task = demoTask(); addReceipt(task, 0, 'completed');
  const evidence = taskEvidence(task);
  assert.equal(evidence.demoStrategy, task.demoStrategy);
  assert.equal(evidence.demoCompletedReceipts, 1);
  assert.equal(evidence.hasCompletionRecord, false);
  assert.deepEqual(evidence.issues, []);
  assert.deepEqual(evidence.sources, []);
  assert.deepEqual(evidence.receipts, []);
  assert.equal(evidence.completedReceipts, 0);
  const [completed] = treeWorkRecords([task], 0, 'hainan');
  assert.equal(completed.status, '已完成割胶');
  assert.equal(completed.demoReceipt, task.demoReceipts[0]);
  assert.equal(completed.demoStrategy.parameters.angleDeg, 30);
  assert.equal(completed.time, Date.parse(finishedAt));
  assert.match(completed.timeLabel, /回传时间/);
  assert.notEqual(treeWorkRecords([task], 1, 'hainan')[0].status, '已完成割胶');
});

test('completed demo with a skipped tree closes the flow and keeps each outcome explicit', () => {
  const task = demoTask();
  addReceipt(task, 0, 'completed'); addReceipt(task, 1, 'skipped', '隆起树保留复查'); addReceipt(task, 2, 'completed');
  task.status = '已完成'; task.dispatch.phase = 'completed';
  const evidence = taskEvidence(task);
  assert.equal(evidence.hasCompletionRecord, true);
  assert.equal(evidence.completionKind, 'flow');
  assert.equal(evidence.demoCompletedReceipts, 2);
  assert.equal(evidence.demoSkippedReceipts, 1);
  assert.deepEqual(evidence.issues, []);
  assert.equal(treeWorkRecords([task], 1, 'hainan')[0].status, '已跳过 · 待复查');
  assert.equal(logisticsDependency(task).state, 'awaiting-weighing');
});

test('demo cancellation preserves completed trees and names cancelled trees individually', () => {
  const task = demoTask();
  addReceipt(task, 0, 'completed'); addReceipt(task, 1, 'cancelled'); addReceipt(task, 2, 'cancelled');
  task.status = '已取消'; task.dispatch.phase = 'cancelled';
  const evidence = taskEvidence(task);
  assert.equal(evidence.demoCompletedReceipts, 1);
  assert.equal(evidence.demoCancelledReceipts, 2);
  assert.equal(evidence.hasCompletionRecord, false);
  assert.equal(treeWorkRecords([task], 0, 'hainan')[0].status, '已完成割胶');
  assert.equal(treeWorkRecords([task], 1, 'hainan')[0].status, '已取消作业');
});

test('same tree index in different parks retains its own strategy, angle and receipt', () => {
  const first = demoTask(), second = demoTask('hainan-danzhou');
  second.demoStrategy.parameters.angleDeg = 32;
  addReceipt(first, 0, 'completed', '海南完成'); addReceipt(second, 0, 'skipped', '儋州跳过');
  const tasks = [first, second];
  const [local] = treeWorkRecords(tasks, 0, 'hainan');
  const [other] = treeWorkRecords(tasks, 0, 'hainan-danzhou');
  assert.equal(local.demoReceipt.note, '海南完成');
  assert.equal(other.demoReceipt.note, '儋州跳过');
  assert.equal(other.demoReceipt.angleDeg, 32);
  assert.equal(other.task, second);
  const misplaced = structuredClone(first); misplaced.demoReceipts = [...second.demoReceipts];
  const evidence = taskEvidence(misplaced);
  assert.equal(evidence.demoReceipts.length, 0);
  assert.ok(evidence.issues.some(issue => issue.code === 'demo_receipt_mismatch'));
});

test('new demo progress is not accepted as completion without matching per-tree receipts', () => {
  const task = demoTask(); task.status = '已完成'; task.done = 3; task.dispatch.phase = 'completed';
  assert.equal(taskEvidence(task).hasCompletionRecord, false);
  assert.notEqual(treeWorkRecords([task], 0, 'hainan')[0].status, '已完成割胶');
  addReceipt(task, 0, 'completed'); task.done = 1;
  task.demoReceipts[0].strategyRevision = 2;
  assert.equal(taskEvidence(task).demoReceipts.length, 0);
});

test('HTML and JSON export the simulated generation, adoption, parameters and tree outcomes', () => {
  const task = demoTask('hainan-danzhou');
  addReceipt(task, 0, 'completed'); addReceipt(task, 1, 'skipped', '隆起树保留复查'); addReceipt(task, 2, 'completed');
  task.status = '已完成'; task.dispatch.phase = 'completed';
  const snapshot = createTaskEvidenceSnapshot(task, undefined, Date.parse(finishedAt));
  const html = renderTaskEvidenceHtml(snapshot);
  for (const value of ['A 区常规割胶策略', '策略生成时间', '采用时间', '演示管理员', '30° / 深度 1.2 mm / 速度 12 mm/s', '模拟天气适合作业', '隆起树保留复查', '匹配完成 2', '模拟跳过 1', '逐树模拟流程回执'])
    assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /未关联可核对的策略采用记录|暂无通过关联核对的逐树回执|尚不足以确认完整完成记录/);
  const json = JSON.parse(taskEvidenceArtifact(snapshot, 'json').content);
  assert.deepEqual(json.task.demoStrategy, task.demoStrategy);
  assert.deepEqual(json.task.demoReceipts, task.demoReceipts);
});
