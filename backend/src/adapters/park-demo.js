import { makeDemoContext } from './context.js';
import { digest, iso, round } from '../util.js';
import { contextSchema } from '../contracts.js';
import { validate } from '../schema.js';
import { parks } from '../../../shared/parkCatalog.ts';

export const TREE_IDS = Array.from({ length: 200 }, (_, i) => `T-${String(i + 1).padStart(4, '0')}`);
// Every simulated park owns an independent tree register.  Tree IDs are kept
// stable within a park so existing Hainan links remain valid; the site scope
// on the context and API request prevents the same T-0001 from crossing parks.
export const PARK_SITES = Object.freeze(Object.fromEntries(Object.values(parks).map(park => [park.siteId, {...park, sourceSuffix: park.key}])));
const SITE_ALIASES = Object.freeze({ ...Object.fromEntries(Object.values(parks).map(park => [park.key, park.siteId])), hn: 'demo-hainan', xishuangbanna: 'demo-xsbn', xi_an: 'demo-xian' });
export function normalizeSiteId(value = 'demo-hainan') {
  const raw = String(value || 'demo-hainan').trim().toLowerCase();
  const siteId = SITE_ALIASES[raw] ?? raw;
  if (!PARK_SITES[siteId]) throw new Error(`Unknown demo park site: ${value}`);
  return siteId;
}
export function parkSite(value = 'demo-hainan') { return PARK_SITES[normalizeSiteId(value)]; }
export const PROFILES = {
  normal: '正常对照', scar: '割线伤痕', lesion: '疑似病斑', nodule: '疑似结节', bird_dropping: '鸟粪附着', mud: '泥巴附着', unregistered: '需要补拍', resting: '休割养护', missing: '尺寸缺失',
};
// Deliberate exception cases are separate from the normal production demo.
// These IDs are local to each park; consumers must keep the current site scope.
export const DEMO_EXCEPTION_CASES = Object.freeze([
  ['T-0004', 'scar'], ['T-0005', 'lesion'], ['T-0006', 'unregistered'],
  ['T-0012', 'scar'], ['T-0018', 'nodule'], ['T-0027', 'bird_dropping'],
  ['T-0031', 'resting'], ['T-0038', 'mud'], ['T-0042', 'missing'],
].map(([treeId, profile]) => Object.freeze({treeId, profile, label: PROFILES[profile]})));
const demoExceptionProfiles = new Map(DEMO_EXCEPTION_CASES.map(item => [item.treeId, item.profile]));
export function profileOf(treeId) {
  return demoExceptionProfiles.get(treeId) ?? 'normal';
}

// Health observations are synthetic, but they should still look like a
// plausible field sample instead of putting exactly the same five trees in
// every block.  Keep the seed deterministic so a refresh does not silently
// change the demo, while deriving it from both the park and tree number so
// the parks have different spatial patterns.
const healthHash = (siteKey, treeNumber, checkpoint) => {
  let value = 2166136261;
  for (const char of `${siteKey}:${treeNumber}:${checkpoint}`) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value >>> 0;
};
const healthSymptom = (siteKey, treeNumber, checkpoint) => {
  const profile = profileOf(`T-${String(treeNumber).padStart(4, '0')}`);
  const treeHash = healthHash(siteKey, treeNumber, 99);
  const historyHash = healthHash(siteKey, treeNumber, 98);
  const symptomHash = healthHash(siteKey, treeNumber, 97);
  // Keep the two named comparison trees in the meeting demo stable, while
  // spreading additional observations across rows and parks.
  const canonical = treeNumber === 5 || treeNumber === 15;
  const block = Math.floor((treeNumber - 1) / 50);
  const blockEffect = (healthHash(siteKey, block, 96) % 9) - 4;
  const sitePressure = { tropical: 13, tropical_highland: 17, subtropical: 12, temperate_trial: 9 }[parks[siteKey].climate];
  const profileBoost = profile === 'lesion' ? 5 : profile === 'nodule' ? 3 : 0;
  const threshold = sitePressure + profileBoost + blockEffect;
  if (!canonical && treeHash % 100 >= threshold) return [];
  const codes = ['leaf_spot', 'bark_lesion', 'mite_trace', 'leaf_wilt'];
  const symptoms = [codes[symptomHash % codes.length]];
  // A second symptom is uncommon and makes the risk score visibly different
  // without implying a confirmed diagnosis.
  if (symptomHash % 10 >= 8) symptoms.push(codes[(symptomHash + 2) % codes.length]);
  // Checkpoint order is [29 days ago, 14 days ago, today].  Correlated
  // histories are easier to explain than three independent coin flips:
  // historical, persistent, or recent-onset observations.
  const history = historyHash % 10 < 4 ? 'recent' : historyHash % 10 < 7 ? 'persistent' : 'historical';
  if (history === 'historical') return checkpoint === 0 ? symptoms : [];
  // A recent-onset signal only appears at the current checkpoint. This makes
  // the trend rule distinguish new findings from persistent ones.
  if (history === 'recent') return checkpoint === 2 ? symptoms : [];
  return symptoms;
};

