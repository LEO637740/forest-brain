import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {AppError} from '../src/errors.js';
import {parkProposal} from './helpers/park-plan-model.js';

const SITE='demo-xsbn',START=new Date('2026-10-26T21:00:00Z');
const recorded=value=>({value,mode:'operator_confirmed',sourceLabel:'景洪实盘测试记录',observedAt:START.toISOString()});
const businessInputs=()=>({cost:recorded(2),demand:recorded(500),
  inventory:{stockKg:0,heldKg:0,storageKg:900,mode:'operator_confirmed',sourceLabel:'景洪仓库盘点',observedAt:START.toISOString()}});

function sources() {
  const metadata={retrievedAt:START.toISOString(),validUntil:new Date(+START+86400000).toISOString(),stale:false,status:'available'};
  return [{...metadata,id:'market',provider:'上海期货交易所',sourceUrl:'https://www.shfe.com.cn/data/tradedata/future/dailydata/kx20261026.dat',snapshotId:'market-test',
    data:{priceType:'futures',currency:'CNY',priceUnit:'CNY/tonne',tradeDate:'2026-10-26',contracts:[{contract:'RU2701',settlementCnyPerTonne:19685,previousSettlementCnyPerTonne:19615,volumeLots:1000}]}},
  {...metadata,id:'monthly_report',provider:'农业农村部农垦局',sourceUrl:'https://nkj.moa.gov.cn/rzny/',snapshotId:'spot-test',
    data:{publishedAt:'2026-10-15T02:50:00Z',metrics:[{name:'云南鲜胶乳折干胶月均价',value:17333,unit:'CNY/tonne_dry_rubber',scope:'云南产区',period:'2026-09'}]}}];
}
function weather(now,rain=0) {
  const first=Math.floor(+now/3600000)*3600-24*3600,time=Array.from({length:220},(_,i)=>first+i*3600);
  return {latitude:22,longitude:100.8,
    hourly_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation_probability:'%',rain:'mm',showers:'mm',soil_moisture_0_to_1cm:'m³/m³'},
    hourly:{time,temperature_2m:time.map(()=>27),relative_humidity_2m:time.map(()=>70),precipitation_probability:time.map(()=>rain?95:10),
      rain:time.map(at=>at>=Math.floor(+now/3600000)*3600?rain:0),showers:time.map(()=>0),soil_moisture_0_to_1cm:time.map(()=>0.3)},
    current_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm'},
    current:{time:Math.floor(+now/1000),interval:900,temperature_2m:27,relative_humidity_2m:70,precipitation:rain}};
}
async function fixture(t,{frequency=2,complete,configured=true,noModel=false}={}) {
  let now=START,rain=0,requestedFrequency=frequency;
  const modelRequests=[],publicSources=sources();
  const assistantModel={describe:()=>({configured,provider:'test-provider',model:'independent-park-adviser'}),isConfigured:()=>configured,
    async complete(input){
      modelRequests.push(structuredClone(input));
      if(complete)return complete(input,modelRequests.length);
      return {content:JSON.stringify(parkProposal(requestedFrequency)),toolCalls:[],usage:{promptTokens:123,completionTokens:45}};
    }};
  const publicDataService={status:()=>({sources:publicSources,location:{siteId:SITE,confirmed:false}}),async get(){return weather(now,rain);}};
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),assistantModel:noModel?undefined:assistantModel,publicDataService,
    automaticDataMode:'demo',clock:()=>now,requireIdentity:false});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`,tokens=new Map();
  const token=accountId=>{
    if(!tokens.has(accountId))tokens.set(accountId,app.identities.login({accountId}).token);
    return tokens.get(accountId);
  };
  async function call(path,{method='GET',input,accountId='manager-xs',status=200}={}) {
    const response=await fetch(base+path,{method,headers:{...(accountId?{'X-Rubber-Session':token(accountId)}:{}),
      ...(input===undefined?{}:{'Content-Type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data).slice(0,1200)}`);return data;
  }
  const compute=(options={})=>call('/api/park-plan',{method:'POST',input:{siteId:SITE},status:201,...options});
  const save=inputs=>call('/api/park-plan/inputs',{method:'PUT',input:{siteId:SITE,inputs}});
  return {app,call,compute,save,token,modelRequests,publicSources,frequency:value=>{requestedFrequency=value;},
    advance:ms=>{now=new Date(+now+ms);},rain:value=>{rain=value;}};
}
const storedPlans=f=>f.app.store.db.prepare('SELECT COUNT(*) AS count FROM park_tapping_plans').get().count;

