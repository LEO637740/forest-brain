import {useEffect, useState} from 'react';
import {ArrowRight, CheckCircle2, Truck} from 'lucide-react';
import {salesShipmentStatusLabels, type SalesInventory, type SalesShipment} from '../../../shared/salesShipments';
import {sites, type Site} from './model';
import {can, currentAccount} from './identityModel';
import './salesShipments.css';

export type SalesShipmentPanelProps = {
  site: Site;
  shipments: SalesShipment[];
  inventory?: SalesInventory | null;
  selectedId?: string | null;
  onAdvance: (id: string) => Promise<void>;
  onSource: (modelId: string) => void;
};

const shipmentNumber = (value: number) => value.toLocaleString('zh-CN', {maximumFractionDigits: 2});
const shipmentDate = (value: string) => new Date(value).toLocaleDateString('zh-CN', {timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric'});
const shipmentTime = (value: string) => new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});

export function SalesShipmentPanel({site, shipments, inventory, selectedId, onAdvance, onSource}: SalesShipmentPanelProps) {
  const account = currentAccount(), canManage = !account || can(account, 'sales.write');
  const [choice, setChoice] = useState(selectedId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {setChoice(selectedId ?? ''); setError('');}, [site, selectedId]);
  const rows = shipments.filter(shipment => shipment.siteId === `demo-${site}`);
  const active = rows.filter(shipment => shipment.status !== 'cancelled');
  const selected = rows.find(shipment => shipment.id === choice) ?? active[0] ?? rows[0];
  const planKg = active.reduce((sum, shipment) => sum + shipment.plannedKg, 0);
  const stage = selected ? ['planned', 'in-transit', 'received'].indexOf(selected.status) : -1;

  async function advance(shipment: SalesShipment) {
    setError(''); setBusy(true);
    try {await onAdvance(shipment.id);}
    catch (failure) {setError((failure as Error).message);}
    finally {setBusy(false);}
  }

  return <section className="op-sales-shipments" aria-label="销售出货任务">
    <header className="op-sales-heading">
      <div><Truck size={23}/><div><h2>销售出货</h2><p>{sites[site]} · 按销售方案跟进出货与签收。</p></div></div>
      <span>模拟执行 · 干胶</span>
    </header>
    {inventory&&<>
      <dl className="op-sales-totals" aria-label="园区库存与销售">
        <div><dt>仓内库存</dt><dd>{shipmentNumber(inventory.stockKg)}<small>公斤干胶</small></dd></div>
        <div><dt>可用库存</dt><dd>{shipmentNumber(inventory.availableKg)}<small>公斤干胶</small></dd></div>
        <div><dt>正在运输</dt><dd>{shipmentNumber(inventory.inTransitKg)}<small>公斤干胶</small></dd></div>
        <div><dt>累计已销售</dt><dd>{shipmentNumber(inventory.soldKg)}<small>公斤干胶</small></dd></div>
      </dl>
      <details className="op-sales-records op-sales-inventory-details">
        <summary>查看库存变动与销售金额</summary>
        <p>累计加工入库 {shipmentNumber(inventory.processedKg)} 公斤干胶 · {inventory.processedBatches} 批。发车扣减库存，签收计入销售量。</p>
        <p>演示初始库存 {shipmentNumber(inventory.openingStockKg)} 公斤 + 加工入库 {shipmentNumber(inventory.processedKg)} 公斤 − 累计出库 {shipmentNumber(inventory.dispatchedKg)} 公斤 = 当前库存 {shipmentNumber(inventory.stockKg)} 公斤；其中冻结 {shipmentNumber(inventory.heldKg)} 公斤。</p>
        <p>累计销售额 {shipmentNumber(inventory.salesRevenueCny)} 元（模拟） · 更新于 {shipmentTime(inventory.updatedAt)}（北京时间）</p>
      </details>
    </>}
    <p className="op-sales-batch-summary">本页计划出货 {shipmentNumber(planKg)} 公斤干胶 · {active.filter(shipment => shipment.status === 'planned').length} 批待出货 · {active.filter(shipment => shipment.status === 'in-transit').length} 批运输中 · {active.filter(shipment => shipment.status === 'received').length} 批已签收</p>
    {rows.length && selected ? <div className="op-sales-layout">
      <nav className="op-sales-list" aria-label="选择销售出货任务">
        {rows.map(shipment => <button key={shipment.id} type="button" aria-pressed={shipment.id === selected.id} onClick={() => {setChoice(shipment.id); setError('');}}>
          <span><strong>{shipmentDate(shipment.plannedDepartureAt)}</strong><b>{shipmentNumber(shipment.plannedKg)} 公斤干胶</b></span>
          <small>{shipment.scenarioName} · 第 {shipment.day} 天</small>
          <em className={`op-sales-state ${shipment.status}`}>{salesShipmentStatusLabels[shipment.status]}</em>
        </button>)}
      </nav>
      <article className="op-sales-detail" aria-label="当前出货任务">
        <header><div><p>来源方案 · {selected.scenarioName}</p><h3>{shipmentDate(selected.plannedDepartureAt)}出货 {shipmentNumber(selected.plannedKg)} 公斤干胶</h3></div><span className={`op-sales-state ${selected.status}`}>{salesShipmentStatusLabels[selected.status]}</span></header>
        <p className="op-sales-route">接货方：{selected.buyer.name}</p>
        {selected.status !== 'cancelled' && <>
          <ol className="op-sales-steps" aria-label="出货执行阶段">{['待出货', '运输中', '已签收并回传'].map((label, index) => <li key={label} className={index < stage ? 'complete' : index === stage ? 'current' : ''} aria-current={index === stage ? 'step' : undefined}>{label}</li>)}</ol>
          <div className="op-sales-progress" role="progressbar" aria-label="出货执行进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage * 50}><span style={{width: `${stage * 50}%`}}/><strong>{stage * 50}%</strong></div>
        </>}
        {(selected.status === 'planned' || selected.status === 'in-transit') && <div className="op-sales-next">
          <div><strong>下一步</strong><p>{canManage ? selected.status === 'planned' ? `发运 ${shipmentNumber(selected.plannedKg)} 公斤干胶，并扣减库存。` : '确认签收，计入已销售量。' : '由园区管理办理发车与签收；当前身份可查看进度和回传。'}</p></div>
          {canManage && <button type="button" className="op-sales-primary" disabled={busy} onClick={() => void advance(selected)}>{busy ? '正在保存…' : selected.status === 'planned' ? '模拟发车' : '模拟签收并回传'}</button>}
        </div>}
        {selected.status === 'cancelled' && <p className="op-sales-route">此批已被新方案替换。</p>}
        {selected.receipt && <section className="op-sales-result" aria-label="销售出货回传结果">
          <h4><CheckCircle2 size={17}/>签收结果已回传</h4>
          <strong>{shipmentNumber(selected.receipt.receivedKg)} 公斤干胶已签收</strong>
          <p>{selected.buyer.name} · {shipmentTime(selected.receipt.at)}（北京时间）<br/>{selected.receipt.note}</p>
          <p>已计入园区销售量。</p>
        </section>}
        {error && <p className="op-sales-error" role="alert">{error}</p>}
        <button type="button" className="op-sales-source" onClick={() => onSource(selected.modelId)}>查看来源销售方案<ArrowRight size={13}/></button>
        <details className="op-sales-records">
          <summary>查看执行记录与计算详情</summary>
          <p>可提前演示未来批次的发车与签收。</p>
          <dl>
            <div><dt>任务编号</dt><dd>{selected.id}</dd></div>
            <div><dt>经营方案</dt><dd>{selected.modelId}</dd></div>
            <div><dt>销售方案</dt><dd>{selected.scenarioId}</dd></div>
            <div><dt>计划时间</dt><dd>{shipmentTime(selected.plannedDepartureAt)}（北京时间）</dd></div>
            <div><dt>模拟单价</dt><dd>{shipmentNumber(selected.priceCnyPerKg)} 元 / 公斤干胶</dd></div>
            <div><dt>预计销售额</dt><dd>{shipmentNumber(selected.plannedRevenueCny)} 元</dd></div>
            {selected.receipt && <><div><dt>签收单价</dt><dd>{shipmentNumber(selected.receipt.priceCnyPerKg)} 元 / 公斤干胶</dd></div><div><dt>回传销售额</dt><dd>{shipmentNumber(selected.receipt.revenueCny)} 元（模拟）</dd></div></>}
          </dl>
          <ol>
            <li><strong>采纳方案，生成出货任务</strong>{shipmentTime(selected.createdAt)}（北京时间）<p>{selected.scenarioName} · 第 {selected.day} 天计划出货 {shipmentNumber(selected.plannedKg)} 公斤干胶。</p></li>
            {selected.departureAt && <li><strong>模拟发车</strong>{shipmentTime(selected.departureAt)}（北京时间）<p>按本批计划发运 {shipmentNumber(selected.plannedKg)} 公斤干胶。</p></li>}
            {selected.receipt && <li><strong>模拟签收并回传</strong>{shipmentTime(selected.receipt.at)}（北京时间）<p>{selected.receipt.note}</p></li>}
            {selected.cancelledAt && <li><strong>出货任务已被新方案替换</strong>{shipmentTime(selected.cancelledAt)}（北京时间）</li>}
          </ol>
        </details>
      </article>
    </div> : <div className="op-sales-empty"><strong>当前园区还没有销售出货任务</strong><p>在经营方案中采纳销售方案，即可生成出货任务。</p></div>}
  </section>;
}
