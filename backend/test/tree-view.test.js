import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.js';

async function app(options = {}) {
  const application = createApp({ dbPath: ':memory:', ...options });
  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${application.server.address().port}`;
  return {
    ...application,
    url,
    get(path, headers = {}) { return fetch(`${url}${path}`, { headers }); },
    post(path, value, headers = {}) {
      return fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(value),
      });
    },
  };
}

function countRows(a, table) {
  return Number(a.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
}

function realWeatherService(now) {
  const status = {
    location: { confirmed: true, siteId: 'demo-hainan' },
    sources: [{
      id: 'weather', title: '天气', snapshotId: 'real-weather-tree-view',
      retrievedAt: now.toISOString(),
      validUntil: new Date(+now + 2 * 3600000).toISOString(),
      sourceUrl: 'https://weather.example/tree-view-test', stale: false,
      data: {
        location: { name: '海南模拟园区', confirmed: true }, period: '2026-10-03',
        forecast: [{ validFrom: new Date(+now + 3600000).toISOString(), validTo: new Date(+now + 7200000).toISOString(), rainfallMm: 0.3, rainProbabilityPct: 20 }],
      },
    }],
  };
  return { status: () => structuredClone(status) };
}

async function prepare(a, preparationId, treeIds = ['T-0012'], extra = {}) {
  const response = await a.post('/api/demo/trees/prepare', {
    preparationId, treeIds, generatorMode: 'demo_rules', ...extra,
  });
  const raw = await response.text();
  assert.equal(response.status, 202, raw);
  const body = JSON.parse(raw);
  assert.equal(body.preparationId, preparationId);
  assert.equal(body.items.length, treeIds.length);
  await a.runtime.idle();
  return body;
}

test('tree manifest is stable and a view read never creates a snapshot or run', async () => {
  const a = await app();
  try {
    const before = { contexts: countRows(a, 'contexts'), runs: countRows(a, 'runs') };
    const manifestResponse = await a.get('/api/demo/trees/manifest');
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.version, '1');
    assert.equal(manifest.kind, 'tapping_angle');
    assert.equal(manifest.dataMode, 'mixed_demo');
    assert.equal(manifest.items.length, 10);
    assert.equal(new Set(manifest.items.map(x => x.treeId)).size, 10);
    assert.ok(manifest.items.some(x => x.treeId === 'T-0012'));
    assert.ok(manifest.items.some(x => x.treeId === 'T-0031'));
    assert.ok(manifest.items.some(x => x.treeId === 'T-0042'));
    for (const item of manifest.items) {
      assert.equal(item.objectName, `Tree_${item.treeId}`);
      assert.equal(typeof item.label, 'string');
    }
    assert.equal((await a.get('/blender-preview')).status, 200);
    assert.equal((await a.get('/blender-preview.js')).status, 200);
    assert.equal((await a.get('/tree-view-client.js')).status, 200);

    const responses = await Promise.all(Array.from({ length: 5 }, () => a.get('/api/demo/trees/T-0012/view')));
    const views = await Promise.all(responses.map(async response => {
      assert.equal(response.status, 200);
      return response.json();
    }));
    for (const view of views) {
      assert.equal(view.tree.treeId, 'T-0012');
      assert.equal(view.strategy, null);
      assert.equal(view.strategyStatus, 'needs_generation');
      assert.equal(view.status, 'not_generated');
      assert.equal(view.run, null);
      assert.equal(view.asOf, null);
      assert.equal(typeof view.checkedAt, 'string');
      assert.ok(view.dataPolicy.mode === 'mixed_demo' || view.dataPolicy.mode === 'demo');
    }
    assert.deepEqual({ contexts: countRows(a, 'contexts'), runs: countRows(a, 'runs') }, before);
  } finally { await a.close(); }
});

test('prepare is idempotent, returns stable tree views, and reports missing data per tree', async () => {
  const a = await app();
  try {
    const first = await prepare(a, 'prep-tree-view-1', ['T-0012', 'T-0031', 'T-0042']);
    const repeatedResponse = await a.post('/api/demo/trees/prepare', {
      preparationId: 'prep-tree-view-1', treeIds: ['T-0012', 'T-0031', 'T-0042'], generatorMode: 'demo_rules',
    });
    assert.ok([200, 202].includes(repeatedResponse.status));
    const repeated = await repeatedResponse.json();
    assert.deepEqual(repeated.items.map(x => x.requestId), first.items.map(x => x.requestId));
    assert.equal(countRows(a, 'runs'), 3);

    const views = {};
    for (const treeId of ['T-0012', 'T-0031', 'T-0042']) {
      const response = await a.get(`/api/demo/trees/${treeId}/view`);
      assert.equal(response.status, 200);
      views[treeId] = await response.json();
      assert.equal(views[treeId].tree.treeId, treeId);
      assert.equal(typeof views[treeId].tree.profile, 'string');
      assert.equal(typeof views[treeId].asOf, 'string');
      assert.equal(typeof views[treeId].checkedAt, 'string');
      assert.equal(views[treeId].dataPolicy.mode, 'mixed_demo');
    }
    assert.equal(views['T-0012'].strategyStatus, 'available');
    assert.equal(views['T-0012'].status, 'succeeded');
    assert.equal(views['T-0012'].strategy.kind, 'tapping_angle');
    assert.equal(views['T-0012'].run.status, 'succeeded');
    assert.equal(views['T-0031'].strategy, null);
    assert.equal(views['T-0031'].strategyStatus, 'needs_data');
    assert.equal(views['T-0031'].status, 'needs_data');
    assert.equal(views['T-0042'].strategy, null);
    assert.equal(views['T-0042'].strategyStatus, 'needs_data');
    assert.equal(views['T-0042'].status, 'needs_data');
    assert.ok(views['T-0042'].missingData?.length);

    const before = { contexts: countRows(a, 'contexts'), runs: countRows(a, 'runs') };
    const again = await (await a.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(again.run.runId, views['T-0012'].run.runId);
    assert.equal(again.asOf, views['T-0012'].asOf);
    assert.deepEqual({ contexts: countRows(a, 'contexts'), runs: countRows(a, 'runs') }, before);
  } finally { await a.close(); }
});

test('mixed_demo uses a matching unexpired real forecast before simulated weather', async () => {
  const now = new Date('2026-10-03T08:00:00.000Z');
  const a = await app({ clock: () => now, publicDataService: realWeatherService(now) });
  try {
    const batch = await prepare(a, 'prep-tree-view-real-weather');
    const view = await (await a.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(view.strategyStatus, 'available');
    assert.equal(view.strategy.dataPolicy.mode, 'mixed_demo');
    assert.ok(!view.dataPolicy.substitutions.some(x => x.sourceId === 'demo-weather-service'));
    const context = await (await a.get(`/internal/harness/runs/${batch.items[0].runId}/context`)).json();
    assert.equal(context.modules.weather.forecast.provenance.mode, 'forecast');
    assert.equal(context.modules.weather.forecast.forecastRunId, 'real-weather-tree-view');
    assert.equal(context.modules.weather.forecast.steps[0].rainfallMm, 0.3);
  } finally { await a.close(); }
});

test('withdrawn and expired strategies stay visible in status but GET never regenerates', async () => {
  let now = new Date('2026-10-03T08:00:00.000Z');
  const a = await app({ clock: () => now });
  try {
    const batch = await prepare(a, 'prep-tree-view-review');
    const initial = await (await a.get('/api/demo/trees/T-0012/view')).json();
    const reviewResponse = await a.post(`/internal/harness/runs/${batch.items[0].runId}/review`, { status: 'withdrawn', reason: '验收测试撤回：需要人工复核。' });
    assert.equal(reviewResponse.status, 200);
    const before = countRows(a, 'runs');
    const withdrawn = await (await a.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(withdrawn.strategy, null);
    assert.equal(withdrawn.strategyStatus, 'withdrawn');
    assert.equal(withdrawn.run.runId, initial.run.runId);
    assert.equal(countRows(a, 'runs'), before);
  } finally { await a.close(); }

  const b = await app({ clock: () => now });
  try {
    await prepare(b, 'prep-tree-view-expiry');
    const initial = await (await b.get('/api/demo/trees/T-0012/view')).json();
    const asOf = initial.asOf;
    now = new Date(+now + 3 * 3600000);
    const before = countRows(b, 'runs');
    const expired = await (await b.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(expired.strategy, null);
    assert.equal(expired.strategyStatus, 'expired');
    assert.equal(expired.status, 'succeeded');
    assert.equal(expired.run.runId, initial.run.runId);
    assert.equal(expired.asOf, asOf);
    assert.equal(countRows(b, 'runs'), before);
  } finally { await b.close(); }
});

test('a newer configured failure cannot fall back to an older successful tree strategy', async () => {
  let calls = 0;
  const generator = {
    mode: 'llm', modelVersion: 'tree-view-test-model', describe: () => ({ configured: true }),
    async generate() { calls += 1; throw new Error('configured generator must be paused in this test'); },
  };
  const a = await app({ generator });
  try {
    await prepare(a, 'prep-tree-view-success');
    const first = await (await a.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(first.strategyStatus, 'available');
    a.store.setModelPaused(true, new Date().toISOString());
    const newer = await a.post('/api/demo/trees/prepare', {
      preparationId: 'prep-tree-view-newer-failure', treeIds: ['T-0012'], generatorMode: 'configured', dataMode: 'mixed_demo',
    });
    assert.equal(newer.status, 202);
    const newerBody = await newer.json();
    const newerRunId = newerBody.items[0].runId;
    await a.runtime.idle();
    const failed = await (await a.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(failed.strategy, null);
    assert.equal(failed.strategyStatus, 'failed');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.run.runId, newerRunId);
    assert.equal(failed.error.code, 'MODEL_PAUSED');
    assert.equal(calls, 0);
  } finally { await a.close(); }
});

test('prepare rejects invalid input and a different payload cannot reuse preparationId', async () => {
  const a = await app();
  try {
    assert.equal((await a.post('/api/demo/trees/prepare', { preparationId: 'invalid-no-generator' })).status, 422);
    assert.equal((await a.post('/api/demo/trees/prepare', { preparationId: 'prep-invalid-tree', treeIds: ['T-9999'], generatorMode: 'demo_rules' })).status, 404);
    assert.equal((await a.post('/api/demo/trees/prepare', { preparationId: 'prep-invalid-kind', kind: 'unknown', generatorMode: 'demo_rules' })).status, 422);
    await prepare(a, 'prep-conflict', ['T-0012']);
    const conflict = await a.post('/api/demo/trees/prepare', { preparationId: 'prep-conflict', treeIds: ['T-0001'], generatorMode: 'demo_rules' });
    assert.equal(conflict.status, 409);
    assert.equal((await a.get('/api/demo/trees/T-9999/view')).status, 404);
    assert.equal((await a.get('/api/demo/trees/T-0012/view?kind=unknown')).status, 400);
    assert.equal((await a.get('/api/demo/trees/T-0012/view?dataMode=unknown')).status, 400);
  } finally { await a.close(); }
});

test('prepared tree views survive a process restart with their original snapshot time', async () => {
  const dbPath = join(tmpdir(), `harness-tree-view-${randomUUID()}.sqlite`);
  const now = new Date('2026-10-03T08:00:00.000Z');
  const firstApp = await app({ dbPath, clock: () => now });
  let view;
  try {
    await prepare(firstApp, 'prep-tree-view-restart');
    view = await (await firstApp.get('/api/demo/trees/T-0012/view')).json();
  } finally { await firstApp.close(); }
  const secondApp = await app({ dbPath, clock: () => new Date('2026-10-03T08:30:00.000Z') });
  try {
    const restored = await (await secondApp.get('/api/demo/trees/T-0012/view')).json();
    assert.equal(restored.strategyStatus, 'available');
    assert.equal(restored.run.runId, view.run.runId);
    assert.equal(restored.asOf, view.asOf);
    assert.equal(countRows(secondApp, 'runs'), 1);
  } finally { await secondApp.close(); }
});
