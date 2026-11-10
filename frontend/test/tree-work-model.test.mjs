import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { treeWorkRecords } from '../src/workspace/treeWorkModel.ts';

const requestedAt = '2026-10-18T00:00:00.000Z';
const finishedAt = '2026-10-18T01:00:00.000Z';
const job = (patch = {}) => ({ id: 'rail-one', attemptId: 'attempt-one', planVersion: 'plan-v1', angle: 30, requestedAt, ...patch });
const result = (original = job(), patch = {}) => ({ index: 0, job: original, outcome: 'completed', finishedAt, ...patch });
const task = (patch = {}) => ({ id: 'rail-one', site: 'hainan', title: '本树割胶', block: 'A', robot: 'Robot A', start: '08:00', end: '08:30', count: 1, done: 0, status: '执行中', kind: '割胶', treeIndices: [0], ...patch });
const single = (patch = {}) => task({ railJob: job(), ...patch });
const batch = (patch = {}) => task({ id: 'batch-one', treeIndices: [0, 1], count: 2,
  railBatch: { baseDone: 0, jobs: { 0: job(), 1: job({ id: 'rail-two', attemptId: 'attempt-two' }) }, results: {} }, ...patch });
const flow = (patch = {}) => task({ id: 'flow-one', count: 3, done: 1, treeIndices: [0, 1, 2], dispatch: {
  phase: 'running', requestId: 'request-flow', skipped: [1], history: [
    { time: requestedAt, label: '开始模拟流程' }, { time: finishedAt, label: '完成第一树并跳过第二树' },
  ], auto: { nextAt: Date.parse(finishedAt) + 1000, startedAt: Date.parse(finishedAt), stage: 'travel' },
}, ...patch });
const one = (value, index = 0, site = 'hainan') => {
  const records = treeWorkRecords([value], index, site);
  assert.equal(records.length, 1);
  assert.equal(records[0].task, value, 'retain the original task for detail navigation');
  return records[0];
};
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

test('tree records require the selected site and an explicit matching tree index', () => {
  const local = single(), otherSite = single({ site: 'xsbn' }), differentTree = single({ treeIndices: [1] });
  const inferredBlock = single({ treeIndices: undefined });
  assert.deepEqual(treeWorkRecords([otherSite, differentTree, inferredBlock, local], 0, 'hainan').map(record => record.task), [local]);
  assert.deepEqual(treeWorkRecords([local, otherSite], 0, 'xsbn').map(record => record.task), [otherSite]);
  for (const index of [-1, 200, 0.5, NaN, '0']) assert.deepEqual(treeWorkRecords([local], index, 'hainan'), []);
});

test('a verified single-tree completion retains its original dispatch and receipt', () => {
  const original = job(), receipt = result(original), value = single({ railJob: original, railResult: receipt, status: '已完成', done: 1 });
  const record = one(value);
  assert.equal(record.kind, 'rail');
  assert.equal(record.status, '已完成割胶');
  assert.equal(record.plan, original);
  assert.equal(record.receipt, receipt);
  assert.equal(record.time, Date.parse(finishedAt));
  assert.match(record.note, /模拟/);
  assert.match(record.timeLabel, /回执/);
});

test('a verified cancellation is distinct from an unrecognized receipt outcome', () => {
  const original = job();
  const cancelled = one(single({ railJob: original, railResult: result(original, { outcome: 'cancelled' }), status: '已取消' }));
  assert.equal(cancelled.status, '已取消作业');
  assert.equal(cancelled.receipt.outcome, 'cancelled');
  const unknown = one(single({ railJob: original, railResult: result(original, { outcome: 'failed' }) }));
  assert.equal(unknown.status, '作业记录待核对');
  assert.equal(unknown.receipt, undefined);
  assert.equal(unknown.plan, original);
});

test('the latest retry does not inherit an older attempt receipt even at the same timestamp', () => {
  const original = job({ attemptId: 'attempt-new' });
  const record = one(single({ railJob: original, railResult: result(job({ attemptId: 'attempt-old' })), status: '已完成', done: 1 }));
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.receipt, undefined);
  assert.equal(record.plan, original);
  assert.equal(record.time, Date.parse(requestedAt));
  assert.match(record.timeLabel, /派发|请求/);
});

test('a matching job ID alone cannot validate a different plan or angle', () => {
  for (const changed of [job({ planVersion: 'old-plan' }), job({ angle: 35 })]) {
    const value = single({ railResult: result(changed), status: '已完成', done: 1 });
    const record = one(value);
    assert.equal(record.status, '作业记录待核对');
    assert.equal(record.receipt, undefined);
    assert.equal(record.plan, value.railJob);
  }
});

