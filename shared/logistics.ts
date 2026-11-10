import type {DemoTaskStrategy,DemoTaskReceipt} from './demoTaskChain.ts';
import type {Task} from '../frontend/src/workspace/model.ts';
import type {FleetResult} from '../frontend/src/zoneFleet.ts';
import {taskEvidence} from '../frontend/src/workspace/taskLifecycleModel.ts';
import {eventHoldForTask, type OperationalEvent} from '../frontend/src/workspace/operationalEvents.ts';

export type BatchStage = 'collected' | 'weighed' | 'quality-held' | 'ready' | 'planned' | 'in-transit' | 'received' | 'processing' | 'processed' | 'cancelled';
export type BatchAction = 'weigh' | 'inspect' | 'hold' | 'plan' | 'dispatch' | 'receive' | 'start-processing' | 'process' | 'pause' | 'resume' | 'cancel';
export type CollectionSource = {
  taskId: string; taskRevision: number; taskTitle: string; taskStatus: Task['status'];
  treeIndices: number[]; completedTrees: number; completionKind: 'rail' | 'flow'; receipts: FleetResult[];
  demoStrategy?: DemoTaskStrategy; demoReceipts?: DemoTaskReceipt[];
};
export type BusinessRecord = {id: string; at: string; operator: string; note: string};
export type PointSnapshot = {id: string; name: string};
export type CollectionInput = {taskId: string; operator: string; collectionPointId: string; containerCount: number; note: string};
export type BatchActionInput = {
  revision: number; operator: string; note: string; grossKg?: number; tareKg?: number; sampleId?: string;
  dryRubberPercent?: number; decision?: 'pass' | 'hold'; grade?: 'A' | 'B'; destinationId?: string;
  vehicleCode?: string; driver?: string; plannedDepartureAt?: string; receivedKg?: number;
  processLossKg?: number;
};
export type LatexBatch = {
  id: string; siteId: string; revision: number; stage: BatchStage; mode: 'simulation'; source: CollectionSource;
  collection: BusinessRecord & {point: PointSnapshot; containerCount: number};
  weighing?: BusinessRecord & {grossKg: number; tareKg: number; netKg: number};
  inspections: (BusinessRecord & {sampleId: string; dryRubberPercent: number; decision: 'pass' | 'hold'; grade?: 'A' | 'B'})[];
  qualityHold?: BusinessRecord & {resumeStage: 'ready' | 'planned' | 'received'};
  transport?: BusinessRecord & {
    destination: PointSnapshot; vehicleCode: string; driver: string; plannedDepartureAt: string; plannedKg: number;
    departure?: BusinessRecord; receipt?: BusinessRecord & {receivedKg: number; differenceKg: number};
  };
  processingStarted?: BusinessRecord;
  processing?: BusinessRecord & {latexKg: number; dryRubberPercent: number; dryKg: number; inspectionId: string;
    theoreticalDryKg?: number; processLossKg?: number; grade?: 'A' | 'B'};
  manualHold?: BusinessRecord;
  history: (BusinessRecord & {action: 'collect' | BatchAction; requestId: string})[];
};

export const batchStageLabels: Record<BatchStage, string> = {
  collected: '已收胶 · 待称重', weighed: '已称重 · 待质检', 'quality-held': '质检暂扣 · 待复检',
  ready: '质检通过 · 待安排运输', planned: '已生成模拟运单 · 待发车', 'in-transit': '模拟运输中',
  received: '已到厂签收 · 待加工', processing: '加工中 · 待登记入库', processed: '已加工入库', cancelled: '流程已取消',
};
export const batchActionLabels: Record<BatchAction | 'collect', string> = {
  collect: '登记收胶', weigh: '登记称重', inspect: '登记质检', plan: '安排运输', dispatch: '确认发车',
  receive: '登记签收', hold: '质检冻结', 'start-processing': '开始模拟加工', process: '模拟加工入库', pause: '暂停流程', resume: '恢复流程', cancel: '取消流程',
};

/** Use the same receipt checks as task details and evidence exports. Never infer kilograms. */
export function collectionSource(task: Task): CollectionSource | null {
  if (task.kind !== '割胶' || task.site === 'xian' || !['已完成', '已取消'].includes(task.status) || task.done <= 0) return null;
  const evidence = taskEvidence(task);
  if (evidence.issues.length) return null;
  let indices: number[], kind: CollectionSource['completionKind'];
  if (task.railJob || task.railBatch || task.railResult) {
    indices = evidence.receipts.filter(receipt => receipt.outcome === 'completed').map(receipt => receipt.index);
    if (!indices.length || indices.length !== task.done) return null;
    kind = 'rail';
  } else if (evidence.demoStrategy) {
    indices = evidence.demoReceipts.filter(receipt => receipt.outcome === 'completed').map(receipt => receipt.treeIndex);
    kind = 'flow';
  } else {
    if (evidence.completionKind !== 'flow' || !task.treeIndices) return null;
    indices = task.treeIndices.filter(index => !task.dispatch!.skipped?.includes(index));
    if (indices.length !== task.done) return null;
    kind = 'flow';
  }
  return {
    taskId: task.id, taskRevision: task.revision ?? 1, taskTitle: task.title, taskStatus: task.status,
    treeIndices: indices, completedTrees: indices.length, completionKind: kind,
    receipts: evidence.receipts.filter(receipt => receipt.outcome === 'completed'),
    ...(evidence.demoStrategy?{demoStrategy:evidence.demoStrategy,demoReceipts:evidence.demoReceipts.filter(receipt=>receipt.outcome==='completed')} : {}),
  };
}

