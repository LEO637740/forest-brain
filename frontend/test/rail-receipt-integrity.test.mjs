import test from 'node:test';
import assert from 'node:assert/strict';
import { finishRailTask, syncRailTask } from '../src/workspace/railTaskState.ts';
import { taskEvidence } from '../src/workspace/taskLifecycleModel.ts';
import { createTaskEvidenceSnapshot, taskEvidenceArtifact } from '../src/workspace/taskEvidenceExport.ts';
import { createZoneScheduler } from '../src/zoneFleet.ts';

const requestedAt = '2026-10-18T00:00:00.000Z';
const finishedAt = '2026-10-18T00:01:00.000Z';
const now = Date.parse(finishedAt);
const source = (index = 0, patch = {}) => ({
  treeId: `T-${String(index + 1).padStart(4, '0')}`, strategyId: `strategy-${index}`, runId: `run-${index}`,
  revision: 2, angle: 28, adoptedAt: '2026-10-17T23:59:00.000Z', expiresAt: '2026-10-18T01:00:00.000Z',
  mode: 'simulation', dataMode: 'mixed_demo', siteId: 'demo-hainan', ...patch,
});
const job = (patch = {}) => ({ id: 'rail-one', requestedAt, attemptId: 'attempt-one', angle: 28, planVersion: 'plan-2', ...patch });
const task = (patch = {}) => ({
  id: 'rail-one', site: 'hainan', title: '回执核对割胶', block: 'A', robot: 'R-A', date: '2026-10-18',
  start: '08:00', end: '—', count: 1, done: 0, status: '执行中', kind: '割胶', treeIndices: [0], railJob: job(), ...patch,
});
const receipt = (savedJob = job(), index = 0, patch = {}) => ({ index, job: structuredClone(savedJob), outcome: 'completed', finishedAt, ...patch });
const batch = (patch = {}) => task({
  id: 'batch-one', railJob: undefined, count: 2, treeIndices: [0, 1],
  railBatch: { baseDone: 0, jobs: { 0: job({ id: 'batch-tree-0' }), 1: job({ id: 'batch-tree-1', attemptId: 'attempt-two' }) }, results: {} },
  ...patch,
});
const fleet = (jobs, patch = {}) => ({
  ready: true, error: null, jobs,
  zones: Array.from({ length: 4 }, (_, zone) => ({ zone, active: zone === 0 ? 0 : null, paused: false, queue: [], phase: 'working', elapsed: 0, completed: 0, distance: 0, retractFrom: 0, ...(zone === 0 ? patch : {}) })),
});
const rejects = (before, result) => {
  const copy = structuredClone(before);
  assert.equal(finishRailTask(before, result), before);
  assert.deepEqual(before, copy, 'a rejected event must not mutate the stored task');
};

test('a valid single-tree receipt preserves its original dispatch and agrees with exported evidence', () => {
  const original = job({ harnessSource: source(), validation: 'required', weatherBlock: '' });
  const before = task({ railJob: original });
  const result = receipt({ ...original, validation: 'valid', weatherBlock: 'later-cache', notAfter: now + 5000 });
  const after = finishRailTask(before, result);
  assert.equal(after.status, '已完成');
  assert.equal(after.done, 1);
  assert.equal(after.end, '08:01');
  assert.equal(after.railJob, original, 'the result must not replace original dispatch evidence');
  assert.equal(after.railResult, result);
  assert.deepEqual(taskEvidence(after).receipts, [result]);
  assert.equal(taskEvidence(after).hasCompletionRecord, true);
  const exported = JSON.parse(taskEvidenceArtifact(createTaskEvidenceSnapshot(after, undefined, now), 'json').content);
  assert.deepEqual(exported.task.railJob, original);
  assert.equal(exported.assessment.evidence.hasCompletionRecord, true);
});

