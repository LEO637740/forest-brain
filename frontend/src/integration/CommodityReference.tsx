import {useEffect} from 'react';
import {BASE, siteIdOf, useRead, type EnvironmentSite} from './client';
import {State} from './Views';
import {EudrReadiness} from './EudrReadiness';
import './commodityReference.css';

type Evidence = {id:string;title:string;publishedAt?:string;summary:string;url:string};
export type RubberListing = {
  id:string;announcement:string;publishedAt:string;saleDate:string;title:string;seller:string;channel:string;productName:string;productCode:string;brand:string;
  pricing:{unit:string;method:string;referenceContract:string;startBasisCnyPerTonne:number;tickCnyPerTonne:number};
  quantityTonnes:number;minOrderTonnes:number;deposit:{issueCnyPerTonne:number;transferPct:number};
  quality:{key:string;label:string;limit:string}[];
  delivery:{method:string;warehouses:string[];lastTradeDate:string;from:string;to:string;note:string};
  transcriptionNote:string;sourceUrl:string;imageUrl:string;basis:string;
};
export type Tradability = {listingId:string;ready:boolean|null;checks:{key:string;label:string;ok:boolean|null;detail:string}[];conclusion:string;nextStep:string};
export type RubberCommodityReference = {
  asOf:string;
  exchange:{name:string;shortName:string;website:string};
  rubber:{name:string;category:string;categoryCode:string;listing:string;specificGrades:string};
  documents:(Evidence & {pages:number;groupNote?:string})[];
  listings?:RubberListing[];tradability?:Tradability;
  publicEvidence:Evidence[];
  quote:{status:string;message:string;referenceCnyPerTonne?:number;contract?:string};
  marketReferences:{id:string;title:string;provider:string;sourceUrl:string;publishedAt?:string;retrievedAt?:string;stale:boolean;status:string;data:unknown;note:string}[];
  connection:{product:string;availableKg:number;stockKg:number;processedKg:number;pendingShipmentKg?:number;nextStep:string;summary:string;priceBasis:string};
};
const kg = (value:number) => value.toLocaleString('zh-CN',{maximumFractionDigits:2});
const sourceLink = (url:string) => url.startsWith('/api/') ? BASE + url : url;