// Every value below is intentionally marked as simulated and carries its own
// source id.  This lets the UI show the input as a demo fixture and keeps a
// future sensor/assay adapter from being mistaken for a measured value.
const simulatedMeasurement = (value, unit, sourceId, quality = value === null ? 'missing' : 'valid') => ({
  value, unit,
  provenance: { sourceClass: 'sensor_device', sourceId, mode: 'simulated' },
  quality,
});
const simulatedRain = (observationId, observedAt, rainfallMm) => ({
  observationId, observedAt, rainfallMm, rainfallPeriodMinutes: 60,
  provenance: { sourceClass: 'sensor_device', sourceId: 'demo-rain-gauge-history', mode: 'simulated' },
  quality: rainfallMm === null ? 'missing' : 'valid',
});

// A separate richer fixture set. Existing minimal contract examples remain reproducible.
export function makeParkContext({ treeIds = TREE_IDS, now = new Date(), phase = 'morning', variant = 'normal', siteId = 'demo-hainan', site = null } = {}) {
  const siteConfig = parkSite(site ?? siteId);
  const c = makeDemoContext({ treeIds, now });
  const m = c.modules;
  const stamp = digest({ asOf: c.asOf, phase, siteId: siteConfig.siteId }).slice(0, 12);
  c.siteId = siteConfig.siteId;
  c.targetSnapshot.siteId = siteConfig.siteId;
  // Target membership IDs are globally stored by the harness; include the
  // park key so T-0001 in separate parks cannot collide in SQLite.
  c.targetSnapshot.targetSnapshotId = `target-${siteConfig.key}-${digest(treeIds).slice(0, 20)}`;
  m.weather.siteId = siteConfig.siteId;
  for (const t of m.trees) {
    const n = Number(t.treeId.slice(2)), p = profileOf(t.treeId);
    t.siteId = siteConfig.siteId;
    t.variety = ['热研 7-33-97（模拟）', '热研 7-20-59（模拟）', 'PR107（模拟）'][n % 3];
    t.plantedAt = `${2011 + n % 8}-06-15`;
    t.heightM = round(8.4 + (n % 19) * 0.24);
    t.circumferenceCm = p === 'missing' ? null : round(48 + n % 24 + (n % 3) * 0.3);
    t.tappingStatus = p === 'resting' ? 'resting' : 'available';
    t.healthStatus = ['scar', 'lesion', 'nodule'].includes(p) ? 'watch' : 'normal';
  }
  m.tapping.panels.forEach((p, i) => {
    const n = Number(treeIds[i].slice(2));
    p.plannedCutSlopeDeg = 26 + n % 9;
    // T-0042 deliberately demonstrates a missing assay while the other demo
    // trees expose the fields that the angle strategy can consume.
    const assayAvailable = n !== 42;
    p.latexViscosity = assayAvailable ? simulatedMeasurement(round(390 + n % 90), 'mPa·s', `demo-latex-assay-${stamp}`) : null;
    p.dryRubberContent = assayAvailable ? simulatedMeasurement(round(31 + (n % 12) * 0.4), '%', `demo-dry-rubber-assay-${stamp}`) : null;
  });
  m.inspection.evidence.forEach(e => {
    const p = profileOf(e.treeId);
    e.geometryRegistered = p !== 'unregistered';
    const detectionClass = { scar: 'scar', lesion: 'suspected_lesion', unregistered: 'attachment', nodule: 'nodule', bird_dropping: 'bird_dropping', mud: 'mud' }[p];
    e.detections = detectionClass ? [{
      detectionId: `detection-${e.treeId}-${stamp}`, classCode: detectionClass,
      intersectsPlannedLine: p === 'unregistered' ? null : ['scar', 'lesion', 'nodule'].includes(p), reviewStatus: 'unreviewed', score: null,
      box: [0.32, 0.4, 0.18, 0.2], coordinateConvention: 'normalized_top_left_xywh',
    }] : [];
    e.evidenceId = `evidence-${e.treeId}-${stamp}`;
  });
  m.growth.measurements = m.trees.flatMap(t => [90, 60, 30, 0].map((days, i) => ({
    observationId: `growth-${t.treeId}-${stamp}-${i}`, treeId: t.treeId, observedAt: iso(now, -days * 86400000),
    circumferenceCm: t.circumferenceCm === null ? null : round(t.circumferenceCm - days / 30 * (0.18 + Number(t.treeId.slice(2)) % 5 * 0.08)),
    measurementHeightM: 1.3, provenance: { sourceClass: 'sensor_device', sourceId: 'demo-measurements', mode: 'simulated' }, quality: 'valid',
  })));
  // Three checkpoints spanning the full 30-day demo window make the trend
  // panel visibly longitudinal instead of implying that three adjacent days
  // are a long-term outbreak forecast.  The records remain simulated.
  m.health.records = m.trees.flatMap(t => [29, 14, 0].map((days, i) => ({
    recordId: `health-${t.treeId}-${stamp}-${i}`, treeId: t.treeId, observedAt: iso(now, -days * 86400000 - 1800000),
    symptomCodes: healthSymptom(siteConfig.key, Number(t.treeId.slice(2)), i), confirmedDiagnosis: null,
    provenance: { sourceClass: 'sensor_device', sourceId: 'demo-inspection', mode: 'simulated' }, quality: 'valid',
  })));
  m.weather.observed.observationId = `weather-${siteConfig.key}-${stamp}`;
  m.weather.observed.relativeHumidityPct = phase === 'rain' ? 91 : 72 + siteConfig.offset % 8;
  m.weather.observed.rainfallMm = phase === 'rain' ? 4.2 : 0;
  m.weather.observed.soilMoisture = simulatedMeasurement(phase === 'rain' ? 68 : 32 + siteConfig.offset % 10, '%', `demo-soil-moisture-${siteConfig.key}-${stamp}`);
  // The assay is a site-level demo indicator used by the weather window
  // policy.  A wet phase deliberately carries a low value so the UI can show
  // why a clear forecast after heavy rain is still deferred; it is simulated.
  m.weather.observed.dryRubberContent = simulatedMeasurement(phase === 'rain' ? 27.5 : 34.2 + siteConfig.offset % 3, '%', `demo-weather-dry-rubber-${siteConfig.key}-${stamp}`);
  const rainfallHistoryMm = phase === 'rain' ? [4.5, 3.2, 2.1, 1.2, 0.8, 0.2, 0] : [0, 0.2, 0.5, 0, 0.1, 0, 0];
  m.weather.observed.recentRainfall = rainfallHistoryMm.map((rainfallMm, i) => simulatedRain(
    `rainfall-${siteConfig.key}-${stamp}-${i}`, iso(now, -(6 - i) * 86400000), rainfallMm,
  ));
  m.weather.forecast.forecastRunId = `forecast-${siteConfig.key}-${stamp}`;
  m.weather.forecast.steps.forEach((s, i) => {
    s.rainfallMm = phase === 'rain' ? [2.1, 4.8, 3.2, 1.0][i] : 0;
    s.rainProbabilityPct = phase === 'rain' ? [75, 90, 85, 65][i] : [10, 15, 20, 25][i];
  });
  m.market.prices = Array.from({ length: 14 }, (_, i) => ({
    ...m.market.prices[0], observationId: `market-${siteConfig.key}-${stamp}-${i}`, observedAt: iso(now, -(13 - i) * 86400000),
    value: round(14.1 + siteConfig.offset * 0.03 + i * 0.035 + [0, 0.1, -0.06, 0.04][i % 4]),
  }));
  if (variant === 'missing_weather') {
    m.weather.observed.rainfallMm = null;
    m.weather.observed.soilMoisture = null;
  }
  if (variant === 'rainy') m.weather.observed.rainfallMm = 4.2;
  if (variant === 'unregistered') m.inspection.evidence.forEach(e => { e.geometryRegistered = false; e.detections.forEach(d => { d.intersectsPlannedLine = null; }); });
  if (variant === 'missing_cost') m.market.costAssumptions = null;
  c.snapshotId = `input-${digest(c).slice(0, 24)}`;
  // Site-scoped provenance makes the independent fixture registers
  // auditable in the tree view and prevents a Hainan source from appearing
  // as an observation for another park.
  for (const module of [m.inspection, m.tapping, m.growth, m.health]) {
    const rows = module?.evidence ?? module?.panels ?? module?.measurements ?? module?.records ?? [];
    for (const row of rows) if (row.provenance?.sourceId) row.provenance.sourceId = `${row.provenance.sourceId}-${siteConfig.key}`;
  }
  for (const price of m.market.prices) if (price.provenance?.sourceId) price.provenance.sourceId = `demo-market-${siteConfig.key}`;
  if (m.market.demand?.provenance?.sourceId) m.market.demand.provenance.sourceId = `demo-demand-${siteConfig.key}`;
  return validate(contextSchema, c);
}

