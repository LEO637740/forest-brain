import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { CandidateServiceGenerator } from '../src/adapters/candidate-service.js';
import { HttpContextProvider, makeDemoContext } from '../src/adapters/context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { projectContext } from '../src/validation.js';

async function app(options = {}) {
  const application = createApp({ dbPath: ':memory:', ...options });
  await new Promise((resolve, reject) => { application.server.once('error', reject); application.server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${application.server.address().port}`;
  return { ...application, url, async get(path, headers = {}) { return fetch(`${url}${path}`, { headers }); }, async post(path, body, headers = {}) { return fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); } };
}
test('HTTP: 202 submit → poll result → strategy → context → trace, plus persistent idempotency', async () => {
  const a = await app();
  try {
    const snapshotResponse = await a.post('/api/demo/contexts', { treeIds: ['T-0012'], variant: 'normal' }); assert.equal(snapshotResponse.status, 201);
    const snapshot = await snapshotResponse.json();
    const request = { requestId: 'http-1', kind: 'surface_action', siteId: snapshot.siteId, targetSnapshotId: snapshot.targetSnapshotId, inputSnapshot: snapshot.inputSnapshot, executionMode: 'simulation' };
    const submitted = await a.post('/internal/harness/runs', request); assert.equal(submitted.status, 202); const accepted = await submitted.json();
    await a.runtime.idle();
    const result = await (await a.get(`/internal/harness/runs/${accepted.runId}`)).json(); assert.equal(result.status, 'succeeded');
    assert.equal((await a.get(`/internal/harness/strategies/${result.strategy.strategyId}`)).status, 200);
    const exported = await a.get(`/internal/harness/runs/${accepted.runId}/export`);
    assert.equal(exported.headers.get('content-disposition'), `attachment; filename="${accepted.runId}.json"`);
    assert.deepEqual(await exported.json(), result);
    const context = await (await a.get(`/internal/harness/runs/${accepted.runId}/context`)).json(); assert.deepEqual(Object.keys(context.modules), ['inspection', 'knowledge']);
    const events = await (await a.get(`/internal/harness/runs/${accepted.runId}/events`)).json(); assert.equal(events.items.at(-1).stage, 'succeeded');
    assert.equal((await a.post('/internal/harness/runs', request)).status, 200);
    assert.equal((await a.post('/internal/harness/runs', { ...request, kind: 'pest_risk' })).status, 409);
  } finally { await a.close(); }
});
test('HTTP: explicit auth and CORS boundaries, HTML shell contains no secrets', async () => {
  const a = await app({ token: 'test-only-token-1234567890' });
  try {
    assert.equal((await a.get('/api/meta')).status, 401);
    assert.equal((await a.get('/api/meta', { Authorization: 'Bearer test-only-token-1234567890' })).status, 200);
    assert.equal((await a.get('/api/meta', { Origin: 'https://untrusted.example' })).status, 403);
    const cors = await a.get('/api/meta', { Origin: 'http://localhost:5173', Authorization: 'Bearer test-only-token-1234567890' });
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await a.get('/')).status, 200);
    assert.equal((await a.get('/health')).status, 200);
  } finally { await a.close(); }
});
test('HTTP: bad JSON, invalid query, wrong method and unknown target fail with structured errors', async () => {
  const a = await app();
  try {
    assert.equal((await fetch(`${a.url}/internal/harness/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await a.get('/internal/harness/runs?limit=NaN')).status, 400);
    assert.equal((await a.post('/api/demo/contexts', { treeIds: ['T-9999'], variant: 'normal' })).status, 404);
    assert.equal((await a.get('/internal/harness/runs/missing')).status, 404);
    assert.equal((await a.get('/contracts/harness-v1.schema.json')).status, 200);
    const trees = await (await a.get('/api/demo/trees?limit=100')).json(); assert.equal(trees.items.length, 100); assert.equal(trees.nextCursor, '101');
  } finally { await a.close(); }
});
test('remote context and external candidate adapters interoperate against actual HTTP services', async () => {
  const c = makeDemoContext(); let seen;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === 'GET') { assert.equal(req.headers.authorization, 'Bearer context-test'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(c)); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    seen = JSON.parse(raw); assert.equal(req.headers.authorization, 'Bearer candidate-test');
    const candidate = await new RuleGenerator().generate({ kind: seen.kind, context: seen.context, now: new Date(seen.asOf) });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(candidate));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const a = await app({ contextProvider: new HttpContextProvider({ baseUrl: base, token: 'context-test' }), generator: new CandidateServiceGenerator({ url: `${base}/candidate`, token: 'candidate-test', modelVersion: 'test-v1' }) });
  try {
    const r = await a.post('/internal/harness/runs', { requestId: 'remote-test', kind: 'weather_window', siteId: c.siteId, targetSnapshotId: c.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: c.snapshotId, version: 1 }, executionMode: 'simulation' });
    const submitted = await r.json(); await a.runtime.idle(); const result = a.store.getRun(submitted.runId).result;
    assert.equal(result.status, 'succeeded'); assert.equal(result.strategy.modelVersion, 'test-v1');
    assert.deepEqual(Object.keys(seen.context.modules), ['weather', 'knowledge']);
    assert.equal((await a.get('/api/demo/trees')).status, 404);
  } finally { await a.close(); await new Promise(resolve => upstream.close(resolve)); }
});
test('external candidate HTTP error is retryable and malformed JSON is not accepted', async () => {
  let behavior = 503;
  const upstream = http.createServer((req, res) => { res.statusCode = behavior; res.end(behavior === 503 ? 'unavailable' : 'not json'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    const generator = new CandidateServiceGenerator({ url: `http://127.0.0.1:${upstream.address().port}`, modelVersion: 'test-v1' });
    const args = { kind: 'weather_window', context: projectContext(makeDemoContext(), 'weather_window'), runId: 'test', now: new Date() };
    await assert.rejects(generator.generate(args), e => e.code === 'CANDIDATE_SERVICE_UNAVAILABLE');
    behavior = 200; await assert.rejects(generator.generate(args), e => e.code === 'INVALID_CANDIDATE');
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});
test('versioned dataset pages resolve in scope; repeated cursors and changed versions are rejected', async () => {
  const c = makeDemoContext(), rows = c.modules.growth.measurements;
  delete c.modules.growth;
  c.datasets = [{ module: 'growth', datasetRef: 'dataset-growth', version: 3 }];
  let mode = 'ok';
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/contexts/')) { res.end(JSON.stringify(c)); return; }
    assert.equal(url.searchParams.get('snapshotId'), c.snapshotId);
    assert.equal(url.searchParams.get('snapshotVersion'), '1');
    const second = url.searchParams.has('cursor');
    res.end(JSON.stringify({ datasetRef: 'dataset-growth', module: 'growth', version: mode === 'version' ? 4 : 3, items: second ? rows.slice(2) : rows.slice(0, 2), nextCursor: mode === 'loop' || !second ? 'page-2' : null }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    const provider = new HttpContextProvider({ baseUrl: `http://127.0.0.1:${upstream.address().port}` });
    const ref = { snapshotId: c.snapshotId, version: c.version };
    const resolved = await provider.getContext(ref); assert.deepEqual(resolved.modules.growth.measurements, rows);
    mode = 'loop'; await assert.rejects(provider.getContext(ref), e => e.code === 'INVALID_DATASET_PAGE');
    mode = 'version'; await assert.rejects(provider.getContext(ref), e => e.code === 'DATASET_VERSION_MISMATCH');
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});

test('HTTP: rich park input and one-click scenario batch produce persisted results', async () => {
  const a = await app();
  try {
    const park = await (await a.get('/api/demo/park')).json();
    assert.equal(park.counts.trees, 200);
    assert.equal(park.counts.growth, 800);
    assert.equal(park.scenarios.length, 7);
    assert.equal((await a.post('/api/demo/scenarios/run', { scenarioId: 'invalid' })).status, 422);
    const response = await a.post('/api/demo/scenarios/run', { scenarioId: 'all' });
    assert.equal(response.status, 202);
    const batch = await response.json(); assert.equal(batch.items.length, 7);
    await a.runtime.idle();
    for (const item of batch.items) {
      const run = await (await a.get(`/internal/harness/runs/${item.runId}`)).json();
      assert.equal(run.status, ['missing', 'resting'].includes(item.scenarioId) ? 'needs_data' : 'succeeded');
    }
    const html = await (await a.get('/')).text(); assert.ok(html.includes('id="park-view"'));
  } finally { await a.close(); }
});

test('HTTP: Blender tree view returns tree profile and one-tree tapping strategy', async () => {
  const a = await app();
  try {
    const preparedResponse = await a.post('/api/demo/trees/prepare', { preparationId: 'http-tree-prep-1', treeIds: ['T-0012'], kind: 'tapping_angle', dataMode: 'mixed_demo', generatorMode: 'demo_rules' });
    assert.equal(preparedResponse.status, 202);
    await a.runtime.idle();
    const firstResponse = await a.get('/api/demo/trees/T-0012/view');
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.tree.treeId, 'T-0012');
    assert.equal(typeof first.tree.blockId, 'string');
    assert.equal(first.strategyStatus, 'available');
    assert.equal(first.status, 'succeeded');
    assert.equal(first.strategy.kind, 'tapping_angle');
    assert.equal(first.run.status, 'succeeded');
    assert.equal(first.run.runId, first.strategy.runId);
    assert.equal(typeof first.asOf, 'string');
    assert.ok(first.dataPolicy && typeof first.dataPolicy.mode === 'string');

    // A second click is read-only and returns the same persisted run.
    const secondResponse = await a.get('/api/demo/trees/T-0012/view');
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.run.runId, first.run.runId);
    assert.equal(second.strategyStatus, 'available');

    // A mixed_demo context keeps the policy visible even when public data is unavailable.
    const mixedApp = await app({ publicDataService: {
      status: () => ({ location: { confirmed: false, siteId: 'demo-hainan' }, sources: [{ id: 'weather' }] }),
    } });
    try {
      const mixedPrepared = await mixedApp.post('/api/demo/trees/prepare', { preparationId: 'http-tree-prep-mixed', treeIds: ['T-0012'], dataMode: 'mixed_demo', kind: 'tapping_angle', generatorMode: 'demo_rules' });
      assert.equal(mixedPrepared.status, 202);
      await mixedApp.runtime.idle();
      const mixedResponse = await mixedApp.get('/api/demo/trees/T-0012/view?dataMode=mixed_demo');
      assert.equal(mixedResponse.status, 200);
      const mixed = await mixedResponse.json();
      assert.equal(mixed.dataPolicy.mode, 'mixed_demo');
      assert.equal(mixed.strategy.dataPolicy.mode, 'mixed_demo');
    } finally { await mixedApp.close(); }

    assert.equal((await a.get('/api/demo/trees/T-9999/view')).status, 404);
    assert.ok([400, 422].includes((await a.get('/api/demo/trees/T-0012/view?kind=unknown')).status));
    assert.ok([400, 422].includes((await a.get('/api/demo/trees/T-0012/view?dataMode=unknown')).status));
  } finally { await a.close(); }
});
