import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {parkProposal} from './helpers/park-plan-model.js';
import {seedDemoTasks} from '../src/adapters/demo-tasks.js';
import {transitionTask} from '../../frontend/src/workspace/taskFlow.ts';

const SITE='demo-guangdong-maoming',NOW=new Date('2026-10-28T05:30:00Z');
function fixture(t,seedTasks){
 let frequency=2;
 const requests=[];
 const assistantModel={describe:()=>({configured:true,provider:'test',model:'existing-task-model'}),isConfigured:()=>true,
  async complete(request){requests.push(structuredClone(request));return {content:JSON.stringify(parkProposal(frequency)),toolCalls:[]};}};
 const app=createApp({dbPath:':memory:',clock:()=>NOW,seedTasks,generator:new RuleGenerator(),assistantModel,automaticDataMode:'demo'});
 t.after(()=>app.close());
 return {app,simulation:app.assistant.simulation,plans:app.parkPlans,requests,frequency:value=>{frequency=value;}};
}

test('seeded daily tasks are input facts and new model plans remain executable when adopting and replacing',async t=>{
 const f=fixture(t,true),samples=structuredClone(f.simulation.latestTasks(SITE));
 assert.equal(samples.length,4);assert.deepEqual(samples.map(t=>t.count).sort((a,b)=>a-b),[28,30,32,36]);
 const original=await f.plans.compute(SITE);
 const snapshot=JSON.parse(f.requests[0].messages[1].content).parkData;
 for(const zone of snapshot.zones){
  assert.equal(zone.existingTasks.length,1);assert.equal(zone.existingTasks[0].date,'2026-10-28');
  assert.ok(!zone.availableDates.includes('2026-10-28'));
 }
 assert.ok(original.zones.every(zone=>zone.dates.length&&zone.dates.every(date=>date!=='2026-10-28')));
 const adopted=f.plans.adopt({planId:original.id});
 assert.ok(adopted.adoption.tasks.length>=4);assert.equal(adopted.adoption.skipped.length,0);
 f.frequency(1);
 const reduced=await f.plans.compute(SITE,{economicScenarioId:'demand_weak'});
 assert.ok(reduced.zones.every(zone=>zone.frequency===0&&zone.existingFrequency===1&&zone.totalFrequency===1));
 assert.throws(()=>f.plans.adopt({planId:reduced.id}),error=>error.code==='PLAN_CONFLICT');
 const replaced=f.plans.adopt({planId:reduced.id,replace:true});
 assert.equal(replaced.adoption.tasks.length,0);assert.equal(replaced.adoption.skipped.length,0);
 assert.equal(replaced.adoption.existingTasks.length,4);
 assert.deepEqual(new Set(replaced.adoption.replacedTaskIds),new Set(adopted.adoption.tasks.map(t=>t.id)));
 assert.deepEqual(f.simulation.latestTasks(SITE).filter(task=>samples.some(s=>s.id===task.id)),samples);
 assert.ok(replaced.adoption.tasks.every(task=>task.status==='待开始'&&task.date!=='2026-10-28'));
});

test('tasks added after generation remain traceable from every skipped date including older adoption records',async t=>{
 const f=fixture(t,false);f.frequency(1);
 const plan=await f.plans.compute(SITE);
 assert.ok(plan.zones.every(zone=>zone.dates[0]==='2026-10-28'));
 seedDemoTasks(f.simulation,NOW);
 const adopted=f.plans.adopt({planId:plan.id});
 assert.equal(adopted.adoption.tasks.length,0);assert.equal(adopted.adoption.skipped.length,4);
 assert.equal(adopted.adoption.existingTasks.length,4);
 for(const skipped of adopted.adoption.skipped){
  assert.equal(skipped.taskIds.length,1);
  assert.ok(adopted.adoption.existingTasks.some(task=>task.id===skipped.taskIds[0]&&task.zone===skipped.zone&&task.date===skipped.date));
 }
 const old=f.plans.get(plan.id);old.adoption.skipped.forEach(skip=>delete skip.taskIds);
 f.app.store.db.prepare('UPDATE park_tapping_plans SET body=? WHERE id=?').run(JSON.stringify(old),plan.id);
 assert.deepEqual(f.plans.withAdoption(f.plans.get(plan.id)).adoption.existingTasks,adopted.adoption.existingTasks);
});

