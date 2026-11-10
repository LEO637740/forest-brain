import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachFleet, cancelTree, createZoneScheduler, detachFleet, getFleetSnapshot,
  pauseZone, retryFleetValidation, setFleetValidator, subscribeFleet,
} from '../src/zoneFleet.ts';

const epoch = Date.parse('2026-10-18T02:00:00.000Z');
const at = offset => new Date(epoch + offset).toISOString();
const routes = Array.from({ length: 4 }, (_, zone) => ({ zone,
  points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], distances: [0, 100],
  stations: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [zone * 50 + index, index])),
}));
const source = (patch = {}) => ({ treeId: 'T-0001', strategyId: 'strategy-one', runId: 'run-one',
  revision: 1, angle: 28, expiresAt: at(60000), adoptedAt: at(-2000),
  mode: 'simulation', dataMode: 'demo', siteId: 'demo-hainan', ...patch });
const job = (patch = {}) => ({ id: 'rail-one', attemptId: 'attempt-one', requestedAt: at(-1000),
  planVersion: 'adopted-v1', angle: 28, harnessSource: source(), ...patch });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withFleet(run, validate = async () => {}) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map(), receipts = [], validations = [], publications = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
  } });
  const scheduler = createZoneScheduler(routes,
    (index, value) => receipts.push({ index, job: value, outcome: 'completed' }),
    (index, value) => receipts.push({ index, job: value, outcome: 'cancelled' }), () => epoch);
  let unsubscribe = () => {};
  try {
    setFleetValidator(async (index, value) => {
      validations.push({ index, job: structuredClone(value) });
      return validate(index, value);
    });
    attachFleet(scheduler);
    unsubscribe = subscribeFleet(() => publications.push(getFleetSnapshot()));
    const state = () => structuredClone({ zones: scheduler.zones, jobs: scheduler.jobs, receipts, validations });
    const context = { scheduler, receipts, validations, publications,
      async rejected(action) {
        const before = state(), snapshot = getFleetSnapshot(), count = publications.length;
        assert.equal(action(), false);
        await settle();
        assert.deepEqual(state(), before, 'rejection must preserve scheduler, receipts and validator calls');
        assert.equal(getFleetSnapshot(), snapshot, 'rejection must preserve the published snapshot');
        assert.equal(publications.length, count, 'rejection must not publish');
      },
      async rejectedControls(index, selected, paused = false) {
        await context.rejected(() => cancelTree(index, selected));
        await context.rejected(() => retryFleetValidation(index, selected));
        await context.rejected(() => pauseZone(Math.floor(index / 50), !paused, { index, job: selected, paused }));
      },
    };
    await run(context);
  } finally {
    unsubscribe();
    detachFleet();
    setFleetValidator(undefined);
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
}

const replacements = [
  ['job ID', { id: 'rail-replacement' }],
  ['attempt ID', { attemptId: 'attempt-replacement' }],
  ['missing attempt ID', { attemptId: undefined }],
  ['request timestamp', { requestedAt: at(-999) }],
  ['plan version', { planVersion: 'adopted-v2' }],
  ['cut angle', { angle: 29 }],
  ['missing adoption source', { harnessSource: undefined }],
  ...[
    ['tree', { treeId: 'T-0002' }], ['strategy', { strategyId: 'strategy-two' }],
    ['run', { runId: 'run-two' }], ['revision', { revision: 2 }], ['angle', { angle: 29 }],
    ['adoption time', { adoptedAt: at(-1999) }], ['expiry', { expiresAt: at(60001) }],
    ['mode', { mode: 'production' }], ['data mode', { dataMode: 'mixed_demo' }],
    ['site', { siteId: 'demo-xsbn' }],
  ].map(([name, patch]) => [`source ${name}`, { harnessSource: source(patch) }]),
];

for (const [name, patch] of replacements) test(`stale controls reject a replacement with changed ${name}, even before publication`, async () => {
  await withFleet(async context => {
    const { scheduler } = context, selected = job();
    scheduler.enqueue(0, selected);
    // Publish the original job, then replace it without refreshing the public UI snapshot.
    assert.equal(pauseZone(0, true), true);
    assert.equal(pauseZone(0, false), true);
    const previous = structuredClone(getFleetSnapshot().jobs[0]);
    assert.equal(scheduler.retire(0), true);
    assert.equal(scheduler.enqueue(0, job(patch)), true);
    assert.deepEqual(getFleetSnapshot().jobs[0], previous);
    await context.rejectedControls(0, selected);
  });
});

