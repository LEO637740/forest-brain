import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicDataService, normalizeWeather, normalizeMarket, normalizeWarehouse } from '../src/adapters/public-data.js';
import { makePublicContext } from '../src/adapters/public-context.js';
import { checkContext } from '../src/validation.js';
import { createApp } from '../src/server.js';

const now = new Date('2026-09-29T02:30:00Z');
const config = { enabledSources:['weather','market','warehouse','bulletin'], location: { name: '待确认参考点', latitude: 20, longitude: 110, confirmed: false, siteId: 'demo-hainan' }, refreshMinutes: 60, maxWeatherAgeMinutes: 120, marketLookbackDays: 3 };
function weather() {
  const times = Array.from({ length: 80 }, (_, i) => Date.parse('2026-09-29T00:00:00Z') / 1000 + i * 3600);
  return { latitude: 20, longitude: 110, hourly_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', precipitation_probability: '%', rain: 'mm', showers: 'mm', soil_moisture_0_to_1cm: 'm³/m³' },
    hourly: { time: times, temperature_2m: times.map(() => 25), relative_humidity_2m: times.map(() => 70), precipitation_probability: times.map(() => 30), rain: times.map(() => 0.1), showers: times.map(() => 0.2), soil_moisture_0_to_1cm: times.map(() => 0.3) } };
}
function market(date = '20260928') { return { report_date: date, o_trade_day: '8251', o_curinstrument: [
  { PRODUCTID: 'ru_f ', DELIVERYMONTH: '2701', CLOSEPRICE: 19275, SETTLEMENTPRICE: 19455, VOLUME: 270809, OPENINTEREST: 146176 },
  { PRODUCTID: 'ru_f', DELIVERYMONTH: '小计', CLOSEPRICE: 99999 },
  { PRODUCTID: 'ru_f', DELIVERYMONTH: '2703', CLOSEPRICE: '', SETTLEMENTPRICE: null },
  { PRODUCTID: 'cu_f', DELIVERYMONTH: '2701', CLOSEPRICE: 80000 },
] }; }
function warehouse(date = '2026-09-28') { return `<p>${date}</p><table><tr><td>天然橡胶</td><td>单位：吨</td></tr><tr><td>小计</td><td>200</td><td>0</td></tr><tr><td>总计</td><td>148,470</td><td>500</td></tr><tr><td>其他品种</td><td>单位：吨</td></tr><tr><td>总计</td><td>999</td><td>1</td></tr></table>`; }
const bulletin = '<meta name="ArticleTitle" content="预报：2026年全国橡胶树重大病虫害"><meta name="PubDate" content="2026-02-28 17:41:00"><meta name="ContentSource" content="农垦局">';
function fixture() {
  let clock = now, fail = false; const calls = [];
  const service = new PublicDataService({ directory: mkdtempSync(join(tmpdir(),'harness-public-')), config: structuredClone(config), clock: () => clock,
    fetchImpl: async url => {
      calls.push(url); if (fail) throw new Error('offline');
      if (url.includes('open-meteo.com')) return Response.json(weather());
      if (url.includes('kx20260929')) return Response.json({ ...market('20260929'), o_trade_day: '' });
      if (url.includes('kx20260928')) return Response.json(market());
      if (url.includes('dailystock_20260929')) return new Response('',{ status:404 });
      if (url.includes('dailystock_20260928')) return new Response(warehouse());
      if (url.includes('moa.gov.cn')) return new Response(bulletin);
      throw new Error('Unexpected URL');
    } });
  return { service, calls, advance(ms) { clock = new Date(+clock + ms); }, offline() { fail = true; } };
}
function request(c, kind) { return { requestId: `public-${kind}`, kind, siteId: c.siteId, targetSnapshotId: c.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: c.snapshotId, version: c.version }, executionMode: 'simulation' }; }

