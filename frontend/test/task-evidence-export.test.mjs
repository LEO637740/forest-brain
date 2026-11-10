import {sites} from '../src/workspace/model.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createTaskEvidenceSnapshot, renderTaskEvidenceHtml, taskEvidenceArtifact, taskSnapshotNotice } from '../src/workspace/taskEvidenceExport.ts';

const now = Date.parse('2026-10-17T16:00:05.678Z');
const source = (patch = {}) => ({ treeId: 'T-0001', strategyId: 'strategy-1', runId: 'run-1', revision: 2, angle: 28,
  adoptedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(), mode: 'simulation', dataMode: 'mixed_demo', siteId: 'demo-hainan', ...patch });
const job = (patch = {}) => ({ id: 'rail-one', requestedAt: new Date(now - 500).toISOString(), angle: 28, planVersion: 'harness-2', harnessSource: source(), ...patch });
const task = (patch = {}) => ({ id: 'rail-one', site: 'hainan', title: '单树割胶', block: 'A', robot: 'R-A', start: '08:00', end: '08:15', count: 1, done: 0, status: '待开始', kind: '割胶', treeIndices: [0], ...patch });
const receipt = (patch = {}) => ({ index: 0, job: job(), outcome: 'completed', finishedAt: new Date(now).toISOString(), ...patch });
const completed = (patch = {}) => task({ status: '已完成', done: 1, railJob: job(), railResult: receipt(), ...patch });
const fleet = (live = job(), extra = {}) => ({ ready: true, error: null, jobs: { 0: live, ...extra }, zones: [{ zone: 0, active: 0, paused: false }] });
const artifact = (input, format = 'html') => taskEvidenceArtifact(createTaskEvidenceSnapshot(input, undefined, now), format);

test('click-time snapshot remains unchanged after task, receipt and live fleet updates', () => {
  const input = completed({ sourceScenarioId: 'market-before', decisionKey: 'decision-before', dispatch: { phase: 'completed', history: [{ time: new Date(now).toISOString(), label: '完成前记录' }] } });
  const live = fleet(job({ blockedReason: '导出前状态' }));
  const before = structuredClone(input);
  const snapshot = createTaskEvidenceSnapshot(input, live, now);
  const html = renderTaskEvidenceHtml(snapshot);
  const json = taskEvidenceArtifact(snapshot, 'json').content;
  input.title = 'later-title';
  input.treeIndices.push(1);
  input.railJob.harnessSource.strategyId = 'later-source';
  input.railResult.job.angle = 99;
  input.dispatch.history[0].label = 'later-history';
  live.jobs[0].blockedReason = 'later-fleet';
  assert.deepEqual(snapshot.task, before);
  assert.equal(renderTaskEvidenceHtml(snapshot), html);
  assert.equal(taskEvidenceArtifact(snapshot, 'json').content, json);
  assert.equal(snapshot.generatedAt, new Date(now).toISOString());
  assert.equal(snapshot.timeZone, 'Asia/Shanghai');
});

test('JSON preserves complete selected task fields and original rejected receipt without repairing them', () => {
  const input = completed({ revision: 7, date: '2026-10-18', autoPlanned: true, sourceScenarioId: 'market-1', decisionKey: 'decision-1', story: 'surface',
    surfacePlan: { mark: '圈点', action: '复查' }, receipt: { outcome: '已完成处理', note: '已填写现场说明', time: new Date(now).toISOString() },
    railResult: receipt({ job: job({ angle: 42 }), extraDeviceField: { voltage: 9 } }), futureField: { notes: ['保留扩展字段'] } });
  const result = artifact(input, 'json');
  const parsed = JSON.parse(result.content);
  assert.equal(result.mimeType, 'application/json;charset=utf-8');
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(parsed.task, input);
  assert.deepEqual(parsed.assessment.evidence.rawReceipts, [input.railResult]);
  assert.deepEqual(parsed.assessment.evidence.receipts, []);
  assert.equal(parsed.assessment.evidence.hasCompletionRecord, false);
  assert.ok(parsed.assessment.evidence.issues.some(issue => issue.code === 'receipt_plan_mismatch'));
  assert.equal(parsed.assessment.downstream.state, 'awaiting-receipt');
});