test('single-tree cancellation records no completion and duplicate later events remain inert', () => {
  const before = task();
  const result = receipt(before.railJob, 0, { outcome: 'cancelled' });
  const after = finishRailTask(before, result);
  assert.equal(after.status, '已取消');
  assert.equal(after.done, 0);
  assert.equal(after.railJob, before.railJob);
  assert.equal(taskEvidence(after).cancelledReceipts, 1);
  assert.equal(finishRailTask(after, receipt(before.railJob)), after);
  assert.equal(finishRailTask(after, result), after);
});

for (const [label, patch] of [
  ['a different request time under the same ID', { requestedAt: '2026-10-17T23:58:00.000Z' }],
  ['a different attempt under the same ID and millisecond', { attemptId: 'previous-attempt' }],
  ['an absent attempt ID for an identified attempt', { attemptId: undefined }],
  ['an empty attempt ID', { attemptId: '' }],
  ['an invalid request time', { requestedAt: 'invalid-time' }],
  ['a changed plan version', { planVersion: 'plan-other' }],
  ['a changed cutting angle', { angle: 31 }],
  ['an added strategy source', { harnessSource: source() }],
]) {
  test(`single-tree receipt rejects ${label}`, () => {
    const before = task();
    rejects(before, receipt({ ...before.railJob, ...patch }));
  });
}

test('legacy attempts remain compatible only when both dispatch and receipt lack attempt IDs', () => {
  const before = task({ railJob: job({ attemptId: undefined }) });
  assert.equal(finishRailTask(before, receipt(before.railJob)).status, '已完成');
  rejects(before, receipt({ ...before.railJob, attemptId: 'new-attempt' }));
});

for (const [label, patch] of [
  ['another park', { siteId: 'demo-xsbn' }],
  ['another tree', { treeId: 'T-0002' }],
  ['another strategy', { strategyId: 'strategy-other' }],
  ['another analysis run', { runId: 'run-other' }],
  ['another adoption revision', { revision: 3 }],
  ['a changed adoption time', { adoptedAt: '2026-10-17T23:58:00.000Z' }],
  ['a changed expiry', { expiresAt: '2026-10-18T02:00:00.000Z' }],
  ['a changed data mode', { dataMode: 'demo' }],
]) {
  test(`receipt cannot replace its original source with ${label}`, () => {
    const original = job({ harnessSource: source() });
    const before = task({ railJob: original });
    rejects(before, receipt({ ...original, harnessSource: source(0, patch) }));
  });
}

test('receipt validation rejects invalid original adoption records even when the receipt copies them exactly', () => {
  for (const patch of [
    { siteId: 'demo-xsbn' }, { treeId: 'T-0002' }, { revision: 0 }, { mode: 'live' },
    { adoptedAt: 'bad-time' }, { expiresAt: '2026-10-17T23:58:00.000Z' }, { angle: 31 },
  ]) {
    const before = task({ railJob: job({ harnessSource: source(0, patch) }) });
    rejects(before, receipt(before.railJob));
  }
});

test('receipt completion times must be valid and no earlier than request or adoption', () => {
  for (const badTime of ['', 'invalid', '2026-10-17T23:59:59.999Z']) {
    const before = task();
    rejects(before, receipt(before.railJob, 0, { finishedAt: badTime }));
  }
  const before = task({ railJob: job({ harnessSource: source(0, { adoptedAt: '2026-10-18T00:02:00.000Z' }) }) });
  rejects(before, receipt(before.railJob));
  const sameTime = task();
  assert.equal(finishRailTask(sameTime, receipt(sameTime.railJob, 0, { finishedAt: requestedAt })).status, '已完成');
});

test('valid historical completion is retained when the adopted strategy has expired by review time', () => {
  const original = job({ harnessSource: source(0, { expiresAt: '2026-10-18T00:00:30.000Z' }) });
  const before = task({ railJob: original });
  const after = finishRailTask(before, receipt(original));
  assert.equal(after.status, '已完成');
  const snapshot = createTaskEvidenceSnapshot(after, undefined, now + 86400000);
  assert.equal(snapshot.assessment.evidence.hasCompletionRecord, true);
  assert.equal(snapshot.assessment.currentHoldReason, null);
});

