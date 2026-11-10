import test from 'node:test';
import assert from 'node:assert/strict';
import { sameDispatchAttempt, sameDispatchSource, sameDispatchJob, taskEvidence, taskHoldReason, logisticsDependency } from '../src/workspace/taskLifecycleModel.ts';
import { createTaskEvidenceSnapshot, renderTaskEvidenceHtml, taskEvidenceArtifact } from '../src/workspace/taskEvidenceExport.ts';

const now = Date.parse('2026-10-18T02:00:00.000Z');
const at = offset => new Date(now + offset).toISOString();
const source = (patch = {}) => ({ treeId: 'T-0001', strategyId: 'strategy-1', runId: 'run-1', revision: 2, angle: 28,
  adoptedAt: at(-2000), expiresAt: at(60000), mode: 'simulation', dataMode: 'mixed_demo', siteId: 'demo-hainan', ...patch });
const job = (patch = {}) => ({ id: 'rail-one', requestedAt: at(-1000), angle: 28, planVersion: 'harness-2', harnessSource: source(), ...patch });
const receipt = (selected = job(), patch = {}) => ({ index: 0, job: selected, outcome: 'completed', finishedAt: at(0), ...patch });
const task = (selected = job(), result = receipt(selected), patch = {}) => ({ id: 'rail-one', site: 'hainan', title: '单树割胶', block: 'A', robot: 'R-A', start: '08:00', end: '08:15', count: 1, done: 1, status: '已完成', kind: '割胶', treeIndices: [0], railJob: selected, railResult: result, ...patch });
const fleet = (selected, paused = false) => ({ ready: true, error: null, jobs: { 0: selected }, zones: [{ zone: 0, active: 0, paused }] });
const codes = evidence => evidence.issues.map(issue => issue.code);
const deepFreeze = object => {
  if (object && typeof object === 'object') {
    Object.values(object).forEach(deepFreeze);
    Object.freeze(object);
  }
  return object;
};

test('dispatch attempt matching requires a valid exact task ID and request timestamp', () => {
  const selected = job();
  assert.equal(sameDispatchAttempt(selected, structuredClone(selected)), true);
  assert.equal(sameDispatchAttempt(undefined, selected), false);
  assert.equal(sameDispatchAttempt(selected, undefined), false);
  for (const field of ['id', 'requestedAt']) {
    for (const value of [undefined, null, '', ' ', 123]) {
      const invalid = job({ [field]: value });
      assert.equal(sameDispatchAttempt(invalid, invalid), false, `${field}: ${value}`);
      assert.equal(sameDispatchAttempt(selected, invalid), false, `${field}: ${value}`);
    }
  }
  assert.equal(sameDispatchAttempt(selected, job({ id: 'other' })), false);
  assert.equal(sameDispatchAttempt(selected, job({ requestedAt: at(-999) })), false);
  assert.equal(sameDispatchAttempt(job({ requestedAt: 'invalid' }), job({ requestedAt: 'invalid' })), false);
  // Equivalent wall-clock strings are not the same recorded request value.
  assert.equal(sameDispatchAttempt(selected, job({ requestedAt: '2026-10-18T09:59:59.000+08:00' })), false);
});

test('attempt IDs distinguish retries even when their request timestamps are identical', () => {
  const selected = job({ attemptId: 'attempt-new' });
  assert.equal(sameDispatchAttempt(selected, structuredClone(selected)), true);
  for (const attemptId of ['attempt-old', undefined, null, '', ' ', 123]) {
    assert.equal(sameDispatchAttempt(selected, job({ attemptId })), false, String(attemptId));
  }
  for (const attemptId of [null, '', ' ', 123]) {
    const invalid = job({ attemptId });
    assert.equal(sameDispatchAttempt(invalid, invalid), false, String(attemptId));
  }
  assert.equal(sameDispatchAttempt(job(), selected), false);
  assert.equal(sameDispatchAttempt(job(), job()), true, 'legacy dispatches remain compatible');
});

test('attempt, adoption source and complete job matching have independent responsibilities', () => {
  const selected = job({ attemptId: 'attempt-1' });
  for (const patch of [{ angle: 29 }, { planVersion: 'other' }, { harnessSource: source({ revision: 3 }) }]) {
    const changed = job({ attemptId: 'attempt-1', ...patch });
    assert.equal(sameDispatchAttempt(selected, changed), true);
    assert.equal(sameDispatchJob(selected, changed), false);
  }
  assert.equal(sameDispatchSource(selected, job({ harnessSource: source({ revision: 3 }) })), false);
  assert.equal(sameDispatchSource(selected, job({ harnessSource: undefined })), false);
  assert.equal(sameDispatchSource(job({ harnessSource: undefined }), job({ harnessSource: undefined })), true);
  assert.equal(sameDispatchSource(job({ harnessSource: source({ siteId: undefined }) }), selected), true, 'historical Hainan source remains compatible');
  assert.equal(sameDispatchJob(selected, { ...selected, validation: 'invalid', blockedReason: '当前天气' }), true);
});

