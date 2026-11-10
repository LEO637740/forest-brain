import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {makeDemoTasks,makeDemoTaskChain,seedDemoTasks,RETIRED_SAMPLE_REASON} from '../src/adapters/demo-tasks.js';
import {createApp} from '../src/server.js';
import {createMhApp} from '../src/mh-app.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {parks} from '../../shared/parkCatalog.ts';
import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';
import {groupOperationsTasks,taskScheduleIssue} from '../../frontend/src/workspace/operationsModel.ts';
import {adoptDemoTaskStrategy,advanceDemo,resolveSurface,transitionTask} from '../../frontend/src/workspace/taskFlow.ts';

const now=new Date('2026-10-19T02:00:00.000Z');
const withoutChain=({demoStrategy,demoReceipts,...task})=>task;

test('daily demo tasks cover four actionable states and four zones in every park',()=>{
  const tasks=makeDemoTasks(now);
  assert.equal(tasks.length,40);
  assert.equal(new Set(tasks.map(task=>task.id)).size,40);
  assert.deepEqual(tasks,makeDemoTasks(now));
  assert.equal(makeDemoTasks(new Date('2026-10-18T18:00:00.000Z'))[0].date,'2026-10-19');
  for(const site of Object.keys(parks)){
    const rows=groupOperationsTasks(tasks,site,'2026-10-19').day;
    assert.equal(rows.length,4);
    assert.deepEqual(rows.map(task=>task.block),['A','B','C','D']);
    assert.deepEqual(rows.map(task=>task.status),['待开始','执行中','待处理','已完成']);
    assert.equal(rows.filter(task=>task.status!=='已完成').length,3);
    for(const [zone,task] of rows.entries()){
      assert.equal(task.siteId,parks[site].siteId);
      assert.equal(task.robot,`${parks[site].treePrefix}-模拟机器人-${task.block}`);
      assert.match(task.title,/^模拟 · /);
      assert.equal(taskScheduleIssue(task),null);
      assert.equal(task.dispatch.auto,undefined);
      assert.equal(task.treeIndices.length,task.count);
      assert.ok(task.treeIndices.every(index=>Math.floor(index/50)===zone));
      assert.deepEqual(taskEvidence(task).issues,[]);
      assert.equal(task.demoStrategy.taskId,task.id);
      assert.equal(task.demoStrategy.siteId,task.siteId);
      assert.deepEqual(task.demoStrategy.treeIndices,task.treeIndices);
      assert.equal(task.demoStrategy.mode,'simulation');
      assert.equal(task.demoStrategy.generator,'demo_rules');
      assert.match(task.demoStrategy.basis.join(' '),/示例参数/);
      assert.equal(Boolean(task.demoStrategy.adoptedAt),zone>0);
      assert.equal(task.demoReceipts.length,task.done);
      assert.ok(task.demoReceipts.every(receipt=>receipt.strategyId===task.demoStrategy.strategyId && receipt.taskId===task.id && receipt.siteId===task.siteId && receipt.mode==='simulation'));
    }
    assert.equal(taskEvidence(rows[3]).completionKind,'flow');
    assert.equal(taskEvidence(rows[3]).hasCompletionRecord,true);
  }
});

test('seeded workflows support starting, continuing and resolving the pending tree',()=>{
  const [planned,running,review]=makeDemoTasks(now);
  const adopted={...planned,demoStrategy:{...planned.demoStrategy,adoptedAt:now.toISOString(),adoptedBy:'演示操作员'}};
  assert.equal(transitionTask(adopted,'start').status,'执行中');
  assert.equal(transitionTask(running,'progress').done,13);
  assert.equal(review.dispatch.incident.treeIndex,review.treeIndices[review.done]);
  const resolved=resolveSurface(review,'adopt',+now);
  assert.equal(resolved.status,'执行中');
  assert.equal(resolved.dispatch.incident.status,'adopted');
  assert.equal(transitionTask(resolved,'progress').done,9);
});

