import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { AutomaticRunner } from '../src/automatic.js';
import { createMhApp } from '../src/mh-app.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { makeMixedContext } from '../src/adapters/public-context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { AppError } from '../src/errors.js';

const NOW = new Date('2026-10-07T02:00:00Z'), HOUR = 3600000;
const config = {
  enabled: true, intervalMinutes: 60, maxRunsPer24Hours: 6,
  maxModelRequestsPer24Hours: 12, maxRequestsPerRun: 2, maxConsecutiveFailures: 2,
  jobs: [{ id: 'tree', kind: 'surface_action', treeIds: ['T-0012'] }],
};
const sources = () => ({
  async refresh() {},
  status: () => ({ location: { confirmed: false }, sources: [] }),
});
const request = (context, id) => ({
  requestId: id, kind: 'surface_action', generatorMode: 'configured',
  siteId: context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId,
  inputSnapshot: { snapshotId: context.snapshotId, version: context.version },
  executionMode: 'simulation',
});
const model = () => ({
  mode: 'llm', modelVersion: 'offline-fault-recovery-fixture', calls: 0,
  describe: () => ({ configured: true }),
  async generate(args) {
    args.onEvent('llm_request', { attempt: 1 });
    this.calls++;
    const candidate = await new RuleGenerator().generate(args);
    args.onEvent('llm_completed', { provider: 'offline-fixture', model: this.modelVersion });
    return candidate;
  },
});

function seedRunning(store, id) {
  const context = makeMixedContext({ treeIds: ['T-0012'], service: sources(), now: NOW });
  store.saveContext(context);
  const { run } = store.submit(request(context, id), NOW.toISOString(), {
    ...config, jobId: 'tree', cycleKey: id,
  });
  store.start(run.runId, NOW.toISOString());
  store.reserveAutomaticRequest(run.runId, NOW.toISOString());
  return run;
}

function recordFallback(store, runId, reasonCode) {
  store.stage(runId, 'candidate_fallback', NOW.toISOString(), {
    reasonCode, message: 'persisted offline provider fault', generator: 'demo_rules',
  });
}

function reopen(path, generator) {
  return createMhApp({
    dbPath: path, generator, automaticConfig: config, enableAutomatic: true,
    publicDataService: sources(), clock: () => NOW,
  });
}

for (const reasonCode of ['LLM_ACCOUNT_UNAVAILABLE', 'LLM_NOT_CONFIGURED', 'LLM_REQUEST_REJECTED']) {
  test(`automatic recovery: an uncommitted ${reasonCode} fallback blocks paid recovery and is counted once`, async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'rubber-pending-fault-')), 'test.sqlite');
    const before = new Store(path);
    const run = seedRunning(before, 'crash-during-rule-fallback');
    recordFallback(before, run.runId, reasonCode);
    assert.equal(before.getRun(run.runId).status, 'running');
    assert.equal(before.getRun(run.runId).result, null);
    before.close();

    for (let restart = 0; restart < 2; restart++) {
      const generator = model(), app = reopen(path, generator);
      try {
        await app.runtime.idle();
        await app.automatic.tick();
        assert.equal(generator.calls, 0, 'known account/configuration faults require explicit recovery');
        assert.equal(app.automatic.status().status, 'error_paused');
        assert.equal(app.automatic.status().circuitReason.code, reasonCode);
        assert.equal(app.automatic.status().consecutiveFailures, 1, 'reopening cannot count the old fault again');
        assert.equal(app.automatic.status().budget.modelRequests, 1, 'the original reservation remains consumed');
      } finally {
        await app.close();
      }
    }
  });
}

