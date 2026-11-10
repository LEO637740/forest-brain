import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {SimulationService} from '../src/simulation.js';
import {prepareParkPlanSurface} from '../src/park-plan-preparation.js';
import {digest} from '../src/util.js';

function fixture(t, treeIds) {
  let time = Date.parse('2026-10-26T02:00:00Z'), sequence = 0, modelCalls = 0;
  const clock = () => new Date(time), store = new Store();
  const runtime = new HarnessRuntime({store, contextProvider:new LocalContextProvider(store), concurrency:0, clock,
    generator:{mode:'llm', async generate() { modelCalls++; throw Error('No configured model call is allowed'); }}});
  const simulation = new SimulationService(store, clock);
  const contextFactory = options => makeParkContext({...options, treeIds:options.treeIds ?? treeIds});
  t.after(async () => {await runtime.stop(); store.close();});
  async function seed(ids, {kind = 'surface_action', dataMode = 'mixed_demo', siteId = 'demo-hainan', mutate} = {}) {
    const context = makeParkContext({treeIds:ids, now:clock(), siteId});
    context.dataPolicy = {mode:dataMode, notices:['Historical test snapshot'], substitutions:[]};
    mutate?.(context);
    context.snapshotId = `input-${digest(context).slice(0,24)}`;
    store.saveContext(context);
    const requestId = `seed-${++sequence}`;
    const accepted = runtime.submit({requestId, kind, siteId, targetSnapshotId:context.targetSnapshot.targetSnapshotId,
      inputSnapshot:{snapshotId:context.snapshotId, version:context.version}, executionMode:'simulation', generatorMode:'demo_rules', trigger:{type:'user', eventId:requestId}});
    await runtime.execute(accepted.runId);
    for (const treeId of ids) store.bindTreeView({treeId, siteId, kind, dataMode, preparationId:requestId, requestId,
      runId:accepted.runId, contextSnapshotId:context.snapshotId, asOf:context.asOf});
    return store.getRun(accepted.runId);
  }
  const prepare = options => prepareParkPlanSurface({siteId:'demo-hainan', dataMode:'mixed_demo', store, runtime, makeParkContext:contextFactory, clock, ...options});
  return {store, runtime, simulation, clock, seed, prepare, advance:ms => {time += ms;}, modelCalls:() => modelCalls};
}
function oldCapture(context) {
  for (const evidence of context.modules.inspection.evidence) {
    evidence.geometryRegistered = false;
    evidence.detections = [{detectionId:`old-${evidence.treeId}`, classCode:'attachment', intersectsPlannedLine:null,
      reviewStatus:'unreviewed', score:null, box:[0.2,0.2,0.2,0.2], coordinateConvention:'normalized_top_left_xywh'}];
  }
}
const current = (f, treeId, kind = 'surface_action', dataMode = 'mixed_demo', siteId = 'demo-hainan') => {
  const binding = f.store.getTreeViewBinding(treeId, kind, dataMode, siteId);
  return binding && f.store.getRun(binding.runId);
};

test('explicit preparation replaces old dense findings and expired normal surface views without altering their history', async t => {
  const f = fixture(t, ['T-0016','T-0056','T-0002']);
  const dense = await f.seed(['T-0016','T-0056'], {mutate:oldCapture});
  const expired = await f.seed(['T-0002']);
  f.advance(2 * 3600000);
  const result = await f.prepare();
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.preparedTreeIds, ['T-0016','T-0056','T-0002']);
  for (const treeId of result.preparedTreeIds) {
    const run = current(f, treeId);
    assert.equal(run.status, 'succeeded'); assert.equal(run.request.generatorMode, 'demo_rules');
    assert.deepEqual(run.result.strategy.proposal.findings, []);
    assert.ok(Date.parse(run.result.strategy.expiresAt) > +f.clock());
    assert.equal(f.store.getRunContext(run.runId).dataPolicy.mode, 'mixed_demo');
  }
  assert.equal(f.store.getRun(dense.runId).result.strategy.proposal.findings.length, 2);
  assert.equal(f.store.getRun(expired.runId).result.strategy.expiresAt, expired.result.strategy.expiresAt);
  assert.equal(f.modelCalls(), 0);
});