test('export uses matching live state without copying another task or the fleet inventory', () => {
  const input = task({ status: '执行中', railJob: job() });
  const live = fleet(job({ blockedReason: '本任务雨量暂缓' }), { 12: job({ id: 'OTHER-TASK-SECRET', blockedReason: 'OTHER-PRIVATE-NOTE' }) });
  live.error = 'FLEET-GLOBAL-SECRET';
  const snapshot = createTaskEvidenceSnapshot(input, live, now);
  const text = taskEvidenceArtifact(snapshot, 'json').content;
  assert.equal(snapshot.assessment.currentHoldReason, '本任务雨量暂缓');
  assert.equal(snapshot.assessment.downstream.state, 'blocked');
  assert.doesNotMatch(text, /OTHER-TASK-SECRET|OTHER-PRIVATE-NOTE|FLEET-GLOBAL-SECRET/);
  assert.equal('fleet' in snapshot, false);
  assert.deepEqual(snapshot.task, input);
});

test('same-number foreign jobs and other parks do not inherit Hainan live holds', () => {
  const input = task({ status: '执行中', railJob: job({ harnessSource: undefined }) });
  const unrelated = createTaskEvidenceSnapshot(input, fleet(job({ id: 'other', weatherBlock: 'other-tree-rain' })), now);
  assert.equal(unrelated.assessment.currentHoldReason, null);
  for (const site of ['xsbn', 'xian']) {
    const live = fleet(job({ weatherBlock: '海南专属雨量' }));
    live.zones[0].paused = true;
    const snapshot = createTaskEvidenceSnapshot({ ...input, site }, live, now);
    assert.equal(snapshot.assessment.currentHoldReason, null, site);
    assert.equal(snapshot.assessment.downstream.state, 'waiting', site);
    assert.doesNotMatch(taskEvidenceArtifact(snapshot, 'json').content, /海南专属雨量/);
  }
});

test('HTML escapes title, adoption, execution, history and raw JSON markup and contains no executable resources', () => {
  const attack = '</title><script src="https://attacker.invalid/a.js">alert(1)</script><img src=x onerror=alert(2)>&\'"';
  const hostileJob = job({ planVersion: attack, harnessSource: source({ strategyId: attack, runId: attack }) });
  const input = completed({ title: attack, block: attack, robot: attack, sourceScenarioId: attack, decisionKey: attack,
    railJob: hostileJob, railResult: receipt({ job: structuredClone(hostileJob) }),
    dispatch: { phase: 'completed', history: [{ time: new Date(now).toISOString(), label: attack }] },
    receipt: { outcome: '已完成处理', note: attack, time: new Date(now).toISOString() }, futureField: attack });
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now);
  assert.equal(snapshot.assessment.evidence.hasCompletionRecord, true);
  const html = renderTaskEvidenceHtml(snapshot);
  assert.doesNotMatch(html, /<script\b|<img\b|<iframe\b|<object\b|<embed\b|<link\b|<form\b/i);
  assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']/i);
  assert.ok(html.includes('&lt;script src=&quot;https://attacker.invalid/a.js&quot;&gt;'));
  assert.ok(html.includes('&amp;&#39;&quot;'));
  assert.ok(html.includes('&quot;futureField&quot;'));
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/title>/g) ?? []).length, 1);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /完整原始快照/);
});

test('unrecorded target trees stay unrecorded rather than being inferred from block and count', () => {
  const input = task({ treeIndices: undefined, block: 'D', count: 12, status: '已完成', done: 12 });
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now);
  assert.equal(snapshot.task.treeIndices, undefined);
  const html = renderTaskEvidenceHtml(snapshot);
  assert.match(html, /未保存明确树木清单/);
  assert.match(html, /不按地块或数量推导下发对象/);
  assert.doesNotMatch(html, /T-\d{4}/);
  assert.equal(snapshot.assessment.evidence.hasCompletionRecord, false);
});

