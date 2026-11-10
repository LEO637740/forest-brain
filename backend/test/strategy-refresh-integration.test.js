import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {parkProposal} from './helpers/park-plan-model.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('background refresh uses actual stock, retains business settings and never adopts generated plans',async t=>{
  let now=new Date('2026-10-29T02:00:00Z'),modelCalls=0;
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),automaticDataMode:'demo',clock:()=>now,
    strategyRefreshConfig:{enabled:true,intervalMinutes:60,modelsEnabled:true},
    assistantModel:{describe:()=>({configured:true,provider:'test',model:'fixed'}),async complete(){modelCalls++;return {content:JSON.stringify(parkProposal(1)),toolCalls:[]};}}});
  t.after(()=>app.close());
  const simulation=app.assistant.toolkit.simulation;
  simulation.market({siteId:'demo-hainan',stockKg:150,heldKg:0,transportKgPerDay:31,storageKg:1200});
  const beforeInventory=simulation.salesInventory('demo-hainan'),beforeTasks=simulation.latestTasks('demo-hainan');
  now=new Date(+now+1000);
  app.strategyRefresh.setPrepareSnapshots(async()=>{});app.strategyRefresh.start();await app.strategyRefresh.tick();
  assert.equal(modelCalls,1);
  const plan=app.parkPlans.latest('demo-hainan');assert.equal(plan.modelProposal.mode,'llm');assert.ok(!plan.adoption);
  const market=simulation.latestMarket('demo-hainan').model;
  assert.equal(market.params.stockKg,beforeInventory.stockKg);assert.equal(market.params.heldKg,beforeInventory.heldKg);
  assert.equal(market.params.transportKgPerDay,31);assert.equal(market.params.storageKg,1200);
  assert.deepEqual(simulation.salesInventory('demo-hainan'),beforeInventory);assert.deepEqual(simulation.latestTasks('demo-hainan'),beforeTasks);
  assert.equal(app.store.db.prepare('SELECT count(*) n FROM simulation_market_sales_plans').get().n,0);
});

test('explicit and background plan callers share one in-flight model result for the same park',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),clock:()=>new Date('2026-10-29T02:00:00Z'),
    assistantModel:{describe:()=>({configured:true,provider:'test',model:'fixed'}),async complete(){calls++;await gate;return {content:JSON.stringify(parkProposal(1)),toolCalls:[]};}}});
  t.after(()=>app.close());
  const first=app.parkPlans.compute('demo-hainan');const second=app.parkPlans.compute('demo-hainan');
  assert.equal(calls,1);release();const [a,b]=await Promise.all([first,second]);assert.equal(a.id,b.id);
  assert.equal(app.store.db.prepare('SELECT count(*) n FROM park_tapping_plans').get().n,1);
});

test('refresh status is site scoped and the existing automatic control pauses the new scheduler',async t=>{
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),requireIdentity:true,
    strategyRefreshConfig:{enabled:true,modelsEnabled:false}});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const manager=app.identities.login({accountId:'manager-hn'}).token,center=app.identities.login({accountId:'center-hz'}).token;
  const headers={'x-rubber-session':manager};
  assert.equal((await fetch(base+'/api/strategy-refresh/status?siteId=demo-hainan')).status,401);
  const status=await fetch(base+'/api/strategy-refresh/status?siteId=demo-hainan',{headers}).then(r=>r.json());
  assert.equal(status.intervalMinutes,60);assert.equal(status.enabled,true);assert.equal(status.generationOnly,true);
  assert.equal((await fetch(base+'/api/strategy-refresh/status?siteId=demo-xsbn',{headers})).status,403);
  const paused=await fetch(base+'/api/automatic/control',{method:'POST',headers:{'x-rubber-session':center,'content-type':'application/json'},body:JSON.stringify({paused:true})});
  assert.equal(paused.status,200);assert.equal((await paused.json()).strategyRefresh.status,'paused');
  assert.equal(app.store.db.prepare('SELECT count(*) n FROM park_tapping_plans').get().n,0);
});

