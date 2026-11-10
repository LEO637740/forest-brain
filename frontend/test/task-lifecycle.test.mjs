import test from 'node:test';
import assert from 'node:assert/strict';
import { logisticsDependencies, logisticsDependency, taskEvidence, taskHoldReason } from '../src/workspace/taskLifecycleModel.ts';

const now = Date.parse('2026-10-13T02:00:00Z');
const source = { treeId: 'T-0001', strategyId: 'strategy-1', runId: 'run-1', revision: 2, angle: 28, adoptedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(), mode: 'simulation', dataMode: 'mixed_demo' };
const job = (patch = {}) => ({ id: 'rail-one', requestedAt: new Date(now).toISOString(), angle: 28, planVersion: 'harness-2', harnessSource: source, ...patch });
const task = (patch = {}) => ({ id: 'rail-one', site: 'hainan', title: '单树割胶', block: 'A', robot: 'R-A', start: '08:00', end: '08:15', count: 1, done: 0, status: '待开始', kind: '割胶', treeIndices: [0], ...patch });
const receipt = (patch = {}) => ({ index: 0, job: job(), outcome: 'completed', finishedAt: new Date(now).toISOString(), ...patch });
const fleet = (liveJob = job(), paused = false) => ({ ready: true, error: null, jobs: { 0: liveJob }, zones: [{ zone: 0, active: 0, paused }] });

test('saved preflight failures explain a pending task without inventing progress or receipts',()=>{
 const check={time:new Date(now).toISOString(),outcome:'blocked',message:'HN-A-0004 存在树表标记，请复核'};
 const blocked=task({id:'park-plan-a',status:'待处理',railDispatchChecks:[check]});
 assert.equal(taskHoldReason(blocked,undefined,now),check.message);
 assert.equal(taskEvidence(blocked).receipts.length,0);
 const cleared={...blocked,railDispatchChecks:[check,{time:new Date(now+1000).toISOString(),outcome:'passed',message:'核验通过'}]};
 assert.notEqual(taskHoldReason(cleared,undefined,now),check.message);
 assert.equal(taskHoldReason({...cleared,status:'执行中'},undefined,now),null);
 assert.equal(taskHoldReason({...blocked,status:'已完成',done:1},undefined,now),null);
 assert.equal(taskHoldReason({...blocked,status:'已取消'},undefined,now),null);
});

test('legacy undispatched Hainan failures explain the missing reason and offer a fresh check',()=>{
 const legacy=task({id:'park-plan-a',status:'待处理'});
 assert.match(taskHoldReason(legacy,undefined,now),/未保存具体失败原因.*重新核验并执行/);
 assert.doesNotMatch(taskHoldReason({...legacy,site:'xsbn'},undefined,now),/重新核验并执行/);
 assert.doesNotMatch(taskHoldReason({...legacy,kind:'巡检'},undefined,now),/重新核验并执行/);
});

test('planned or running tapping tasks never imply transport readiness or approval', () => {
  for (const status of ['待开始', '执行中']) {
    const result = logisticsDependency(task({ status }), undefined, now);
    assert.equal(result.state, 'waiting');
    assert.deepEqual(result.evidence.sources, []);
    assert.equal(result.evidence.hasCompletionRecord, false);
    assert.equal('kilograms' in result, false);
  }
  assert.deepEqual(taskEvidence(task({ sourceScenarioId: 'market-1', decisionKey: 'local-decision' })).sources, []);
});

test('pause, review, failed receipt and pending cancellation all hold downstream planning', () => {
  for (const phase of ['pause-requested', 'paused', 'resume-requested', 'review', 'recapturing', 'failed', 'cancel-requested']) {
    const result = logisticsDependency(task({ status: '执行中', dispatch: { phase, requestId: 'one', history: [] } }), undefined, now);
    assert.equal(result.state, 'blocked', phase);
    assert.ok(result.reason.length > 0);
  }
});

test('live fleet pause and rain block take effect before shared task status catches up', () => {
  const running = task({ status: '执行中', railJob: job() });
  assert.equal(logisticsDependency(running, fleet(job(), true), now).state, 'blocked');
  const rainy = logisticsDependency(running, fleet(job({ weatherBlock: '本区下雨，作业暂缓' })), now);
  assert.equal(rainy.state, 'blocked');
  assert.match(rainy.reason, /本区下雨/);
  assert.equal(taskHoldReason(running, fleet(job({ id: 'different-job', weatherBlock: 'other' }), true), now), null);
});

