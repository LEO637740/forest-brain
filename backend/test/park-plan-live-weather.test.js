import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel,modelProposal} from './helpers/park-plan-model.js';
import {calculateParkPlan,ParkPlanService} from '../src/park-plan.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';

const NOW=new Date('2026-10-25T21:00:00.000Z'); // 10/26 05:00 Beijing
const SITE='demo-xsbn';
const dateOf=day=>new Date(+NOW+8*3600000+day*86400000).toISOString().slice(0,10);
const at=(day,hour)=>new Date(`${dateOf(day)}T${String(hour).padStart(2,'0')}:00:00+08:00`).toISOString();
function weather(decision=()=> 'suitable',fingerprint='clear'){
 return {siteId:SITE,provider:'Open-Meteo',status:'available',stale:false,fetchedAt:NOW.toISOString(),validUntil:new Date(+NOW+7200000).toISOString(),decisionFingerprint:fingerprint,summary:'天气测试',
  windows:Array.from({length:7},(_,day)=>Array.from({length:6},(_,index)=>{
   const hour=6+index,suitability=decision(day,hour);
   return {start:at(day,hour),end:at(day,hour+1),suitability,rainfallMm:suitability==='defer'?3:0,rainProbabilityPct:suitability==='defer'?80:10,reason:suitability};
  })).flat()};
}
function input(liveWeather=weather()){
 const context=makeParkContext({siteId:SITE,now:NOW});
 context.modules.market.demand.value=120;
 return {modelProposal:modelProposal(3),siteId:SITE,now:NOW,context,inventory:{stockKg:300,availableKg:300},storageKg:900,plannedSalesKg:0,events:[],salesSource:'test',liveWeather};
}

test('live heavy rain overrides favourable prices and removes actual production dates and yield',()=>{
 const clear=calculateParkPlan(input());
 assert.ok(clear.production.expectedDryKg>0);
 const rainy=calculateParkPlan(input(weather(()=> 'defer','rain')));
 assert.equal(rainy.stance,'pause');assert.equal(rainy.marketTargetFrequency,3);assert.equal(rainy.production.expectedDryKg,0);
 assert.match(rainy.salesHint,/天气/);assert.doesNotMatch(rainy.salesHint,/行情偏弱/);
 assert.ok(rainy.zones.every(zone=>zone.frequency===0&&zone.dates.length===0&&zone.schedule.length===0));
 assert.ok(rainy.outlook.every(day=>!day.tappable&&day.blockReason==='rain'&&day.source==='live_weather'));
 assert.equal(rainy.weather.provider,'Open-Meteo');
 assert.ok(rainy.constraintAdjustments.some(row=>row.kind==='weather'&&row.finalFrequency===0));
 const typhoon=calculateParkPlan({...input(weather(()=> 'defer','rain')),economicScenarioId:'typhoon'});
 assert.equal(typhoon.production.expectedDryKg,0,'economic comparisons must keep the same real weather');
});

test('a zone is scheduled only inside a continuous suitable window with matching two-minute tree capacity',()=>{
 const plan=calculateParkPlan(input(weather((_day,hour)=>hour===8||hour===9?'suitable':'defer')));
 assert.ok(plan.zones.some(zone=>zone.schedule.length));
 for(const zone of plan.zones)for(const slot of zone.schedule){
  assert.equal(slot.start,'08:00');
  const actualMinutes=Number(slot.end.slice(0,2))*60+Number(slot.end.slice(3))-8*60;
  assert.equal(actualMinutes,Math.max(15,zone.eligibleTrees*2));
  assert.ok(Date.parse(`${slot.date}T${slot.end}:00+08:00`)<=Date.parse(slot.windowEnd));
 }
 assert.equal(plan.production.expectedDryKg,Math.round(plan.zones.reduce((sum,zone)=>sum+zone.eligibleTrees*zone.schedule.length*.3,0)*10)/10);
 const separated=calculateParkPlan(input(weather((_day,hour)=>hour===6||hour===8?'suitable':'defer')));
 assert.equal(separated.production.expectedDryKg,0,'two disconnected one-hour gaps must not form a two-hour task');
 assert.ok(separated.outlook.every(day=>day.blockReason==='short_window'));
});

