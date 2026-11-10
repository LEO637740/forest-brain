// Exercise delivered endpoints in an isolated, in-memory application.
// Public-source service is an explicit empty test fixture; no external requests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
test('integration: mixed-mode adoption and review projection survive prepare, withdrawal and expiry', async () => {
let time = Date.parse('2026-10-07T02:00:00.000Z');
const clock = () => new Date(time);
const app = createApp({dbPath: ':memory:', generator: new RuleGenerator(), clock,
  publicDataService: {status: () => ({location: {confirmed: false}, sources: []})}});
app.store.setModelPaused(true, clock().toISOString());
let checks = 0;
const findings = [];
const check = (value, label) => { assert.ok(value, label); checks++; };
await new Promise((resolve, reject) => {app.server.once('error', reject);app.server.listen(0, '127.0.0.1', resolve);});
const base = `http://127.0.0.1:${app.server.address().port}`;
async function call(path, body, expected = 200) {
  const r = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000)});
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`); checks++;
  return data;
}
async function prepare(ids, kind, mode, stamp) {
  await call('/api/demo/trees/prepare', {preparationId: stamp, treeIds: ids, kind,
    dataMode: mode, generatorMode: 'demo_rules'}, 202);
  await app.runtime.idle();
}
const view = (id, kind = 'tapping_angle', mode = 'demo') => call(`/api/demo/trees/${id}/view?kind=${kind}&dataMode=${mode}`);
try {
  for (const kind of ['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk'])
    await prepare(['T-0001', 'T-0006', 'T-0012', 'T-0031', 'T-0042'], kind, 'demo', `initial-${kind}`);
  const normal = await view('T-0001');
  check(normal.strategyStatus === 'available', 'normal strategy available');
  const adoption = {requestId: 'adopt-normal', kind: 'adopt_angle', treeId: 'T-0001', strategyId: normal.strategy.strategyId};
  const adopted = await call('/api/simulation/actions', adoption);
  check(adopted.mode === 'simulation' && adopted.angle === normal.strategy.proposal.recommendedCutSlopeDeg, 'adoption follows backend proposal');
  const repeated = await call('/api/simulation/actions', adoption);
  check(JSON.stringify(repeated) === JSON.stringify(adopted), 'adoption idempotency');
  const actions = await call('/api/simulation/actions?treeId=T-0001');
  check(actions.items.length === 1, 'idempotent adoption creates one row');
  await call('/api/simulation/actions', {...adoption, treeId: 'T-0012'}, 409);
  await call('/api/simulation/actions', {...adoption, requestId: 'wrong-tree', treeId: 'T-0012'}, 409);
  const resting = await view('T-0031');
  check(resting.strategyStatus === 'needs_data' && resting.strategy === null, 'resting tree guarded');
  const missing = await view('T-0042');
  check(missing.strategyStatus === 'needs_data' && missing.tree.circumferenceCm === null, 'missing measurement guarded');

  // Mixed preparation and adoption use the same binding.
  await prepare(['T-0012'], 'tapping_angle', 'mixed_demo', 'mixed-angle');
  const mixed = await view('T-0012', 'tapping_angle', 'mixed_demo');
  check(mixed.strategyStatus === 'available', 'mixed strategy can be generated');
  const acceptedMixed = await call('/api/simulation/actions', {requestId: 'adopt-mixed', kind: 'adopt_angle', treeId: 'T-0012', strategyId: mixed.strategy.strategyId});
  check(acceptedMixed.dataMode === 'mixed_demo', 'mixed-mode strategy is accepted with its data mode');
  findings.push({issue: 'mixed-mode-adoption-rejected', viewStatus: mixed.strategyStatus, response: acceptedMixed.dataMode});

  // Measurement collection and regeneration work in demo mode.
  const job = (await call('/api/simulation/reviews', {treeIds: ['T-0042'], kind: 'measure', assignee: 'robot'}, 201)).items[0];
  const collected = await call(`/api/simulation/reviews/${job.id}/collect`, {});
  check(collected.status === 'collected' && collected.evidence.circumferenceCm === 66, 'measurement evidence collected');
  time += 1000;
  const completed = await call(`/api/simulation/reviews/${job.id}/complete`, {note: '复核测试：模拟测量完成'});
  await app.runtime.idle();
  check(completed.status === 'completed' && completed.runs.length === 8, 'four kinds regenerated for both modes');
  const measured = await view('T-0042');
  check(measured.tree.circumferenceCm === 66 && measured.strategyStatus === 'available', 'measurement enables demo angle');
  const growth = await view('T-0042', 'growth_plan');
  check(growth.strategyStatus === 'needs_data', 'one valid measurement does not invent a growth history');
  await prepare(['T-0042'], 'tapping_angle', 'mixed_demo', 'mixed-after-measure');
  const mixedMeasured = await view('T-0042', 'tapping_angle', 'mixed_demo');
  check(mixedMeasured.tree.circumferenceCm === 66 && mixedMeasured.strategyStatus === 'available', 'mixed mode preserves completed measurement');
  findings.push({issue: 'mixed-mode-loses-review-projection', treeId: 'T-0042', demo: {size: measured.tree.circumferenceCm, status: measured.strategyStatus}, mixed: {size: mixedMeasured.tree.circumferenceCm, status: mixedMeasured.strategyStatus}});

  // Capture/clear is a separate explicit workflow and clears surface findings.
  const photo = (await call('/api/simulation/reviews', {treeIds: ['T-0006'], kind: 'capture', assignee: 'robot'}, 201)).items[0];
  await call(`/api/simulation/reviews/${photo.id}/collect`, {});
  await call(`/api/simulation/reviews/${photo.id}/complete`, {conclusion: 'clear', note: '复核测试：模拟补拍并确认障碍已清除'});
  await app.runtime.idle();
  const clear = await view('T-0006', 'surface_action');
  check(clear.strategyStatus === 'available' && clear.strategy.proposal.findings.length === 0, 'capture and explicit clear reflected in surface strategy');
  await call('/api/simulation/reviews', {treeIds: ['T-0031'], kind: 'measure', assignee: 'robot'}, 409);

  // Explicit withdrawal is enforced at the server's view/adoption boundary.
  await call(`/internal/harness/runs/${normal.strategy.runId}/review`, {status: 'withdrawn', reason: '复核测试：撤回旧建议'});
  const withdrawn = await view('T-0001');
  check(withdrawn.strategyStatus === 'withdrawn' && withdrawn.strategy === null, 'withdrawn view hides proposal');
  await call('/api/simulation/actions', {...adoption, requestId: 'adopt-after-withdrawal'}, 409);

  // A suitable weather window can be adopted only for its target trees.
  const weatherJob = (await call('/api/demo/scenarios/run', {scenarioId: 'morning'}, 202)).items[0];
  await app.runtime.idle();
  const weather = await call(`/internal/harness/runs/${weatherJob.runId}`);
  check(weather.status === 'succeeded', 'weather scenario generated');
  const suitable = weather.strategy.proposal.windows.find(w => w.suitability === 'suitable');
  check(!!suitable, 'scenario has suitable window');
  const acceptedWeather = await call('/api/simulation/actions', {requestId: 'weather-accept', kind: 'adopt_weather', treeId: 'T-0001', strategyId: weather.strategy.strategyId, start: suitable.start});
  check(acceptedWeather.treeIds.length === 50 && acceptedWeather.start === suitable.start, 'weather adoption targets correct tree group');
  await call('/api/simulation/actions', {requestId: 'weather-wrong-tree', kind: 'adopt_weather', treeId: 'T-0200', strategyId: weather.strategy.strategyId, start: suitable.start}, 409);

  time += 2 * 3600000;
  const expired = await view('T-0012');
  check(expired.strategyStatus === 'expired' && expired.strategy === null, 'expired view hides proposal');
  await call('/api/simulation/actions', {requestId: 'adopt-after-expiry', kind: 'adopt_angle', treeId: 'T-0012', strategyId: app.store.getRun(app.store.getTreeViewBinding('T-0012', 'tapping_angle', 'demo').runId).result.strategy.strategyId}, 409);
  const result = {passed: true, assertions: checks, externalRequests: 0, generator: 'demo_rules', findings};
  check(result.assertions >= 50, 'normal and failure boundary checks exercised');
} finally { await app.close(); }

});
