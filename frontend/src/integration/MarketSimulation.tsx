import {useEffect,useState} from 'react';
import {post,useRead,siteIdOf,type EnvironmentSite} from './client';
import {Card,Chart} from './Views';
import {CommodityReference} from './CommodityReference';
import {EconomicFactors,type EconomicImpact,type EconomicScenarioId} from './EconomicFactors';
import {EudrReadiness} from './EudrReadiness';
import {hasNewStrategy} from './strategyRefreshState';
import type {SalesInventory,SalesShipment} from '../../../shared/salesShipments';
import './marketResult.css';

type Exclusion={reason:string;count:number};
type ProductionPlan={tasks:unknown[];reason?:string;eligibleTrees?:number;excludedTrees?:number;exclusions?:Exclusion[];alreadyCreated?:boolean};
type SalesScenario={id:string;name:string;schedule:string;producedKg:number;soldKg:number;endingStockKg:number;endingAvailableKg:number;revenueCny:number;productionCostCny:number;transportCostCny:number;holdingCostCny:number;cashContributionCny:number;endingInventoryValueCny:number;comparisonValueCny:number;overflowKg:number;feasible:boolean;daily:{day:number;at:string;incomingKg:number;soldKg:number;stockKg:number;priceCnyPerKg:number}[]};
type SalesPlan={modelId:string;scenarioId:string;adoptedAt:string;mode:'simulation';scenario:SalesScenario;shipments:SalesShipment[];inventory:SalesInventory};
type Model={id:string;generatedAt:string;economicScenarioId?:EconomicScenarioId;economicImpact?:EconomicImpact;params:{storageKg:number;stockKg:number;heldKg:number;transportKgPerDay:number;demandIndex:number;demandBaseline:number;treeCount:number;dryKgPerTapping:number;costPerTapping:number;careLimit:number};recommendedFrequency:number|null;demand:{value:number;baselineValue:number;unit:string;band:string;provenanceMode:string};eligibleTreeCount:number;excludedTreeCount:number;exclusions:Exclusion[];policyReasons:string[];limitation:string;forecast:{at:string;value:number}[];scenarios:{frequency:number;produced:number;endingStock:number;feasible:boolean;contribution:number}[];sales?:{productionFrequencyPerWeek:number;scenarios:SalesScenario[];recommendedScenarioId:string|null;recommendationReason:string;basis:string[]}|null};
type SavedMarket={model:Model|null;plan:ProductionPlan|null;salesPlan?:SalesPlan|null};
const n=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:2});
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

