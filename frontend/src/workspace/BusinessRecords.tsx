import {useRead, siteIdOf} from '../integration/client';
import {batchStageLabels, type LatexBatch} from '../../../shared/logistics';
import {salesShipmentStatusLabels, type SalesInventory, type SalesShipment} from '../../../shared/salesShipments';
import {sites, type Site} from './model';
import {catalogTime} from './dataCatalog';

const quantity = (value: number) => value.toLocaleString('zh-CN', {maximumFractionDigits: 2});

export function BusinessRecords({site, onTasks}: {site: Site; onTasks?: () => void}) {
  const siteId = siteIdOf(site);
  const inventory = useRead<{inventory: SalesInventory}>(`/api/simulation/sales-inventory?siteId=${siteId}`);
  const batches = useRead<{items: LatexBatch[]}>(`/api/simulation/logistics-batches?siteId=${siteId}`);
  const shipments = useRead<{items: SalesShipment[]}>(`/api/simulation/sales-shipments?siteId=${siteId}`);
  const stock = inventory.data?.inventory;
  const reload = () => {inventory.reload(); batches.reload(); shipments.reload();};
  return <div className="dc-business">
    <section className="dc-intro"><div><h2>{sites[site]} · 库存与流转</h2><p>当前园区的模拟业务台账。称重、质检、运输和加工在任务中心办理。</p></div><div className="dc-actions"><button onClick={reload}>重新读取</button>{onTasks && <button onClick={onTasks}>到任务中心办理 →</button>}</div></section>
    <section className="dc-panel"><h2>干胶库存与销售</h2>
      {inventory.error && <p role="alert">库存读取失败：{inventory.error}</p>}
      {stock ? <><div className="dc-business-kpis">{[['在库',stock.stockKg],['可用',stock.availableKg],['冻结',stock.heldKg],['运输中',stock.inTransitKg],['累计签收销售',stock.soldKg]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{quantity(Number(value))}<small> 公斤干胶</small></strong></div>)}</div>
        <p>初始库存 {quantity(stock.openingStockKg)} + 加工入库 {quantity(stock.processedKg)} − 发车出库 {quantity(stock.dispatchedKg)} = 当前库存 {quantity(stock.stockKg)} 公斤干胶。</p>
        <p>累计销售额 {quantity(stock.salesRevenueCny)} 元 · 记录更新于 {catalogTime(stock.updatedAt)}。</p></> : !inventory.error && <p role="status">正在读取库存…</p>}
    </section>
    <section className="dc-panel"><h2>收胶与加工批次</h2><p>称重和到厂签收为鲜胶乳重量；完成加工后才计入干胶库存。</p>
      {batches.error && <p role="alert">批次读取失败：{batches.error}</p>}
      {!batches.data ? !batches.error && <p role="status">正在读取批次…</p> : !batches.data.items.length ? <p>当前园区尚未登记收胶批次。</p> : <div className="dc-table"><table><thead><tr><th>批次 / 来源任务</th><th>当前阶段</th><th>称重 / 签收</th><th>质检 / 加工</th><th>收胶时间</th></tr></thead><tbody>{batches.data.items.map(batch => {
        const inspection = batch.inspections.at(-1);
        return <tr key={batch.id}><td>{batch.id}<small>{batch.source.taskTitle}</small></td><td>{batchStageLabels[batch.stage]}{batch.manualHold && <small>手工暂停：{batch.manualHold.note}</small>}</td><td>{batch.weighing ? `净重 ${quantity(batch.weighing.netKg)} 公斤鲜胶乳` : '待称重'}<small>{batch.transport?.receipt ? `到厂 ${quantity(batch.transport.receipt.receivedKg)} 公斤鲜胶乳` : '尚未到厂签收'}</small></td><td>{inspection ? `干胶含量 ${quantity(inspection.dryRubberPercent)}% · ${inspection.decision === 'pass' ? '通过' : '待复检'}${inspection.grade ? ` · ${inspection.grade} 级（演示）` : ''}` : '待质检'}<small>{batch.processing ? `入库 ${quantity(batch.processing.dryKg)} 公斤干胶${batch.processing.processLossKg ? ` · 损耗 ${quantity(batch.processing.processLossKg)} 公斤干胶` : ''}` : '尚未加工入库'}</small></td><td>{catalogTime(batch.collection.at)}</td></tr>;
      })}</tbody></table></div>}
    </section>
    <section className="dc-panel"><h2>销售出货记录</h2>
      {shipments.error && <p role="alert">出货记录读取失败：{shipments.error}</p>}
      {!shipments.data ? !shipments.error && <p role="status">正在读取出货记录…</p> : !shipments.data.items.length ? <p>当前园区尚未安排销售出货。</p> : <div className="dc-table"><table><thead><tr><th>出货单 / 买方</th><th>状态</th><th>计划 / 签收重量</th><th>计划发车</th><th>签收销售额</th></tr></thead><tbody>{shipments.data.items.map(shipment => <tr key={shipment.id}><td>{shipment.id}<small>{shipment.buyer.name}</small></td><td>{salesShipmentStatusLabels[shipment.status]}</td><td>{quantity(shipment.plannedKg)} 公斤干胶<small>{shipment.receipt ? `签收 ${quantity(shipment.receipt.receivedKg)} 公斤干胶` : '尚未签收'}</small></td><td>{catalogTime(shipment.plannedDepartureAt)}</td><td>{shipment.receipt ? `${quantity(shipment.receipt.revenueCny)} 元` : '—'}</td></tr>)}</tbody></table></div>}
    </section>
    <details className="dc-panel"><summary>独立企业样例 · 库存、加工与运输</summary><EnterpriseExample/></details>
  </div>;
}

