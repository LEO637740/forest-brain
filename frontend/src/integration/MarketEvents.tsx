import {useState} from 'react';
import {post, useRead} from './client';
import {can, currentAccount} from '../workspace/identityModel';

type Kind = {label:string;factor:string;direction:'bullish'|'bearish';scenarioId:string|null};
export type MarketEvent = {id:string;kind:string;kindLabel:string;title:string;siteIds:'all'|string[];parkNames:string;effectiveFrom:string;effectiveTo:string;
  source:string;status:'pending'|'active'|'rejected'|'withdrawn'|'expired';proposedBy:string;decidedBy?:string;decisionNote?:string;direction:'bullish'|'bearish'};
const statusLabels = {pending:'待中心审批', active:'生效中', rejected:'已驳回', withdrawn:'已撤销', expired:'已过期'} as const;

/** Events the price check cannot fetch: parks propose, the center approves, only active ones count. */
export function MarketEvents({siteId, onChanged}:{siteId:string;onChanged:() => void}) {
  const account = currentAccount();
  const result = useRead<{kinds:Record<string,Kind>;items:MarketEvent[]}>(`/api/market-events?siteId=${siteId}`);
  const [draft, setDraft] = useState({kind:'reserve_release', title:'', scope:'park', effectiveFrom:'', effectiveTo:'', source:''});
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const mayPropose = !account || can(account, 'market_events.propose'), mayApprove = !account || can(account, 'market_events.approve');
  async function run(task:() => Promise<unknown>) {
    setBusy(true); setError('');
    try { await task(); result.reload(); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const submit = () => run(async () => {
    const optional = Object.fromEntries(Object.entries({effectiveFrom:draft.effectiveFrom, effectiveTo:draft.effectiveTo, source:draft.source.trim()}).filter(([, value]) => value));
    await post('/api/market-events', {kind:draft.kind, title:draft.title.trim(), siteIds:draft.scope === 'all' ? 'all' : [siteId], ...optional});
    setDraft({...draft, title:'', source:''}); setOpen(false);
  });
  const decide = (id:string, decision:'approve'|'reject'|'withdraw') => run(() => post(`/api/market-events/${id}/decision`, {decision, ...(note.trim() ? {note:note.trim()} : {})}));
  const items = result.data?.items.filter(item => item.status !== 'rejected') ?? [];
  return <div className="hb-factors-group hb-events" aria-label="市场与政策事件">
    <h4>市场与政策事件（中心批准后计入体检）</h4>
    {result.error && <p role="alert">{result.error}</p>}
    {items.length ? <ul className="hb-events-list">{items.map(item => <li key={item.id} className={`hb-event-${item.status}`}>
      <div><strong>{item.title}</strong><small>{item.kindLabel} · {item.parkNames} · {item.effectiveFrom}～{item.effectiveTo}{item.source ? ` · ${item.source}` : ''} · {statusLabels[item.status]}</small></div>
      {mayApprove && item.status === 'pending' && <span><button type="button" disabled={busy} onClick={() => decide(item.id, 'approve')}>批准</button><button type="button" disabled={busy} onClick={() => decide(item.id, 'reject')}>驳回</button></span>}
      {mayApprove && item.status === 'active' && <button type="button" disabled={busy} onClick={() => decide(item.id, 'withdraw')}>撤销</button>}
    </li>)}</ul> : <p className="hb-factors-basis">还没有登记事件。抛储、收储、限出口、关税、需求下滑、台风预警等，可在这里登记，或在对话中告诉大脑。</p>}
    {mayApprove && items.some(item => item.status === 'pending') && <input className="hb-events-note" aria-label="审批说明" placeholder="审批说明或信息来源（无来源的事件须填写）" value={note} onChange={event => setNote(event.target.value)}/>}
    {mayPropose && (open ? <form className="hb-events-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>类型<select value={draft.kind} onChange={event => setDraft({...draft, kind:event.target.value})}>{Object.entries(result.data?.kinds ?? {}).map(([key, kind]) => <option key={key} value={key}>{kind.label}</option>)}</select></label>
      <label>标题<input value={draft.title} placeholder="例如：国家储备天然橡胶投放 5 万吨" onChange={event => setDraft({...draft, title:event.target.value})}/></label>
      <label>范围<select value={draft.scope} onChange={event => setDraft({...draft, scope:event.target.value})}><option value="park">本园区</option><option value="all">全部园区</option></select></label>
      <label>开始<input type="date" value={draft.effectiveFrom} onChange={event => setDraft({...draft, effectiveFrom:event.target.value})}/></label>
      <label>结束<input type="date" value={draft.effectiveTo} onChange={event => setDraft({...draft, effectiveTo:event.target.value})}/></label>
      <label>来源<input value={draft.source} placeholder="公告链接或文号" onChange={event => setDraft({...draft, source:event.target.value})}/></label>
      <div><button type="submit" disabled={busy || draft.title.trim().length < 4}>提交待审批</button><button type="button" onClick={() => setOpen(false)}>取消</button></div>
    </form> : <button type="button" className="hb-events-open" onClick={() => setOpen(true)}>登记事件</button>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
