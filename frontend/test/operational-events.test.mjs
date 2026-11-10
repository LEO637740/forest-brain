import test from 'node:test';
import assert from 'node:assert/strict';
import {eventAffectsTask, eventHoldForTask, eventHoldForZone, eventMatchesTask, taskEventZones} from '../src/workspace/operationalEvents.ts';
import {taskHoldReason, logisticsDependency, logisticsDependencies} from '../src/workspace/taskLifecycleModel.ts';
import {createTaskEvidenceSnapshot, renderTaskEvidenceHtml} from '../src/workspace/taskEvidenceExport.ts';

const now = Date.parse('2026-10-19T03:00:00Z');
const event = (patch = {}) => ({id: 'rain-1', siteId: 'demo-hainan', kind: 'rain', zone: 0, status: 'active', note: '现场持续降雨', createdAt: new Date(now).toISOString(), mode: 'simulation', ...patch});
const task = (patch = {}) => ({id: 'tap-a', site: 'hainan', title: 'A区割胶', date: '2026-10-18', block: 'A', robot: 'R-A', start: '08:00', end: '09:00', kind: '割胶', status: '执行中', treeIndices: [0], count: 1, done: 0, ...patch});
const job = {id: 'tap-a', attemptId: 'attempt-a', requestedAt: '2026-10-19T02:00:00Z', angle: 30, planVersion: 'demo-1'};
const completed = task({status: '已完成', done: 1, railJob: job, railResult: {index: 0, outcome: 'completed', finishedAt: new Date(now).toISOString(), job: {...job}}});

test('event scope uses explicit trees before the display block and never expands the task count', () => {
  const mixed = task({block: 'D', robot: 'R-D', treeIndices: [0, 50, 50, 199], count: 999});
  assert.deepEqual(taskEventZones(mixed), [0, 1, 3]);
  assert.equal(eventAffectsTask(mixed, event({zone: 2})), false);
  assert.equal(eventAffectsTask(mixed, event({zone: 1})), true);
  assert.deepEqual(taskEventZones(task({treeIndices: undefined, block: 'C', count: 999})), [2]);
  assert.deepEqual(taskEventZones(task({treeIndices: [], block: 'C'})), []);
  assert.deepEqual(taskEventZones(task({treeIndices: [-1, 200, 1.5, NaN], block: 'C'})), []);
  for (const block of ['测试区', '', 'A,B']) assert.deepEqual(taskEventZones(task({treeIndices: undefined, block})), []);
});

test('events stay in their own park and preserve all-park rain when a task has no mapped block', () => {
  for (const site of ['xsbn', 'xian']) assert.equal(eventHoldForTask(task({site}), [event()]), null);
  assert.equal(eventHoldForZone('xsbn', 0, [event()]), '');
  assert.equal(eventHoldForZone('hainan', 1, [event()]), '');
  assert.match(eventHoldForTask(task({treeIndices: undefined, block: '未知'}), [event({zone: null})]), /全园区/);
  assert.equal(eventAffectsTask(task({kind: '巡检'}), event({zone: null})), false);
});

test('resolved events remain blocking until the separate recovery confirmation', () => {
  const source = event();
  assert.match(eventHoldForTask(task(), [source]), /现场持续降雨/);
  assert.match(eventHoldForTask(task(), [{...source, status: 'resolved'}]), /已解除，待确认恢复/);
  assert.match(eventHoldForZone('hainan', 0, [{...source, status: 'resolved'}]), /待确认恢复/);
  assert.equal(eventHoldForTask(task(), [{...source, status: 'closed'}]), null);
  assert.equal(eventHoldForZone('hainan', 0, [{...source, status: 'closed'}]), '');
});

