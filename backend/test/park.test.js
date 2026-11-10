import test from 'node:test';
import assert from 'node:assert/strict';
import { parkOverview, makeParkContext, SCENARIOS, scenarioContext, DEMO_EXCEPTION_CASES, PARK_SITES, profileOf } from '../src/adapters/park-demo.js';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { calculatePestRiskAssessment } from '../src/pest-policy.js';
import {handlers} from '../src/capabilities/rules.js';
import {marketTreeExclusion} from '../src/market-policy.js';
const now = new Date('2026-09-28T01:00:00Z');

test('normal production fixtures stay clear while the nine named exception cases remain available',()=>{
 const expected=[['T-0004','scar'],['T-0005','lesion'],['T-0006','unregistered'],['T-0012','scar'],['T-0018','nodule'],['T-0027','bird_dropping'],['T-0031','resting'],['T-0038','mud'],['T-0042','missing']];
 assert.deepEqual(DEMO_EXCEPTION_CASES.map(({treeId,profile})=>[treeId,profile]),expected);
 assert.equal(Object.isFrozen(DEMO_EXCEPTION_CASES),true);
 assert.ok(DEMO_EXCEPTION_CASES.every(item=>Object.isFrozen(item)&&item.label));
 const context=makeParkContext({now});
 const cases=new Set(DEMO_EXCEPTION_CASES.map(item=>item.treeId));
 const normal=context.modules.trees.filter(tree=>!cases.has(tree.treeId));
 assert.equal(normal.length,191);
 assert.ok(normal.every(tree=>profileOf(tree.treeId)==='normal'&&tree.tappingStatus==='available'&&tree.healthStatus==='normal'&&Number.isFinite(tree.circumferenceCm)));
 assert.ok(context.modules.inspection.evidence.filter(item=>!cases.has(item.treeId)).every(item=>item.geometryRegistered&&item.detections.length===0));
 const findings=handlers.surface_action(context).proposal.findings;
 assert.equal(findings.length,7);
 assert.deepEqual(findings.filter(f=>f.action==='capture').map(f=>f.treeId),['T-0006']);
 assert.deepEqual(findings.filter(f=>f.action==='continue_with_review').map(f=>f.treeId),['T-0027','T-0038']);
 assert.deepEqual(findings.filter(f=>f.action==='avoid_with_review').map(f=>f.treeId),['T-0004','T-0005','T-0012','T-0018']);
 assert.equal(context.modules.trees.filter(tree=>!marketTreeExclusion(tree)).length,194);
 for(const block of ['B','C','D'])assert.equal(normal.filter(tree=>tree.blockId===block).length,50);
 assert.equal(normal.filter(tree=>tree.blockId==='A').length,41);
});

test('exception metadata and seeds remain scoped to each independent park',()=>{
 for(const siteId of Object.keys(PARK_SITES)){
  const park=parkOverview(now,siteId);
  assert.equal(park.exceptionCases.length,9);
  assert.ok(park.exceptionCases.every(item=>item.siteId===siteId));
  assert.deepEqual(park.exceptionCases.map(({siteId:scope,...item})=>item),DEMO_EXCEPTION_CASES);
  assert.equal(park.trees.filter(tree=>tree.profile==='normal').length,191);
  for(const item of park.exceptionCases){
   const tree=park.trees.find(tree=>tree.treeId===item.treeId);
   assert.equal(tree.siteId,siteId);assert.equal(tree.profile,item.profile);
  }
 }
});

test('park: 200 unique trees, missing values and per-tree history agree across scopes', () => {
  const park = parkOverview(now);
  assert.equal(new Set(park.trees.map(t => t.treeId)).size, 200);
  assert.equal(park.modules.growth.measurements.length, 800);
  assert.equal(park.modules.health.records.length, 600);
  assert.equal(park.modules.market.prices.length, 14);
  for (const tree of park.modules.trees) {
    const single = makeParkContext({ treeIds: [tree.treeId], now });
    assert.deepEqual(single.modules.trees[0], tree);
    const rows = park.modules.growth.measurements.filter(x => x.treeId === tree.treeId);
    assert.equal(rows.at(-1).circumferenceCm, tree.circumferenceCm);
    assert.equal(new Set(rows.map(x => x.observedAt)).size, 4);
  }
  const altered = makeParkContext({ treeIds: ['T-0012'], now, variant: 'missing_weather' });
  assert.equal(altered.modules.weather.observed.rainfallMm, null);
  assert.deepEqual(altered.modules.trees, makeParkContext({ treeIds: ['T-0012'], now }).modules.trees);
});

