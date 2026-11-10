import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWeatherWindow, WEATHER_POLICY_VERSION } from '../src/weather-policy.js';

const provenance = (sourceId, mode = 'simulated') => ({ provenance: { sourceId, sourceClass: 'sensor_device', mode }, quality: 'valid' });
const observed = ({ rainfallMm = 0, history = [0, 0.1, 0, 0, 0, 0, 0], soil = 32, dry = 34.2 } = {}) => ({
  observationId: 'weather-test', rainfallMm, recentRainfall: history.map((rainfall, i) => ({ observationId: `rain-${i}`, observedAt: `2026-10-01T0${i}:00:00Z`, rainfallMm: rainfall, rainfallPeriodMinutes: 60, ...provenance(`rain-source-${i}`) })),
  soilMoisture: { value: soil, unit: '%', ...provenance('soil-source') },
  dryRubberContent: { value: dry, unit: '%', ...provenance('dry-rubber-source') },
});

test('weather policy permits small rain when recent rain and soil are not wet', () => {
  const result = assessWeatherWindow({ observed: observed({ rainfallMm: 0.2 }), step: { rainfallMm: 0.2, rainProbabilityPct: 30 } });
  assert.equal(result.policyVersion, WEATHER_POLICY_VERSION);
  assert.equal(result.suitability, 'suitable');
  assert.equal(result.lightRainAllowed, true);
  assert.match(result.reason, /小雨/);
});

test('weather policy defers clear windows after wet spell with low dry rubber content', () => {
  const result = assessWeatherWindow({ observed: observed({ history: [4, 3, 2, 1, 0, 0, 0], soil: 68, dry: 27.5 }), step: { rainfallMm: 0, rainProbabilityPct: 10 } });
  assert.equal(result.suitability, 'defer');
  assert.equal(result.recoveryStatus, 'wet_recovery');
  assert.match(result.reason, /干胶含量/);
  assert.equal(result.wetSpell, true);
  assert.equal(result.soilWet, true);
});

test('weather policy asks for review when wet recovery has no dry rubber assay', () => {
  const input = observed({ history: [3, 2, 1, 0, 0, 0, 0], soil: 68, dry: null });
  input.dryRubberContent = null;
  const result = assessWeatherWindow({ observed: input, step: { rainfallMm: 0, rainProbabilityPct: 10 } });
  assert.equal(result.suitability, 'review');
  assert.equal(result.dryRubberStatus, 'missing');
  assert.match(result.reason, /现场复核/);
});

test('weather policy rounds accumulated rainfall before threshold checks and explanations', () => {
  const input = observed({history:Array(50).fill(0.1),dry:null});
  const result = assessWeatherWindow({observed:input,step:{rainfallMm:0,rainProbabilityPct:10}});
  assert.equal(result.recentRainfallTotalMm,5);
  assert.equal(result.wetSpell,true);
  assert.equal(result.suitability,'suitable');
  assert.match(result.reason,/累计 5 mm/);
  assert.match(result.reason,/不单独限制排程/);
});

test('wet recovery explains only the rainfall or soil thresholds that actually triggered', () => {
  for (const dry of [null,27.5]) {
    const input = observed({history:[4,3,2,1],soil:38.1,dry});
    const result = assessWeatherWindow({observed:input,step:{rainfallMm:0,rainProbabilityPct:10}});
    assert.equal(result.wetSpell,true);
    assert.equal(result.soilWet,false);
    assert.match(result.reason,/降雨累计 10 mm 达到巡查提示阈值 5 mm/);
    assert.doesNotMatch(result.reason,/土壤水分/);
  }
});


test('past rainfall alone does not turn a dry or light-rain hour into a full-week hold', () => {
  for (const rainfallMm of [0, 0.2]) {
    const result=assessWeatherWindow({observed:observed({history:[10.3],soil:38.3,dry:null,rainfallMm:0}),step:{rainfallMm,rainProbabilityPct:24}});
    assert.equal(result.suitability,'suitable');
    assert.equal(result.lightRainAllowed,rainfallMm>0);
    assert.match(result.reason,/现场巡查提示/);
    assert.match(result.reason,/不单独限制排程/);
  }
});
test('current wet soil and measured low dry content remain actionable after rain',()=>{
  const step={rainfallMm:0,rainProbabilityPct:10};
  assert.equal(assessWeatherWindow({observed:observed({history:[10.3],soil:70,dry:null}),step}).suitability,'review');
  assert.equal(assessWeatherWindow({observed:observed({history:[10.3],soil:38.3,dry:27}),step}).suitability,'defer');
});