test('strategy expiry, invalid weather window and validation failures cannot enable transport', () => {
  for (const patch of [
    { harnessSource: { ...source, expiresAt: new Date(now).toISOString() } },
    { notAfter: now }, { notBefore: now + 30000 }, { validation: 'invalid' }, { validation: 'pending' },
  ]) assert.equal(logisticsDependency(task({ railJob: job(patch) }), undefined, now).state, 'blocked');
});

test('cancellation stops the dependency even if some trees already completed', () => {
  const partial = task({ status: '已取消', count: 2, done: 1, treeIndices: [0, 1], railBatch: { baseDone: 0, jobs: { 0: job(), 1: job({ id: 'rail-two' }) }, results: { 0: receipt() } } });
  const result = logisticsDependency(partial, undefined, now);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.evidence.completedReceipts, 1);
  assert.match(result.reason, /已有产胶需人工核实/);
});

test('completed status alone does not become a dispatchable transportation plan', () => {
  const result = logisticsDependency(task({ status: '已完成', done: 1 }), undefined, now);
  assert.equal(result.state, 'awaiting-receipt');
  assert.equal(result.evidence.hasCompletionRecord, false);
});

test('matching completion receipts allow collection confirmation only, with no inferred yield', () => {
  const completed = task({ status: '已完成', done: 1, railJob: job(), railResult: receipt() });
  const result = logisticsDependency(completed, undefined, now + 90000);
  assert.equal(result.state, 'awaiting-weighing');
  assert.equal(result.evidence.completedReceipts, 1);
  assert.equal(result.evidence.sources.length, 1);
  assert.match(result.reason, /称重/);
  assert.equal('weight' in result, false);
  assert.equal(logisticsDependency({ ...completed, dispatch: { phase: 'paused', history: [] } }, undefined, now).state, 'blocked');
});

test('foreign and incomplete batch receipts cannot prove completion', () => {
  const batch = task({ status: '已完成', done: 1, railBatch: { baseDone: 0, jobs: { 0: job() }, results: { 0: receipt({ job: job({ id: 'foreign' }) }), 1: receipt({ index: 1, job: undefined }) } } });
  assert.equal(taskEvidence(batch).receipts.length, 0);
  assert.equal(logisticsDependency(batch, undefined, now).state, 'awaiting-receipt');
  const inconsistent = task({ status: '已完成', count: 2, done: 1, railResult: receipt() });
  assert.equal(taskEvidence(inconsistent).hasCompletionRecord, false);
});

test('skipped trees do not count as tapped output; non-tapping work has no transport dependency', () => {
  const skipped = task({ status: '已完成', done: 0, dispatch: { phase: 'completed', skipped: [0], history: [{ time: new Date(now).toISOString(), label: '已跳过' }] } });
  assert.equal(logisticsDependency(skipped, undefined, now).state, 'no-output');
  assert.equal(logisticsDependencies([task(), task({ id: 'inspection', kind: '巡检' }), task({ id: 'research', kind: '联调' })], undefined, now).length, 1);
});

const completedTask = (patch = {}) => task({ status: '已完成', done: 1, railJob: job(), railResult: receipt(), ...patch });
const codes = evidence => evidence.issues.map(issue => issue.code);

