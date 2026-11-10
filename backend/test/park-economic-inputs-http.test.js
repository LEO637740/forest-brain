import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {parkProposal} from './helpers/park-plan-model.js';

const SITE='demo-xsbn';
const START=new Date('2026-10-26T21:00:00Z');
const confirmed=value=>({value,mode:'operator_confirmed',sourceLabel:'测试园区已核对记录',observedAt:START.toISOString()});
const settings=()=>({cost:confirmed(2),demand:confirmed(500),inventory:{stockKg:300,heldKg:0,storageKg:900,
  mode:'operator_confirmed',sourceLabel:'景洪仓库盘点',observedAt:START.toISOString()}});

function publicSources() {
  const common={provider:'上海期货交易所',sourceUrl:'https://official.example/quotation',
    retrievedAt:new Date(+START-1800000).toISOString(),validUntil:new Date(+START+86400000).toISOString(),stale:false,status:'available'};
  return [{...common,id:'market',snapshotId:'market-1',data:{priceType:'futures',currency:'CNY',priceUnit:'CNY/tonne',
    tradeDate:'2026-10-26',contracts:[{contract:'RU2701',settlementCnyPerTonne:20400,previousSettlementCnyPerTonne:20000,volumeLots:100}]}},
  {...common,id:'monthly_report',snapshotId:'spot-1',provider:'农业农村部农垦局',data:{publishedAt:'2026-10-15T02:50:00Z',
    metrics:[{name:'云南鲜胶乳折干胶月均价',value:17333,unit:'CNY/tonne_dry_rubber',scope:'云南产区监测点',period:'2026-09'}]}}];
}
function rawWeather(now) {
  const start=Math.floor(+now/3600000)*3600-24*3600;
  const time=Array.from({length:220},(_,index)=>start+index*3600);
  return {latitude:22,longitude:100.8,
    hourly_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation_probability:'%',rain:'mm',showers:'mm',soil_moisture_0_to_1cm:'m³/m³'},
    hourly:{time,temperature_2m:time.map(()=>27),relative_humidity_2m:time.map(()=>70),precipitation_probability:time.map(()=>10),
      rain:time.map(()=>0),showers:time.map(()=>0),soil_moisture_0_to_1cm:time.map(()=>0.3)},
    current_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm'},
    current:{time:Math.floor(+now/1000),interval:900,temperature_2m:27,relative_humidity_2m:70,precipitation:0}};
}
async function fixture(t) {
  let now=START,modelFrequency=3;
  const modelRequests=[];
  const sources=publicSources();
  const publicDataService={status:()=>({sources,location:{siteId:SITE,confirmed:false}}),async get(){return rawWeather(now);}};
  // requireIdentity=false also verifies these sensitive routes close the legacy anonymous path.
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),
    automaticDataMode:'demo',requireIdentity:false,clock:()=>now,publicDataService,
    assistantModel:{describe:()=>({configured:true,provider:'test',model:'economic-input-test'}),
      async complete(input){modelRequests.push(structuredClone(input));return {content:JSON.stringify(parkProposal(modelFrequency)),toolCalls:[]};}}});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const tokens=new Map();
  const token=accountId=>{
    if(!tokens.has(accountId))tokens.set(accountId,app.identities.login({accountId}).token);
    return tokens.get(accountId);
  };
  const call=async(path,{method='GET',input,accountId='manager-xs',status=200}={})=>{
    const headers={...(accountId?{'X-Rubber-Session':token(accountId)}:{}),...(input===undefined?{}:{'Content-Type':'application/json'})};
    const response=await fetch(base+path,{method,headers,...(input===undefined?{}:{body:JSON.stringify(input)})});
    const data=await response.json();
    assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data).slice(0,700)}`);
    return data;
  };
  const save=inputs=>call('/api/park-plan/inputs',{method:'PUT',input:{siteId:SITE,inputs}});
  const compute=()=>call('/api/park-plan',{method:'POST',input:{siteId:SITE},status:201});
  const adopt=(plan,replace=false)=>call(`/api/park-plan/${plan.id}/adopt`,{method:'POST',input:{siteId:SITE,replace}});
  return {app,call,save,compute,adopt,sources,modelRequests,propose:frequency=>{modelFrequency=frequency;},advance:ms=>{now=new Date(+now+ms);}};
}

test('manager input GET/PUT persists source records and recomputation leaves the saved plan evidence unchanged',async t=>{
  const f=await fixture(t);
  const empty=await f.call(`/api/park-plan/inputs?siteId=${SITE}`);
  assert.deepEqual(empty.inputs,{});
  const input=settings(),saved=await f.save(input);
  assert.equal(saved.siteId,SITE);assert.equal(saved.updatedBy,'manager-xs');assert.deepEqual(saved.inputs,input);
  assert.deepEqual((await f.call(`/api/park-plan/inputs?siteId=${SITE}`)).inputs,input);
  const original=await f.compute();
  assert.equal(original.economicCheck.needsRecompute,false);assert.equal(original.frequencyPerWeek,3);
  const changed={...input,cost:confirmed(10)};await f.save(changed);
  const stale=(await f.call(`/api/park-plan/${original.id}?siteId=${SITE}`)).plan;
  assert.equal(stale.economicCheck.needsRecompute,true);
  assert.deepEqual(stale.economics,original.economics);
  assert.deepEqual(stale.production,original.production);
  f.propose(0); // The model, not a cost threshold in the scheduler, decides to pause.
  const fresh=await f.compute();
  assert.notEqual(fresh.id,original.id);assert.equal(fresh.frequencyPerWeek,0);
  assert.equal(fresh.economics.inputs.find(row=>row.key==='cost').value,10);
  assert.match(f.modelRequests.at(-1).messages.map(message=>message.content).join('\n'),/"value"\s*:\s*10/);
  assert.equal(fresh.economicCheck.needsRecompute,false);
  assert.equal(f.app.assistant.simulation.latestTasks(SITE).length,0,'saving inputs and calculating never adopts tasks');
});

test('only the retrieval time changing preserves the economic fingerprint and pending adoption',async t=>{
  const f=await fixture(t);await f.save(settings());
  const plan=await f.compute();
  for(const source of f.sources)source.retrievedAt=new Date(Date.parse(source.retrievedAt)+60000).toISOString();
  const reopened=(await f.call(`/api/park-plan/${plan.id}?siteId=${SITE}`)).plan;
  assert.equal(reopened.economicCheck.needsRecompute,false);
  assert.equal(f.app.parkPlans.resolveEconomicInputs(SITE).fingerprint,plan.economics.fingerprint);
  assert.ok((await f.adopt(plan)).adoption.taskIds.length>0);
});

for(const kind of ['cost','inventory','market'])test(`${kind} changes reject a pending plan before replacing tasks and adopted plans remain idempotent`,async t=>{
  const f=await fixture(t),input=settings();await f.save(input);
  const original=await f.compute(),adopted=await f.adopt(original);
  assert.ok(adopted.adoption.taskIds.length>0);
  f.advance(1000);
  const pending=await f.compute();assert.notEqual(pending.id,original.id);
  const before=structuredClone(f.app.assistant.simulation.latestTasks(SITE));
  if(kind==='cost')await f.save({...input,cost:confirmed(10)});
  if(kind==='inventory')await f.save({...input,inventory:{...input.inventory,stockKg:850}});
  if(kind==='market'){
    f.sources[0].data.contracts[0].settlementCnyPerTonne=19600;
    f.sources[0].snapshotId='market-2';
  }
  assert.equal((await f.call(`/api/park-plan/${pending.id}?siteId=${SITE}`)).plan.economicCheck.needsRecompute,true);
  const rejected=await f.call(`/api/park-plan/${pending.id}/adopt`,{method:'POST',input:{siteId:SITE,replace:true},status:409});
  assert.equal(rejected.error.code,'PLAN_ECONOMICS_CHANGED');
  assert.deepEqual(f.app.assistant.simulation.latestTasks(SITE),before,'stale economics must not cancel or replace existing work');
  const replay=await f.adopt(original,true);
  assert.deepEqual(replay.adoption,adopted.adoption);
  assert.deepEqual(replay.economics,original.economics);
  assert.deepEqual(f.app.assistant.simulation.latestTasks(SITE),before);
});

test('economic inputs enforce anonymous, role, park and center read-only boundaries on GET and PUT',async t=>{
  const f=await fixture(t),input={siteId:SITE,inputs:settings()};
  for(const method of ['GET','PUT'])await f.call(`/api/park-plan/inputs${method==='GET'?`?siteId=${SITE}`:''}`,
    {method,...(method==='PUT'?{input}:{}),accountId:null,status:401});
  for(const [accountId,siteId] of [['operator-hn','demo-hainan'],['grower-xs-yan',SITE]])for(const method of ['GET','PUT']){
    await f.call(`/api/park-plan/inputs${method==='GET'?`?siteId=${siteId}`:''}`,
      {method,...(method==='PUT'?{input:{...input,siteId}}:{}),accountId,status:403});
  }
  await f.save(input.inputs);
  await f.call(`/api/park-plan/inputs?siteId=${SITE}`,{accountId:'manager-hn',status:403});
  await f.call('/api/park-plan/inputs',{method:'PUT',input,accountId:'manager-hn',status:403});
  const center=await f.call(`/api/park-plan/inputs?siteId=${SITE}`,{accountId:'center-hz'});
  assert.deepEqual(center.inputs,input.inputs);
  await f.call('/api/park-plan/inputs',{method:'PUT',input:{...input,inputs:{cost:confirmed(10)}},accountId:'center-hz',status:403});
  assert.deepEqual((await f.call(`/api/park-plan/inputs?siteId=${SITE}`)).inputs,input.inputs,'rejected writes leave the manager record intact');
});

test('input contracts default assumption provenance, reject invalid actual records and expose expired orders as simulated demand',async t=>{
  const f=await fixture(t);
  const input={price:{value:17,mode:'assumption'},cost:{value:2,mode:'assumption'},yield:{value:0.3,mode:'assumption'},
    demand:{value:1,mode:'assumption'},inventory:{stockKg:0,heldKg:0,storageKg:900,mode:'assumption'}};
  const saved=await f.save(input);
  for(const item of Object.values(saved.inputs)){
    assert.equal(item.mode,'assumption');assert.equal(item.sourceLabel,'人工假设');assert.equal(item.observedAt,START.toISOString());
  }
  for(const cost of [{value:2,mode:'operator_confirmed'},
    {value:2,mode:'operator_confirmed',sourceLabel:'成本台账'},
    {value:2,mode:'operator_confirmed',observedAt:START.toISOString()}]){
    await f.call('/api/park-plan/inputs',{method:'PUT',input:{siteId:SITE,inputs:{cost}},status:422});
  }
  await f.call('/api/park-plan/inputs',{method:'PUT',input:{siteId:SITE,inputs:{cost:{value:-1,mode:'assumption'}}},status:422});
  await f.call('/api/park-plan/inputs',{method:'PUT',input:{siteId:SITE,inputs:{inventory:{stockKg:10,heldKg:11,storageKg:900,mode:'assumption'}}},status:422});
  assert.deepEqual((await f.call(`/api/park-plan/inputs?siteId=${SITE}`)).inputs,saved.inputs,'invalid submissions must preserve the last valid inputs');
  const oldOrders={...confirmed(800),observedAt:new Date(+START-8*86400000).toISOString()};
  await f.save({...settings(),demand:oldOrders});
  const plan=await f.compute(),demand=plan.economics.inputs.find(row=>row.key==='demand');
  assert.equal(demand.kind,'index');assert.equal(demand.mode,'simulated');
  assert.match(demand.note,/超过7天.*模拟需求/);
  assert.match(plan.economics.demandBasis,/模拟需求指数/);
  assert.deepEqual((await f.call(`/api/park-plan/inputs?siteId=${SITE}`)).inputs.demand,oldOrders,'fallback disclosure does not rewrite the operator history');
});
