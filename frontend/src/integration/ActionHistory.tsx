import {useRead,alias,siteIdOf,type EnvironmentSite} from './client';
import {Card,State,when} from './Views';

export function ActionHistory({site='hainan'}:{site?:EnvironmentSite}){
 const siteId=siteIdOf(site);
 const r=useRead<{items:{requestId:string;treeId:string;kind:string;angle?:number;disposition?:string;adoptedAt:string;strategyId:string}[]}>(`/api/simulation/actions?siteId=${siteId}`);
 return <Card title="已保存的采用与复核记录">{!r.data?<State error={r.error} reload={r.reload}/>:r.data.items.length?<table><thead><tr><th>树木</th><th>操作</th><th>时间</th><th>策略</th></tr></thead><tbody>{r.data.items.map(a=><tr key={a.requestId}><td>{alias(a.treeId,siteId)}</td><td>{a.kind==='adopt_angle'?`采用 ${a.angle}°`:a.kind==='adopt_weather'?'采用天气窗口':a.disposition==='allow'?'复核放行':'跳过割胶'}</td><td>{when(a.adoptedAt)}</td><td><details><summary>来源</summary>{a.strategyId}</details></td></tr>)}</tbody></table>:<p>当前园区尚无采用与复核记录。</p>}</Card>;
}
