import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {planModel,parkProposal} from './helpers/park-plan-model.js';

const SITE='demo-xsbn';
const START=new Date('2026-10-25T21:00:00Z'); // 10/26 05:00 Beijing
function rawWeather(now,rain=0){
  const start=Math.floor(+now/3600000)*3600-24*3600;
  const time=Array.from({length:220},(_,i)=>start+i*3600);
  return {latitude:22,longitude:100.8,
    hourly_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation_probability:'%',rain:'mm',showers:'mm',soil_moisture_0_to_1cm:'m³/m³'},
    hourly:{time,temperature_2m:time.map(()=>27),relative_humidity_2m:time.map(()=>70),precipitation_probability:time.map(()=>rain?90:10),
      rain:time.map(at=>at>=Math.floor(+now/3600000)*3600?rain:0),showers:time.map(()=>0),soil_moisture_0_to_1cm:time.map(()=>0.3)},
    current_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm'},
    current:{time:Math.floor(+now/1000),interval:900,temperature_2m:27,relative_humidity_2m:70,precipitation:rain}};
}
async function fixture(t,options={}){
  let now=START,rain=0;const calls=[],modelRequests=[],planner=planModel();
  const assistantModel={...planner,async complete(input){modelRequests.push(structuredClone(input));return planner.complete(input);}};
  const publicDataService={status:()=>({sources:[],location:{siteId:SITE,confirmed:false}}),
    async get(url){calls.push(url);await new Promise(resolve=>setImmediate(resolve));return rawWeather(now,rain);}};
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),automaticDataMode:'demo',requireIdentity:true,
    clock:()=>now,publicDataService,assistantModel,...options});
  t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const token=app.identities.login({accountId:'manager-xs'}).token;
  const call=async(path,input,status=200)=>{
    const headers={'X-Rubber-Session':token,...(input===undefined?{}:{'Content-Type':'application/json'})};
    const response=await fetch(base+path,input===undefined?{headers}:{method:'POST',headers,body:JSON.stringify(input)});
    const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data).slice(0,500)}`);return data;
  };
  const turn=async(mode)=>{
    const session=await call('/api/assistant/sessions',{siteId:SITE},201);
    const accepted=await call(`/api/assistant/sessions/${session.sessionId}/turns`,{message:'这周全园割胶怎么安排？',mode},202);
    await app.assistant.queue;
    return {session,result:await call(`/api/assistant/sessions/${session.sessionId}/turns/${accepted.turnId}`)};
  };
  return {app,call,calls,turn,modelRequests,rain:value=>{rain=value;},advance:ms=>{now=new Date(+now+ms);}};
}

test('online park plan endpoints fetch before calculation and adoption; latest and saved plans expose changed weather',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call(`/api/park-plan/latest?siteId=${SITE}`)).plan,null);
  assert.equal(f.calls.length,1);
  const plan=await f.call('/api/park-plan',{siteId:SITE},201);
  assert.equal(plan.weather.mode,'live');assert.equal(plan.weather.status,'available');assert.equal(plan.weatherCheck.needsRecompute,false);
  assert.equal(plan.horizon.start,'2026-10-26');assert.equal(plan.horizon.end,'2026-11-01');
  assert.ok(plan.production.expectedDryKg>0);
  assert.ok(plan.zones.flatMap(zone=>zone.schedule).every(slot=>slot.start==='06:00'&&slot.end<='12:00'));
  const clear=await f.call(`/api/simulation/constraints?siteId=${SITE}`);
  assert.equal(clear.liveWeather.enabled,true);assert.equal(clear.liveWeather.allowed,true);
  f.advance(6*60000);f.rain(3);
  const rejected=await f.call(`/api/park-plan/${plan.id}/adopt`,{siteId:SITE},409);
  assert.equal(rejected.error.code,'PLAN_WEATHER_CHANGED');assert.equal(f.calls.length,2,'adoption refreshes weather older than five minutes');
  assert.equal((await f.call(`/api/park-plan/latest?siteId=${SITE}`)).plan.weatherCheck.needsRecompute,true);
  assert.equal((await f.call(`/api/park-plan/${plan.id}?siteId=${SITE}`)).plan.weatherCheck.needsRecompute,true);
  const pause=await f.call('/api/park-plan',{siteId:SITE},201);
  assert.equal(pause.stance,'pause');assert.equal(pause.production.expectedDryKg,0);assert.equal(pause.weatherCheck.needsRecompute,false);
  assert.equal((await f.call(`/api/park-plan/${pause.id}/adopt`,{siteId:SITE})).adoption.taskIds.length,0);
  const wet=await f.call(`/api/simulation/constraints?siteId=${SITE}`);
  assert.equal(wet.liveWeather.allowed,false);
  const count=f.calls.length;
  await f.call('/api/park-plan/latest?siteId=demo-hainan',undefined,403);
  assert.equal(f.calls.length,count,'unauthorized park cannot trigger its weather request');
});

test('workspace brief reports a stale weather plan without invoking the model or changing saved plans',async t=>{
  const f=await fixture(t);
  const plan=await f.call('/api/park-plan',{siteId:SITE},201);
  f.advance(61*60000);f.rain(3);
  const brief=await f.call(`/api/workspace/brief?siteId=${SITE}`);
  const item=brief.items.find(item=>item.id==='park-plan');
  assert.match(item.title,/需由大模型生成/);assert.equal(item.action.planId,undefined);
  assert.deepEqual(item.sourceRefs,[plan.id]);
  assert.equal(f.app.parkPlans.latest(SITE).id,plan.id);
  assert.equal(f.app.parkPlans.latest(SITE).weatherCheck.needsRecompute,true);
  assert.equal(f.modelRequests.length,1,'the workbench does not call or save a replacement model proposal');
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0);
});

test('demo assistant directs users to model generation without calling a model or creating a rule substitute',async t=>{
  const f=await fixture(t,{pauseModelsOnStart:true});f.rain(3);
  const {result}=await f.turn('demo');
  assert.equal(result.status,'completed',result.error);assert.equal(f.calls.length,0);
  assert.equal(f.modelRequests.length,0);assert.ok(!result.tools.some(item=>item.name==='plan_park_tapping'));
  assert.match(result.answer,/规则演示不会生成新的经营方案.*已配置模型/);
  assert.equal(f.app.parkPlans.latest(SITE),null);assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0);
});

test('configured assistant waits for a plan tool weather refresh before the next model round',async t=>{
  const requests=[];
  const assistantModel={describe:()=>({configured:true,model:'weather-fixture'}),async complete(input){
    requests.push(structuredClone(input));
    if(!input.tools?.length)return {content:JSON.stringify(parkProposal(3)),toolCalls:[]};
    return requests.filter(request=>request.tools?.length).length===1?{toolCalls:[{id:'live-plan',name:'plan_park_tapping',arguments:{}}]}:
      {content:'结论：天气不适宜，本周暂停割胶。\n下一步：查看全园割胶策略。',toolCalls:[]};
  }};
  const f=await fixture(t,{assistantModel});f.rain(3);
  const {result}=await f.turn('configured');
  assert.equal(result.status,'completed',result.error);assert.equal(f.calls.length,1);assert.equal(requests.length,3);
  assert.equal(requests[1].tools?.length??0,0,'the middle request generates the actual business proposal');
  const message=requests[2].messages.find(message=>message.role==='tool'&&message.tool_call_id==='live-plan');
  const data=JSON.parse(message.content);
  assert.equal(data.weather.mode,'live');assert.equal(data.weatherCheck.needsRecompute,false);
  assert.equal(data.production.expectedDryKg,0);assert.equal(data.stance,'暂停割胶');
  assert.ok(data.modelProposal.zones.every(zone=>zone.frequencyPerWeek===3),'the model suggested three before weather constraints');
  assert.ok(data.constraintAdjustments.some(row=>row.kind==='weather'&&row.finalFrequency===0));
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0);
});
