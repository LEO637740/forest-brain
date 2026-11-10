import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel} from './helpers/park-plan-model.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {EudrReadinessService} from '../src/eudr-readiness.js';

const NOW=new Date('2026-10-21T06:00:00Z');
async function fixture(t) {
 const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),assistantModel:planModel(2),clock:()=>NOW,pauseModelsOnStart:false});
 t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,{input,token,status=200}={})=>{
  const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Rubber-Session':token}:{})},body:input===undefined?undefined:JSON.stringify(input)});
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return data;
 };
 const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
 const simulation=app.assistant.toolkit.simulation;
 let sequence=0;
 const processed=(id,indices=[0,50])=>{
  simulation.tasks({tasks:[{id,site:'hainan',title:`${id} 模拟割胶`,date:'2026-10-20',kind:'割胶',block:'A',robot:'R-A',start:'08:00',end:'09:00',status:'已完成',count:indices.length,done:indices.length,treeIndices:indices,
   dispatch:{phase:'completed',history:[{time:'2026-10-20T01:00:00Z',label:'模拟割胶完成'}]}}]});
  let batch=simulation.logistics.create({requestId:`collect-${++sequence}`,siteId:'demo-hainan',taskId:id,operator:'模拟收胶员',collectionPointId:'hn-collection-a',containerCount:2,note:'对应任务收胶'});
  const act=(action,extra={})=>batch=simulation.logistics.transition(batch.id,action,{requestId:`step-${++sequence}`,siteId:batch.siteId,revision:batch.revision,operator:'模拟经办人',note:`模拟${action}`,...extra});
  act('weigh',{grossKg:102,tareKg:2});
  act('inspect',{sampleId:`sample-${id}`,dryRubberPercent:34,decision:'pass'});
  act('plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-001',driver:'模拟司机',plannedDepartureAt:NOW.toISOString()});
  act('dispatch');act('receive',{receivedKg:100});act('process');
  return batch;
 };
 return {app,simulation,call,login,processed};
}

test('economics HTTP exposes five scenarios and applies typhoon to sales and whole-park plans',async t=>{
 const {call,login}=await fixture(t), token=await login('manager-hn');
 const catalog=await call('/api/economics/scenarios',{token});
 assert.deepEqual(catalog.items.map(item=>item.id),['baseline','typhoon','demand_weak','policy_supply','robot_recovery']);
 const baseline=await call('/api/simulation/market',{token,input:{siteId:'demo-hainan',economicScenarioId:'baseline',transportKgPerDay:40}});
 const model=await call('/api/simulation/market',{token,input:{siteId:'demo-hainan',economicScenarioId:'typhoon',transportKgPerDay:40}});
 assert.equal(model.economicScenarioId,'typhoon');
 assert.equal(model.params.transportKgPerDay,40);
 assert.equal(model.economicImpact.effective.transportKgPerDay,20);
 assert.equal(model.economicImpact.effective.costPerTapping,2.3);
 assert.ok(model.scenarios[1].produced<baseline.scenarios[1].produced);
 assert.ok(model.forecast[0].value>baseline.forecast[0].value);
 assert.ok(model.sales.scenarios.every(scenario=>scenario.daily.every(day=>day.soldKg<=20)));
 const park=await call('/api/park-plan',{token,input:{siteId:'demo-hainan',economicScenarioId:'typhoon'},status:201});
 assert.equal(park.economicScenarioId,'typhoon');
 assert.equal(park.economicImpact.scenarioId,'typhoon');
 assert.ok(park.zones.some(zone=>zone.excluded.some(item=>item.reason==='情景可作业容量受限')));
});

