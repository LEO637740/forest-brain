import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePublicMarketInputs} from '../src/park-market-inputs.js';

const now = new Date('2026-10-27T04:00:00Z');
const simulatedMarket = {prices:[
  {value:14,observedAt:'2026-10-14T04:00:00Z',observationId:'demo-1'},
  {value:15,observedAt:'2026-10-27T04:00:00Z',observationId:'demo-2'},
]};
const source = (id, data) => ({id,data,provider:id === 'monthly_report' ? '农业农村部农垦局' : '上海期货交易所',
  snapshotId:`${id}-snapshot`,sourceUrl:`https://official.example/${id}`,retrievedAt:'2026-10-27T03:30:00Z',
  validUntil:'2026-11-01T00:00:00Z',stale:false,status:'available'});
function sources() {
  return [source('market',{
    priceType:'futures',currency:'CNY',priceUnit:'CNY/tonne',tradeDate:'2026-10-26',
    contracts:[
      {contract:'RU2611',settlementCnyPerTonne:18000,previousSettlementCnyPerTonne:20000,volumeLots:10,openInterestLots:90},
      {contract:'RU2701',settlementCnyPerTonne:20200,previousSettlementCnyPerTonne:20000,volumeLots:100,openInterestLots:80},
    ],
  }),source('monthly_report',{
    publishedAt:'2026-10-15T10:50:00+08:00',period:'2026-09',metrics:[
      {name:'海南鲜胶乳折干胶月均价',value:17143,unit:'CNY/tonne_dry_rubber',scope:'海南产区监测点',period:'2026-09'},
      {name:'云南鲜胶乳折干胶月均价',value:17333,unit:'CNY/tonne_dry_rubber',scope:'云南产区监测点',period:'2026-09'},
    ],
  }),source('warehouse',{reportDate:'2026-10-26',quantityTonnes:145620,changeTonnes:-130})];
}
const resolve = (overrides={}) => resolvePublicMarketInputs({siteId:'demo-hainan',now,sources:sources(),simulatedMarket,...overrides});

test('official monthly spot reference supplies economics while same-contract futures supply direction', () => {
  const result = resolve();
  assert.equal(result.priceBasis.cnyPerKg,17.143);
  assert.equal(result.priceBasis.mode,'public_reference');
  assert.equal(result.priceBasis.period,'2026-09');
  assert.match(result.priceBasis.note,/不是园区当日成交价/);
  assert.equal(result.priceSignal.contract,'RU2701');
  assert.equal(result.priceSignal.changeRatio,0.01);
  assert.equal(result.priceSignal.thresholdRatio,0.01);
  assert.equal(result.priceSignal.periodLabel,'较前一交易日结算');
  assert.equal(result.priceSignal.snapshotId,'market-snapshot');
  assert.equal(result.priceSignal.retrievedAt,'2026-10-27T03:30:00Z');
  assert.equal(result.evidence.length,2);
  assert.equal(result.evidence[0].sourceUrl,'https://official.example/monthly_report');
  assert.equal(result.warehouseReference.quantityTonnes,145620);
  assert.match(result.warehouseReference.note,/不作为园区库存/);
  assert.ok(!result.evidence.some(row => row.key === 'inventory'),'macro warehouse reference is not a decision input');
});

test('Yunnan uses its own monthly price and Guangdong declares the cross-region reference', () => {
  assert.equal(resolve({siteId:'demo-xsbn'}).priceBasis.cnyPerKg,17.333);
  const guangdong = resolve({siteId:'demo-guangdong-maoming'}).priceBasis;
  assert.equal(guangdong.cnyPerKg,17.143);
  assert.match(guangdong.note,/海南异地参考/);
});

test('futures cannot fill a missing spot price and a missing prior settlement cannot become a synthetic change', () => {
  const data = sources().filter(row => row.id !== 'monthly_report');
  data[0].data.contracts[1].previousSettlementCnyPerTonne = null;
  const result = resolve({sources:data});
  assert.equal(result.priceBasis.mode,'simulated');
  assert.equal(result.priceBasis.cnyPerKg,15);
  assert.equal(result.priceSignal.mode,'public_reference');
  assert.equal(result.priceSignal.changeRatio,null);
  assert.equal(result.priceSignal.contract,'RU2701');
  assert.match(result.priceSignal.note,/缺少同合约前结算价/);
});

test('fresh cached quotes survive refresh failure; expired and future-dated caches are not called real inputs', () => {
  const fresh = sources().map(row => ({...row,status:'refresh_failed'}));
  assert.equal(resolve({sources:fresh}).priceSignal.mode,'public_reference');
  const stale = sources().map(row => ({...row,validUntil:'2026-10-26T00:00:00Z'}));
  const result = resolve({sources:stale});
  assert.equal(result.priceBasis.mode,'simulated');
  assert.equal(result.priceSignal.mode,'simulated');
  assert.equal(result.warehouseReference,null);
  const future = sources().map(row => ({...row,retrievedAt:'2026-10-28T00:00:00Z'}));
  assert.equal(resolve({sources:future}).priceSignal.mode,'simulated');
});

test('simulated prices remain explicitly labelled, with their own period threshold and no invented zero', () => {
  const result = resolve({sources:[]});
  assert.equal(result.priceSignal.mode,'simulated');
  assert.equal(result.priceSignal.changeRatio,1/14);
  assert.equal(result.priceSignal.thresholdRatio,0.03);
  assert.match(result.priceSignal.periodLabel,/模拟 2 个报价点/);
  const missing = resolve({sources:[],simulatedMarket:{}});
  assert.equal(missing.priceBasis.cnyPerKg,null);
  assert.equal(missing.priceSignal.changeRatio,null);
});

test('unit-mismatched values do not pass as normalized yuan-per-dry-kg references', () => {
  const data = sources();
  data[0].data.priceUnit = 'USD/tonne';
  data[1].data.metrics[0].unit = 'CNY/kg_wet_latex';
  const result = resolve({sources:data});
  assert.equal(result.priceBasis.mode,'simulated');
  assert.equal(result.priceSignal.mode,'simulated');
});
