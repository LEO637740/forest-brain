import type { Task } from './model';
import { sites, treeAlias } from './model.ts';
import type { FleetSnapshot } from '../zoneFleet';
import { logisticsDependency, taskEvidence, taskHoldReason } from './taskLifecycleModel.ts';
import type { TaskEvidence } from './taskLifecycleModel';
import {demoTaskAngleRange} from '../../../shared/demoTaskChain.ts';
import {eventMatchesTask, eventKindLabels, eventScopeLabel, eventStatusLabels, type OperationalEvent} from './operationalEvents.ts';
import treeMapping from '../integration/tree-map.json' with { type: 'json' };
import {batchAssessment, batchActionLabels, batchStageLabels, type BusinessRecord, type LatexBatch} from '../../../shared/logistics.ts';

export const taskSnapshotNotice = '浏览器当前记录快照，导出时未再次核对服务器；任务版本号不代表已同步。';
export type TaskEvidenceSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  timeZone: 'Asia/Shanghai';
  recordScope: typeof taskSnapshotNotice;
  task: Task;
  operationalEvents: OperationalEvent[];
  logisticsBatch: LatexBatch | null;
  assessment: {
    evidence: TaskEvidence;
    currentHoldReason: string | null;
    downstream: { state: string; label: string; reason: string } | null;
  };
};

