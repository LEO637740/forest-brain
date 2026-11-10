import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider, makeDemoContext } from '../src/adapters/context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { KINDS, resultSchema, contextSchema } from '../src/contracts.js';
import { validate } from '../src/schema.js';
import { AppError } from '../src/errors.js';
import { checkContext, checkCandidate } from '../src/validation.js';

const NOW = new Date('2026-09-24T08:00:00Z');
const request = (context, kind = 'weather_window', requestId = `test-${kind}`) => ({ requestId, kind, siteId: context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version }, executionMode: 'simulation' });
function setup(options = {}) {
  const store = new Store(options.dbPath), context = options.context ?? makeDemoContext({ now: NOW, variant: options.variant, treeIds: options.treeIds });
  store.saveContext(context);
  const runtime = new HarnessRuntime({ store, contextProvider: options.provider ?? new LocalContextProvider(store), generator: options.generator, clock: () => NOW });
  return { store, context, runtime, async run(kind = 'weather_window', id) { const accepted = runtime.submit(request(context, kind, id)); await runtime.idle(); return store.getRun(accepted.runId).result; }, async close() { await runtime.stop(); store.close(); } };
}

for (const kind of KINDS.filter(k=>k!=='industry_brief')) test(`${kind}: structured result, snapshot, trace and ownership boundary`, async () => {
  const app = setup();
  try {
    const result = await app.run(kind);
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    validate(resultSchema, result);
    assert.equal(result.strategy.kind, kind);
    assert.equal(result.strategy.provenance.mode, 'simulated');
    assert.equal(result.strategy.constraintsChecked.at(-1).status, 'not_checked');
    assert.equal(result.strategy.modelVersion, null);
    assert.equal(Object.hasOwn(result.strategy, 'approvedBy'), false);
    assert.equal(app.store.events(result.runId).at(-1).stage, 'succeeded');
    assert.deepEqual(app.store.getStrategy(result.strategy.strategyId), result.strategy);
  } finally { await app.close(); }
});
test('missing rainfall returns needs_data without a strategy, never treats null as 0', async () => {
  const app = setup({ variant: 'missing_weather' });
  try { const r = await app.run(); assert.equal(r.status, 'needs_data'); assert.ok(r.missingData.some(d => d.field === 'observed.rainfallMm')); assert.equal(r.strategy, undefined); } finally { await app.close(); }
});
test('on-site rain removes suitable windows', async () => {
  const app = setup({ variant: 'rainy' });
  try { const r = await app.run(); assert.equal(r.status, 'succeeded'); assert.ok(r.strategy.proposal.windows.every(w => w.suitability !== 'suitable')); } finally { await app.close(); }
});
test('unregistered image produces capture suggestions, no invented geometric conclusion', async () => {
  const app = setup({ variant: 'unregistered' });
  try { const r = await app.run('surface_action'); assert.equal(r.status, 'succeeded'); assert.equal(r.strategy.proposal.findings[0].affectsCut, 'unknown'); assert.equal(r.strategy.proposal.findings[0].action, 'capture'); } finally { await app.close(); }
});
test('missing cost permits comparison but no contribution or selected scenario', async () => {
  const app = setup({ variant: 'missing_cost' });
  try { const r = await app.run('market_scenario'); assert.equal(r.status, 'succeeded'); assert.equal(r.strategy.proposal.recommendedScenarioId, null); assert.ok(r.strategy.proposal.scenarios.every(s => s.estimatedContributionCny === null)); } finally { await app.close(); }
});
test('same request ID is idempotent; different content is a 409 conflict', async () => {
  const app = setup();
  try {
    const input = request(app.context), a = app.runtime.submit(input), b = app.runtime.submit(structuredClone(input));
    assert.equal(a.runId, b.runId);
    assert.throws(() => app.runtime.submit({ ...input, kind: 'pest_risk' }), e => e.code === 'IDEMPOTENCY_CONFLICT');
    await app.runtime.idle(); const c = app.runtime.submit(input); assert.equal(c.runId, a.runId); assert.equal(c.status, 'succeeded');
    assert.equal(app.store.listRuns().items.length, 1);
  } finally { await app.close(); }
});
test('new event/request creates another revision and preserves old strategy', async () => {
  const app = setup();
  try { const first = await app.run('weather_window', 'event-1'); const second = await app.run('weather_window', 'event-2'); assert.equal(first.strategy.revision, 1); assert.equal(second.strategy.revision, 2); assert.notEqual(first.strategy.strategyId, second.strategy.strategyId); assert.equal(app.store.getStrategy(first.strategy.strategyId).revision, 1); } finally { await app.close(); }
});
test('immutable snapshot rejects content changes with the same ID/version', async () => {
  const app = setup();
  try { const changed = structuredClone(app.context); changed.modules.weather.observed.rainfallMm = 42; assert.throws(() => app.store.saveContext(changed), e => e.code === 'IMMUTABLE_SNAPSHOT_CONFLICT'); } finally { await app.close(); }
});
test('wrong site/target fails; no cross-site output', async () => {
  const app = setup();
  try { const submitted = app.runtime.submit({ ...request(app.context), siteId: 'wrong-site' }); await app.runtime.idle(); const r = app.store.getRun(submitted.runId).result; assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'SCOPE_MISMATCH'); } finally { await app.close(); }
});
test('context includes wrong tree fails independently of candidate', () => {
  const context = makeDemoContext({ now: NOW }); context.modules.inspection.evidence[0].treeId = 'T-0999';
  assert.throws(() => checkContext(request(context, 'surface_action'), context, NOW), e => e.code === 'SCOPE_MISMATCH');
});
test('missing modules and expired observation are explicit missing data', () => {
  const context = makeDemoContext({ now: NOW }); delete context.modules.knowledge; context.modules.weather.observed.observedAt = '2026-09-23T00:00:00Z';
  const r = checkContext(request(context), context, NOW); assert.ok(r.missing.some(d => d.module === 'knowledge')); assert.ok(r.missing.some(d => d.field === 'observed.observedAt'));
});
test('live flag cannot enable live mode; malformed requests fail immediately', async () => {
  const app = setup();
  try {
    assert.throws(() => app.runtime.submit({ ...request(app.context), executionMode: 'live' }), e => e.code === 'LIVE_MODE_DISABLED');
    assert.throws(() => app.runtime.submit({ ...request(app.context), inputSnapshot: { snapshotId: 'x', version: 0 } }), e => e.code === 'INVALID_REQUEST');
    assert.throws(() => app.runtime.submit({ ...request(app.context), approved: true }), e => e.code === 'INVALID_REQUEST');
  } finally { await app.close(); }
});
test('only needed modules reach the candidate service', async () => {
  let modules;
  const generator = { mode: 'test', modelVersion: null, async generate(args) { modules = Object.keys(args.context.modules); assert.ok(Object.isFrozen(args.context)); return new RuleGenerator().generate(args); } };
  const app = setup({ generator });
  try { await app.run(); assert.deepEqual(modules, ['weather', 'knowledge']); } finally { await app.close(); }
});
function complexContext(kind) {
  const context = makeDemoContext({ now: NOW });
  if (kind === 'weather_window' || kind === 'tapping_angle' || kind === 'pest_risk') context.modules.weather.observed.rainfallMm = 4;
  if (kind === 'growth_plan') context.modules.market.prices[1].value += 20;
  return context;
}

