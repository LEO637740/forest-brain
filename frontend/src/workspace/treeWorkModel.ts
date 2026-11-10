import type { Site, Task } from './model';
import type { FleetJob, FleetResult } from '../zoneFleet';
import type {DemoTaskStrategy, DemoTaskReceipt} from '../../../shared/demoTaskChain.ts';
import { recordedText, recordedTime } from '../fleetJobIdentity.ts';
import { taskEvidence } from './taskLifecycleModel.ts';
import { phaseLabels, treeTaskState } from './taskFlow.ts';

export type TreeWorkRecord = {
  task: Task;
  index: number;
  kind: 'rail' | 'flow' | 'record';
  status: string;
  note: string;
  plan?: FleetJob;
  receipt?: FleetResult;
  demoStrategy?: DemoTaskStrategy;
  demoReceipt?: DemoTaskReceipt;
  time: number | null;
  timeLabel: string;
};

function recordTime(value?: string, label = '记录'): Pick<TreeWorkRecord, 'time' | 'timeLabel'> {
  if (!recordedTime(value)) return { time: null, timeLabel: '记录时间待核对' };
  const time = Date.parse(value!);
  return {
    time,
    timeLabel: `${label}：${new Date(time).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })}（北京时间）`,
  };
}

function workRecord(task: Task, index: number): TreeWorkRecord {
  const base = { task, index, ...recordTime() };
  if (task.railJob || task.railResult || task.railBatch) {
    const evidence = taskEvidence(task);
    const plan = evidence.validDispatchIndices.includes(index)
      ? task.railBatch?.jobs[index] ?? task.railJob : undefined;
    // Include both the storage slot and the claimed index. A misfiled receipt
    // must not disappear simply because its issue points at a different tree.
    const entries: [number, FleetResult][] = [
      ...Object.entries(task.railBatch?.results ?? {}).map(([key, result]): [number, FleetResult] => [Number(key), result]),
      ...(task.railResult ? [[task.treeIndices?.[0] ?? -1, task.railResult] as [number, FleetResult]] : []),
    ];
    const local = entries.filter(([key, result]) => key === index || result?.index === index);
    const ambiguous = !plan || local.length > 1 || task.dispatch?.skipped?.includes(index)
      || local.some(([key, result]) => key !== index || result?.index !== index || !evidence.receipts.includes(result));
    const common = { ...base, kind: 'rail' as const, plan, ...recordTime(plan?.requestedAt, '派发时间') };
    if (ambiguous) return {
      ...common, status: '作业记录待核对',
      note: '本树原派发或回执的关联存在缺项或矛盾，暂不能确认完成或取消。原始记录保留，可进入关联任务核对。',
    };
    const receipt = evidence.receipts.find(result => result.index === index);
    if (receipt) return {
      ...common, receipt, ...recordTime(receipt.finishedAt, '回执时间'),
      status: receipt.outcome === 'completed' ? '已完成割胶' : '已取消作业',
      note: '依据本树通过关联核对的模拟执行回执。' + (evidence.issues.some(issue => issue.code !== 'receipt_missing')
        ? '关联任务仍有待核对项，本树结果不代表整批已完成。' : '本树结果不代表整批已完成或实测产胶量。'),
    };
    return {
      ...common, status: '等待本树回执',
      note: `关联任务记录为“${task.status}”；尚无本树通过核对的回执，不能据此确认本树完成、取消或正在执行。缺少回执不代表执行失败。`,
    };
  }
  if (task.demoStrategy || task.demoReceipts !== undefined) {
    const evidence = taskEvidence(task), strategy = evidence.demoStrategy;
    if (!strategy) return {...base, kind: 'flow', status: '流程记录待核对', note: '模拟策略与本任务的园区或树木范围不一致。'};
    const receipt = evidence.demoReceipts.find(result => result.treeIndex === index);
    const common = {...base, kind: 'flow' as const, demoStrategy: strategy};
    if (receipt) return {
      ...common, demoReceipt: receipt, ...recordTime(receipt.finishedAt, '回传时间'),
      status: {completed: '已完成割胶', skipped: '已跳过 · 待复查', cancelled: '已取消作业'}[receipt.outcome],
      note: receipt.note,
    };
    const state = treeTaskState(task, index);
    return {
      ...common, ...recordTime(strategy.adoptedAt ?? strategy.generatedAt, strategy.adoptedAt ? '策略采用时间' : '策略生成时间'),
      status: !strategy.adoptedAt ? '待采用模拟策略'
        : ['已完成割胶', '已跳过 · 待复查'].includes(state) ? '等待本树回传' : `模拟流程 · ${state}`,
      note: strategy.summary,
    };
  }
  if (task.dispatch) {
    const evidence = taskEvidence(task), history = task.dispatch.history;
    const targets = task.treeIndices!;
    const valid = targets.length === task.count && new Set(targets).size === targets.length
      && targets.every(value => Number.isInteger(value) && value >= 0 && value < 200)
      && Object.hasOwn(phaseLabels, task.dispatch.phase) && history.length > 0
      && history.every(entry => recordedTime(entry.time) && recordedText(entry.label))
      && (task.dispatch.skipped ?? []).every(value => targets.indexOf(value) < task.done + (task.dispatch!.skipped?.length ?? 0))
      && (task.dispatch.phase === 'completed') === (task.done + (task.dispatch.skipped?.length ?? 0) === task.count)
      && !evidence.issues.some(issue => ['task_count_invalid', 'completed_status_mismatch'].includes(issue.code))
      && (task.dispatch.phase !== 'completed' || task.status === '已完成')
      && (task.dispatch.phase !== 'cancelled' || task.status === '已取消')
      && (task.status !== '已完成' || task.dispatch.phase === 'completed')
      && (task.status !== '已取消' || task.dispatch.phase === 'cancelled');
    if (!valid) return { ...base, kind: 'flow', status: '流程记录待核对', note: '模拟流程的范围、进度或历史记录不完整，暂不能确认本树作业结果。' };
    const latest = history.reduce((a, b) => Date.parse(a.time) >= Date.parse(b.time) ? a : b);
    return {
      ...base, kind: 'flow', ...recordTime(latest.time, '流程更新时间'),
      status: `模拟流程 · ${treeTaskState(task, index)}`,
      note: '依据模拟串行流程的进度与跳过记录推算本树状态，非逐树设备回执；更新时间属于整个流程。',
    };
  }
  const receipt = task.receipt;
  const validReceipt = receipt && ['已完成处理', '需再次处理'].includes(receipt.outcome)
    && recordedText(receipt.note) && recordedTime(receipt.time);
  return {
    ...base, kind: 'record', ...(validReceipt ? recordTime(receipt.time, '人工填写时间') : {}),
    status: `任务记录 · ${task.status}`,
    note: receipt ? '现场处理人工填写记录，非逐树机器人回执；任务状态不代表本树已完成割胶。'
      : '仅有任务整体状态，尚无本树逐树执行回执。计划日期不代表实际作业时间。',
  };
}

/** Read-only tree projection. Never infer targets from a block, count or receipt. */
export function treeWorkRecords(tasks: Task[], index: number, site: Site): TreeWorkRecord[] {
  if (!Number.isInteger(index) || index < 0 || index >= 200) return [];
  return tasks.filter(task => task.site === site && task.treeIndices?.includes(index))
    .map(task => workRecord(task, index))
    .sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity));
}