test('reopening on the same day fills missing samples without replacing progress or user tasks',()=>{
  const path=join(tmpdir(),`demo-tasks-${randomUUID()}.sqlite`);
  let store=new Store(path);
  try{
    let simulation=new SimulationService(store,()=>now);
    const planned={...withoutChain(makeDemoTasks(now)[0]),id:'user-scheduled-task',title:'用户安排的作业'};
    assert.equal(simulation.tasks({tasks:[planned]}).accepted,1);
    assert.equal(seedDemoTasks(simulation,now),40);
    const running=simulation.latestTasks().find(task=>task.site==='hainan'&&task.block==='B');
    const progressed=makeDemoTaskChain(transitionTask(running,'progress',now.toISOString()),now);
    assert.equal(simulation.tasks({tasks:[progressed]}).accepted,1);
    const before=simulation.latestTasks();
    store.close();store=new Store(path);simulation=new SimulationService(store,()=>now);
    assert.equal(seedDemoTasks(simulation,now),0);
    assert.deepEqual(simulation.latestTasks(),before);
    assert.equal(simulation.latestTasks().find(task=>task.id===running.id).done,13);
    assert.ok(simulation.latestTasks().some(task=>task.id===planned.id));
  }finally{store.close();}
});

test('existing completed samples gain their chain once without replacing saved progress, history or receipts',()=>{
  const store=new Store(),simulation=new SimulationService(store,()=>now);
  try{
    const old=makeDemoTasks(now).map(withoutChain);
    const running=old.find(task=>task.site==='hainan'&&task.block==='B');
    running.done=15;
    running.dispatch.history.push({time:now.toISOString(),label:'用户已经推进到第15棵'});
    const review=old.find(task=>task.site==='hainan'&&task.block==='C');
    review.dispatch.skipped=[review.treeIndices[8]];
    review.dispatch.incident={...review.dispatch.incident,status:'skipped',action:'skip'};
    review.dispatch.phase='running';review.status='执行中';
    const completed=old.find(task=>task.site==='hainan'&&task.block==='D');
    completed.receipt={outcome:'已完成处理',note:'原有记录',time:now.toISOString()};
    assert.equal(simulation.tasks({tasks:old}).accepted,40);
    assert.equal(seedDemoTasks(simulation,now),40);
    for(const task of old){
      const saved=simulation.latestTasks().find(item=>item.id===task.id);
      assert.equal(saved.revision,2);
      assert.deepEqual(withoutChain(saved),{...task,revision:2});
      assert.equal(saved.demoReceipts.filter(receipt=>receipt.outcome==='completed').length,task.done);
      assert.equal(saved.demoReceipts.filter(receipt=>receipt.outcome==='skipped').length,task.dispatch.skipped?.length??0);
    }
    const before=simulation.latestTasks();
    assert.equal(seedDemoTasks(simulation,new Date(+now+3600000)),0);
    assert.deepEqual(simulation.latestTasks(),before);
    const savedCompleted=before.find(task=>task.id===completed.id);
    assert.equal(simulation.tasks({tasks:[{...savedCompleted,title:'不能改写终态'}]}).conflicts[0].code,'TASK_TERMINAL');
    assert.equal(store.db.prepare('SELECT count(*) n FROM runs').get().n,0);
  }finally{store.close();}
});

test('saved demo chains keep their task identity and immutable receipts while adoption and execution advance',()=>{
  const store=new Store(),simulation=new SimulationService(store,()=>now);
  try{
    seedDemoTasks(simulation,now);
    const planned=simulation.latestTasks().find(task=>task.site==='hainan'&&task.block==='A');
    const adopted={...planned,demoStrategy:{...planned.demoStrategy,adoptedAt:now.toISOString(),adoptedBy:'演示操作员'}};
    assert.equal(simulation.tasks({tasks:[adopted]}).accepted,1);
    let current=simulation.latestTasks().find(task=>task.id===planned.id);
    let progressed=transitionTask(transitionTask(current,'start',now.toISOString()),'progress',now.toISOString());
    progressed=makeDemoTaskChain(progressed,now);
    assert.equal(progressed.done,1);
    assert.equal(simulation.tasks({tasks:[progressed]}).accepted,1);
    current=simulation.latestTasks().find(task=>task.id===planned.id);
    assert.equal(current.demoReceipts[0].strategyId,current.demoStrategy.strategyId);
    assert.equal(current.demoReceipts[0].treeIndex,current.treeIndices[0]);
    assert.equal(simulation.tasks({tasks:[{...current,demoStrategy:{...current.demoStrategy,siteId:'demo-xsbn'}}]}).conflicts[0].code,'DEMO_STRATEGY_MISMATCH');
    assert.equal(simulation.tasks({tasks:[{...current,demoStrategy:{...current.demoStrategy,summary:'改写方案'}}]}).conflicts[0].code,'DEMO_STRATEGY_CHANGED');
    assert.equal(simulation.tasks({tasks:[{...current,demoReceipts:[]}]}).conflicts[0].code,'RECEIPT_CHANGED');
    assert.equal(simulation.tasks({tasks:[{...current,demoReceipts:[{...current.demoReceipts[0],strategyId:'other-strategy'}]}]}).conflicts[0].code,'DEMO_RECEIPT_MISMATCH');
    assert.equal(seedDemoTasks(simulation,now),0);
  }finally{store.close();}
});