test('a valid adoption record is preserved but receipt source substitutions are rejected', () => {
  const source = { treeId: 'T-0001', strategyId: 'strategy-one', runId: 'run-one', revision: 1, angle: 30,
    adoptedAt: '2026-10-17T23:59:00.000Z', expiresAt: '2026-10-18T02:00:00.000Z', mode: 'simulation', siteId: 'demo-hainan', dataMode: 'demo' };
  const original = job({ harnessSource: source });
  const good = one(single({ railJob: original, railResult: result(original), done: 1, status: '已完成' }));
  assert.equal(good.status, '已完成割胶');
  assert.equal(good.plan.harnessSource, source);
  const bad = one(single({ railJob: original, railResult: result(job({ harnessSource: { ...source, revision: 2 } })) }));
  assert.equal(bad.status, '作业记录待核对');
  assert.equal(bad.receipt, undefined);
  assert.equal(bad.plan, original);
  const foreign = job({ harnessSource: { ...source, siteId: 'demo-xsbn' } });
  const invalid = one(single({ railJob: foreign, railResult: result(foreign) }));
  assert.equal(invalid.status, '作业记录待核对');
  assert.equal(invalid.plan, undefined, 'invalid strategy sources must not be shown as valid dispatch plans');
  assert.equal(invalid.time, null);
});

test('invalid and pre-dispatch receipt times cannot become completion evidence or ordering time', () => {
  for (const time of ['invalid', '2026-10-17T23:59:59.000Z']) {
    const record = one(single({ railResult: result(job(), { finishedAt: time }) }));
    assert.equal(record.status, '作业记录待核对');
    assert.equal(record.receipt, undefined);
    assert.equal(record.time, Date.parse(requestedAt));
  }
});

test('a receipt without its original job is retained only in the task needing review', () => {
  const value = task({ railResult: result(), status: '已完成', done: 1 });
  const record = one(value);
  assert.equal(record.kind, 'rail');
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.plan, undefined);
  assert.equal(record.receipt, undefined);
  assert.equal(record.time, null);
  assert.equal(value.railResult.outcome, 'completed');
});

test('invalid original jobs cannot use a self-consistent receipt to prove completion', () => {
  const original = job({ requestedAt: 'invalid' });
  const record = one(single({ railJob: original, railResult: result(original), status: '已完成', done: 1 }));
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.plan, undefined);
  assert.equal(record.receipt, undefined);
  assert.equal(record.time, null);
});

test('an unreceived tree stays waiting even if the batch is marked completed or cancelled', () => {
  for (const status of ['已完成', '已取消']) {
    const value = batch({ status, done: status === '已完成' ? 2 : 0 });
    const record = one(value, 1);
    assert.equal(record.status, '等待本树回执');
    assert.equal(record.receipt, undefined);
    assert.equal(record.plan, value.railBatch.jobs[1]);
    assert.equal(record.time, Date.parse(requestedAt));
  }
});

test('batch completion belongs only to the tree with its verified receipt', () => {
  const value = batch({ done: 1 });
  const receipt = result(value.railBatch.jobs[0]);
  value.railBatch.results[0] = receipt;
  assert.equal(one(value, 0).receipt, receipt);
  assert.equal(one(value, 0).status, '已完成割胶');
  assert.equal(one(value, 1).status, '等待本树回执');
  assert.equal(one(value, 1).receipt, undefined);
});

test('a missing per-tree job is a record gap rather than the whole batch status', () => {
  const value = batch({ status: '已完成', done: 2 });
  value.railBatch.jobs = { 0: value.railBatch.jobs[0] };
  value.railBatch.results = { 0: result(value.railBatch.jobs[0]) };
  const record = one(value, 1);
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.plan, undefined);
  assert.equal(record.receipt, undefined);
});

test('wrong storage keys cannot move another tree receipt into this tree history', () => {
  const value = batch();
  value.railBatch.results = { 1: result(value.railBatch.jobs[0]) };
  for (const index of [0, 1]) {
    const record = one(value, index);
    assert.equal(record.status, '作业记录待核对');
    assert.equal(record.receipt, undefined);
  }
});

test('a single-tree receipt claiming another tree is a contradiction rather than a missing reply', () => {
  const value = single({ railResult: result(job(), { index: 1 }), status: '已完成', done: 1 });
  const record = one(value);
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.receipt, undefined);
  assert.equal(record.plan, value.railJob);
});

test('duplicate numeric storage aliases invalidate the selected receipt instead of accepting the first one', () => {
  const value = batch({ done: 1 });
  const receipt = result(value.railBatch.jobs[0]);
  value.railBatch.results = { 0: receipt, '00': { ...receipt } };
  const record = one(value);
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.receipt, undefined);
});