test('automatic recovery: only the current interrupted attempt contributes its known provider fault', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'rubber-current-attempt-fault-')), 'test.sqlite');
  const before = new Store(path), run = seedRunning(before, 'current-attempt-fault');
  recordFallback(before, run.runId, 'CANDIDATE_SERVICE_UNAVAILABLE');
  before.recover(NOW.toISOString());
  before.start(run.runId, NOW.toISOString());
  before.reserveAutomaticRequest(run.runId, NOW.toISOString());
  recordFallback(before, run.runId, 'LLM_ACCOUNT_UNAVAILABLE');
  before.close();

  const generator = model(), app = reopen(path, generator);
  try {
    await app.runtime.idle();
    await app.automatic.tick();
    assert.equal(generator.calls, 0);
    assert.equal(app.automatic.status().circuitReason.code, 'LLM_ACCOUNT_UNAVAILABLE');
    assert.equal(app.automatic.status().consecutiveFailures, 1, 'the earlier recovered attempt is not replayed');
    assert.equal(app.automatic.status().budget.modelRequests, 2);
  } finally {
    await app.close();
  }
});

test('automatic recovery: a fault before a previous recovered boundary cannot fault the current healthy attempt', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'rubber-previous-attempt-fault-')), 'test.sqlite');
  const before = new Store(path), run = seedRunning(before, 'previous-attempt-fault');
  recordFallback(before, run.runId, 'LLM_ACCOUNT_UNAVAILABLE');
  before.recover(NOW.toISOString());
  // The saved recovery boundary represents a later attempt, with the old
  // account problem already explicitly cleared before this interrupted start.
  before.saveAutomaticState({ configuredEnabled: true, paused: false, circuitReason: null, consecutiveFailures: 0 });
  before.start(run.runId, NOW.toISOString());
  before.close();

  const generator = model(), app = reopen(path, generator);
  try {
    await app.runtime.idle();
    assert.equal(generator.calls, 1);
    assert.equal(app.store.getRun(run.runId).status, 'succeeded');
    assert.equal(app.store.getRun(run.runId).result.strategy.fallback, undefined);
    assert.equal(app.automatic.status().circuitReason, null);
    assert.equal(app.automatic.status().consecutiveFailures, 0);
    assert.equal(app.automatic.status().budget.modelRequests, 2);
  } finally {
    await app.close();
  }
});

test('automatic: a successful provider response whose input expires breaks consecutive provider failures', async () => {
  let now = new Date(NOW);
  const store = new Store(), generator = model();
  generator.generate = async function (args) {
    args.onEvent('llm_request', { attempt: 1 });
    this.calls++;
    if (this.calls !== 2) throw new AppError('CANDIDATE_SERVICE_UNAVAILABLE', 'offline transient provider fault', 503);
    const candidate = await new RuleGenerator().generate(args);
    args.validateCandidate(candidate);
    args.onEvent('llm_completed', { provider: 'offline-fixture', model: this.modelVersion });
    now = new Date(+now + 3 * HOUR);
    return candidate;
  };
  const runtime = new HarnessRuntime({ store, contextProvider: new LocalContextProvider(store), generator, clock: () => now });
  const auto = new AutomaticRunner({ store, runtime, config, service: sources(), clock: () => now });
  runtime.start();
  try {
    await auto.tick();
    assert.equal(generator.calls, 1);
    assert.equal(auto.status().consecutiveFailures, 1);
    assert.equal(auto.status().circuitReason, undefined);

    now = new Date(+now + HOUR);
    await auto.tick();
    const expired = store.automaticRuns()[0];
    assert.equal(generator.calls, 2);
    assert.equal(expired.status, 'needs_data');
    assert.ok(expired.result.missingData.some(item => item.field === 'validUntil'));
    assert.equal(expired.result.strategy, undefined);
    assert.ok(store.events(expired.runId).some(event => event.stage === 'llm_completed'));
    assert.ok(!store.events(expired.runId).some(event => event.stage === 'candidate_fallback'));
    assert.equal(auto.status().consecutiveFailures, 0, 'valid provider output counts as recovery even when data expires');

    now = new Date(+now + HOUR);
    await auto.tick();
    assert.equal(generator.calls, 3);
    assert.equal(auto.status().consecutiveFailures, 1);
    assert.equal(auto.status().circuitReason, undefined, 'the two transient faults were not consecutive');
    assert.equal(auto.status().budget.modelRequests, 3);
  } finally {
    await auto.stop();
    await runtime.stop();
    store.close();
  }
});
