import type { FleetSnapshot } from '../zoneFleet';
import { treeAlias, type Task } from './model';
import { taskEvidence, taskHoldReason } from './taskLifecycleModel';
import { phaseLabels } from './taskFlow';
import { TaskEvidenceActions } from './TaskEvidenceActions';
import {DemoTaskAngleDetails} from '../integration/DemoTaskAngleDetails';
import {DemoTaskReceipts} from '../integration/DemoTaskStrategies';
import {demoTaskAngleRange} from '../../../shared/demoTaskChain';
import type {OperationalEvent} from './operationalEvents';
import type {LatexBatch} from '../../../shared/logistics';
import './taskLifecycle.css';

function displayTime(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '时间未记录';
}

export function TaskLifecycle({ task, fleet, events = [], batches = [], onReview, onStrategy }: { task: Task; fleet: FleetSnapshot; events?: OperationalEvent[]; batches?: LatexBatch[]; onReview?: () => void; onStrategy?: (task:Task) => void }) {
  const evidence = taskEvidence(task);
  const hold = taskHoldReason(task, fleet, Date.now(), events);
  if(task.demoStrategy){
    const strategy=task.demoStrategy,receipts=task.demoReceipts??[];
    const productionSource=Boolean(task.sourceParkPlanId||task.sourceScenarioId);
    const completed=receipts.filter(receipt=>receipt.outcome==='completed').length,skipped=receipts.filter(receipt=>receipt.outcome==='skipped').length,cancelled=receipts.filter(receipt=>receipt.outcome==='cancelled').length;
    return <section className="op-lifecycle op-demo-lifecycle" aria-label="策略到执行的记录链路">
      <header><strong>任务记录</strong><span>模拟演示</span></header>
      <p className={hold ? 'op-lifecycle-hold' : 'op-lifecycle-summary'}>{hold ?? `${task.done}/${task.count} 棵完成 · ${receipts.length} 份回传`}</p>
      <details className="op-lifecycle-trace"><summary>任务方案、依据与逐树回传</summary>
      <h3>{strategy.title}</h3><p className="op-demo-summary">{strategy.summary}</p>
      {task.sourceParkPlanId&&<p>来源全园方案：{task.sourceParkPlanId} · 全园方案已采用，已生成本任务。</p>}
      {task.sourceScenarioId&&<p>来源生产情景：{task.sourceScenarioId} · 已采用并生成本任务。</p>}
      <div className="op-demo-parameters"><span>{demoTaskAngleRange(strategy)}° 割线</span><span>{strategy.parameters.cutDepthMm} mm 深度</span><span>{strategy.parameters.speedMmPerSec} mm/s</span></div>
      <DemoTaskAngleDetails task={task}/>
      <ol>
        <li><b>1</b><div><strong>策略已生成</strong><p>{task.block} 区 · {strategy.treeIndices.length} 棵 · v{strategy.revision}</p><small>{displayTime(strategy.generatedAt)}</small></div></li>
        <li className={productionSource||strategy.adoptedAt?'':'unconfirmed'}><b>2</b><div><strong>{productionSource?'来源方案已采用':strategy.adoptedAt?'策略已采用':'等待采用方案'}</strong><p>{productionSource?'任务沿用来源方案执行。':strategy.adoptedAt?`${strategy.adoptedBy} · ${displayTime(strategy.adoptedAt)}`:'进入任务演示，采用方案后开始执行。'}</p>{productionSource&&strategy.adoptedAt&&<small>执行参数绑定：{strategy.adoptedBy} · {displayTime(strategy.adoptedAt)}</small>}</div></li>
        <li className={hold?'unconfirmed':''}><b>3</b><div><strong>任务执行 · {task.dispatch?phaseLabels[task.dispatch.phase]:task.status}</strong><p>{hold??`${task.done}/${task.count} 棵完成`}</p></div></li>
        <li><b>4</b><div><strong>结果回传</strong><p>{receipts.length?`${completed} 棵完成${skipped?` · ${skipped} 棵跳过`:''}${cancelled?` · ${cancelled} 棵取消`:''}，均关联本方案 v${strategy.revision}`:'执行后逐树回传结果，并保留采用的策略版本。'}</p></div></li>
      </ol>
      <details><summary>方案依据与异常处理</summary><ul className="op-task-basis">{strategy.basis.map((basis,index)=><li key={index}>{basis}</li>)}</ul><p>树表异常：{strategy.surfaceAction}</p><p>策略编号：{strategy.strategyId} · v{strategy.revision}</p></details>
      <DemoTaskReceipts task={task}/>
      </details>
      {onStrategy&&productionSource&&<button type="button" onClick={()=>onStrategy(task)}>{task.sourceParkPlanId?'查看原全园方案 →':'查看原经营方案 →'}</button>}
      <TaskEvidenceActions key={`${task.site}:${task.id}`} task={task} fleet={fleet} events={events} batches={batches}/>
    </section>;
  }
  return <section className="op-lifecycle" aria-label="策略到执行的记录链路">
    <header><strong>任务记录</strong><span>模拟记录</span></header>
    <p className={hold ? 'op-lifecycle-hold' : 'op-lifecycle-summary'}>{hold ?? `${task.done}/${task.count} 株完成 · ${evidence.receipts.length} 份已核对回执`}</p>
    {evidence.issues.length > 0 && <section className="op-evidence-issues" aria-label="任务证据待核对问题">
      <details>
        <summary>证据待核对 · {evidence.issues.length} 项（展开明细）</summary>
        {evidence.issues.some(issue => issue.code === 'receipt_missing') && <p>缺少回执不代表执行失败，可在回传后核对。</p>}
        <ul>{evidence.issues.map((issue, index) => <li key={`${issue.code}:${issue.index ?? 'task'}:${index}`}>
          {issue.index !== undefined && <strong>{Number.isInteger(issue.index) && issue.index >= 0 && issue.index < 200 ? `${treeAlias(issue.index, task.site)} · ` : ''}索引 {issue.index}：</strong>}{issue.message}
        </li>)}</ul>
      </details>
    </section>}
    <details className="op-lifecycle-trace"><summary>查看策略、回执与来源</summary>
    <ol>
      <li><b>1</b><div><strong>策略来源</strong><p>{evidence.sources.length
        ? `关联 ${evidence.sources.length} 份已采用策略记录`
        : task.sourceParkPlanId ? '来源于已采用的全园割胶方案' : task.sourceScenarioId ? '来源于市场生产情景' : task.decisionKey ? '来源于工作台方案确认' : '尚未关联策略采用记录'}</p></div></li>
      <li className={!evidence.sources.length && !task.sourceParkPlanId ? 'unconfirmed' : ''}><b>2</b><div><strong>人工确认</strong><p>{evidence.sources.length
        ? '已记录策略采用时间'
        : task.sourceParkPlanId ? '全园方案已采用，已生成本任务'
        : '尚无策略采用记录'}</p></div></li>
      <li className={hold ? 'unconfirmed' : ''}><b>3</b><div><strong>任务执行 · {task.dispatch ? phaseLabels[task.dispatch.phase] : task.status}</strong><p>{hold ?? `${task.done}/${task.count} 株完成${task.dispatch?.skipped?.length ? `，${task.dispatch.skipped.length} 株跳过` : ''}`}</p><small>任务编号 {task.id}</small></div></li>
      <li><b>4</b><div><strong>结果回传</strong><p>{evidence.receipts.length
        ? `关联核对通过：${evidence.completedReceipts} 份完成、${evidence.cancelledReceipts} 份取消回执`
        : task.receipt ? `${task.receipt.outcome}：${task.receipt.note}`
          : evidence.completionKind === 'flow' ? '已有模拟流程完成记录，尚无真实设备回执' : '尚无可核对的执行完成回执'}</p>
        {evidence.completionKind === 'rail' && <small>完成依据：关联核对通过的模拟轨道回执，不代表实测产胶量。</small>}
        {evidence.completionKind === 'flow' && <small>完成依据：模拟流程完成记录。</small>}
        {evidence.completionKind === 'surface' && <small>完成依据：现场处理人工回传，不等同于割胶完成或实测产胶量。</small>}
      </div></li>
    </ol>
    {(evidence.sources.length > 0 || task.sourceParkPlanId || task.sourceScenarioId || task.decisionKey) && <details>
      <summary>查看来源与采用证据</summary>
      {task.sourceParkPlanId && <p>全园割胶方案：{task.sourceParkPlanId}（已采用）</p>}
      {task.sourceScenarioId && <p>市场情景：{task.sourceScenarioId}（不等同于模型策略审批）</p>}
      {task.decisionKey && <p>工作台确认记录：{task.decisionKey}</p>}
      {evidence.sources.map(source => <dl key={JSON.stringify([source.siteId ?? 'demo-hainan', source.treeId, source.strategyId, source.runId, source.revision, source.adoptedAt])}>
        <dt>对象 / 策略</dt><dd>{source.treeId} / {source.strategyId}</dd>
        <dt>分析批次 / 版本</dt><dd>{source.runId} / {source.revision}</dd>
        <dt>采用时间</dt><dd>{displayTime(source.adoptedAt)}</dd>
        <dt>策略有效期至</dt><dd>{displayTime(source.expiresAt)}</dd>
        <dt>数据模式</dt><dd>{source.dataMode === 'mixed_demo' ? '公开数据 + 模拟现场数据' : source.dataMode === 'demo' ? '模拟数据' : '未记录'} · 模拟采用</dd>
      </dl>)}
    </details>}
    </details>
    {task.sourceParkPlanId && onStrategy
      ? <button type="button" onClick={()=>onStrategy(task)}>查看原全园方案 →</button>
      : onReview && <button type="button" onClick={onReview}>查看策略来源</button>}
    <TaskEvidenceActions key={`${task.site}:${task.id}`} task={task} fleet={fleet} events={events} batches={batches} />
  </section>;
}