export const SCENARIOS = [
  { id: 'morning', title: '① 早间：A 区天气窗口', kind: 'weather_window', treeIds: TREE_IDS.slice(0, 50), phase: 'morning', description: '50 棵目标树共用园区天气；雨史、土壤和干胶指标未触发偏湿阈值，晴天窗口仍需现场确认。' },
  { id: 'rain', title: '② 半小时后：降雨预报更新', kind: 'weather_window', treeIds: TREE_IDS.slice(0, 50), phase: 'rain', description: '同一目标范围，降雨、土壤偏湿和低干胶含量联动，观察当前及放晴窗口仍建议暂缓。' },
  { id: 'surface', title: '③ 树群：伤痕、结节、鸟粪、泥巴与补拍', kind: 'surface_action', treeIds: ['T-0001', 'T-0004', 'T-0012', 'T-0005', 'T-0006', 'T-0018', 'T-0027', 'T-0038'], description: '独立异常案例：正常树无标记；与割线相交的伤痕、疑似病斑和结节形成跳刀/避让候选，割线外鸟粪、泥巴等附着物形成正常继续候选，未配准树需补拍；没有真实照片。' },
  { id: 'missing', title: '④ 缺数据：T-0042 暂不出角度', kind: 'tapping_angle', treeIds: ['T-0042'], description: '树围为空，系统说明缺项，不把缺失值当成零。' },
  { id: 'resting', title: '⑤ 休割树：T-0031 阻止角度建议', kind: 'tapping_angle', treeIds: ['T-0031'], description: '当前状态为休割，返回采用前置条件未满足。' },
  { id: 'growth', title: '⑥ 生长：不同树的历史趋势', kind: 'growth_plan', treeIds: ['T-0001', 'T-0002', 'T-0003'], description: '每棵树四个历史测量点、不同增量；采用简单线性演示外推。' },
  { id: 'health', title: '⑦ 巡查：有症状与正常对照', kind: 'pest_risk', treeIds: ['T-0001', 'T-0005', 'T-0015'], description: '正常对照不触发，近期有症状的树进入复核清单；不作确诊。' },
];
export function scenarioContext(scenario, now, siteId = 'demo-hainan') {
  return makeParkContext({ treeIds: scenario.treeIds, siteId, now: scenario.id === 'morning' ? new Date(+now - 1800000) : now, phase: scenario.phase ?? 'morning' });
}
export function parkOverview(now = new Date(), siteId = 'demo-hainan') {
  const siteConfig = parkSite(siteId);
  const context = makeParkContext({ now, siteId: siteConfig.siteId });
  return {
    asOf: context.asOf, siteId: siteConfig.siteId, siteKey: siteConfig.key, siteName: siteConfig.name, mode: 'simulated', profiles: PROFILES,
    exceptionCases: DEMO_EXCEPTION_CASES.map(item => ({...item, siteId: siteConfig.siteId})),
    counts: { trees: 200, blocks: 4, growth: context.modules.growth.measurements.length, health: context.modules.health.records.length, inspection: 200, panels: 200, weatherObservations: 1, forecastSteps: 4, marketPrices: 14, rules: 6 },
    trees: context.modules.trees.map(t => ({ ...t, profile: profileOf(t.treeId) })), scenarios: SCENARIOS,
    modules: context.modules,
  };
}