test('EUDR HTTP limits park and role scope, prepares only one processed batch and exports without changing inventory',async t=>{
 const {app,simulation,call,login,processed}=await fixture(t);
 const batch=processed('eudr-http-ab'), other=processed('eudr-http-c',[100]);
 const manager=await login('manager-hn'), otherManager=await login('manager-xs'), grower=await login('grower-hn-wang'), executive=await login('center-hz');
 const before=simulation.salesInventory('demo-hainan');
 const view=await call('/api/eudr/readiness?siteId=demo-hainan',{token:manager});
 assert.equal(view.batches.length,2);
 assert.equal(view.batches.find(item=>item.id===batch.id).status,'missing');
 await call('/api/eudr/readiness?siteId=demo-hainan',{token:grower,status:403});
 await call('/api/eudr/readiness?siteId=demo-hainan',{token:otherManager,status:403});
 assert.deepEqual((await call('/api/eudr/readiness?siteId=demo-xsbn',{token:otherManager})).batches,[]);
 await call('/api/eudr/demo-prepare',{token:otherManager,input:{siteId:'demo-hainan',batchId:batch.id},status:403});
 await call('/api/eudr/demo-prepare',{token:executive,input:{siteId:'demo-hainan',batchId:batch.id},status:403});
 await call(`/api/eudr/package?siteId=demo-xsbn&batchId=${batch.id}`,{token:otherManager,status:404});
 const prepared=await call('/api/eudr/demo-prepare',{token:manager,input:{siteId:'demo-hainan',batchId:batch.id}});
 assert.equal(prepared.status,'demo_prepared');
 assert.equal(prepared.dryKg,34);
 assert.deepEqual(prepared.sourceZones,['A','B']);
 assert.ok(prepared.evidence.every(item=>item.mode==='simulated'));
 await call(`/api/eudr/package?siteId=demo-hainan&batchId=${batch.id}`,{token:grower,status:403});
 const pack=await call(`/api/eudr/package?siteId=demo-hainan&batchId=${batch.id}`,{token:manager});
 assert.equal(pack.status,'demo_prepared');
 assert.deepEqual(pack.sourceRecord.treeIndices,[0,50]);
 assert.deepEqual(pack.batch.geojson.features.map(item=>item.id),['demo-hainan:A','demo-hainan:B']);
 assert.equal(pack.batch.ddsReference,null);
 assert.equal(pack.riskReview.status,'not_assessed');
 assert.equal(pack.shipmentAllocation.status,'unknown');
 assert.deepEqual(pack.flowChain.map(item=>item.action),['collect','weigh','inspect','plan','dispatch','receive','process']);
 assert.ok(!JSON.stringify(pack).includes(other.id));
 assert.match(pack.disclaimer,/不代表 EUDR 合规认证/);
 assert.deepEqual(simulation.salesInventory('demo-hainan'),before);
 const restored=new EudrReadinessService({store:app.store,simulation,clock:()=>NOW});
 assert.equal(restored.read('demo-hainan').batches.find(item=>item.id===batch.id).status,'demo_prepared');
 assert.equal(restored.read('demo-hainan').batches.find(item=>item.id===other.id).status,'missing');
 assert.deepEqual(restored.exportPack('demo-hainan',batch.id),pack);
});