test('the model sees source-labelled economics and its own changed advice determines the actual weekly frequency',async t=>{
  const f=await fixture(t,{frequency:1}),inputs=businessInputs();
  // These inputs would force the previous rule engine to pause. The new
  // scheduler must not secretly second-guess the model's business decision.
  inputs.cost=recorded(100);inputs.demand=recorded(0);await f.save(inputs);
  const first=await f.compute();
  f.frequency(3);f.advance(1000);
  const second=await f.compute();
  assert.equal(first.frequencyPerWeek,1);assert.equal(second.frequencyPerWeek,3);
  assert.equal(first.modelProposal.mode,'llm');assert.equal(second.modelProposal.mode,'llm');
  assert.deepEqual(second.modelProposal.zones.map(row=>row.frequencyPerWeek),[3,3,3,3]);
  assert.equal(second.modelProposal.model,'independent-park-adviser');
  assert.equal(f.modelRequests.length,2);
  const modelText=f.modelRequests[0].messages.map(message=>message.content).join('\n');
  for(const value of ['RU2701','17.333','operator_confirmed','public_reference','景洪仓库盘点','cost','demand','stock'])assert.ok(modelText.includes(value),value);
  assert.match(modelText,/100/);
  assert.doesNotMatch(modelText,/marketScore|priceScore|thresholdRatio|经营信号合计|达到 ±1%/);
  const projections=second.modelProposal.inputSnapshot.economics.uniformFrequencyProjections;
  assert.deepEqual(projections.map(row=>row.frequencyPerWeek),[0,1,2,3]);
  assert.equal(projections[3].productionKg,171.9);
  assert.equal(projections[3].remainingStorageKg,728.1);
  assert.equal(second.economics.inputs.find(row=>row.key==='cost').value,100);
  assert.equal(second.economics.inputs.find(row=>row.key==='demand').value,0);
  assert.ok(second.production.expectedDryKg>first.production.expectedDryKg);
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0,'a model proposal is not adoption');
});

test('GET latest, saved plans and the workbench never generate a model strategy',async t=>{
  const f=await fixture(t);
  for(let i=0;i<2;i++){
    assert.equal((await f.call(`/api/park-plan/latest?siteId=${SITE}`)).plan,null);
    await f.call(`/api/workspace/brief?siteId=${SITE}`);
  }
  assert.equal(f.modelRequests.length,0);assert.equal(storedPlans(f),0);
  await f.save(businessInputs());const plan=await f.compute();
  await f.save({...businessInputs(),cost:recorded(7)});
  for(const path of [`/api/park-plan/latest?siteId=${SITE}`,`/api/park-plan/${plan.id}?siteId=${SITE}`,`/api/workspace/brief?siteId=${SITE}`])await f.call(path);
  assert.equal(f.modelRequests.length,1);assert.equal(storedPlans(f),1);
});

test('hard limits adjust the original model proposal and retain both original and executable frequencies',async t=>{
  const f=await fixture(t,{frequency:5});await f.save(businessInputs());
  const care=await f.compute();
  assert.deepEqual(care.modelProposal.zones.map(row=>row.frequencyPerWeek),[5,5,5,5]);
  assert.ok(care.zones.every(zone=>zone.frequency<=3));
  assert.equal(care.readiness.readyCount,191);assert.equal(care.readiness.reviewCount,9);
  const excluded=new Set(care.readiness.reviewTrees.map(row=>row.treeIndex));
  assert.ok(care.zones.every(zone=>zone.treeIndices.every(index=>!excluded.has(index))));
  assert.ok(care.constraintAdjustments.some(row=>row.kind==='care'));
  await f.save({...businessInputs(),inventory:{...businessInputs().inventory,stockKg:895}});
  const tight=await f.compute();
  assert.ok(tight.production.expectedDryKg<=5);
  assert.ok(tight.constraintAdjustments.some(row=>row.kind==='capacity'));
  assert.deepEqual(tight.modelProposal.zones.map(row=>row.frequencyPerWeek),[5,5,5,5]);
});

test('rain and device stops remain hard constraints even when the model requests increased production',async t=>{
  const f=await fixture(t,{frequency:3});await f.save(businessInputs());
  f.app.assistant.simulation.operationalEvents.create({requestId:'model-fault',siteId:SITE,kind:'device_fault',zone:2,note:'C区设备待修'});
  const fault=await f.compute();assert.equal(fault.zones[2].frequency,0);
  assert.equal(fault.zones[1].frequency,3);assert.ok(fault.constraintAdjustments.some(row=>row.kind==='device'&&row.zone==='C'));
  f.rain(3);f.advance(61*60000); // The weather cache refreshes hourly.
  const rainy=await f.compute();assert.equal(rainy.frequencyPerWeek,0);
  assert.ok(rainy.zones.every(zone=>zone.dates.length===0));
  assert.deepEqual(rainy.modelProposal.zones.map(row=>row.frequencyPerWeek),[3,3,3,3]);
  assert.ok(rainy.constraintAdjustments.some(row=>row.kind==='weather'));
});