test('report presents rejected receipt counts while retaining raw receipt data for remote review', () => {
  const input = completed({ railResult: receipt({ job: job({ id: 'foreign-execution' }) }) });
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now);
  const html = renderTaskEvidenceHtml(snapshot);
  assert.match(html, /原始回执 1/);
  assert.match(html, /匹配完成 0/);
  assert.match(html, /暂无通过关联核对的逐树回执/);
  assert.match(html, /receipt_job_mismatch/);
  assert.match(html, /foreign-execution/);
  assert.match(html, /尚不足以确认完整完成记录/);
});

test('revision and successful local evidence do not claim server synchronization or real device approval', () => {
  const snapshot = createTaskEvidenceSnapshot(completed({ revision: 99 }), undefined, now);
  const html = renderTaskEvidenceHtml(snapshot);
  assert.equal(snapshot.recordScope, taskSnapshotNotice);
  assert.match(html, /浏览器当前记录快照/);
  assert.match(html, /导出时未再次核对服务器/);
  assert.match(html, /任务版本号不代表已同步/);
  assert.match(html, /不等同于真实设备回执、正式审批或产胶量证明/);
  assert.equal('serverConfirmed' in snapshot, false);
  assert.equal('synced' in snapshot, false);
  assert.equal(snapshot.task.revision, 99);
});

test('a cancelled receipt has an explicitly unrecorded historical reason and no inferred yield', () => {
  const input = task({ status: '已取消', railJob: job({ blockedReason: '后来出现的天气原因' }), railResult: receipt({ outcome: 'cancelled' }) });
  const snapshot = createTaskEvidenceSnapshot(input, fleet(job({ blockedReason: '当前雨量' })), now);
  const html = renderTaskEvidenceHtml(snapshot);
  assert.equal(snapshot.assessment.evidence.cancelledReceipts, 1);
  assert.equal(snapshot.assessment.evidence.hasCompletionRecord, false);
  assert.equal(snapshot.assessment.currentHoldReason, null);
  assert.equal(snapshot.assessment.downstream.state, 'cancelled');
  assert.match(html, /历史取消原因：未记录/);
  assert.match(html, /不能用来推定历史取消原因/);
  assert.match(html, /不按完成树数推算产量，也不自动派车/);
  assert.equal('kilograms' in snapshot.assessment, false);
});