export function MarketSimulation({site='hainan',modelId,onLatest,onProductionPlan}:{site?:EnvironmentSite;modelId?:string|null;onLatest?:()=>void;onProductionPlan?:()=>void}){
 const siteId=siteIdOf(site);
 const saved=useRead<SavedMarket|Model>(modelId?`/api/simulation/market/${encodeURIComponent(modelId)}?siteId=${siteId}`:`/api/simulation/market/latest?siteId=${siteId}`,{pollMs:30000});
 const latestSaved=useRead<SavedMarket>(modelId?`/api/simulation/market/latest?siteId=${siteId}`:null,{pollMs:30000});
 const [capacity,setCapacity]=useState(900),[transport,setTransport]=useState(40),[demand,setDemand]=useState(105);
 const [data,setData]=useState<Model>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 const [planMessage,setPlanMessage]=useState(''),[exclusions,setExclusions]=useState<Exclusion[]>([]);
 const [salesChoice,setSalesChoice]=useState(''),[salesPlan,setSalesPlan]=useState<SalesPlan|null>(null);
 const [economicScenarioId,setEconomicScenarioId]=useState<EconomicScenarioId>('baseline');
 const savedSales=useRead<{salesPlan:SalesPlan|null}>(data?`/api/simulation/market-sales-plan?siteId=${siteId}&modelId=${encodeURIComponent(data.id)}`:null);
 const currentInventory=useRead<{inventory:SalesInventory}>(`/api/simulation/sales-inventory?siteId=${siteId}`);
 const inventory=currentInventory.data?.inventory;
 const incoming=saved.data?('model' in saved.data?saved.data:{model:saved.data,plan:null,salesPlan:null}):null;
 const newest=modelId?latestSaved.data:incoming;
 const hasUpdate=hasNewStrategy(data?.id,newest?.model?.id,data?.generatedAt,newest?.model?.generatedAt);
 function loadSaved(result:SavedMarket){
  if(!result.model)return;
  const model=result.model;setData(model);setCapacity(model.params.storageKg);setTransport(model.params.transportKgPerDay);setDemand(model.params.demandIndex);setEconomicScenarioId(model.economicScenarioId??'baseline');
  setSalesPlan(result.salesPlan??null);setSalesChoice(result.salesPlan?.scenarioId??model.sales?.recommendedScenarioId??'');setDirty(false);
  setPlanMessage(result.plan?.reason||(result.plan?'已保存安排 · '+result.plan.tasks.length+' 个分区任务':''));setExclusions(result.plan?.exclusions||[]);
 }
 useEffect(()=>{
  const refresh=()=>currentInventory.reload();
  window.addEventListener('harness-sales-shipments-changed',refresh);
  return()=>window.removeEventListener('harness-sales-shipments-changed',refresh);
 },[siteId]);
 useEffect(()=>{
  if(incoming?.model&&!data)loadSaved(incoming);
 },[saved.data,data]);
 useEffect(()=>{
  if(!savedSales.data)return;
  setSalesPlan(savedSales.data.salesPlan);
  if(savedSales.data.salesPlan)setSalesChoice(savedSales.data.salesPlan.scenarioId);
 },[savedSales.data]);
 const calculate=async()=>{
  setBusy(true);setError('');
  try{
   // Keep the saved production assumptions when editing one visible condition.
   // Inventory is intentionally omitted so the server reads the current ledger.
   const {stockKg:_stockKg,heldKg:_heldKg,...savedParams}=data?.params??{};
   const model=await post<Model>('/api/simulation/market',{...savedParams,siteId,storageKg:capacity,transportKgPerDay:transport,demandIndex:demand,economicScenarioId});
   setData(model);setDirty(false);setPlanMessage('');setExclusions([]);setSalesPlan(null);setSalesChoice(model.sales?.recommendedScenarioId??'');currentInventory.reload();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const adoptSales=async()=>{
  if(!data)return;setBusy(true);setError('');
  try{
   setSalesPlan(await post<SalesPlan>('/api/simulation/market-sales-plan',{siteId,modelId:data.id,scenarioId:salesChoice}));
   savedSales.reload();window.dispatchEvent(new Event('harness-sales-shipments-changed'));
  }
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const selected=data?.sales?.scenarios.find(s=>s.id===salesChoice);
 const adoptedSales=Boolean(selected&&salesPlan?.scenarioId===selected.id);
 const shipments=salesPlan?.shipments.filter(shipment=>shipment.status!=='cancelled')??[];
 const shipmentKg=shipments.reduce((sum,shipment)=>sum+shipment.plannedKg,0);
 const receivedKg=shipments.reduce((sum,shipment)=>sum+(shipment.receipt?.receivedKg??0),0);
 const openShipments=()=>{
  const next=shipments.find(shipment=>shipment.status==='planned'||shipment.status==='in-transit')??shipments[0];
  window.dispatchEvent(new CustomEvent('harness-open-sales-shipments',{detail:{site,id:next?.id}}));
 };
 const firstSale=selected?.daily.find(day=>day.soldKg>0);
 const risingPrice=selected&&selected.daily.length>1&&selected.daily.at(-1)!.priceCnyPerKg>selected.daily[0].priceCnyPerKg;
 const salesReason=selected&&!selected.feasible?'按当前出货节奏，库存会超过仓容，需要先调整安排。'
  :selected?.soldKg===0?'当前条件下，本周期没有可安排的出货量。'
  :selected?.id==='hold_short'?(risingPrice?'模拟报价后段较高，仓容也能容纳暂存，可以晚几天卖；回款会相应推迟。':'先暂存再集中出货，回款也会推迟，需要接受后续报价变化。')
  :selected?.id==='sell_phased'?'先卖一部分回款，再增加出货，兼顾回款和仓储空间。'
  :'尽早回款，持续腾出仓储空间，减少库存占用。';
 const firstShipment=firstSale?`${new Date(firstSale.at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric'})}首批 ${n(firstSale.soldKg)} 公斤干胶`:'';
 const salesNextStep=adoptedSales?(shipments.length&&shipments.every(shipment=>shipment.status==='received')?`本方案 ${shipments.length} 批出货已完成，已回传签收 ${n(receivedKg)} 公斤干胶，可查看逐批结果。`:`已生成 ${shipments.length} 个模拟出货任务，前往任务中心演示发车、签收与结果回传。`)
  :dirty?'先按修改后的条件重新计算，再采纳销售安排。'
  :selected&&!selected.feasible?'展开“调整测算条件”修改仓容或运力，重新计算后选择销售安排。'
  :!firstSale?'展开“调整测算条件”，核对库存和运力后重新计算。'
  :`采纳此方案后，将生成${firstShipment}及后续的模拟出货任务。`;
 return <Card title="生产与销售建议">
  {hasUpdate&&<p className="hb-market-pending" role="status">后台已有新的经营方案。{dirty?'当前未保存的条件仍保留。':'当前选择与已采用的出货安排仍保留。'} <button type="button" disabled={busy} onClick={()=>{if(newest)loadSaved(newest);}}>{dirty?'放弃未保存条件并查看新方案':'查看最新经营方案'}</button></p>}
  {modelId&&<p className="hb-result-meta">{data&&data.id!==modelId?'正在查看更新后的经营方案':'查看对话中保存的经营方案'} {onLatest&&<button onClick={onLatest}>查看最新方案</button>}</p>}
  {!data&&!saved.error&&<p className="hb-muted">{modelId?'正在读取这轮对话保存的方案…':'设置仓容和运力，生成未来 7 日的生产与销售建议。'}</p>}
  {saved.error&&<p role="alert">方案读取失败：{saved.error} <button onClick={saved.reload}>重新读取</button></p>}
  {savedSales.error&&<p role="alert">出货进度读取失败：{savedSales.error} <button onClick={savedSales.reload}>重新读取出货进度</button></p>}
  {currentInventory.error&&<p role="alert">库存读取失败：{currentInventory.error} <button onClick={currentInventory.reload}>重新读取库存</button></p>}
  {error&&<p role="status">{error}</p>}
  {dirty&&<p className="hb-market-pending" role="status">参数已改变，请重新计算后采用建议。</p>}
  {inventory&&<section className="hb-market-inventory" aria-label="园区最新库存与销售">
   <header><strong>园区当前经营情况</strong><span>模拟生产与销售回传 · 更新于 {time(inventory.updatedAt)}</span></header>
   <dl>
    <div><dt>仓内库存</dt><dd>{n(inventory.stockKg)}<small>公斤干胶</small></dd></div>
    <div><dt>可用库存</dt><dd>{n(inventory.availableKg)}<small>公斤干胶</small></dd></div>
    <div><dt>正在运输</dt><dd>{n(inventory.inTransitKg)}<small>公斤干胶</small></dd></div>
    <div><dt>累计已销售</dt><dd>{n(inventory.soldKg)}<small>公斤干胶</small></dd></div>
   </dl>
   <details className="hb-result-details"><summary>库存变动与销售金额</summary><p>累计加工入库 {n(inventory.processedKg)} 公斤干胶 · {inventory.processedBatches} 批。加工入库、发车出库、签收计入销量；重新计算使用当前库存。</p><p>演示初始库存 {n(inventory.openingStockKg)} 公斤 + 加工入库 {n(inventory.processedKg)} 公斤 − 累计出库 {n(inventory.dispatchedKg)} 公斤 = 当前库存 {n(inventory.stockKg)} 公斤；其中冻结 {n(inventory.heldKg)} 公斤。</p><p>累计销售额 {n(inventory.salesRevenueCny)} 元（模拟签收回传）。</p></details>
  </section>}
  {data&&<>
   <p className="hb-result-meta">原方案预测 · 未来 7 日 · 保存于 {time(data.generatedAt)} · 下方预估保留生成时的测算条件</p>
   {data.sales?<section aria-label="销售与囤货方案比较">
    {selected&&<div className="hb-market-sales-result">
     <div className="hb-market-sales-heading">
      <div><span className="hb-result-eyebrow">{selected.id===data.sales.recommendedScenarioId?'推荐销售方案':'当前所选方案'} · {selected.name}</span><h3>{selected.soldKg>0?selected.schedule:'本周期暂不出货'}</h3></div>
      <div className="hb-market-volume"><span>原方案未来 7 天预计卖出</span><strong>{n(selected.soldKg)} <small>公斤干胶</small></strong></div>
     </div>
     <div className="hb-market-reason"><span className="hb-result-eyebrow">{selected.id===data.sales.recommendedScenarioId?'推荐原因':'这项安排的取舍'}</span><p>{salesReason}</p></div>
     <div className="hb-market-next-step"><div><span className="hb-result-eyebrow">下一步</span><p>{salesNextStep}</p></div><button disabled={busy||(!adoptedSales&&(dirty||!selected.feasible))} onClick={adoptedSales?openShipments:adoptSales}>{adoptedSales?'查看出货任务':'采纳销售方案'}</button></div>
     {!selected.feasible&&<p className="hb-market-pending">最高超过仓容 {n(selected.overflowKg)} 公斤，需调整条件。</p>}
    </div>}
    {!selected&&<div className="hb-market-sales-result"><span className="hb-result-eyebrow">销售建议</span><h3>当前条件下暂无可采用方案</h3><p>{data.sales.recommendationReason}</p></div>}
    {salesPlan&&<p className="hb-market-saved" role="status"><strong>已采纳：{salesPlan.scenario.name}</strong> · {shipments.length} 个模拟出货任务 · 计划出货 {n(shipmentKg)} 公斤干胶 · 已签收 {n(receivedKg)} 公斤干胶{!adoptedSales&&<> <button onClick={openShipments}>查看已采纳方案的出货任务</button></>}</p>}
    <details className="hb-result-details"><summary>比较与更换销售方案 · {data.sales.scenarios.length} 个</summary>
     <div className="hb-market-options">{data.sales.scenarios.map(s=><label key={s.id} className={salesChoice===s.id?'selected':''}><input type="radio" name="market-sales-scenario" value={s.id} checked={salesChoice===s.id} onChange={()=>setSalesChoice(s.id)}/><span><strong>{s.name}</strong>{s.id===data.sales?.recommendedScenarioId&&<small>推荐</small>}<span>{s.schedule}</span><span>7 天预计卖出 {n(s.soldKg)} 公斤干胶</span><span>{s.feasible?'仓容和运力可满足':`超过仓容 ${n(s.overflowKg)} 公斤`}</span></span></label>)}</div>
    </details>
    <details className="hb-result-details"><summary>查看计算指标与每日明细</summary>
     <div style={{overflowX:'auto'}}><table><caption>完整经济指标</caption><thead><tr><th>方案</th><th>销售 kg</th><th>销售收入 元</th><th>运输 / 持有成本 元</th><th>现金贡献 元</th><th>期末总库存 / 可售 kg</th><th>库存估值 元</th><th>比较值 元</th></tr></thead><tbody>{data.sales.scenarios.map(s=><tr key={s.id} aria-selected={salesChoice===s.id}><td>{s.name}</td><td>{n(s.soldKg)}</td><td>{n(s.revenueCny)}</td><td>{n(s.transportCostCny)} / {n(s.holdingCostCny)}</td><td>{n(s.cashContributionCny)}</td><td>{n(s.endingStockKg)} / {n(s.endingAvailableKg)}</td><td>{n(s.endingInventoryValueCny)}</td><td>{n(s.comparisonValueCny)}</td></tr>)}</tbody></table></div>
     {selected&&<><h4>所选方案每日出货与库存</h4><p>本期生产成本 {n(selected.productionCostCny)} 元；期末总库存 {n(selected.endingStockKg)} 公斤，其中可售 {n(selected.endingAvailableKg)} 公斤、冻结 {n(data.params.heldKg)} 公斤。</p><div style={{overflowX:'auto'}}><table><thead><tr><th>日期</th><th>新增 kg</th><th>销售 / 发运 kg</th><th>日末库存 kg</th><th>模拟售价 元/kg</th></tr></thead><tbody>{selected.daily.map(day=><tr key={day.day}><td>第 {day.day} 天 · {new Date(day.at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'})}</td><td>{n(day.incomingKg)}</td><td>{n(day.soldKg)}</td><td>{n(day.stockKg)}</td><td>{n(day.priceCnyPerKg)}</td></tr>)}</tbody></table></div></>}
     <h4>系统推荐依据与模拟假设</h4><p>{data.sales.recommendationReason}</p><p>同一生产情景：每周 {data.sales.productionFrequencyPerWeek} 次；期初库存 {n(data.params.stockKg)} kg，其中 {n(data.params.heldKg)} kg 质检冻结。</p><ul>{data.sales.basis.map(item=><li key={item}>{item}</li>)}</ul>
    </details>
   </section>:<p>这份旧情景未包含销售方案，重新计算即可比较销售与囤货。</p>}
   <CommodityReference site={site} compact/>
   <section className="hb-market-production" aria-label="销售测算的生产假设">
    <div><span className="hb-result-eyebrow">销售测算的生产假设</span><h3>{data.recommendedFrequency===null?'暂无可行生产假设':data.recommendedFrequency===0?'假设本周休割':<>假设每周采割 <strong>{data.recommendedFrequency}</strong> 次</>}</h3><p>{data.eligibleTreeCount} 棵纳入测算{data.excludedTreeCount>0?`，${data.excludedTreeCount} 棵暂不纳入`:''}</p><p>这里按模拟需求、价格和现场条件估算新增产量，尚未读取全园方案。实际割次与日期请在全园割胶策略中确认。</p></div>
    {onProductionPlan&&<button onClick={onProductionPlan}>查看全园割胶策略</button>}
   </section>
   {planMessage&&<p role="status">{planMessage} <a href="#operations">查看作业队列 →</a> <button onClick={()=>window.dispatchEvent(new Event('harness-open-reviews'))}>处理未安排对象</button></p>}
   {exclusions.length>0&&<details><summary>查看未安排原因</summary><ul>{exclusions.map(item=><li key={item.reason}>{item.reason}：{item.count} 棵</li>)}</ul></details>}
   <details className="hb-result-details"><summary>生产范围与测算依据</summary>
    <p>需求信号：{({low:'偏低',balanced:'平衡',high:'偏高',unknown:'未知'} as Record<string,string>)[data.demand.band]}（{data.demand.value}/{data.demand.baselineValue}）。{data.policyReasons.join('；')}</p>
    {data.exclusions.length>0&&<ul>{data.exclusions.map(item=><li key={item.reason}>{item.reason}：{item.count} 棵</li>)}</ul>}
    <Chart values={data.forecast.map(p=>p.value)} labels={data.forecast.map(p=>p.at.slice(5,10))} unit="模拟预测 · 元/kg 干胶"/>
    <table><thead><tr><th>每周割次</th><th>新增干胶 kg</th><th>期末库存 kg</th><th>约束</th><th>建议</th></tr></thead><tbody>{data.scenarios.map(s=><tr key={s.frequency}><td>{s.frequency}</td><td>{n(s.produced)}</td><td>{n(s.endingStock)}</td><td>{s.feasible?'可行':'超过约束'}</td><td>{s.frequency===data.recommendedFrequency?'推荐比较':'—'}</td></tr>)}</tbody></table>
    <p>14 日模拟报价线性外推；需求指数与价格共同决定频次，健康、休割、缺树围对象不纳入。本次每树每次 {data.params.dryKgPerTapping} kg 干胶、作业成本 {data.params.costPerTapping} 元、每周最多 {data.params.careLimit} 次；实际作业统一以生产计划中已采用的方案为准。</p><p>{data.limitation}</p><p className="hb-muted">情景编号：{data.id}</p>
   </details>
  </>}
  {!data&&<CommodityReference site={site} compact/>}
  <EconomicFactors value={economicScenarioId} onChange={value=>{setEconomicScenarioId(value);setDirty(true);}} onCalculate={calculate} busy={busy} impact={data?.economicImpact} siteId={siteId}/>
  <EudrReadiness site={site}/>
  <details className="hb-result-details hb-market-inputs" open={!data}>
   <summary>{data?'调整测算条件':'测算条件'}</summary>
   <div className="hb-market-fields">
    <label>仓容（kg 干胶）<input type="number" min="800" max="100000" value={capacity} onChange={e=>{setCapacity(+e.target.value);setDirty(true);}}/></label>
    <label>每日运力（kg 干胶）<input type="number" min="0" max="100000" value={transport} onChange={e=>{setTransport(+e.target.value);setDirty(true);}}/></label>
    <label>需求指数<input type="number" min="0" max="200" value={demand} onChange={e=>{setDemand(+e.target.value);setDirty(true);}}/></label>
    <button disabled={busy} onClick={calculate}>{busy?'处理中…':data?'重新计算并保存':'计算并保存'}</button>
   </div>
  </details>
 </Card>;
}