test('rail completion requires the same dispatch plan and adoption identity, while retaining rejected raw receipts', () => {
  for (const [label, changedJob, expectedCode] of [
    ['job', job({ id: 'foreign' }), 'receipt_job_mismatch'],
    ['angle', job({ angle: 29 }), 'receipt_plan_mismatch'],
    ['plan', job({ planVersion: 'other' }), 'receipt_plan_mismatch'],
    ...['treeId', 'strategyId', 'runId', 'revision', 'angle', 'adoptedAt', 'expiresAt', 'mode', 'dataMode', 'siteId'].map(field => [
      field, job({ harnessSource: { ...source, [field]: field === 'revision' ? 3 : field === 'angle' ? 29 : field === 'adoptedAt' || field === 'expiresAt' ? new Date(now + 1000).toISOString() : 'foreign' } }), 'receipt_source_mismatch',
    ]),
    ['missing source', job({ harnessSource: undefined }), 'receipt_source_mismatch'],
  ]) {
    const raw = receipt({ job: changedJob });
    const evidence = taskEvidence(completedTask({ railResult: raw }));
    assert.equal(evidence.hasCompletionRecord, false, label);
    assert.equal(evidence.completionKind, null, label);
    assert.deepEqual(evidence.receipts, [], label);
    assert.deepEqual(evidence.rawReceipts, [raw], label);
    assert.ok(codes(evidence).includes(expectedCode), label);
    assert.ok(codes(evidence).includes('receipt_missing'), label);
    assert.deepEqual(evidence.sources, [source], label);
  }
});

test('receipts without the original job, outside explicit targets or under the wrong storage key cannot count', () => {
  for (const [input, expectedCode] of [
    [completedTask({ railJob: undefined }), 'receipt_job_missing'],
    [completedTask({ treeIndices: undefined }), 'task_targets_invalid'],
    [completedTask({ railResult: receipt({ index: 1 }) }), 'receipt_target_mismatch'],
    [completedTask({ railJob: undefined, railResult: undefined, railBatch: { baseDone: 0, jobs: { 1: job() }, results: { 1: receipt({ index: 1 }) } } }), 'job_outside_targets'],
    [completedTask({ railJob: undefined, railResult: undefined, railBatch: { baseDone: 0, jobs: { 0: job() }, results: { 1: receipt() } } }), 'receipt_target_mismatch'],
  ]) {
    const evidence = taskEvidence(input);
    assert.equal(evidence.hasCompletionRecord, false);
    assert.equal(evidence.receipts.length, 0);
    assert.ok(codes(evidence).includes(expectedCode), expectedCode);
    if (expectedCode === 'job_outside_targets' || expectedCode === 'task_targets_invalid') assert.deepEqual(evidence.sources, []);
  }
});

test('the same job ID assigned to two trees is never counted twice', () => {
  const other = job({ harnessSource: { ...source, treeId: 'T-0002' } });
  const evidence = taskEvidence(completedTask({ count: 2, done: 2, treeIndices: [0, 1], railJob: undefined, railResult: undefined,
    railBatch: { baseDone: 0, jobs: { 0: job(), 1: other }, results: { 0: receipt(), 1: receipt({ index: 1, job: other }) } },
  }));
  assert.equal(evidence.rawReceipts.length, 2);
  assert.equal(evidence.completedReceipts, 0);
  assert.equal(evidence.hasCompletionRecord, false);
  assert.deepEqual(evidence.sources, []);
  assert.ok(codes(evidence).includes('duplicate_job_id'));
});

test('mixed single and batch copies retain both raw receipts but only count one linked result', () => {
  const evidence = taskEvidence(completedTask({ railBatch: { baseDone: 0, jobs: { 0: job() }, results: { 0: receipt() } } }));
  assert.equal(evidence.rawReceipts.length, 2);
  assert.equal(evidence.receipts.length, 1);
  assert.equal(evidence.hasCompletionRecord, false);
  assert.ok(codes(evidence).includes('mixed_rail_records'));
  assert.ok(codes(evidence).includes('duplicate_receipt'));
});

test('invalid adoption sources are reported and cannot prove adoption or execution', () => {
  for (const [patch, expectedCode] of [
    [{ strategyId: '' }, 'source_identity_invalid'], [{ runId: '' }, 'source_identity_invalid'],
    [{ revision: 0 }, 'source_identity_invalid'], [{ mode: 'device' }, 'source_identity_invalid'],
    [{ siteId: 'demo-xsbn' }, 'source_site_mismatch'], [{ treeId: 'T-0002' }, 'source_tree_mismatch'],
    [{ adoptedAt: '' }, 'source_time_invalid'], [{ adoptedAt: 'invalid' }, 'source_time_invalid'],
    [{ expiresAt: 'invalid' }, 'source_time_invalid'], [{ adoptedAt: source.expiresAt }, 'source_time_invalid'],
    [{ angle: 29 }, 'source_angle_mismatch'],
  ]) {
    const invalid = job({ harnessSource: { ...source, ...patch } });
    const evidence = taskEvidence(completedTask({ railJob: invalid, railResult: receipt({ job: invalid }) }));
    assert.deepEqual(evidence.sources, [], expectedCode);
    assert.equal(evidence.receipts.length, 0, expectedCode);
    assert.equal(evidence.hasCompletionRecord, false, expectedCode);
    assert.ok(codes(evidence).includes(expectedCode), expectedCode);
  }
});

