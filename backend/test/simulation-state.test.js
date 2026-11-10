import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { SimulationService } from '../src/simulation.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider, makeDemoContext } from '../src/adapters/context.js';
import { makeMixedContext } from '../src/adapters/public-context.js';

function setup() {
  let timestamp = Date.parse('2026-10-07T02:00:00Z');
  const clock = () => new Date(timestamp), store = new Store();
  const simulation = new SimulationService(store, clock);
  const runtime = new HarnessRuntime({store, contextProvider:new LocalContextProvider(store), clock});
  let sequence = 0;
  return {store,simulation,clock,advance(ms) {timestamp += ms;},
    async strategy({treeIds=['T-0012'], kind='tapping_angle', mode='demo', requestId} = {}) {
      const context = mode === 'mixed_demo'
        ? makeMixedContext({treeIds,now:clock(),service:{status:() => ({location:{confirmed:false},sources:[]})}})
        : makeDemoContext({treeIds,now:clock()});
      store.saveContext(context);
      const accepted = runtime.submit({requestId:requestId ?? `simulation-test-${++sequence}`,kind,siteId:context.siteId,
        targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'});
      if (kind !== 'weather_window') for (const treeId of treeIds)
        store.bindTreeView({treeId,kind,dataMode:mode,preparationId:'test',requestId:accepted.requestId,runId:accepted.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
      await runtime.idle();
      const run = store.getRun(accepted.runId);
      assert.equal(run.status, 'succeeded', JSON.stringify(run.result));
      return run.result.strategy;
    },
    async close() {await runtime.stop();store.close();}
  };
}
const task = (id='task-one') => ({id,site:'hainan',kind:'割胶',status:'待开始',count:1,done:0,treeIndices:[0]});
const reference = (strategy, treeId='T-0012', dataMode) => ({treeId,strategyId:strategy.strategyId,runId:strategy.runId,revision:strategy.revision,...(dataMode?{dataMode}:{})});
const adoption = (strategy, id='adopt-one', dataMode) => ({requestId:id,kind:'adopt_angle',treeId:'T-0012',strategyId:strategy.strategyId,...(dataMode?{dataMode}:{})});
const weatherAdoption = (strategy, id) => ({requestId:id,kind:'adopt_weather',treeId:'T-0012',strategyId:strategy.strategyId,start:strategy.proposal.windows.find(window=>window.suitability==='suitable').start});

test('two clients cannot regress a completed task; retries return authoritative revisions', async () => {
  const app=setup(); try {
    const create=app.simulation.tasks({tasks:[task()]});
    assert.equal(create.tasks[0].revision,1);assert.deepEqual(create.conflicts,[]);
    const stale=structuredClone(create.tasks[0]);
    const completed={...stale,status:'已完成',done:1,railResult:{outcome:'completed'}};
    const saved=app.simulation.tasks({tasks:[completed]});
    assert.equal(saved.tasks[0].revision,2);
    const response=app.simulation.tasks({tasks:[stale]});
    assert.equal(response.accepted,0);assert.equal(response.conflicts[0].code,'TASK_REVISION_CONFLICT');
    assert.equal(response.conflicts[0].task.status,'已完成');
    assert.equal(response.tasks[0].done,1);assert.deepEqual(response.tasks[0].railResult,{outcome:'completed'});
    const retry=app.simulation.tasks({tasks:[completed]});
    assert.equal(retry.accepted,1);assert.deepEqual(retry.conflicts,[]);assert.equal(retry.tasks[0].revision,2);
    const reopen=app.simulation.tasks({tasks:[{...stale,revision:2}]});
    assert.equal(reopen.conflicts[0].code,'TASK_TERMINAL');
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM simulation_task_receipts').get().n,2);
  } finally {await app.close();}
});

test('task state rejects counter regression, incomplete completion, changed targets and lost receipts', async () => {
  const app=setup(); try {
    const base={...task(),count:2,treeIndices:[0,1],status:'执行中',done:1,railBatch:{jobs:{},results:{0:{outcome:'completed'}},baseDone:0}};
    const current=app.simulation.tasks({tasks:[base]}).tasks[0];
    for(const [patch,code] of [[{done:0},'PROGRESS_REGRESSION'],[{done:3},'INVALID_PROGRESS'],[{status:'已完成'},'INVALID_TRANSITION'],[{treeIndices:[0,2]},'TASK_TARGET_CHANGED'],[{railBatch:{...base.railBatch,results:{}}},'RECEIPT_CHANGED']]) {
      const response=app.simulation.tasks({tasks:[{...current,...patch}]});
      assert.equal(response.conflicts[0].code,code);
      assert.equal(response.tasks[0].revision,1);
    }
    const cancelled=app.simulation.tasks({tasks:[{...current,status:'已取消'}]}).tasks[0];
    assert.equal(cancelled.revision,2);
    assert.equal(app.simulation.tasks({tasks:[{...cancelled,status:'执行中'}]}).conflicts[0].code,'TASK_TERMINAL');
  } finally {await app.close();}
});

test('legacy receipt migration and >200 updates return one current state for every task', async () => {
  const app=setup(); try {
    app.store.db.prepare('INSERT INTO simulation_task_receipts VALUES(?,?,?,?)').run('legacy','legacy',JSON.stringify(task('legacy')),app.clock().toISOString());
    assert.equal(app.simulation.latestTasks()[0].revision,1);
    const legacy=app.simulation.tasks({tasks:[{...task('legacy'),status:'执行中'}]});
    assert.equal(legacy.conflicts[0].code,'TASK_REVISION_CONFLICT');
    app.simulation.tasks({tasks:Array.from({length:205},(_,index)=>task('many-'+index))});
    assert.equal(app.simulation.latestTasks().length,206);
    assert.equal(app.simulation.tasks().filter(receipt=>receipt.task.id==='legacy').length,1);
    const updated=app.simulation.tasks({tasks:[{...app.simulation.latestTasks().find(t=>t.id==='legacy'),status:'执行中'}]});
    assert.equal(updated.tasks.find(t=>t.id==='legacy').revision,2);
    assert.equal(app.simulation.tasks().length,206);
  } finally {await app.close();}
});

test('partial task conflict leaves independent valid writes accepted and rejects malformed batches', async () => {
  const app=setup(); try {
    app.simulation.tasks({tasks:[task()]});
    const result=app.simulation.tasks({tasks:[{...task(),status:'执行中'},task('second')]});
    assert.equal(result.accepted,1);assert.equal(result.conflicts.length,1);assert.equal(result.tasks.length,2);
    assert.throws(()=>app.simulation.tasks({tasks:[task(),task()]}),error=>error.code==='INVALID_TASKS');
    for(const malformed of [null,{...task('bad'),count:-1},{...task('bad'),treeIndices:{}},{...task('bad'),status:'unknown'}]) {
      const response=app.simulation.tasks({tasks:[malformed]});
      assert.equal(response.accepted,0);assert.equal(response.conflicts.length,1);
    }
  } finally {await app.close();}
});

test('mixed strategies adopt in their original mode and cannot impersonate a demo binding', async () => {
  const app=setup(); try {
    const demo=await app.strategy(),mixed=await app.strategy({mode:'mixed_demo'});
    const saved=app.simulation.record(adoption(mixed,'mixed'));
    assert.equal(saved.dataMode,'mixed_demo');assert.equal(saved.angle,mixed.proposal.recommendedCutSlopeDeg);
    assert.deepEqual(app.simulation.record(adoption(mixed,'mixed')),saved);
    assert.equal(app.simulation.record(adoption(demo,'demo','demo')).dataMode,'demo');
    assert.throws(()=>app.simulation.record(adoption(mixed,'pretend-demo','demo')),error=>error.code==='STRATEGY_CHANGED'&&error.details.status==='mode_mismatch');
    const checked=app.simulation.validateStrategies({strategies:[reference(mixed,'T-0012','mixed_demo'),reference(mixed,'T-0012','demo')]});
    assert.equal(checked.items[0].valid,true);assert.equal(checked.items[1].status,'mode_mismatch');
    await app.strategy({mode:'mixed_demo'});
    assert.equal(app.simulation.validateStrategies({strategies:[reference(mixed)]}).items[0].status,'superseded');
    assert.throws(()=>app.simulation.record(adoption(mixed,'old-mixed')),error=>error.code==='STRATEGY_CHANGED');
  } finally {await app.close();}
});

test('execution references detect withdrawal, expiry, changed revision, wrong tree and missing strategy', async () => {
  const app=setup(); try {
    const strategy=await app.strategy();
    assert.equal(app.simulation.validateStrategies({strategies:[reference(strategy)]}).items[0].valid,true);
    assert.equal(app.simulation.validateStrategies({strategies:[{...reference(strategy),revision:strategy.revision+1}]}).items[0].status,'superseded');
    assert.equal(app.simulation.validateStrategies({strategies:[reference(strategy,'T-0001')]}).items[0].status,'tree_mismatch');
    assert.equal(app.simulation.validateStrategies({strategies:[{...reference(strategy),strategyId:'missing'}]}).items[0].status,'missing');
    app.store.withdrawStrategy(strategy.runId,'Test withdrawal',app.clock().toISOString());
    assert.equal(app.simulation.validateStrategies({strategies:[reference(strategy)]}).items[0].status,'withdrawn');
    const next=await app.strategy();app.advance(2*3600000);
    assert.equal(app.simulation.validateStrategies({strategies:[reference(next)]}).items[0].status,'expired');
    assert.throws(()=>app.simulation.validateStrategies({strategies:[{treeId:'T-0012'}]}),error=>error.code==='INVALID_STRATEGY_REFERENCE');
  } finally {await app.close();}
});

test('effective weather survives audit truncation and retains invalid latest constraints', async () => {
  const app=setup(); try {
    const weather=await app.strategy({kind:'weather_window',treeIds:['T-0012','T-0001']});
    app.simulation.record(weatherAdoption(weather,'weather'));
    const angle=await app.strategy();
    for(let index=0;index<201;index++)app.simulation.record(adoption(angle,'angle-'+index));
    assert.equal(app.simulation.list(null).filter(item=>item.kind==='adopt_weather').length,0);
    const constraints=app.simulation.effectiveConstraints();
    assert.equal(constraints.constraints.length,1);assert.equal(constraints.constraints[0].validity.valid,true);
    assert.deepEqual(constraints.constraints[0].treeIds,['T-0012','T-0001']);
    app.store.withdrawStrategy(weather.runId,'Weather withdrawn',app.clock().toISOString());
    const withdrawn=app.simulation.effectiveConstraints().constraints[0];
    assert.equal(withdrawn.validity.status,'withdrawn');assert.equal(withdrawn.treeIds.length,2);
    const replacement=await app.strategy({kind:'weather_window',treeIds:['T-0012']});
    app.simulation.record(weatherAdoption(replacement,'weather-replacement'));
    const latest=app.simulation.effectiveConstraints().constraints;
    assert.equal(latest.length,2);assert.deepEqual(latest[0].treeIds,['T-0012']);assert.deepEqual(latest[1].treeIds,['T-0001']);
    app.advance(2*3600000);
    assert.equal(app.simulation.effectiveConstraints().constraints[0].validity.status,'expired');
    assert.equal(app.simulation.effectiveConstraints().constraints[0].requestId,'weather-replacement');
  } finally {await app.close();}
});

test('different weather scenarios do not silently replace an explicitly adopted window', async () => {
  const app=setup(); try {
    const old=await app.strategy({kind:'weather_window'});
    app.simulation.record(weatherAdoption(old,'old-weather'));
    await app.strategy({kind:'weather_window'});
    const constraint=app.simulation.effectiveConstraints().constraints[0];
    assert.equal(constraint.requestId,'old-weather');assert.equal(constraint.validity.status,'available');
    assert.equal(app.simulation.record(weatherAdoption(old,'same-weather')).strategyId,old.strategyId);
  } finally {await app.close();}
});