test('the current retry cannot inherit pause or weather blocks from the earlier attempt', () => {
  const selected = job({ attemptId: 'attempt-new' });
  const running = task(selected, undefined, { status: '执行中', done: 0, railResult: undefined });
  for (const old of [job({ requestedAt: at(-2000), blockedReason: '旧执行失败' }), job({ attemptId: 'attempt-old', weatherBlock: '旧执行雨天' }), job({ weatherBlock: '旧版无执行号' })]) {
    assert.equal(taskHoldReason(running, fleet(old, true), now), null);
    assert.equal(logisticsDependency(running, fleet(old, true), now).state, 'waiting');
  }
  assert.equal(taskHoldReason(running, fleet({ ...selected, weatherBlock: '当前执行雨天' }), now), '当前执行雨天');
  assert.equal(taskHoldReason(running, fleet(selected, true), now), '本区机器人已暂停');
});

test('invalid original request timestamps and attempt IDs invalidate evidence without modifying raw receipts', () => {
  for (const patch of [{ requestedAt: undefined }, { requestedAt: '' }, { requestedAt: 'invalid' }, { requestedAt: 123 }, { attemptId: '' }, { attemptId: ' ' }, { attemptId: null }, { attemptId: 1 }]) {
    const selected = job(patch), result = receipt(selected), input = deepFreeze(task(selected, result));
    const before = structuredClone(input), evidence = taskEvidence(input);
    assert.equal(evidence.hasCompletionRecord, false, JSON.stringify(patch));
    assert.equal(evidence.completedReceipts, 0);
    assert.ok(codes(evidence).includes('job_request_invalid'));
    assert.ok(codes(evidence).includes('receipt_job_invalid'));
    assert.deepEqual(evidence.rawReceipts, [result]);
    assert.deepEqual(input, before);
  }
});

test('receipts from an earlier attempt cannot prove completion after a task ID is reused', () => {
  for (const [selected, received] of [
    [job(), job({ requestedAt: at(-2000) })],
    [job({ attemptId: 'attempt-new' }), job({ attemptId: 'attempt-old' })],
    [job({ attemptId: 'attempt-new' }), job()],
    [job(), job({ attemptId: 'attempt-new' })],
    [job(), job({ requestedAt: 'invalid' })],
    [job(), job({ attemptId: '' })],
  ]) {
    const result = receipt(received), evidence = taskEvidence(task(selected, result));
    assert.equal(evidence.hasCompletionRecord, false);
    assert.equal(evidence.completedReceipts, 0);
    assert.ok(codes(evidence).includes('receipt_attempt_mismatch'));
    assert.deepEqual(evidence.rawReceipts, [result]);
    assert.deepEqual(evidence.sources, [selected.harnessSource]);
    assert.equal(logisticsDependency(task(selected, result), undefined, now).state, 'awaiting-receipt');
  }
});

test('receipt completion time must follow both request and adoption, with equality accepted', () => {
  for (const [selected, finishedAt, accepted] of [
    [job(), at(-1001), false],
    [job(), at(-1000), true],
    [job({ requestedAt: at(-3000) }), at(-2001), false],
    [job({ requestedAt: at(-3000) }), at(-2000), true],
    [job({ harnessSource: undefined }), at(-1001), false],
    [job({ harnessSource: undefined }), at(-1000), true],
  ]) {
    const evidence = taskEvidence(task(selected, receipt(selected, { finishedAt })));
    assert.equal(evidence.hasCompletionRecord, accepted);
    assert.equal(evidence.completedReceipts, accepted ? 1 : 0);
    assert.equal(codes(evidence).includes('receipt_time_invalid'), !accepted);
  }
});

