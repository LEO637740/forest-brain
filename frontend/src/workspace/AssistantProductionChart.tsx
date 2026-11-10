import {useState} from 'react';
import type {ProductionChart} from '../integration/assistantClient';
export function AssistantProductionChart({chart}:{chart:ProductionChart}){
 const [metric,setMetric]=useState<'dryKg'|'latexKg'>('dryKg');
 const max=Math.max(1,...chart.rows.map(r=>r[metric]??0));
 return <section className="ba-production-chart" aria-label={chart.title}>
  <header><strong>{chart.title}</strong><select aria-label="图表指标" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}><option value="dryKg">加工干胶（kg）</option><option value="latexKg">称重鲜胶乳（kg）</option></select></header>
  <div className="ba-series-bars" role="img" aria-label={chart.rows.map(r=>`${r.date}：${r[metric]??'无记录'}`).join('；')}>
   {chart.rows.map(row=><div key={row.date} title={`${row.date}：${row[metric]??'无记录'}`}><small>{row[metric]??'—'}</small><i style={{height:Math.max(1,(row[metric]??0)/max*100),opacity:row[metric]===null?.2:1}}/><span>{row.date.slice(5)}</span></div>)}
  </div><p>{chart.note}</p><details><summary>查看数值与批次依据</summary><table><thead><tr><th>日期</th><th>鲜胶乳 kg</th><th>干胶 kg</th><th>来源批次</th></tr></thead><tbody>{chart.rows.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.latexKg??'未登记'}</td><td>{r.dryKg??'未登记'}</td><td>{r.batchIds.join('、')||'—'}</td></tr>)}</tbody></table></details>
 </section>;
}