test('controls reject missing and invalid tree indices without affecting another live tree', async () => {
  await withFleet(async context => {
    context.scheduler.enqueue(0, job());
    for (const index of [1, -1, 0.5, 200, NaN]) await context.rejectedControls(index, job());
  });
});

test('a guard for one tree cannot operate on a different queued job', async () => {
  await withFleet(async context => {
    const selected = job();
    context.scheduler.enqueue(0, selected);
    context.scheduler.enqueue(1, job({ id: 'rail-two', attemptId: 'attempt-two', harnessSource: source({ treeId: 'T-0002' }) }));
    await context.rejectedControls(1, selected);
  });
});

test('a job record outside both the active slot and queue cannot authorize controls', async () => {
  await withFleet(async context => {
    context.scheduler.jobs[0] = job();
    await context.rejectedControls(0, job());
  });
});

test('pause guards reject another zone and stale paused state', async () => {
  await withFleet(async context => {
    const selected = job();
    context.scheduler.enqueue(0, selected);
    await context.rejected(() => pauseZone(1, true, { index: 0, job: selected, paused: false }));
    context.scheduler.pause(0, true);
    await context.rejected(() => pauseZone(0, true, { index: 0, job: selected, paused: false }));
    assert.equal(context.scheduler.zones[0].paused, true);
    context.scheduler.pause(0, false);
    await context.rejected(() => pauseZone(0, false, { index: 0, job: selected, paused: true }));
  });
});

test('detached fleet rejects every guarded control without publishing or invoking validation', async () => {
  await withFleet(async context => {
    context.scheduler.enqueue(0, job());
    detachFleet();
    await context.rejectedControls(0, job());
    assert.equal(getFleetSnapshot().ready, false);
  });
});

test('a current active job can pause and resume its zone with explicit observed states', async () => {
  await withFleet(async ({ scheduler, publications, validations, receipts }) => {
    const selected = job();
    scheduler.enqueue(0, selected);
    assert.equal(pauseZone(0, true, { index: 0, job: selected, paused: false }), true);
    assert.equal(scheduler.zones[0].paused, true);
    assert.equal(getFleetSnapshot().zones[0].paused, true);
    assert.equal(pauseZone(0, false, { index: 0, job: selected, paused: true }), true);
    assert.equal(scheduler.zones[0].paused, false);
    assert.equal(getFleetSnapshot().zones[0].paused, false);
    assert.equal(publications.length, 2);
    assert.deepEqual(validations, []);
    assert.deepEqual(receipts, []);
  });
});

test('a current queued job can authorize pause and resume without moving ahead of the active tree', async () => {
  await withFleet(async ({ scheduler }) => {
    const selected = job({ id: 'rail-two', attemptId: 'attempt-two', harnessSource: source({ treeId: 'T-0002' }) });
    scheduler.enqueue(0, job());scheduler.enqueue(1, selected);
    assert.equal(pauseZone(0, true, { index: 1, job: selected, paused: false }), true);
    assert.equal(pauseZone(0, false, { index: 1, job: selected, paused: true }), true);
    assert.equal(scheduler.zones[0].active, 0);
    assert.deepEqual(scheduler.zones[0].queue, [1]);
  });
});

test('guarded queued cancellation emits exactly its own receipt and preserves the active tree', async () => {
  await withFleet(async context => {
    const { scheduler, receipts } = context;
    const selected = job({ id: 'rail-two', attemptId: 'attempt-two', harnessSource: source({ treeId: 'T-0002' }) });
    scheduler.enqueue(0, job());scheduler.enqueue(1, selected);
    assert.equal(cancelTree(1, selected), true);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].index, 1);
    assert.equal(receipts[0].job.attemptId, 'attempt-two');
    assert.equal(receipts[0].outcome, 'cancelled');
    assert.equal(scheduler.zones[0].active, 0);
    assert.deepEqual(scheduler.zones[0].queue, []);
    await context.rejected(() => cancelTree(1, selected));
  });
});

