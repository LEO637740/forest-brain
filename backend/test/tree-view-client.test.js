import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeViewClient, TreeViewError } from '../public/tree-view-client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('tree view client reads manifest and tree with in-memory auth using GET', async () => {
  const calls = [];
  const client = createTreeViewClient({
    baseUrl: 'http://127.0.0.1:4188/',
    token: 'memory-only-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (String(url).endsWith('/manifest')) return jsonResponse({ version: '1', items: [{ treeId: 'T-0001' }] });
      return jsonResponse({ tree: { treeId: 'T-0001' }, strategy: null, strategyStatus: 'needs_generation' });
    },
  });
  assert.deepEqual((await client.readManifest()).items, [{ treeId: 'T-0001' }]);
  const result = await client.readTree({ treeId: 'T-0001', dataMode: 'mixed_demo' });
  assert.equal(result.tree.treeId, 'T-0001');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer memory-only-token');
  assert.match(calls[1].url, /\/api\/demo\/trees\/T-0001\/view\?kind=tapping_angle&dataMode=mixed_demo$/);
  assert.equal(calls[1].options.body, undefined);
});

test('tree view client preserves structured HTTP errors', async () => {
  const client = createTreeViewClient({ fetchImpl: async () => jsonResponse({ error: { code: 'TREE_NOT_FOUND', message: '未知树', details: ['T-9999'] } }, 404) });
  await assert.rejects(client.readTree({ treeId: 'T-9999' }), error => {
    assert.ok(error instanceof TreeViewError);
    assert.equal(error.code, 'TREE_NOT_FOUND');
    assert.equal(error.status, 404);
    assert.deepEqual(error.details, ['T-9999']);
    return true;
  });
  await assert.rejects(client.readTree({ treeId: 'bad' }), error => error.code === 'INVALID_TREE_ID');
});

test('tree view client distinguishes caller cancellation from timeout', async () => {
  const pendingFetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
  });
  const client = createTreeViewClient({ fetchImpl: pendingFetch });
  const caller = new AbortController();
  const cancelled = client.readManifest({ signal: caller.signal, timeoutMs: 100 });
  caller.abort();
  await assert.rejects(cancelled, error => error.code === 'ABORTED' && error.name === 'AbortError');
  await assert.rejects(client.readManifest({ timeoutMs: 10 }), error => error.code === 'TIMEOUT' && error.status === 0);
});
