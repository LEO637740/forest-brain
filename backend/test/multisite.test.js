import test from 'node:test';
import assert from 'node:assert/strict';
import { makeParkContext, parkOverview, PARK_SITES, normalizeSiteId } from '../src/adapters/park-demo.js';
import { Store } from '../src/store.js';

const now = new Date('2026-10-08T02:00:00.000Z');

test('every demo park has an independent 200-tree register and scoped evidence', () => {
  const contexts = Object.values(PARK_SITES).map(site => makeParkContext({now,siteId:site.key}));
  for (const context of contexts) {
    const siteId = context.siteId;
    assert.equal(context.siteId, siteId);
    assert.equal(context.targetSnapshot.siteId, siteId);
    assert.equal(context.modules.weather.siteId, siteId);
    assert.equal(context.modules.trees.length, 200);
    assert.ok(context.modules.trees.every(tree => tree.siteId === siteId));
    assert.ok(context.modules.market.prices.every(price => price.provenance.sourceId.endsWith(siteId.slice(5))));
    assert.equal(normalizeSiteId(siteId.slice(5)),siteId);
  }
  assert.equal(new Set(contexts.map(context=>context.snapshotId)).size,10);
  assert.equal(new Set(contexts.map(context=>context.targetSnapshot.targetSnapshotId)).size,10);
  assert.equal(parkOverview(now, 'xian').siteName, '西安模拟试验站');
});

test('site-scoped tree bindings allow the same tree ID in separate parks', () => {
  const store = new Store();
  try {
    store.saveContext(makeParkContext({ treeIds: ['T-0001'], now, siteId: 'hainan' }));
    store.saveContext(makeParkContext({ treeIds: ['T-0001'], now, siteId: 'xsbn' }));
    const base = { treeId: 'T-0001', kind: 'tapping_angle', dataMode: 'demo', preparationId: 'p', requestId: 'r', runId: 'r', contextSnapshotId: 'c', asOf: now.toISOString() };
    // Bindings only need a run row for the storage guard; use an in-memory
    // context/run-free check through the table setup by inserting run IDs is
    // intentionally avoided. The scoped key behavior is asserted directly.
    store.db.prepare("INSERT INTO runs(id,request_id,hash,request,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('r-hn','r-hn','h','{}','queued','queued',now.toISOString(),now.toISOString());
    store.db.prepare("INSERT INTO runs(id,request_id,hash,request,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('r-xb','r-xb','x','{}','queued','queued',now.toISOString(),now.toISOString());
    store.bindTreeView({ ...base, siteId: 'demo-hainan', runId: 'r-hn' });
    store.bindTreeView({ ...base, siteId: 'demo-xsbn', runId: 'r-xb', requestId: 'rb', preparationId: 'pb', contextSnapshotId: 'cb' });
    assert.equal(store.getTreeViewBinding('T-0001', 'tapping_angle', 'demo', 'demo-hainan').runId, 'r-hn');
    assert.equal(store.getTreeViewBinding('T-0001', 'tapping_angle', 'demo', 'demo-xsbn').runId, 'r-xb');
  } finally { store.close(); }
});
