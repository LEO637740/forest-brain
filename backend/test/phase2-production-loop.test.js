import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel} from './helpers/park-plan-model.js';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {ParkPlanService} from '../src/park-plan.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {transitionTask,advanceDemo,prepareSimulatedExecution} from '../../frontend/src/workspace/taskFlow.ts';
import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';
import {collectionPointSamples} from '../../frontend/src/workspace/collectionPointData.ts';

for(const site of ['xsbn','guangdong-maoming'])test(`${site}: newly adopted production completes, collects, processes and sells with one persisted inventory ledger`,async t=>{
 let instant=Date.parse('2026-10-23T02:00:00Z'), sequence=0;
 const clock=()=>new Date(instant),store=new Store(),simulation=new SimulationService(store,clock);
 t.after(()=>store.close());
 const plans=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext,clock});
 const original=(await plans.compute(`demo-${site}`)),adopted=plans.adopt({planId:original.id});
 assert.ok(adopted.adoption.taskIds.length>0);
 let task=simulation.latestTasks(site).find(item=>item.sourceParkPlanId===original.id);
 assert.equal(task.dispatch.phase,'scheduled');assert.match(task.end,/^\d{2}:\d{2}$/);
 const save=value=>{const result=simulation.tasks({tasks:[value]});assert.deepEqual(result.conflicts,[]);return result.tasks.find(item=>item.id===value.id);};
 task=save({...task,dispatch:{...task.dispatch,auto:{stage:'travel',startedAt:instant,nextAt:instant+1000}}});
 for(let step=0;task.dispatch.phase!=='completed';step++){
  assert.ok(step<150);instant=task.dispatch.auto.nextAt;
  task=save(advanceDemo(task,instant));
 }
 assert.equal(task.done,task.count);assert.equal(task.demoReceipts.length,task.count);
 assert.equal(taskEvidence(task).hasCompletionRecord,true);
 assert.deepEqual(taskEvidence(task).issues,[]);
 assert.deepEqual(advanceDemo(task,instant+10000),task);
 const points=collectionPointSamples[site];
 let batch=simulation.logistics.create({requestId:`collect-${++sequence}`,siteId:site,taskId:task.id,
  operator:'模拟收胶员',collectionPointId:points.find(point=>point.kind==='收胶点').id,containerCount:2,note:'按新任务回传登记实收'});
 const act=(action,extra={})=>{instant+=60000;batch=simulation.logistics.transition(batch.id,action,{requestId:`step-${++sequence}`,
  siteId:site,revision:batch.revision,operator:'模拟经办人',note:`模拟${action}`,...extra});};
 act('weigh',{grossKg:102,tareKg:2});act('inspect',{sampleId:'sample-new-task',dryRubberPercent:34,decision:'pass'});
 act('plan',{destinationId:points.find(point=>point.kind==='加工厂').id,vehicleCode:'SIM-LOOP',driver:'模拟司机',plannedDepartureAt:clock().toISOString()});
 act('dispatch');act('receive',{receivedKg:100});act('process');
 assert.equal(batch.processing.dryKg,34);assert.equal(batch.source.taskId,task.id);
 assert.equal(simulation.salesInventory(site).stockKg,834);
 const model=simulation.market({siteId:site,transportKgPerDay:20}),sales=simulation.adoptMarketSales({modelId:model.id,siteId:site,scenarioId:'sell_now'});
 assert.equal(model.params.stockKg,834);
 const shipment=sales.shipments[0];instant+=60000;
 simulation.salesShipments.advance(shipment.id,{siteId:site});
 assert.equal(simulation.salesInventory(site).stockKg,814);assert.equal(simulation.salesInventory(site).inTransitKg,20);
 instant+=60000;simulation.salesShipments.advance(shipment.id,{siteId:site});
 assert.equal(simulation.salesInventory(site).stockKg,814);assert.equal(simulation.salesInventory(site).soldKg,20);
 assert.equal(simulation.salesInventory(site).inTransitKg,0);
 const reloaded=new SimulationService(store,clock);
 assert.equal(reloaded.latestTasks(site).find(item=>item.id===task.id).demoReceipts.length,task.count);
 assert.equal(reloaded.logistics.list(site)[0].processing.dryKg,34);
 assert.equal(reloaded.market({siteId:site}).params.stockKg,814);
 assert.equal(JSON.parse(store.db.prepare('SELECT body FROM simulation_models WHERE id=?').get(model.id).body).params.stockKg,834);
 assert.equal(reloaded.salesInventory('hainan').stockKg,800);
});

