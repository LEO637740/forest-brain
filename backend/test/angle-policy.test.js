import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAngleCandidate } from '../src/angle-policy.js';
import { makeParkContext } from '../src/adapters/park-demo.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { checkCandidate, projectContext } from '../src/validation.js';

const now = new Date('2026-10-08T02:00:00.000Z');

function inputs() {
  const context = makeParkContext({ treeIds: ['T-0001'], now });
  return {
    context,
    tree: context.modules.trees[0],
    panel: context.modules.tapping.panels[0],
    weather: context.modules.weather.observed,
    constraints: context.constraints,
  };
}

test('angle policy uses each available factor and exposes bounded contributions', () => {
  const base = inputs();
  const value = calculateAngleCandidate({ ...base, asOf: base.context.asOf });
  assert.equal(value.factors.length, 7);
  assert.deepEqual(value.factors.map(item => item.key), ['variety_prior', 'tree_age', 'humidity', 'soil_moisture', 'recent_rainfall', 'latex_viscosity', 'dry_rubber_content']);
  assert.equal(value.optimizationStatus, 'demo_heuristic');
  assert.equal(value.validity, 'evidence_insufficient');
  assert.equal(value.confidence, 'low');
  assert.equal(value.recommendedCutSlopeDeg, 26.3);
  assert.equal(value.adjustmentDeg, -0.7);
  assert.equal(value.factors.reduce((sum, item) => sum + item.deltaDeg, 0), value.adjustmentDeg);
});

test('changing tree, weather or assay input changes the candidate instead of only humidity', () => {
  const base = inputs();
  const original = calculateAngleCandidate({ ...base, asOf: base.context.asOf });
  const changes = [
    ['variety', { tree: { ...base.tree, variety: 'PR107（模拟）' } }],
    ['age', { tree: { ...base.tree, plantedAt: '2000-06-15' } }],
    ['soil', { weather: { ...base.weather, soilMoisture: { ...base.weather.soilMoisture, value: 80 } } }],
    ['rain', { weather: { ...base.weather, recentRainfall: base.weather.recentRainfall.map(row => ({ ...row, rainfallMm: row.rainfallMm + 5 })) } }],
    ['viscosity', { panel: { ...base.panel, latexViscosity: { ...base.panel.latexViscosity, value: 520 } } }],
    ['dry rubber', { panel: { ...base.panel, dryRubberContent: { ...base.panel.dryRubberContent, value: 38 } } }],
  ];
  for (const [label, change] of changes) {
    const candidate = calculateAngleCandidate({ ...base, ...change, asOf: base.context.asOf });
    assert.notEqual(candidate.recommendedCutSlopeDeg, original.recommendedCutSlopeDeg, `${label} should affect the candidate`);
  }
  const wet = calculateAngleCandidate({ ...base, weather: { ...base.weather, relativeHumidityPct: 91 }, asOf: base.context.asOf });
  assert.notEqual(wet.recommendedCutSlopeDeg, original.recommendedCutSlopeDeg);
});

test('missing rain and assay data remain missing and lower completeness', () => {
  const base = inputs();
  const candidate = calculateAngleCandidate({
    ...base,
    panel: { ...base.panel, latexViscosity: null, dryRubberContent: null },
    weather: { ...base.weather, recentRainfall: [] },
    asOf: base.context.asOf,
  });
  assert.equal(candidate.dataCompletenessPct, 57.1);
  assert.equal(candidate.factors.find(item => item.key === 'recent_rainfall').inputValue, null);
  assert.equal(candidate.factors.find(item => item.key === 'latex_viscosity').inputValue, null);
  assert.equal(candidate.confidence, 'low');
});

test('rule output carries the angle ledger and validator rejects a mismatched recommendation', async () => {
  const context = projectContext(makeParkContext({ treeIds: ['T-0001'], now }), 'tapping_angle');
  const candidate = await new RuleGenerator().generate({ kind: 'tapping_angle', context, now });
  assert.doesNotThrow(() => checkCandidate('tapping_angle', candidate, context, now));
  const bad = structuredClone(candidate);
  bad.proposal.recommendedCutSlopeDeg = bad.proposal.recommendedCutSlopeDeg + 1;
  assert.throws(() => checkCandidate('tapping_angle', bad, context, now), error => error.code === 'CANDIDATE_REJECTED');
});