test('model failure keeps the old plan intact and never creates a fallback rule plan',async t=>{
  const f=await fixture(t,{complete:(_input,count)=>{
    if(count>1)throw new AppError('LLM_SERVICE_UNAVAILABLE','测试模型不可用',503);
    return {content:JSON.stringify(parkProposal(2)),toolCalls:[]};
  }});await f.save(businessInputs());const old=await f.compute();
  const failure=await f.compute({status:503});assert.equal(failure.error.code,'LLM_SERVICE_UNAVAILABLE');
  assert.equal(storedPlans(f),1);
  const latest=(await f.call(`/api/park-plan/latest?siteId=${SITE}`)).plan;
  assert.equal(latest.id,old.id);assert.deepEqual(latest.modelProposal,old.modelProposal);
});

test('repeated unsupported differences fail generation and do not replace an existing plan',async t=>{
  const f=await fixture(t,{complete:(_input,count)=>{
    const answer=parkProposal(2);
    if(count>1)answer.zones[1].frequencyPerWeek=3;
    return {content:JSON.stringify(answer),toolCalls:[]};
  }});
  await f.save(businessInputs());const old=await f.compute();
  const failure=await f.compute({status:502});
  assert.equal(failure.error.code,'PARK_MODEL_INCONSISTENT_ZONES');
  assert.equal(f.modelRequests.length,3,'only one corrective model call');
  assert.equal(storedPlans(f),1);
  assert.equal((await f.call(`/api/park-plan/latest?siteId=${SITE}`)).plan.id,old.id);
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0);
});

test('a saved model plan with unsupported differences between equal zones cannot be adopted',async t=>{
  const f=await fixture(t);await f.save(businessInputs());
  const plan=await f.compute();
  const historical=structuredClone(plan);
  historical.id='park-plan-cccccccccccccccccccc';
  // Simulate a previously saved response, preserving the equal zone snapshot the
  // model actually saw, and an unsupported difference in the model output.
  const b=historical.modelProposal.inputSnapshot.zones.find(row=>row.zone==='B');
  for(const zone of ['C','D']){
    const index=historical.modelProposal.inputSnapshot.zones.findIndex(row=>row.zone===zone);
    historical.modelProposal.inputSnapshot.zones[index]={...structuredClone(b),zone};
  }
  historical.modelProposal.zones.find(row=>row.zone==='B').frequencyPerWeek=3;
  f.app.parkPlans.save(historical);
  const read=(await f.call(`/api/park-plan/${historical.id}?siteId=${SITE}`)).plan;
  assert.equal(read.economicCheck.needsRecompute,true);
  const rejected=await f.call(`/api/park-plan/${historical.id}/adopt`,{method:'POST',input:{siteId:SITE},status:409});
  assert.equal(rejected.error.code,'PARK_MODEL_INCONSISTENT_ZONES');
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0);
});

test('old model plans need a verifiable four-zone input snapshot before first adoption',async t=>{
  const f=await fixture(t);await f.save(businessInputs());const plan=await f.compute();
  for(const [id,removeSnapshot] of [['park-plan-dddddddddddddddddddd',true],['park-plan-eeeeeeeeeeeeeeeeeeee',false]]){
    const historical=structuredClone(plan);historical.id=id;
    if(removeSnapshot)delete historical.modelProposal.inputSnapshot;
    else historical.modelProposal.inputSnapshot.zones=historical.modelProposal.inputSnapshot.zones.slice(0,3);
    f.app.parkPlans.save(historical);
    const read=(await f.call(`/api/park-plan/${id}?siteId=${SITE}`)).plan;
    assert.equal(read.economicCheck.needsRecompute,true);
    const rejected=await f.call(`/api/park-plan/${id}/adopt`,{method:'POST',input:{siteId:SITE},status:409});
    assert.equal(rejected.error.code,'PARK_MODEL_INPUT_REQUIRED');
  }
  const adopted=structuredClone(plan);adopted.id='park-plan-ffffffffffffffffffff';
  delete adopted.modelProposal.inputSnapshot;
  adopted.adoption={adoptedAt:START.toISOString(),adoptedBy:'manager-xs',taskIds:[],skipped:[],replacedTaskIds:[]};
  f.app.parkPlans.save(adopted);
  const repeat=await f.call(`/api/park-plan/${adopted.id}/adopt`,{method:'POST',input:{siteId:SITE}});
  assert.equal(repeat.adoption.adoptedAt,adopted.adoption.adoptedAt);
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0);
});

