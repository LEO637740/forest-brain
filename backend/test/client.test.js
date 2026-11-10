import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarnessClient } from '../contracts/client.ts';
import { schemaBundle } from '../src/contracts.js';
import { makeDemoContext } from '../src/adapters/context.js';

test('TypeScript client polls terminal needs_data and retains structured HTTP errors', async () => {
  const paths = [], final = { runId: 'run-test', requestId: 'request-test', status: 'needs_data', updatedAt: new Date().toISOString(), missingData: [{ module: 'weather', field: 'rainfallMm', objectId: 'tree-test', reason: 'missing' }] };
  let gets = 0;
  const client = createHarnessClient({ baseUrl: 'http://127.0.0.1:4188', token: 'client-test', fetch: async (url, options) => {
    paths.push(url); assert.equal(options.headers.Authorization, 'Bearer client-test');
    if (options.method === 'POST') return new Response(JSON.stringify({ runId: 'run-test', requestId: 'request-test', status: 'queued' }), { status: 202 });
    return new Response(JSON.stringify(gets++ ? final : { runId: 'run-test', requestId: 'request-test', status: 'running', stage: 'context', updatedAt: new Date().toISOString() }));
  } });
  const accepted = await client.submit({ requestId: 'request-test', kind: 'weather_window', siteId: 'test', targetSnapshotId: 'test', inputSnapshot: { snapshotId: 'test', version: 1 }, executionMode: 'simulation' });
  assert.deepEqual(await client.wait(accepted.runId, { intervalMs: 1 }), final);
  assert.equal(paths.length, 3);
  const denied = createHarnessClient({ baseUrl: 'http://127.0.0.1', fetch: async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'denied' } }), { status: 401 }) });
  await assert.rejects(denied.getRun('test'), e => e.code === 'UNAUTHORIZED' && e.status === 401);
});
test('TypeScript client exposes wait timeout and cancellation, never resubmits automatically', async () => {
  let calls = 0;
  const client = createHarnessClient({ baseUrl: 'http://127.0.0.1', fetch: async () => { calls++; return new Response(JSON.stringify({ status: 'running' })); } });
  await assert.rejects(client.wait('test', { timeoutMs: 3, intervalMs: 1 }), e => e.code === 'POLL_TIMEOUT');
  assert.ok(calls > 0);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(client.wait('test', { signal: controller.signal }), /cancelled/);
});
test('exported schema matches runtime source and sample tree identity is stable across scopes', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../contracts/harness-v1.schema.json', import.meta.url), 'utf8')), schemaBundle);
  const now = new Date();
  const one = makeDemoContext({ now, treeIds: ['T-0012'] });
  const group = makeDemoContext({ now, treeIds: ['T-0007', 'T-0012', 'T-0013'] });
  assert.deepEqual(one.modules.growth.measurements, group.modules.growth.measurements.filter(x => x.treeId === 'T-0012'));
  assert.equal(one.modules.trees[0].circumferenceCm, one.modules.growth.measurements.at(-1).circumferenceCm);
});