for (const [label, kind, mutate] of [
  ['fabricated evidence', 'weather_window', c => c.reasons[0].sourceRefs.push('made-up')],
  ['extra approval field', 'weather_window', c => { c.approvedBy = 'user'; }],
  ['out-of-range angle', 'tapping_angle', c => { c.proposal.recommendedCutSlopeDeg = 89; }],
  ['false actual parameters', 'tapping_angle', c => { c.proposal.actualCutSlopeDeg = 28; }],
  ['phantom path', 'tapping_angle', c => { c.proposal.proposedPathRef = 'imaginary-path'; }],
  ['omitted detection', 'surface_action', c => { c.proposal.findings = []; }],
  ['made-up geometric conclusion', 'surface_action', c => { c.proposal.findings[0].affectsCut = 'no'; }],
  ['excess tapping frequency', 'market_scenario', c => { c.proposal.scenarios[0].tappingsPerWeek = 7; }],
 ]) test(`independent validator rejects ${label} and publishes a labelled fallback`, async () => {
  const generator = { mode: 'test', modelVersion: 'test-model-v1', async generate(args) { const c = await new RuleGenerator().generate(args); mutate(c); return c; } };
  const app = setup({ generator, context: complexContext(kind) });
  try {
    const r = await app.run(kind);
    assert.equal(r.status, 'succeeded', JSON.stringify(r));
    assert.match(r.strategy.fallback.reasonCode, /INVALID_CANDIDATE|CANDIDATE_REJECTED/);
    assert.equal(r.strategy.fallback.reviewRequired, true);
    assert.ok(app.store.events(r.runId).some(e => e.stage === 'candidate_fallback'));
  } finally { await app.close(); }
});
test('group growth uses each tree own measurements, never distributes a batch value', async () => {
  const app = setup({ treeIds: ['T-0007', 'T-0012', 'T-0013'] });
  try {
    const r = await app.run('growth_plan'); assert.equal(r.status, 'succeeded'); assert.equal(r.strategy.proposal.predictions.length, 3);
    for (const p of r.strategy.proposal.predictions) assert.ok(p.sourceRefs.every(ref => ref.includes(p.treeId)));
  } finally { await app.close(); }
});
test('multiple measurement heights cannot be fitted as one growth series', () => {
  const c = makeDemoContext({ now: NOW }); c.modules.growth.measurements[0].measurementHeightM = 0.5;
  assert.ok(checkContext(request(c, 'growth_plan'), c, NOW).missing.some(m => m.field === 'measurementHeightM'));
});
test('transient candidate failure publishes a same-snapshot fallback without retrying', async () => {
  let count = 0;
  const generator = { mode: 'test', modelVersion: null, async generate() { count++; throw new AppError('CANDIDATE_SERVICE_UNAVAILABLE', '测试服务超时', 503); } };
  const app = setup({ generator, context: complexContext('weather_window') });
  try {
    const r = await app.run('weather_window');
    assert.equal(r.status, 'succeeded');
    assert.equal(r.strategy.fallback.reasonCode, 'CANDIDATE_SERVICE_UNAVAILABLE');
    assert.equal(count, 1);
    assert.equal(app.store.getRun(r.runId).attempt, 1);
    assert.ok(app.store.events(r.runId).some(e => e.stage === 'candidate_fallback'));
  } finally { await app.close(); }
});
test('SQLite persists result, request idempotency and unfinished-run recovery across restart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'rubber-harness-test-')), 'brain.sqlite');
  const context = makeDemoContext({ now: NOW });
  const first = setup({ dbPath: path, context }); const completed = await first.run('surface_action', 'saved');
  const orphan = first.store.submit(request(context, 'weather_window', 'interrupted'), NOW.toISOString()).run;
  first.store.start(orphan.runId, NOW.toISOString()); await first.close();
  const second = setup({ dbPath: path, context });
  try {
    second.runtime.start(); await second.runtime.idle();
    assert.deepEqual(second.store.getRun(completed.runId).result, completed);
    assert.equal(second.store.getRun(orphan.runId).status, 'succeeded');
    assert.equal(second.store.getRun(orphan.runId).attempt, 2);
    assert.ok(second.store.events(orphan.runId).some(e => e.stage === 'recovered'));
    assert.equal(second.runtime.submit(request(context, 'surface_action', 'saved')).runId, completed.runId);
  } finally { await second.close(); }
});
test('result cannot outlive input snapshot or weather evidence', async () => {
  const app = setup();
  try { const r = await app.run(); assert.ok(Date.parse(r.strategy.expiresAt) <= Date.parse(app.context.validUntil)); assert.ok(Date.parse(r.strategy.expiresAt) > +NOW); } finally { await app.close(); }
});
test('context structural schema rejects unit confusion and unknown factual fields', () => {
  const c = makeDemoContext({ now: NOW }); c.modules.market.priceUnit = 'kg_latex';
  assert.throws(() => validate(contextSchema, c));
});
