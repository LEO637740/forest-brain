import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMarket} from '../src/simulation-market.js';
import {deriveMarketFrequencyPolicy} from '../src/market-policy.js';
import {makeParkContext,TREE_IDS} from '../src/adapters/park-demo.js';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const now=new Date('2026-10-19T02:00:00.000Z');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('market forecast counts eligible trees in the requested subset and freezes their IDs',()=>{
 const model=calculateMarket({treeCount:12},now),context=makeParkContext({treeIds:TREE_IDS.slice(0,12),now});
 const policy=deriveMarketFrequencyPolicy({market:context.modules.market,trees:context.modules.trees,weather:context.modules.weather,maxTappingsPerWeek:2});
 assert.deepEqual(model.eligibleTreeIds,policy.eligible.map(tree=>tree.treeId));
 assert.equal(model.eligibleTreeCount,policy.eligible.length);
 assert.equal(model.eligibleTreeCount+model.excludedTrees.length,12);
 assert.equal(model.excludedTrees.find(tree=>tree.treeId==='T-0012').reason,'健康状态需复核');
 assert.equal(calculateMarket({treeCount:0},now).eligibleTreeCount,0);
});

test('three sales schedules preserve stock, exclude frozen stock, and separate cash from inventory valuation',()=>{
 const model=calculateMarket({demandIndex:125,transportKgPerDay:80},now);
 assert.deepEqual(model.sales.scenarios.map(s=>s.id),['sell_now','hold_short','sell_phased']);
 for(const scenario of model.sales.scenarios){
  close(model.params.stockKg+scenario.producedKg,scenario.soldKg+scenario.endingStockKg);
  close(scenario.endingStockKg-model.params.heldKg,scenario.endingAvailableKg);
  let stock=model.params.stockKg;
  for(const day of scenario.daily){
   close(stock+day.incomingKg-day.soldKg,day.stockKg);stock=day.stockKg;
   assert.ok(day.stockKg>=model.params.heldKg-1e-6);assert.ok(day.soldKg<=model.params.transportKgPerDay);
  }
  const revenue=scenario.daily.reduce((sum,day)=>sum+day.soldKg*day.priceCnyPerKg,0);
  assert.ok(Math.abs(scenario.revenueCny-revenue)<=0.005);
  assert.ok(Math.abs(scenario.cashContributionCny-(scenario.revenueCny-scenario.productionCostCny-scenario.transportCostCny-scenario.holdingCostCny))<=0.02);
  assert.ok(Math.abs(scenario.comparisonValueCny-scenario.cashContributionCny-scenario.endingInventoryValueCny)<=0.02);
 }
 const held=model.sales.scenarios.find(s=>s.id==='hold_short');
 assert.ok(held.daily.slice(0,3).every(day=>day.soldKg===0));
 assert.ok(held.daily[3].soldKg>0);
 assert.equal(model.sales.scenarios.find(s=>s.id==='sell_phased').daily[0].soldKg,40);
 const recommended=model.sales.scenarios.find(s=>s.id===model.sales.recommendedScenarioId);
 assert.equal(recommended.comparisonValueCny,Math.max(...model.sales.scenarios.filter(s=>s.feasible).map(s=>s.comparisonValueCny)));
});

test('short holding can exceed storage even when immediate selling is feasible; zero transport creates no sales revenue',()=>{
 const model=calculateMarket({demandIndex:125,storageKg:820},now);
 assert.equal(model.sales.scenarios.find(s=>s.id==='sell_now').feasible,true);
 assert.equal(model.sales.scenarios.find(s=>s.id==='hold_short').feasible,false);
 assert.notEqual(model.sales.recommendedScenarioId,'hold_short');
 for(const scenario of calculateMarket({transportKgPerDay:0},now).sales.scenarios){
  assert.equal(scenario.soldKg,0);assert.equal(scenario.revenueCny,0);
  assert.ok(scenario.endingInventoryValueCny>0);assert.ok(scenario.cashContributionCny<0);
 }
});