test('short weather windows reduce actual zone frequency without inventing a small-rain percentage',()=>{
 const limited=calculateParkPlan(input(weather((day,hour)=>day===1||day===4||hour===6?'suitable':'defer')));
 assert.ok(limited.zones.every(zone=>zone.frequency===2));
 assert.equal(limited.marketTargetFrequency,3);assert.equal(limited.frequencyPerWeek,2);assert.equal(limited.stance,'hold');
 assert.ok(limited.zones.every(zone=>zone.dates.join(',')===[dateOf(1),dateOf(4)].join(',')));
 const clear=calculateParkPlan(input());
 assert.ok(limited.production.expectedDryKg<clear.production.expectedDryKg);
 assert.ok(limited.zones.every(zone=>zone.treeIndices.length===zone.eligibleTrees));
 const oneDay=calculateParkPlan(input(weather((day)=>day===1?'suitable':'defer')));
 assert.equal(oneDay.marketTargetFrequency,3);assert.equal(oneDay.stance,'reduce');
 assert.match(oneDay.salesHint,/天气/);assert.doesNotMatch(oneDay.salesHint,/行情偏弱/);
});

test('review, unavailable, stale and missing-day weather never fall back to synthetic safe dates',()=>{
 for(const liveWeather of [weather(()=> 'review','review'),null,{...weather(),status:'unavailable',stale:true,windows:[]},{...weather(),status:'refresh_failed'}, {...weather(),siteId:'demo-hainan'}]){
  const plan=calculateParkPlan(input(liveWeather));
  assert.equal(plan.stance,'pause');assert.equal(plan.production.expectedDryKg,0);
  assert.ok(plan.outlook.every(day=>day.source==='live_weather'));
 }
 const partial=weather();partial.windows=partial.windows.slice(0,6);
 const plan=calculateParkPlan(input(partial));
 assert.ok(plan.zones.every(zone=>zone.dates.every(date=>date===dateOf(0))));
 assert.ok(plan.outlook.slice(1).every(day=>day.blockReason==='missing_weather'));
});

function service(t){
 const store=new Store();t.after(()=>store.close());
 let current=weather();
 const context=options=>makeParkContext(options);
 const simulation=new SimulationService(store,()=>NOW,{contextFactory:context});
 const plans=new ParkPlanService({model:planModel(3),store,simulation,makeParkContext:context,clock:()=>NOW,dispatchDataMode:'demo',weather:{peek:()=>current}});
 return {store,simulation,plans,setWeather:value=>{current=value;}};
}

test('adoption uses the computed weather schedule and rejects weather changes or a legacy no-weather plan',async t=>{
 const app=service(t);
 app.setWeather(weather((_day,hour)=>hour===8||hour===9?'suitable':'defer','later'));
 const plan=(await app.plans.compute(SITE));
 assert.equal(plan.weatherCheck.needsRecompute,false);
 assert.ok(plan.zones.some(zone=>zone.schedule.length));
 app.setWeather({...weather(()=> 'defer','rain')});
 assert.equal(app.plans.latest(SITE).weatherCheck.needsRecompute,true);
 assert.throws(()=>app.plans.adopt({planId:plan.id}),error=>error.code==='PLAN_WEATHER_CHANGED');
 app.setWeather(weather((_day,hour)=>hour===8||hour===9?'suitable':'defer','later'));
 const adopted=app.plans.adopt({planId:plan.id});
 assert.ok(adopted.adoption.tasks.length);
 const tasks=app.simulation.latestTasks(SITE);
 assert.ok(tasks.every(task=>task.start==='08:00'&&task.end!=='—'));
 const legacy={...plan,id:'park-plan-legacy'};delete legacy.weather;
 assert.equal(app.plans.weatherCheck(legacy).needsRecompute,true);
 app.setWeather({...weather(),stale:true,status:'stale'});
 const pending=(await app.plans.compute(SITE));
 assert.throws(()=>app.plans.adopt({planId:pending.id}),error=>error.code==='PLAN_WEATHER_CHANGED');
});

test('a fresh rainy pause plan can be adopted to cancel unstarted work after replacement confirmation',async t=>{
 const app=service(t),clear=(await app.plans.compute(SITE));
 const first=app.plans.adopt({planId:clear.id});assert.ok(first.adoption.taskIds.length);
 app.setWeather(weather(()=> 'review','review'));
 const pause=(await app.plans.compute(SITE));assert.equal(pause.stance,'pause');
 assert.equal(pause.weatherCheck.needsRecompute,false);
 assert.throws(()=>app.plans.adopt({planId:pause.id}),error=>error.code==='PLAN_CONFLICT');
 const stopped=app.plans.adopt({planId:pause.id,replace:true});
 assert.equal(stopped.adoption.tasks.length,0);
 assert.equal(stopped.adoption.replacedTaskIds.length,first.adoption.taskIds.length);
 assert.ok(app.simulation.latestTasks(SITE).every(task=>task.status==='已取消'));
});
