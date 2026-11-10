import {sites} from '../../../shared/parkCatalog.ts';
import type {Task} from '../workspace/model';
import {ReviewDesk} from './ReviewDesk';
import {useHealthSummary} from './HealthSummary';
import {RunActions} from './RunActions';
import {MarketSimulation} from './MarketSimulation';
import {StrategyRefreshStatus} from './StrategyRefreshStatus';
import {ActionHistory} from './ActionHistory';
import {ExecutionLinks} from './ExecutionLinks';
import {IndustryBrief} from './IndustryBrief';
import {ParkTappingPlan} from './ParkTappingPlan';
import {useState} from 'react';
import {ParkWeather} from './ParkWeather';
import './strategy-workspace.css';
import type {StrategyTab} from '../workspace/restructure/StrategyCenter';
import type {DataTab,PublicReferenceTab} from '../workspace/DataCenter';
import type {AnalyticsTopic} from '../workspace/AnalyticsPage';
import type {RunResponse} from './contracts';
import {useRead,kinds,alias,indexOf,statuses,type Park,type Business,type EnvironmentSite,siteIdOf} from './client';
import {Card,State,Chart,Result,TreeDecision,when} from './Views';
const tabs:[StrategyTab,string][]=[['park','生产计划'],['market','经营销售'],['tree','单树与异常'],['records','策略记录']];
function treeLabel(site:EnvironmentSite,treeId:string){return alias(treeId,siteIdOf(site));}
export function BackendStrategyWorkspace({tab:requestedTab,onTab,onTree,onData,onTasks,site='hainan',tasks,onTask,marketModelId,onLatestMarket,parkPlanId,onLatestParkPlan,allowBusiness=true}:{tab:StrategyTab;onTab:(t:StrategyTab)=>void;onTree:(i:number)=>void;onData?:(tab?:DataTab,reference?:PublicReferenceTab,analysis?:AnalyticsTopic)=>void;onTasks?:(taskId?:string)=>void|Promise<void>;site?:EnvironmentSite;tasks:Task[];onTask?:(task:Task)=>void;marketModelId?:string|null;onLatestMarket?:()=>void;parkPlanId?:string|null;onLatestParkPlan?:()=>void;allowBusiness?:boolean}){
 const tab=!allowBusiness&&['park','market','industry'].includes(requestedTab)?'weather':requestedTab;
 const siteName=sites[site];
 const [reviewOpenRequest,setReviewOpenRequest]=useState(0);
 const group=tab==='weather'?'park':tab==='industry'?'market':(tab==='health'||tab==='reviews')?'tree':tab;
 const openReviews=()=>{setReviewOpenRequest(value=>value+1);onTab('reviews');};
 const openProductionPlan=()=>{onLatestParkPlan?.();onTab('park');};
 const reviewDesk=<ReviewDesk key={site} site={site} onTree={onTree} openRequest={reviewOpenRequest} onPlan={allowBusiness?()=>onTab('park'):()=>void onTasks?.()}/>;
 const sections:[StrategyTab,string][]=group==='park'?allowBusiness?[['park','全园割胶安排'],['weather','天气作业窗口']]:[['weather','天气作业窗口']]:group==='market'?[['market','生产与销售方案'],['industry','行业经营建议']]:group==='tree'?[['tree','单树方案'],['reviews','补拍与复测'],['health','健康巡查']]:[];
 return <div className="sc-page hb-workspace"><header className="sc-heading"><div><h1>策略中心</h1><p>{siteName}</p></div><div className="sc-heading-actions">{onData&&<button onClick={()=>tab==='health'?onData('analytics',undefined,'health'):onData(tab==='industry'?'public':group==='market'?'business':group==='tree'?'analytics':group==='records'?'catalog':'public',tab==='industry'?'industry':'weather')}>查看数据 →</button>}{onTasks&&<button onClick={()=>void onTasks()}>查看执行 →</button>}</div></header>
 <nav className="sc-tabs" aria-label="策略分类">{tabs.filter(([id])=>allowBusiness||id!=='market').map(([id,name])=><button key={id} className={group===id?'active':''} aria-current={group===id?'page':undefined} onClick={()=>onTab(!allowBusiness&&id==='park'?'weather':id)}>{!allowBusiness&&id==='park'?'作业天气':name}</button>)}</nav>
 <p className="sc-purpose">{({park:allowBusiness?'割次、分区排程与作业窗口':'天气与作业窗口',market:'生产与销售方案比较',tree:'单树建议与异常处理',records:'策略与核查记录'} as Record<string,string>)[group]}</p>
 {sections.length>0&&<nav className="sc-subtabs" aria-label="当前策略专题">{sections.map(([id,name])=><button key={id} aria-pressed={tab===id} onClick={()=>onTab(id)}>{name}</button>)}</nav>}
 {allowBusiness&&['park','market','industry'].includes(tab)&&<StrategyRefreshStatus site={site} kind={tab==='park'?'park_plan':tab==='market'?'market_sales':'industry_brief'}/>}
 {tab==='park'?<ParkTappingPlan key={`${site}:${parkPlanId??'latest'}`} site={site} tasks={tasks} onTasks={onTasks} planId={parkPlanId} onLatest={onLatestParkPlan} onReview={openReviews}/>:tab==='industry'?<IndustryBrief onData={onData?()=>onData('public','industry'):undefined}/>:tab==='market'?<MarketSimulation key={`${site}:${marketModelId??'latest'}`} site={site} modelId={marketModelId} onLatest={onLatestMarket} onProductionPlan={openProductionPlan}/>:tab==='health'?<><Health site={site} onTree={onTree} onData={onData?()=>onData('analytics',undefined,'health'):undefined}/><ReviewDesk key={`health:${site}`} site={site} onTree={onTree} healthOnly/></>:tab==='reviews'?reviewDesk:tab==='tree'?<Trees site={site} onTree={onTree}/>:tab==='weather'?<Weather key={site} site={site} onData={onData?()=>onData('public','weather'):undefined}/>:<><History key={site} site={site}/><ActionHistory site={site}/><ExecutionLinks tasks={tasks} site={site} onTask={onTask}/></>}
 </div>;
}
type Inventory={totals:{onHandKg:number;reservedKg:number;availableKg:number;heldKg:number};items:{batchId:string;warehouseId:string;onHandKg:number;reservedKg:number;availableKg:number;heldKg:number}[]};
type Processing={batches:{batchId:string;quantityKg:number;stage:string;qualityStatus:string}[]};
type Transport={shipments:{shipmentId:string;orderId:string;batchId:string;quantityKg:number;status:string;plannedArrivalAt:string;estimatedArrivalAt:string;delayReason:string}[]};
function topic<T>(data:Business,name:string):T|undefined{try{const r=data.records.find(r=>r.topic===name);return r?JSON.parse(r.content):undefined;}catch{return undefined;}}
function Logistics({compact=false,onTasks}:{compact?:boolean;onTasks?:(taskId?:string)=>void|Promise<void>}){
 const r=useRead<Business>('/api/demo/business-data');
 if(!r.data)return <State error={r.error} reload={r.reload}/>;
 const stock=topic<Inventory>(r.data,'inventory'),processing=topic<Processing>(r.data,'processing'),transport=topic<Transport>(r.data,'transport');
 if(!stock?.totals||!processing?.batches||!transport?.shipments)return <p>经营数据格式不完整</p>;
 const totals=stock.totals,delayed=transport.shipments.filter(s=>s.status==='delayed'),held=processing.batches.filter(b=>b.stage==='quality_hold'||b.qualityStatus==='needs_recheck');
 const shipments=<Card title="在途与交付">{transport.shipments.map(s=><div className="hb-shipment" key={s.shipmentId}><h3>{s.batchId} · {s.quantityKg} kg 干胶</h3><div className="hb-comparison"><span>原定 {when(s.plannedArrivalAt)}</span><b>→</b><span>预计 {when(s.estimatedArrivalAt)}</span></div><p>{s.delayReason}</p></div>)}</Card>;
 const kpis=<div className="hb-kpis">{[['在库',totals.onHandKg],['可用',totals.availableKg],['已预留',totals.reservedKg],['质检冻结',totals.heldKg]].map(([k,v])=><div key={k}><span>{k}</span><strong>{v}<small> kg 干胶</small></strong></div>)}</div>;
 if(compact)return <>{kpis}{shipments}</>;
 return <><Card title="当前储运待办"><p className="hb-muted">模拟企业库存与运输快照</p><h3 className="hb-logistics-action">{delayed.length?'优先处理运输延误':held.length?'优先复核冻结批次':'核对库存与交付安排'}</h3><ol className="hb-logistics-actions">{delayed.map(s=><li key={s.shipmentId}><strong>跟进承运方，更新 {s.batchId} 到货安排</strong><span>{s.quantityKg} kg 干胶 · 预计 {when(s.estimatedArrivalAt)} 到货。{s.delayReason}</span></li>)}{held.length>0&&<li><strong>复核 {held.map(b=>b.batchId).join('、')} 的质检结果</strong><span>冻结库存 {totals.heldKg} kg 干胶，解除冻结前不安排交付。</span></li>}<li><strong>按订单核对可用库存与发运批次</strong><span>当前可用 {totals.availableKg} kg 干胶；交付安排同时核对作业回执与车辆。</span></li></ol>{onTasks&&<button onClick={()=>void onTasks()}>查看作业与运输任务 →</button>}</Card><details className="dc-strategy-evidence"><summary>查看库存、批次与在途明细</summary>{kpis}<div className="hb-two"><Card title="库存构成"><Chart values={[totals.availableKg,totals.reservedKg,totals.heldKg]} labels={['可用','预留','冻结']} unit="kg 干胶" bars/></Card><Card title="批次与质检"><table><thead><tr><th>批次</th><th>干胶 kg</th><th>阶段</th></tr></thead><tbody>{processing.batches.map(b=><tr key={b.batchId}><td>{b.batchId}</td><td>{b.quantityKg}</td><td>{({finished:'已加工',quality_hold:'质检待复核',drying:'加工中'} as Record<string,string>)[b.stage]||b.stage}</td></tr>)}</tbody></table></Card></div><Card title="库存明细"><table><thead><tr><th>批次</th><th>仓库</th><th>在库 kg</th><th>可用 kg</th><th>预留 kg</th><th>冻结 kg</th></tr></thead><tbody>{stock.items.map(b=><tr key={b.batchId}><td>{b.batchId}</td><td>{b.warehouseId}</td><td>{b.onHandKg}</td><td>{b.availableKg}</td><td>{b.reservedKg}</td><td>{b.heldKg}</td></tr>)}</tbody></table></Card>{shipments}</details></>;
}
function Trees({onTree,site='hainan'}:{onTree:(i:number)=>void;site?:EnvironmentSite}){const r=useRead<Park>(`/api/demo/park?siteId=${siteIdOf(site)}`);const [id,setId]=useState('T-0001'),[query,setQuery]=useState(''),[page,setPage]=useState(0);const filtered=(r.data?.trees||[]).filter(t=>`${t.treeId} ${treeLabel(site,t.treeId)} ${t.profile}`.toLowerCase().includes(query.toLowerCase()));const currentLabel=treeLabel(site,id);return <div className="hb-master"><Card title="单树策略"><p className="hb-muted">{r.data?.trees.length??'—'} 棵树 · 选择对象查看建议</p><input aria-label="搜索树编号" placeholder="搜索树编号或园区编号" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>{filtered.slice(page*12,page*12+12).map(t=><button key={t.treeId} className={'hb-select '+(id===t.treeId?'active':'')} onClick={()=>setId(t.treeId)}>{treeLabel(site,t.treeId)}</button>)}<div><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(filtered.length/12))}</span><button disabled={(page+1)*12>=filtered.length} onClick={()=>setPage(p=>p+1)}>下一页</button></div>{!r.data&&<State error={r.error} reload={r.reload}/>}</Card><Card title={`${currentLabel} · 当前建议`}><TreeDecision key={id} site={site} index={Math.max(0,(r.data?.trees||[]).findIndex(t=>t.treeId===id))}/><button onClick={()=>onTree(indexOf(id)??0)}>进入单树现场 →</button></Card></div>;}
function Weather({site='hainan',onData}:{site?:EnvironmentSite;onData?:()=>void}){return <ParkWeather key={site} site={site} onData={onData}/>;}