export function CommodityReference({site='hainan',compact=false}:{site?:EnvironmentSite;compact?:boolean}) {
  const siteId = siteIdOf(site);
  const result = useRead<RubberCommodityReference>(`/api/commodity/rubber?siteId=${siteId}`);
  useEffect(() => {
    const refresh = () => result.reload();
    window.addEventListener('harness-sales-shipments-changed',refresh);
    return () => window.removeEventListener('harness-sales-shipments-changed',refresh);
  },[siteId]);
  const data = result.data;
  const openReference = () => window.dispatchEvent(new CustomEvent('harness-open-commodity-market',{detail:{site}}));
  return <section id={compact?undefined:'commodity-rubber-reference'} className={`hb-commodity${compact?' hb-commodity-compact':' hb-card'}`} aria-label={compact?'销售对接参考':'浙江橡胶交易对接'}>
    <header><div>{compact?<h3>浙江橡胶交易对接</h3>:<h2>浙江橡胶交易对接</h2>}</div>{compact&&<button type="button" onClick={openReference}>查看交易资料 →</button>}</header>
    {!data?<State error={result.error} reload={result.reload}/>:<>
      <p className="hb-commodity-conclusion">{data.tradability?data.tradability.conclusion:'材料已列有橡胶，可继续核对园区产品的交易规格。'}{data.connection.availableKg>0?<> 当前可用 <strong>{kg(data.connection.availableKg)} 公斤干胶</strong>。</>:' 当前暂无可用干胶，先完成加工入库。'}</p>
      <p className="hb-commodity-next"><strong>下一步</strong>{data.tradability?.nextStep??data.connection.nextStep}</p>
      <p className="hb-commodity-basis">当前报价待询价 · 本园区销售使用模拟报价</p>
      {!compact&&data.tradability&&<div className="hb-commodity-ready"><h3>本园交易对接待核对事项</h3>
        <ul>{data.tradability.checks.map(check=><li key={check.key} className={check.ok?'is-ok':'is-missing'}><span>{check.ok?'✓':'○'}</span><strong>{check.label}</strong><small>{check.detail}</small></li>)}</ul></div>}
      {!compact&&<details className="hb-commodity-details"><summary>{data.listings?.length||data.quote.referenceCnyPerTonne!==undefined?'历史商品与报价示例':'报价来源说明'}</summary>
      <p className="hb-commodity-basis">{data.quote.message}</p>
      {data.quote.referenceCnyPerTonne!==undefined&&<p className="hb-commodity-price"><strong>报价方式演示</strong>约 {data.quote.referenceCnyPerTonne.toLocaleString('zh-CN')} 元/吨（{data.quote.contract} + 历史基差，计算示例）</p>}
      {!compact&&data.listings?.map(listing=><div key={listing.id} className="hb-commodity-listing">
        <h3>历史橡胶商品案例 · {listing.productCode}</h3>
        <p className="hb-commodity-note">以下数量、品牌和交收条件适用于该历史商品，供了解交易方式；本园当前交易条件需单独核对。</p>
        <dl>
          <dt>商品</dt><dd>{listing.productName} · 品牌 {listing.brand} · {listing.seller}（{listing.channel}）</dd>
          <dt>报价方式</dt><dd>{listing.pricing.method}，参考上期所 {listing.pricing.referenceContract}，起拍基差 {listing.pricing.startBasisCnyPerTonne} 元/吨，最小变动 {listing.pricing.tickCnyPerTonne} 元/吨</dd>
          <dt>数量</dt><dd>发售 {listing.quantityTonnes} 吨，最小订货 {listing.minOrderTonnes} 吨；发售定金 {listing.deposit.issueCnyPerTonne} 元/吨，转让定金 {listing.deposit.transferPct}%</dd>
          <dt>质量标准</dt><dd>{listing.quality.map(item=>`${item.label} ${item.limit}`).join('；')}</dd>
          <dt>交收</dt><dd>{listing.delivery.method}；{listing.delivery.warehouses.join('、')}；{listing.delivery.from} 至 {listing.delivery.to}。{listing.delivery.note}</dd>
          <dt>来源</dt><dd>{listing.announcement}（{listing.publishedAt}）· <a href={listing.sourceUrl} target="_blank" rel="noreferrer">公告转载 ↗</a> · <a href={sourceLink(listing.imageUrl)} target="_blank" rel="noreferrer">原表图片 ↗</a><small>{listing.transcriptionNote}</small></dd>
        </dl>
      </div>)}
      </details>}
      {!compact&&<details className="hb-commodity-details"><summary>查看品种、园区对接资料与来源</summary>
        <div className="hb-commodity-detail-grid">
          <div><h3>材料中的橡胶品种</h3><dl><dt>交易中心</dt><dd><a href={data.exchange.website} target="_blank" rel="noreferrer">{data.exchange.name} ↗</a></dd><dt>分类与品种</dt><dd>{data.rubber.category}（{data.rubber.categoryCode}）· {data.rubber.name} · {data.rubber.listing}</dd><dt>胶种与牌号</dt><dd>{data.rubber.specificGrades}</dd></dl></div>
          <div><h3>本园区询价准备</h3><dl><dt>拟对接产品</dt><dd>{data.connection.product}</dd><dt>仓内干胶</dt><dd>{kg(data.connection.stockKg)} 公斤，其中可用 {kg(data.connection.availableKg)} 公斤</dd><dt>累计加工入库</dt><dd>{kg(data.connection.processedKg)} 公斤干胶</dd>{data.connection.pendingShipmentKg!==undefined&&<><dt>已计划待出货</dt><dd>{kg(data.connection.pendingShipmentKg)} 公斤干胶</dd></>}<dt>方案价格依据</dt><dd>{data.connection.priceBasis}</dd></dl><p>{data.connection.summary}</p></div>
        </div>
        <h3>老师提供的原始材料</h3>
        <ul className="hb-commodity-sources">{data.documents.map(document=><li key={document.id}><a href={sourceLink(document.url)} target="_blank" rel="noreferrer">{document.title} ↗</a><p>{document.publishedAt&&`${document.publishedAt} · `}{document.pages} 页 · {document.summary}</p>{document.groupNote&&<p className="hb-commodity-note">{document.groupNote}</p>}</li>)}</ul>
        {data.publicEvidence.length>0&&<><h3>交易中心公开信息</h3><ul className="hb-commodity-sources">{data.publicEvidence.map(evidence=><li key={evidence.id}><a href={evidence.url} target="_blank" rel="noreferrer">{evidence.title} ↗</a><p>{evidence.publishedAt&&`${evidence.publishedAt} · `}{evidence.summary}</p></li>)}</ul></>}
        {data.marketReferences.length>0&&<><h3>其他公开行情参考</h3><ul className="hb-commodity-sources">{data.marketReferences.map(reference=><li key={reference.id}><a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.title} ↗</a><p>{reference.provider}{reference.stale?' · 保留历史快照':''} · {reference.note}</p></li>)}</ul></>}
      </details>}
      {result.error&&<p role="status">最新资料未更新：{result.error} <button type="button" onClick={result.reload}>重新读取</button></p>}
    </>}
    {!compact&&<EudrReadiness site={site}/>}
  </section>;
}
