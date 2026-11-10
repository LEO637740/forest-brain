import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel} from './helpers/park-plan-model.js';
import {isDeepStrictEqual} from 'node:util';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext,DEMO_EXCEPTION_CASES} from '../src/adapters/park-demo.js';
import {makeDemoTasks} from '../src/adapters/demo-tasks.js';
import {SimulationService} from '../src/simulation.js';
import {ParkPlanService} from '../src/park-plan.js';
import {prepareParkPlanSurface} from '../src/park-plan-preparation.js';
import {RailDispatchController} from '../../frontend/src/workspace/railDispatchController.ts';
import {createZoneScheduler,commitFleetDispatch} from '../../frontend/src/zoneFleet.ts';
import {verifyFleetJobWith} from '../../frontend/src/integration/fleetVerification.ts';
import {weatherTimingFor} from '../../frontend/src/integration/weatherConstraints.ts';
import {eventHoldForZone} from '../../frontend/src/workspace/operationalEvents.ts';
import {finishRailTask,syncRailTask} from '../../frontend/src/workspace/railTaskState.ts';
import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';
import {taskExecutionWindow} from '../../frontend/src/workspace/taskExecutionWindow.ts';

// Fixed route geometry and clock advance the actual scheduler without browser,
// device, network or business-database access. Match the offline acceptance runner.
const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],
  stations:Object.fromEntries(Array.from({length:50},(_,index)=>[zone*50+index,index]))}));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a prechecked normal park plan executes B 50/50 with durable receipts while exceptions and original history stay separate',async t=>{
  // Start at 05:00 Beijing so even a single-round plan has a future first slot.
  let now=Date.parse('2026-10-25T21:00:00.000Z'),configuredCalls=0;
  const clock=()=>new Date(now),siteId='demo-hainan',dataMode='mixed_demo';
  const store=new Store(':memory:');
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock,
    generator:{mode:'llm',modelVersion:'forbidden-in-offline-test',async generate(){configuredCalls++;throw Error('Offline regression must not call a configured model');}}});
  t.after(async()=>{await runtime.stop();store.close();});
  const simulation=new SimulationService(store,clock);
  const plans=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext,clock,dispatchDataMode:dataMode});

  // An intentionally historical completed sample must not be rewritten by a new
  // plan, a retry, or later task persistence. This is a fixture, not new output.
  const historicalFixture=makeDemoTasks(new Date(now-7*86400000)).find(task=>task.site==='hainan'&&task.block==='D');
  const historicalSave=simulation.tasks({tasks:[historicalFixture]});
  assert.deepEqual(historicalSave.conflicts,[]);
  const originalHistory=structuredClone(historicalSave.tasks[0]);
  const historyRows=()=>store.db.prepare('SELECT body FROM simulation_task_receipts WHERE task_id=? ORDER BY rowid').all(originalHistory.id).map(row=>row.body);
  const originalRows=historyRows();

  const prepared=await prepareParkPlanSurface({siteId,dataMode,store,runtime,makeParkContext,clock});
  await runtime.idle();
  assert.deepEqual(prepared.failures,[]);
  assert.equal(configuredCalls,0);
  const plan=(await plans.compute(siteId));
  assert.equal(plan.readiness.readyCount,191);
  assert.equal(plan.readiness.reviewCount,9);
  const exceptionIndices=new Set(DEMO_EXCEPTION_CASES.map(item=>Number(item.treeId.slice(2))-1));
  assert.deepEqual(new Set(plan.readiness.reviewTrees.map(tree=>tree.treeIndex)),exceptionIndices);
  for(const zone of plan.zones)assert.ok(zone.treeIndices.every(index=>!exceptionIndices.has(index)),'review trees never enter normal target sets');
  assert.equal(plan.zones.find(zone=>zone.zone==='A').eligibleTrees,41);
  assert.equal(plan.zones.find(zone=>zone.zone==='B').eligibleTrees,50);
  const adopted=plans.adopt({planId:plan.id,siteId});
  assert.deepEqual(adopted.adoption.reviewTrees,plan.readiness.reviewTrees);
  let tasks=simulation.latestTasks(siteId);
  const selected=tasks.find(task=>task.sourceParkPlanId===plan.id&&task.block==='B');
  assert.ok(selected);
  assert.equal(selected.count,50);
  assert.deepEqual(selected.treeIndices,Array.from({length:50},(_,index)=>index+50));
  for(const task of tasks.filter(task=>task.sourceParkPlanId===plan.id))
    assert.ok(task.treeIndices.every(index=>!exceptionIndices.has(index)));
  assert.deepEqual(historyRows(),originalRows);
  assert.deepEqual(tasks.find(task=>task.id===originalHistory.id),originalHistory);

  let constraints=[],events=[],scheduler,serial=0;
  const notices=[],receipts=[],boundaryChecks=new Set(),surfaceReads=new Set(),preflightChecks=[];
  // This adapter uses real local service records, exactly like the acceptance
  // runner. No verification response is stubbed to "pass".
  const verification={
    siteId,dataMode,now:()=>now,treeId:index=>`T-${String(index+1).padStart(4,'0')}`,
    refreshWeather:async()=>{const current=simulation.effectiveConstraints(siteId);constraints=current.constraints;events=current.operationalEvents;},
    weatherTiming:index=>{
      const hold=eventHoldForZone('hainan',Math.floor(index/50),events);
      return hold?{weatherBlock:hold}:weatherTimingFor(verification.treeId(index),constraints,{siteId,now});
    },
    post:async(path,input)=>{assert.equal(path,'/api/simulation/strategy-validity');return simulation.validateStrategies(input);},
    read:async path=>{
      const url=new URL(path,'http://offline.invalid');
      assert.equal(url.searchParams.get('siteId'),siteId);
      if(url.pathname==='/api/simulation/actions')return {items:simulation.list(url.searchParams.get('treeId'),siteId)};
      const match=url.pathname.match(/^\/api\/demo\/trees\/(T-\d{4})\/view$/);
      assert.ok(match,`Unexpected verification read: ${path}`);
      const treeId=match[1],kind=url.searchParams.get('kind'),mode=url.searchParams.get('dataMode');
      assert.equal(kind,'surface_action');assert.equal(mode,dataMode);surfaceReads.add(treeId);
      const binding=store.getTreeViewBinding(treeId,kind,mode,siteId);
      const run=binding&&store.getRun(binding.runId),strategy=run?.result?.strategy;
      const context=run?store.getRunContext(run.runId):makeParkContext({treeIds:[treeId],siteId,now:clock()});
      const validity=strategy&&simulation.strategyValidity({treeId,siteId,strategyId:strategy.strategyId,runId:strategy.runId,revision:strategy.revision,dataMode:mode});
      return {siteId:context.siteId,tree:context.modules.trees.find(tree=>tree.treeId===treeId),strategy:validity?.valid?strategy:null,
        strategyStatus:validity?.valid?'available':validity?.status??run?.status??'needs_generation'};
    },
  };
  const snapshot=()=>({ready:true,error:null,zones:scheduler.zones,jobs:scheduler.jobs});
  const current=()=>tasks.find(task=>task.id===selected.id);
  const persist=next=>{
    const changes=next.filter(task=>!isDeepStrictEqual(task,tasks.find(previous=>previous.id===task.id)));
    if(!changes.length)return;
    const saved=simulation.tasks({tasks:changes});
    assert.deepEqual(saved.conflicts,[],'real task versions should persist without conflict');
    tasks=next.map(task=>saved.tasks.find(item=>item.id===task.id)??task);
  };
  const receive=outcome=>(index,job)=>{
    const receipt=structuredClone({index,job,outcome,finishedAt:clock().toISOString()});
    receipts.push(receipt);
    persist(tasks.map(task=>finishRailTask(task,receipt)));
  };
  scheduler=createZoneScheduler(routes,receive('completed'),receive('cancelled'),()=>now,async(index,job)=>{
    boundaryChecks.add(index);
    return verifyFleetJobWith(index,job,verification);
  });
  // B has no adopted single-tree angles, so this is the same baseline job the
  // workspace creates (baseline-30-v1). Both admission and every cut validate it.
  assert.equal(simulation.list(null,siteId).filter(action=>action.kind==='adopt_angle').length,0);
  const baseline=id=>({id,requestedAt:clock().toISOString(),planVersion:'baseline-30-v1',angle:30});
  const controller=new RailDispatchController({getState:()=>({tasks,decisions:{}}),updateTasks:update=>persist(update(tasks)),getFleet:snapshot,
    verify:async indices=>{preflightChecks.push([...indices]);for(const index of indices)await verifyFleetJobWith(index,baseline(`check-${index}`),verification);},
    makeJob:(_index,id)=>baseline(id),dispatch:(entries,commit)=>commitFleetDispatch(scheduler,entries,commit),
    isEnabled:()=>true,notify:message=>notices.push(message),now:()=>now,newId:()=>`normal-plan-${++serial}`});
  t.after(()=>controller.dispose());

  // The weather-scheduled task cannot start before its planned window, and the
  // refusal neither marks the task nor records a dispatch check.
  const window=taskExecutionWindow(selected);
  assert.ok(now<window.notBefore);
  await controller.startBatch(selected.id);
  assert.match(notices.at(-1),/尚未到任务计划开始时间/);
  assert.equal(current().status,'待开始');assert.equal(current().railDispatchChecks,undefined);
  assert.deepEqual(preflightChecks,[]);
  // Move into the window and refresh the hour-long tree strategies, as the
  // launcher does every 45 minutes, so only the events below can block work.
  now=window.notBefore;
  const refreshed=await prepareParkPlanSurface({siteId,dataMode,store,runtime,makeParkContext,clock});
  await runtime.idle();
  assert.deepEqual(refreshed.failures,[]);
  assert.equal(configuredCalls,0);

  // Real operation events must still prevent normal work before any tree is
  // dispatched. Resolving an event alone also does not authorize resumption.
  for(const kind of ['rain','device_fault']){
    const event=simulation.operationalEvents.create({requestId:`normal-plan-${kind}`,siteId,kind,zone:1,note:`离线回归：B区模拟${kind}`});
    await controller.startBatch(selected.id);
    assert.equal(current().status,'待处理');assert.equal(current().done,0);
    assert.equal(current().railBatch,undefined);assert.equal(receipts.length,0);
    assert.deepEqual(Object.keys(scheduler.jobs),[]);
    assert.equal(current().railDispatchChecks.at(-1).outcome,'blocked');
    simulation.operationalEvents.transition(event.id,'resolve',{siteId,note:'离线回归：异常已解除，等待确认'});
    await assert.rejects(verifyFleetJobWith(50,baseline('pending-resume'),verification),/待确认|恢复|暂停/);
    simulation.operationalEvents.transition(event.id,'resume',{siteId,note:'离线回归：条件已核对，确认恢复'});
  }
  await controller.startBatch(selected.id);
  assert.equal(current().status,'执行中');
  assert.equal(current().done,0);
  assert.equal(Object.keys(current().railBatch.jobs).length,50);
  assert.equal(Object.keys(current().railBatch.results).length,0);
  assert.deepEqual(current().railDispatchChecks.map(check=>check.outcome),['blocked','blocked','passed']);
  assert.equal(preflightChecks.at(-1).length,50);

  for(let tick=0;tick<700&&current().status!=='已完成';tick++){
    now+=1000;scheduler.update(1);await settle();
    persist(tasks.map(task=>syncRailTask(task,snapshot(),now)));
  }
  const completed=simulation.latestTasks(siteId).find(task=>task.id===selected.id);
  assert.equal(completed.status,'已完成',JSON.stringify({notices,zones:scheduler.zones}));
  assert.equal(completed.done,50);assert.equal(completed.count,50);
  assert.equal(receipts.length,50);assert.equal(new Set(receipts.map(receipt=>receipt.index)).size,50);
  assert.ok(receipts.every(receipt=>receipt.outcome==='completed'));
  assert.deepEqual([...boundaryChecks].sort((a,b)=>a-b),selected.treeIndices,'every actual cut must call the real verifier');
  assert.equal(surfaceReads.size,50);
  assert.equal(Object.keys(scheduler.jobs).length,0);
  const evidence=taskEvidence(completed);
  assert.equal(evidence.receipts.length,50);assert.equal(evidence.completedReceipts,50);
  assert.deepEqual(evidence.issues,[]);assert.equal(evidence.hasCompletionRecord,true);
  assert.equal(evidence.completionKind,'rail');
  assert.equal(plans.withAdoption(plans.get(plan.id)).adoption.tasks.find(task=>task.id===selected.id).done,50);
  assert.deepEqual(plans.get(plan.id).adoption.reviewTrees,plan.readiness.reviewTrees);
  assert.deepEqual(historyRows(),originalRows);
  assert.deepEqual(simulation.latestTasks(siteId).find(task=>task.id===originalHistory.id),originalHistory);
  const replay=finishRailTask(completed,receipts[0]);
  assert.equal(replay,completed,'replaying a saved receipt must not count it twice');
  assert.equal(configuredCalls,0);
});
