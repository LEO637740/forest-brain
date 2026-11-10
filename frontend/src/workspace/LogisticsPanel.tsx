import {useEffect, useState, type FormEvent} from 'react';
import {ArrowRight, Truck} from 'lucide-react';
import {treeAlias, type Site, type Task} from './model';
import type {FleetSnapshot} from '../zoneFleet';
import {logisticsDependencies} from './taskLifecycleModel';
import {operationDateLabel} from './operationsModel';
import type {OperationalEvent} from './operationalEvents';
import {collectionPointSamples} from './collectionPointData';
import {batchAssessment, batchStageLabels, collectionIssue, collectionSource, type CollectionInput, type LatexBatch} from '../../../shared/logistics';
import {LatexBatchDetail, batchTime, type BatchActionHandler} from './LatexBatchDetail';
import {can, currentAccount} from './identityModel';
import './taskLifecycle.css';
import './latexLogistics.css';

export function LogisticsPanel({site, tasks, allTasks, fleet, events, batches, openRequest, onCreateBatch, onBatchAction, onTask, onReview}: {
  site: Site; tasks: Task[]; allTasks: Task[]; fleet: FleetSnapshot; events: OperationalEvent[]; batches: LatexBatch[];
  openRequest?: {id?: string; sequence: number} | null;
  onCreateBatch: (input: CollectionInput) => Promise<void>; onBatchAction: BatchActionHandler;
  onTask: (task: Task) => void; onReview?: () => void;
}) {
  const account = currentAccount(), canManage = !account || can(account, 'logistics.write');
  const [filter, setFilter] = useState<'all' | 'blocked' | 'confirmation'>('all');
  const [collectionTaskId, setCollectionTaskId] = useState('');
  const [selection, setSelection] = useState<{batchId: string} | {taskId: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {if(openRequest?.id){setSelection({batchId:openRequest.id});setCollectionTaskId('');}},[openRequest]);
  const siteBatches = batches.filter(batch => batch.siteId === `demo-${site}`);
  const rows = logisticsDependencies(tasks, fleet, Date.now(), events).map(row => {
    const batch = siteBatches.find(item => item.source.taskId === row.task.id);
    const issue = collectionIssue(row.task, events, batches);
    const source = collectionSource(row.task);
    const partial = !batch && !issue && row.state === 'cancelled';
    const reason = partial ? `仅登记已核对完成的 ${source!.completedTrees} 株：${source!.treeIndices.map(index => treeAlias(index, row.task.site)).join('、')}。未完成及取消对象不计入收胶批次。` : row.reason;
    return {...row, ...(batch ? batchAssessment(batch, events) : partial ? {state:'awaiting-weighing',label:'完成部分待收胶',reason} : {}), batch, issue, partial};
  });
  const blocked = rows.filter(row => ['blocked', 'cancelled'].includes(row.state));
  const confirmation = rows.filter(row => row.batch ? !['blocked', 'cancelled', 'processed'].includes(row.state) : ['awaiting-receipt', 'awaiting-weighing'].includes(row.state));
  const visible = filter === 'blocked' ? blocked : filter === 'confirmation' ? confirmation : rows;
  const selectedBatch = siteBatches.find(batch => selection && ('batchId' in selection ? batch.id === selection.batchId : batch.source.taskId === selection.taskId)) ?? siteBatches[0];
  const sourceTask = selectedBatch ? allTasks.find(task => task.site === site && task.id === selectedBatch.source.taskId) : undefined;
  const collectionTask = tasks.find(task => task.id === collectionTaskId && task.site === site);
  const createIssue = collectionTask ? collectionIssue(collectionTask, events, batches) : null;
  const collectionPoints = collectionPointSamples[site].filter(point => point.kind === '收胶点');

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collectionTask) return;
    const form = event.currentTarget, data = new FormData(form);
    setError(''); setBusy(true);
    try {
      await onCreateBatch({taskId: collectionTask.id, operator: String(data.get('operator')).trim(), collectionPointId: String(data.get('collectionPointId')), containerCount: Number(data.get('containerCount')), note: String(data.get('note')).trim()});
      form.reset(); setSelection({taskId: collectionTask.id}); setCollectionTaskId('');
    } catch (failure) {setError((failure as Error).message);}
    finally {setBusy(false);}
  }

  return <section className="op-logistics" aria-label="割胶与储运联动">
    <header><div><Truck size={22}/><div><h2>收胶、储运与加工入库</h2><p>登记收胶，跟进到厂与入库。</p></div></div><span>人工模拟业务</span></header>
    {!canManage && <p>当前身份可查看收胶与加工记录；登记和流转由园区管理办理。</p>}
    <details className="op-logistics-note"><summary>流程与计量说明</summary><p>收胶 → 称重 → 质检 → 发运 → 签收 → 加工入库。重量由称重登记，不按作业株数估算；雨情暂缓新收胶和发车。</p></details>
    <nav aria-label="储运依赖筛选">{[
      ['all', '全部任务', rows.length], ['blocked', '暂缓 / 停止', blocked.length], ['confirmation', '待办理', confirmation.length],
    ].map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key as typeof filter)}>{label}<b>{count}</b></button>)}</nav>
    {visible.length > 0 ? <div className="op-logistics-table"><table><thead><tr><th>割胶任务</th><th>完成进度</th><th>储运状态</th><th>当前情况</th><th>操作</th></tr></thead><tbody>
      {visible.map(row => {
        const {batch, issue} = row;
        const state = row.state;
        return <tr key={row.task.id}>
          <td><strong>{row.task.title}</strong><small>{row.task.block}区 · {row.task.robot || '未分配设备'} · {row.task.status}</small><small>原计划：{operationDateLabel(row.task)}</small></td>
          <td><strong>{row.task.done} / {row.task.count} 株</strong><small>{row.evidence.demoReceipts.length ? `${row.evidence.demoCompletedReceipts} 份模拟完成回执` : row.evidence.receipts.length ? `${row.evidence.completedReceipts} 份完成回执` : row.evidence.hasCompletionRecord ? '模拟流程完成记录' : '尚无完成回执'}</small></td>
          <td><span className={`op-logistics-state ${state}`}>{row.label}</span></td>
          <td>{issue && !batch ? issue : row.reason}</td>
          <td><div className="op-logistics-row-actions"><button type="button" onClick={() => onTask(row.task)} aria-label={`查看上游任务 ${row.task.title}`}>查看任务<ArrowRight size={13}/></button>{batch ? <button type="button" onClick={() => {setSelection({batchId: batch.id}); setCollectionTaskId('');}}>查看批次</button> : canManage && <button type="button" disabled={Boolean(issue)} title={issue ?? undefined} onClick={() => {setCollectionTaskId(row.task.id); setError('');}} aria-label={`登记收胶 ${row.task.title}`}>登记收胶</button>}</div></td>
        </tr>;
      })}
    </tbody></table></div> : <div className="op-logistics-empty"><strong>{rows.length ? '当前筛选下没有记录' : '当前日期范围尚无割胶任务'}</strong><p>{rows.length ? '切换“全部任务”查看。' : '调整日期范围，或前往策略中心安排作业。'}</p>{!rows.length && onReview && <button type="button" onClick={onReview}>前往策略中心</button>}</div>}
    {canManage && collectionTask && <form key={collectionTask.id} className="op-collection-form" aria-label="登记收胶批次" onSubmit={event => void createBatch(event)}><h4>登记收胶 · {collectionTask.title}</h4><p>登记已完成部分，重量在下一步填写。</p>{createIssue && <p className="op-batch-action-issue">{createIssue}</p>}<fieldset disabled={busy || Boolean(createIssue)}><div className="op-batch-form-grid"><label>示例收胶点<select name="collectionPointId" aria-label="示例收胶点" defaultValue="" required><option value="" disabled>选择本园区示例收胶点</option>{collectionPoints.map(point => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label><label>桶 / 容器数量<input name="containerCount" aria-label="桶 / 容器数量" type="number" min="1" step="1" required/></label></div><div className="op-batch-form-grid"><label>经办人（模拟）<input name="operator" aria-label="经办人（模拟）" maxLength={100} required/></label><label>收胶说明<textarea name="note" aria-label="收胶说明" rows={2} maxLength={1000} required/></label></div><div className="op-batch-actions"><button type="submit" className="op-batch-primary">{busy ? '正在保存…' : '确认登记收胶'}</button><button type="button" onClick={() => setCollectionTaskId('')}>收起登记</button></div></fieldset></form>}
    {error && <p className="op-batch-error" role="alert">{error}</p>}
    <section className="op-logistics-workspace" aria-label="当前园区收胶批次"><header><div><h3>收胶批次</h3><p>当前园区全部日期的批次。</p></div><span>{siteBatches.length} 个批次 · 人工模拟</span></header>
      {siteBatches.length ? <div className="op-batch-layout"><nav className="op-batch-list" aria-label="选择收胶批次">{siteBatches.map(batch => <button key={batch.id} type="button" aria-pressed={selectedBatch?.id === batch.id} onClick={() => {setSelection({batchId: batch.id}); setCollectionTaskId('');}}><strong>{batch.source.taskTitle}</strong><span>{batchStageLabels[batch.stage]}{batch.manualHold ? ' · 手工暂停' : ''}</span><small>{batch.collection.point.name} · {batchTime(batch.collection.at)}<br/>{batch.processing ? `${batch.processing.dryKg} 公斤干胶已入库` : batch.transport?.receipt ? `${batch.transport.receipt.receivedKg} 公斤鲜胶乳已到厂` : batch.weighing ? `${batch.weighing.netKg} kg 鲜胶乳净重` : '待称重'}</small></button>)}</nav>{selectedBatch && <div>{sourceTask ? <button type="button" className="op-batch-source" onClick={() => onTask(sourceTask)}>查看批次来源任务<ArrowRight size={13}/></button> : <p className="op-batch-action-issue">来源任务当前不可用。</p>}<LatexBatchDetail readOnly={!canManage} key={selectedBatch.id} batch={selectedBatch} events={events} onAction={onBatchAction}/></div>}</div> : <div className="op-batch-empty"><strong>当前园区还没有收胶批次</strong><p>从上方已完成任务登记收胶。</p></div>}
    </section>
  </section>;
}
