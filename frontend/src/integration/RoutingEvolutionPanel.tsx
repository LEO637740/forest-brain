import {useState} from 'react';
import {post, useRead} from './client';
import './brainEvolution.css';

type Verdict = 'delegate'|'brain_unreliable'|'keep_brain'|'insufficient';
export type RoutingGroup = {kind:string;kindLabel:string;signature:string;signals:string[];samples:number;compared:number;agree:number;disagree:number;fallback:number;failed:number;excluded:number;
  agreementRate:number|null;fallbackRate:number;llmCalls:number;tokens:number;latestAt:string|null;locked:string|null;verdict:Verdict;verdictLabel:string;explanation:string;eligible:boolean;
  delegation:null|{id:string;status:'active'|'pending';approvedAt?:string};examples:{agree:string[];disagree:{runId:string;detail:string}[];fallback:string[]}};
type Review = {status:'collecting'|'reviewed';summary:string;verdict?:'keep'|'revoke_suggested';handedDown:number;audits:number;disagreements?:{runId:string;detail:string}[]};
export type Delegation = {id:string;status:'pending'|'active'|'rejected'|'revoked'|'superseded';kind:string;signature:string;label:string;summary:string;effect:string;safety:string;
  evidence:{samples:number;compared:number;agree:number;disagree:number;fallback:number;failed:number;llmCalls:number};createdAt:string;decidedBy?:string;decidedAt?:string;review?:Review};
export type RoutingEvolution = {siteId:string;park:string;headline:string;auditEvery:number;rules:{minSamples:number;minAgreement:number;unreliableFallback:number;auditMinSamples:number;auditMaxDisagreement:number};
  totals:{brainRuns:number;compared:number;agree:number;fallback:number;excluded:number;llmCalls:number;tokensPerCall:number|null};groups:RoutingGroup[];delegations:Delegation[];loop:string[];limitations:string[]};
const pct = (value:number|null) => value === null ? '—' : `${Math.round(value * 100)}%`;
const statusLabel:Record<Delegation['status'],string> = {pending:'待审批', active:'生效中', rejected:'已驳回', revoked:'已收回', superseded:'已被替代'};

