import type { Task } from './model';
import type { FleetJob, FleetResult, FleetSnapshot } from '../zoneFleet';
import type {DemoTaskStrategy, DemoTaskReceipt} from '../../../shared/demoTaskChain.ts';
import {demoTaskAngle} from '../../../shared/demoTaskChain.ts';
import treeMapping from '../integration/tree-map.json' with { type: 'json' };
import {recordedText,recordedTime,sourceSite,sourceIdentity,sourceRecord,sameDispatchAttempt,sameDispatchJob} from '../fleetJobIdentity.ts';
import {eventHoldForTask, type OperationalEvent} from './operationalEvents.ts';
export {sameDispatchAttempt,sameDispatchSource,sameDispatchJob} from '../fleetJobIdentity.ts';

export type TaskEvidenceIssue = { code: string; message: string; index?: number };
export type TaskEvidence = {
  validDispatchIndices: number[];
  sources: NonNullable<FleetJob['harnessSource']>[];
  receipts: FleetResult[];
  rawReceipts: FleetResult[];
  issues: TaskEvidenceIssue[];
  completedReceipts: number;
  cancelledReceipts: number;
  demoStrategy: DemoTaskStrategy | null;
  demoReceipts: DemoTaskReceipt[];
  demoCompletedReceipts: number;
  demoSkippedReceipts: number;
  demoCancelledReceipts: number;
  hasCompletionRecord: boolean;
  completionKind: 'rail' | 'flow' | 'surface' | null;
};