test('adoption identity keeps distinct runs, revisions and adoption times instead of overwriting them', () => {
  for (const patch of [{ runId: 'run-2' }, { revision: 3 }, { adoptedAt: new Date(now - 500).toISOString() }]) {
    const first = job({ harnessSource: { ...source, siteId: 'demo-xsbn' } });
    const second = job({ id: 'other', harnessSource: { ...first.harnessSource, ...patch } });
    const evidence = taskEvidence(task({ site: 'xsbn', count: 2, treeIndices: [0, 1], railBatch: { baseDone: 0, jobs: { 0: first, 1: second }, results: {} } }));
    assert.equal(evidence.sources.length, 2);
  }
});

test('identical adoption identity is deduplicated, while all contradictory copies are excluded from trusted sources', () => {
  const first = job({ harnessSource: { ...source, siteId: 'demo-xsbn' } });
  const same = job({ id: 'other', harnessSource: { ...first.harnessSource } });
  const input = task({ site: 'xsbn', count: 2, treeIndices: [0, 1], railBatch: { baseDone: 0, jobs: { 0: first, 1: same }, results: {} } });
  assert.equal(taskEvidence(input).sources.length, 1);
  const conflict = taskEvidence({ ...input, railBatch: { ...input.railBatch, jobs: { 0: first, 1: { ...same, harnessSource: { ...same.harnessSource, expiresAt: new Date(now + 120000).toISOString() } } } } });
  assert.deepEqual(conflict.sources, []);
  assert.ok(codes(conflict).includes('source_record_conflict'));
});

test('valid timestamps and outcomes are required for receipt evidence', () => {
  for (const patch of [{ finishedAt: '' }, { finishedAt: 'invalid' }, { finishedAt: new Date(now - 2000).toISOString() }, { outcome: 'unknown' }]) {
    const evidence = taskEvidence(completedTask({ railResult: receipt(patch) }));
    assert.equal(evidence.hasCompletionRecord, false);
    assert.equal(evidence.receipts.length, 0);
    assert.ok(codes(evidence).some(code => code === 'receipt_time_invalid' || code === 'receipt_outcome_invalid'));
  }
});

test('historical completion ignores current strategy expiry and mutable weather validation fields', () => {
  const historical = job({ harnessSource: { ...source, expiresAt: new Date(now - 500).toISOString() }, validation: 'invalid', weatherBlock: '当前天气不适宜', notAfter: now - 1 });
  const resultJob = { ...historical, validation: 'valid', weatherBlock: '', notAfter: now + 1 };
  const evidence = taskEvidence(completedTask({ railJob: historical, railResult: receipt({ job: resultJob }) }));
  assert.equal(evidence.completionKind, 'rail');
  assert.equal(evidence.hasCompletionRecord, true);
  assert.deepEqual(evidence.issues, []);
});

test('baseline jobs without an adoption source remain valid simulation receipts, without invented approval', () => {
  const baseline = job({ harnessSource: undefined });
  const evidence = taskEvidence(completedTask({ railJob: baseline, railResult: receipt({ job: baseline }) }));
  assert.equal(evidence.completionKind, 'rail');
  assert.equal(evidence.completedReceipts, 1);
  assert.deepEqual(evidence.sources, []);
  assert.deepEqual(evidence.issues, []);
});