function sourceRainHold(siteId: string, source: CollectionSource, events: readonly OperationalEvent[]): string | null {
  // Only completed, explicitly evidenced trees belong to this batch. A fault in
  // remaining tapping work does not invalidate latex already collected.
  const task: Task = {id: source.taskId, site: siteId.slice(5) as Task['site'], title: source.taskTitle,
    kind: '割胶', status: '已完成', count: source.completedTrees, done: source.completedTrees,
    treeIndices: source.treeIndices, block: '', robot: '', start: '', end: ''};
  return eventHoldForTask(task, events, true);
}

export function collectionIssue(task: Task, events: readonly OperationalEvent[], batches: readonly LatexBatch[] = []): string | null {
  if (batches.some(batch => batch.siteId === `demo-${task.site}` && batch.source.taskId === task.id)) return '此割胶任务已登记收胶批次，请查看原批次。';
  const source = collectionSource(task);
  if (!source) return '需先结束割胶任务，并核对至少一棵树的完成回执或完整模拟流程；西安试验作业不登记生产收胶。';
  return sourceRainHold(`demo-${task.site}`, source, events);
}

export function batchHoldReason(batch: LatexBatch, events: readonly OperationalEvent[]): string | null {
  if (['received', 'processing', 'processed', 'cancelled'].includes(batch.stage)) return null;
  const reasons = [batch.manualHold ? `手工暂停：${batch.manualHold.note}` : null,
    batch.transport?.receipt ? null : sourceRainHold(batch.siteId, batch.source, events),
    batch.stage === 'quality-held' ? `质检暂扣，需追加复检并通过后继续。${batch.qualityHold?.note ?? ''}` : null];
  return reasons.filter(Boolean).join('；') || null;
}

const stagesForAction: Record<Exclude<BatchAction, 'pause' | 'resume' | 'cancel'>, BatchStage[]> = {
  weigh: ['collected'], inspect: ['weighed', 'quality-held'], hold: ['ready', 'planned', 'received'],
  plan: ['ready'], dispatch: ['planned'], receive: ['in-transit'], 'start-processing': ['received'], process: ['received', 'processing'],
};
export function batchActionIssue(batch: LatexBatch, action: BatchAction, events: readonly OperationalEvent[]): string | null {
  if (['processed', 'cancelled'].includes(batch.stage)) return '此批次流程已结束，请查看保留的业务记录。';
  if (batch.stage === 'received' && !['hold', 'start-processing', 'process'].includes(action)) return '此批次已到厂签收，请继续加工入库并保留签收记录。';
  if (batch.stage === 'processing' && action !== 'process') return '此批次已投入加工，请登记加工损耗并完成入库。';
  if (batch.stage === 'quality-held' && batch.transport?.receipt && action !== 'inspect') return '到厂批次已冻结，请追加复检后继续加工，签收记录保留。';
  if (action === 'pause') return batch.manualHold ? '此批次已手工暂停。' : null;
  if (action === 'cancel') return batch.stage === 'in-transit' ? '已发车批次请暂停核实或登记签收，不能取消已发生的运输。' : null;
  if (action === 'resume') return batch.manualHold ? null : '此批次没有手工暂停。';
  if (batch.manualHold) return `流程已手工暂停：${batch.manualHold.note}`;
  if (!stagesForAction[action].includes(batch.stage)) return '请按收胶、称重、质检、安排运输、发车、签收、加工入库的顺序处理。';
  if (['start-processing', 'process'].includes(action) && batch.transport!.receipt!.receivedKg <= 0) return '加工厂实收鲜胶乳为 0 kg，没有可加工入库的胶乳。';
  if (action === 'dispatch') return sourceRainHold(batch.siteId, batch.source, events);
  // Rain blocks departure, while indoor records and an arrival that has already
  // happened can still be recorded. Resuming a manual hold clears only that hold.
  return null;
}

/** One current business assessment for the table and exported task evidence. */
export function batchAssessment(batch: LatexBatch, events: readonly OperationalEvent[]) {
  const hold = batchHoldReason(batch, events);
  let reason = hold ?? '已登记独立收胶批次，请按批次记录继续办理。';
  if (batch.stage === 'cancelled') reason = '已取消后续流程，收胶、称重及质检单据保留，已有胶乳需另行核实处理。';
  if (batch.stage === 'received') {
    const receipt = batch.transport!.receipt!;
    reason = `已登记模拟签收 ${receipt.receivedKg} kg 鲜胶乳，较发运净重差额 ${receipt.differenceKg > 0 ? '+' : ''}${receipt.differenceKg} kg；待加工后计入干胶库存。${receipt.note}`;
  }
  if (batch.stage === 'processing') reason = `工厂实收 ${batch.transport!.receipt!.receivedKg} kg 鲜胶乳已投入模拟加工，完成入库前不增加干胶库存。`;
  if (batch.stage === 'processed') {
    const processing = batch.processing!;
    reason = `已将到厂鲜胶乳 ${processing.latexKg} kg 按合格质检干胶含量 ${processing.dryRubberPercent}%${processing.processLossKg ? ` 折干后扣除加工损耗 ${processing.processLossKg} kg，入库` : ' 折算为'} ${processing.dryKg} kg 干胶，模拟加工后计入园区库存。${processing.note}`;
  }
  return {state: hold ? 'blocked' : batch.stage, label: batchStageLabels[batch.stage], reason};
}