/** "分流自我改进": which trigger combinations the brain may hand down to the small brain. */
export function RoutingEvolutionPanel({siteId, canPropose, canApprove}:{siteId:string;canPropose:boolean;canApprove:boolean}) {
  const result = useRead<RoutingEvolution>(`/api/brain/routing?siteId=${siteId}`);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [note, setNote] = useState('');
  async function act(run:() => Promise<unknown>, done:string) {
    setBusy(true); setError(''); setMessage('');
    try { await run(); setMessage(done); result.reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const data = result.data;
  if (result.error) return <section className="pp-card be-panel"><p role="alert">分流对照读取失败：{result.error} <button className="rb-button" onClick={result.reload}>重试</button></p></section>;
  if (!data) return <section className="pp-card be-panel"><p>正在对照历史大脑运行与小脑规则…</p></section>;
  const withNote = (input:Record<string,string>) => note.trim() ? {...input, note:note.trim()} : input;
  const pending = data.delegations.filter(item => item.status === 'pending'), active = data.delegations.filter(item => item.status === 'active');
  return <section className="pp-card be-panel" aria-label="分流自我改进">
    <h3>哪些情况可交给小脑</h3>
    <p className="be-headline">{data.headline}</p>

    {message && <p className="be-ok" role="status">{message}</p>}
    {error && <p className="pp-error" role="alert">{error}</p>}
    {pending.map(item => <article key={item.id} className="be-evidence" aria-label="分流下沉待审批">
      <p><strong>待审批 · {item.label}</strong></p>
      <p>{item.effect}</p><details><summary>提案依据</summary><p>{item.summary}</p><p className="pp-note">{item.safety}</p></details>
      {canApprove ? <div className="pp-actions">
        <input aria-label="下沉审批说明" placeholder="审批说明（可选）" value={note} onChange={event => setNote(event.target.value)}/>
        <button className="rb-button rb-primary" disabled={busy} onClick={() => act(() => post(`/api/brain/routing/${item.id}/decision`, withNote({decision:'approve'})), '已批准，这类情况改由小脑处理。')}>批准下沉</button>
        <button className="rb-button" disabled={busy} onClick={() => act(() => post(`/api/brain/routing/${item.id}/decision`, withNote({decision:'reject'})), '已驳回。')}>驳回</button>
      </div> : <p className="pp-note">只有园区管理或中心可以审批。</p>}
    </article>)}
    {active.map(item => <article key={item.id} className="be-evidence" aria-label="已下沉">
      <p><strong>生效中 · {item.label}</strong>{item.decidedBy} 于 {item.decidedAt?.slice(0, 10)} 批准。</p>
      {item.review && <p className={item.review.verdict === 'revoke_suggested' ? 'be-warn' : ''}>抽检复盘：{item.review.summary}</p>}
      {canApprove && <button className="rb-button" disabled={busy} onClick={() => act(() => post(`/api/brain/routing/${item.id}/revoke`, withNote({})), '已收回，这类情况重新交给大脑。')}>收回给大脑</button>}
    </article>)}
    {data.groups.length > 0 && <table className="pp-signals be-table rv-table"><thead><tr><th>触发大脑的情况</th><th>次数</th><th>与小脑一致</th><th>校验失败</th><th>判断</th><th/></tr></thead><tbody>
      {data.groups.map(group => <tr key={`${group.kind}|${group.signature}`} className={`rv-${group.verdict}`}>
        <th>{group.kindLabel}<small>{group.signals.join(' + ')}</small></th>
        <td>{group.samples}{group.excluded > 0 && <small>其中 {group.excluded} 次未计入判断</small>}</td>
        <td>{group.compared ? `${group.agree}/${group.compared}（${pct(group.agreementRate)}）` : '—'}</td>
        <td>{group.fallback + group.failed}（{pct(group.fallbackRate)}）</td>
        <td>{group.delegation?.status === 'active' ? '已下沉' : group.delegation?.status === 'pending' ? '下沉待审批' : group.verdictLabel}<details><summary>判断依据</summary><small>{group.explanation}</small>{group.locked && <small>{group.locked}</small>}</details></td>
        <td>{group.eligible && !group.delegation && canPropose && <button className="rb-button" disabled={busy}
          onClick={() => act(() => post('/api/brain/routing/propose', {siteId, kind:group.kind, signature:group.signature}), `已提议把“${group.kindLabel}·${group.signals.join('+')}”下沉给小脑，等待审批。`)}>提议下沉</button>}</td>
      </tr>)}
    </tbody></table>}
    <details className="be-more"><summary>运行用量与判断规则</summary>
      <ol className="be-loop">{data.loop.map(step => <li key={step}>{step}</li>)}</ol>
    {data.totals.brainRuns > 0 && <p className="pp-note">本园共 {data.totals.brainRuns} 次大脑运行、{data.totals.llmCalls} 次模型调用{data.totals.tokensPerCall ? `（平均每次约 ${data.totals.tokensPerCall} token）` : ''}；{data.totals.fallback} 次候选没通过校验、退回规则保底。{data.totals.excluded > 0 && `另有 ${data.totals.excluded} 次未形成可比对候选，未计入下沉判断。`}</p>}
      <p>大脑通过校验 ≥ {data.rules.minSamples} 次且与小脑一致 ≥ {pct(data.rules.minAgreement)}，或 ≥ {data.rules.minSamples} 次有效评估里候选校验失败 ≥ {pct(data.rules.unreliableFallback)} 且没有不同结论，才可提议下沉。账户余额、请求配置、网络连接等故障不计入样本和失败比例。只在信号组合完全相同时下沉，多出任何信号仍交大脑。下沉后每 {data.auditEvery} 次抽 1 次交大脑，满 {data.rules.auditMinSamples} 次抽检后不一致超过 {pct(data.rules.auditMaxDisagreement)} 建议收回。</p>
      {data.delegations.filter(item => !['pending', 'active'].includes(item.status)).length > 0 && <ul>{data.delegations.filter(item => !['pending', 'active'].includes(item.status))
        .map(item => <li key={item.id}>{item.label} · {statusLabel[item.status]} · {item.createdAt.slice(0, 10)}</li>)}</ul>}
      <ul>{data.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </details>
  </section>;
}