test('rule assistant keeps the chosen economic scenario across follow-ups and reads current EUDR preparation',async t=>{
 const {app,simulation,call,login,processed}=await fixture(t), service=app.assistant;
 const session=service.createSession({siteId:'demo-hainan',role:'manager'});
 const send=async message=>{
  const accepted=service.submitTurn(session.sessionId,{message,mode:'demo'});
  await service.queue;
  const turn=service.getTurn(session.sessionId,accepted.turnId);
  assert.equal(turn.status,'completed',turn.error);
  return turn;
 };
 const first=await send('按台风情景生成销售方案，每天运力40公斤');
 assert.ok(first.tools.some(tool=>tool.name==='compare_market'));
 assert.ok(first.actions.some(action=>action.type==='market'));
 assert.equal(simulation.latestMarket('demo-hainan').model.economicScenarioId,'typhoon');
 assert.equal(simulation.latestMarket('demo-hainan').model.economicImpact.effective.transportKgPerDay,20);
 const next=await send('运力改为60公斤，继续比较销售方案');
 assert.equal(next.marketParams.economicScenarioId,'typhoon');
 assert.equal(simulation.latestMarket('demo-hainan').model.params.transportKgPerDay,60);
 assert.equal(simulation.latestMarket('demo-hainan').model.economicImpact.effective.transportKgPerDay,30);
 await send('恢复基线情景，重新生成销售方案');
 assert.equal(simulation.latestMarket('demo-hainan').model.economicScenarioId,'baseline');
 assert.equal(simulation.latestMarket('demo-hainan').model.economicImpact.effective.transportKgPerDay,60);
 const batch=processed('eudr-assistant-ab');
 const missing=await send('当前欧盟客户的EUDR资料还缺什么？');
 assert.ok(missing.tools.some(tool=>tool.name==='read_eudr_readiness'));
 assert.ok(missing.actions.some(action=>action.type==='eudr_readiness'));
 assert.match(missing.answer,/34 公斤干胶.*资料待补齐/);
 await call('/api/eudr/demo-prepare',{token:await login('manager-hn'),input:{siteId:'demo-hainan',batchId:batch.id}});
 const ready=await send('再看一下这批欧盟客户资料，现在可以做什么？');
 assert.ok(ready.tools.some(tool=>tool.name==='read_eudr_readiness'));
 assert.match(ready.answer,/演示资料已整理/);
 assert.match(ready.answer,/导出/);
 assert.ok(ready.actions.some(action=>action.type==='eudr_readiness'));
 assert.equal(simulation.salesInventory('demo-hainan').processedKg,34);
});

test('EU shipments must name prepared source batches before departure and export only those plots',async t=>{
 const {app,simulation,call,login,processed}=await fixture(t);
 const ready=processed('eudr-alloc-ab'),raw=processed('eudr-alloc-c',[100]);
 const manager=await login('manager-hn'),grower=await login('grower-hn-wang'),operator=await login('operator-hn');
 await call('/api/eudr/demo-prepare',{token:manager,input:{siteId:'demo-hainan',batchId:ready.id}});
 const shipment=(id,kg,status='planned')=>simulation.salesShipments.save({id,siteId:'demo-hainan',modelId:'model-eu',scenarioId:'batch',scenarioName:'分批销售',day:1,
  plannedDepartureAt:'2026-10-22T00:00:00.000Z',plannedKg:kg,priceCnyPerKg:14.5,plannedRevenueCny:kg*14.5,buyer:{id:'buyer-eu',name:'欧盟示例客户'},status,createdAt:NOW.toISOString(),mode:'simulation'});
 shipment('ship-eu-1',20);shipment('ship-eu-2',20);shipment('ship-gone',10,'in-transit');
 const before=await call('/api/eudr/readiness?siteId=demo-hainan',{token:manager});
 assert.deepEqual(before.shipments.map(item=>item.traceStatus).sort(),['shipped_untraced','unallocated','unallocated']);
 assert.equal(before.batches.find(item=>item.id===ready.id).checks.find(item=>item.key==='shipment').ok,false);
 assert.ok(before.batches.find(item=>item.id===ready.id).checks.filter(item=>item.key!=='shipment').every(item=>item.ok));
 await call('/api/eudr/allocate',{token:grower,input:{siteId:'demo-hainan',shipmentId:'ship-eu-1',batchIds:[ready.id]},status:403});
 await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-eu-1',batchIds:[raw.id]},status:409});
 await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-gone',batchIds:[ready.id]},status:409});
 await call('/api/eudr/shipment-package?siteId=demo-hainan&shipmentId=ship-eu-1',{token:manager,status:409});
 const first=await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-eu-1',batchIds:[ready.id]}});
 assert.equal(first.traceStatus,'traceable');
 assert.deepEqual(first.allocation.parts.map(part=>part.kg),[20]);
 assert.deepEqual(first.allocation.sourceZones,['A','B']);
 const short=await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-eu-2',batchIds:[ready.id]},status:409});
 assert.equal(short.error.code,'EUDR_BATCH_INSUFFICIENT');
 assert.match(short.error.message,/可分配 14 公斤/);
 const again=await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-eu-1',batchIds:[ready.id]}});
 assert.deepEqual(again.allocation.parts.map(part=>part.kg),[20]);
 const after=await call('/api/eudr/readiness?siteId=demo-hainan',{token:manager});
 const batch=after.batches.find(item=>item.id===ready.id);
 assert.equal(batch.allocatedKg,20);
 assert.equal(batch.remainingKg,14);
 assert.equal(after.inventory.sourceAllocation,'partial');
 const pack=await call('/api/eudr/shipment-package?siteId=demo-hainan&shipmentId=ship-eu-1',{token:operator});
 assert.equal(pack.format,'rubber-eudr-shipment-demo-v1');
 assert.equal(pack.product.netKg,20);
 assert.deepEqual(pack.geojson.features.map(item=>item.id),['demo-hainan:A','demo-hainan:B']);
 assert.equal(pack.ddsReference,null);
 assert.ok(!JSON.stringify(pack).includes(raw.id));
 const batchPack=await call(`/api/eudr/package?siteId=demo-hainan&batchId=${ready.id}`,{token:manager});
 assert.equal(batchPack.shipmentAllocation.status,'allocated');
 assert.deepEqual(batchPack.shipmentAllocation.shipments.map(item=>item.shipmentId),['ship-eu-1']);
 assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM simulation_eudr_allocations').get().n,1);
});

