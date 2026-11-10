import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {parkProposal} from './helpers/park-plan-model.js';

const SITE='demo-guangdong-maoming',NOW=new Date('2026-10-28T05:30:00Z');
function fixture(t) {
  let frequency=3;
  const model={isConfigured:()=>true,describe:()=>({configured:true,provider:'test',model:'fusion-merge'}),
    async complete(){return {content:JSON.stringify(parkProposal(frequency)),toolCalls:[]};}};
  const app=createApp({dbPath:':memory:',clock:()=>NOW,seedTasks:true,generator:new RuleGenerator(),assistantModel:model,automaticDataMode:'demo'});
  t.after(()=>app.close());
  const identity=app.identities.resolve(app.identities.login({accountId:'manager-gd'}).token);
  const session=app.assistant.createSession({siteId:SITE},identity),turn={turnId:'merge-test-turn'};
  const toolkit=app.assistant.toolkit,simulation=app.assistant.simulation;
  simulation.market({siteId:SITE,storageKg:3000});
  const prepare=(planId,replace=false)=>toolkit.execute('prepare_operation',{
    kind:'adopt_plan',targetId:planId,payloadJson:JSON.stringify({replace}),
  },{session,turn,identity}).data;
  return {app,identity,session,turn,toolkit,simulation,prepare,frequency:value=>{frequency=value;}};
}

test('assistant confirmation adopts and replaces plans while counting existing work toward the weekly target',async t=>{
  const f=fixture(t),originalTasks=structuredClone(f.simulation.latestTasks(SITE));
  assert.equal(originalTasks.length,4);
  const plan=await f.app.parkPlans.compute(SITE);
  assert.ok(plan.zones.every(zone=>zone.existingFrequency===1&&zone.frequency===2&&zone.totalFrequency===3));
  const read=f.toolkit.execute('read_production_plan',{planId:plan.id},f);
  assert.equal(read.data.plan.policyVersion,'park-tapping-llm-v6-existing-rounds');
  const operation=f.prepare(read.data.plan.id);
  assert.deepEqual(f.simulation.latestTasks(SITE),originalTasks,'preparing a card must not schedule work');
  const confirm=()=>f.toolkit.actions.confirm(operation.id,f.session,f.identity,()=>f.identity);
  const [receipt,repeated]=await Promise.all([confirm(),confirm()]);
  assert.equal(receipt.state,'completed');
  assert.deepEqual(repeated,receipt);
  assert.equal(receipt.result.adoption.tasks.length,8);
  assert.equal(receipt.result.adoption.existingTasks.length,4);
  const datesByTree=new Map();
  for(const task of f.simulation.latestTasks(SITE))for(const index of task.treeIndices){
    const dates=datesByTree.get(index)??new Set();dates.add(task.date);datesByTree.set(index,dates);
  }
  assert.ok([...datesByTree.values()].every(dates=>dates.size<=3),'the new card path must retain the weekly cut limit');
  f.frequency(1);
  const reduced=await f.app.parkPlans.compute(SITE,{economicScenarioId:'demand_weak'});
  const replacement=f.prepare(reduced.id,true);
  assert.equal(f.simulation.latestTasks(SITE).filter(task=>task.status!=='已取消').length,12);
  const replaced=await f.toolkit.actions.confirm(replacement.id,f.session,f.identity,()=>f.identity);
  assert.equal(replaced.result.adoption.tasks.length,0);
  assert.equal(replaced.result.adoption.existingTasks.length,4);
  assert.deepEqual(new Set(replaced.result.adoption.replacedTaskIds),new Set(receipt.result.adoption.tasks.map(task=>task.id)));
  assert.deepEqual(f.simulation.latestTasks(SITE).filter(task=>originalTasks.some(original=>original.id===task.id)),originalTasks);
});

test('assistant adoption cards reject other roles, other parks, and revoked identities before scheduling',async t=>{
  const f=fixture(t),plan=await f.app.parkPlans.compute(SITE),before=structuredClone(f.simulation.latestTasks(SITE));
  for(const [accountId,expected] of [['operator-hn','FORBIDDEN'],['manager-hn','SITE_MISMATCH']]){
    const identity=f.app.identities.resolve(f.app.identities.login({accountId}).token);
    const session=f.app.assistant.createSession({siteId:'demo-hainan'},identity);
    assert.throws(()=>f.toolkit.execute('prepare_operation',{kind:'adopt_plan',targetId:plan.id},
      {session,turn:f.turn,identity}),error=>error.code===expected);
  }
  const operation=f.prepare(plan.id);
  f.app.identities.logout(f.identity.token);
  await assert.rejects(f.toolkit.actions.confirm(operation.id,f.session,f.identity,
    ()=>f.app.identities.resolve(f.identity.token)),error=>error.code==='SESSION_EXPIRED');
  assert.equal(f.toolkit.actions.get(operation.id,f.session,f.identity).state,'prepared');
  assert.deepEqual(f.simulation.latestTasks(SITE),before);
});

test('the production-plan tool keeps costs and inventory within management roles while operators retain task access',async t=>{
  const f=fixture(t),plan=await f.app.parkPlans.compute('demo-hainan');
  for(const accountId of ['operator-hn','manager-hn','center-hz']){
    const identity=f.app.identities.resolve(f.app.identities.login({accountId}).token);
    const session=f.app.assistant.createSession({siteId:'demo-hainan'},identity),context={session,turn:f.turn,identity};
    const result=f.toolkit.execute('read_production_plan',{planId:plan.id},context);
    const tools=f.toolkit.definitionsFor(session).map(item=>item.function.name);
    if(accountId==='operator-hn'){
      assert.equal(result.denied,true);
      assert.equal(result.data.error,'TOOL_NOT_ALLOWED');
      assert.equal(result.data.plan,undefined);
      assert.doesNotMatch(JSON.stringify(result),/"economics"|"inventory"|"inputSnapshot"/);
      assert.ok(!tools.includes('read_production_plan'));
      const tasks=f.toolkit.execute('read_tasks',{},context);
      assert.ok(!tasks.denied);assert.ok(tasks.data.tasks.length);
    }else{
      assert.ok(!result.denied);assert.equal(result.data.plan.id,plan.id);
      assert.ok(result.data.plan.economics);assert.ok(result.data.plan.inventory);
      assert.ok(tools.includes('read_production_plan'));
    }
  }
});