test('guarded active cancellation retracts once and rejects controls during retraction', async () => {
  await withFleet(async context => {
    const { scheduler, receipts } = context, selected = job();
    scheduler.enqueue(0, selected);
    assert.equal(cancelTree(0, selected), true);
    assert.equal(scheduler.zones[0].phase, 'retracting');
    assert.equal(receipts.length, 0);
    await context.rejectedControls(0, selected);
    scheduler.update(1);scheduler.update(20);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].job.attemptId, selected.attemptId);
    assert.equal(receipts[0].outcome, 'cancelled');
  });
});

test('guarded weather revalidation targets the current queued job and preserves pause', async () => {
  await withFleet(async ({ scheduler, validations, receipts }) => {
    const selected = job({ weatherBlock: '等待天气恢复' });
    scheduler.pause(0, true);scheduler.enqueue(0, selected);
    assert.equal(retryFleetValidation(0, selected), true);
    await settle();
    assert.equal(validations.length, 1);
    assert.equal(validations[0].index, 0);
    assert.equal(validations[0].job.attemptId, selected.attemptId);
    assert.equal(scheduler.jobs[0].validation, 'required');
    assert.equal(scheduler.jobs[0].weatherBlock, '');
    assert.equal(scheduler.zones[0].paused, true);
    assert.deepEqual(receipts, []);
  }, async () => ({ weatherBlock: '', notAfter: epoch + 30000 }));
});

test('matching guards preserve the scheduler rejection of a pending validation', async () => {
  let resolve;
  const gate = new Promise(done => { resolve = done; });
  await withFleet(async context => {
    const selected = job();
    context.scheduler.enqueue(0, selected);
    assert.equal(retryFleetValidation(0, selected), true);
    await settle();
    assert.equal(context.validations.length, 1);
    await context.rejected(() => retryFleetValidation(0, selected));
    resolve();await settle();
  }, () => gate);
});

test('matching guards do not revalidate a valid cut already in progress', async () => {
  await withFleet(async context => {
    const selected = job();
    context.scheduler.enqueue(0, selected);context.scheduler.update(1);
    await settle();context.scheduler.update(1);
    assert.equal(context.scheduler.zones[0].phase, 'working');
    await context.rejected(() => retryFleetValidation(0, selected));
  });
});

test('weather and validation changes leave the dispatch identity valid for controls', async () => {
  await withFleet(async context => {
    const { scheduler } = context, selected = job();
    scheduler.enqueue(0, selected);
    Object.assign(scheduler.jobs[0], { weatherBlock: '新天气限制', blockedReason: '等待复核',
      strategyBlock: '服务连接恢复中', validation: 'invalid', notBefore: epoch + 10000, notAfter: epoch + 30000 });
    assert.equal(pauseZone(0, true, { index: 0, job: selected, paused: false }), true);
    assert.equal(retryFleetValidation(0, selected), true);await settle();
    assert.equal(cancelTree(0, selected), true);
    assert.equal(scheduler.zones[0].phase, 'retracting');
    scheduler.update(1);
    assert.equal(context.receipts.length, 1);
  });
});

test('valid legacy dispatches without attempt IDs support guarded controls', async () => {
  await withFleet(async context => {
    const selected = job({ attemptId: undefined, harnessSource: undefined });
    context.scheduler.enqueue(0, selected);
    assert.equal(pauseZone(0, true, { index: 0, job: selected, paused: false }), true);
    assert.equal(retryFleetValidation(0, selected), true);await settle();
    assert.equal(pauseZone(0, false, { index: 0, job: selected, paused: true }), true);
    assert.equal(cancelTree(0, selected), true);
    context.scheduler.update(1);
    assert.equal(context.receipts.length, 1);
  });
});

test('historical adoption sources without a site retain their Hainan identity', async () => {
  await withFleet(async ({ scheduler }) => {
    const selected = job({ harnessSource: source({ siteId: undefined }) });
    scheduler.enqueue(0, job());
    assert.equal(pauseZone(0, true, { index: 0, job: selected, paused: false }), true);
    assert.equal(cancelTree(0, selected), true);
  });
});

test('the unguarded internal control API remains compatible', async () => {
  await withFleet(async context => {
    const { scheduler } = context;
    scheduler.enqueue(0, job());
    assert.equal(pauseZone(0, true), true);
    assert.equal(retryFleetValidation(0), true);await settle();
    assert.equal(pauseZone(0, false), true);
    assert.equal(cancelTree(0), true);
    scheduler.update(1);
    assert.equal(context.receipts.length, 1);
  });
});