test('surface clearance does not re-add a health-watch tree excluded by the adopted market forecast',async()=>{
 const store=new Store(),clock=()=>now,simulation=new SimulationService(store,clock);
 const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock});
 try{
  for(const treeId of ['T-0001','T-0012']){
   const context=makeParkContext({treeIds:[treeId],now});store.saveContext(context);
   const requestId='sales-health-'+treeId,run=runtime.submit({requestId,kind:'surface_action',siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:1},executionMode:'simulation',generatorMode:'demo_rules'});
   store.bindTreeView({treeId,kind:'surface_action',dataMode:'demo',siteId:context.siteId,preparationId:requestId,requestId,runId:run.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
   await runtime.idle();const result=store.getRun(run.runId).result;assert.equal(result.status,'succeeded');
   if(treeId==='T-0012')simulation.record({requestId:'sales-allow-12',kind:'surface_review',treeId,siteId:context.siteId,strategyId:result.strategy.strategyId,disposition:'allow',dataMode:'demo'});
  }
  const model=simulation.market({treeCount:12,demandIndex:125});
  const plan=simulation.createMarketTasks({modelId:model.id,dataMode:'demo'});
  assert.ok(plan.tasks.length>0);
  assert.deepEqual([...new Set(plan.tasks.flatMap(task=>task.treeIndices))],[0]);
  assert.ok(plan.exclusions.some(row=>row.reason==='健康状态需复核'));
  assert.ok(plan.tasks.every(task=>task.treeIndices.every(index=>model.eligibleTreeIds.includes(TREE_IDS[index]))));
 }finally{await runtime.stop();store.close();}
});

test('HTTP adopts sales shipments, replaces an unstarted choice and restores dispatched results',async t=>{
 const app=createApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),publicDataService:{status:()=>({location:{confirmed:false},sources:[]})}});
 t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,input,expected=200)=>{
  const response=await fetch(base+path,{method:input?'POST':'GET',headers:{'Content-Type':'application/json'},body:input?JSON.stringify(input):undefined});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
 };
 const model=await call('/api/simulation/market',{demandIndex:125,storageKg:820});
 const saved=await call('/api/simulation/market-sales-plan',{modelId:model.id,scenarioId:'sell_phased'});
 assert.equal(saved.scenario.name,'分批销售');assert.equal(saved.mode,'simulation');
 assert.equal(saved.inventory.stockKg,800);
 assert.equal(saved.inventory.availableKg,400);
 assert.equal(saved.shipments.length,7);
 assert.deepEqual((await call('/api/simulation/market/latest')).salesPlan,saved);
 assert.deepEqual((await call(`/api/simulation/market-sales-plan?siteId=hainan&modelId=${model.id}`)).salesPlan,saved);
 assert.deepEqual((await call(`/api/simulation/sales-shipments?siteId=hainan&modelId=${model.id}`)).items,saved.shipments);
 assert.equal((await call('/api/simulation/tasks')).items.length,0);
 await call('/api/simulation/market-sales-plan',{modelId:model.id,scenarioId:'hold_short'},409);
 assert.equal((await call('/api/simulation/market/latest')).salesPlan.scenarioId,'sell_phased');
 const updated=await call('/api/simulation/market-sales-plan',{modelId:model.id,scenarioId:'sell_now'});
 assert.equal((await call('/api/simulation/market/latest')).salesPlan.scenarioId,updated.scenarioId);
 assert.ok((await call('/api/simulation/sales-shipments?siteId=hainan')).items.filter(task=>task.scenarioId==='sell_phased').every(task=>task.status==='cancelled'));
 const resource=`/api/simulation/sales-shipments/${updated.shipments[0].id}/advance`;
 await call(resource,{siteId:'xsbn'},404);
 const dispatched=await call(resource,{siteId:'hainan'});
 assert.equal(dispatched.status,'in-transit');
 const inTransitInventory=(await call('/api/simulation/sales-inventory?siteId=hainan')).inventory;
 assert.equal(inTransitInventory.stockKg,800-dispatched.plannedKg);
 assert.equal(inTransitInventory.inTransitKg,dispatched.plannedKg);
 assert.equal(inTransitInventory.soldKg,0);
 const received=await call(resource,{siteId:'hainan'});
 assert.equal(received.status,'received');
 assert.equal(received.receipt.receivedKg,received.plannedKg);
 const restored=(await call(`/api/simulation/market-sales-plan?siteId=hainan&modelId=${model.id}`)).salesPlan;
 assert.deepEqual(restored.shipments[0],received);
 assert.equal(restored.inventory.stockKg,inTransitInventory.stockKg);
 assert.equal(restored.inventory.soldKg,received.plannedKg);
 assert.equal(restored.inventory.inTransitKg,0);
 assert.deepEqual((await call('/api/simulation/market/latest')).inventory,restored.inventory);
 assert.deepEqual(await call('/api/simulation/market-sales-plan',{modelId:model.id,scenarioId:'sell_now'}),restored);
 await call('/api/simulation/market-sales-plan',{modelId:model.id,scenarioId:'sell_phased'},409);
 assert.deepEqual((await call('/api/simulation/sales-shipments?siteId=xsbn')).items,[]);
 assert.deepEqual((await call('/api/simulation/sales-shipments?siteId=hainan&modelId=other')).items,[]);
 assert.equal((await call('/api/simulation/market/latest?siteId=xsbn')).model,null);
});