test('park health demo: records are simulated, repeatable, spatially varied and not a diagnosis', () => {
  const hainan = makeParkContext({ now, siteId: 'demo-hainan' });
  const replay = makeParkContext({ now, siteId: 'demo-hainan' });
  const xsbn = makeParkContext({ now, siteId: 'demo-xsbn' });
  assert.deepEqual(hainan.modules.health.records, replay.modules.health.records);
  assert.notDeepEqual(hainan.modules.health.records, xsbn.modules.health.records);
  assert.ok(hainan.modules.health.records.every(r => r.provenance.mode === 'simulated'));
  const byTree = new Map();
  for (const row of hainan.modules.health.records) {
    const rows = byTree.get(row.treeId) ?? [];
    rows.push(row);
    byTree.set(row.treeId, rows);
  }
  const affected = [...byTree].filter(([, rows]) => rows.some(r => r.symptomCodes.length));
  const blocks = new Set(affected.map(([id]) => String(Math.floor((Number(id.slice(2)) - 1) / 50))));
  assert.ok(affected.length > 10 && affected.length < 120);
  assert.equal(byTree.get('T-0001').every(r => r.symptomCodes.length === 0), true);
  assert.equal(byTree.get('T-0005').some(r => r.symptomCodes.length), true);
  assert.equal(byTree.get('T-0015').some(r => r.symptomCodes.length), true);
  assert.equal(blocks.size, 4);
  const scores = [...byTree].map(([treeId]) => calculatePestRiskAssessment({
    records: hainan.modules.health.records,
    humidityPct: hainan.modules.weather.observed.relativeHumidityPct,
    weatherObservationId: hainan.modules.weather.observed.observationId,
    treeId,
    now,
  }).riskIndex);
  assert.ok(new Set(scores).size >= 3);
  assert.equal(scores[0] >= 0, true);
});

test('park replay: weather update changes advice; surface and health separate cases; missing/resting produce no strategy', async () => {
  const store = new Store(), runtime = new HarnessRuntime({ store, contextProvider: new LocalContextProvider(store), clock: () => now });
  const results = {};
  try {
    for (const scene of SCENARIOS) {
      const c = scenarioContext(scene, now); store.saveContext(c);
      const accepted = runtime.submit({ requestId: scene.id, kind: scene.kind, siteId: c.siteId, targetSnapshotId: c.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: c.snapshotId, version: c.version }, executionMode: 'simulation' });
      await runtime.idle(); results[scene.id] = store.getRun(accepted.runId).result;
    }
    assert.ok(results.morning.strategy.proposal.windows.every(w => w.suitability === 'suitable'));
    assert.ok(results.rain.strategy.proposal.windows.every(w => w.suitability === 'defer'));
    assert.equal(results.rain.strategy.targetSnapshotId, results.morning.strategy.targetSnapshotId);
    assert.ok(results.rain.strategy.revision > results.morning.strategy.revision);
    for (const key of ['missing', 'resting']) { assert.equal(results[key].status, 'needs_data'); assert.equal(results[key].strategy, undefined); }
    const findings = results.surface.strategy.proposal.findings;
    assert.equal(findings.find(f => f.treeId === 'T-0006').action, 'capture');
    assert.equal(findings.find(f => f.treeId === 'T-0012').action, 'avoid_with_review');
    assert.equal(findings.find(f => f.treeId === 'T-0018').action, 'avoid_with_review');
    assert.equal(findings.find(f => f.treeId === 'T-0027').action, 'continue_with_review');
    assert.equal(findings.find(f => f.treeId === 'T-0038').action, 'continue_with_review');
    assert.equal(findings.some(f => f.treeId === 'T-0001'), false);
    assert.deepEqual(results.health.strategy.proposal.inspectionTargets, ['T-0005', 'T-0015']);
    assert.equal(results.growth.strategy.proposal.predictions.length, 3);
  } finally { await runtime.stop(); store.close(); }
});