test('adopted A demo runs to 30 persisted receipts and C skip, progress and cancellation keep the same strategy chain',async()=>{
  const path=join(tmpdir(),`demo-chain-execution-${randomUUID()}.sqlite`);
  let clock=+now;
  const app=createApp({dbPath:path,clock:()=>new Date(clock),generator:new RuleGenerator(),pauseModelsOnStart:true,seedTasks:true});
  let finalA,finalC;
  try{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const simulation=new SimulationService(app.store,()=>new Date(clock));
    const save=task=>{
      const result=simulation.tasks({tasks:[task]});
      assert.equal(result.accepted,1,JSON.stringify(result.conflicts));
      assert.deepEqual(result.conflicts,[]);
      return result.tasks.find(item=>item.id===task.id);
    };
    let task=simulation.latestTasks('demo-hainan').find(item=>item.block==='A');
    const strategyId=task.demoStrategy.strategyId;
    assert.equal(task.demoStrategy.adoptedAt,null);
    task=save(adoptDemoTaskStrategy(task,new Date(clock).toISOString()));
    task=save({...task,dispatch:{...task.dispatch,auto:{stage:'travel',startedAt:clock,nextAt:clock+1000}}});
    for(let tick=0;tick<100&&task.status!=='已完成';tick++){
      clock=task.dispatch.auto.nextAt;
      task=save(advanceDemo(task,clock));
    }
    assert.equal(task.status,'已完成');
    assert.equal(task.done,30);
    assert.equal(task.demoReceipts.length,30);
    assert.ok(task.demoReceipts.every(receipt=>receipt.outcome==='completed'&&receipt.strategyId===strategyId));
    assert.deepEqual(task.demoReceipts.map(receipt=>receipt.treeIndex),task.treeIndices);
    finalA=task;

    let review=simulation.latestTasks('demo-hainan').find(item=>item.block==='C');
    const skippedIndex=review.dispatch.incident.treeIndex;
    review=save(resolveSurface(review,'skip',++clock));
    assert.equal(review.demoReceipts.find(receipt=>receipt.treeIndex===skippedIndex).outcome,'skipped');
    review=save(transitionTask(review,'progress',new Date(++clock).toISOString()));
    assert.equal(review.done,9);
    review=save(transitionTask(review,'cancel',new Date(++clock).toISOString()));
    review=save(transitionTask(review,'ack',new Date(++clock).toISOString()));
    assert.equal(review.status,'已取消');
    assert.equal(review.demoReceipts.length,28);
    assert.equal(review.demoReceipts.filter(receipt=>receipt.outcome==='completed').length,9);
    assert.equal(review.demoReceipts.filter(receipt=>receipt.outcome==='skipped').length,1);
    assert.equal(review.demoReceipts.filter(receipt=>receipt.outcome==='cancelled').length,18);
    assert.ok(review.demoReceipts.every(receipt=>receipt.strategyId===review.demoStrategy.strategyId&&receipt.taskId===review.id));
    finalC=review;

    const response=await fetch(`${base}/api/simulation/tasks?siteId=demo-hainan`);
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.deepEqual(payload.items.find(item=>item.id===finalA.id),finalA);
    assert.deepEqual(payload.items.find(item=>item.id===finalC.id),finalC);
    assert.equal(app.store.db.prepare('SELECT count(*) n FROM runs').get().n,0);
  }finally{await app.close();}
  const reopened=new Store(path);
  try{
    const simulation=new SimulationService(reopened,()=>new Date(clock));
    assert.deepEqual(simulation.latestTasks().find(task=>task.id===finalA.id),finalA);
    assert.deepEqual(simulation.latestTasks().find(task=>task.id===finalC.id),finalC);
    assert.equal(seedDemoTasks(simulation,new Date(clock)),0);
  }finally{reopened.close();}
});