type ExampleInventory = {totals: {onHandKg: number; reservedKg: number; availableKg: number; heldKg: number}; items: {batchId: string; warehouseId: string; onHandKg: number; reservedKg: number; availableKg: number; heldKg: number}[]};
type ExampleProcessing = {batches: {batchId: string; quantityKg: number; stage: string; qualityStatus: string}[]};
type ExampleTransport = {shipments: {shipmentId: string; batchId: string; quantityKg: number; status: string; plannedArrivalAt: string; estimatedArrivalAt: string; delayReason: string}[]};
type BusinessSample = {asOf: string; records: {topic: string; content: string}[]};
function sampleTopic<T>(data: BusinessSample, topic: string): T | undefined {
  const record = data.records.find(record => record.topic === topic);
  if (!record) return undefined;
  try {return JSON.parse(record.content) as T;} catch {return undefined;}
}
function EnterpriseExample() {
  const sample = useRead<BusinessSample>('/api/demo/business-data');
  if (!sample.data) return <p role="status">{sample.error || '正在读取企业样例…'}</p>;
  const inventory = sampleTopic<ExampleInventory>(sample.data, 'inventory');
  const processing = sampleTopic<ExampleProcessing>(sample.data, 'processing');
  const transport = sampleTopic<ExampleTransport>(sample.data, 'transport');
  return <div className="dc-enterprise-example"><p>虚构演示企业，与所选园区无对应关系；下列数量不计入上方园区库存。样例时间：{catalogTime(sample.data.asOf)}。</p>
    {inventory && <><h3>企业库存样例 · 公斤干胶</h3><p>在库 {quantity(inventory.totals.onHandKg)}，可用 {quantity(inventory.totals.availableKg)}，已预留 {quantity(inventory.totals.reservedKg)}，质检冻结 {quantity(inventory.totals.heldKg)}。</p><div className="dc-table"><table><thead><tr><th>批次 / 仓库</th><th>在库</th><th>可用</th><th>预留</th><th>冻结</th></tr></thead><tbody>{inventory.items.map(item => <tr key={item.batchId}><td>{item.batchId}<small>{item.warehouseId}</small></td><td>{quantity(item.onHandKg)}</td><td>{quantity(item.availableKg)}</td><td>{quantity(item.reservedKg)}</td><td>{quantity(item.heldKg)}</td></tr>)}</tbody></table></div></>}
    {processing && <><h3>加工与质检样例</h3><div className="dc-table"><table><thead><tr><th>批次</th><th>干胶数量</th><th>阶段</th></tr></thead><tbody>{processing.batches.map(batch => <tr key={batch.batchId}><td>{batch.batchId}</td><td>{quantity(batch.quantityKg)} 公斤</td><td>{({finished:'已加工',quality_hold:'质检待复核',drying:'加工中'} as Record<string,string>)[batch.stage] || batch.stage}</td></tr>)}</tbody></table></div></>}
    {transport && <><h3>在途与交付样例</h3>{transport.shipments.map(shipment => <article key={shipment.shipmentId}><strong>{shipment.batchId} · {quantity(shipment.quantityKg)} 公斤干胶</strong><p>原定 {catalogTime(shipment.plannedArrivalAt)} → 预计 {catalogTime(shipment.estimatedArrivalAt)}</p><p>{shipment.delayReason}</p></article>)}</>}
  </div>;
}