/** A click-time copy of one task. No workspace state, requests or mutations. */
export function createTaskEvidenceSnapshot(task: Task, fleet?: FleetSnapshot, now = Date.now(), events: readonly OperationalEvent[] = [], batches: readonly LatexBatch[] = []): TaskEvidenceSnapshot {
  const generatedAt = new Date(now).toISOString();
  const copy = structuredClone(task);
  // The current simulator fleet belongs to Hainan; another site's same-number
  // tree must not inherit its live pause/weather state.
  const relevantFleet = copy.site === 'hainan' ? fleet : undefined;
  const relevantEvents = structuredClone(events.filter(event => eventMatchesTask(copy, event)));
  const batch = batches.find(item => item.siteId === `demo-${copy.site}` && item.source.taskId === copy.id);
  const logisticsBatch = batch ? structuredClone(batch) : null;
  const dependency = logisticsBatch ? batchAssessment(logisticsBatch, relevantEvents) : copy.kind === '割胶' ? logisticsDependency(copy, relevantFleet, now, relevantEvents) : null;
  return {
    schemaVersion: 1, generatedAt, timeZone: 'Asia/Shanghai', recordScope: taskSnapshotNotice,
    task: copy,
    operationalEvents: relevantEvents, logisticsBatch,
    assessment: {
      evidence: taskEvidence(copy), currentHoldReason: taskHoldReason(copy, relevantFleet, now, relevantEvents),
      downstream: dependency ? { state: dependency.state, label: dependency.label, reason: dependency.reason } : null,
    },
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function time(value?: string): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）'
    : '未记录有效时间';
}

function fields(rows: [string, unknown][]): string {
  return '<dl>' + rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? '未记录')}</dd></div>`).join('') + '</dl>';
}

function recordedTree(index: number, site: Task['site']): string {
  if (!Number.isInteger(index) || index < 0) return `无效树位 ${index}`;
  const mapped = site === 'hainan' ? treeMapping.find(item => item.sceneIndex === index)?.treeId : undefined;
  return mapped ?? `树位索引 ${index}（树号映射未记录）`;
}

const completionLabels = { rail: '逐树模拟执行回执', flow: '模拟流程记录（非逐树设备回执）', surface: '现场处理填写记录（非逐树设备回执）' };


function businessFields(record: BusinessRecord): string {
  return fields([['单据编号', record.id], ['办理时间', time(record.at)], ['经办人（模拟）', record.operator], ['办理说明', record.note]]);
}

function renderLogisticsBatch(batch: LatexBatch, site: Task['site']): string {
  const weighing = batch.weighing ? fields([['毛重（kg 鲜胶乳）', batch.weighing.grossKg], ['皮重（kg）', batch.weighing.tareKg], ['净重（kg 鲜胶乳）', batch.weighing.netKg]]) + businessFields(batch.weighing) : '<p class="muted">尚未登记称重。</p>';
  const inspections = batch.inspections.length ? batch.inspections.map((record, index) => `<article class="record"><h3>第 ${index + 1} 次${index ? '复检' : '质检'}</h3>${fields([['样品编号', record.sampleId], ['干胶含量（%）', record.dryRubberPercent], ['人工判定', record.decision === 'pass' ? '通过' : '暂扣']])}${businessFields(record)}</article>`).join('') : '<p class="muted">尚未登记质检。</p>';
  const transport = batch.transport ? fields([['示例目的地', `${batch.transport.destination.name} / ${batch.transport.destination.id}`], ['模拟车辆编号', batch.transport.vehicleCode], ['驾驶员（模拟）', batch.transport.driver], ['计划发车时间', time(batch.transport.plannedDepartureAt)], ['计划发运重量（kg 鲜胶乳）', batch.transport.plannedKg]]) + businessFields(batch.transport)
    + '<h3>发车记录</h3>' + (batch.transport.departure ? businessFields(batch.transport.departure) : '<p class="muted">尚未确认发车。</p>')
    + '<h3>签收记录</h3>' + (batch.transport.receipt ? fields([['签收重量（kg 鲜胶乳）', batch.transport.receipt.receivedKg], ['签收量减发运净重（kg）', batch.transport.receipt.differenceKg]]) + businessFields(batch.transport.receipt) : '<p class="muted">尚未登记签收。</p>') : '<p class="muted">尚未安排运输。</p>';
  return `<section><h2>7. 模拟收胶与运输单据</h2>${fields([['批次编号', batch.id], ['批次版本', batch.revision], ['批次状态', batchStageLabels[batch.stage]], ['来源任务 / 登记时版本', `${batch.source.taskId} / ${batch.source.taskRevision}`], ['登记的完成对象', batch.source.treeIndices.map(index => recordedTree(index, site)).join('、')]])}<p class="muted">本批次保留登记时的完成依据。完成株数不折算公斤；以下重量与办理说明来自人工模拟登记。</p><h3>收胶登记</h3>${fields([['示例收胶点', `${batch.collection.point.name} / ${batch.collection.point.id}`], ['桶 / 容器数量', batch.collection.containerCount], ['关联完成株数', batch.source.completedTrees]])}${businessFields(batch.collection)}<h3>称重记录</h3>${weighing}<h3>质检与复检记录</h3>${inspections}<h3>模拟运输单</h3>${transport}${batch.manualHold ? '<h3>当前手工暂停</h3>' + businessFields(batch.manualHold) : ''}<h3>全部批次办理记录</h3>${batch.history.map(record => `<article class="record"><strong>${escapeHtml(batchActionLabels[record.action])}</strong>${businessFields(record)}${fields([['操作请求编号', record.requestId]])}</article>`).join('')}</section>`;
}

export function renderTaskEvidenceHtml(snapshot: TaskEvidenceSnapshot): string {
  const { task, assessment: { evidence, currentHoldReason, downstream } } = snapshot;
  const siteName = sites[task.site] ?? task.site;
  const tree = (index: number) => recordedTree(index, task.site);
  const targets = task.treeIndices?.length ? task.treeIndices.map(tree).join('、') : '未保存明确树木清单；不按地块或数量推导下发对象';
  const demoSource = evidence.demoStrategy ? `<article class="record"><h3>${escapeHtml(evidence.demoStrategy.title)}</h3><p>${escapeHtml(evidence.demoStrategy.summary)}</p>${fields([
    ['模拟策略编号 / 版本', `${evidence.demoStrategy.strategyId} / v${evidence.demoStrategy.revision}`],
    ['策略生成时间', time(evidence.demoStrategy.generatedAt)], ['采用时间', evidence.demoStrategy.adoptedAt ? time(evidence.demoStrategy.adoptedAt) : '待采用'],
    ['采用人', evidence.demoStrategy.adoptedBy ?? '待采用'],
    ['割胶参数', `${demoTaskAngleRange(evidence.demoStrategy)}° / 深度 ${evidence.demoStrategy.parameters.cutDepthMm} mm / 速度 ${evidence.demoStrategy.parameters.speedMmPerSec} mm/s`],
    ...(evidence.demoStrategy.adoptedAngles?.length ? [['已采用单树角度', evidence.demoStrategy.adoptedAngles.map(item=>`${tree(item.treeIndex)}：${item.angleDeg}°，${item.strategyId} v${item.revision}，采用于 ${time(item.adoptedAt)}`).join('；')] as [string,string]] : []),
    ['树表处理', evidence.demoStrategy.surfaceAction], ['生成依据', evidence.demoStrategy.basis.join('；')],
  ])}</article>` : '';
  const sources = demoSource + (evidence.sources.length ? evidence.sources.map(source => `<article class="record">${fields([
    ['园区 / 树号', `${sites[(source.siteId ?? 'hainan').replace(/^demo-/, '') as Task['site']] ?? source.siteId} / ${source.treeId}`],
    ['策略编号', source.strategyId], ['分析批次 / 版本', `${source.runId} / ${source.revision}`],
    ['采用角度', `${source.angle}°`], ['采用时间', time(source.adoptedAt)], ['策略有效期至', time(source.expiresAt)],
    ['数据模式', source.dataMode === 'mixed_demo' ? '公开数据 + 模拟现场数据' : source.dataMode === 'demo' ? '模拟数据' : '未记录'],
  ])}</article>`).join('') : demoSource ? '' : '<p class="muted">未关联可核对的策略采用记录，不能据此判断已审核。</p>');
  const demoReceiptRows = evidence.demoReceipts.map(result => `<tr><td>${escapeHtml(treeAlias(result.treeIndex, task.site))}<small>${escapeHtml(result.receiptId)}</small></td><td>${{completed:'模拟完成', skipped:'模拟跳过', cancelled:'模拟取消'}[result.outcome]}<small>${escapeHtml(result.note)}</small></td><td>${escapeHtml(result.strategyId)} · v${result.strategyRevision}<small>${result.angleDeg}°</small></td><td>${escapeHtml(time(result.finishedAt))}</td></tr>`).join('');
  const receipts = evidence.receipts.length || evidence.demoReceipts.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">树号 / 执行编号</th><th scope="col">回执结果</th><th scope="col">执行方案</th><th scope="col">完成回传时间</th></tr></thead><tbody>${demoReceiptRows}${evidence.receipts.map(result => `<tr><td>${escapeHtml(tree(result.index))}<small>${escapeHtml(result.job?.id)}</small></td><td>${result.outcome === 'completed' ? '模拟完成' : '模拟取消'}${result.outcome === 'cancelled' ? '<small>历史取消原因：未记录</small>' : ''}</td><td>${escapeHtml(result.job?.planVersion)}<small>${escapeHtml(result.job?.angle)}°</small></td><td>${escapeHtml(time(result.finishedAt))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无通过关联核对的逐树回执。原始回执仍保留在文末数据中。</p>';
  const issues = evidence.issues.length ? `<ul class="issues">${evidence.issues.map(issue => `<li>${escapeHtml(issue.message)}<small>${escapeHtml(issue.code)}${issue.index === undefined ? '' : ` · ${escapeHtml(tree(issue.index))}`}</small></li>`).join('')}</ul>` : '<p>当前记录未发现关联矛盾；这不代表已完成现场验收。</p>';
  const history = task.dispatch?.history.length ? `<ol>${task.dispatch.history.map(entry => `<li>${escapeHtml(time(entry.time))} · ${escapeHtml(entry.label)}</li>`).join('')}</ol>` : '<p class="muted">未保存模拟流程历史。</p>';
  const surface = task.receipt ? fields([['填写结果', task.receipt.outcome], ['填写说明', task.receipt.note], ['填写时间', time(task.receipt.time)]]) : '<p class="muted">未保存现场处理填写记录。</p>';
  const sourceLinks = fields([['市场情景编号', task.sourceScenarioId], ['工作台确认编号', task.decisionKey]]);
  const eventHistory = snapshot.operationalEvents.length ? snapshot.operationalEvents.map(event => `<article class="record">${fields([
    ['事件 / 范围', `${eventKindLabels[event.kind]} / ${eventScopeLabel(event)}`], ['状态', eventStatusLabels[event.status]],
    ['事件编号', event.id], ['确认时间', time(event.createdAt)], ['影响说明', event.note],
    ['解除时间', event.resolvedAt ? time(event.resolvedAt) : '尚未解除'], ['解除依据', event.resolutionNote],
    ['恢复确认时间', event.closedAt ? time(event.closedAt) : '尚未确认恢复'], ['恢复核对说明', event.resumeNote],
  ])}</article>`).join('') : '<p class="muted">当前快照没有本任务范围内的天气或设备事件。</p>';
  const raw = escapeHtml(JSON.stringify(snapshot, null, 2));
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(task.title)} · 单任务核对单</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f2f5f1;color:#20362d;font:15px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:960px;margin:32px auto;padding:36px;background:white;border:1px solid #dce5dd}header{padding-bottom:22px;border-bottom:2px solid #285e48}h1{font-size:28px;line-height:1.4;margin:8px 0}h2{font-size:19px;margin:0 0 14px}h3{font-size:16px;margin:18px 0 6px}p{margin:8px 0}section{padding:24px 0;border-bottom:1px solid #dce5dd}small{display:block;font-size:12px;color:#607369;overflow-wrap:anywhere}.eyebrow{color:#426a54;font-size:12px;letter-spacing:.08em}.notice{background:#f8f3e8;border-left:4px solid #b48934;padding:13px 17px;margin-top:20px}.muted{color:#607369}dl{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 24px}dl>div{min-width:0}dt{font-size:12px;color:#607369}dd{margin:2px 0 0;overflow-wrap:anywhere}.record{border:1px solid #dce5dd;padding:16px;margin:12px 0;background:#f7faf7}.metrics{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.metrics span{padding:7px 12px;background:#eff5ef;border:1px solid #dce5dd}.issues{background:#fff7e9;padding:15px 20px 15px 36px}.issues li{padding:5px 0}li{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}th,td{vertical-align:top;text-align:left;border-bottom:1px solid #dce5dd;padding:10px;overflow-wrap:anywhere}th{background:#eff5ef}details{margin-top:18px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 ui-monospace,monospace;background:#f4f6f3;padding:16px}footer{font-size:12px;color:#607369;padding-top:22px}h1,header p{overflow-wrap:anywhere}@media(max-width:620px){main{margin:0;padding:22px 16px;border:0}h1{font-size:23px}dl{grid-template-columns:1fr}th,td{padding:7px 4px;font-size:12px}}@media print{@page{size:A4;margin:14mm}body{background:white;font-size:11px}main{margin:0;padding:0;border:0;max-width:none}h1{font-size:23px}section{padding:16px 0}h2{break-after:avoid}.record,dl>div,tr{break-inside:avoid}details{display:none}.notice{print-color-adjust:exact}}
</style></head><body><main>
<header><div class="eyebrow">胶林项目 · 远程核对 · 模拟记录</div><h1>单任务核对单</h1><p>${escapeHtml(task.title)}</p><small>导出时间：${escapeHtml(time(snapshot.generatedAt))} · 格式版本 ${snapshot.schemaVersion}</small><div class="notice">${escapeHtml(snapshot.recordScope)}<br>本单用于远程复核，不等同于真实设备回执、正式审批或产胶量证明。</div></header>
<section><h2>1. 任务与范围</h2>${fields([
    ['任务编号', task.id], ['园区 / 地块', `${siteName} / ${task.block}`], ['任务版本', task.revision ?? '未记录'], ['类型 / 状态', `${task.kind} / ${task.status}`],
    ['设备或执行人（记录值）', task.robot], ['计划时段（北京时间）', `${task.date ?? '日期未记录'} ${task.start}–${task.end}`], ['记录进度', `${task.done} / ${task.count} 株`], ['记录跳过', `${task.dispatch?.skipped?.length ?? 0} 株`], ['明确保存的树号', targets],
  ])}</section>