test('restart warms the weather cache before deciding whether a three-minute-old production plan needs regeneration',async()=>{
  const initial=new Date('2026-10-28T21:00:00Z');let now=initial,modelCalls=0,weatherReads=0;
  const first=Math.floor(+initial/3600000)*3600-24*3600,time=Array.from({length:220},(_,i)=>first+i*3600);
  const weather={latitude:19.8,longitude:110.3,
    hourly_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation_probability:'%',rain:'mm',showers:'mm',soil_moisture_0_to_1cm:'m³/m³'},
    hourly:{time,temperature_2m:time.map(()=>27),relative_humidity_2m:time.map(()=>70),precipitation_probability:time.map(()=>10),
      rain:time.map(()=>0),showers:time.map(()=>0),soil_moisture_0_to_1cm:time.map(()=>0.3)},
    current_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm'},
    current:{time:+initial/1000,interval:900,temperature_2m:27,relative_humidity_2m:70,precipitation:0}};
  const dbPath=join(mkdtempSync(join(tmpdir(),'strategy-refresh-restart-')),'restart.sqlite');
  const create=()=>createApp({dbPath,generator:new RuleGenerator(),automaticDataMode:'demo',clock:()=>now,
    strategyRefreshConfig:{enabled:true,intervalMinutes:60,modelsEnabled:true},
    publicDataService:{status:()=>({sources:[],location:{confirmed:false}}),async get(){weatherReads++;return structuredClone(weather);}},
    assistantModel:{describe:()=>({configured:true,provider:'test',model:'fixed'}),async complete(){modelCalls++;return {content:JSON.stringify(parkProposal(1)),toolCalls:[]};}}});
  let app=create();
  try{
    app.strategyRefresh.setPrepareSnapshots(async()=>{});app.strategyRefresh.start();await app.strategyRefresh.tick();
    const original=app.parkPlans.latest('demo-hainan');
    assert.equal(modelCalls,1);assert.equal(original.weatherCheck.needsRecompute,false);assert.equal(weatherReads,1);
    await app.close();app=null;now=new Date(+initial+3*60000);app=create();
    assert.equal(app.parkPlans.latest('demo-hainan').weatherCheck.needsRecompute,true,'new process begins with an empty weather cache');
    app.strategyRefresh.setPrepareSnapshots(async()=>{});app.strategyRefresh.start();await app.strategyRefresh.tick();
    assert.equal(weatherReads,2,'the restarted service reads current weather before freshness assessment');
    assert.equal(modelCalls,1,'an unchanged fresh plan must not cause another model request');
    assert.equal(app.parkPlans.latest('demo-hainan').id,original.id);
    assert.equal(app.store.db.prepare('SELECT count(*) n FROM park_tapping_plans').get().n,1);
    assert.equal(app.strategyRefresh.status('demo-hainan').items.find(item=>item.kind==='park_plan').status,'current');
  }finally{await app?.close();}
});

test('unavailable startup weather preserves the saved plan and prevents a background model request',async()=>{
  const dbPath=join(mkdtempSync(join(tmpdir(),'strategy-refresh-weather-failure-')),'weather.sqlite');
  let now=new Date('2026-10-29T02:00:00Z'),modelCalls=0,weatherReads=0;
  const assistantModel={describe:()=>({configured:true,provider:'test',model:'fixed'}),async complete(){modelCalls++;return {content:JSON.stringify(parkProposal(1)),toolCalls:[]};}};
  let app=createApp({dbPath,generator:new RuleGenerator(),clock:()=>now,assistantModel});
  try{
    const original=await app.parkPlans.compute('demo-hainan');
    const savedBody=app.store.db.prepare('SELECT body FROM park_tapping_plans WHERE id=?').get(original.id).body;
    assert.equal(modelCalls,1);await app.close();app=null;now=new Date(+now+3*60000);
    app=createApp({dbPath,generator:new RuleGenerator(),clock:()=>now,assistantModel,
      strategyRefreshConfig:{enabled:true,intervalMinutes:60,modelsEnabled:true},
      publicDataService:{status:()=>({sources:[],location:{confirmed:false}}),async get(){weatherReads++;throw Object.assign(Error('测试天气服务超时'),{code:'SOURCE_TIMEOUT'});}}});
    app.strategyRefresh.setPrepareSnapshots(async()=>{});app.strategyRefresh.start();await app.strategyRefresh.tick();
    assert.equal(weatherReads,1);assert.equal(modelCalls,1,'weather failure must be rejected before the paid request');
    assert.equal(app.store.db.prepare('SELECT count(*) n FROM park_tapping_plans').get().n,1);
    assert.equal(app.store.db.prepare('SELECT body FROM park_tapping_plans WHERE id=?').get(original.id).body,savedBody);
    const status=app.strategyRefresh.status('demo-hainan');assert.equal(status.status,'partial');
    assert.equal(status.items.find(item=>item.kind==='park_plan').error.code,'STRATEGY_WEATHER_UNAVAILABLE');
    assert.equal(status.items.find(item=>item.kind==='market_sales').status,'succeeded');
  }finally{await app?.close();}
});
