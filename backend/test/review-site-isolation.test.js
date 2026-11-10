import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { SimulationService } from '../src/simulation.js';
import { ReviewWorkflow } from '../src/review-workflow.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { makeParkContext } from '../src/adapters/park-demo.js';

function setup() {
  const clock = () => new Date('2026-10-17T02:00:00.000Z');
  const store = new Store();
  const simulation = new SimulationService(store, clock);
  const runtime = new HarnessRuntime({store, contextProvider: new LocalContextProvider(store), clock});
  const reviews = new ReviewWorkflow(store, clock, runtime);
  store.setModelPaused(true, clock().toISOString());
  return {clock, store, simulation, runtime, reviews,
    issue(siteId, treeId) { return reviews.issues('demo', siteId).find(row => row.treeId === treeId); },
    async prepareSurface(siteId) {
      const context = makeParkContext({treeIds: ['T-0001'], siteId, now: clock()});
      store.saveContext(context);
      const run = runtime.submit({requestId: `surface-${siteId}`, kind: 'surface_action', siteId,
        targetSnapshotId: context.targetSnapshot.targetSnapshotId,
        inputSnapshot: {snapshotId: context.snapshotId, version: context.version},
        executionMode: 'simulation', generatorMode: 'demo_rules'});
      store.bindTreeView({treeId: 'T-0001', siteId, kind: 'surface_action', dataMode: 'demo',
        preparationId: run.requestId, requestId: run.requestId, runId: run.runId,
        contextSnapshotId: context.snapshotId, asOf: context.asOf});
      await runtime.idle();
      assert.equal(store.getRun(run.runId).status, 'succeeded');
    },
    async close() { await runtime.stop(); store.close(); }
  };
}

const measure = siteId => ({treeIds: ['T-0042'], kind: 'measure', assignee: 'robot', siteId});

test('review issues and duplicate creation use the latest job from the selected park', async () => {
  const app = setup();
  try {
    const hainan = app.reviews.create(measure('demo-hainan'))[0];
    const xsbn = app.reviews.create(measure('demo-xsbn'))[0];
    assert.notEqual(hainan.id, xsbn.id);
    assert.equal(app.issue('demo-hainan', 'T-0042').job.id, hainan.id);
    assert.equal(app.issue('demo-xsbn', 'T-0042').job.id, xsbn.id);
    assert.equal(app.issue('demo-xian', 'T-0042').job, undefined);
    assert.equal(app.reviews.create(measure('hainan'))[0].id, hainan.id);
    assert.equal(app.reviews.create(measure('xsbn'))[0].id, xsbn.id);
    assert.deepEqual(app.reviews.jobs('hainan').map(job => job.id), [hainan.id]);
    assert.equal(app.reviews.jobs().length, 2);
  } finally { await app.close(); }
});

test('recent market work reserves a tree only in its own park', async () => {
  const app = setup();
  try {
    await app.prepareSurface('demo-hainan');
    await app.prepareSurface('demo-xsbn');
    const task = {id: 'hainan-market-task', site: 'hainan', kind: '割胶', status: '待开始',
      date: '2026-10-17', count: 1, done: 0, treeIndices: [0], sourceScenarioId: 'hainan-market'};
    const saved = app.simulation.tasks({tasks: [task]});
    assert.equal(saved.accepted, 1);
    assert.equal(app.issue('demo-hainan', 'T-0001').code, 'planned');
    assert.equal(app.issue('demo-xsbn', 'T-0001').code, 'ready');
    assert.deepEqual(app.issue('demo-xsbn', 'T-0001').plannedTasks, []);
    const xsbn = {...task, id: 'xsbn-market-task', site: 'xsbn', siteId: 'demo-xsbn', sourceScenarioId: 'xsbn-market'};
    assert.equal(app.simulation.tasks({tasks: [xsbn]}).accepted, 1);
    assert.deepEqual(app.issue('demo-hainan', 'T-0001').plannedTasks.map(row => row.id), [task.id]);
    assert.deepEqual(app.issue('demo-xsbn', 'T-0001').plannedTasks.map(row => row.id), [xsbn.id]);
    const beforeAlias = app.simulation.latestTasks().find(row => row.id === task.id);
    assert.equal(app.simulation.tasks({tasks: [{...beforeAlias,siteId:'hn'}]}).accepted, 1);
    assert.deepEqual(app.issue('hainan', 'T-0001').plannedTasks.map(row => row.id), [task.id]);
    const current = app.simulation.latestTasks().find(row => row.id === task.id);
    assert.equal(app.simulation.tasks({tasks: [{...current, status: '已取消'}]}).accepted, 1);
    assert.equal(app.issue('demo-hainan', 'T-0001').code, 'ready');
    assert.equal(app.issue('demo-xsbn', 'T-0001').code, 'planned');
  } finally { await app.close(); }
});

test('completed measurements and capture evidence never project onto another park', async () => {
  const app = setup();
  try {
    const measured = app.reviews.create(measure('demo-hainan'))[0];
    const captured = app.reviews.create({treeIds: ['T-0006'], kind: 'capture', assignee: 'robot', siteId: 'demo-hainan'})[0];
    for (const job of [measured, captured]) {
      app.reviews.collect(job.id);
      await app.reviews.complete(job.id, {note: '模拟核查结果已确认', conclusion: 'clear'});
      await app.runtime.idle();
    }
    const hainan = app.reviews.apply(makeParkContext({siteId: 'demo-hainan', now: app.clock()}));
    assert.equal(hainan.modules.trees.find(tree => tree.treeId === 'T-0042').circumferenceCm, 66);
    assert.equal(hainan.modules.inspection.evidence.find(row => row.treeId === 'T-0006').evidenceId, captured.id);
    for (const siteId of ['demo-xsbn', 'demo-xian']) {
      const original = makeParkContext({siteId, now: app.clock()});
      const projected = app.reviews.apply(original);
      assert.deepEqual(projected.modules, original.modules);
      assert.equal(projected.modules.trees.find(tree => tree.treeId === 'T-0042').circumferenceCm, null);
      assert.equal(app.issue(siteId, 'T-0042').code, 'measure');
    }
  } finally { await app.close(); }
});

test('historical reviews without a site belong only to Hainan and remain reusable', async () => {
  const app = setup();
  try {
    const legacy = {id: 'review-legacy', treeId: 'T-0042', kind: 'measure', assignee: 'robot',
      status: 'queued', reason: '历史补测', createdAt: app.clock().toISOString(), mode: 'simulation'};
    app.reviews.save(legacy, 'created');
    assert.deepEqual(app.reviews.jobs('demo-hainan').map(job => job.id), [legacy.id]);
    assert.deepEqual(app.reviews.jobs('demo-xsbn'), []);
    assert.equal(app.issue('demo-hainan', 'T-0042').job.id, legacy.id);
    assert.equal(app.issue('demo-xsbn', 'T-0042').job, undefined);
    assert.equal(app.reviews.create(measure('demo-hainan'))[0].id, legacy.id);
    const xsbn = app.reviews.create(measure('demo-xsbn'))[0];
    assert.notEqual(xsbn.id, legacy.id);
    app.reviews.collect(legacy.id);
    await app.reviews.complete(legacy.id, {note: '历史补测结果已确认'});
    await app.runtime.idle();
    assert.equal(app.issue('demo-hainan', 'T-0042').circumferenceCm, 66);
    assert.equal(app.issue('demo-xsbn', 'T-0042').circumferenceCm, null);
    assert.equal(app.issue('demo-xsbn', 'T-0042').job.id, xsbn.id);
  } finally { await app.close(); }
});
