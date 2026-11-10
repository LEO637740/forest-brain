import { round } from './util.js';

// This is a transparent demo prior, not a fitted agronomy model.  Keeping the
// calculation in one pure module makes each contribution testable and lets a
// future trial-data adapter replace the priors without changing the contract.
export const ANGLE_POLICY_VERSION = 'demo-angle-multifactor-v1';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const one = value => Math.round(value * 10) / 10;

function ageYears(plantedAt, asOf) {
  if (!plantedAt || !asOf) return null;
  const planted = Date.parse(plantedAt), observed = Date.parse(asOf);
  if (!Number.isFinite(planted) || !Number.isFinite(observed) || observed < planted) return null;
  return one((observed - planted) / (365.2425 * 86400000));
}

function modeOf(value) {
  return value?.provenance?.mode ?? 'unknown';
}

function sourceOf(value) {
  return value?.provenance?.sourceId ?? null;
}

function factor({ key, label, value, unit, deltaDeg, sourceId, provenanceMode, note }) {
  return {
    key, label, inputValue: value === null || value === undefined ? null : (typeof value === 'number' ? one(value) : value), unit,
    deltaDeg: one(deltaDeg), sourceId, provenanceMode, note,
  };
}

function varietyPrior(variety) {
  const text = String(variety ?? '');
  if (/热研\s*7[-－]33[-－]97/.test(text)) return 0.4;
  if (/热研\s*7[-－]20[-－]59/.test(text)) return 0.1;
  if (/PR107/i.test(text)) return -0.3;
  return 0;
}

/**
 * Produce a bounded, explainable candidate for one tree/panel pair.
 * Every non-zero adjustment is attached to an input and its provenance.  The
 * numbers are deliberately conservative demo priors until paired-angle trial
 * records are available; they must never be presented as a proven optimum.
 */
export function calculateAngleCandidate({ tree, panel, weather, asOf, constraints }) {
  const baselineDeg = finite(panel?.plannedCutSlopeDeg) ? panel.plannedCutSlopeDeg : null;
  const humidity = weather?.relativeHumidityPct;
  const soil = weather?.soilMoisture;
  const rain = (weather?.recentRainfall ?? []).filter(row => row?.quality === 'valid' && finite(row.rainfallMm));
  const rainTotal = rain.reduce((sum, row) => sum + row.rainfallMm, 0);
  const viscosity = panel?.latexViscosity;
  const dryRubber = panel?.dryRubberContent;
  const age = ageYears(tree?.plantedAt, asOf);
  const factors = [];

  factors.push(factor({
    key: 'variety_prior', label: '树种先验', value: tree?.variety?.trim() ? tree.variety : null, unit: 'variety',
    deltaDeg: varietyPrior(tree?.variety), sourceId: sourceOf(tree?.fieldRecord??tree), provenanceMode: modeOf(tree?.fieldRecord??tree),
    note: '演示先验；没有试验数据时不代表该树种的最佳坡角',
  }));
  factors.push(factor({
    key: 'tree_age', label: '树龄', value: age, unit: '年',
    deltaDeg: finite(age) ? clamp((age - 10) * -0.12, -0.8, 0.8) : 0,
    sourceId: sourceOf(tree), provenanceMode: modeOf(tree),
    note: finite(age) ? '由种植日期和快照时间计算；演示先验' : '种植日期缺失，未参与计算',
  }));
  factors.push(factor({
    key: 'humidity', label: '相对湿度', value: finite(humidity) ? humidity : null, unit: '%',
    deltaDeg: finite(humidity) ? clamp((humidity - 70) * -0.045, -1.2, 0.9) : 0,
    sourceId: sourceOf(weather), provenanceMode: modeOf(weather),
    note: '软件演示响应，不是已验证农艺阈值',
  }));
  factors.push(factor({
    key: 'soil_moisture', label: '土壤水分', value: measurementValue(soil), unit: soil?.unit ?? '%',
    deltaDeg: finite(measurementValue(soil)) ? clamp((measurementValue(soil) - 45) * -0.015, -0.6, 0.7) : 0,
    sourceId: sourceOf(soil) ?? sourceOf(weather), provenanceMode: modeOf(soil) === 'unknown' ? modeOf(weather) : modeOf(soil),
    note: finite(measurementValue(soil)) ? '演示先验；需按土壤类型和现场试验校准' : '土壤水分缺失，未参与计算',
  }));
  factors.push(factor({
    key: 'recent_rainfall', label: '近 7 日降雨累计', value: rain.length ? rainTotal : null, unit: 'mm',
    deltaDeg: rain.length ? clamp((rainTotal - 2) * -0.025, -0.6, 0.05) : 0,
    sourceId: rain[0]?.provenance?.sourceId ?? sourceOf(weather), provenanceMode: modeOf(rain[0]) === 'unknown' ? modeOf(weather) : modeOf(rain[0]),
    note: rain.length ? '演示先验；降雨只作为候选复核因素' : '降雨历史缺失，未参与计算',
  }));
  factors.push(factor({
    key: 'latex_viscosity', label: '胶乳黏度', value: measurementValue(viscosity), unit: viscosity?.unit ?? 'mPa·s',
    deltaDeg: finite(measurementValue(viscosity)) ? clamp((measurementValue(viscosity) - 420) * 0.006, -0.8, 0.8) : 0,
    sourceId: sourceOf(viscosity), provenanceMode: modeOf(viscosity),
    note: finite(measurementValue(viscosity)) ? '演示先验；黏度—坡角响应尚未通过配对试验' : '胶乳黏度缺失，未参与计算',
  }));
  factors.push(factor({
    key: 'dry_rubber_content', label: '干胶含量', value: measurementValue(dryRubber), unit: dryRubber?.unit ?? '%',
    deltaDeg: finite(measurementValue(dryRubber)) ? clamp((measurementValue(dryRubber) - 33) * 0.12, -0.6, 0.6) : 0,
    sourceId: sourceOf(dryRubber), provenanceMode: modeOf(dryRubber),
    note: finite(measurementValue(dryRubber)) ? '演示先验；不代表已证明增产或最优角度' : '干胶含量缺失，未参与计算',
  }));

  const adjustmentDeg = one(factors.reduce((sum, item) => sum + item.deltaDeg, 0));
  const unclamped = baselineDeg === null ? null : one(baselineDeg + adjustmentDeg);
  const recommendedCutSlopeDeg = unclamped === null ? null : one(clamp(unclamped, constraints.minCutSlopeDeg, constraints.maxCutSlopeDeg));
  const available = factors.filter(item => item.inputValue !== null).length;
  const completenessPct = one(available / factors.length * 100);
  const clamped = recommendedCutSlopeDeg !== null && recommendedCutSlopeDeg !== unclamped;
  return {
    version: ANGLE_POLICY_VERSION,
    baselineDeg,
    unclampedCandidateDeg: unclamped,
    adjustmentDeg,
    recommendedCutSlopeDeg,
    clamped,
    factors,
    dataCompletenessPct: completenessPct,
    confidence: completenessPct >= 85 && factors.every(item => item.provenanceMode === 'measured') ? 'medium' : 'low',
    optimizationStatus: 'demo_heuristic',
    validity: 'evidence_insufficient',
    experimentPlan: [
      '按树种、树龄和候选坡角建立配对试验组，记录流胶量、干胶量和树皮损耗',
      '把土壤类型、降雨后间隔和设备回执与同一割面绑定，复核候选角的重复性',
      '完成跨季节验证并报告误差区间后，才可把演示先验升级为已验证模型',
    ],
  };
}

function measurementValue(value) {
  return value && typeof value === 'object' ? value.value : value;
}
