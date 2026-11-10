import test from 'node:test';
import assert from 'node:assert/strict';
import { makeParkContext } from '../src/adapters/park-demo.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { checkCandidate } from '../src/validation.js';
import { deriveMarketFrequencyPolicy, WEEKLY_TAPPINGS } from '../src/market-policy.js';

const now = new Date('2026-10-08T00:00:00.000Z');
const request = c => ({ kind:'market_scenario', siteId:c.siteId, targetSnapshotId:c.targetSnapshot.targetSnapshotId, inputSnapshot:{snapshotId:c.snapshotId,version:c.version}, executionMode:'simulation' });

test('market frequency follows demand band while respecting health and care constraints', async () => {
  const c = makeParkContext({ treeIds:['T-0001','T-0002','T-0012','T-0031'], now });
  c.modules.market.demand.value = 80;
  const low = deriveMarketFrequencyPolicy({ market:c.modules.market, trees:c.modules.trees, weather:c.modules.weather, health:c.modules.health, maxTappingsPerWeek:c.constraints.maxTappingsPerWeek });
  assert.equal(low.demand.band, 'low');
  assert.equal(low.targetFrequencyPerWeek, 1);
  assert.equal(low.eligible.length, 2);
  c.modules.market.demand.value = 125;
  c.modules.weather.observed.rainfallMm = 4;
  const highWet = deriveMarketFrequencyPolicy({ market:c.modules.market, trees:c.modules.trees, weather:c.modules.weather, health:c.modules.health, maxTappingsPerWeek:c.constraints.maxTappingsPerWeek });
  assert.equal(highWet.demand.band, 'high');
  assert.equal(highWet.targetFrequencyPerWeek, 1, '雨天不能因高需求突破天气养护约束');
  c.modules.weather.observed.rainfallMm = 0;
  const high = deriveMarketFrequencyPolicy({ market:c.modules.market, trees:c.modules.trees, weather:c.modules.weather, health:c.modules.health, maxTappingsPerWeek:c.constraints.maxTappingsPerWeek });
  assert.equal(high.targetFrequencyPerWeek, 3, '高需求在养护上限内增产到每周 3 次');
  c.modules.market.demand.value = 100;
  const balanced = deriveMarketFrequencyPolicy({ market:c.modules.market, trees:c.modules.trees, weather:c.modules.weather, health:c.modules.health, maxTappingsPerWeek:c.constraints.maxTappingsPerWeek });
  assert.equal(balanced.demand.band, 'balanced');
  assert.equal(balanced.targetFrequencyPerWeek, WEEKLY_TAPPINGS.hold, '需求平衡时与全园"维持"同为每周 2 次');
  assert.equal(WEEKLY_TAPPINGS.hold, 2);
});

test('market candidate records demand provenance, eligible trees and zero-frequency option', async () => {
  const c = makeParkContext({ treeIds:['T-0001','T-0002'], now });
  const p = await new RuleGenerator().generate({ kind:'market_scenario', context:c, now });
  assert.doesNotThrow(() => checkCandidate('market_scenario', p, c, now));
  assert.equal(p.proposal.demandSignal.provenanceMode, 'simulated');
  assert.ok(p.proposal.scenarios.some(s => s.tappingsPerWeek === 0));
  assert.equal(p.proposal.eligibleTreeCount, 2);
});