test('a clear old surface result still refreshes frozen resting, missing or unregistered tree input', async t => {
  const f = fixture(t, ['T-0057','T-0058','T-0066']);
  const old = [];
  old.push(await f.seed(['T-0057'], {mutate:context => {context.modules.trees[0].tappingStatus = 'resting';}}));
  old.push(await f.seed(['T-0058'], {mutate:context => {context.modules.trees[0].circumferenceCm = null;}}));
  old.push(await f.seed(['T-0066'], {mutate:context => {context.modules.inspection.evidence[0].geometryRegistered = false;}}));
  for (const run of old) assert.deepEqual(run.result.strategy.proposal.findings, []);
  const result = await f.prepare();
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.preparedTreeIds, ['T-0057','T-0058','T-0066']);
  for (const treeId of result.preparedTreeIds) {
    const input = f.store.getRunContext(current(f, treeId).runId);
    assert.equal(input.modules.trees[0].tappingStatus, 'available');
    assert.ok(Number.isFinite(input.modules.trees[0].circumferenceCm));
    assert.equal(input.modules.inspection.evidence[0].geometryRegistered, true);
  }
});

test('current real exceptions, explicit skip, withdrawal and usable surface views remain untouched', async t => {
  const f = fixture(t, ['T-0006','T-0016','T-0026','T-0002']);
  const skipped = await f.seed(['T-0016'], {mutate:oldCapture});
  f.simulation.record({requestId:'keep-skip', kind:'surface_review', treeId:'T-0016', siteId:'demo-hainan',
    strategyId:skipped.result.strategy.strategyId, disposition:'skip', dataMode:'mixed_demo'});
  const withdrawn = await f.seed(['T-0026']);
  f.store.withdrawStrategy(withdrawn.runId, 'Manual withdrawal must remain authoritative', f.clock().toISOString());
  const usable = await f.seed(['T-0002']);
  const runs = f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  const result = await f.prepare();
  assert.deepEqual(result.preparedTreeIds, []);
  assert.ok(result.skipped.some(item => item.treeId === 'T-0006' && item.reason === 'current_evidence_not_ready'));
  assert.ok(result.skipped.some(item => item.treeId === 'T-0016' && item.reason === 'review_skip'));
  assert.ok(result.skipped.some(item => item.treeId === 'T-0026' && item.reason === 'withdrawn'));
  assert.ok(result.preserved.some(item => item.treeId === 'T-0002'));
  assert.equal(current(f, 'T-0016').runId, skipped.runId);
  assert.equal(current(f, 'T-0026').runId, withdrawn.runId);
  assert.equal(current(f, 'T-0002').runId, usable.runId);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, runs);
});

test('legacy resting or missing-size angle profiles refresh only for trees with no adopted angle', async t => {
  const f = fixture(t, ['T-0001','T-0057','T-0058','T-0059','T-0002']);
  const adopted = await f.seed(['T-0001'], {kind:'tapping_angle'});
  f.simulation.record({requestId:'adopt-once', kind:'adopt_angle', treeId:'T-0001', siteId:'demo-hainan',
    strategyId:adopted.result.strategy.strategyId, dataMode:'mixed_demo'});
  const resting = await f.seed(['T-0057'], {kind:'tapping_angle', mutate:context => {context.modules.trees[0].tappingStatus = 'resting';}});
  const missing = await f.seed(['T-0058'], {kind:'tapping_angle', mutate:context => {context.modules.trees[0].circumferenceCm = null;}});
  const unchanged = await f.seed(['T-0059'], {kind:'tapping_angle'});
  f.simulation.tasks({tasks:[{id:'completed-history', site:'hainan', date:'2026-10-25', title:'Saved completed work', block:'A', robot:'R-A',
    start:'06:00', end:'07:00', kind:'割胶', count:1, done:1, status:'已完成', treeIndices:[0]}]});
  const history = f.simulation.latestTasks('demo-hainan');
  const adoptedAction = f.simulation.list('T-0001','demo-hainan');
  f.advance(2 * 3600000); // Expired adoptions are protected too; the preflight must list them.
  const result = await f.prepare();
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.preparedAngleTreeIds, ['T-0057','T-0058']);
  assert.notEqual(current(f, 'T-0057', 'tapping_angle').runId, resting.runId);
  assert.notEqual(current(f, 'T-0058', 'tapping_angle').runId, missing.runId);
  for (const treeId of result.preparedAngleTreeIds) {
    const input = f.store.getRunContext(current(f, treeId, 'tapping_angle').runId);
    assert.equal(input.modules.trees[0].tappingStatus, 'available');
    assert.ok(Number.isFinite(input.modules.trees[0].circumferenceCm));
  }
  assert.equal(current(f, 'T-0001', 'tapping_angle').runId, adopted.runId);
  assert.equal(current(f, 'T-0059', 'tapping_angle').runId, unchanged.runId);
  assert.equal(current(f, 'T-0002', 'tapping_angle'), null);
  assert.deepEqual(f.simulation.list('T-0001','demo-hainan'), adoptedAction);
  assert.deepEqual(f.simulation.latestTasks('demo-hainan'), history);
});

