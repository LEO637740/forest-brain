import {useState, type FormEvent} from 'react';
import type {OperationalEvent} from './operationalEvents';
import type {Site} from './model';
import {collectionPointSamples} from './collectionPointData';
import {batchActionIssue, batchActionLabels, batchHoldReason, batchStageLabels, type BatchAction, type BatchActionInput, type BatchStage, type LatexBatch} from '../../../shared/logistics';

export type BatchActionHandler = (id: string, action: BatchAction, input: BatchActionInput) => Promise<void>;

const nextActions: Partial<Record<BatchStage, BatchAction>> = {collected: 'weigh', weighed: 'inspect', 'quality-held': 'inspect', ready: 'plan', planned: 'dispatch', 'in-transit': 'receive', received: 'start-processing', processing: 'process'};
const steps = ['收胶', '称重', '质检', '运输', '工厂签收', '加工', '入库'];
const stageStep: Record<BatchStage, number> = {collected: 1, weighed: 2, 'quality-held': 2, ready: 3, planned: 3, 'in-transit': 4, received: 5, processing: 5, processed: 7, cancelled: -1};
const kg = (value: number) => Math.round(value * 1000) / 1000;
export function batchTime(value: string) {return new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});}
export function downloadLatexBatch(batch: LatexBatch) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(batch, null, 2)], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `收胶批次_${batch.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LatexBatchDetail({batch, events, onAction, readOnly=false}: {batch: LatexBatch; events: OperationalEvent[]; onAction: BatchActionHandler; readOnly?:boolean}) {
  const [administrativeAction, setAdministrativeAction] = useState<BatchAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ended = batch.stage === 'processed' || batch.stage === 'cancelled';
  const currentAction = ended || readOnly ? undefined : administrativeAction && !batchActionIssue(batch, administrativeAction, events) ? administrativeAction : nextActions[batch.stage];
  const issue = currentAction ? batchActionIssue(batch, currentAction, events) : null;
  const hold = batchHoldReason(batch, events);
  const site = batch.siteId.slice(5) as Site;
  const destinations = collectionPointSamples[site].filter(point => point.kind === '加工厂');
  const lastInspection = batch.inspections.at(-1);
  const theoreticalDryKg = kg((batch.transport?.receipt?.receivedKg ?? 0) * (lastInspection?.dryRubberPercent ?? 0) / 100);
  const currentStep = batch.stage === 'quality-held' && batch.transport?.receipt ? 5 : stageStep[batch.stage];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentAction) return;
    const form = event.currentTarget, data = new FormData(form);
    const field = (name: string) => String(data.get(name)).trim();
    const input: BatchActionInput = {revision: batch.revision, operator: field('operator'), note: field('note')};
    if (currentAction === 'weigh') Object.assign(input, {grossKg: Number(field('grossKg')), tareKg: Number(field('tareKg'))});
    if (currentAction === 'inspect') {
      Object.assign(input, {sampleId: field('sampleId'), dryRubberPercent: Number(field('dryRubberPercent')), decision: field('decision')});
      if (data.get('grade')) input.grade = field('grade') as 'A' | 'B';
    }
    if (currentAction === 'plan') Object.assign(input, {destinationId: field('destinationId'), vehicleCode: field('vehicleCode'), driver: field('driver'), plannedDepartureAt: new Date(`${field('plannedDepartureAt')}:00+08:00`).toISOString()});
    if (currentAction === 'receive') input.receivedKg = Number(field('receivedKg'));
    if (currentAction === 'process') input.processLossKg = Number(data.get('processLossKg') ?? 0);
    setError(''); setBusy(true);
    try {await onAction(batch.id, currentAction, input); form.reset(); setAdministrativeAction(null);}
    catch (failure) {setError((failure as Error).message);}
    finally {setBusy(false);}
  }

  return <article className="op-batch-detail" aria-label="收胶批次详情">
    <header><div><h3>{batch.source.taskTitle}</h3></div><span>{batchStageLabels[batch.stage]}</span></header>
    <ol className="op-batch-steps" aria-label="收胶储运步骤">{steps.map((step, index) => <li key={step} className={index < currentStep ? 'complete' : index === currentStep ? 'current' : ''} aria-current={index === currentStep ? 'step' : undefined}>{index + 1} {step}</li>)}</ol>
    {batch.processing&&<section className="op-batch-processed" aria-label="加工入库结果">
      <h4>本批加工入库完成</h4><strong>{batch.processing.dryKg} 公斤干胶已入库</strong>
      <p>已增加本园区可售干胶库存。</p>
      <p>{batch.processing.latexKg} kg 鲜胶乳 × {batch.processing.dryRubberPercent}% − {batch.processing.processLossKg ?? 0} kg 加工损耗 = {batch.processing.dryKg} kg 干胶。{batch.processing.grade && ` 演示品级 ${batch.processing.grade}。`}</p>
      <button type="button" className="op-batch-primary" onClick={()=>window.dispatchEvent(new CustomEvent('harness-open-market',{detail:{site}}))}>查看经营方案与最新库存</button>
    </section>}
    <dl className="op-batch-summary">
      <div><dt>收胶登记</dt><dd>{batch.collection.point.name}<small>{batch.collection.containerCount} 桶 / 容器 · 关联已完成 {batch.source.completedTrees} 株</small></dd></div>
      <div><dt>鲜胶乳重量</dt><dd>{batch.weighing ? `${batch.weighing.netKg} kg 净重` : '等待称重登记'}{batch.weighing && <small>毛重 {batch.weighing.grossKg} kg − 皮重 {batch.weighing.tareKg} kg</small>}</dd></div>
      <div><dt>最近一次质检</dt><dd>{lastInspection ? `${batch.stage === 'quality-held' ? '冻结待复检' : lastInspection.decision === 'pass' ? '通过' : '暂扣'} · 干胶含量 ${lastInspection.dryRubberPercent}%${lastInspection.grade ? ` · 演示品级 ${lastInspection.grade}` : ''}` : '等待称重后取样'}{lastInspection && <small>样品 {lastInspection.sampleId} · 共 {batch.inspections.length} 次检测</small>}</dd></div>
      <div><dt>运输与签收</dt><dd>{batch.transport ? batch.transport.destination.name : '待质检通过后安排'}{batch.transport && <><small>{batch.transport.vehicleCode} · 驾驶员 {batch.transport.driver}</small></>}{batch.transport?.receipt && <small>签收 {batch.transport.receipt.receivedKg} kg · 较发运净重 {batch.transport.receipt.differenceKg > 0 ? '+' : ''}{batch.transport.receipt.differenceKg} kg</small>}</dd></div>
    </dl>
    {batch.transport?.receipt && <p className="op-batch-quantity-note">{batch.transport.receipt.differenceKg <= 0
      ? `运输重量差额：${kg(-batch.transport.receipt.differenceKg)} kg 鲜胶乳（发运净重 − 到厂实收）。`
      : `到厂实收比发运多 ${batch.transport.receipt.differenceKg} kg 鲜胶乳，按签收单保留差异。`} 加工按到厂实收量折干，差额不再重复扣除。</p>}
    {batch.stage === 'processing' && <section className="op-batch-processing-note" aria-label="加工进度"><h4>本批正在模拟加工</h4><p>理论干胶 {theoreticalDryKg} kg；完成后登记加工损耗和入库，当前库存尚未增加。</p>{batch.processingStarted && <p>{batchTime(batch.processingStarted.at)} · {batch.processingStarted.operator}</p>}</section>}
    {batch.source.demoStrategy && <details className="op-batch-records"><summary>来源模拟方案与回传 · {batch.source.demoReceipts?.length ?? 0} 份完成回执</summary><h4>{batch.source.demoStrategy.title} · v{batch.source.demoStrategy.revision}</h4><p>{batch.source.demoStrategy.summary}</p><p>方案 {batch.source.demoStrategy.strategyId} · 收胶关联 {batch.source.completedTrees} 棵已完成树；逐树回传随批次 JSON 保存。</p></details>}
    {hold && <div className="op-batch-hold" role="status">{hold}{!readOnly && batch.manualHold && !ended && batch.stage !== 'received' && administrativeAction !== 'resume' && <button type="button" disabled={busy} onClick={() => {setError(''); setAdministrativeAction('resume');}}>恢复手工暂停</button>}</div>}
    {currentAction && <form key={`${batch.id}:${batch.revision}:${currentAction}`} className="op-batch-form" aria-label={currentAction === 'inspect' && batch.stage === 'quality-held' ? '追加质检复检' : batchActionLabels[currentAction]} onSubmit={event => void submit(event)}>
      <h4>{currentAction === 'process' ? '登记加工结果并入库' : currentAction === 'inspect' && batch.stage === 'quality-held' ? '追加复检记录' : batchActionLabels[currentAction]}</h4>
      {issue && <p className="op-batch-action-issue">{issue}</p>}
      <fieldset disabled={busy || Boolean(issue)}>
        {currentAction === 'weigh' && <><div className="op-batch-form-grid"><label>毛重（kg 鲜胶乳）<input name="grossKg" aria-label="毛重（kg 鲜胶乳）" type="number" min="0.001" step="0.001" required/></label><label>皮重（kg）<input name="tareKg" aria-label="皮重（kg）" type="number" min="0" step="0.001" required/></label></div><p>净重 = 毛重 − 皮重。</p></>}
        {currentAction === 'inspect' && <><div className="op-batch-form-grid"><label>样品编号<input name="sampleId" aria-label="样品编号" maxLength={100} required/></label><label>干胶含量（%）<input name="dryRubberPercent" aria-label="干胶含量（%）" type="number" min="0.001" max="100" step="0.001" required/></label></div><div className="op-batch-form-grid"><label>质检结论<select name="decision" aria-label="质检结论" required defaultValue=""><option value="" disabled>选择结论</option><option value="pass">通过</option><option value="hold">暂扣，等待复检</option></select></label><label>演示品级<select name="grade" aria-label="演示品级" defaultValue=""><option value="">暂不分级</option><option value="A">A 级（演示）</option><option value="B">B 级（演示）</option></select></label></div><p>A/B 仅用于演示批次分级；复检保留此前记录，通过后继续原步骤。</p></>}
        {currentAction === 'plan' && <><label>示例运输目的地<select name="destinationId" aria-label="示例运输目的地" required defaultValue=""><option value="" disabled>选择本园区示例加工厂</option>{destinations.map(point => <option value={point.id} key={point.id}>{point.name}</option>)}</select></label><div className="op-batch-form-grid"><label>模拟车辆编号<input name="vehicleCode" aria-label="模拟车辆编号" maxLength={100} required/></label><label>驾驶员（模拟）<input name="driver" aria-label="驾驶员（模拟）" maxLength={100} required/></label></div><label>计划发车时间（北京时间）<input type="datetime-local" name="plannedDepartureAt" aria-label="计划发车时间（北京时间）" required/></label><p>保存运输安排后，再确认发车。</p></>}
        {currentAction === 'dispatch' && <p>确认按上方车辆与目的地发车。</p>}
        {currentAction === 'receive' && <><label>签收重量（kg 鲜胶乳）<input type="number" name="receivedKg" aria-label="签收重量（kg 鲜胶乳）" min="0" step="0.001" required/></label><p>填写实际签收量；未收到货可填 0，并说明原因。</p></>}
        {['start-processing', 'process'].includes(currentAction) && <div className="op-batch-processing-note"><p>工厂实收 <strong>{batch.transport?.receipt?.receivedKg} 公斤鲜胶乳</strong>，质检干胶含量 <strong>{lastInspection?.dryRubberPercent}%</strong>，理论干胶 <strong>{theoreticalDryKg} kg</strong>。</p>{currentAction === 'start-processing' ? <p>开始加工后记录进度，完成并登记入库时增加可售库存。</p> : <><label>加工损耗（kg 干胶）<input type="number" name="processLossKg" aria-label="加工损耗（kg 干胶）" min="0" max={theoreticalDryKg} step="0.001" defaultValue="0" required/></label><p>入库干胶 = 到厂实收鲜胶乳 × 干胶含量 − 加工损耗。默认损耗为 0，不影响已有折干口径。</p></>}</div>}
        {currentAction === 'hold' && <p>冻结本批后暂停后续流转，追加复检通过后回到当前步骤。请在办理说明中填写冻结原因。</p>}
        {currentAction === 'pause' && <p>暂停后可恢复，已登记单据保留。</p>}
        {currentAction === 'resume' && <p>解除手工暂停；当前雨情对发车的限制继续生效。</p>}
        {currentAction === 'cancel' && <p>取消本批流程，保留已登记单据。</p>}
        <div className="op-batch-form-grid"><label>经办人（模拟）<input name="operator" aria-label="经办人（模拟）" maxLength={100} defaultValue={['start-processing', 'process'].includes(currentAction) ? '模拟加工员' : undefined} required/></label><label>办理说明<textarea name="note" aria-label="办理说明" rows={2} maxLength={1000} defaultValue={currentAction === 'process' ? '按工厂实收、合格质检干胶含量及登记损耗模拟加工入库。' : currentAction === 'start-processing' ? '已核对本批签收与质检记录，开始模拟加工。' : undefined} required/></label></div>
        <div className="op-batch-actions"><button className="op-batch-primary" type="submit">{busy ? '正在保存…' : currentAction === 'process' ? '模拟加工入库' : currentAction === 'start-processing' ? '开始模拟加工' : currentAction === 'inspect' && batch.stage === 'quality-held' ? '保存复检记录' : currentAction === 'dispatch' ? '确认发车' : `确认${batchActionLabels[currentAction]}`}</button>{administrativeAction && <button type="button" onClick={() => setAdministrativeAction(null)}>返回当前步骤</button>}</div>
      </fieldset>
    </form>}
    {error && <p className="op-batch-error" role="alert">{error}</p>}
    <details className="op-batch-records op-batch-management"><summary>更多操作与导出</summary><div className="op-batch-actions">{!readOnly && !ended && <>{!batchActionIssue(batch,'hold',events) && <button type="button" disabled={busy} onClick={() => {setError(''); setAdministrativeAction('hold');}}>质检冻结</button>}{!batchActionIssue(batch,'pause',events) && <button type="button" disabled={busy} onClick={() => {setError(''); setAdministrativeAction('pause');}}>暂停流程</button>}{!batchActionIssue(batch,'cancel',events) && <button type="button" disabled={busy} onClick={() => {setError(''); setAdministrativeAction('cancel');}}>取消流程</button>}</>}<button type="button" onClick={() => downloadLatexBatch(batch)}>导出批次 JSON</button></div></details>
    {batch.inspections.length > 0 && <details className="op-batch-records"><summary>质检与复检记录 · {batch.inspections.length} 次</summary><ol>{batch.inspections.map(record => <li key={record.id}><strong>{record.sampleId} · {record.decision === 'pass' ? '通过' : '暂扣'} · 干胶含量 {record.dryRubberPercent}%{record.grade && ` · 演示品级 ${record.grade}`}</strong><small>{batchTime(record.at)} · {record.operator}（模拟）</small><p>{record.note}</p></li>)}</ol></details>}
    <details className="op-batch-records"><summary>全部办理记录 · {batch.history.length} 条</summary><p>批次 {batch.id} · 版本 {batch.revision}</p><p>来源任务 {batch.source.taskId} · 登记时版本 {batch.source.taskRevision}</p><p>收胶时间 {batchTime(batch.collection.at)}（北京时间）</p>{batch.transport && <p>计划发车 {batchTime(batch.transport.plannedDepartureAt)} · {batch.transport.plannedKg} kg{batch.transport.departure && <> · 实际发车 {batchTime(batch.transport.departure.at)}</>}</p>}{batch.processing&&<p>工厂实收 {batch.processing.latexKg} 公斤鲜胶乳 × 干胶含量 {batch.processing.dryRubberPercent}% · {batchTime(batch.processing.at)}（北京时间）<br/>加工记录 {batch.processing.id} · 质检记录 {batch.processing.inspectionId} · {batch.processing.operator}（模拟）<br/>{batch.processing.note}</p>}<ol>{batch.history.map(record => <li key={record.id}><strong>{batchActionLabels[record.action]}</strong><small>{batchTime(record.at)}（北京时间） · {record.operator}（模拟）</small><p>{record.note}</p><small>记录 {record.id}</small></li>)}</ol></details>
  </article>;
}
