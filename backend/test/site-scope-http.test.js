import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import {parks} from '../../shared/parkCatalog.ts';

// Exercise the API boundary with isolated storage and local rule generation.
// These are independent simulated parks, not authenticated user permissions.
async function fixture(t) {
  const clock = () => new Date('2026-10-17T02:00:00.000Z');
  const app = createApp({
    dbPath: ':memory:', clock, generator: new RuleGenerator(),
    publicDataService: {status: () => ({location: {confirmed: false}, sources: []})},
  });
  t.after(() => app.close());
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(path, body, expected = 200) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
    return data;
  }
  async function prepare(siteId, kind = 'tapping_angle') {
    await call('/api/demo/trees/prepare', {
      preparationId: `scope-${siteId}-${kind}`, siteId, treeIds: ['T-0001'],
      kind, dataMode: 'demo', generatorMode: 'demo_rules',
    }, 202);
    await app.runtime.idle();
    const view = await call(`/api/demo/trees/T-0001/view?kind=${kind}&dataMode=demo&siteId=${siteId}`);
    assert.equal(view.strategyStatus, 'available');
    return view.strategy;
  }
  return {app, call, prepare, clock};
}

const ids = items => items.map(item => item.id).sort();
const task = (site) => ({
  id: `scope-task-${site}`, site, kind: '割胶', status: '待开始',
  count: 1, done: 0, treeIndices: [0],
});

test('new parks have independent coordinates, same-numbered trees, strategies and adoption records', async t => {
  const {call,prepare} = await fixture(t);
  const accepted=await call('/api/simulation/task-receipts',{tasks:Object.keys(parks).map(task)});
  assert.equal(accepted.accepted,10);
  const first='hainan-danzhou',second='hainan-baoting';
  const locations=[];
  for(const site of [first,second,'guangdong-zhanjiang','yunnan-mengla']){
    const park=await call(`/api/demo/park?siteId=${site}`),catalog=await call(`/api/field/trees?siteId=${site}`);
    assert.equal(park.siteId,parks[site].siteId);assert.equal(park.trees.length,200);
    assert.equal(catalog.importedCount,200);assert.equal(catalog.items[0].sourceTreeId,`${parks[site].treePrefix}-A-0001`);
    locations.push(`${catalog.items[0].longitude},${catalog.items[0].latitude}`);
    assert.deepEqual(ids((await call(`/api/simulation/tasks?siteId=${site}`)).items),[`scope-task-${site}`]);
    assert.equal((await call(`/api/demo/analytics?site=${site}`)).siteId,parks[site].siteId);
  }
  assert.equal(new Set(locations).size,4);
  const a=await prepare(first),b=await prepare(second);
  assert.equal(a.siteId,parks[first].siteId);assert.equal(b.siteId,parks[second].siteId);
  assert.notEqual(a.strategyId,b.strategyId);
  await call('/api/simulation/actions',{requestId:'new-park-adoption',kind:'adopt_angle',treeId:'T-0001',siteId:parks[first].siteId,strategyId:a.strategyId});
  assert.equal((await call(`/api/simulation/actions?siteId=${first}`)).items.length,1);
  assert.equal((await call(`/api/simulation/actions?siteId=${second}`)).items.length,0);
  assert.equal((await call(`/api/demo/trees/T-0001/view?siteId=${second}&dataMode=demo&kind=tapping_angle`)).strategy.strategyId,b.strategyId);
});