/** Read existing records only. Task creation/progress is not proof of strategy approval. */
export function taskEvidence(task: Task): TaskEvidence {
  const issues: TaskEvidenceIssue[] = [];
  const issue = (code: string, message: string, index?: number) => issues.push({ code, message, ...(index === undefined ? {} : { index }) });
  const hasRail = !!(task.railJob || task.railResult || task.railBatch);
  const entries: [number, FleetJob][] = task.railBatch
    ? Object.entries(task.railBatch.jobs).map(([index, job]) => [Number(index), job])
    : task.railJob ? [[task.treeIndices?.[0] ?? -1, task.railJob]] : [];
  const rawEntries: [number, FleetResult][] = [
    ...Object.entries(task.railBatch?.results ?? {}).map(([index, result]): [number, FleetResult] => [Number(index), result]),
    ...(task.railResult ? [[task.railResult.index, task.railResult] as [number, FleetResult]] : []),
  ];
  const rawReceipts = rawEntries.map(([, result]) => result);
  const receipts: FleetResult[] = [];
  const targets = task.treeIndices;
  const targetSet = new Set(targets ?? []);
  const validTargets = !!targets && targets.length === task.count && targetSet.size === targets.length
    && targets.every(index => Number.isInteger(index) && index >= 0 && index < 200);
  if (hasRail && !validTargets) issue('task_targets_invalid', '未记录完整、唯一的任务树木范围，无法核对逐树回执。');
  if (task.railBatch && (task.railJob || task.railResult)) issue('mixed_rail_records', '任务同时存在单树与批次记录，需确认所属执行批次。');
  const expected = new Map<number, FleetJob>();
  const invalidJobs = new Set<number>();
  const jobIds = new Map<string, number>();
  const sourceCandidates = new Map<string, { source: NonNullable<FleetJob['harnessSource']>; indices: number[]; conflict: boolean }>();
  for (const [index, job] of entries) {
    expected.set(index, job);
    const reject = (code: string, message: string) => { issue(code, message, index); invalidJobs.add(index); };
    if (!validTargets || !targetSet.has(index)) reject('job_outside_targets', '派发任务的树木索引不在已记录的任务范围内。');
    if (!job || !recordedText(job.id) || !recordedText(job.planVersion) || !Number.isFinite(job.angle)) {
      reject('job_identity_invalid', '派发记录缺少有效的任务编号、计划版本或角度。');
      continue;
    }
    if (!recordedTime(job.requestedAt) || job.attemptId !== undefined && !recordedText(job.attemptId))
      reject('job_request_invalid', '派发记录缺少有效的请求时间，或执行尝试编号无效。');
    if (!task.railBatch && job.id !== task.id) reject('job_task_mismatch', '单树派发编号与任务编号不一致。');
    const previousIndex = jobIds.get(job.id);
    if (previousIndex !== undefined) {
      reject('duplicate_job_id', '相同派发编号出现在多个树木索引，不能重复计数。');
      invalidJobs.add(previousIndex);
    } else jobIds.set(job.id, index);
    const source = job?.harnessSource;
    if (!source) continue; // Older baseline jobs have no model-adoption evidence.
    let sourceValid = true;
    const rejectSource = (code: string, message: string) => { reject(code, message); sourceValid = false; };
    if (!recordedText(source.treeId) || !recordedText(source.strategyId) || !recordedText(source.runId)
      || !Number.isInteger(source.revision) || source.revision < 1 || !Number.isFinite(source.angle)
      || source.mode !== 'simulation' || source.dataMode !== undefined && !['demo', 'mixed_demo'].includes(source.dataMode))
      rejectSource('source_identity_invalid', '策略采用记录缺少有效的对象、策略、分析批次、版本、角度或模拟模式。');
    if (sourceSite(source) !== `demo-${task.site}`) rejectSource('source_site_mismatch', '策略采用记录与任务所属园区不一致。');
    // This mapping describes the Hainan scene only; other parks must not inherit its tree identity.
    if (task.site === 'hainan' && treeMapping.find(tree => tree.sceneIndex === index)?.treeId !== source.treeId)
      rejectSource('source_tree_mismatch', '策略采用对象与任务树位映射不一致。');
    if (!recordedTime(source.adoptedAt) || !recordedTime(source.expiresAt) || Date.parse(source.adoptedAt) >= Date.parse(source.expiresAt))
      rejectSource('source_time_invalid', '策略采用时间或有效期缺失、无效，或采用时已超过有效期。');
    if (source.angle !== job.angle) rejectSource('source_angle_mismatch', '派发角度与已记录的策略采用角度不一致。');
    if (sourceValid) {
      const key = sourceIdentity(source), previous = sourceCandidates.get(key);
      if (previous) {
        previous.indices.push(index);
        if (previous.conflict || sourceRecord(previous.source) !== sourceRecord(source)) {
          previous.conflict = true;
          rejectSource('source_record_conflict', '相同采用身份存在不同角度、有效期或数据模式，需核对原记录。');
          for (const previousIndex of previous.indices) invalidJobs.add(previousIndex);
        }
      } else sourceCandidates.set(key, { source, indices: [index], conflict: false });
    }
  }
  // A later duplicate ID or adoption conflict can invalidate an earlier job.
  const sources = [...sourceCandidates.values()]
    .filter(candidate => !candidate.conflict && candidate.indices.some(index => !invalidJobs.has(index)))
    .map(candidate => candidate.source);
  const seenResults = new Set<number>();
  for (const [key, result] of rawEntries) {
    const index = result?.index;
    const reject = (code: string, message: string) => issue(code, message, Number.isInteger(index) ? index : undefined);
    if (!result || !Number.isInteger(index) || key !== index || !validTargets || !targetSet.has(index)) {
      reject('receipt_target_mismatch', '回执索引、存储位置或所属任务范围不一致。'); continue;
    }
    if (seenResults.has(index)) { reject('duplicate_receipt', '同一树木存在重复回执，不能重复计数。'); continue; }
    seenResults.add(index);
    const job = expected.get(index);
    if (!job) { reject('receipt_job_missing', '回执没有对应的原派发记录。'); continue; }
    if (invalidJobs.has(index)) { reject('receipt_job_invalid', '原派发或采用记录未通过核对，此回执暂不计入有效数量。'); continue; }
    if (!result.job || result.job.id !== job.id) { reject('receipt_job_mismatch', '回执派发编号与原任务不一致。'); continue; }
    if (!sameDispatchAttempt(result.job, job)) {
      reject('receipt_attempt_mismatch', '回执请求时间或执行尝试编号与原派发不一致，不能计入本次执行。'); continue;
    }
    if (result.job.planVersion !== job.planVersion || result.job.angle !== job.angle) {
      reject('receipt_plan_mismatch', '回执计划版本或角度与原派发记录不一致。'); continue;
    }
    if (!!result.job.harnessSource !== !!job.harnessSource || job.harnessSource && result.job.harnessSource
      && sourceRecord(result.job.harnessSource) !== sourceRecord(job.harnessSource)) {
      reject('receipt_source_mismatch', '回执的园区、对象、策略、分析批次、版本或采用记录与原派发不一致。'); continue;
    }
    if (!recordedTime(result.finishedAt) || Date.parse(result.finishedAt) < Date.parse(job.requestedAt)
      || job.harnessSource && Date.parse(result.finishedAt) < Date.parse(job.harnessSource.adoptedAt)) {
      reject('receipt_time_invalid', '回执时间缺失、无效，或早于派发请求、策略采用时间。'); continue;
    }
    if (!['completed', 'cancelled'].includes(result.outcome)) { reject('receipt_outcome_invalid', '回执结果未记录为完成或取消。'); continue; }
    receipts.push(result);
  }
  const received = new Set(receipts.map(result => result.index));
  for (const [index] of expected) if (!received.has(index)) issue('receipt_missing', '该树尚无通过关联核对的执行回执。', index);
  const completedReceipts = receipts.filter(result => result.outcome === 'completed').length;
  const cancelledReceipts = receipts.filter(result => result.outcome === 'cancelled').length;
  const skipped = task.dispatch?.skipped ?? [];
  const hasDemo = !!task.demoStrategy || task.demoReceipts !== undefined;
  const candidate = task.demoStrategy;
  const demoStrategy = candidate && candidate.taskId === task.id && candidate.siteId === `demo-${task.site}`
    && validTargets && candidate.treeIndices.length === targets!.length
    && new Set(candidate.treeIndices).size === targets!.length && candidate.treeIndices.every(index => targetSet.has(index))
    ? candidate : null;
  if (hasDemo && !demoStrategy) issue('demo_strategy_mismatch', '模拟策略与任务、园区或树木范围不一致。');
  const demoReceipts: DemoTaskReceipt[] = [];
  const demoSeen = new Set<number>();
  for (const receipt of task.demoReceipts ?? []) {
    if (!demoStrategy || receipt.taskId !== task.id || receipt.siteId !== `demo-${task.site}`
      || receipt.strategyId !== demoStrategy.strategyId || receipt.strategyRevision !== demoStrategy.revision
      || !targetSet.has(receipt.treeIndex) || demoSeen.has(receipt.treeIndex)
      || receipt.angleDeg !== demoTaskAngle(demoStrategy,receipt.treeIndex)) {
      issue('demo_receipt_mismatch', '模拟回执与所属任务、园区、策略版本或目标树不一致。', receipt.treeIndex);
      continue;
    }
    demoSeen.add(receipt.treeIndex);
    demoReceipts.push(receipt);
  }
  const demoCompletedReceipts = demoReceipts.filter(receipt => receipt.outcome === 'completed').length;
  const demoSkippedReceipts = demoReceipts.filter(receipt => receipt.outcome === 'skipped').length;
  const demoCancelledReceipts = demoReceipts.filter(receipt => receipt.outcome === 'cancelled').length;
  if (hasDemo && (demoCompletedReceipts !== task.done || demoSkippedReceipts !== skipped.length
    || demoReceipts.some(receipt => (receipt.outcome === 'skipped') !== skipped.includes(receipt.treeIndex))))
    issue('demo_completion_count_mismatch', '模拟完成、跳过回执与任务进度不一致。');
  const validCounts = Number.isInteger(task.count) && task.count > 0 && Number.isInteger(task.done) && task.done >= 0 && task.done <= task.count
    && (!targets || validTargets)
    && new Set(skipped).size === skipped.length && skipped.every(index => Number.isInteger(index) && index >= 0 && index < 200 && (!targets || targetSet.has(index)))
    && task.done + skipped.length <= task.count;
  if (!validCounts) issue('task_count_invalid', '任务总数、完成数或跳过范围不一致。');
  if (task.status === '已完成' && task.done + skipped.length !== task.count) issue('completed_status_mismatch', '任务标记为已完成，但完成与跳过数量尚未覆盖全部对象。');
  if (hasRail && task.done !== completedReceipts) issue('completion_count_mismatch', `任务记录完成 ${task.done} 株，但仅有 ${completedReceipts} 份通过核对的完成回执。`);
  const baseDone = task.railBatch?.baseDone ?? 0;
  if (hasRail && baseDone !== 0) issue('prior_completion_unverified', `此前记录完成 ${baseDone} 株，本批次未附其逐树回执，不能据此确认全部完成。`);
  if (hasRail && expected.size + skipped.length !== task.count) issue('job_count_mismatch', '派发对象数与任务总数、跳过数量不一致，需补齐原派发记录。');
  if (hasRail && receipts.some(result => skipped.includes(result.index))) issue('receipt_skipped_overlap', '相同树木同时被记录为跳过和执行，需核对数量。');
  const closedComplete = task.status === '已完成' && validCounts && task.done + skipped.length === task.count;
  let completionKind: TaskEvidence['completionKind'] = null;
  if (hasRail) {
    if (closedComplete && issues.length === 0 && completedReceipts === task.done && cancelledReceipts === 0 && receipts.length === expected.size)
      completionKind = 'rail';
  } else if (hasDemo && closedComplete) {
    if (demoStrategy?.adoptedAt && issues.length === 0 && demoReceipts.length === task.count && demoCancelledReceipts === 0)
      completionKind = 'flow';
    else issue('completion_record_missing', '模拟任务尚未补齐本策略下的逐树完成与跳过回执。');
  } else if (closedComplete) {
    if (task.dispatch?.phase === 'completed' && task.dispatch.history.length > 0
      && task.dispatch.history.every(entry => recordedTime(entry.time) && recordedText(entry.label))) completionKind = 'flow';
    else if (task.receipt?.outcome === '已完成处理' && recordedText(task.receipt.note) && recordedTime(task.receipt.time)) completionKind = 'surface';
    else issue('completion_record_missing', '只有任务完成状态，尚无可核对的逐树回执、模拟流程记录或现场处理记录。');
  }
  return {
    validDispatchIndices: validTargets && !(task.railBatch && (task.railJob || task.railResult))
      ? [...expected.keys()].filter(index => !invalidJobs.has(index)) : [],
    sources, receipts, rawReceipts, issues, completedReceipts, cancelledReceipts,
    demoStrategy, demoReceipts, demoCompletedReceipts, demoSkippedReceipts, demoCancelledReceipts,
    hasCompletionRecord: completionKind !== null, completionKind,
  };
}