test('mixed single and batch histories never present one arbitrary receipt as this tree completion', () => {
  const value = batch({ done: 1 });
  value.railBatch.results[0] = result(value.railBatch.jobs[0]);
  value.railJob = value.railBatch.jobs[0];
  value.railResult = value.railBatch.results[0];
  const record = one(value);
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.receipt, undefined);
  assert.equal(record.plan, undefined);
});

test('a tree simultaneously marked skipped and completed remains unresolved', () => {
  const value = batch({ done: 1, dispatch: { phase: 'completed', requestId: 'legacy-flow', history: [{ time: finishedAt, label: '跳过本树' }], skipped: [0] } });
  value.railBatch.results[0] = result(value.railBatch.jobs[0]);
  const record = one(value);
  assert.equal(record.status, '作业记录待核对');
  assert.equal(record.receipt, undefined);
});

test('a damaged receipt on another tree does not erase this tree verified completion', () => {
  const value = batch({ done: 2, status: '已完成' });
  const ownReceipt = result(value.railBatch.jobs[0]);
  value.railBatch.results = { 0: ownReceipt, 1: result(job({ id: 'foreign-job' }), { index: 1 }) };
  const record = one(value, 0);
  assert.equal(record.status, '已完成割胶');
  assert.equal(record.receipt, ownReceipt);
  assert.match(record.note, /待核对|需核对/);
  assert.match(record.note, /模拟/);
  assert.equal(one(value, 1).status, '作业记录待核对');
});

test('aggregate progress errors warn without discarding a locally verified receipt', () => {
  const original = job(), receipt = result(original);
  const record = one(single({ railJob: original, railResult: receipt, done: 0, status: '已完成' }));
  assert.equal(record.status, '已完成割胶');
  assert.equal(record.receipt, receipt);
  assert.match(record.note, /待核对|需核对/);
});

test('malformed target sets cannot authorize an otherwise matching dispatch', () => {
  for (const treeIndices of [[0, 0], [0, 200]]) {
    const value = batch({ treeIndices });
    value.railBatch.results[0] = result(value.railBatch.jobs[0]);
    const record = one(value);
    assert.equal(record.status, '作业记录待核对');
    assert.equal(record.plan, undefined);
    assert.equal(record.receipt, undefined);
  }
});

test('records sort by verified tree evidence time, retaining stable ties and unknown records last', () => {
  const completed = single({ railResult: result(), done: 1, status: '已完成', date: '2026-01-01' });
  const newerJob = job({ id: 'newer', requestedAt: '2026-10-18T02:00:00.000Z' });
  const newer = single({ id: 'newer', railJob: newerJob, date: '2025-01-01' });
  const tied = task({ id: 'manual', kind: '巡检', receipt: { time: finishedAt, outcome: '已完成处理', note: '人工填写的现场情况' } });
  const unknown = task({ id: 'unknown', date: '2099-12-31', start: '23:00', status: '已完成', done: 1 });
  const input = deepFreeze([unknown, completed, newer, tied]);
  const records = treeWorkRecords(input, 0, 'hainan');
  assert.deepEqual(records.map(record => record.task.id), ['newer', 'rail-one', 'manual', 'unknown']);
  assert.deepEqual(input.map(value => value.id), ['unknown', 'rail-one', 'newer', 'manual']);
  assert.equal(records.at(-1).time, null);
  assert.equal(records.at(-1).timeLabel, '记录时间待核对');
  assert.equal(records[1].task, completed);
  assert.equal(records[2].task, tied);
});

test('the selected batch tree uses its own evidence time rather than another tree later receipt', () => {
  const value = batch({ done: 2, status: '已完成' });
  value.railBatch.results = {
    0: result(value.railBatch.jobs[0]),
    1: result(value.railBatch.jobs[1], { index: 1, finishedAt: '2026-10-18T03:00:00.000Z' }),
  };
  assert.equal(one(value, 0).time, Date.parse(finishedAt));
  assert.equal(one(value, 1).time, Date.parse('2026-10-18T03:00:00.000Z'));
});

test('valid legacy dispatches without attempt IDs remain readable when both records agree', () => {
  const original = job();
  delete original.attemptId;
  const receipt = result(original);
  const record = one(single({ railJob: original, railResult: receipt, done: 1, status: '已完成' }));
  assert.equal(record.status, '已完成割胶');
  assert.equal(record.receipt, receipt);
});

test('flow progress is labeled simulation and distinguishes completed, skipped and current trees', () => {
  const value = flow();
  const completed = one(value, 0), skipped = one(value, 1), current = one(value, 2);
  assert.equal(completed.kind, 'flow');
  assert.equal(completed.status, '模拟流程 · 已完成割胶');
  assert.equal(skipped.status, '模拟流程 · 已跳过 · 待复查');
  assert.equal(current.status, '模拟流程 · 机器人正在前往');
  for (const record of [completed, skipped, current]) {
    assert.equal(record.receipt, undefined);
    assert.equal(record.plan, undefined);
    assert.match(record.note, /模拟/);
    assert.match(record.timeLabel, /流程/);
    assert.equal(record.time, Date.parse(finishedAt));
  }
});

