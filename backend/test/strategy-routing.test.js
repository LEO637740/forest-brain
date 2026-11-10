import test from 'node:test';
import assert from 'node:assert/strict';
import { makeParkContext, scenarioContext } from '../src/adapters/park-demo.js';
import { classifyStrategyRoute } from '../src/strategy-routing.js';

const now = new Date('2026-10-08T00:00:00.000Z');

test('normal tree uses the small-brain rule path', () => {
  const result = classifyStrategyRoute(makeParkContext({ treeIds: ['T-0001'], now }), { treeId: 'T-0001', kind: 'tapping_angle' });
  assert.equal(result.status, 'ready');
  assert.equal(result.executor, 'small_brain');
  assert.equal(result.recommendedGenerator, 'demo_rules');
  assert.deepEqual(result.triggers, []);
});

test('tree findings are escalated to the big-brain path', () => {
  const result = classifyStrategyRoute(makeParkContext({ treeIds: ['T-0012'], now }), { treeId: 'T-0012', kind: 'tapping_angle' });
  assert.equal(result.status, 'needs_big_brain');
  assert.equal(result.executor, 'big_brain');
  assert.equal(result.recommendedGenerator, 'configured');
  assert.ok(result.triggers.includes('inspection_finding'));
});

test('rain is a cross-module trigger for a tree strategy', () => {
  const scenario = { id: 'rain', treeIds: ['T-0001'], phase: 'rain' };
  const result = classifyStrategyRoute(scenarioContext(scenario, now), { treeId: 'T-0001', kind: 'tapping_angle' });
  assert.equal(result.status, 'needs_big_brain');
  assert.ok(result.triggers.includes('rain_observed'));
  assert.ok(result.triggers.includes('rain_forecast'));
});

test('a material market move escalates the tree strategy', () => {
  const context = makeParkContext({ treeIds: ['T-0001'], now });
  context.modules.market.prices.at(-1).value = context.modules.market.prices[0].value * 1.12;
  const result = classifyStrategyRoute(context, { treeId: 'T-0001', kind: 'growth_plan' });
  assert.equal(result.status, 'needs_big_brain');
  assert.ok(result.triggers.includes('market_change'));
});

test('resting and missing trees are blocked before model generation', () => {
  const resting = classifyStrategyRoute(makeParkContext({ treeIds: ['T-0031'], now }), { treeId: 'T-0031', kind: 'tapping_angle' });
  const missing = classifyStrategyRoute(makeParkContext({ treeIds: ['T-0042'], now }), { treeId: 'T-0042', kind: 'tapping_angle' });
  assert.equal(resting.status, 'blocked');
  assert.ok(resting.blockers.includes('tapping_status'));
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.blockers.includes('circumference'));
});

test('unregistered surface evidence asks for capture before strategy output', () => {
  const context = makeParkContext({ treeIds: ['T-0006'], now });
  const result = classifyStrategyRoute(context, { treeId: 'T-0006', kind: 'surface_action' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.includes('geometry_registration'));
});