test('an older non-Hainan task continues its recorded progress through the existing flow',()=>{
 const time='2026-10-23T02:00:00Z';
 const old={id:'old-xs',site:'xsbn',block:'B',title:'旧模拟割胶',robot:'R-B',start:'06:30',end:'—',kind:'割胶',count:3,done:1,status:'执行中',treeIndices:[50,51,52]};
 let task=prepareSimulatedExecution(old,time);
 assert.equal(task.done,1);assert.equal(task.dispatch.phase,'running');assert.equal(task.demoReceipts,undefined);
 task=transitionTask(task,'progress',time);task=transitionTask(task,'progress',time);
 assert.equal(task.done,3);assert.equal(taskEvidence(task).hasCompletionRecord,true);
 assert.equal(prepareSimulatedExecution(task,time),task);
 assert.equal(prepareSimulatedExecution({...old,status:'已完成',done:3},time).dispatch,undefined);
});

for(const site of ['xsbn','guangdong-maoming'])test(`${site}: market production adoption also returns an executable task that can register collection`,async t=>{
 let instant=Date.parse('2026-10-23T02:00:00Z');
 const clock=()=>new Date(instant),store=new Store(),simulation=new SimulationService(store,clock);
 const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock});
 t.after(async()=>{await runtime.stop();store.close();});
 const siteId=`demo-${site}`,treeId='T-0001',requestId=`market-production-${site}`;
 const context=makeParkContext({siteId,treeIds:[treeId],now:clock()});
 store.saveContext(context);
 const run=runtime.submit({requestId,kind:'surface_action',siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,
  inputSnapshot:{snapshotId:context.snapshotId,version:1},executionMode:'simulation',generatorMode:'demo_rules'});
 store.bindTreeView({treeId,kind:'surface_action',dataMode:'demo',siteId,preparationId:requestId,requestId,
  runId:run.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
 await runtime.idle();
 const result=store.getRun(run.runId).result;
 assert.equal(result.status,'succeeded');
 if(result.strategy.proposal.findings.length)simulation.record({requestId:`${requestId}-allow`,kind:'surface_review',
  treeId,siteId,strategyId:result.strategy.strategyId,disposition:'allow',dataMode:'demo'});
 const model=simulation.market({siteId,treeCount:1,storageKg:2000,stockKg:100,heldKg:0,transportKgPerDay:40});
 assert.ok(model.recommendedFrequency>0);
 const plan=simulation.createMarketTasks({siteId,modelId:model.id,dataMode:'demo'});
 assert.ok(plan.tasks.length>0);
 assert.ok(plan.tasks.every(task=>task.site===site&&task.sourceScenarioId===model.id&&task.dispatch.phase==='scheduled'
  &&/^([01]\d|2[0-3]):[0-5]\d$/.test(task.end)));
 const save=value=>{
  const persisted=simulation.tasks({tasks:[value]});assert.deepEqual(persisted.conflicts,[]);
  return persisted.tasks.find(task=>task.id===value.id);
 };
 let task=plan.tasks[0];
 task=save({...task,dispatch:{...task.dispatch,auto:{stage:'travel',startedAt:instant,nextAt:instant+1000}}});
 for(let step=0;task.dispatch.phase!=='completed';step++){
  assert.ok(step<20);instant=task.dispatch.auto.nextAt;task=save(advanceDemo(task,instant));
 }
 assert.equal(task.done,task.count);assert.equal(task.demoReceipts.length,task.count);
 assert.equal(taskEvidence(task).hasCompletionRecord,true);assert.deepEqual(taskEvidence(task).issues,[]);
 const batch=simulation.logistics.create({requestId:`${requestId}-collect`,siteId,taskId:task.id,operator:'模拟收胶员',
  collectionPointId:collectionPointSamples[site].find(point=>point.kind==='收胶点').id,containerCount:1,note:'经营生产方案完成后登记收胶'});
 assert.equal(batch.source.taskId,task.id);assert.equal(batch.source.completedTrees,task.count);
 assert.equal(simulation.logistics.list(siteId)[0].id,batch.id);
});