test('unknown outcomes and out-of-range or non-integer receipt indices cannot close a task', () => {
  const before = task();
  for (const outcome of ['failed', 'done', '', undefined]) rejects(before, receipt(before.railJob, 0, { outcome }));
  for (const index of [-1, 0.5, 1, 200, NaN]) rejects(before, receipt(before.railJob, index));
});

test('tasks need a complete explicit target list and the original single-tree dispatch', () => {
  for (const patch of [
    { railJob: undefined }, { railJob: job({ id: 'another-task' }) }, { railJob: job({ requestedAt: undefined }) },
    { treeIndices: undefined }, { treeIndices: [] }, { treeIndices: [0, 0], count: 2 },
    { treeIndices: [0, 1], count: 1 }, { treeIndices: [0], count: 2 }, { treeIndices: [200] },
    { treeIndices: [0], count: 0 },
  ]) {
    const before = task(patch);
    rejects(before, receipt());
    assert.equal(syncRailTask(before, fleet({ 0: job({ weatherBlock: 'rain' }) }), now), before);
  }
});

test('Hainan fleet events never alter other parks, other task kinds, workflow tasks, or terminal tasks', () => {
  for (const patch of [
    { site: 'xsbn' }, { site: 'xian' }, { kind: '巡检' }, { kind: '树表处理' },
    { dispatch: { phase: 'running', history: [] } }, { dispatch: { phase: 'cancelled', history: [] } },
    { status: '已完成', done: 1 }, { status: '已取消' },
  ]) {
    for (const make of [task, batch]) {
      const before = make(patch), expected = before.railBatch?.jobs[0] ?? before.railJob;
      rejects(before, receipt(expected));
      assert.equal(syncRailTask(before, fleet({ 0: { ...expected, weatherBlock: 'foreign-rain' } }), now), before);
    }
  }
});

test('batch completion counts only matching receipts and closes only after all assigned trees reply', () => {
  const before = batch();
  const first = receipt(before.railBatch.jobs[0]);
  const partial = finishRailTask(before, first);
  assert.equal(partial.done, 1);
  assert.equal(partial.status, '执行中');
  assert.equal(partial.end, '—');
  assert.equal(partial.railBatch.jobs, before.railBatch.jobs);
  assert.deepEqual(before.railBatch.results, {});
  rejects(partial, first);
  rejects(partial, receipt(before.railBatch.jobs[0], 0, { outcome: 'cancelled' }));
  const completed = finishRailTask(partial, receipt(before.railBatch.jobs[1], 1));
  assert.equal(completed.status, '已完成');
  assert.equal(completed.done, 2);
  assert.equal(taskEvidence(completed).hasCompletionRecord, true);
  const cancelled = finishRailTask(partial, receipt(before.railBatch.jobs[1], 1, { outcome: 'cancelled' }));
  assert.equal(cancelled.status, '已取消');
  assert.equal(cancelled.done, 1);
  assert.equal(taskEvidence(cancelled).cancelledReceipts, 1);
});

test('batch retry baseline progress is retained without claiming missing historical evidence', () => {
  const before = batch({ count: 3, done: 1, treeIndices: [0, 1, 2] });
  before.railBatch.baseDone = 1;
  const partial = finishRailTask(before, receipt(before.railBatch.jobs[0]));
  assert.equal(partial.done, 2);
  const completed = finishRailTask(partial, receipt(before.railBatch.jobs[1], 1));
  assert.equal(completed.done, 3);
  assert.equal(completed.status, '已完成');
  assert.equal(taskEvidence(completed).hasCompletionRecord, false);
  assert.ok(taskEvidence(completed).issues.some(issue => issue.code === 'prior_completion_unverified'));
});