const phaseReasons: Record<string, string> = {
  'pause-requested': '正在等待机器人确认暂停', paused: '机器人已暂停',
  'resume-requested': '正在等待机器人确认继续', 'cancel-requested': '正在等待机器人确认取消',
  review: '树表异常待人工复核', recapturing: '树表证据正在补拍', failed: '机器人未接收任务',
};

/** Include live pause/weather/validation state before task synchronization catches up. */
export function taskHoldReason(task: Task, fleet?: FleetSnapshot, now = Date.now(), events: readonly OperationalEvent[] = []): string | null {
  if (task.status === '已取消') return null;
  const eventHold = eventHoldForTask(task, events);
  if (eventHold) return eventHold;
  const phaseReason = phaseReasons[task.dispatch?.phase ?? ''];
  if (phaseReason) return phaseReason;
  if (task.status === '已完成') return null;
  const lastDispatchCheck = task.railDispatchChecks?.at(-1);
  if (task.status === '待处理' && lastDispatchCheck?.outcome === 'blocked') return lastDispatchCheck.message;
  const entries: [number, FleetJob][] = task.railBatch
    ? Object.entries(task.railBatch.jobs).filter(([index]) => !task.railBatch!.results[Number(index)])
      .map(([index, job]) => [Number(index), job])
    : task.railJob && task.treeIndices?.[0] !== undefined && !task.railResult
      ? [[task.treeIndices[0], task.railJob]] : [];
  for (const [index, saved] of entries) {
    const live = task.site === 'hainan' ? fleet?.jobs[index] : undefined;
    const matchingLive = sameDispatchJob(live, saved) ? live : undefined;
    const job = matchingLive ?? saved;
    const zone = matchingLive ? fleet?.zones.find(zone => zone.zone === Math.floor(index / 50)) : undefined;
    if (zone?.eventHoldReason) return zone.eventHoldReason;
    if (zone?.paused) return '本区机器人已暂停';
    const reason = job.blockedReason || job.weatherBlock || job.strategyBlock;
    if (reason) return reason;
    if (job.harnessSource && !(Date.parse(job.harnessSource.expiresAt) > now)) return '已采用策略过期，需重新确认';
    if ((job.notAfter ?? Infinity) <= now) return '天气作业窗口已失效';
    if ((job.notBefore ?? 0) > now) return '等待已确认的天气作业窗口';
    if (job.validation === 'invalid') return '策略或天气核验未通过';
    if (job.validation === 'pending') return '策略与天气正在核验';
  }
  if (task.status === '待处理' && task.site === 'hainan' && task.kind === '割胶'
    && !task.dispatch && !task.id.startsWith('rail-') && !task.railBatch && !task.railJob && !task.railResult && !task.railDispatchChecks?.length)
    return '此前未保存具体失败原因，请点击“重新核验并执行”查看当前检查结果';
  return task.status === '待处理' ? '上游任务有待处理事项，需核实原因' : null;
}