test('site scope HTTP: task synchronization retains all sites while explicit task and receipt queries filter', async t => {
  const {call} = await fixture(t);
  const saved = await call('/api/simulation/task-receipts', {tasks: [task('hainan'), task('xsbn')]});
  assert.equal(saved.accepted, 2);
  assert.deepEqual(saved.conflicts, []);

  assert.deepEqual(ids((await call('/api/simulation/tasks')).items), ['scope-task-hainan', 'scope-task-xsbn']);
  assert.deepEqual(ids((await call('/api/simulation/task-receipts')).items.map(item => item.task)), ['scope-task-hainan', 'scope-task-xsbn']);
  for (const siteId of ['xsbn', 'demo-xsbn']) {
    assert.deepEqual(ids((await call(`/api/simulation/tasks?siteId=${siteId}`)).items), ['scope-task-xsbn']);
    assert.deepEqual(ids((await call(`/api/simulation/task-receipts?siteId=${siteId}`)).items.map(item => item.task)), ['scope-task-xsbn']);
  }
  assert.deepEqual((await call('/api/simulation/tasks?siteId=xian')).items, []);
  for (const endpoint of ['tasks', 'task-receipts', 'constraints', 'market/latest', 'reviews']) {
    const invalid = await call(`/api/simulation/${endpoint}?siteId=unknown-park`, undefined, 400);
    assert.equal(invalid.error.code, 'INVALID_QUERY');
  }
});

test('site scope HTTP: latest market models, lookup and plan creation respect owner, including legacy models', async t => {
  const {app, call, clock} = await fixture(t);
  const hainan = await call('/api/simulation/market', {siteId: 'hainan'});
  const xsbn = await call('/api/simulation/market', {siteId: 'xsbn'});
  assert.notEqual(hainan.id, xsbn.id);
  assert.equal((await call('/api/simulation/market/latest')).model.id, hainan.id);
  assert.equal((await call('/api/simulation/market/latest?siteId=xsbn')).model.id, xsbn.id);
  assert.deepEqual(Object.fromEntries(Object.entries(await call('/api/simulation/market/latest?siteId=xian')).filter(([key]) => key !== 'inventory')), {model: null, plan: null});
  assert.equal((await call(`/api/simulation/market/${hainan.id}`)).id, hainan.id);
  assert.equal((await call(`/api/simulation/market/${xsbn.id}?siteId=xsbn`)).id, xsbn.id);
  assert.equal((await call(`/api/simulation/market/${hainan.id}?siteId=xsbn`, undefined, 404)).error.code, 'NOT_FOUND');
  const rejected = await call('/api/simulation/market-plan', {modelId: hainan.id, siteId: 'xsbn'}, 409);
  assert.equal(rejected.error.code, 'SITE_MISMATCH');
  assert.equal((await call('/api/simulation/tasks')).items.length, 0);
  assert.equal((await call('/api/simulation/market/latest')).plan, null);

  // A pre-site migration row belongs to Hainan only; never to every park.
  const legacy = {...hainan, id: 'market-legacy-site-fixture', generatedAt: new Date(+clock() + 1).toISOString()};
  delete legacy.siteId;
  app.store.db.prepare('INSERT INTO simulation_models VALUES(?,?,?)').run(legacy.id, JSON.stringify(legacy), legacy.generatedAt);
  assert.equal((await call('/api/simulation/market/latest')).model.id, legacy.id);
  assert.equal((await call('/api/simulation/market/latest?siteId=xsbn')).model.id, xsbn.id);
  assert.deepEqual(Object.fromEntries(Object.entries(await call('/api/simulation/market/latest?siteId=xian')).filter(([key]) => key !== 'inventory')), {model: null, plan: null});
  await call(`/api/simulation/market/${legacy.id}?siteId=xsbn`, undefined, 404);
  assert.equal((await call(`/api/simulation/market/${legacy.id}?siteId=hainan`)).id, legacy.id);
});

