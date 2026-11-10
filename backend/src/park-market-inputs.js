import {parkSite} from './adapters/park-demo.js';
import {priceTrend} from './market-policy.js';

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const usable = (source, now) => source?.data && !source.stale
  && Date.parse(source.validUntil) > +now && Date.parse(source.retrievedAt) <= +now + 300000;
const publicSource = source => ({
  mode:'public_reference', sourceLabel:source.provider, sourceUrl:source.sourceUrl ?? source.url,
  snapshotId:source.snapshotId, retrievedAt:source.retrievedAt, validUntil:source.validUntil,
});

/**
 * Public quotations supply two different inputs: a regional raw-rubber price
 * for indicative economics and a same-contract daily futures change for
 * direction. A futures quotation is never a park's selling price.
 * `sources` is PublicDataService.status().sources, including freshness metadata.
 */
export function resolvePublicMarketInputs({siteId, sources=[], now=new Date(), simulatedMarket={}}) {
  const regionId = parkSite(siteId).regionId;
  const report = sources.find(source => source.id === 'monthly_report' && usable(source, now));
  const region = regionId === 'yunnan' ? '云南' : '海南';
  const spot = report?.data.metrics?.find(metric => metric.name === `${region}鲜胶乳折干胶月均价`
    && metric.unit === 'CNY/tonne_dry_rubber' && positive(metric.value));
  const simulatedPrices = simulatedMarket.prices ?? [];
  const lastPrice = simulatedPrices.at(-1);
  const priceBasis = spot ? {
    ...publicSource(report), cnyPerKg:spot.value / 1000, label:spot.name,
    priceType:'regional_monthly_spot_reference', period:spot.period, observedAt:report.data.publishedAt,
    scope:spot.scope,
    note:`${regionId === 'hainan' || regionId === 'yunnan' ? '' : `本地区暂无公开产区价，采用${region}异地参考；`}${spot.period} 鲜胶乳折干胶月均价，用于估算收益，不是园区当日成交价。`,
  } : {
    cnyPerKg:positive(lastPrice?.value) ? lastPrice.value : null,
    mode:'simulated', label:'园区模拟干胶报价', priceType:'simulated_spot',
    sourceLabel:'园区模拟行情', sourceUrl:null, snapshotId:lastPrice?.observationId ?? null,
    period:lastPrice?.observedAt?.slice(0,10) ?? null, observedAt:lastPrice?.observedAt ?? null,
    retrievedAt:null, validUntil:null, scope:parkSite(siteId).name,
    note:'未取得有效的公开产区参考价，收益测算使用模拟报价；可录入园区已确认报价替换。',
  };

  const market = sources.find(source => source.id === 'market' && usable(source, now)
    && source.data.priceType === 'futures' && source.data.currency === 'CNY' && source.data.priceUnit === 'CNY/tonne');
  // The most traded contract is selected once; its own prior settlement is
  // the comparator, so a main-contract rollover cannot fabricate a price move.
  const contract = market?.data.contracts?.filter(row => positive(row.settlementCnyPerTonne))
    .slice().sort((a,b) => (b.volumeLots ?? 0) - (a.volumeLots ?? 0)
      || (b.openInterestLots ?? 0) - (a.openInterestLots ?? 0))[0];
  const changeRatio = contract && positive(contract.previousSettlementCnyPerTonne)
    ? (contract.settlementCnyPerTonne - contract.previousSettlementCnyPerTonne) / contract.previousSettlementCnyPerTonne : null;
  const priceSignal = contract ? {
    ...publicSource(market), label:`上期所 ${contract.contract} 结算价日变化`,
    changeRatio, thresholdRatio:0.01, periodLabel:'较前一交易日结算', period:market.data.tradeDate,
    observedAt:market.data.tradeDate, contract:contract.contract,
    settlementCnyPerTonne:contract.settlementCnyPerTonne,
    previousSettlementCnyPerTonne:contract.previousSettlementCnyPerTonne,
    note:changeRatio === null ? '缺少同合约前结算价，本次不按期货涨跌调整割次。'
      : '使用当日成交量最大的 RU 合约，与同一合约前结算价比较；只影响割次方向，不用期货价格计算园区销售收入。',
  } : {
    mode:'simulated', label:'园区模拟胶价走势', changeRatio:priceTrend(simulatedPrices), thresholdRatio:0.03,
    periodLabel:simulatedPrices.length ? `模拟 ${simulatedPrices.length} 个报价点` : '缺少价格序列',
    period:lastPrice?.observedAt?.slice(0,10) ?? null, observedAt:lastPrice?.observedAt ?? null,
    sourceLabel:'园区模拟行情', sourceUrl:null, snapshotId:lastPrice?.observationId ?? null,
    retrievedAt:null, validUntil:null, contract:null,
    note:'未取得有效的公开期货结算行情，割次方向使用模拟价格序列。',
  };

  const warehouse = sources.find(source => source.id === 'warehouse' && usable(source, now));
  const warehouseReference = warehouse ? {
    ...publicSource(warehouse), label:'上期所天然橡胶注册仓单', period:warehouse.data.reportDate,
    quantityTonnes:warehouse.data.quantityTonnes, changeTonnes:warehouse.data.changeTonnes,
    note:'仅为交易所宏观库存参考，不作为园区库存、仓容或订单需求。',
  } : null;
  const evidence = [
    {...priceBasis, key:'selling_price', label:priceBasis.label, value:priceBasis.cnyPerKg, unit:'元/kg 干胶', usedFor:'单次收益测算'},
    {...priceSignal, key:'price_trend', value:priceSignal.changeRatio === null ? null : priceSignal.changeRatio * 100,
      unit:'%', usedFor:'割次方向'},
  ];
  return {priceBasis, priceSignal, warehouseReference, evidence};
}
