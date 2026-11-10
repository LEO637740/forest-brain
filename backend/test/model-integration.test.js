import test from 'node:test';
import assert from 'node:assert/strict';
import { mhGenerator } from '../src/mh-generator.js';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';

test('MH default enables configured local LLM, explicit rules do not load model settings', () => {
  let loaded = 0;
  const generator = mhGenerator({env: {}, loadEnv: () => loaded++});
  assert.equal(loaded, 1);
  assert.equal(generator.mode, 'llm');
  assert.equal(generator.describe().provider, 'ollama');
  assert.equal(generator.describe().configured, true);
  assert.equal(generator.describe().outputMode, 'json_schema');
  assert.equal(mhGenerator({rules: true, loadEnv: () => {throw Error('must not load');}}).mode, 'demo_rules');
});

async function setup(generator, clock = () => new Date()) {
  const app = createApp({dbPath: ':memory:', generator, clock});
  await new Promise((resolve, reject) => {app.server.once('error', reject);app.server.listen(0, '127.0.0.1', resolve);});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (preparationId, generatorMode, preserveConfigured = false) => {
    const response = await fetch(base + '/api/demo/trees/prepare', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({preparationId, treeIds: ['T-0012'], kind: 'surface_action', dataMode: 'mixed_demo', generatorMode, preserveConfigured})});
    assert.equal(response.status, 202);
    const result = await response.json();
    await app.runtime.idle();
    return result;
  };
  const view = async () => (await fetch(base + '/api/demo/trees/T-0012/view?kind=surface_action&dataMode=mixed_demo')).json();
  return {app, post, view};
}

test('complex configured request on a rule-only server publishes an explicitly labelled fallback', async () => {
  const {app, post, view} = await setup(new RuleGenerator());
  try {
    await post('configured-on-rules', 'configured');
    const result = await view();
    assert.equal(result.strategyStatus, 'available');
    assert.equal(result.strategy.fallback.reasonCode, 'LLM_NOT_CONFIGURED');
    assert.equal(result.strategy.fallback.reviewRequired, true);
    assert.equal(result.strategy.generationMetadata.provider, 'harness-fallback');
    assert.equal(result.strategy.modelVersion, null);
    assert.ok(app.store.events(result.run.runId).some(e=>e.stage==='candidate_fallback'&&e.data.reasonCode==='LLM_NOT_CONFIGURED'));
  } finally {await app.close();}
});

test('scheduled rule refresh preserves successful or expired model bindings and replaces failed ones without erasing their audit', async () => {
  let now = new Date(), calls = 0, fail = false;
  const model = {mode: 'llm', modelVersion: 'model-test', async generate(args) {calls++;if (fail) throw Error('fixture model failure');return new RuleGenerator().generate(args);}};
  const {app, post, view} = await setup(model, () => now);
  try {
    const first = await post('model-tree', 'configured');
    assert.equal((await view()).strategyStatus, 'available');
    assert.equal((await post('refresh-model-tree', 'demo_rules', true)).items.length, 0);
    assert.equal((await view()).run.runId, first.items[0].runId);
    now = new Date(+now + 2 * 3600000);
    assert.equal((await view()).strategyStatus, 'expired');
    assert.equal((await post('refresh-expired-model-tree', 'demo_rules', true)).items.length, 0);
    assert.equal((await view()).run.generatorMode, 'configured');
    fail = true;
    const failed = await post('failed-model-tree', 'configured');
    assert.equal((await view()).strategyStatus, 'failed');
    const refreshed=await post('refresh-failed-model-tree', 'demo_rules', true);
    assert.equal(refreshed.items.length, 1);
    assert.equal((await view()).strategyStatus, 'available');
    assert.equal((await view()).run.runId, refreshed.items[0].runId);
    assert.equal(app.store.getRun(failed.items[0].runId).result.error.code, 'INTERNAL_ERROR');
    assert.equal(calls, 2);
  } finally {await app.close();}
});
