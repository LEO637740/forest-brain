import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel,modelProposal} from './helpers/park-plan-model.js';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {ParkPlanService,calculateParkPlan} from '../src/park-plan.js';
import {assessParkReadiness,treeExecutionReadinessIssues} from '../src/tree-readiness.js';
import {ReviewWorkflow} from '../src/review-workflow.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {makeParkContext,TREE_IDS,DEMO_EXCEPTION_CASES} from '../src/adapters/park-demo.js';

const epoch=Date.parse('2026-10-26T05:00:00Z');
const exceptionIds=DEMO_EXCEPTION_CASES.map(item=>item.treeId);
function setup(t,{siteId='demo-hainan',dispatchDataMode='demo'}={}) {
  let time=epoch,sequence=0,edit=context=>context;
  const clock=()=>new Date(time),store=new Store();
  const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator:new RuleGenerator(),clock});
  const reviews=new ReviewWorkflow(store,clock,runtime);
  const contextFactory=options=>edit(reviews.apply(makeParkContext(options)));
  const simulation=new SimulationService(store,clock,{contextFactory});
  const plans=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext:contextFactory,clock,dispatchDataMode});
  t.after(async()=>{await runtime.stop();store.close();});
  return {store,runtime,reviews,simulation,plans,clock,siteId,
    advance(ms){time+=ms;},edit(fn){edit=fn;},context(){return contextFactory({siteId,treeIds:TREE_IDS,now:clock()});},
    async prepare(ids,kind='surface_action',{mode=dispatchDataMode,transform=context=>context}={}) {
      const context=transform(contextFactory({siteId,treeIds:ids,now:clock()}));
      store.saveContext(context);
      const requestId=`readiness-${++sequence}`,run=runtime.submit({requestId,kind,siteId,
        targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},
        executionMode:'simulation',generatorMode:'demo_rules'});
      for(const treeId of ids)store.bindTreeView({treeId,kind,dataMode:mode,siteId,preparationId:requestId,requestId,
        runId:run.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
      await runtime.idle();
      return store.getRun(run.runId).result;
    },
    async prepareNormal() {
      const ids=assessParkReadiness({siteId,context:this.context(),now:clock()}).readyTrees.map(item=>item.treeId);
      const result=await this.prepare(ids);assert.equal(result.status,'succeeded');return result.strategy;
    },
  };
}

test('all 200 trees are checked once and the nine named cases retain every independent reason',()=>{
  const now=new Date(epoch),context=makeParkContext({now});
  const readiness=assessParkReadiness({siteId:'demo-hainan',context,now});
  assert.equal(readiness.totalCount,200);assert.equal(readiness.readyCount,191);assert.equal(readiness.reviewCount,9);
  assert.deepEqual(readiness.reviewTrees.map(tree=>tree.treeId),exceptionIds);
  assert.deepEqual(readiness.exceptionCases,DEMO_EXCEPTION_CASES);
  assert.equal(new Set([...readiness.readyTrees,...readiness.reviewTrees].map(tree=>tree.treeId)).size,200);
  const scar=readiness.reviewTrees.find(tree=>tree.treeId==='T-0004');
  assert.deepEqual(scar.reasons,['健康状态需复核','树表存在伤痕，需要现场评估']);
  const capture=readiness.reviewTrees.find(tree=>tree.treeId==='T-0006');
  assert.equal(capture.reviewKind,'capture');assert.equal(capture.reasons.length,2);
  const tree=context.modules.trees.find(tree=>tree.treeId==='T-0004');
  tree.tappingStatus='resting';tree.circumferenceCm=null;
  const changed=assessParkReadiness({siteId:'demo-hainan',context,now}).reviewTrees.find(tree=>tree.treeId==='T-0004');
  assert.equal(changed.reviewKind,'rest');
  assert.deepEqual(changed.reasons,['休割养护','缺少树围测量','健康状态需复核','树表存在伤痕，需要现场评估']);
  context.modules.trees.find(tree=>tree.treeId==='T-0002').siteId='demo-xsbn';
  assert.match(assessParkReadiness({siteId:'demo-hainan',context,now}).reviewTrees.find(tree=>tree.treeId==='T-0002').reasons.join('；'),/不属于当前园区/);
});