test('fixed-clock names and visible times use Shanghai midnight independent of host time zone', () => {
  const moduleUrl = new URL('../src/workspace/taskEvidenceExport.ts', import.meta.url).href;
  const script = `import { createTaskEvidenceSnapshot, taskEvidenceArtifact } from ${JSON.stringify(moduleUrl)}; const snapshot=createTaskEvidenceSnapshot(${JSON.stringify(completed())},undefined,${now}); console.log(JSON.stringify(taskEvidenceArtifact(snapshot,'html')));`;
  const results = ['UTC', 'America/Los_Angeles'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.deepEqual(results[0], results[1]);
  assert.match(results[0].filename, /20261018-000005\.html$/);
  assert.match(results[0].content, /2026\/10\/18 00:00:05（北京时间）/);
  assert.equal(results[0].mimeType, 'text/html;charset=utf-8');
});

test('download filename is a bounded basename, retains site and time, and rejects unsupported formats', () => {
  const input = task({ id: '../..\\evil:<script>\u0000/?' + '很长'.repeat(80) });
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now);
  for (const format of ['html', 'json']) {
    const result = taskEvidenceArtifact(snapshot, format);
    assert.match(result.filename, /^核对单-hainan-/);
    assert.match(result.filename, new RegExp(`-20261018-000005\\.${format}$`));
    assert.doesNotMatch(result.filename, /[/\\:<>&"'\u0000]/);
    assert.doesNotMatch(result.filename, /\.\./);
    assert.ok(result.filename.length < 110);
  }
  assert.throws(() => taskEvidenceArtifact(snapshot, 'csv'), /不支持的导出格式/);
});

test('non-tapping tasks do not gain a collection or transport dependency', () => {
  for (const kind of ['巡检', '联调', '树表处理']) {
    const snapshot = createTaskEvidenceSnapshot(task({ kind }), undefined, now);
    assert.equal(snapshot.assessment.downstream, null, kind);
    assert.match(renderTaskEvidenceHtml(snapshot), /此任务不属于割胶任务，无储运依赖预览/);
  }
});

test('flow and surface completion remain clearly classified separately from per-tree receipts', () => {
  const flow = task({ status: '已完成', done: 1, dispatch: { phase: 'completed', history: [{ time: new Date(now).toISOString(), label: '模拟流程完成' }] } });
  const surface = task({ kind: '树表处理', status: '已完成', done: 1, receipt: { outcome: '已完成处理', note: '填写复查结果', time: new Date(now).toISOString() } });
  for (const [input, kind, label] of [[flow, 'flow', '模拟流程记录（非逐树设备回执）'], [surface, 'surface', '现场处理填写记录（非逐树设备回执）']]) {
    const snapshot = createTaskEvidenceSnapshot(input, undefined, now);
    assert.equal(snapshot.assessment.evidence.completionKind, kind);
    assert.equal(snapshot.assessment.evidence.hasCompletionRecord, true);
    assert.equal(snapshot.assessment.evidence.completedReceipts, 0);
    assert.ok(renderTaskEvidenceHtml(snapshot).includes(label));
  }
});

test('adoption park names are understandable for explicit site IDs and historical Hainan sources', () => {
  for (const [site, siteId, name] of [['hainan', 'demo-hainan', sites.hainan], ['xsbn', 'demo-xsbn', sites.xsbn], ['xian', 'demo-xian', sites.xian], ['hainan', undefined, sites.hainan], ['hainan-danzhou','demo-hainan-danzhou',sites['hainan-danzhou']]]) {
    const selected = job({ harnessSource: source({ siteId }) });
    const snapshot = createTaskEvidenceSnapshot(completed({ site, railJob: selected, railResult: receipt({ job: structuredClone(selected) }) }), undefined, now);
    assert.equal(snapshot.assessment.evidence.sources.length, 1);
    assert.ok(renderTaskEvidenceHtml(snapshot).includes(`<dd>${name} / T-0001</dd>`), String(siteId));
  }
});

const businessRecord = (patch = {}) => ({id: 'record-collect', at: new Date(now).toISOString(), operator: '经办甲', note: '模拟核对完成', ...patch});
const logisticsBatch = (patch = {}) => ({id: 'batch-one', siteId: 'demo-hainan', revision: 7, stage: 'received', mode: 'simulation',
  source: {taskId: 'rail-one', taskRevision: 3, taskTitle: '单树割胶', taskStatus: '已完成', treeIndices: [0], completedTrees: 1, completionKind: 'rail', receipts: [receipt()]},
  collection: {...businessRecord(), point: {id: 'hn-collection-a', name: '海南示例收胶点 A'}, containerCount: 3},
  weighing: {...businessRecord({id: 'record-weigh'}), grossKg: 125, tareKg: 5, netKg: 120},
  inspections: [{...businessRecord({id: 'record-inspect-held', note: '样品待复检'}), sampleId: 'sample-first', dryRubberPercent: 29, decision: 'hold'}, {...businessRecord({id: 'record-inspect-passed', note: '复检通过'}), sampleId: 'sample-recheck', dryRubberPercent: 30, decision: 'pass'}],
  transport: {...businessRecord({id: 'record-plan'}), destination: {id: 'hn-processing-a', name: '海南示例加工厂 A'}, vehicleCode: '模拟车辆-A', driver: '驾驶员甲', plannedDepartureAt: new Date(now).toISOString(), plannedKg: 120,
    departure: businessRecord({id: 'record-dispatch'}), receipt: {...businessRecord({id: 'record-receive', note: '模拟签收差额已核实'}), receivedKg: 118.5, differenceKg: -1.5}},
  history: [{...businessRecord(), action: 'collect', requestId: 'req-collect'}, {...businessRecord({id: 'record-inspect-held'}), action: 'inspect', requestId: 'req-first-inspection'}, {...businessRecord({id: 'record-receive'}), action: 'receive', requestId: 'req-receive'}], ...patch});

test('received logistics exports actual saved business stage and complete documents instead of awaiting collection', () => {
  const input = completed(), batch = logisticsBatch();
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now, [], [batch]);
  assert.equal(snapshot.assessment.downstream.state, 'received');
  assert.equal(snapshot.assessment.downstream.label, '已到厂签收 · 待加工');
  assert.doesNotMatch(snapshot.assessment.downstream.reason, /待收胶/);
  assert.deepEqual(snapshot.task, input);
  const html = renderTaskEvidenceHtml(snapshot);
  for (const value of ['模拟收胶与运输单据', 'batch-one', '海南示例收胶点 A', '毛重（kg 鲜胶乳）', '净重（kg 鲜胶乳）', 'sample-first', 'sample-recheck', '第 2 次复检', '模拟车辆-A', '驾驶员甲', '发车记录', '签收记录', '118.5', '-1.5', '模拟签收差额已核实', '全部批次办理记录']) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /待收胶确认/);
});

