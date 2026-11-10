import test from 'node:test';
import assert from 'node:assert/strict';
import {ParkWeatherWindows} from '../src/park-weather.js';
import {createApp} from '../src/server.js';

const initial = new Date('2026-10-26T02:30:00Z');
function weather(now, {rain = 0, probability = 20} = {}) {
  const firstHour = Math.floor(+now / 3600000) * 3600 - 24 * 3600;
  const time = Array.from({length:220}, (_, i) => firstHour + i * 3600);
  return {latitude:19.8, longitude:110.3,
    hourly_units:{time:'unixtime', temperature_2m:'°C', relative_humidity_2m:'%', precipitation_probability:'%', rain:'mm', showers:'mm', soil_moisture_0_to_1cm:'m³/m³'},
    hourly:{time, temperature_2m:time.map(() => 27), relative_humidity_2m:time.map(() => 70), precipitation_probability:time.map(() => probability),
      rain:time.map(t => t > +now / 1000 ? rain : 0), showers:time.map(() => 0), soil_moisture_0_to_1cm:time.map(() => 0.3)},
    current_units:{time:'unixtime', temperature_2m:'°C', relative_humidity_2m:'%', precipitation:'mm'},
    current:{time:Math.floor(+now / 1000), interval:900, temperature_2m:27, relative_humidity_2m:70, precipitation:0}};
}
function fixture() {
  let now = initial, offline = false, rain = 0;
  const calls = [];
  const service = {get:async url => {calls.push(url); if (offline) throw Error('offline'); return weather(now,{rain});}};
  return {service, calls, clock:() => now,
    windows:new ParkWeatherWindows({service,clock:() => now}),
    advance:ms => {now = new Date(+now + ms);}, offline:() => {offline = true;}, rain:value => {rain = value;}};
}

test('weather windows fetch each park coordinate and share cached reads without a model call', async () => {
  const f = fixture();
  const [hn, duplicate] = await Promise.all([f.windows.read('demo-hainan'),f.windows.read('demo-hainan')]);
  assert.equal(f.calls.length,1);
  assert.equal(hn.provider,'Open-Meteo');
  assert.equal(hn.status,'available');
  assert.equal(hn.location.latitude,19.8);
  assert.equal(hn.location.longitude,110.3);
  assert.equal(duplicate.fetchedAt,hn.fetchedAt);
  assert.equal(hn.current.airTemperatureC,27);
  assert.equal(hn.windows.length,168);
  assert.equal(hn.windows[0].start,'2026-10-26T02:00:00.000Z');
  assert.ok(hn.windows.every(w => w.end > initial.toISOString() && w.suitability === 'suitable'));
  assert.match(hn.windows[0].reason,/干胶含量缺失/);
  const xs = await f.windows.read('demo-xsbn');
  const query = new URL(f.calls[1]).searchParams;
  assert.equal(query.get('latitude'),'22');
  assert.equal(query.get('longitude'),'100.8');
  assert.equal(query.get('forecast_days'),'8');
  assert.equal(xs.siteId,'demo-xsbn');
  assert.equal(xs.location.confirmed,false);
  assert.match(xs.limitation,/演示位置/);
  await f.windows.read('demo-hainan');
  assert.equal(f.calls.length,2);
  f.advance(61 * 60000);
  f.rain(2);
  const updated = await f.windows.read('demo-hainan');
  assert.equal(f.calls.length,3);
  assert.notEqual(updated.fetchedAt,hn.fetchedAt);
  assert.ok(updated.windows.every(w => w.suitability === 'defer'));
});

test('refresh updates advice immediately and outages keep explicit cache age without simulated fallback', async () => {
  const f = fixture();
  const first = await f.windows.read('demo-hainan');
  f.rain(3);
  const refreshed = await f.windows.read('demo-hainan',{force:true});
  assert.ok(refreshed.windows.every(w => w.suitability === 'defer'));
  f.offline();
  f.advance(61 * 60000);
  const failed = await f.windows.read('demo-hainan');
  assert.equal(failed.status,'refresh_failed');
  assert.equal(failed.stale,false);
  assert.equal(failed.fetchedAt,first.fetchedAt);
  assert.equal(failed.error.code,'SOURCE_UNAVAILABLE');
  const count = f.calls.length;
  await f.windows.read('demo-hainan');
  assert.equal(f.calls.length,count,'failed sources retry after a short cooldown');
  f.advance(61 * 60000);
  const stale = await f.windows.read('demo-hainan');
  assert.equal(stale.status,'stale');
  assert.deepEqual(stale.windows,[]);
  const missing = await f.windows.read('demo-xsbn');
  assert.equal(missing.status,'unavailable');
  assert.equal(missing.current,null);
  assert.deepEqual(missing.windows,[]);
  const disabled = await new ParkWeatherWindows({service:null}).read('demo-hainan');
  assert.equal(disabled.status,'unavailable');
  assert.equal(disabled.error.code,'PUBLIC_SOURCES_DISABLED');
  assert.equal(disabled.execution.allowed,false);
});