test('prepared Hainan plans assign only the 191 ready trees and keep nine review rows separate',async t=>{
  const app=setup(t);await app.prepareNormal();
  const plan=(await app.plans.compute(app.siteId));
  assert.equal(plan.readiness.readyCount,191);assert.equal(plan.readiness.reviewCount,9);
  assert.equal(plan.zones.reduce((sum,zone)=>sum+zone.eligibleTrees,0),191);
  const adopted=app.plans.adopt({planId:plan.id});
  assert.ok(adopted.adoption.taskIds.length);
  assert.deepEqual(adopted.adoption.reviewTrees,plan.readiness.reviewTrees);
  const reviewIndices=new Set(plan.readiness.reviewTrees.map(tree=>tree.treeIndex));
  const tasks=app.simulation.latestTasks(app.siteId);
  assert.ok(tasks.every(task=>task.treeIndices.every(index=>!reviewIndices.has(index))));
  assert.ok(tasks.every(task=>task.done===0 && task.status==='待开始' && task.sourceParkPlanId===plan.id));
  assert.equal(plan.production.expectedDryKg,Math.round(plan.zones.reduce((sum,zone)=>sum+zone.eligibleTrees*zone.frequency*0.3,0)*10)/10);
});

test('missing Hainan strategy bindings are listed before adoption without affecting pure context or other parks',async t=>{
  const app=setup(t);
  const plan=(await app.plans.compute(app.siteId));
  assert.equal(plan.readiness.readyCount,0);assert.equal(plan.readiness.reviewCount,200);
  const normal=plan.readiness.reviewTrees.find(tree=>tree.treeId==='T-0001');
  assert.equal(normal.reviewKind,'refresh');assert.match(normal.reasons.join('；'),/树表策略尚未生成/);
  const other=(await app.plans.compute('demo-xsbn'));
  assert.equal(other.readiness.readyCount,191);assert.equal(other.readiness.reviewCount,9);
});

