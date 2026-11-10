import {useEffect,useState} from 'react';
import {post,read,siteIdOf,useRead,type EnvironmentSite} from './client';
import {can,currentAccount} from '../workspace/identityModel';
import type {EudrReadiness as Readiness,EudrBatchReadiness,EudrExportPack,EudrShipment} from '../../../shared/eudr';
import './eudrReadiness.css';

const amount=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:2});
const date=(value:string)=>new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});

export function EudrReadiness({site='hainan'}:{site?:EnvironmentSite}) {
  const siteId=siteIdOf(site),account=currentAccount();
  const result=useRead<Readiness>(`/api/eudr/readiness?siteId=${siteId}`);
  const [batchId,setBatchId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [sourceBatchIds,setSourceBatchIds]=useState<string[]>([]);
  const data=result.data;
  const batch=data?.batches.find(item=>item.id===batchId)??data?.batches[0];
  const sourceBatches=data?.batches.filter(item=>sourceBatchIds.includes(item.id)&&item.status==='demo_prepared'&&item.remainingKg>0)??[];
  const sourceKg=Math.round(sourceBatches.reduce((sum,item)=>sum+item.remainingKg,0)*1000)/1000;
  const canPrepare=!account||can(account,'sales.write');
  useEffect(()=>{setBatchId('');setSourceBatchIds([]);setMessage('');setError('');},[siteId]);
  useEffect(()=>{
    const refresh=()=>result.reload();
    window.addEventListener('harness-sales-shipments-changed',refresh);
    return()=>window.removeEventListener('harness-sales-shipments-changed',refresh);
  },[siteId]);
  async function prepare() {
    if(!batch)return;
    setBusy(true);setError('');setMessage('');
    try {const updated=await post<EudrBatchReadiness>('/api/eudr/demo-prepare',{siteId,batchId:batch.id});setMessage(`${updated.title}：${updated.statusLabel}`);result.reload();}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function allocate(shipment:EudrShipment) {
    setBusy(true);setError('');setMessage('');
    try {const updated=await post<EudrShipment>('/api/eudr/allocate',{siteId,shipmentId:shipment.id,batchIds:sourceBatches.map(item=>item.id)});setMessage(`第 ${updated.day} 天出货 ${amount(updated.plannedKg)} 公斤：${updated.traceLabel}（${updated.allocation?.sourceZones.join('、')}区）`);result.reload();}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function release(shipment:EudrShipment) {
    setBusy(true);setError('');setMessage('');
    try {const updated=await post<EudrShipment>('/api/eudr/release',{siteId,shipmentId:shipment.id});setMessage(`第 ${updated.day} 天出货单已撤销来源批次，可重新指定。`);result.reload();}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function downloadShipment(shipment:EudrShipment) {
    setBusy(true);setError('');setMessage('');
    try {
      const pack=await read<unknown>(`/api/eudr/shipment-package?siteId=${siteId}&shipmentId=${encodeURIComponent(shipment.id)}`);
      const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`${siteId}-欧盟出货资料-${shipment.id}.json`;link.click();URL.revokeObjectURL(url);
      setMessage(`已导出第 ${shipment.day} 天出货单的来源资料。`);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function download() {
    if(!batch)return;
    setBusy(true);setError('');setMessage('');
    try {
      const pack=await read<EudrExportPack>(`/api/eudr/package?siteId=${siteId}&batchId=${encodeURIComponent(batch.id)}`);
      const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`${siteId}-欧盟客户演示资料-${batch.id}.json`;link.click();URL.revokeObjectURL(url);
      setMessage(`已导出${batch.title}的演示资料，包含当前缺项与来源说明。`);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <section id="eudr-readiness" className="hb-eudr" aria-label="欧盟客户资料">
    <header><div><h3>欧盟客户资料</h3></div><span className="hb-eudr-tag">演示资料</span></header>
    {result.error&&<p role="alert">资料读取失败：{result.error} <button type="button" onClick={result.reload}>重新读取</button></p>}
    {!data&&!result.error&&<p>正在读取加工批次和来源资料…</p>}
    {data&&<>
      <p className="hb-eudr-summary">{data.summary}</p>
      {batch?<>
        {data.batches.length>1?<label className="hb-eudr-batch">加工批次<select value={batch.id} onChange={event=>{setBatchId(event.target.value);setMessage('');setError('');}}>{data.batches.map(item=><option key={item.id} value={item.id}>{item.title} · {amount(item.dryKg)} 公斤干胶</option>)}</select></label>:<h4>{batch.title}</h4>}
        <div className="hb-eudr-batch-facts"><strong>{batch.statusLabel}</strong><span>{amount(batch.dryKg)} 公斤干胶</span><span>{batch.sourceZones.length?`${batch.sourceZones.join('、')}区来源`:'待关联生产地块'}</span></div>
        <p className="hb-eudr-next"><strong>下一步</strong>{batch.nextStep}</p>
        {batch.missing.length>0&&<p className="hb-eudr-missing">待补齐：{batch.missing.join('；')}。</p>}
        <div className="hb-eudr-actions">{canPrepare&&batch.status!=='demo_prepared'&&<button type="button" disabled={busy||batch.sourceZones.length===0||!batch.productionPeriod} onClick={prepare}>补齐本批模拟材料</button>}<button type="button" disabled={busy} onClick={download}>下载本批演示资料</button></div>
        {!canPrepare&&batch.status!=='demo_prepared'&&<p className="hb-eudr-note">本批模拟材料需由农场管理补齐。</p>}
        <details className="hb-eudr-details"><summary>资料核验 · {batch.checks.filter(check=>check.ok).length}/{batch.checks.length} 项已齐</summary><ul className="hb-eudr-checks" aria-label="本批资料核验">{batch.checks.map(check=><li key={check.key} className={check.ok?'is-ok':'is-missing'}><span>{check.ok?'✓':'○'}</span><strong>{check.label}</strong><small>{check.detail}</small></li>)}</ul></details>
      </>:<><p className="hb-eudr-next"><strong>下一步</strong>{data.nextStep}</p><a className="hb-eudr-task-link" href="#operations">到任务中心完成收胶与加工入库 →</a></>}
      {data.shipments.length>0&&<div className="hb-eudr-shipments"><h4>出货单来源（欧盟订单须在发车前指定）</h4>
        {canPrepare&&data.shipments.some(item=>item.traceStatus==='unallocated')&&data.batches.length>0&&<fieldset className="hb-eudr-source-batches"><legend>选择出货来源批次（可多选）</legend>
          {data.batches.map(item=><label key={item.id}><input type="checkbox" value={item.id} checked={sourceBatches.some(selected=>selected.id===item.id)} disabled={busy||item.status!=='demo_prepared'||item.remainingKg<=0} onChange={event=>setSourceBatchIds(ids=>event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/><span>{item.title} · 可用 {amount(item.remainingKg)} 公斤{item.status!=='demo_prepared'?' · 先补齐本批资料':''}</span></label>)}
          <p>已选 {sourceBatches.length} 个批次，可用合计 {amount(sourceKg)} 公斤。</p>
        </fieldset>}
        <ul>{data.shipments.map(item=><li key={item.id} className={`hb-eudr-ship-${item.traceStatus}`}>
          <div><strong>第 {item.day} 天 · {amount(item.plannedKg)} 公斤</strong><span>{item.traceLabel}{item.allocation?` · ${item.allocation.parts.map(part=>`${part.title} ${amount(part.kg)} 公斤`).join('；')}`:''}</span></div>
          {item.traceStatus==='unallocated'&&canPrepare&&batch&&<button type="button" disabled={busy||sourceBatches.length===0||sourceKg<item.plannedKg} title={sourceBatches.length===0?'请选择已整理资料的来源批次':sourceKg<item.plannedKg?`还需选择 ${amount(item.plannedKg-sourceKg)} 公斤来源批次`:''} onClick={()=>allocate(item)}>用所选批次</button>}
          {item.traceStatus==='traceable'&&<span className="hb-eudr-ship-actions"><button type="button" disabled={busy} onClick={()=>downloadShipment(item)}>下载出货资料</button>{item.status==='planned'&&canPrepare&&<button type="button" disabled={busy} onClick={()=>release(item)}>撤销指定</button>}</span>}
        </li>)}</ul>
        <p className="hb-eudr-note">未指定来源的出货单只走国内渠道。</p>
      </div>}
      <p className="hb-eudr-note">地块与证明为模拟资料，不表示已完成正式尽职调查声明。</p>
      <details className="hb-eudr-details"><summary>查看批次来源、缺项和 EUDR 依据</summary>
        {batch&&<>
          <dl><dt>产品</dt><dd>{batch.productName} · HS {batch.hsCode}</dd><dt>生产国家</dt><dd>{batch.countryOfProduction}</dd><dt>生产日期</dt><dd>{batch.productionPeriod?`${date(batch.productionPeriod.from)} 至 ${date(batch.productionPeriod.to)}`:'待补充'}</dd><dt>生产地块</dt><dd>{batch.plots.length} 个 · 地图坐标为模拟数据</dd><dt>供货方 / 客户</dt><dd>{batch.supplier?.name??'待补充'} / {batch.buyer?.name??'待补充'}</dd><dt>正式声明编号</dt><dd>尚未提交</dd></dl>
          <p>{batch.traceabilityNote}</p>
          <h4>客户尽职调查准备</h4><p>{batch.riskReview.summary}</p><ul>{batch.riskReview.actions.map(action=><li key={action}>{action}</li>)}</ul>
          {batch.plots.length>0&&<div className="hb-eudr-table"><table><thead><tr><th>来源地块</th><th>面积</th><th>边界资料</th></tr></thead><tbody>{batch.plots.map(plot=><tr key={plot.id}><td>{plot.name}</td><td>{amount(plot.areaHa)} 公顷</td><td>地块多边形（模拟）</td></tr>)}</tbody></table></div>}
          {batch.evidence.length>0&&<><h4>本批已整理的演示材料</h4><ul>{batch.evidence.map(item=><li key={item.id}><strong>{item.title} · 模拟</strong><p>{item.note}</p></li>)}</ul></>}
        </>}
        <h4>库存与出货来源</h4><p>{data.inventory.note}</p>
        <h4>需要准备哪些资料</h4><p>{data.rules.productScope}</p><p>{data.rules.role}</p><p>{data.rules.geolocation}</p><p>森林砍伐截止日期：{data.rules.cutoffDate}。</p>
        <ul>{data.rules.dates.map(item=><li key={`${item.role}-${item.date}`}>{item.role}：{item.date}</li>)}</ul>
        <h4>官方依据</h4><p>核对日期：{data.rules.checkedAt}</p><ul className="hb-eudr-sources">{data.rules.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li>)}</ul>
      </details>
    </>}
    {message&&<p className="hb-eudr-message" role="status">{message}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
