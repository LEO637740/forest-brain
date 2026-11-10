import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel,modelProposal} from './helpers/park-plan-model.js';
import {ECONOMIC_SCENARIOS,calculateMachineryCase} from '../src/economic-scenario.js';
import {calculateMarket} from '../src/simulation-market.js';
import {calculateParkPlan,ParkPlanService} from '../src/park-plan.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {assessParkReadiness} from '../src/tree-readiness.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
const now=new Date('2026-10-21T00:00:00Z');
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.001,`${actual} != ${expected}`);

test('baseline preserves calculations and every preset states demo assumptions',()=>{
 assert.deepEqual(calculateMarket({},now),calculateMarket({economicScenarioId:'baseline'},now));
 assert.ok(ECONOMIC_SCENARIOS.every(item=>item.drivers.length&&item.drivers.every(driver=>driver.assumption&&driver.action)));
 assert.equal(ECONOMIC_SCENARIOS.length,5);
});

test('typhoon changes production, transport, prices and cost while preserving stock balance',()=>{
 const base=calculateMarket({},now),model=calculateMarket({economicScenarioId:'typhoon'},now);
 assert.deepEqual(model.params,base.params);
 close(model.scenarios[1].produced,base.scenarios[1].produced*0.6);
 close(model.economicImpact.effective.transportKgPerDay,base.params.transportKgPerDay*0.5);
 close(model.economicImpact.effective.costPerTapping,base.params.costPerTapping*1.15);
 close(model.forecast[0].value,Math.round(base.forecast[0].value*1.08*1000)/1000);
 assert.equal(model.economicImpact.base.productionKg,base.economicImpact.effective.productionKg);
 for(const choice of model.sales.scenarios){
  close(model.params.stockKg+choice.producedKg,choice.soldKg+choice.endingStockKg);
  assert.ok(choice.daily.every(day=>day.soldKg<=20&&day.stockKg>=model.params.heldKg));
 }
});

test('weak demand and policy supply change actual sales capacity and revenue',()=>{
 const base=calculateMarket({},now);
 for(const scenario of ['demand_weak','policy_supply']){
  const model=calculateMarket({economicScenarioId:scenario},now);
  assert.ok(model.demand.value<base.demand.value);
  assert.ok(model.forecast[0].value<base.forecast[0].value);
  assert.ok(model.sales.scenarios[0].soldKg<base.sales.scenarios[0].soldKg);
  assert.ok(model.sales.scenarios[0].revenueCny<base.sales.scenarios[0].revenueCny);
  assert.ok(model.recommendedFrequency<=base.recommendedFrequency);
 }
});

test('robot scenario changes cost without inventing current park yield or removing tree care exclusions',()=>{
 const base=calculateMarket({},now),model=calculateMarket({economicScenarioId:'robot_recovery'},now);
 assert.deepEqual(model.eligibleTreeIds,base.eligibleTreeIds);
 assert.deepEqual(model.excludedTrees,base.excludedTrees);
 assert.equal(model.recommendedFrequency,base.recommendedFrequency);
 for(let index=0;index<model.sales.scenarios.length;index++){
  const row=model.sales.scenarios[index],before=base.sales.scenarios[index];
  close(row.producedKg,before.producedKg);
  close(row.productionCostCny,before.productionCostCny*0.8);
  assert.ok(row.cashContributionCny>=before.cashContributionCny);
 }
});

test('long-term recovery case uses incremental production and contribution, with no payback if contribution is nonpositive',()=>{
 const example=calculateMachineryCase();
 assert.equal(example.manual.productionKg,1200);
 assert.equal(example.robot.productionKg,2400);
 assert.equal(example.incrementalProductionKg,1200);
 assert.equal(example.incrementalAnnualContributionCny,example.robot.annualNetContributionCny-example.manual.annualNetContributionCny);
 assert.equal(example.paybackYears,Math.round(60000/example.incrementalAnnualContributionCny*100)/100);
 const loss=calculateMachineryCase({priceCnyPerKg:0});
 assert.ok(loss.incrementalAnnualContributionCny<0);
 assert.equal(loss.paybackYears,null);
});