test('invalid flow counters and skipped scope cannot fabricate completed per-tree progress', () => {
  const values = [flow({ done: 4 }), flow({ done: -1 }), flow({ done: 1.5 }), flow({ count: 2 })];
  const duplicateSkip = flow(); duplicateSkip.dispatch.skipped = [1, 1]; values.push(duplicateSkip);
  const foreignSkip = flow(); foreignSkip.dispatch.skipped = [99]; values.push(foreignSkip);
  const invalidTargets = flow({ treeIndices: [0, 1, 200] }); values.push(invalidTargets);
  for (const value of values) {
    const record = one(value);
    assert.equal(record.status, '流程记录待核对');
    assert.equal(record.receipt, undefined);
    assert.equal(record.time, null);
  }
});

test('invalid or empty flow history stays unverified despite a completed task flag', () => {
  for (const history of [[], [{ time: 'invalid', label: '完成' }], [{ time: finishedAt, label: '' }]]) {
    const value = flow({ done: 2, status: '已完成' });
    value.dispatch = { ...value.dispatch, phase: 'completed', history };
    const record = one(value);
    assert.equal(record.status, '流程记录待核对');
    assert.equal(record.time, null);
    assert.equal(record.timeLabel, '记录时间待核对');
  }
});

test('a skipped tree outside the processed serial prefix cannot fabricate another tree completion', () => {
  for (const done of [0, 1]) {
    const value = flow({ done });
    value.dispatch.skipped = [2];
    const record = one(value, done);
    assert.equal(record.status, '流程记录待核对');
    assert.equal(record.time, null);
  }
});

test('an inherited object key is not a valid stored flow phase', () => {
  const value = flow();
  value.dispatch.phase = 'toString';
  const record = one(value);
  assert.equal(record.status, '流程记录待核对');
  assert.equal(record.time, null);
});

test('an unfinished flow phase cannot claim all its trees have already been processed', () => {
  for (const phase of ['running', 'waiting']) {
    const value = flow({ done: 2 });
    value.dispatch.phase = phase;
    const record = one(value);
    assert.equal(record.status, '流程记录待核对');
    assert.equal(record.time, null);
  }
});

test('flow ordering uses the newest recorded event time rather than event array position', () => {
  const value = flow();
  value.dispatch.history.reverse();
  const record = one(value);
  assert.equal(record.time, Date.parse(finishedAt));
  assert.equal(record.status, '模拟流程 · 已完成割胶');
});

test('a human completion record remains a task record rather than a per-tree robot receipt', () => {
  const value = task({ kind: '巡检', story: 'surface', status: '已完成', done: 1,
    receipt: { time: finishedAt, outcome: '已完成处理', note: '现场人员填写的处理结果' } });
  const record = one(value);
  assert.equal(record.kind, 'record');
  assert.equal(record.status, '任务记录 · 已完成');
  assert.equal(record.receipt, undefined);
  assert.equal(record.plan, undefined);
  assert.equal(record.time, Date.parse(finishedAt));
  assert.match(record.timeLabel, /人工|处理/);
  assert.match(record.note, /人工|任务/);
});

test('ordinary task schedules and invalid human timestamps cannot claim execution time', () => {
  const planned = task({ date: '2026-10-18', start: '08:00', end: '09:00', status: '已完成', done: 1 });
  const invalidReceipt = task({ receipt: { time: 'yesterday', outcome: '已完成处理', note: '记录' } });
  for (const value of [planned, invalidReceipt]) {
    const record = one(value);
    assert.equal(record.kind, 'record');
    assert.equal(record.time, null);
    assert.equal(record.timeLabel, '记录时间待核对');
    assert.match(record.status, /^任务记录 · /);
  }
});

test('full record timestamps stay in Beijing time under different host time zones', () => {
  const moduleUrl = new URL('../src/workspace/treeWorkModel.ts', import.meta.url).href;
  const value = single({ railResult: result(), done: 1, status: '已完成' });
  const script = `import {treeWorkRecords} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(treeWorkRecords(${JSON.stringify([value])},0,'hainan')[0].timeLabel));`;
  const labels = [];
  for (const timezone of ['UTC', 'America/Los_Angeles']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
    assert.equal(child.status, 0, child.stderr);
    const label = JSON.parse(child.stdout);
    assert.match(label, /2026\D+10\D+18/);
    assert.match(label, /09:00/);
    assert.match(label, /北京时间/);
    labels.push(label);
  }
  assert.equal(labels[0], labels[1]);
});