test('missing rain fields require review; unknown probability does not override a known rain risk', async () => {
  const raw = weather(initial);
  raw.hourly.precipitation_probability.fill(null);
  const service = {get:async () => raw};
  const windows = new ParkWeatherWindows({service,clock:() => initial});
  const missing = await windows.read('demo-hainan');
  assert.ok(missing.windows.every(w => w.suitability === 'review'));
  assert.equal(missing.execution.allowed,false);
  assert.equal(missing.execution.suitability,'review');
  assert.match(missing.summary,/均需现场复核/);
  assert.doesNotMatch(missing.summary,/其余时段/);
  raw.hourly.rain.fill(2);
  const wet = await windows.read('demo-hainan',{force:true});
  assert.ok(wet.windows.every(w => w.suitability === 'defer'));
  assert.equal(wet.execution.allowed,false);
});

test('cached peek is synchronous; execution refresh age and decision fingerprint ignore retrieval timestamps', async () => {
  const f = fixture();
  const empty = f.windows.peek('demo-hainan');
  assert.equal(empty.status,'unavailable');
  assert.equal(empty.execution.allowed,false);
  assert.equal(f.calls.length,0);
  const first = await f.windows.read('demo-hainan');
  assert.equal(first.execution.allowed,true);
  assert.equal(f.windows.peek('demo-hainan').decisionFingerprint,first.decisionFingerprint);
  f.advance(60000);
  const refreshed = await f.windows.read('demo-hainan',{force:true});
  assert.notEqual(refreshed.fetchedAt,first.fetchedAt);
  assert.equal(refreshed.decisionFingerprint,first.decisionFingerprint);
  f.advance(5 * 60000);
  await f.windows.read('demo-hainan',{maxAgeMs:5 * 60000});
  assert.equal(f.calls.length,3);
  f.offline();
  const failed = await f.windows.read('demo-hainan',{force:true});
  assert.equal(failed.execution.allowed,false);
  assert.match(failed.execution.reason,/刷新失败/);
});

test('execution stops for current heavy rain and hourly risk without scaling fifteen-minute rainfall', async () => {
  let now = initial;
  const raw = weather(initial);
  const windows = new ParkWeatherWindows({service:{get:async () => raw},clock:() => now});
  raw.current.precipitation = 0.2;
  const light = await windows.read('demo-hainan');
  assert.equal(light.execution.allowed,true,'0.2mm per 15min is not multiplied by four to make heavy rain');
  raw.current.precipitation = 0.6;
  const heavy = await windows.read('demo-hainan',{force:true});
  assert.equal(heavy.execution.allowed,false);
  assert.equal(heavy.execution.suitability,'defer');
  assert.equal(heavy.execution.currentRainfallMm,0.6);
  assert.match(heavy.execution.reason,/15 分钟降雨 0.6 mm/);
  assert.notEqual(heavy.decisionFingerprint,light.decisionFingerprint);
  now = new Date(+initial + 16 * 60000);
  const oldCurrent = windows.peek('demo-hainan');
  assert.equal(oldCurrent.execution.currentRainfallMm,null);
  assert.equal(oldCurrent.execution.allowed,true,'expired current estimate gives way to the still-covered hourly forecast');
  const activeIndex = raw.hourly.time.findIndex(at => at * 1000 > +now);
  raw.hourly.precipitation_probability[activeIndex] = 70;
  const risk = await windows.read('demo-hainan',{force:true});
  assert.equal(risk.execution.allowed,false);
  assert.equal(risk.execution.suitability,'defer');
});

test('past rain alone allows execution while missing current-hour coverage does not', async () => {
  const raw = weather(initial);
  raw.hourly.rain[0] = 6;
  const windows = new ParkWeatherWindows({service:{get:async () => raw},clock:() => initial});
  const wet = await windows.read('demo-hainan');
  assert.equal(wet.execution.suitability,'suitable');
  assert.equal(wet.execution.allowed,true);
  assert.match(wet.execution.reason,/不单独限制排程/);
  const record = windows.records.get('demo-hainan');
  record.data.forecast = record.data.forecast.filter(step => Date.parse(step.validFrom) > +initial);
  const gap = windows.peek('demo-hainan');
  assert.equal(gap.execution.suitability,'unavailable');
  assert.equal(gap.execution.allowed,false);
  assert.match(gap.execution.reason,/没有天气预报覆盖/);
});