function Health({onTree,site='hainan',onData}:{onTree:(i:number)=>void;site?:EnvironmentSite;onData?:()=>void}){
 const {result,session,assessment}=useHealthSummary(site);
 const findings=assessment.findings;
 return <><Card title="当前健康处理建议">{result.data?<Result data={result.data}/>:<State error={result.error||session.error} reload={result.reload}/>}</Card>
 <Card title="优先巡查与复核对象">{assessment.available?<>{findings.length?<details><summary>查看 {Math.min(findings.length,20)} 棵优先处理对象</summary><table><thead><tr><th>对象</th><th>优先级</th><th>处理建议</th><th>操作</th></tr></thead><tbody>{findings.slice(0,20).map(f=><tr key={f.treeId}><td>{alias(f.treeId,siteIdOf(site))}</td><td>{f.riskLevel==='review'?'需复核':'关注'}</td><td>{f.reason}</td><td><button onClick={()=>{const index=indexOf(f.treeId);if(index!==undefined)onTree(index);}}>查看单树 →</button></td></tr>)}</tbody></table></details>:<p>本轮未触发健康风险建议。</p>}<p className="hb-muted">核查后重新生成策略会更新处理对象。</p></>:<p role="status">{assessment.message} 当前没有有效健康判断，请先更新建议。</p>}{onData&&<button onClick={onData}>查看健康分布与巡查资料 →</button>}</Card></>;
}
type RunList={items:{runId:string;kind:keyof typeof kinds;status:string;createdAt:string;summary:string|null}[];nextCursor:string|null};
function History({site}:{site:EnvironmentSite}){const [cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null);const r=useRead<RunList>(`/internal/harness/runs?siteId=${siteIdOf(site)}&limit=20`+(cursor?'&cursor='+cursor:''));const detail=useRead<RunResponse>(selected?'/internal/harness/runs/'+selected:null);return <><div className="hb-master"><Card title="分析与策略记录">{r.data?.items.map(i=><button className={'hb-select '+(selected===i.runId?'active':'')} key={i.runId} onClick={()=>setSelected(i.runId)}><strong>{kinds[i.kind]} · {statuses[i.status]}</strong><small>{when(i.createdAt)}</small></button>)}{!r.data&&<State error={r.error} reload={r.reload}/>}<button disabled={!cursor} onClick={()=>setCursor(null)}>最新记录</button><button disabled={!r.data?.nextCursor} onClick={()=>setCursor(r.data?.nextCursor||null)}>更早记录</button></Card><Card title="策略详情">{selected?(detail.data?<><Result data={detail.data}/><RunActions key={selected} id={selected} status={detail.data.status} onChange={()=>{detail.reload();r.reload();}}/></>:<State error={detail.error} reload={detail.reload}/>):<p>选择左侧记录查看结果与依据。</p>}</Card></div></>;}
export function BackendMeasurements(){const r=useRead<Park>('/api/demo/park');const [id,setId]=useState('T-0001');if(!r.data)return <Card title="单树测量记录"><State error={r.error} reload={r.reload}/></Card>;const rows=r.data.modules.growth?.measurements.filter(m=>m.treeId===id)||[];return <Card title="单树测量记录"><select aria-label="查看单树测量" value={id} onChange={e=>setId(e.target.value)}>{r.data.trees.map(t=><option key={t.treeId} value={t.treeId}>{alias(t.treeId)}</option>)}</select><Chart values={rows.map(m=>m.circumferenceCm)} labels={rows.map(m=>m.observedAt.slice(0,10))} unit="树围 cm"/></Card>;}

export function BackendOverview({site='hainan',onWeather}:{site?:EnvironmentSite|null;onWeather:()=>void}){return <ParkWeather key={site??'all'} site={site} compact onWeather={onWeather}/>;}