test('park, mode and current-evidence scopes cannot be crossed by the preparation', async t => {
  const f = fixture(t, ['T-0016']);
  const foreign = await f.seed(['T-0016'], {siteId:'demo-xsbn', mutate:oldCapture});
  const mixed = await f.seed(['T-0016'], {mutate:oldCapture});
  const result = await f.prepare({dataMode:'demo'});
  assert.deepEqual(result.preparedTreeIds, ['T-0016']);
  assert.equal(current(f, 'T-0016', 'surface_action', 'mixed_demo').runId, mixed.runId);
  assert.equal(current(f, 'T-0016', 'surface_action', 'mixed_demo', 'demo-xsbn').runId, foreign.runId);
  const runs = f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  const otherPark = await f.prepare({siteId:'demo-xsbn'});
  assert.equal(otherPark.reason, 'not_rail_site');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, runs);
});

test('a concurrent newer binding wins even when it appears during the fresh rule run', async t => {
  const f = fixture(t, ['T-0016']);
  await f.seed(['T-0016'], {mutate:oldCapture});
  let newer;
  const stop = f.runtime.onTerminal(run => {
    if (!run.request.requestId.startsWith('park-prepare-')) return;
    const context = f.store.getRunContext(run.runId), requestId = 'concurrent-surface';
    newer = f.runtime.submit({...run.request, requestId, trigger:{type:'user', eventId:requestId}});
    f.store.bindTreeView({treeId:'T-0016', siteId:'demo-hainan', kind:'surface_action', dataMode:'mixed_demo',
      preparationId:requestId, requestId, runId:newer.runId, contextSnapshotId:context.snapshotId, asOf:context.asOf});
  });
  t.after(stop);
  const result = await f.prepare();
  assert.deepEqual(result.preparedTreeIds, []);
  assert.ok(result.skipped.some(item => item.treeId === 'T-0016' && item.reason === 'binding_changed'));
  assert.equal(current(f, 'T-0016').runId, newer.runId);
});

test('explicit rule preparation can finish ahead of unrelated queued model work', async t => {
  const f = fixture(t, ['T-0002']);
  for (let index = 0; index < 8; index++) {
    const context = makeParkContext({treeIds:['T-0004'], now:f.clock()});
    f.store.saveContext(context);
    f.runtime.submit({requestId:`backlog-${index}`, kind:'surface_action', siteId:'demo-hainan', targetSnapshotId:context.targetSnapshot.targetSnapshotId,
      inputSnapshot:{snapshotId:context.snapshotId, version:context.version}, executionMode:'simulation', generatorMode:'configured', trigger:{type:'user', eventId:'backlog'}});
  }
  const result = await f.prepare();
  assert.deepEqual(result.preparedTreeIds, ['T-0002']);
  assert.equal(f.store.pending().length, 8);
  assert.equal(f.modelCalls(), 0);
});

test('preparation errors remain explicit diagnostics without replacing the previous binding', async t => {
  const f = fixture(t, ['T-0016']);
  const original = await f.seed(['T-0016'], {mutate:oldCapture});
  const execute = f.runtime.execute;
  f.runtime.execute = async () => {throw Error('Rule preparation persistence unavailable');};
  const result = await f.prepare();
  f.runtime.execute = execute;
  assert.deepEqual(result.preparedTreeIds, []);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /persistence unavailable/);
  assert.equal(current(f, 'T-0016').runId, original.runId);
});

test('a wrong-tree binding is replaced and full-park preparation stays in four bounded rule runs', async t => {
  const f = fixture(t, ['T-0016']);
  const wrong = await f.seed(['T-0002']);
  const input = f.store.getRunContext(wrong.runId);
  f.store.bindTreeView({treeId:'T-0016', siteId:'demo-hainan', kind:'surface_action', dataMode:'mixed_demo',
    preparationId:'wrong-tree', requestId:wrong.requestId, runId:wrong.runId, contextSnapshotId:input.snapshotId, asOf:input.asOf});
  const result = await f.prepare();
  assert.deepEqual(result.preparedTreeIds, ['T-0016']);
  assert.notEqual(current(f, 'T-0016').runId, wrong.runId);
  const full = fixture(t);
  const started = performance.now(), all = await full.prepare();
  assert.deepEqual(all.failures, []);
  assert.equal(all.preparedTreeIds.length, 191);
  assert.deepEqual(all.preparedAngleTreeIds, []);
  assert.equal(full.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 4);
  assert.ok(performance.now() - started < 10000, 'transparent normal preparation completes within the HTTP budget');
  assert.equal(full.modelCalls(), 0);
});
