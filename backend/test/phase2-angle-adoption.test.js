import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel} from './helpers/park-plan-model.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {ParkPlanService} from '../src/park-plan.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {transitionTask} from '../../frontend/src/workspace/taskFlow.ts';
import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';
import {collectionPointSamples} from '../../frontend/src/workspace/collectionPointData.ts';
import {createTaskEvidenceSnapshot,renderTaskEvidenceHtml} from '../../frontend/src/workspace/taskEvidenceExport.ts';

for(const site of ['guangdong-maoming','xsbn','hainan-danzhou'])test(`${site}: adopted tree angle is used by new park and market tasks and persists into collection`,async t=>{
 const dbPath=join(mkdtempSync(join(tmpdir(),'phase2-angle-')),'state.sqlite');
 let instant=Date.parse('2026-10-23T02:00:00Z'),store=new Store(dbPath);
 const clock=()=>new Date(instant),siteId=`demo-${site}`,treeId='T-0001';
 let simulation=new SimulationService(store,clock);
 const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock});
 t.after(async()=>{await runtime.stop();store.close();});
 async function prepare(kind,targetSite=siteId){
  const requestId=`${kind}-${targetSite}`,context=makeParkContext({siteId:targetSite,treeIds:[treeId],now:clock()});
  store.saveContext(context);
  const run=runtime.submit({requestId,kind,siteId:targetSite,targetSnapshotId:context.targetSnapshot.targetSnapshotId,
   inputSnapshot:{snapshotId:context.snapshotId,version:1},executionMode:'simulation',generatorMode:'demo_rules'});
  store.bindTreeView({treeId,kind,dataMode:'demo',siteId:targetSite,preparationId:requestId,requestId,runId:run.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
  await runtime.idle();return store.getRun(run.runId).result.strategy;
 }
 const otherSite='demo-hainan',other=await prepare('tapping_angle',otherSite);
 simulation.record({requestId:`other-angle-${site}`,kind:'adopt_angle',treeId,siteId:otherSite,strategyId:other.strategyId,dataMode:'demo'});
 const template={id:'before-adoption',site,siteId,block:'A',start:'06:30',end:'—',count:2,done:0,status:'待开始',kind:'割胶',treeIndices:[0,1]};
 const old=simulation.preparePlannedTask(template);
 assert.equal(old.demoStrategy.adoptedAngles,undefined,'other parks must not supply this tree angle');
 const strategy=await prepare('tapping_angle');
 const adoption=simulation.record({requestId:`adopt-angle-${site}`,kind:'adopt_angle',treeId,siteId,strategyId:strategy.strategyId,dataMode:'demo'});
 const plans=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext,clock});
 const plan=(await plans.compute(siteId));plans.adopt({planId:plan.id});
 let task=simulation.latestTasks(siteId).find(item=>item.sourceParkPlanId===plan.id&&item.treeIndices.includes(0));
 assert.ok(task);
 assert.equal(task.demoStrategy.adoptedAngles[0].angleDeg,adoption.angle);
 assert.equal(task.demoStrategy.adoptedAngles[0].strategyId,strategy.strategyId);
 assert.equal(old.demoStrategy.adoptedAngles,undefined,'previous task snapshots stay unchanged');
 const save=value=>{const result=simulation.tasks({tasks:[value]});assert.deepEqual(result.conflicts,[]);return result.tasks.find(item=>item.id===value.id);};
 task=save(transitionTask(task,'start',clock().toISOString()));
 while(task.status!=='已完成'){instant+=1000;task=save(transitionTask(task,'progress',clock().toISOString()));}
 assert.equal(task.demoReceipts.find(item=>item.treeId===treeId).angleDeg,adoption.angle);
 assert.ok(task.demoReceipts.filter(item=>item.treeId!==treeId).every(item=>item.angleDeg===task.demoStrategy.parameters.angleDeg));
 assert.deepEqual(taskEvidence(task).issues,[]);
 assert.equal(taskEvidence(task).hasCompletionRecord,true);
 const html=renderTaskEvidenceHtml(createTaskEvidenceSnapshot(task,undefined,instant));
 assert.ok(html.includes(strategy.strategyId));assert.ok(html.includes(`${adoption.angle}°`));
 const batch=simulation.logistics.create({requestId:`collect-angle-${site}`,siteId,taskId:task.id,operator:'模拟收胶员',
  collectionPointId:collectionPointSamples[site].find(point=>point.kind==='收胶点').id,containerCount:2,note:'核对逐树角度后收胶'});
 assert.equal(batch.source.demoReceipts.find(item=>item.treeId===treeId).angleDeg,adoption.angle);
 assert.equal(batch.source.demoStrategy.adoptedAngles[0].strategyId,strategy.strategyId);
 const surface=await prepare('surface_action');
 if(surface.proposal.findings.length)simulation.record({requestId:`allow-${site}`,kind:'surface_review',treeId,siteId,strategyId:surface.strategyId,dataMode:'demo',disposition:'allow'});
 const model=simulation.market({siteId,treeCount:1,storageKg:2000,stockKg:100,heldKg:0,transportKgPerDay:40});
 const market=simulation.createMarketTasks({siteId,modelId:model.id,dataMode:'demo'});
 assert.ok(market.tasks.length);
 let marketTask=save(transitionTask(market.tasks[0],'start',clock().toISOString()));
 marketTask=save(transitionTask(marketTask,'progress',clock().toISOString()));
 assert.equal(marketTask.demoReceipts[0].angleDeg,adoption.angle);
 await runtime.stop();store.close();store=new Store(dbPath);simulation=new SimulationService(store,clock);
 const restored=simulation.latestTasks(siteId).find(item=>item.id===task.id);
 assert.deepEqual(restored.demoStrategy.adoptedAngles,task.demoStrategy.adoptedAngles);
 assert.deepEqual(restored.demoReceipts,task.demoReceipts);
});