test('three weekly cuts include seeded work, and split tasks on one date do not add extra rounds',async t=>{
 const f=fixture(t,true);f.frequency(3);
 f.simulation.market({siteId:SITE,storageKg:3000});
 const original=await f.plans.compute(SITE);
 assert.ok(original.zones.every(zone=>zone.existingFrequency===1&&zone.frequency===2&&zone.totalFrequency===3));
 const adopted=f.plans.adopt({planId:original.id});
 assert.equal(adopted.adoption.tasks.length,8);
 assert.equal(adopted.adoption.existingTasks.length,4);
 const datesByTree=new Map();
 for(const task of f.simulation.latestTasks(SITE))for(const tree of task.treeIndices){
  const dates=datesByTree.get(tree)??new Set();dates.add(task.date);datesByTree.set(tree,dates);
 }
 assert.ok([...datesByTree.values()].every(dates=>dates.size<=3));
 const input=original.modelProposal.inputSnapshot;
 assert.ok(input.zones.every(zone=>zone.existingFrequency===1));
 assert.equal(input.economics.uniformFrequencyProjections.find(row=>row.frequencyPerWeek===1).productionKg,0);
 assert.equal(input.economics.uniformFrequencyProjections.find(row=>row.frequencyPerWeek===3).productionKg,original.production.expectedDryKg);
});

test('completed cuts in a cancelled task still count, with tree/date deduplication for split work',async t=>{
 const f=fixture(t,false);f.frequency(3);
 const save=task=>{const result=f.simulation.tasks({tasks:[task]});assert.deepEqual(result.conflicts,[]);return result.tasks.find(row=>row.id===task.id);};
 const task=(id,treeIndices,date='2026-10-28')=>f.simulation.preparePlannedTask({id,site:'guangdong-maoming',siteId:SITE,block:'A',robot:'R-A',date,
  title:'分片模拟作业',kind:'割胶',start:'06:30',end:'—',count:treeIndices.length,done:0,status:'待开始',treeIndices});
 let cancelled=save(task('first-split',[0,1]));
 for(const event of ['start','progress','cancel','ack'])cancelled=save(transitionTask(cancelled,event,NOW.toISOString()));
 save(task('second-split',[2,3]));
 save(task('third-split',[4,5],'2026-10-29'));
 f.simulation.market({siteId:SITE,storageKg:3000});
 const plan=await f.plans.compute(SITE),zone=plan.zones.find(zone=>zone.zone==='A');
 assert.equal(zone.existingFrequency,1,'disjoint trees on separate dates and split jobs on one date are one cut per tree');
 assert.equal(zone.frequency,2);assert.equal(zone.totalFrequency,3);
 assert.ok(zone.existingTasks.some(task=>task.id===cancelled.id&&task.status==='已取消'&&task.done===1));
 assert.ok(!zone.dates.includes('2026-10-28')&&!zone.dates.includes('2026-10-29'));
 const adopted=f.plans.adopt({planId:plan.id});
 assert.ok(adopted.adoption.existingTasks.some(task=>task.id===cancelled.id&&task.done===1));
});

test('an unadopted saved plan with the former frequency basis asks for recomputation',async t=>{
 const f=fixture(t,true),plan=await f.plans.compute(SITE);
 const previous={...plan,policyVersion:'park-tapping-llm-v5-hard-constraints'};
 f.app.store.db.prepare('UPDATE park_tapping_plans SET body=? WHERE id=?').run(JSON.stringify(previous),plan.id);
 assert.match(f.plans.withAdoption(f.plans.get(plan.id)).economicCheck.reason,/已有任务合计本周割次/);
 assert.throws(()=>f.plans.adopt({planId:plan.id}),error=>error.code==='PLAN_ECONOMICS_CHANGED');
});