test('an unconfigured model cannot create a rule-based substitute',async t=>{
  const f=await fixture(t,{noModel:true});await f.save(businessInputs());
  const failure=await f.compute({status:503});
  assert.equal(failure.error.code,'LLM_NOT_CONFIGURED');assert.equal(storedPlans(f),0);
  assert.equal((await f.call(`/api/park-plan/latest?siteId=${SITE}`)).plan,null);
});

test('legacy rule plans stay readable but cannot be newly adopted as model strategies',async t=>{
  const f=await fixture(t);await f.save(businessInputs());const plan=await f.compute();
  const legacy={...plan,id:'park-plan-aaaaaaaaaaaaaaaaaaaa',policyVersion:'park-tapping-intensity-v4-economics'};
  delete legacy.modelProposal;delete legacy.decisionMode;
  f.app.parkPlans.save(legacy);
  const read=(await f.call(`/api/park-plan/${legacy.id}?siteId=${SITE}`)).plan;
  assert.equal(read.modelProposal,undefined);assert.equal(read.economicCheck.needsRecompute,true);
  const rejected=await f.call(`/api/park-plan/${legacy.id}/adopt`,{method:'POST',input:{siteId:SITE},status:409});
  assert.equal(rejected.error.code,'PLAN_MODEL_REQUIRED');
  const historical={...legacy,id:'park-plan-bbbbbbbbbbbbbbbbbbbb',adoption:{adoptedAt:START.toISOString(),adoptedBy:'manager-xs',taskIds:[],skipped:[],replacedTaskIds:[]}};
  f.app.parkPlans.save(historical);
  const repeat=await f.call(`/api/park-plan/${historical.id}/adopt`,{method:'POST',input:{siteId:SITE}});
  assert.equal(repeat.adoption.adoptedAt,historical.adoption.adoptedAt);
  assert.equal(repeat.modelProposal,undefined);assert.equal(f.modelRequests.length,1);
});

test('the model pause switch blocks calls before generation and publication after an in-flight pause',{timeout:15000},async t=>{
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();
  const f=await fixture(t,{complete:async()=>{entered.resolve();await gate.promise;return {content:JSON.stringify(parkProposal(2)),toolCalls:[]};}});
  await f.save(businessInputs());
  f.app.store.setModelPaused(true,START.toISOString());
  const blocked=await f.compute({status:409});assert.equal(blocked.error.code,'MODEL_PAUSED');assert.equal(f.modelRequests.length,0);
  f.app.store.setModelPaused(false,START.toISOString());
  const pending=f.compute({status:409});await entered.promise;
  f.app.store.setModelPaused(true,START.toISOString());gate.resolve();
  const stopped=await pending;assert.equal(stopped.error.code,'MODEL_PAUSED');assert.equal(storedPlans(f),0);
});

test('a pause or revoked identity between the first response and correction prevents the second model call',{timeout:15000},async t=>{
  for(const mode of ['pause','revoke']){
    let f;
    f=await fixture(t,{complete:()=>{
      if(mode==='pause')f.app.store.setModelPaused(true,START.toISOString());
      else f.app.identities.logout(f.token('manager-xs'));
      const answer=parkProposal(2);answer.zones[1].frequencyPerWeek=3;
      return {content:JSON.stringify(answer),toolCalls:[]};
    }});
    await f.save(businessInputs());
    const stopped=await f.compute({status:mode==='pause'?409:401});
    assert.equal(stopped.error.code,mode==='pause'?'MODEL_PAUSED':'SESSION_EXPIRED');
    assert.equal(f.modelRequests.length,1,`${mode} must stop the corrective model call`);
    assert.equal(storedPlans(f),0);
  }
});

test('unauthorized roles and parks cannot cause model requests, and revoked sessions cannot publish a pending plan',{timeout:15000},async t=>{
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();
  const f=await fixture(t,{complete:async()=>{entered.resolve();await gate.promise;return {content:JSON.stringify(parkProposal(2)),toolCalls:[]};}});
  for(const [accountId,status,siteId] of [[null,401,SITE],['operator-hn',403,'demo-hainan'],['grower-xs-yan',403,SITE],['manager-hn',403,SITE]]){
    await f.compute({accountId,status,input:{siteId}});
  }
  assert.equal(f.modelRequests.length,0);
  await f.save(businessInputs());
  const pending=f.compute({status:401});await entered.promise;
  f.app.identities.logout(f.token('manager-xs'));gate.resolve();
  const revoked=await pending;assert.equal(revoked.error.code,'SESSION_EXPIRED');assert.equal(storedPlans(f),0);
});
