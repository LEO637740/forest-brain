import type {SalesInventory} from '../../../shared/salesShipments';
import {sites,type Site} from './model';
import {catalogTime} from './dataCatalog';

type Props = {
  site:Site|null;
  inventory:SalesInventory|null;
  error?:string;
  onRefresh:()=>void;
  onData?:()=>void;
};
const quantity=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:2});

export function MapInventorySummary({site,inventory,error,onRefresh,onData}:Props){
  const stock=site&&inventory?.siteId===`demo-${site}`?inventory:null;
  return <section className="hb-card" aria-label="园区干胶库存">
    <h2>园区干胶库存</h2>
    {!site?<p>选择园区后，查看该园区的库存与加工入库记录。</p>:<>
      <p>{sites[site]} · 当前业务台账（演示数据）</p>
      {error&&<p role="alert">{error}</p>}
      {stock?<>
        <div className="hb-kpis" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>
          {([['在库',stock.stockKg],['可用',stock.availableKg],['冻结',stock.heldKg],['销售在途',stock.inTransitKg]] as const).map(([label,value])=><div key={label}><span>{label}</span><strong>{quantity(value)}<small> 公斤干胶</small></strong></div>)}
        </div>
        <p>累计加工入库 {quantity(stock.processedKg)} 公斤干胶 · {stock.processedBatches} 批。</p>
        <p>记录更新于 {catalogTime(stock.updatedAt)}。加工入库增加库存，销售发车扣减库存。</p>
      </>:!error&&<p role="status">正在读取本园区库存…</p>}
      <button type="button" onClick={onRefresh}>重新读取库存</button>{' '}
      {onData&&<button type="button" onClick={onData}>查看库存台账 →</button>}
    </>}
  </section>;
}
