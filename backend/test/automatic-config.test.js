import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../config/automatic.json', import.meta.url), 'utf8'));
const treeIds = new Set(Array.from({ length: 200 }, (_, i) => `T-${String(i + 1).padStart(4, '0')}`));

test('default automatic configuration covers every tree-level dimension for all 200 trees', () => {
  assert.equal(config.enabled, true);
  assert.equal(config.jobs.length, 261);
  assert.equal(config.maxRunsPer24Hours, config.jobs.length * 3, 'daily budget allows three complete park passes');
  assert.equal(config.maxModelRequestsPer24Hours, config.maxRunsPer24Hours * config.maxRequestsPerRun);
  assert.equal(config.maxRequestsPerRun, 2, 'one candidate plus at most one repair');
  for (const kind of ['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk']) {
    const jobs = config.jobs.filter(job => job.kind === kind);
    const covered = new Set(jobs.flatMap(job => job.treeIds));
    assert.deepEqual(covered, treeIds, `${kind} must cover all 200 trees`);
    assert.ok(jobs.every(job => job.treeIds.length <= 10), `${kind} jobs must stay bounded for model payloads`);
  }
  assert.equal(config.jobs.filter(job => job.kind === 'industry_brief').length, 1);
});