test('only a current same-tree surface allow releases a watch finding, while skip and other trees stay excluded',async t=>{
  const app=setup(t);await app.prepareNormal();
  const result=await app.prepare(['T-0004','T-0005']);assert.equal(result.status,'succeeded');
  const action={requestId:'allow-four',kind:'surface_review',siteId:app.siteId,treeId:'T-0004',
    strategyId:result.strategy.strategyId,disposition:'allow',dataMode:'demo'};
  app.simulation.record(action);
  const allowed=(await app.plans.compute(app.siteId)).readiness;
  assert.equal(allowed.readyCount,192);assert.ok(allowed.readyTrees.some(tree=>tree.treeId==='T-0004'));
  assert.ok(allowed.reviewTrees.some(tree=>tree.treeId==='T-0005'));
  assert.equal((await app.plans.compute('demo-xsbn')).readiness.readyCount,191);
  app.simulation.record({...action,requestId:'skip-four',disposition:'skip'});
  assert.ok((await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0004').reasons.some(reason=>reason.includes('跳过')));
});

test('an allow cannot erase confirmed disease, unknown health, rest or missing circumference',async t=>{
  const app=setup(t);await app.prepareNormal();
  const result=await app.prepare(['T-0004']);assert.equal(result.status,'succeeded');
  app.simulation.record({requestId:'surface-clearance',kind:'surface_review',siteId:app.siteId,treeId:'T-0004',
    strategyId:result.strategy.strategyId,disposition:'allow',dataMode:'demo'});
  for(const [patch,reason] of [[{healthStatus:'confirmed_issue'},'健康状态需复核'],[{healthStatus:'unknown'},'健康状态未知'],
    [{tappingStatus:'resting'},'休割养护'],[{circumferenceCm:null},'缺少树围测量']]) {
    app.edit(context=>{Object.assign(context.modules.trees.find(tree=>tree.treeId==='T-0004') ?? {},patch);return context;});
    const review=(await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0004');
    assert.ok(review.reasons.includes(reason));
  }
});

test('completed capture, inspect and measurement overlays rejoin ready work without faking task completion',async t=>{
  const app=setup(t);await app.prepareNormal();
  const before=(await app.plans.compute(app.siteId));
  for(const [treeId,kind,assignee] of [['T-0004','inspect','human'],['T-0006','capture','robot'],['T-0042','measure','robot']]) {
    const job=app.reviews.create({treeIds:[treeId],kind,assignee,siteId:app.siteId,dataMode:'demo'})[0];
    app.reviews.collect(job.id);await app.reviews.complete(job.id,{conclusion:'clear',note:'测试：明确核实该树并记录证据'});
    await app.runtime.idle();
  }
  const after=(await app.plans.compute(app.siteId));
  assert.equal(after.readiness.readyCount,194);assert.equal(after.readiness.reviewCount,6);
  assert.throws(()=>app.plans.adopt({planId:before.id}),error=>error.code==='PLAN_READINESS_CHANGED');
  assert.equal(app.simulation.latestTasks().length,0);
  const adopted=app.plans.adopt({planId:after.id});
  assert.ok(adopted.adoption.tasks.every(task=>task.done===0 && task.status==='待开始'));
  assert.equal((await app.plans.compute('demo-xsbn')).readiness.readyCount,191);
  app.advance(25*3600000);
  const expiredOverlay=assessParkReadiness({siteId:app.siteId,context:app.context(),now:app.clock()});
  assert.equal(expiredOverlay.readyCount,191,'expired review evidence cannot permanently clear the demo cases');
  assert.deepEqual(app.plans.adopt({planId:after.id}),adopted,'an adopted historical plan still reopens without regenerating work');
});

test('adoption rejects changed reasons as well as changed ready membership, without cancelling existing tasks',async t=>{
  const app=setup(t,{siteId:'demo-xsbn'});
  const original=(await app.plans.compute(app.siteId)),adopted=app.plans.adopt({planId:original.id});
  app.advance(1000);const candidate=(await app.plans.compute(app.siteId));
  app.edit(context=>{const row=context.modules.inspection.evidence.find(row=>row.treeId==='T-0004');if(row)row.detections[0].classCode='mud';return context;});
  assert.throws(()=>app.plans.adopt({planId:candidate.id,replace:true}),error=>error.code==='PLAN_READINESS_CHANGED');
  assert.ok(app.simulation.latestTasks().filter(task=>adopted.adoption.taskIds.includes(task.id)).every(task=>task.status==='待开始'));
});

test('legacy adopted plans remain readable and idempotent while legacy unadopted plans require recalculation',async t=>{
  const app=setup(t,{siteId:'demo-xsbn'});
  const plan=(await app.plans.compute(app.siteId)),adopted=app.plans.adopt({planId:plan.id});
  const historical={...adopted};delete historical.readiness;delete historical.adoption.reviewTrees;
  app.store.db.prepare('UPDATE park_tapping_plans SET body=? WHERE id=?').run(JSON.stringify(historical),plan.id);
  app.advance(2*86400000);
  app.edit(context=>{context.modules.trees.forEach(tree=>tree.tappingStatus='resting');return context;});
  assert.deepEqual(app.plans.adopt({planId:plan.id}),app.plans.withAdoption(historical));
  assert.equal(app.plans.get(plan.id).readiness,undefined);
  const fresh=(await app.plans.compute(app.siteId)),legacy={...fresh};delete legacy.readiness;
  app.store.db.prepare('UPDATE park_tapping_plans SET body=? WHERE id=?').run(JSON.stringify(legacy),fresh.id);
  assert.throws(()=>app.plans.adopt({planId:fresh.id}),error=>error.code==='PLAN_READINESS_REQUIRED');
});

test('expiry, withdrawal, pending preparation and outdated evidence are reported by execution preflight',async t=>{
  const app=setup(t);await app.prepareNormal();
  let context=app.context();
  assert.deepEqual(treeExecutionReadinessIssues({treeId:'T-0001',siteId:app.siteId,context,now:app.clock(),store:app.store,simulation:app.simulation,dispatchDataMode:'demo'}),[]);
  const pending=app.prepare(['T-0001']);
  assert.match((await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001').reasons.join('；'),/仍在生成/);
  const completed=await pending;
  app.store.withdrawStrategy(completed.strategy.runId,'测试撤回',app.clock().toISOString());
  assert.match((await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001').reasons.join('；'),/已撤回/);
  await app.prepareNormal();const before=(await app.plans.compute(app.siteId));app.advance(2*3600000);
  assert.throws(()=>app.plans.adopt({planId:before.id}),error=>error.code==='PLAN_READINESS_CHANGED');
  assert.match((await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001').reasons.join('；'),/已过期/);
  await app.prepareNormal();
  app.edit(value=>{const row=value.modules.inspection.evidence.find(row=>row.treeId==='T-0001');if(row)row.detections=[{...value.modules.inspection.evidence.find(row=>row.treeId==='T-0004').detections[0],classCode:'mud'}];return value;});
  assert.match((await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001').reasons.join('；'),/与当前证据不符/);
});

test('an adopted angle that expired or changed is listed before task generation',async t=>{
  const app=setup(t);await app.prepareNormal();
  const angle=await app.prepare(['T-0001'],'tapping_angle');assert.equal(angle.status,'succeeded');
  app.simulation.record({requestId:'angle-accepted',kind:'adopt_angle',treeId:'T-0001',siteId:app.siteId,strategyId:angle.strategy.strategyId,dataMode:'demo'});
  const plan=(await app.plans.compute(app.siteId));assert.equal(plan.readiness.readyCount,191);
  app.advance(1000);await app.prepare(['T-0001'],'tapping_angle');
  assert.match((await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001').reasons.join('；'),/重新采用角度/);
  assert.throws(()=>app.plans.adopt({planId:plan.id}),error=>error.code==='PLAN_READINESS_CHANGED');
  app.advance(2*3600000);await app.prepareNormal();
  const review=(await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001');
  assert.equal(review.reviewKind,'refresh');assert.match(review.reasons.join('；'),/重新采用角度/);
  assert.throws(()=>app.plans.adopt({planId:plan.id}),error=>error.code==='PLAN_READINESS_CHANGED');
});

test('stale angle view tree records block early even when no angle has been adopted',async t=>{
  const app=setup(t);await app.prepareNormal();
  await app.prepare(['T-0001'],'tapping_angle',{transform:context=>{context.modules.trees[0].tappingStatus='resting';context.snapshotId+='-old-rest';return context;}});
  const review=(await app.plans.compute(app.siteId)).readiness.reviewTrees.find(tree=>tree.treeId==='T-0001');
  assert.equal(review.reviewKind,'refresh');assert.match(review.reasons.join('；'),/角度策略引用的树档案仍为休割/);
});

test('an outstanding tree-surface task is excluded until its own return is complete',async t=>{
  const app=setup(t);await app.prepareNormal();
  const saved=app.simulation.tasks({tasks:[{id:'existing-surface',site:'hainan',siteId:app.siteId,kind:'巡检',story:'surface',
    title:'既有树表处理',block:'C',robot:'巡查员',start:'08:00',end:'09:00',status:'待处理',count:1,done:0,treeIndices:[100]}]});
  assert.deepEqual(saved.conflicts,[]);
  const plan=(await app.plans.compute(app.siteId));
  const row=plan.readiness.reviewTrees.find(tree=>tree.treeId==='T-0101');
  assert.equal(row.reviewKind,'inspect');assert.ok(row.reasons.includes('已有树表处理任务待回传'));
  assert.equal(plan.readiness.readyCount,190);
  const current=app.simulation.latestTasks().find(task=>task.id==='existing-surface');
  assert.equal(current.status,'待处理','preflight must not change existing work');
  assert.deepEqual(app.simulation.tasks({tasks:[{...current,status:'已完成',done:1,receipt:{outcome:'已完成处理',note:'明确记录测试处理回传',time:app.clock().toISOString()}}]}).conflicts,[]);
  assert.equal((await app.plans.compute(app.siteId)).readiness.readyCount,191);
  assert.throws(()=>app.plans.adopt({planId:plan.id}),error=>error.code==='PLAN_READINESS_CHANGED');
});

test('readiness filtering preserves weather and equipment stops and scenario capacity limits',()=>{
  const now=new Date(epoch),context=makeParkContext({now}),input={modelProposal:modelProposal(3),siteId:'demo-hainan',context,now,
    inventory:{stockKg:500,availableKg:300},storageKg:900,plannedSalesKg:40,salesSource:'test',
    events:[{kind:'rain',zone:null,status:'active'},{kind:'device_fault',zone:2,status:'active',note:'设备故障'}]};
  const plan=calculateParkPlan(input),typhoon=calculateParkPlan({...input,economicScenarioId:'typhoon'});
  assert.equal(plan.readiness.readyCount,191);assert.equal(plan.zones[2].frequency,0);
  assert.ok(plan.zones.every(zone=>!zone.dates.includes(plan.outlook[0].date)));
  assert.ok(typhoon.zones.every(zone=>zone.treeIndices.every(index=>plan.readiness.readyTrees.some(tree=>tree.treeIndex===index))));
  assert.ok(typhoon.zones[0].eligibleTrees<plan.zones[0].eligibleTrees);
});
