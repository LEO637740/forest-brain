import test from 'node:test';
import assert from 'node:assert/strict';
import {recordSummary, catalogSourceState, sourcePeriod, catalogTime} from '../src/workspace/dataCatalog.ts';

test('catalog keeps simulated, forecast and unknown provenance distinct', () => {
  const rows = [
    {provenance:{mode:'simulated'}, quality:'valid', observedAt:'2026-10-09T01:00:00Z'},
    {provenance:{mode:'forecast'}, quality:'valid', issuedAt:'2026-10-10T01:00:00Z'},
    {quality:'missing', measuredAt:null},
  ];
  const summary = recordSummary(rows);
  assert.equal(summary.label, '模拟数据 / 预测数据 / 来源待确认');
  assert.equal(summary.issues, 1);
  assert.equal(summary.latest, '2026-10-10T01:00:00Z');
  assert.equal(recordSummary([]).label, '尚无记录');
  assert.equal(catalogTime(null), '未提供');
});

test('one tree includes imported measurement and original state sources without doubling its count', () => {
  const summary = recordSummary([{
    provenance: {mode: 'simulated', sourceId: 'demo-tree-state'}, quality: 'valid', measuredAt: '2026-10-09T01:00:00Z',
    fieldRecord: {provenance: {mode: 'measured', sourceId: 'field-measurement'}, observedAt: '2026-10-19T02:00:00Z'},
  }]);
  assert.equal(summary.label, '模拟数据 / 实测 / 已记录');
  assert.equal(summary.count, 1);
  assert.equal(summary.latest, '2026-10-19T02:00:00Z');
  assert.equal(summary.issues, 0);
});

test('cached data cannot be presented as currently available after expiration or refresh failure', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const source = {id:'weather',status:'available',data:{forecast:[]},validUntil:'2026-10-14T00:00:00Z'};
  assert.equal(catalogSourceState(source, now).warning, false);
  assert.match(catalogSourceState({...source,validUntil:'2026-10-12T00:00:00Z'}, now).label,/已过期/);
  assert.match(catalogSourceState({...source,lastError:{message:'offline'}},now).label,/更新失败/);
  assert.equal(catalogSourceState({...source,data:undefined},now).label, '不可用');
  assert.equal(catalogSourceState({...source,validUntil:null},now).warning, true);
});

test('catalog distinguishes source reporting period from collection time', () => {
  assert.equal(sourcePeriod({tradeDate:'2026-09-30',retrievedAt:'2026-10-13T00:00:00Z'}),'2026-09-30');
  assert.equal(sourcePeriod({period:'2026年8月',publishedAt:'2026-09-20'}),'2026年8月');
  assert.equal(sourcePeriod({retrievedAt:'2026-10-13T00:00:00Z'}),'未提供');
  assert.equal(sourcePeriod({forecast:[{validFrom:'invalid'}]}),'未提供');
});
