import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { SimulationService } from '../src/simulation.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { makeParkContext } from '../src/adapters/park-demo.js';

function fixture(t) {
  let instant = Date.parse('2026-10-19T02:00:00Z'), sequence = 0;
  const clock = () => new Date(instant), store = new Store(), simulation = new SimulationService(store, clock);
  const runtime = new HarnessRuntime({store, contextProvider:new LocalContextProvider(store), clock});
  t.after(async () => {await runtime.stop(); store.close();});
  return {store, simulation, events:simulation.operationalEvents, advance() {instant += 60000;},
    async strategy(siteId = 'demo-hainan', treeId = 'T-0001', kind = 'tapping_angle') {
      const context = makeParkContext({siteId,treeIds:[treeId],now:clock()});
      store.saveContext(context);
      const requestId = `event-strategy-${++sequence}`;
      const accepted = runtime.submit({requestId,kind,siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,
        inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode:'demo_rules'});
      if (kind !== 'weather_window') store.bindTreeView({siteId,treeId,kind,dataMode:'demo',preparationId:requestId,requestId,
        runId:accepted.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
      await runtime.idle();
      const run = store.getRun(accepted.runId);
      assert.equal(run.status, 'succeeded', JSON.stringify(run.result));
      return run.result.strategy;
    },
  };
}

const rain = (requestId, siteId = 'hainan', zone = null) => ({requestId,siteId,kind:'rain',zone,note:'模拟降雨，暂停割胶并检查收胶防雨措施'});
const fault = (requestId, zone = 0, siteId = 'hainan') => ({requestId,siteId,kind:'device_fault',zone,note:'模拟割胶头故障'});
const reference = (strategy, treeId = 'T-0001') => ({siteId:strategy.siteId,treeId,strategyId:strategy.strategyId,runId:strategy.runId,revision:strategy.revision,dataMode:'demo'});
const valid = (simulation, strategy, treeId) => simulation.validateStrategies({strategies:[reference(strategy,treeId)]}).items[0];

test('event facts persist across service recreation and create retry never reopens a closed event', t => {
  const {events, store, simulation, advance} = fixture(t), input = rain('rain-once');
  const created = events.create(input);
  assert.equal(created.siteId, 'demo-hainan'); assert.equal(created.status, 'active');
  assert.equal(created.mode, 'simulation'); assert.deepEqual(events.create(input), created);
  assert.throws(() => events.create({...input,note:'changed'}), error => error.code === 'EVENT_CONFLICT');
  advance();
  const resolved = events.transition(created.id,'resolve',{siteId:'hainan',note:'雨已停止，地表待复核'});
  assert.equal(resolved.status,'resolved'); assert.ok(resolved.resolvedAt > created.createdAt);
  assert.deepEqual(events.transition(created.id,'resolve',{siteId:'demo-hainan',note:'雨已停止，地表待复核'}),resolved);
  advance();
  const closed = events.transition(created.id,'resume',{siteId:'hainan',note:'已检查地表及收胶遮盖，允许重新核验任务'});
  assert.equal(closed.status,'closed'); assert.ok(closed.closedAt > resolved.resolvedAt);
  assert.deepEqual(events.create(input),closed);
  assert.deepEqual(events.transition(created.id,'resolve',{siteId:'hainan',note:resolved.resolutionNote}),closed);
  assert.deepEqual(events.transition(created.id,'resume',{siteId:'hainan',note:closed.resumeNote}),closed);
  assert.throws(() => events.transition(created.id,'resume',{siteId:'hainan',note:'rewrite'}), error => error.code === 'EVENT_ACTION_CONFLICT');
  const reloaded = new SimulationService(store, simulation.clock);
  assert.deepEqual(reloaded.operationalEvents.list('hainan'), [closed]);
});

test('resume requires an explicit resolution and event changes never rewrite task or execution receipts', t => {
  const {simulation, events, store} = fixture(t);
  const task = {id:'finished',site:'hainan',kind:'割胶',status:'已完成',count:1,done:1,treeIndices:[0],railResult:{outcome:'completed'}};
  simulation.tasks({tasks:[task]});
  const before = store.db.prepare('SELECT * FROM simulation_task_receipts').all();
  const event = events.create(fault('broken'));
  assert.throws(() => events.transition(event.id,'resume',{siteId:'hainan',note:'attempt restart'}), error => error.code === 'EVENT_STATE_CONFLICT');
  events.transition(event.id,'resolve',{siteId:'hainan',note:'模拟维修完成'});
  events.transition(event.id,'resume',{siteId:'hainan',note:'确认空载测试通过'});
  assert.deepEqual(store.db.prepare('SELECT * FROM simulation_task_receipts').all(),before);
});

test('rain and faults coexist; resolution still blocks new dispatch until each event is explicitly closed', async t => {
  const {simulation, events, strategy} = fixture(t);
  const a = await strategy(), b = await strategy('demo-hainan','T-0051'), xb = await strategy('demo-xsbn');
  const rainEvent = events.create(rain('rain-both')), faultEvent = events.create(fault('fault-a'));
  assert.equal(valid(simulation,a).status,'operational_hold');
  assert.deepEqual(new Set(valid(simulation,a).operationalEventIds),new Set([rainEvent.id,faultEvent.id]));
  assert.deepEqual(valid(simulation,b,'T-0051').operationalEventIds,[rainEvent.id]);
  assert.equal(valid(simulation,xb).valid,true);
  assert.equal(simulation.strategyValidity(reference(a)).valid,true);
  events.transition(rainEvent.id,'resolve',{siteId:'hainan',note:'雨停，等待复核'});
  assert.equal(valid(simulation,b,'T-0051').valid,false);
  assert.match(valid(simulation,b,'T-0051').reason,/等待人工确认恢复条件/);
  events.transition(rainEvent.id,'resume',{siteId:'hainan',note:'雨后作业及储运防雨条件已检查'});
  assert.equal(valid(simulation,b,'T-0051').valid,true);
  assert.deepEqual(valid(simulation,a).operationalEventIds,[faultEvent.id]);
  events.transition(faultEvent.id,'resolve',{siteId:'hainan',note:'修理完成'});
  const newStrategy = await strategy();
  assert.equal(valid(simulation,newStrategy).status,'operational_hold');
  events.transition(faultEvent.id,'resume',{siteId:'hainan',note:'空载测试通过，允许任务重新核验'});
  assert.equal(valid(simulation,newStrategy).valid,true);
  events.create(rain('rain-b-only','hainan',1));
  assert.equal(valid(simulation,newStrategy).valid,true);
  assert.equal(valid(simulation,b,'T-0051').status,'operational_hold');
});

test('event boundary rejects wrong scope, missing explanation and out-of-range device zones', t => {
  const {events} = fixture(t), hn = events.create(rain('hainan-rain'));
  const xb = events.create(fault('xsbn-fault',2,'xsbn'));
  assert.deepEqual(events.list('xian'),[]);
  assert.deepEqual(events.list('xsbn'),[xb]); assert.equal(events.list().length,2);
  assert.throws(() => events.transition(hn.id,'resolve',{siteId:'xsbn',note:'wrong park'}), error => error.code === 'NOT_FOUND');
  assert.equal(events.list('hainan')[0].status,'active');
  for (const input of [null,{...rain('bad'),siteId:undefined},{...rain('bad'),siteId:'unknown'},
    {...rain('bad'),note:' '},{...fault('bad'),zone:null},{...fault('bad'),zone:4},{...rain('bad'),zone:-1}]) {
    assert.throws(() => events.create(input), error => error.status === 400);
  }
  assert.equal(events.list().length,2);
});

test('weather candidate generation and adoption remain independent of explicitly registered event facts', async t => {
  const {simulation, events, strategy} = fixture(t);
  const weather = await strategy('demo-hainan','T-0001','weather_window');
  const adopted = simulation.record({requestId:'adopt-original',siteId:'hainan',kind:'adopt_weather',treeId:'T-0001',
    strategyId:weather.strategyId,start:weather.proposal.windows.find(window => window.suitability === 'suitable').start});
  await strategy('demo-hainan','T-0001','weather_window');
  assert.deepEqual(events.list(),[]);
  const current = simulation.effectiveConstraints('hainan');
  assert.equal(current.constraints[0].requestId,adopted.requestId);
  assert.equal(current.constraints[0].validity.valid,true);
  const rainEvent = events.create(rain('explicit-weather'));
  assert.deepEqual(simulation.effectiveConstraints('hainan').operationalEvents,[rainEvent]);
  assert.equal(simulation.effectiveConstraints('hainan').constraints[0].validity.valid,true);
  assert.deepEqual(simulation.effectiveConstraints('xsbn').operationalEvents,[]);
});