test('a planned shipment source can be released and reassigned, but not after departure',async t=>{
 const {simulation,call,login,processed}=await fixture(t);
 const ready=processed('eudr-release-ab');
 const manager=await login('manager-hn'),grower=await login('grower-hn-wang');
 await call('/api/eudr/demo-prepare',{token:manager,input:{siteId:'demo-hainan',batchId:ready.id}});
 const base={siteId:'demo-hainan',modelId:'model-eu',scenarioId:'batch',scenarioName:'分批销售',day:1,plannedDepartureAt:'2026-10-22T00:00:00.000Z',plannedKg:20,priceCnyPerKg:14.5,plannedRevenueCny:290,buyer:{id:'buyer-eu',name:'欧盟示例客户'},createdAt:NOW.toISOString(),mode:'simulation'};
 simulation.salesShipments.save({...base,id:'ship-r',status:'planned'});
 await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-r',batchIds:[ready.id]}});
 await call('/api/eudr/release',{token:grower,input:{siteId:'demo-hainan',shipmentId:'ship-r'},status:403});
 const released=await call('/api/eudr/release',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-r'}});
 assert.equal(released.traceStatus,'unallocated');
 assert.equal((await call('/api/eudr/readiness?siteId=demo-hainan',{token:manager})).batches.find(item=>item.id===ready.id).remainingKg,34);
 await call('/api/eudr/allocate',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-r',batchIds:[ready.id]}});
 simulation.salesShipments.save({...base,id:'ship-r',status:'in-transit'});
 await call('/api/eudr/release',{token:manager,input:{siteId:'demo-hainan',shipmentId:'ship-r'},status:409});
 assert.equal((await call('/api/eudr/readiness?siteId=demo-hainan',{token:manager})).shipments[0].traceStatus,'traceable');
});

test('a typhoon what-if plan does not replace the weekly tapping card in the decision list',async t=>{
 const {call,login}=await fixture(t);
 const token=await login('manager-hn');
 const real=await call('/api/park-plan',{token,input:{siteId:'demo-hainan'},status:201});
 const typhoon=await call('/api/park-plan',{token,input:{siteId:'demo-hainan',economicScenarioId:'typhoon'},status:201});
 assert.notEqual(typhoon.stance,'increase');
 assert.equal((await call('/api/park-plan/latest?siteId=demo-hainan',{token})).plan.id,typhoon.id,'the plan page still shows the newest what-if');
 const card=(await call('/api/workspace/brief?siteId=demo-hainan',{token})).items.find(item=>item.id==='park-plan');
 assert.equal(card.action.planId,real.id);
 assert.equal(card.conclusion,real.headline);
});