test('historical rain leaves the rolling seven-day window instead of blocking the whole forecast', async () => {
  const raw=weather(initial);
  raw.hourly.rain[0]=6;
  const service=new ParkWeatherWindows({service:{get:async()=>raw},clock:()=>initial});
  const result=await service.read('demo-hainan');
  const expiry=new Date(raw.hourly.time[0]*1000+7*86400000).toISOString();
  const before=result.windows.filter(window=>window.start<expiry);
  const after=result.windows.filter(window=>window.start>=expiry);
  assert.ok(before.length>0&&after.length>0);
  assert.ok(before.every(window=>window.suitability==='suitable'&&window.recentRainfallTotalMm===6));
  assert.ok(after.every(window=>window.suitability==='suitable'&&window.recentRainfallTotalMm===0));
  assert.equal(result.thresholds.recentWetSpellMm,5);
});

test('future rainfall affects its own window and later recovery, but cannot block earlier dry windows', async () => {
  const raw=weather(initial);
  const rainIndex=raw.hourly.time.findIndex(time=>time*1000>+initial)+2;
  raw.hourly.rain[rainIndex]=6;
  const service=new ParkWeatherWindows({service:{get:async()=>raw},clock:()=>initial});
  const result=await service.read('demo-hainan');
  const rainEnd=new Date(raw.hourly.time[rainIndex]*1000).toISOString();
  const rainStart=new Date(raw.hourly.time[rainIndex]*1000-3600000).toISOString();
  assert.ok(result.windows.filter(window=>window.start<rainStart).every(window=>window.suitability==='suitable'&&window.recentRainfallTotalMm===0));
  const rainy=result.windows.find(window=>window.start===rainStart);
  assert.equal(rainy.suitability,'defer');assert.equal(rainy.recentRainfallTotalMm,0);
  const recovery=result.windows.find(window=>window.start===rainEnd);
  assert.equal(recovery.suitability,'suitable');assert.match(recovery.reason,/现场巡查提示/);assert.equal(recovery.recentRainfallTotalMm,6);
});

test('each window uses its API soil value at the window start, without copying present wetness or filling missing values', async () => {
  const raw=weather(initial);
  const currentIndex=raw.hourly.time.findLastIndex(time=>time*1000<=+initial);
  raw.hourly.soil_moisture_0_to_1cm[currentIndex]=.8;
  raw.hourly.soil_moisture_0_to_1cm[currentIndex+1]=null;
  raw.hourly.soil_moisture_0_to_1cm[currentIndex+3]=.7;
  const service=new ParkWeatherWindows({service:{get:async()=>raw},clock:()=>initial});
  const result=await service.read('demo-hainan');
  assert.equal(result.windows[0].soilMoisturePct,80);
  assert.equal(result.windows[0].suitability,'review');
  assert.equal(result.windows[1].soilMoisturePct,null,'missing future soil stays missing');
  assert.equal(result.windows[1].suitability,'suitable','today\'s wet soil is not projected into every future hour');
  assert.equal(result.windows[2].soilMoisturePct,30);
  assert.equal(result.windows[2].suitability,'suitable','future high soil moisture is not moved to an earlier window');
  assert.equal(result.windows[3].soilMoisturePct,70);
  assert.equal(result.windows[3].suitability,'review','explicitly forecast wet soil still requires recovery review');
});

test('weather endpoint respects selected park identity for reads and refreshes', async () => {
  const f = fixture();
  const app = createApp({dbPath:':memory:',publicDataService:f.service,clock:f.clock,requireIdentity:true});
  await new Promise((resolve,reject) => {app.server.once('error',reject); app.server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = app.identities.login({accountId:'manager-hn'});
  const headers = {'X-Rubber-Session':login.token,'Content-Type':'application/json'};
  try {
    assert.equal((await fetch(base+'/api/weather/window?siteId=demo-hainan')).status,401);
    const result = await (await fetch(base+'/api/weather/window?siteId=demo-hainan',{headers})).json();
    assert.equal(result.siteId,'demo-hainan');
    assert.equal(result.status,'available');
    assert.equal((await fetch(base+'/api/weather/window?siteId=demo-xsbn',{headers})).status,403);
    assert.equal((await fetch(base+'/api/weather/window?siteId=unknown',{headers})).status,400);
    assert.equal((await fetch(base+'/api/weather/window',{method:'POST',headers,body:JSON.stringify({siteId:'demo-xsbn'})})).status,403);
    const refreshed = await fetch(base+'/api/weather/window',{method:'POST',headers,body:JSON.stringify({siteId:'demo-hainan'})});
    assert.equal(refreshed.status,200);
    assert.equal((await refreshed.json()).status,'available');
  } finally {await app.close();}
});