test('batch receipts reject stale attempts, changed plans, and mismatched storage targets', () => {
  const before = batch();
  for (const patch of [
    { requestedAt: '2026-10-17T23:59:00.000Z' }, { attemptId: 'stale-attempt' }, { angle: 30 },
    { planVersion: 'other-plan' }, { harnessSource: source() },
  ]) rejects(before, receipt({ ...before.railBatch.jobs[0], ...patch }));
  rejects(before, receipt(before.railBatch.jobs[0], 1));
  rejects(before, receipt(before.railBatch.jobs[0], 99));
});

test('untrusted stored batch receipts freeze automatic progress instead of rewriting history', () => {
  const corruptions = [
    before => { before.railBatch.results[99] = receipt(before.railBatch.jobs[0], 99); },
    before => { before.railBatch.results[0] = receipt(before.railBatch.jobs[0], 1); },
    before => { before.railBatch.results[0] = receipt({ ...before.railBatch.jobs[0], attemptId: 'old-attempt' }); },
    before => { before.railBatch.results[0] = receipt(before.railBatch.jobs[0], 0, { outcome: 'unknown' }); },
    before => { before.railBatch.results[0] = receipt(before.railBatch.jobs[0]); }, // done remains zero
    before => { before.done = 1; }, // no receipt accounts for this progress
    before => { before.railBatch.baseDone = -1; },
    before => { before.railBatch.baseDone = 0.5; },
    before => { before.count = 3; before.treeIndices = [0, 1, 2]; }, // missing a dispatch
    before => { before.railBatch.jobs[0] = job({ id: before.railBatch.jobs[1].id }); },
    before => { before.railJob = job(); },
    before => { before.railResult = receipt(); },
  ];
  for (const corrupt of corruptions) {
    const before = batch();
    corrupt(before);
    rejects(before, receipt(before.railBatch.jobs[1], 1));
    assert.equal(syncRailTask(before, fleet({ 1: { ...before.railBatch.jobs[1], weatherBlock: 'rain' } }, { active: 1 }), now), before);
  }
});

test('live sync cannot replace a current dispatch with a stale request or changed adoption', () => {
  for (const make of [task, batch]) {
    const before = make(), expected = before.railBatch?.jobs[0] ?? before.railJob;
    for (const patch of [
      { requestedAt: '2026-10-17T23:59:00.000Z' }, { attemptId: 'other-attempt' },
      { attemptId: undefined }, { harnessSource: source() },
    ]) assert.equal(syncRailTask(before, fleet({ 0: { ...expected, ...patch, weatherBlock: 'stale-rain' } }), now), before);
  }
  const original = job({ harnessSource: source() });
  const before = task({ railJob: original });
  for (const patch of [{ siteId: 'demo-xsbn' }, { revision: 3 }, { treeId: 'T-0002' }]) {
    assert.equal(syncRailTask(before, fleet({ 0: { ...original, harnessSource: source(0, patch), weatherBlock: 'other-source' } }), now), before);
  }
});

test('live sync does not repair malformed original plan, angle, or request evidence', () => {
  for (const make of [task, batch]) {
    for (const patch of [
      { planVersion: undefined }, { planVersion: '' }, { angle: NaN }, { angle: Infinity },
      { requestedAt: undefined }, { requestedAt: 'invalid-time' },
    ]) {
      const before = make();
      const original = { ...(before.railBatch?.jobs[0] ?? before.railJob), ...patch };
      if (before.railBatch) before.railBatch.jobs[0] = original;
      else before.railJob = original;
      const stored = structuredClone(before);
      const live = { ...original, planVersion: 'recovered-live-plan', angle: 30, weatherBlock: 'live-weather' };
      assert.equal(syncRailTask(before, fleet({ 0: live }), now), before);
      assert.deepEqual(before, stored);
      assert.equal(before.railBatch?.jobs[0] ?? before.railJob, original);
    }
  }
});