<section><h2>2. 完成证据与待核对项</h2><p><strong>${evidence.hasCompletionRecord ? `已有可核对的${evidence.demoStrategy ? '逐树模拟流程回执' : completionLabels[evidence.completionKind!] ?? '完成记录'}` : '尚不足以确认完整完成记录'}</strong></p><div class="metrics"><span>原始回执 ${evidence.rawReceipts.length + (task.demoReceipts?.length ?? 0)}</span><span>匹配完成 ${evidence.completedReceipts + evidence.demoCompletedReceipts}</span><span>匹配取消 ${evidence.cancelledReceipts + evidence.demoCancelledReceipts}</span>${evidence.demoStrategy ? `<span>模拟跳过 ${evidence.demoSkippedReceipts}</span>` : ''}</div>${issues}<p class="muted">回执核对包含任务范围、执行编号、树号、园区、方案版本、角度和策略来源；不按导出时的策略过期情况否定历史完成记录。</p></section>
<section><h2>3. 策略来源与采用记录</h2>${sources}${sourceLinks}<p class="muted">市场情景与工作台确认不等同于模型策略审批；采用记录不代表已接通真实设备。</p></section>
<section><h2>4. 通过关联核对的逐树回执</h2>${receipts}</section>
<section><h2>5. 其他执行记录</h2><h3>模拟流程历史</h3>${history}<h3>现场处理填写记录</h3>${surface}</section>
<section><h2>6. 导出时状态与后续条件</h2>${fields([['当前暂缓原因', currentHoldReason ?? '当前记录未显示暂缓原因'], [snapshot.logisticsBatch ? '模拟批次业务状态' : '储运依赖预览', downstream ? `${downstream.label}：${downstream.reason}` : '此任务不属于割胶任务，无储运依赖预览']])}<p class="muted">当前暂缓原因是导出时状态，不能用来推定历史取消原因。未记录实际收胶量、称重和运输确认时，不按完成树数推算产量，也不自动派车。</p><h3>天气与设备事件记录</h3>${eventHistory}<p class="muted">人工确认的模拟事件；解除后仍需确认恢复，其他事件与手工暂停独立生效。</p></section>
${snapshot.logisticsBatch ? renderLogisticsBatch(snapshot.logisticsBatch, task.site) : ''}
<details><summary>展开完整原始快照（含未通过核对的回执）</summary><pre>${raw}</pre></details>
<footer>完整原始快照已嵌入本 HTML；也可在任务详情另行导出 JSON。打印时仅保留可阅读核对内容。时间统一为 Asia/Shanghai，本文件不加载外部资源或执行脚本。</footer>
</main></body></html>`;
}

export function taskEvidenceArtifact(snapshot: TaskEvidenceSnapshot, format: 'html' | 'json'): { filename: string; mimeType: string; content: string } {
  if (format !== 'html' && format !== 'json') throw new Error('不支持的导出格式');
  const safe = (value: string) => value.replace(/[^\p{Letter}\p{Number}_-]+/gu, '-').slice(0, 60) || 'task';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(snapshot.generatedAt));
  const part = (type: string) => date.find(item => item.type === type)!.value;
  const stamp = `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}`;
  return {
    filename: `核对单-${safe(snapshot.task.site)}-${safe(snapshot.task.id)}-${stamp}.${format}`,
    mimeType: format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8',
    content: format === 'html' ? renderTaskEvidenceHtml(snapshot) : JSON.stringify(snapshot, null, 2),
  };
}