test('batch evidence excludes only stale receipts and preserves all original records for review', () => {
  const first = job({ attemptId: 'attempt-first' });
  const second = job({ id: 'batch-two', attemptId: 'attempt-second', harnessSource: source({ treeId: 'T-0002' }) });
  const valid = receipt(first), stale = receipt({ ...second, attemptId: 'attempt-old' }, { index: 1 });
  const input = deepFreeze(task(undefined, undefined, { count: 2, done: 2, treeIndices: [0, 1], railJob: undefined, railResult: undefined,
    railBatch: { baseDone: 0, jobs: { 0: first, 1: second }, results: { 0: valid, 1: stale } },
  }));
  const before = structuredClone(input), evidence = taskEvidence(input);
  assert.equal(evidence.hasCompletionRecord, false);
  assert.equal(evidence.completedReceipts, 1);
  assert.deepEqual(evidence.receipts, [valid]);
  assert.deepEqual(evidence.rawReceipts, [valid, stale]);
  assert.ok(evidence.issues.some(issue => issue.code === 'receipt_attempt_mismatch' && issue.index === 1));
  assert.deepEqual(input, before);
});

test('HTML and JSON exports retain stale raw receipts, explicit mismatch and zero valid completion', () => {
  const selected = job({ attemptId: 'attempt-new' }), stale = receipt(job({ attemptId: 'attempt-old' }));
  const input = deepFreeze(task(selected, stale)), before = structuredClone(input);
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now);
  const html = renderTaskEvidenceHtml(snapshot);
  const json = JSON.parse(taskEvidenceArtifact(snapshot, 'json').content);
  assert.equal(snapshot.assessment.evidence.hasCompletionRecord, false);
  assert.deepEqual(json.task.railResult, stale);
  assert.deepEqual(json.assessment.evidence.rawReceipts, [stale]);
  assert.match(html, /receipt_attempt_mismatch/);
  assert.match(html, /原始回执 1/);
  assert.match(html, /匹配完成 0/);
  assert.match(html, /attempt-old/);
  assert.match(html, /attempt-new/);
  assert.match(html, /尚不足以确认完整完成记录/);
  assert.deepEqual(input, before);
});

test('valid historical receipts without attempt IDs remain readable for all three parks', () => {
  for (const site of ['hainan', 'xsbn', 'xian']) {
    const selected = job({ harnessSource: source({ siteId: `demo-${site}`, expiresAt: at(-500) }) });
    const input = task(selected, receipt({ ...selected, validation: 'valid' }), { site });
    const evidence = taskEvidence(input);
    assert.equal(evidence.hasCompletionRecord, true, site);
    assert.equal(evidence.completedReceipts, 1);
    assert.deepEqual(evidence.issues, []);
    const snapshot = createTaskEvidenceSnapshot(input, fleet(job({ weatherBlock: '海南当前暂停' }), true), now + 90000);
    assert.equal(snapshot.assessment.evidence.hasCompletionRecord, true);
    assert.equal(snapshot.assessment.currentHoldReason, null);
    assert.equal(snapshot.assessment.downstream.state, 'awaiting-weighing');
  }
});

test('valid dispatch indices exclude invalid original identities, source records and mixed storage', () => {
  assert.deepEqual(taskEvidence(task()).validDispatchIndices, [0]);
  for (const patch of [
    { id: '' }, { planVersion: undefined }, { planVersion: '' }, { angle: NaN },
    { requestedAt: 'invalid' }, { attemptId: '' },
    { harnessSource: source({ siteId: 'demo-xsbn' }) },
    { harnessSource: source({ treeId: 'T-0002' }) },
    { harnessSource: source({ revision: 0 }) },
  ]) {
    const selected = job(patch);
    assert.deepEqual(taskEvidence(task(selected, receipt(selected))).validDispatchIndices, [], JSON.stringify(patch));
  }
  assert.deepEqual(taskEvidence(task(job(), receipt(), { treeIndices: undefined })).validDispatchIndices, []);
  assert.deepEqual(taskEvidence(task(job(), receipt(), { railBatch: { baseDone: 0, jobs: { 0: job() }, results: {} } })).validDispatchIndices, []);
  const valid = job(), invalid = job({ id: 'batch-two', planVersion: '', harnessSource: source({ treeId: 'T-0002' }) });
  const batch = task(undefined, undefined, { count: 2, done: 0, status: '执行中', treeIndices: [0, 1], railJob: undefined, railResult: undefined,
    railBatch: { baseDone: 0, jobs: { 0: valid, 1: invalid }, results: {} },
  });
  assert.deepEqual(taskEvidence(batch).validDispatchIndices, [0]);
  // Receipt validity does not alter the independently validated original dispatch identity.
  assert.deepEqual(taskEvidence(task(job(), receipt(job({ requestedAt: at(-2000) })))).validDispatchIndices, [0]);
});