test('a collected partial cancellation preserves upstream cancellation and receipts while exporting its independent batch', () => {
  const first = job(), second = job({id: 'rail-two', harnessSource: source({treeId: 'T-0002'})});
  const input = task({status: '已取消', count: 2, done: 1, treeIndices: [0, 1], railBatch: {baseDone: 0, jobs: {0: first, 1: second}, results: {0: receipt({job: first}), 1: receipt({index: 1, job: second, outcome: 'cancelled'})}}});
  const batch = logisticsBatch({stage: 'weighed', transport: undefined, inspections: [], source: {...logisticsBatch().source, taskStatus: '已取消'}});
  const before = createTaskEvidenceSnapshot(input, undefined, now);
  const snapshot = createTaskEvidenceSnapshot(input, undefined, now, [], [batch]);
  assert.equal(snapshot.task.status, '已取消');
  assert.deepEqual(snapshot.task, input); assert.deepEqual(snapshot.assessment.evidence, before.assessment.evidence);
  assert.equal(snapshot.assessment.evidence.completedReceipts, 1); assert.equal(snapshot.assessment.evidence.cancelledReceipts, 1);
  assert.equal(snapshot.assessment.downstream.state, 'weighed'); assert.equal(before.assessment.downstream.state, 'cancelled');
  assert.deepEqual(snapshot.logisticsBatch.source.treeIndices, [0]);
  assert.match(renderTaskEvidenceHtml(snapshot), /已称重 · 待质检/);
});

test('batch snapshots isolate site and task identity, escape saved notes and remain frozen after later updates', () => {
  const batch = logisticsBatch();batch.collection.note = '<script>batch-note</script>';
  const foreign = logisticsBatch({id: 'FOREIGN-BATCH-SECRET', siteId: 'demo-xsbn'});
  const other = logisticsBatch({id: 'OTHER-BATCH-SECRET', source: {...batch.source, taskId: 'other-task'}});
  const snapshot = createTaskEvidenceSnapshot(completed(), undefined, now, [], [foreign, other, batch]);
  const html = renderTaskEvidenceHtml(snapshot), json = taskEvidenceArtifact(snapshot, 'json').content;
  assert.equal(snapshot.logisticsBatch.id, 'batch-one');
  assert.doesNotMatch(html, /FOREIGN-BATCH-SECRET|OTHER-BATCH-SECRET|<script>/);
  assert.match(html, /&lt;script&gt;batch-note&lt;\/script&gt;/);
  batch.source.treeIndices.push(1);batch.weighing.netKg = 999;batch.inspections[0].note = 'later-quality';batch.transport.receipt.receivedKg = 999;batch.history[0].note = 'later-history';
  assert.equal(renderTaskEvidenceHtml(snapshot), html);assert.equal(taskEvidenceArtifact(snapshot, 'json').content, json);
  const missing = createTaskEvidenceSnapshot(completed(), undefined, now, [], [foreign, other]);
  assert.equal(missing.logisticsBatch, null);assert.equal(missing.assessment.downstream.state, 'awaiting-weighing');
  assert.doesNotMatch(taskEvidenceArtifact(missing, 'json').content, /FOREIGN-BATCH-SECRET|OTHER-BATCH-SECRET/);
});
