import type {IndustryRecord, IndustryStrategy} from './industryBriefData';
import {industryTime} from './industryBriefData';
import './industryBrief.css';
import './marketResult.css';

function industryActionLabel(action: string) {
  const names: Record<string, string> = {onHandKg: '在库量', reservedKg: '已预留量', heldKg: '质检冻结量', availableKg: '可用量'};
  return action.replace(/\b(onHandKg|reservedKg|heldKg|availableKg)\b/g, field => names[field]).replace(/\bERP\s*\/\s*WMS\s*\/\s*TMS\b/g, '经营、仓储和运输系统');
}

function IndustryReferences({refs, records}: {refs: string[]; records?: IndustryRecord[]}) {
  const names = refs.map(ref => records?.find(record => record.observationId === ref)?.title || ref);
  return <p className="hb-industry-references">{records ? '来源记录：' : '引用编号：'}{names.join('；') || '未提供引用'}</p>;
}

// Shared by the industry workspace and the general strategy-record renderer.
export function IndustryProposal({s, records}: {s: IndustryStrategy; records?: IndustryRecord[]}) {
  const p = s.proposal;
  return <div className="hb-industry-proposal">
    <section className="hb-industry-actions" aria-label="管理建议"><h3>管理建议</h3><ol className="hb-industry-recommendations">{p.recommendations.map((item, index) => <li key={`${item.action}-${index}`}><span className={'hb-industry-priority '+item.priority}>{({high: '优先核对', medium: '安排复核', low: '持续观察'})[item.priority]}</span><h4>{industryActionLabel(item.action)}</h4><details><summary>原因与依据</summary><p>{item.reason}</p>{industryActionLabel(item.action)!==item.action&&<p className="hb-industry-references">原始建议：{item.action}</p>}<IndustryReferences refs={item.sourceRefs} records={records}/></details></li>)}</ol></section>
    <p className="hb-result-meta">研判关注期：{industryTime(p.horizon.start)} — {industryTime(p.horizon.end)}</p>
    <details className="hb-result-details"><summary>行业判断 · {p.findings.length} 项</summary><section aria-label="行业判断">{p.findings.map((finding, index) => <article className="hb-industry-finding" key={`${finding.topic}-${index}`}><h4>{records?.find(record => record.topic === finding.topic)?.title || finding.topic}</h4><p>{finding.assessment}</p><p className="hb-industry-limitation">适用范围与限制：{finding.limitation}</p><IndustryReferences refs={finding.sourceRefs} records={records}/></article>)}</section></details>
    <details className="hb-result-details"><summary>适用条件与待补资料{p.missingData.length ? ` · ${p.missingData.length} 项缺项` : ''}</summary><section className="hb-industry-gaps" aria-label="缺项与不确定性">{p.missingData.length ? <ul>{p.missingData.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>本次无新增资料缺项。</p>}<p>{p.uncertainty}</p></section></details>
  </div>;
}