test('site scope HTTP: review lists and operations keep duplicate tree IDs and legacy jobs in their own park', async t => {
  const {app, call} = await fixture(t);
  const create = async siteId => (await call('/api/simulation/reviews', {
    siteId, treeIds: ['T-0042'], kind: 'measure', assignee: 'robot',
  }, 201)).items[0];
  const hainan = await create('hainan');
  const xsbn = await create('xsbn');
  const legacy = {...hainan, id: 'review-legacy-site-fixture', treeId: 'T-0008'};
  delete legacy.siteId;
  app.store.db.prepare('INSERT INTO review_jobs VALUES(?,?)').run(legacy.id, JSON.stringify(legacy));

  const hnList = await call('/api/simulation/reviews');
  const xsList = await call('/api/simulation/reviews?siteId=xsbn');
  assert.deepEqual(ids(hnList.items), [hainan.id, legacy.id].sort());
  assert.deepEqual(ids(xsList.items), [xsbn.id]);
  assert.deepEqual((await call('/api/simulation/reviews?siteId=xian')).items, []);
  assert.equal(hnList.issues.find(issue => issue.treeId === 'T-0042').job.id, hainan.id);
  assert.equal(xsList.issues.find(issue => issue.treeId === 'T-0042').job.id, xsbn.id);
  assert.equal(hnList.issues.find(issue => issue.treeId === 'T-0008').job.id, legacy.id);
  assert.equal(xsList.issues.find(issue => issue.treeId === 'T-0008').job, undefined);

  assert.equal((await call(`/api/simulation/reviews/${hainan.id}/events`)).items.length, 1);
  await call(`/api/simulation/reviews/${hainan.id}/events?siteId=xsbn`, undefined, 404);
  for (const action of ['collect', 'complete', 'regenerate']) {
    const rejected = await call(`/api/simulation/reviews/${hainan.id}/${action}?siteId=xsbn`, {note: '跨园区写入不得发生'}, 404);
    assert.equal(rejected.error.code, 'NOT_FOUND');
  }
  assert.equal((await call('/api/simulation/reviews')).items.find(job => job.id === hainan.id).status, 'queued');
  assert.equal((await call(`/api/simulation/reviews/${hainan.id}/events`)).items.length, 1);
  assert.equal((await call(`/api/simulation/reviews/${xsbn.id}/collect?siteId=xsbn`, {})).status, 'collected');
  assert.equal((await call(`/api/simulation/reviews/${hainan.id}/collect`, {})).status, 'collected');
  await call(`/api/simulation/reviews/${legacy.id}/events?siteId=xsbn`, undefined, 404);
});

test('site scope HTTP: strategy adoption, validity and weather constraints never cross the requested park', async t => {
  const {app, call, prepare} = await fixture(t);
  const angle = await prepare('hainan');
  const reference = {treeId: 'T-0001', strategyId: angle.strategyId, runId: angle.runId, revision: angle.revision};
  const rejected = await call('/api/simulation/actions', {
    requestId: 'scope-wrong-angle', kind: 'adopt_angle', siteId: 'xsbn', ...reference,
  }, 409);
  assert.equal(rejected.error.code, 'STRATEGY_CHANGED');
  assert.equal(rejected.error.details.status, 'site_mismatch');
  const checked = await call('/api/simulation/strategy-validity', {
    strategies: [{...reference, siteId: 'xsbn'}, {...reference, siteId: 'hainan'}],
  });
  assert.equal(checked.items[0].valid, false);
  assert.equal(checked.items[0].status, 'site_mismatch');
  assert.equal(checked.items[1].valid, true);
  assert.deepEqual((await call('/api/simulation/actions')).items, []);

  for (const siteId of ['hainan', 'xsbn']) {
    const prepared = await call('/api/demo/scenarios/run', {scenarioId: 'morning', siteId}, 202);
    await app.runtime.idle();
    const result = await call(`/internal/harness/runs/${prepared.items[0].runId}`);
    assert.equal(result.status, 'succeeded');
    const window = result.strategy.proposal.windows.find(item => item.suitability === 'suitable');
    assert.ok(window, 'fixture has an adoptable weather window');
    await call('/api/simulation/actions', {
      requestId: `scope-weather-${siteId}`, siteId, kind: 'adopt_weather',
      treeId: 'T-0001', strategyId: result.strategy.strategyId, start: window.start,
    });
  }
  const hainanConstraints = (await call('/api/simulation/constraints')).constraints;
  const xsbnConstraints = (await call('/api/simulation/constraints?siteId=xsbn')).constraints;
  assert.deepEqual(hainanConstraints.map(item => item.requestId), ['scope-weather-hainan']);
  assert.deepEqual(xsbnConstraints.map(item => item.requestId), ['scope-weather-xsbn']);
  assert.equal(hainanConstraints[0].validity.valid, true);
  assert.equal(xsbnConstraints[0].validity.valid, true);
  assert.deepEqual((await call('/api/simulation/constraints?siteId=xian')).constraints, []);
});
