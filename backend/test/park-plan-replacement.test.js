import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel} from './helpers/park-plan-model.js';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {ParkPlanService} from '../src/park-plan.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {adoptDemoTaskStrategy,advanceDemo,phaseLabels} from '../../frontend/src/workspace/taskFlow.ts';

for(const siteId of ['demo-xsbn','demo-guangdong-maoming'])test(`${siteId}: replacing a pending park plan ends its simulation and leaves the new plan ready`,async t=>{
  let now=Date.parse('2026-10-23T02:00:00Z');
  const clock=()=>new Date(now),store=new Store(),simulation=new SimulationService(store,clock);
  t.after(()=>store.close());
  const plans=new ParkPlanService({model:planModel(2),store,simulation,makeParkContext,clock});
  const original=(await plans.compute(siteId)),adopted=plans.adopt({planId:original.id});
  assert.ok(adopted.adoption.tasks.length>0);
  const pending=simulation.latestTasks(siteId).find(task=>task.sourceParkPlanId===original.id);
  const enabled=adoptDemoTaskStrategy(pending,clock().toISOString());
  const result=simulation.tasks({tasks:[{...enabled,dispatch:{...enabled.dispatch,
    auto:{stage:'travel',startedAt:now,nextAt:now+1000}}}]});
  assert.deepEqual(result.conflicts,[]);
  now+=500;
  const next=(await plans.compute(siteId));
  assert.notEqual(next.id,original.id);
  assert.throws(()=>plans.adopt({planId:next.id}),error=>error.code==='PLAN_CONFLICT');
  const replacement=plans.adopt({planId:next.id,replace:true});
  assert.ok(replacement.adoption.tasks.length>0);
  const tasks=simulation.latestTasks(siteId);
  for(const id of replacement.adoption.replacedTaskIds){
    const cancelled=tasks.find(task=>task.id===id);
    assert.equal(cancelled.status,'已取消');
    assert.equal(phaseLabels[cancelled.dispatch.phase],'已取消');
    assert.equal(cancelled.dispatch.auto,undefined);
    assert.equal(cancelled.dispatch.history.at(-1).label,cancelled.cancelReason);
    assert.match(cancelled.cancelReason,new RegExp(next.id));
    assert.deepEqual(advanceDemo(cancelled,now+60000),cancelled,'a cancelled simulation must not resume on the next UI tick');
  }
  assert.equal(tasks.find(task=>task.id===pending.id).demoStrategy.adoptedAt,enabled.demoStrategy.adoptedAt);
  assert.ok(replacement.adoption.tasks.every(task=>tasks.find(item=>item.id===task.id).dispatch.phase==='scheduled'));
  assert.deepEqual(plans.adopt({planId:next.id,replace:true}),replacement,'repeating adoption keeps the same tasks');
});
