import {useState} from 'react';
import {post, useRead} from './client';
import './brainEvolution.css';

type Metrics = {days:number;rainyMornings:number;tappedDays:number;correctTap:number;correctDefer:number;falseDefer:number;miss:number;extraReview:number;cost:number};
export type ReplayEvidence = {source:'measured'|'simulated';sourceNote:string;from:string;to:string;before:Metrics;after:Metrics;verdict:'better'|'same'|'worse';
  changedDays:{date:string;before:string;after:string;rained:boolean;actualWindowMm:number;effect:string}[]};
type Reason = {key:string;label:string;count:number};
export type BrainEvolution = {
  siteId:string;park:string;activeVersion:string;headline:string;
  experience:{source:'measured'|'simulated';sourceNote:string;start:string;end:string;days:number;retrievedAt:string|null;stale:boolean;rainyMornings:number};
  costModel:{miss:number;falseDefer:number;extraReview:number};truth:{windowMm:number;hourlyMm:number};baseline:Metrics;
  explored:{key:string;label:string;direction:'up'|'down';firstStep:{to:number;cost:number};best:{to:number;steps:number;cost:number};gain:number}[];
  recommendation:null|{label:string;unit:string;from:number;to:number;firstStep:Metrics;best:{to:number;steps:number;metrics:Metrics};gain:number;summary:string};
  pendingProposal:null|{id:string;expectedEffect:string;verdict:string|null};
  review:{status:'default'|'collecting'|'reviewed';summary:string;verdict?:'keep'|'rollback_suggested';version?:number};
  generations:{version:number;activatedAt:string;source:string;rolledBackTo:number|null;changes:string[];replay:null|{before:number;after:number;source:string}}[];
  routing:{kindLabel:string;total:number;delegated?:number;smallBrain:number;bigBrain:number;blocked:number;bigBrainReasons:Reason[];blockedReasons:Reason[]};
  loop:string[];limitations:string[];
};
const share = (value:number, total:number) => total ? `${Math.round(value / total * 100)}%` : '0%';
const verdictLabel = {better:'回放更好', same:'回放持平', worse:'回放更差'} as const;

/** Evidence rows shared by the loop panel and the pending proposal card. */
export function ReplayTable({before, after}:{before:Metrics;after?:Metrics}) {
  const rows:[string,keyof Metrics][] = [['误停（没下雨却暂缓）','falseDefer'],['漏停（下雨仍安排割胶）','miss'],['多余复核（没下雨却要求复核）','extraReview'],['回放成本','cost']];
  return <table className="pp-signals be-table"><thead><tr><th>指标</th><th>{after ? '调整前' : '当前参数'}</th>{after && <th>调整后</th>}</tr></thead><tbody>
    {rows.map(([label, key]) => <tr key={key}><th>{label}</th><td>{before[key]}{key === 'cost' ? '' : ' 天'}</td>{after && <td className={after[key] < before[key] ? 'be-better' : after[key] > before[key] ? 'be-worse' : ''}>{after[key]}{key === 'cost' ? '' : ' 天'}</td>}</tr>)}
  </tbody></table>;
}

export function ProposalReplay({replay}:{replay:ReplayEvidence}) {
  return <div className={`be-evidence be-${replay.verdict}`}>
    <p><strong>{verdictLabel[replay.verdict]}</strong>{replay.source === 'measured' ? '真实天气' : '模拟天气'} · 成本 {replay.before.cost} → {replay.after.cost}</p>
    <details><summary>回放指标与日期</summary><p>{replay.from}～{replay.to}</p><ReplayTable before={replay.before} after={replay.after}/></details>
    {replay.changedDays.length > 0 && <details><summary>判断不同的 {replay.changedDays.length} 个早晨</summary>
      <ul>{replay.changedDays.map(day => <li key={day.date}>{day.date}：{day.before} → {day.after}（实际 {day.actualWindowMm} mm{day.rained ? '，下雨' : '，未下雨'}）· {day.effect}</li>)}</ul></details>}
    {replay.verdict === 'worse' && <p className="be-warn">回放显示更差；如仍批准，须在审批说明中写明理由。</p>}
  </div>;
}