export type LogisticsState = 'cancelled' | 'blocked' | 'waiting' | 'awaiting-receipt' | 'awaiting-weighing' | 'no-output';
export type LogisticsDependency = { task: Task; state: LogisticsState; label: string; reason: string; evidence: TaskEvidence };

/** A dependency preview, never a transport order or inferred latex quantity. */
export function logisticsDependency(task: Task, fleet?: FleetSnapshot, now = Date.now(), events: readonly OperationalEvent[] = []): LogisticsDependency {
  const evidence = taskEvidence(task);
  const result = (state: LogisticsState, label: string, reason: string) => ({ task, state, label, reason, evidence });
  if (task.status === '已取消' || task.dispatch?.phase === 'cancelled') return result('cancelled', '停止计划', '割胶任务已取消，不继续安排运输；已有产胶需人工核实。');
  const eventHold = eventHoldForTask(task, events, true);
  if (eventHold) return result('blocked', '暂缓计划', eventHold + '；收胶与储运准备待确认恢复，保留原作业回执。');
  const hold = taskHoldReason(task, fleet, now, events);
  if (hold) return result('blocked', '暂缓计划', hold + '，储运计划随上游暂缓。');
  if (task.status !== '已完成') return result('waiting', '等待割胶', '等待割胶结束及执行回执，尚不能确认收胶或运输。');
  if (!evidence.hasCompletionRecord) return result('awaiting-receipt', '待核对回执', '仅有任务完成状态，缺少可核对的完成记录。');
  if (task.done === 0) return result('no-output', '无割胶完成记录', '本次对象均未完成割胶，不据此安排运输。');
  return result('awaiting-weighing', '待收胶确认', '已有模拟执行完成记录；仍需实际收胶量、称重、收胶时间及车辆确认。');
}

export function logisticsDependencies(tasks: Task[], fleet?: FleetSnapshot, now = Date.now(), events: readonly OperationalEvent[] = []): LogisticsDependency[] {
  return tasks.filter(task => task.kind === '割胶').map(task => logisticsDependency(task, fleet, now, events));
}