test('progress, missing jobs and missing historical base receipts produce explicit count issues', () => {
  const missing = taskEvidence(completedTask({ railResult: undefined }));
  assert.ok(codes(missing).includes('receipt_missing'));
  assert.ok(codes(missing).includes('completion_count_mismatch'));
  const prior = taskEvidence(completedTask({ count: 2, done: 2, treeIndices: [0, 1], railJob: undefined, railResult: undefined,
    railBatch: { baseDone: 1, jobs: { 0: job() }, results: { 0: receipt() } },
  }));
  assert.equal(prior.hasCompletionRecord, false);
  for (const code of ['completion_count_mismatch', 'prior_completion_unverified', 'job_count_mismatch']) assert.ok(codes(prior).includes(code), code);
  const incomplete = taskEvidence(completedTask({ done: 0 }));
  assert.ok(codes(incomplete).includes('completed_status_mismatch'));
  assert.ok(codes(incomplete).includes('completion_count_mismatch'));
});

test('legacy flow and surface records are classified but cannot mask rejected rail evidence', () => {
  const dispatch = { phase: 'completed', requestId: 'flow-1', history: [{ time: new Date(now).toISOString(), label: '已完成' }] };
  const surface = { outcome: '已完成处理', note: '已复查', time: new Date(now).toISOString() };
  assert.equal(taskEvidence(task({ status: '已完成', done: 1, dispatch })).completionKind, 'flow');
  assert.equal(taskEvidence(task({ status: '已完成', done: 1, receipt: surface })).completionKind, 'surface');
  for (const legacy of [{ dispatch }, { receipt: surface }]) {
    const evidence = taskEvidence(completedTask({ ...legacy, railResult: receipt({ job: job({ id: 'foreign' }) }) }));
    assert.equal(evidence.hasCompletionRecord, false);
    assert.equal(evidence.completionKind, null);
  }
  assert.equal(taskEvidence(task({ status: '已完成', done: 1, receipt: { ...surface, note: '' } })).hasCompletionRecord, false);
  assert.equal(taskEvidence(task({ status: '已完成', done: 1, dispatch: { ...dispatch, history: [{ time: 'invalid', label: '已完成' }] } })).hasCompletionRecord, false);
});

test('valid partial cancellation retains linked counts without claiming full completion', () => {
  const second = job({ id: 'rail-two', harnessSource: { ...source, treeId: 'T-0002' } });
  const evidence = taskEvidence(task({ status: '已取消', count: 2, done: 1, treeIndices: [0, 1],
    railBatch: { baseDone: 0, jobs: { 0: job(), 1: second }, results: { 0: receipt(), 1: receipt({ index: 1, job: second, outcome: 'cancelled' }) } },
  }));
  assert.equal(evidence.completedReceipts, 1);
  assert.equal(evidence.cancelledReceipts, 1);
  assert.equal(evidence.hasCompletionRecord, false);
  assert.deepEqual(evidence.issues, []);
});

test('skipped and executed tree overlap cannot prove a complete batch', () => {
  const evidence = taskEvidence(completedTask({ done: 0, dispatch: { phase: 'completed', skipped: [0], history: [{ time: new Date(now).toISOString(), label: '跳过' }] } }));
  assert.equal(evidence.hasCompletionRecord, false);
  assert.ok(codes(evidence).includes('receipt_skipped_overlap'));
});

test('live Hainan fleet state never supplies another park pause or weather reason', () => {
  const otherPark = task({ site: 'xsbn', status: '执行中', railJob: job({ harnessSource: { ...source, siteId: 'demo-xsbn' } }) });
  assert.equal(taskHoldReason(otherPark, fleet(job({ weatherBlock: '海南实时雨天' }), true), now), null);
  assert.equal(taskHoldReason(otherPark, undefined, now), null);
});

test('live jobs sharing an ID must also match the saved plan and adoption before supplying hold reasons', () => {
  const saved = task({ status: '执行中', railJob: job() });
  for (const patch of [
    { planVersion: 'other-plan' }, { angle: 29 }, { harnessSource: undefined },
    { harnessSource: { ...source, strategyId: 'other-strategy' } },
    { harnessSource: { ...source, runId: 'other-run' } },
    { harnessSource: { ...source, revision: 3 } },
  ]) assert.equal(taskHoldReason(saved, fleet(job({ ...patch, weatherBlock: '其他派发天气限制' }), true), now), null);
  assert.equal(taskHoldReason(saved, fleet(job({ validation: 'invalid', weatherBlock: '本次派发天气限制' })), now), '本次派发天气限制');
  assert.equal(taskHoldReason(saved, fleet(job(), true), now), '本区机器人已暂停');
});
