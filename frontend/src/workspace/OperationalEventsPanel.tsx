import {useState, type FormEvent} from 'react';
import {ArrowRight, CloudRain, Wrench} from 'lucide-react';
import {sites, type Site, type Task} from './model';
import {operationDateLabel} from './operationsModel';
import {logisticsDependency} from './taskLifecycleModel';
import {batchAssessment, type LatexBatch} from '../../../shared/logistics';
import {eventAffectsTask, eventMatchesTask, eventHoldForTask, eventKindLabels, eventScopeLabel, eventStatusLabels, type OperationalEvent} from './operationalEvents';
import './operationalEvents.css';

export type OperationalEventsPanelProps = {
  site: Site;
  tasks: Task[];
  batches: LatexBatch[];
  events: OperationalEvent[];
  onCreate: (input: {kind: OperationalEvent['kind']; zone: number | null; note: string}) => Promise<void>;
  onResolve: (id: string, note: string) => Promise<void>;
  onResume: (id: string, note: string) => Promise<void>;
  onTask: (task: Task) => void;
};

function eventTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});
}

export function OperationalEventsPanel({site, tasks, batches, events, onCreate, onResolve, onResume, onTask}: OperationalEventsPanelProps) {
  const [kind, setKind] = useState<OperationalEvent['kind']>('rain');
  const [zone, setZone] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const siteEvents = events.filter(event => event.siteId === `demo-${site}`);
  const visible = siteEvents.filter(event => showClosed || event.status !== 'closed');
  const selected = visible.find(event => event.id === selectedId) ?? visible[0];
  const affected = selected ? tasks.map(task => ({task, batch: batches.find(batch =>
    batch.siteId === `demo-${task.site}` && batch.source.taskId === task.id)})).filter(({task, batch}) => {
    if (!batch) return eventAffectsTask(task, selected, true);
    if (['received','processing','processed','cancelled'].includes(batch.stage) || batch.transport?.receipt) return false;
    // A partial cancellation can still produce a batch; only its completed
    // source trees determine the downstream rain scope.
    return selected.kind === 'rain' && eventMatchesTask({...task, treeIndices: batch.source.treeIndices}, selected);
  }) : [];

  async function submit(event: FormEvent<HTMLFormElement>, action: (note: string) => Promise<void>) {
    event.preventDefault();
    const form = event.currentTarget;
    const note = String(new FormData(form).get('note')).trim();
    setError(''); setBusy(true);
    try { await action(note); form.reset(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="op-events" aria-labelledby="operational-events-title">
    <header className="op-events-heading"><div><p>{sites[site]} · 当前园区</p><h2 id="operational-events-title">天气与设备联动</h2><p>登记影响，处理受影响任务。</p></div><span>人工模拟事件</span></header>
    <details className="op-events-note"><summary>联动范围与规则</summary><p>生成天气候选方案不会自动创建事件。确认影响后，暂缓范围内的未完成任务；降雨还会暂缓收胶和发车。既有进度与回执保留。</p></details>
    <div className="op-events-layout">
      <aside className="op-event-create"><h3>确认新的影响</h3>
        <form aria-label="确认天气或设备影响" onSubmit={event => void submit(event, note => onCreate({kind, zone: zone === 'all' ? null : Number(zone), note}))}>
          <fieldset disabled={busy}><legend>影响类型</legend><div className="op-event-types"><button type="button" aria-pressed={kind === 'rain'} onClick={() => {setKind('rain'); setZone('all');}}><CloudRain size={17}/>降雨影响</button><button type="button" disabled={site !== 'hainan'} aria-pressed={kind === 'device_fault'} onClick={() => {setKind('device_fault'); setZone('0');}}><Wrench size={17}/>设备故障</button></div>
          {site !== 'hainan' && <p className="op-event-muted">本园区设备尚未接入。</p>}
          <label>影响范围<select aria-label="事件影响范围" value={zone} onChange={event => setZone(event.target.value)}>{kind === 'rain' && <option value="all">全园区</option>}{Array.from({length: 4}, (_, index) => <option key={index} value={index}>{kind === 'device_fault' ? `R-${'ABCD'[index]} · ` : ''}{'ABCD'[index]}区</option>)}</select></label>
          <label>确认依据与影响说明<textarea name="note" aria-label="确认依据与影响说明" required rows={3} maxLength={1000} placeholder={kind === 'rain' ? '例如：现场反馈持续降雨，A区割胶及收胶道路暂缓使用。' : '例如：R-A割胶头动作异常，等待检修。'}/></label>
          <button className="op-event-primary" type="submit">{busy ? '正在保存…' : '确认影响并联动暂缓'}</button></fieldset>
        </form>
        <p className="op-event-muted">包含往期未完成任务。</p>
      </aside>
      <section className="op-events-records" aria-label="当前影响与处理记录"><header><h3>影响记录 <span>{siteEvents.filter(event => event.status !== 'closed').length} 项未恢复</span></h3><label><input type="checkbox" checked={showClosed} onChange={event => setShowClosed(event.target.checked)}/>包含已恢复</label></header>
        {visible.length ? <><nav className="op-events-list" aria-label="选择影响事件">{visible.map(event => <button type="button" key={event.id} aria-pressed={selected?.id === event.id} onClick={() => setSelectedId(event.id)}><strong>{eventKindLabels[event.kind]} · {eventScopeLabel(event)}</strong><span className={`op-event-state ${event.status}`}>{eventStatusLabels[event.status]}</span><small>{eventTime(event.createdAt)} · 北京时间</small></button>)}</nav>
        {selected && <article className="op-event-detail" aria-label="选中事件详情"><h3>{eventKindLabels[selected.kind]} · {eventScopeLabel(selected)}</h3><p>{selected.note}</p>
          {selected.status !== 'closed' && <p className="op-event-boundary">{selected.status === 'active' ? '影响解除后，仍需确认恢复。' : '影响已解除，请核对条件后确认恢复。'}</p>}
          {selected.status !== 'closed' && <form key={`${selected.id}:${selected.status}`} aria-label={selected.status === 'active' ? '解除影响' : '确认恢复'} onSubmit={event => void submit(event, note => selected.status === 'active' ? onResolve(selected.id, note) : onResume(selected.id, note))}><fieldset disabled={busy}><label>{selected.status === 'active' ? '解除依据' : '恢复核对说明'}<textarea name="note" required rows={2} maxLength={1000} aria-label={selected.status === 'active' ? '解除依据' : '恢复核对说明'} placeholder={selected.status === 'active' ? '说明雨况或设备故障已解除的核实结果。' : '说明已核对当前作业与储运条件。'}/></label><button className="op-event-primary" type="submit">{busy ? '正在保存…' : selected.status === 'active' ? '记录解除，等待恢复确认' : '确认恢复本事件'}</button></fieldset></form>}
          <h4>关联任务与储运依赖 · {affected.length} 项</h4>
          {affected.length ? <div className="op-event-task-table"><table><thead><tr><th>原任务</th><th>割胶影响</th><th>储运依赖</th><th>操作</th></tr></thead><tbody>{affected.map(({task, batch}) => {
            const cutHold = eventHoldForTask(task, events);
            const storage = batch ? batchAssessment(batch, events) : logisticsDependency(task, undefined, Date.now(), events);
            return <tr key={`${task.site}:${task.id}`}><td><strong>{task.title}</strong><small>{task.block}区 · {task.done}/{task.count} 株</small><small>原计划：{operationDateLabel(task)}</small></td><td>{cutHold ?? (task.status === '已完成' ? '割胶已完成，保留原回执' : task.status)}</td><td><strong>{storage.label}</strong><small>{storage.reason}</small></td><td><button type="button" onClick={() => onTask(task)}>查看任务<ArrowRight size={14}/></button></td></tr>;
          })}</tbody></table></div> : <p className="op-events-empty">当前没有需跟进的关联任务。</p>}
          <details className="op-event-history"><summary>处理记录与联动说明</summary><p className="op-event-muted">事件编号 {selected.id} · {eventTime(selected.createdAt)}（北京时间）</p>
            {selected.resolvedAt && <p><strong>解除记录</strong> · {eventTime(selected.resolvedAt)}（北京时间）<br/>{selected.resolutionNote}</p>}
            {selected.closedAt && <p><strong>恢复确认</strong> · {eventTime(selected.closedAt)}（北京时间）<br/>{selected.resumeNote}</p>}
            <p>确认恢复只结束本事件。其他未恢复事件、手工暂停、策略与天气窗口限制继续生效。</p>
          </details>
        </article>}</> : <div className="op-events-empty"><strong>当前没有未恢复事件</strong><p>可登记新的降雨或设备故障。</p></div>}
      </section>
    </div>
    {error && <p className="op-event-error" role="alert">{error}</p>}
  </section>;
}
