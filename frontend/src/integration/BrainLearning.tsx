import {useState} from 'react';
import {Brain, Check, History, RotateCcw, X} from 'lucide-react';
import {post, siteIdOf, useRead, type EnvironmentSite} from './client';
import {when} from './Views';
import {memoryScopeLabels, type AssistantMemory} from './assistantClient';
import {can, currentAccount, type DemoAccount} from '../workspace/identityModel';
import {BrainEvolutionPanel, ProposalReplay, type ReplayEvidence} from './BrainEvolutionPanel';
import {HarnessLedger} from './HarnessLedger';
import {RoutingEvolutionPanel} from './RoutingEvolutionPanel';
import './strategyBrain.css';

type Spec = {label:string;unit:string;min:number;max:number;step:number};
type Change = {key:string;label:string;unit:string;from:number;to:number;reason:string};
type Count = {count:number;sourceRefs:string[]};
export type Proposal = {id:string;status:'pending'|'approved'|'rejected'|'superseded';changes:Change[];summary:string;expectedEffect:string;
  origin:string;createdBy:string;createdAt:string;decidedBy?:string;decidedAt?:string;decisionNote?:string;safety:string;replay?:ReplayEvidence|null;
  feedback:{windowDays:number;fieldRainEvents:Count;weatherHeldTasks:Count;adoptedWeatherWindows:Count;completedTasks:Count;cancelledTasks:Count}};
type ParamSet = {version:number;thresholds:Record<string,number>;activatedAt:string;source:string;approvedBy:string;rolledBackTo?:number;proposalId?:string};
export type CerebellumStatus = {siteId:string;park:string;climateLabel:string;activeVersion:string;thresholds:Record<string,number>;defaults:Record<string,number>;
  specs:Record<string,Spec>;history:ParamSet[];proposals:Proposal[];note:string};

export const proposalStatus:Record<Proposal['status'],string> = {pending:'待审批',approved:'已批准',rejected:'已驳回',superseded:'已被替代'};
const originLabel = (origin:string) => origin === 'model_tool' ? '大模型在对话中提出' : origin === 'assistant_reflection' ? '对话中大脑复盘' : origin === 'rsi_replay' ? '大脑回放历史天气' : '大脑复盘';

/** Which memory rows the signed-in account may edit (mirrors the server rule). */
export function memoryEditable(memory:AssistantMemory & {accountId?:string|null}, account:DemoAccount|null) {
  if (!account) return false;
  if (memory.scope === 'private') return memory.accountId === account.accountId;
  if (memory.scope === 'park') return can(account, 'memory.park.write') && !memory.id.startsWith('execution-');
  if (memory.scope === 'shared') return can(account, 'memory.public.write') && !memory.id.startsWith('knowledge-');
  return false;
}