test('a new Shanghai day adds its own samples, keeps completed and handled history, and retires untouched open samples',()=>{
  const store=new Store(),simulation=new SimulationService(store,()=>now);
  try{
    assert.equal(seedDemoTasks(simulation,now),40);
    // One past sample was demonstrated: it keeps its own state as a genuine carry-over.
    const running=simulation.latestTasks().find(task=>task.site==='hainan'&&task.block==='B');
    assert.equal(simulation.tasks({tasks:[makeDemoTaskChain(transitionTask(running,'progress',now.toISOString()),now)]}).accepted,1);
    const before=simulation.latestTasks(),next=new Date(+now+86400000);
    assert.equal(seedDemoTasks(simulation,next),40);
    const after=simulation.latestTasks();
    assert.equal(after.length,80);
    for(const task of before){
      const saved=after.find(item=>item.id===task.id);
      if(task.status==='已完成'||task.id===running.id){assert.deepEqual(saved,task);continue;}
      // Untouched open samples end without losing anything already recorded.
      assert.equal(saved.status,'已取消');assert.equal(saved.dispatch.phase,'cancelled');
      assert.equal(saved.cancelReason,RETIRED_SAMPLE_REASON);
      assert.deepEqual(saved.dispatch.history,[...task.dispatch.history,{time:next.toISOString(),label:RETIRED_SAMPLE_REASON}]);
      assert.equal(saved.done,task.done);assert.deepEqual(saved.demoReceipts,task.demoReceipts);
      assert.deepEqual(saved.demoStrategy,task.demoStrategy);assert.deepEqual(taskEvidence(saved).receipts,taskEvidence(task).receipts);
    }
    assert.equal(after.filter(task=>task.status==='已取消').length,29,'3 open samples × 10 parks, minus the demonstrated one');
    assert.equal(after.find(task=>task.id===running.id).status,'执行中');
    for(const site of Object.keys(parks))assert.equal(groupOperationsTasks(after,site,'2026-10-20').day.length,4);
    // Reseeding the same day changes nothing more.
    const settled=simulation.latestTasks();
    assert.equal(seedDemoTasks(simulation,next),0);
    assert.deepEqual(simulation.latestTasks(),settled);
  }finally{store.close();}
});

test('local preparation CLI preserves model and automatic controls without creating runs',()=>{
  const path=join(tmpdir(),`demo-task-chain-${randomUUID()}.sqlite`);
  const initial=new Store(path);
  const automatic={paused:true,checkedAt:now.toISOString()};
  initial.setModelPaused(true,now.toISOString());
  initial.saveAutomaticState(automatic);
  initial.close();
  const script=fileURLToPath(new URL('../scripts/prepare-demo-task-chain.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[script,path],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.updated,40);assert.equal(result.linked,40);assert.equal(result.receipts,520);
  const repeat=spawnSync(process.execPath,[script,path],{encoding:'utf8'});
  assert.equal(repeat.status,0,repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).updated,0);
  const store=new Store(path);
  try{
    assert.deepEqual(store.getAutomaticState(),automatic);
    assert.deepEqual(store.getModelControl(),{paused:true,updatedAt:now.toISOString()});
    assert.equal(store.db.prepare('SELECT count(*) n FROM runs').get().n,0);
    assert.equal(new SimulationService(store,()=>now).latestTasks().length,40);
  }finally{store.close();}
});

test('MH demo startup includes daily tasks without model runs while the low-level harness stays empty',async()=>{
  const app=createMhApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),pauseModelsOnStart:true});
  try{
    const simulation=new SimulationService(app.store,()=>now);
    assert.equal(simulation.latestTasks().length,40);
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
  }finally{await app.close();}
  const harness=createApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),pauseModelsOnStart:true});
  try{assert.equal(harness.store.db.prepare('SELECT COUNT(*) n FROM simulation_task_receipts').get().n,0);}
  finally{await harness.close();}
  const remote=createMhApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),contextProvider:{mode:'remote'},pauseModelsOnStart:true});
  try{assert.equal(remote.store.db.prepare('SELECT COUNT(*) n FROM simulation_task_receipts').get().n,0);}
  finally{await remote.close();}
});

test('trial station samples are labelled robot trials, never production tapping',()=>{
  const tasks=makeDemoTasks(new Date('2026-10-21T00:00:00Z'));
  const trial=tasks.filter(task=>task.site==='xian'),production=tasks.filter(task=>task.site==='hainan');
  assert.equal(trial.length,4);
  assert.ok(trial.every(task=>/机器人试割（不计产量）/.test(task.title)&&/机器人试割方案/.test(task.demoStrategy.title)));
  assert.ok(production.every(task=>!/试割/.test(task.title)));
  assert.equal(production.find(task=>task.block==='A').title,'模拟 · A区常规割胶');
});