test('rain and equipment faults remain independent and their combined reasons are visible', () => {
  const rain = event(), fault = event({id: 'fault-1', kind: 'device_fault', note: '割胶头检修'});
  const combined = eventHoldForTask(task(), [rain, fault]);
  assert.match(combined, /降雨影响/); assert.match(combined, /设备故障/); assert.match(combined, /割胶头检修/);
  assert.equal(eventHoldForTask(task(), [{...rain, status: 'closed'}, fault]), eventHoldForTask(task(), [fault]));
  assert.equal(eventHoldForZone('hainan', 0, [rain, fault]), combined);
});

test('completed cutting keeps its receipts; only rain can block its downstream preparation', () => {
  const before = structuredClone(completed), rain = event(), fault = event({kind: 'device_fault'});
  assert.equal(eventHoldForTask(completed, [rain, fault]), null);
  assert.equal(eventHoldForTask(completed, [fault], true), null);
  assert.match(eventHoldForTask(completed, [rain], true), /降雨影响/);
  assert.equal(taskHoldReason(completed, undefined, now, [rain]), null);
  const downstream = logisticsDependency(completed, undefined, now, [rain]);
  assert.equal(downstream.state, 'blocked');
  assert.equal(downstream.evidence.completedReceipts, 1);
  assert.equal(downstream.evidence.hasCompletionRecord, true);
  assert.equal(logisticsDependency(completed, undefined, now, [fault]).state, 'awaiting-weighing');
  assert.deepEqual(completed, before);
});

test('cancelled tasks remain stopped rather than being restored by an event transition', () => {
  for (const patch of [{status: '已取消'}, {dispatch: {phase: 'cancelled'}}]) {
    const cancelled = task(patch);
    assert.equal(eventHoldForTask(cancelled, [event()], true), null);
    assert.equal(logisticsDependency(cancelled, undefined, now, [event()]).state, 'cancelled');
  }
});

test('live event hold is tied to the same dispatch, and clearing events does not clear manual pause', () => {
  const pending = task({railJob: {...job}});
  const live = {ready: true, error: null, jobs: {0: {...job}}, zones: [{zone: 0, active: 0, queue: [], paused: true, eventHoldReason: 'R-A设备检修'}]};
  assert.equal(taskHoldReason(pending, live, now), 'R-A设备检修');
  live.zones[0].eventHoldReason = '';
  assert.equal(taskHoldReason(pending, live, now, [event({status: 'closed'})]), '本区机器人已暂停');
  live.jobs[0].attemptId = 'another-attempt';
  assert.equal(taskHoldReason(pending, live, now), null);
});

test('past unfinished tasks and downstream rows share event causes without changing task states', () => {
  const pending = task({status: '待开始'}), before = structuredClone(pending), events = [event()];
  assert.match(taskHoldReason(pending, undefined, now, events), /现场持续降雨/);
  const rows = logisticsDependencies([pending, task({id: 'other', site: 'xsbn'}), task({id: 'inspect', kind: '巡检'})], undefined, now, events);
  assert.deepEqual(rows.map(row => row.state), ['blocked', 'waiting']);
  assert.deepEqual(pending, before);
});

test('evidence exports retain only this task scope events, including closed history, with a click-time copy', () => {
  const events = [event(), event({id: 'closed-fault', kind: 'device_fault', status: 'closed', note: '<script>故障已处理</script>', closedAt: new Date(now).toISOString(), resumeNote: '人工核对通过'}), event({id: 'foreign', siteId: 'demo-xsbn'}), event({id: 'other-zone', zone: 2})];
  const snapshot = createTaskEvidenceSnapshot(completed, undefined, now, events);
  assert.deepEqual(snapshot.operationalEvents.map(value => value.id), ['rain-1', 'closed-fault']);
  assert.equal(snapshot.assessment.currentHoldReason, null);
  assert.equal(snapshot.assessment.downstream.state, 'blocked');
  events[0].status = 'closed';
  assert.equal(snapshot.operationalEvents[0].status, 'active');
  const html = renderTaskEvidenceHtml(snapshot);
  assert.match(html, /天气与设备事件记录/); assert.match(html, /&lt;script&gt;故障已处理&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|other-zone|foreign/);
  assert.equal(eventMatchesTask(completed, events[1]), true);
});