export function BrainEvolutionPanel({siteId, canPropose, onChanged}:{siteId:string;canPropose:boolean;onChanged:() => void}) {
  const result = useRead<BrainEvolution>(`/api/brain/evolution?siteId=${siteId}`);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const data = result.data;
  async function propose() {
    setBusy(true); setError(''); setMessage('');
    try { const created = await post<{proposal:{expectedEffect:string}}>('/api/brain/evolution/propose', {siteId}); setMessage(`已生成待审批提案：${created.proposal.expectedEffect}`); result.reload(); onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (result.error) return <section className="pp-card be-panel"><p role="alert">自我改进数据读取失败：{result.error} <button className="rb-button" onClick={result.reload}>重试</button></p></section>;
  if (!data) return <section className="pp-card be-panel"><p>正在拉取历史天气并回放小脑规则…</p></section>;
  const routing = data.routing, rec = data.recommendation;
  return <section className="pp-card be-panel" aria-label="大脑自我改进闭环">
    <h3>作业规则优化</h3>
    <div className="be-grid">
      <article className="be-block" aria-label="今日分流">
        <h4>今日分流 · {routing.kindLabel} {routing.total} 棵</h4>
        <div className="be-bar" role="img" aria-label={`小脑 ${routing.smallBrain}，大脑 ${routing.bigBrain}，暂停 ${routing.blocked}`}>
          <span className="be-small" style={{width:share(routing.smallBrain, routing.total)}}/><span className="be-big" style={{width:share(routing.bigBrain, routing.total)}}/><span className="be-blocked" style={{width:share(routing.blocked, routing.total)}}/>
        </div>
        <dl className="be-counts"><dt>小脑直接给出</dt><dd>{routing.smallBrain} 棵{routing.delegated ? `（含已下沉 ${routing.delegated} 棵）` : ''}</dd><dt>交给大脑</dt><dd>{routing.bigBrain} 棵</dd><dt>资料不全暂停</dt><dd>{routing.blocked} 棵</dd></dl>
        {routing.bigBrainReasons.length > 0 && <p className="pp-note">交给大脑：{routing.bigBrainReasons.slice(0, 3).map(item => `${item.label} ${item.count}`).join('、')}</p>}
        {routing.blockedReasons.length > 0 && <p className="pp-note">暂停：{routing.blockedReasons.slice(0, 3).map(item => `${item.label} ${item.count}`).join('、')}</p>}
      </article>
      <article className="be-block" aria-label="规则回放">
        <h4>当前优化建议</h4>
        <p className="pp-note">{data.experience.start}～{data.experience.end} · {data.experience.source === 'measured' ? '真实天气' : '模拟天气'} · 下雨的早晨 {data.experience.rainyMornings} 个{data.experience.stale ? ' · 暂用上次缓存' : ''}</p>
        <p className="be-headline">{rec ? <>{rec.label}：{rec.from} → <strong>{rec.to} {rec.unit}</strong></> : '继续使用当前参数，暂无更优调整。'}</p>
        {rec && <p className="pp-note">回放成本 {data.baseline.cost} → {rec.firstStep.cost}</p>}
        {data.pendingProposal ? <p className="pp-note">已有待审批提案：{data.pendingProposal.expectedEffect}</p>
          : rec && canPropose && <button className="rb-button rb-primary" disabled={busy} onClick={propose}>按回放结果生成提案</button>}
        {message && <p className="be-ok" role="status">{message}</p>}
        {error && <p className="pp-error" role="alert">{error}</p>}
      </article>
    </div>
    {data.review.verdict === 'rollback_suggested' && <p className="be-warn" role="status">{data.review.summary}</p>}
    <details className="be-more"><summary>回放依据与参数历史</summary>
      <ol className="be-loop">{data.loop.map(step => <li key={step}>{step}</li>)}</ol>
      <h4>过去 {data.baseline.days} 个早晨回放小脑规则 · {data.activeVersion === 'default' ? '默认参数' : data.activeVersion}</h4>
      <ReplayTable before={data.baseline} after={rec?.firstStep}/>
      {rec && <p>{rec.summary}</p>}
      <p>{data.review.summary}</p>
      <article className="be-block" aria-label="参数代际"><h4>小脑参数代际</h4>
        {data.generations.length ? <ol className="be-generations">{data.generations.map(item => <li key={item.version}><strong>v{item.version}</strong>
          {item.source === 'rollback' ? ` 回滚到 ${item.rolledBackTo === 0 ? '默认' : `v${item.rolledBackTo}`}` : ` ${item.changes.join('，') || '参数调整'}`}
          {item.replay && <small>回放成本 {item.replay.before}→{item.replay.after}</small>}</li>)}</ol> : <p className="pp-note">第 0 代：默认参数。批准第一个提案后开始记录。</p>}
      </article>
      <p>{data.experience.sourceNote}</p>
      <p>“下雨”按割胶时段累计 ≥ {data.truth.windowMm} mm 或单小时 ≥ {data.truth.hourlyMm} mm 判定；回放成本 = 漏停 × {data.costModel.miss} + 误停 × {data.costModel.falseDefer} + 多余复核 × {data.costModel.extraReview}。每次只提一步，回放变差的提案须写理由才能批准。</p>
      <table className="pp-signals be-table"><thead><tr><th>参数与方向</th><th>走一步</th><th>同方向最好</th></tr></thead><tbody>
        {data.explored.map(item => <tr key={`${item.key}-${item.direction}`}><th>{item.label}{item.direction === 'up' ? ' ↑' : ' ↓'}</th><td>{item.firstStep.to}（成本 {item.firstStep.cost}）</td><td>{item.best.to}（{item.best.steps} 步，成本 {item.best.cost}）</td></tr>)}
      </tbody></table>
      <ul>{data.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </details>
  </section>;
}
