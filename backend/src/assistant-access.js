import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';
import {invariant} from './errors.js';

const treeId = index => `T-${String(index + 1).padStart(4, '0')}`;

/** A task shared with other plots is projected before it leaves the server.
 * Never forward its free-text title, strategy, history or raw dispatch objects. */
export function scopeTaskForIdentity(task, identity) {
  if (identity) invariant(identity.seesTask(task), 'FORBIDDEN_TASK', '该任务不在当前身份可见范围内。', 403);
  if (!identity?.plot) return task;
  const allowed = new Set(identity.plot.treeIds.map(id => Number(id.slice(2)) - 1));
  const treeIndices = (task.treeIndices ?? []).filter(index => allowed.has(index));
  const targets = new Set(treeIndices), evidence = taskEvidence(task);
  const receipts = [
    ...evidence.receipts.filter(row => targets.has(row.index)).map(row => ({
      treeId:treeId(row.index), index:row.index, outcome:row.outcome, finishedAt:row.finishedAt, sourceRef:row.id,
    })),
    ...evidence.demoReceipts.filter(row => targets.has(row.treeIndex)).map(row => ({
      treeId:treeId(row.treeIndex), index:row.treeIndex, outcome:row.outcome, finishedAt:row.finishedAt, sourceRef:row.receiptId,
    })),
  ];
  const done = new Set(receipts.filter(row => row.outcome === 'completed').map(row => row.index)).size;
  const skipped = new Set([...(task.dispatch?.skipped ?? []).filter(index => targets.has(index)),
    ...receipts.filter(row => row.outcome === 'skipped').map(row => row.index)]);
  return {id:task.id, site:task.site, siteId:task.siteId, revision:task.revision, date:task.date,
    title:'本人承包地作业', block:identity.plot.zone, robot:'园区统一安排', start:task.start, end:task.end,
    kind:task.kind, count:treeIndices.length, done, treeIndices,
    status:done === treeIndices.length && treeIndices.length ? '已完成' : task.status === '已完成' ? '待处理' : task.status,
    plotEvidence:{receipts, skipped:[...skipped], scope:'contracted_plot'}};
}

/** Existing summaries retain their shape; growers get counts proved by their own receipts. */
export function summarizeScopedTask(task, identity = null) {
  if (identity?.plot) {
    const scoped = scopeTaskForIdentity(task, identity), {receipts, skipped} = scoped.plotEvidence;
    const completed = new Set(receipts.filter(row => row.outcome === 'completed').map(row => row.index));
    return {taskId:scoped.id, title:scoped.title, date:scoped.date, zone:scoped.block, robot:scoped.robot, status:scoped.status,
      count:scoped.count, done:scoped.done, completedReceipts:completed.size,
      cancelledReceipts:new Set(receipts.filter(row => row.outcome === 'cancelled').map(row => row.index)).size,
      skippedTrees:skipped.length, remainingCount:Math.max(0, scoped.count - scoped.done - skipped.length),
      remainingTreeIds:scoped.treeIndices.filter(index => !completed.has(index) && !skipped.includes(index)).map(treeId),
      lastEvent:null, strategy:null, sourceRefs:receipts.map(row => row.sourceRef).filter(Boolean)};
  }
  const evidence = taskEvidence(task);
  const completed = new Set([...evidence.receipts.filter(row=>row.outcome==='completed').map(row=>row.index),
    ...evidence.demoReceipts.filter(row=>row.outcome==='completed').map(row=>row.treeIndex)]);
  const skipped = new Set(task.dispatch?.skipped ?? []);
  const sourceRefs = [...evidence.demoReceipts.map(row=>row.receiptId),...evidence.receipts.map(row=>row.id)];
  return {taskId:task.id,title:task.title,date:task.date,zone:task.block,robot:task.robot,status:task.status,
    count:task.count,done:task.done,completedReceipts:completed.size,
    cancelledReceipts:evidence.cancelledReceipts+evidence.demoCancelledReceipts,
    skippedTrees:skipped.size,remainingCount:Math.max(0,task.count-task.done-skipped.size),
    remainingTreeIds:(task.treeIndices ?? []).filter(index=>!completed.has(index)&&!skipped.has(index)).map(treeId),
    lastEvent:task.dispatch?.history?.at(-1)?.label ?? null,
    strategy:task.demoStrategy ? {strategyId:task.demoStrategy.strategyId,summary:task.demoStrategy.summary,adoptedAt:task.demoStrategy.adoptedAt} : null,
    sourceRefs:sourceRefs.filter(Boolean)};
}

export function scopeOperationalEvent(event, identity) {
  if (identity && (!event.siteId || !identity.seesSite(event.siteId))) return null;
  if (!identity?.plot) return event;
  if (event.siteId !== identity.plot.siteId || event.zone !== null && 'ABCD'[event.zone] !== identity.plot.zone) return null;
  return {id:event.id, siteId:event.siteId, kind:event.kind, zone:event.zone, status:event.status,
    createdAt:event.createdAt, resolvedAt:event.resolvedAt, closedAt:event.closedAt,
    note:event.kind === 'rain' ? '降雨影响本地块作业。' : '设备异常影响本地块作业。'};
}

export function scopeWeatherConstraint(item, identity) {
  if (identity && (!item.siteId || !identity.seesSite(item.siteId))) return null;
  if (!identity?.plot) return item;
  const treeIds = (item.treeIds ?? []).filter(id => identity.plot.treeIds.includes(id));
  if (item.siteId !== identity.plot.siteId || !treeIds.length) return null;
  return {requestId:item.requestId, kind:item.kind, siteId:item.siteId, treeIds,
    start:item.start, end:item.end, expiresAt:item.expiresAt,
    validity:{valid:Boolean(item.validity?.valid), status:item.validity?.status},
    note:'仅展示本人承包树的作业窗口；恢复前需核验当前策略。'};
}
