import test from 'node:test';
import assert from 'node:assert/strict';
import {futuresRows, publicSourceState, officialSourceUrl, metricUnit} from '../src/integration/publicMarketData.ts';

const now = Date.parse('2026-10-07T06:00:00Z');
const market = {tradeDate:'2026-09-30', priceType:'futures', currency:'CNY', priceUnit:'CNY/tonne', contracts:[{contract:'RU2701',closeCnyPerTonne:20095,settlementCnyPerTonne:19710},{contract:'RU2610',closeCnyPerTonne:null,settlementCnyPerTonne:19000}]};
const source = {id:'market',status:'available',data:market,validUntil:'2026-10-10T00:00:00Z'};

test('public futures preserve contract quotes, units and missing values', () => {
  const rows = futuresRows(market);
  assert.deepEqual(rows.map(row => row.contract), ['RU2610','RU2701']);
  assert.equal(rows[0].closeCnyPerTonne, null);
  assert.equal(rows[1].closeCnyPerTonne, 20095);
  assert.deepEqual(futuresRows({...market,priceUnit:'CNY/kg'}), []);
  assert.deepEqual(futuresRows({...market,priceType:'spot'}), []);
});
test('invalid or duplicate quotes cannot manufacture a price', () => {
  const rows = futuresRows({...market,contracts:[...market.contracts,{contract:'RU2701',closeCnyPerTonne:1,settlementCnyPerTonne:1},{contract:'RU2703',closeCnyPerTonne:NaN,settlementCnyPerTonne:-1},{contract:'NR2701',closeCnyPerTonne:18000,settlementCnyPerTonne:18000}]});
  assert.equal(rows.length, 2);
  assert.deepEqual(futuresRows(undefined), []);
});
test('local expiry and refresh errors remain visible when cached data exists', () => {
  assert.equal(publicSourceState(source, now).warning, false);
  assert.match(publicSourceState({...source,validUntil:new Date(now).toISOString()},now).label, /已过期/);
  assert.match(publicSourceState({...source,status:'refresh_failed',lastError:{message:'暂不可用'}},now).label, /更新失败/);
  const both = publicSourceState({...source,stale:true,status:'refresh_failed'},now);
  assert.match(both.label, /已过期.*更新失败/);
  assert.equal(both.expired, true);
  assert.equal(publicSourceState(undefined,now).label,'数据不可用');
  assert.equal(publicSourceState({...source,validUntil:null},now).warning,true);
});
test('official links and metric units cannot disguise other data bases', () => {
  assert.equal(officialSourceUrl({...source,sourceUrl:'javascript:alert(1)'}),undefined);
  assert.equal(officialSourceUrl({...source,sourceUrl:'https://www.shfe.com.cn/report'}),'https://www.shfe.com.cn/report');
  assert.equal(metricUnit('CNY/tonne_dry_rubber'),'元 / 吨干胶');
  assert.equal(metricUnit('万吨'),'万吨');
});