test('an already invalid original adoption cannot gain live state even with an identical attempt and source', () => {
  for (const make of [task, batch]) {
    for (const patch of [{ siteId: 'demo-xsbn' }, { siteId: 'demo-xian' }, { treeId: 'T-0002' }]) {
      const before = make();
      const original = { ...(before.railBatch?.jobs[0] ?? before.railJob), harnessSource: source(0, patch) };
      if (before.railBatch) before.railBatch.jobs[0] = original;
      else before.railJob = original;
      const stored = structuredClone(before);
      const live = { ...original, validation: 'valid', weatherBlock: 'live-weather' };
      assert.equal(syncRailTask(before, fleet({ 0: live }), now), before);
      assert.deepEqual(before, stored);
      assert.equal(before.railBatch?.jobs[0] ?? before.railJob, original);
      rejects(before, receipt(original));
    }
  }
});

test('live sync accepts mutable validation and weather state without weakening attempt identity', () => {
  const before = task();
  const live = { ...before.railJob, validation: 'pending', strategyBlock: '正在核验', notBefore: now + 60000 };
  const held = syncRailTask(before, fleet({ 0: live }), now);
  assert.equal(held.status, '待处理');
  assert.equal(held.start, '08:02');
  assert.deepEqual(held.railJob, live);
  const ready = { ...live, validation: 'valid', strategyBlock: '', notBefore: now };
  const running = syncRailTask(held, fleet({ 0: ready }), now);
  assert.equal(running.status, '执行中');
  assert.equal(running.railJob.attemptId, before.railJob.attemptId);
});

test('baseline queued plan edits remain synchronized within the same dispatch attempt', () => {
  const before = task({ status: '待开始' });
  const live = { ...before.railJob, planVersion: 'revised-queue-plan', angle: 30, validation: 'required' };
  const synced = syncRailTask(before, fleet({ 0: live }, { active: null, queue: [0], phase: 'idle' }), now);
  assert.equal(synced.railJob.planVersion, 'revised-queue-plan');
  assert.equal(synced.railJob.angle, 30);
  assert.equal(synced.railJob.attemptId, before.railJob.attemptId);
  rejects(synced, receipt(before.railJob));
  assert.equal(finishRailTask(synced, receipt(live)).status, '已完成');
});

test('real scheduler completion and cancellation receipts produce consistent task and export counts', () => {
  const before = batch();
  let current = before;
  const emitted = [];
  const record = outcome => (index, actualJob) => {
    const result = receipt(actualJob, index, { outcome });
    emitted.push(result);
    current = finishRailTask(current, result);
  };
  const routes = Array.from({ length: 4 }, (_, zone) => ({
    zone, points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], distances: [0, 100],
    stations: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [zone * 50 + i, i])),
  }));
  const scheduler = createZoneScheduler(routes, record('completed'), record('cancelled'), () => now);
  assert.equal(scheduler.enqueue(0, before.railBatch.jobs[0]), true);
  assert.equal(scheduler.enqueue(1, before.railBatch.jobs[1]), true);
  assert.equal(scheduler.cancel(1), true);
  assert.equal(current.status, '执行中');
  assert.equal(current.done, 0);
  scheduler.update(1);
  scheduler.update(8);
  assert.equal(emitted.length, 2);
  assert.equal(current.status, '已取消');
  assert.equal(current.done, 1);
  const evidence = taskEvidence(current);
  assert.equal(evidence.completedReceipts, 1);
  assert.equal(evidence.cancelledReceipts, 1);
  assert.equal(evidence.issues.length, 0);
  const snapshot = createTaskEvidenceSnapshot(current, undefined, now);
  assert.equal(snapshot.assessment.downstream.state, 'cancelled');
  assert.deepEqual(snapshot.assessment.evidence.receipts.map(item => item.outcome), ['completed', 'cancelled']);
});