test('park scenarios retain weather and device stops and apply capacity to the trees in execution tasks',()=>{
 const context=makeParkContext({siteId:'demo-hainan',now});
 const input={modelProposal:modelProposal(3),siteId:'demo-hainan',now,context,inventory:{stockKg:500,availableKg:300},storageKg:900,plannedSalesKg:40,salesSource:'test',events:[{kind:'device_fault',zone:2,status:'active',note:'割胶头故障'},{kind:'rain',zone:null,status:'active'}]};
 const baseline=calculateParkPlan(input);
 for(const scenario of ECONOMIC_SCENARIOS){
  const model=calculateParkPlan({...input,modelProposal:modelProposal(scenario.id==='typhoon'?2:3),economicScenarioId:scenario.id});
  assert.equal(model.zones[2].frequency,0);
  assert.ok(model.zones.every(zone=>!zone.dates.includes(model.outlook[0].date)));
  for(const zone of model.zones){
   assert.ok(zone.frequency<=3);
   assert.ok(zone.treeIndices.every(index=>baseline.zones.find(before=>before.zone===zone.zone).treeIndices.includes(index)));
   assert.ok(zone.dates.every(date=>model.outlook.find(day=>day.date===date).tappable));
  }
 }
 const typhoon=calculateParkPlan({...input,modelProposal:modelProposal(2),economicScenarioId:'typhoon'});
 assert.ok(typhoon.zones[0].treeIndices.length<baseline.zones[0].treeIndices.length);
 assert.equal(typhoon.economicImpact.base.productionKg,undefined,'no second-model counterfactual is fabricated');
 close(typhoon.economicImpact.effective.costPerTapping,baseline.economicImpact.effective.costPerTapping*1.15);
});

test('park service persists scenario choice and adopts only its capacity-limited trees in memory',async()=>{
 const store=new Store(),simulation=new SimulationService(store,()=>now);
 const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator:new RuleGenerator(),clock:()=>now});
 try{
  const siteId='demo-hainan',treeIds=assessParkReadiness({siteId,context:makeParkContext({siteId,now}),now}).readyTrees.map(tree=>tree.treeId);
  const context=makeParkContext({siteId,treeIds,now});store.saveContext(context);
  const requestId='scenario-ready-surface',run=runtime.submit({requestId,siteId,kind:'surface_action',targetSnapshotId:context.targetSnapshot.targetSnapshotId,
   inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode:'demo_rules'});
  for(const treeId of treeIds)store.bindTreeView({treeId,siteId,kind:'surface_action',dataMode:'demo',preparationId:requestId,requestId,runId:run.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
  await runtime.idle();assert.equal(store.getRun(run.runId).status,'succeeded');
  const service=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext,clock:()=>now,dispatchDataMode:'demo'});
  const plan=(await service.compute('demo-hainan',{economicScenarioId:'typhoon'}));
  assert.equal(service.latest('demo-hainan').economicScenarioId,'typhoon');
  const adopted=service.adopt({planId:plan.id});
  assert.ok(adopted.adoption.taskIds.length>0);
  const tasks=simulation.latestTasks('demo-hainan').filter(task=>task.sourceParkPlanId===plan.id);
  assert.ok(tasks.every(task=>task.count===plan.zones.find(zone=>zone.zone===task.block).eligibleTrees));
 }finally{await runtime.stop();store.close();}
});

test('a model typhoon reduction retains three weather closures and lower available capacity',()=>{
 const context=makeParkContext({siteId:'demo-hainan',now});
 // The test model explicitly chooses three rounds normally and two for the typhoon.
 // A rising price series must not turn the hard-limit pass into an economic scorer.
 context.modules.market.prices=context.modules.market.prices.map((price,index,all)=>({...price,value:14+index*2/all.length}));
 context.modules.market.demand={...context.modules.market.demand,value:130,baselineValue:100};
 const input={modelProposal:modelProposal(3),siteId:'demo-hainan',now,context,inventory:{stockKg:200,availableKg:100},storageKg:900,plannedSalesKg:0,salesSource:'test',events:[]};
 const baseline=calculateParkPlan(input);
 assert.equal(baseline.stance,'increase','fixture: the explicit model proposal requests three rounds');
 const typhoon=calculateParkPlan({...input,modelProposal:modelProposal(2),economicScenarioId:'typhoon'});
 assert.notEqual(typhoon.stance,'increase');
 assert.deepEqual(typhoon.outlook.slice(1,4).map(day=>day.tappable),[false,false,false]);
 assert.ok(typhoon.outlook.slice(1,4).every(day=>day.reasons.some(reason=>/台风/.test(reason))));
 assert.ok(typhoon.zones.every(zone=>zone.dates.every(date=>!typhoon.outlook.slice(1,4).some(day=>day.date===date))));
 assert.ok(typhoon.modelProposal.zones.every(zone=>zone.frequencyPerWeek===2));
 assert.ok(typhoon.signals.every(item=>item.source!=='price'&&item.source!=='economic_scenario'));
 close(typhoon.economicImpact.effective.priceCnyPerKg,baseline.economicImpact.effective.priceCnyPerKg*1.08);
 assert.ok(typhoon.production.expectedDryKg<baseline.production.expectedDryKg);
});

test('the decision list keeps the latest real-conditions plan when a what-if plan is newer',async()=>{
 const store=new Store(),simulation=new SimulationService(store,()=>now);
 try{
  const service=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext,clock:()=>now});
  const real=(await service.compute('demo-hainan'));
  (await service.compute('demo-hainan',{economicScenarioId:'typhoon'}));
  assert.equal(service.latest('demo-hainan').economicScenarioId,'typhoon');
  assert.equal(service.latest('demo-hainan',{baselineOnly:true}).id,real.id);
 }finally{store.close();}
});