export function BrainLearning({site}:{site:EnvironmentSite}) {
  const siteId = siteIdOf(site), account = currentAccount();
  const status = useRead<CerebellumStatus>(`/api/cerebellum?siteId=${siteId}`);
  const memories = useRead<{items:(AssistantMemory & {accountId?:string|null})[]}>(`/api/assistant/memories?siteId=${siteId}`);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const [editing, setEditing] = useState<{id:string;content:string}|null>(null);
  const [draft, setDraft] = useState({scope:'private', title:'', content:''});
  const approve = !account || can(account, 'cerebellum.approve'), propose = !account || can(account, 'cerebellum.propose');
  async function act(run:() => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); status.reload(); memories.reload(); window.dispatchEvent(new Event('harness-weather-changed')); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const data = status.data, pending = data?.proposals.filter(item => item.status === 'pending') ?? [];
  return <section className="bl-page" aria-labelledby="bl-title">
    <header className="pp-head"><div><span className="pp-eyebrow">大脑学习</span>
      <h2 id="bl-title"><Brain size={20}/> 参数调整与经验积累</h2>
      <p>{data ? `${data.park} · ${data.climateLabel} · 当前参数 ${data.activeVersion === 'default' ? '默认' : data.activeVersion}` : '正在读取…'} · 批准后生效</p></div>
    </header>
    {status.error && <p role="alert">读取失败：{status.error} <button className="rb-button" onClick={status.reload}>重试</button></p>}
    {error && <p className="pp-error" role="alert">{error}</p>}
    {data && <>
      {pending.length ? pending.map(proposal => <article key={proposal.id} className="pp-card bl-proposal" aria-label="待审批提案">
        <h3>待审批：{proposal.expectedEffect}</h3>
        <table className="pp-signals"><tbody>{proposal.changes.map(change => <tr key={change.key}><th>{change.label}</th>
          <td>{change.from} → <strong>{change.to}</strong> {change.unit}</td><td>{change.reason}</td></tr>)}</tbody></table>
        {proposal.replay && <ProposalReplay replay={proposal.replay}/>}
        <details className="pp-limits"><summary>提案依据</summary><p>{proposal.summary}</p>
        <p className="pp-note">依据（近 {proposal.feedback.windowDays} 天，模拟记录）：现场雨情 {proposal.feedback.fieldRainEvents.count} 次 · 因天气暂缓 {proposal.feedback.weatherHeldTasks.count + proposal.feedback.adoptedWeatherWindows.count} 次 · 完成 {proposal.feedback.completedTasks.count} 项 · 取消 {proposal.feedback.cancelledTasks.count} 项。{originLabel(proposal.origin)} · {when(proposal.createdAt)}</p>
        <p className="pp-note">{proposal.safety}</p></details>
        {approve ? <div className="pp-actions">
          <input aria-label="审批说明" placeholder="审批说明（可选）" value={note} onChange={event => setNote(event.target.value)}/>
          <button className="rb-button rb-primary" disabled={busy} onClick={() => act(() => post(`/api/cerebellum/proposals/${proposal.id}/decision`, {decision:'approve', ...(note.trim() ? {note:note.trim()} : {})}))}><Check size={15}/>批准生效</button>
          <button className="rb-button" disabled={busy} onClick={() => act(() => post(`/api/cerebellum/proposals/${proposal.id}/decision`, {decision:'reject', ...(note.trim() ? {note:note.trim()} : {})}))}><X size={15}/>驳回</button>
        </div> : <p className="pp-note">只有园区管理或中心可以审批。</p>}
      </article>) : <p className="pp-card bl-empty">当前没有待审批的参数提案。</p>}
    </>}
    <BrainEvolutionPanel key={`${siteId}:${data?.activeVersion ?? ''}:${pending.length}`} siteId={siteId} canPropose={propose} onChanged={status.reload}/>
    <RoutingEvolutionPanel key={`routing:${siteId}`} siteId={siteId} canPropose={propose} canApprove={approve}/>
    {data && <>
      <details className="pp-card pp-disclosure" aria-label="当前小脑参数"><summary>当前小脑参数 · {data.activeVersion === 'default' ? '默认' : data.activeVersion}</summary>
        <table className="pp-signals bl-params"><thead><tr><th>参数</th><th>当前</th><th>默认</th><th>护栏</th></tr></thead><tbody>
          {Object.entries(data.specs).map(([key, spec]) => <tr key={key} className={data.thresholds[key] !== data.defaults[key] ? 'bl-changed' : ''}>
            <th>{spec.label}</th><td>{data.thresholds[key]} {spec.unit}</td><td>{data.defaults[key]} {spec.unit}</td><td>{spec.min}–{spec.max}，单次 ±{spec.step}</td></tr>)}
        </tbody></table>
        <p className="pp-note">{data.note}</p>
      </details>
      <details className="pp-card bl-history"><summary><History size={15}/> 参数版本与回滚 · {data.history.length} 个版本</summary>
        {data.history.length ? <ol>{data.history.map(set => <li key={set.version}>
          <strong>v{set.version}</strong> · {set.source === 'rollback' ? `回滚到 ${set.rolledBackTo === 0 ? '默认' : `v${set.rolledBackTo}`}` : '提案批准'} · {set.approvedBy} · {when(set.activatedAt)}
          {approve && <button className="rb-button" disabled={busy} onClick={() => act(() => post('/api/cerebellum/rollback', {siteId, toVersion:set.version}))}><RotateCcw size={13}/>恢复此版本</button>}
        </li>)}</ol> : <p>尚未调整，使用默认参数。</p>}
        {approve && data.history.length > 0 && <button className="rb-button" disabled={busy} onClick={() => act(() => post('/api/cerebellum/rollback', {siteId, toVersion:0}))}>恢复默认参数</button>}
        {data.proposals.filter(item => item.status !== 'pending').length > 0 && <ul className="bl-decided">{data.proposals.filter(item => item.status !== 'pending').map(item => <li key={item.id}>{proposalStatus[item.status]} · {item.expectedEffect}{item.decisionNote ? `（${item.decisionNote}）` : ''}</li>)}</ul>}
      </details>
    </>}
    <HarnessLedger siteId={siteId}/>
    <details className="pp-card pp-disclosure bl-memory" aria-label="大脑记忆"><summary>大脑记忆 · {memories.data?.items.length ?? 0} 条</summary>
      <p className="pp-note">公共记忆供全部园区使用；园区记忆在本园区共享；个人记忆仅本人可见。</p>
      {memories.error && <p role="alert">{memories.error}</p>}
      <ul>{memories.data?.items.map(memory => <li key={memory.id}>
        <span className="ba-memory-scope">{memoryScopeLabels[memory.scope] ?? memory.scope}</span><strong>{memory.title}</strong>
        {editing?.id === memory.id
          ? <span className="bl-edit"><textarea aria-label="修改记忆" value={editing.content} onChange={event => setEditing({...editing, content:event.target.value})}/>
            <button className="rb-button" disabled={busy || !editing.content.trim()} onClick={() => act(async () => { await post(`/api/assistant/memories/${memory.id}`, {content:editing.content}); setEditing(null); })}>保存</button>
            <button className="rb-button" onClick={() => setEditing(null)}>取消</button></span>
          : <small>{memory.content}{memory.useCount ? ` · 被引用 ${memory.useCount} 次` : ''}{memory.history?.length ? ` · ${memory.history.length} 个历史版本` : ''}</small>}
        {memoryEditable(memory, account) && editing?.id !== memory.id && <span className="bl-memory-actions">
          <button className="rb-button" onClick={() => setEditing({id:memory.id, content:memory.content ?? ''})}>修改</button>
          <button className="rb-button" disabled={busy} onClick={() => act(() => post(`/api/assistant/memories/${memory.id}/archive`, {reason:'在大脑学习页归档'}))}>归档</button></span>}
      </li>)}</ul>
      {account && <form className="bl-new" onSubmit={event => { event.preventDefault(); void act(async () => { await post('/api/assistant/memories', {scope:draft.scope, content:draft.content, siteId, ...(draft.title.trim() ? {title:draft.title.trim()} : {})}); setDraft({...draft, title:'', content:''}); }); }}>
        <select aria-label="记忆范围" value={draft.scope} onChange={event => setDraft({...draft, scope:event.target.value})}>
          <option value="private">个人记忆</option>
          {can(account, 'memory.park.write') && <option value="park">园区经验</option>}
          {can(account, 'memory.public.write') && <option value="shared">公共经验</option>}
        </select>
        <input aria-label="记忆标题" placeholder="标题" value={draft.title} onChange={event => setDraft({...draft, title:event.target.value})}/>
        <input aria-label="记忆内容" placeholder="例如：雾天九点半后再割" value={draft.content} onChange={event => setDraft({...draft, content:event.target.value})}/>
        <button className="rb-button" disabled={busy || !draft.content.trim()}>记下</button>
      </form>}
    </details>
  </section>;
}