test('public weather: preceding-hour rain, future-only windows, null preservation and unit validation', () => {
  const raw = weather(); raw.hourly.rain[5] = null;
  const result = normalizeWeather(raw,config.location,now);
  assert.equal(result.forecast.length,48);
  assert.equal(result.forecast[0].validFrom,'2026-09-29T03:00:00.000Z');
  assert.equal(result.forecast[0].validTo,'2026-09-29T04:00:00.000Z');
  assert.equal(result.forecast[0].rainfallMm,0.3);
  assert.equal(result.forecast[1].rainfallMm,null);
  assert.equal(result.modelIssuedAt,null); assert.equal(result.basis,'weather_model');
  raw.hourly_units.rain = 'inch';
  assert.throws(() => normalizeWeather(raw,config.location,now),e => e.code === 'INVALID_PUBLIC_DATA');
});
test('public weather normalizer optionally retains the current hour without changing default future-only snapshots', () => {
  const raw = weather();
  const defaultResult = normalizeWeather(raw,config.location,now);
  const result = normalizeWeather(raw,config.location,now,{forecastHours:168,includeCurrentHour:true});
  assert.equal(defaultResult.forecast.length,48);
  assert.equal(defaultResult.forecast[0].validFrom,'2026-09-29T03:00:00.000Z');
  assert.equal(result.forecast[0].validFrom,'2026-09-29T02:00:00.000Z');
  assert.equal(result.forecast[0].validTo,'2026-09-29T03:00:00.000Z');
  assert.ok(result.forecast.length > 48);
});
test('public market: reject unsettled/date-mismatched reports; exclude totals, blanks and other products', () => {
  const m = normalizeMarket(market(),'20260928');
  assert.equal(m.priceUnit,'CNY/tonne'); assert.equal(m.priceType,'futures');
  assert.deepEqual(m.contracts.map(x => x.contract),['RU2701']);
  assert.equal(m.contracts[0].previousSettlementCnyPerTonne,null);
  assert.throws(() => normalizeMarket({ ...market(),o_trade_day:'' },'20260928'),e => e.code === 'SOURCE_NOT_PUBLISHED');
  assert.throws(() => normalizeMarket(market(),'20260929'),e => e.code === 'INVALID_PUBLIC_DATA');
});
test('warehouse: use only rubber total, not subtotals or the next product', () => {
  const d = normalizeWarehouse(warehouse(),'20260928');
  assert.equal(d.quantityTonnes,148470); assert.equal(d.changeTonnes,500);
  assert.throws(() => normalizeWarehouse(warehouse(),'20260929'),e => e.code === 'INVALID_PUBLIC_DATA');
  assert.throws(() => normalizeWarehouse(warehouse().replace('<td>总计</td><td>148,470','<td>missing</td><td>148,470'),'20260928'),e => e.code === 'INVALID_PUBLIC_DATA');
});
test('public collector: fallback to published day, immutable retrieval snapshots and stale real cache after outage', async () => {
  const f = fixture(); await f.service.refresh();
  assert.ok(f.service.status().sources.every(x => x.status === 'available'));
  assert.equal(f.service.records.market.data.tradeDate,'2026-09-28');
  assert.ok(f.calls.some(x => x.includes('kx20260929')));
  const first = structuredClone(f.service.records.market);
  assert.equal(f.service.archive(first.snapshotId).retrievedAt,first.retrievedAt);
  f.advance(61000); await f.service.refresh({ force:true });
  assert.notEqual(f.service.records.market.snapshotId,first.snapshotId);
  assert.equal(f.service.archive(first.snapshotId).retrievedAt,first.retrievedAt);
  const good = structuredClone(f.service.records.weather);
  f.offline(); f.advance(3 * 3600000); await f.service.refresh({ force:true });
  const w = f.service.status().sources.find(x => x.id === 'weather');
  assert.equal(w.status,'refresh_failed'); assert.equal(w.stale,true);
  assert.equal(w.snapshotId,good.snapshotId); assert.equal(w.retrievedAt,good.retrievedAt);
  assert.deepEqual(w.data,good.data);
  assert.throws(() => f.service.archive('../../latest'),e => e.code === 'INVALID_SOURCE_ID');
});
test('public context: reference weather cannot authorize site work; futures never substitute spot price/cost', async () => {
  const f = fixture(); await f.service.refresh();
  const c = makePublicContext({ treeIds:['T-0001'],service:f.service,now });
  assert.equal(c.modules.weather.observed,null); assert.equal(c.modules.market,undefined);
  assert.equal(c.modules.weather.forecast.issuedAtBasis,'retrieved');
  assert.equal(c.modules.weather.forecast.provenance.sourceClass,'web_service');
  const missing = checkContext(request(c,'weather_window'),c,now).missing;
  assert.ok(missing.some(x => x.field === 'location'));
  assert.ok(missing.some(x => x.field === 'observed'));
  assert.ok(checkContext(request(c,'market_scenario'),c,now).missing.some(x => x.field === 'spotPrice'));
  assert.equal(checkContext(request(c,'surface_action'),c,now).missing.length,0);
  f.service.config.location.confirmed = true;
  const changed = makePublicContext({ treeIds:['T-0001'],service:f.service,now });
  assert.equal(changed.modules.weather.forecast,null, 'old reference cache cannot be reused after location config changes');
});
test('public HTTP: authorized source export and actual needs_data run instead of fabricated strategy', async () => {
  const f = fixture(); await f.service.refresh();
  const a = createApp({ dbPath:':memory:',publicDataService:f.service,clock:() => now,token:'test-public-token' });
  await new Promise((resolve,reject) => { a.server.once('error',reject); a.server.listen(0,'127.0.0.1',resolve); });
  const base = `http://127.0.0.1:${a.server.address().port}`;
  const headers = { Authorization:'Bearer test-public-token','Content-Type':'application/json' };
  const post = (path,body) => fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/api/sources')).status,401);
    const status = await (await fetch(base+'/api/sources',{headers})).json(); assert.equal(status.sources.length,4);
    const id = status.sources[0].snapshotId;
    const exported = await fetch(base+`/api/sources/snapshots/${id}`,{headers});
    assert.equal(exported.headers.get('content-disposition'),`attachment; filename="${id}.json"`);
    assert.equal((await exported.json()).snapshotId,id);
    assert.equal((await post('/api/sources/contexts',{treeIds:['T-0201']})).status,404);
    const context = await (await post('/api/sources/contexts',{treeIds:['T-0001']})).json();
    const accepted = await (await post('/internal/harness/runs',{ requestId:'public-http',kind:'weather_window',siteId:context.siteId,targetSnapshotId:context.targetSnapshotId,inputSnapshot:context.inputSnapshot,executionMode:'simulation' })).json();
    await a.runtime.idle();
    const result = a.store.getRun(accepted.runId).result;
    assert.equal(result.status,'needs_data'); assert.equal(result.strategy,undefined);
    assert.ok(result.missingData.some(x => x.field === 'location'));
  } finally { await a.close(); }
});
