import type {ContextSnapshot,Strategy} from './contracts';
import {useRead} from './client';
import {recordTime,recordSource} from './treeEvidence';
import {strategyEvidenceRows,evidenceForReferences,type EvidenceRow} from './strategyEvidenceData';

export function EvidenceTable({rows}:{rows:EvidenceRow[]}){
  return <div className="hb-evidence-table"><table><thead><tr><th>依据</th><th>本轮使用的数据</th><th>时间与来源</th></tr></thead><tbody>{rows.map((row,i)=><tr key={`${row.id}-${i}`}><th scope="row">{row.title}</th><td>{row.value}</td><td>{row.at&&<span>{recordTime(row.at)}<br/></span>}{recordSource(row.provenance)}<small>{row.id}<br/>{row.provenance.sourceId}</small></td></tr>)}</tbody></table></div>;
}

export function StrategyEvidenceContent({s,context}:{s:Strategy;context:ContextSnapshot}){
  const rows=strategyEvidenceRows(context);
  const reasonRefs=s.reasons.flatMap(reason=>reason.sourceRefs);
  const extra=evidenceForReferences(rows,s.evidenceRefs.filter(ref=>!reasonRefs.includes(ref)));
  const trees=evidenceForReferences(rows,context.modules.trees?.map(tree=>tree.treeId)??[]);
  return <section aria-label="建议对应的输入依据" className="hb-strategy-evidence"><p className="hb-time">使用本轮输入 v{context.version} · 资料截至 {recordTime(context.asOf)}（北京时间）</p>{s.reasons.map((reason,i)=>{
    const related=evidenceForReferences(rows,reason.sourceRefs);
    const unresolved=reason.sourceRefs.filter(ref=>!related.some(row=>row.refs.includes(ref)));
    return <article key={i}><p>{reason.text}</p><details><summary>查看关联数据（{related.length} 条）</summary>{related.length>0&&<EvidenceTable rows={related}/ >}{unresolved.length>0&&<p className="hb-time">引用记录：{unresolved.join('、')}</p>}</details></article>;
  })}{extra.length>0&&<details><summary>其他引用数据（{extra.length} 条）</summary><EvidenceTable rows={extra}/></details>}{trees.length>0&&<details><summary>本轮树木档案（{context.modules.trees!.length} 棵）</summary><EvidenceTable rows={trees}/></details>}</section>;
}

export function StrategyEvidence({s}:{s:Strategy}){
  const input=useRead<ContextSnapshot>(`/internal/harness/runs/${s.runId}/context`);
  if(!input.data)return <p role="status">{input.error||'正在读取本轮输入依据…'}{input.error&&<button onClick={input.reload}>重试</button>}</p>;
  return <StrategyEvidenceContent s={s} context={input.data}/>;
}
