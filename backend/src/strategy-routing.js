// Decide which strategy executor should handle one tree without creating a run.
// The rule engine is the small-brain path; configured model generation is the
// big-brain path.  This module deliberately stays pure so GET tree views remain
// read-only and can explain the decision to the UI.

export const STRATEGY_ROUTE_VERSION = 'strategy-route-v1';

const WEATHER_KINDS = new Set(['weather_window', 'tapping_angle', 'pest_risk']);
const MARKET_KINDS = new Set(['market_scenario', 'tapping_angle', 'growth_plan']);
const TREE_KINDS = new Set(['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk']);
export const SIGNAL_LABELS = {
  rain_observed: '现场有降雨', high_humidity: '湿度偏高', rain_forecast: '预报有降雨', rain_probability: '降雨概率偏高', recent_rain: '近7日累计降雨偏高', soil_moisture_high: '土壤水分偏高',
  market_change: '市场价格波动', demand_change: '市场需求变化', inspection_finding: '树表检测发现', health_finding: '健康记录异常', growth_change: '树围变化明显',
};
export const BLOCKER_LABELS = {
  weather: '天气资料缺失', circumference: '树围缺失', tapping_status: '当前作业状态不允许', geometry_registration: '影像尚未配准', inspection_evidence: '树表证据缺失', growth_measurements: '历史树围测量不足',
};

const unique = values => [...new Set((values ?? []).filter(Boolean))];
// Trigger combinations the brain has handed down to the small brain after a
// shadow comparison and human approval (routing-evolution.js).  Loaded per
// site like the cerebellum thresholds; an exact match is required, so any
// extra signal still goes to the big brain.
export const AUDIT_EVERY = 5;
const siteDelegations = new Map();
export const signatureOf = triggers => unique(triggers).sort().join('+');
export function setRoutingDelegations(siteId, list) { if (list?.length) siteDelegations.set(siteId, list); else siteDelegations.delete(siteId); }
export function routingDelegationsFor(siteId) { return siteDelegations.get(siteId) ?? []; }
const sampleHash = text => { let value = 2166136261; for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619) >>> 0; } return value; };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const labels = (values, dictionary) => (values ?? []).map(value => dictionary[value] ?? value).join('、');

function treeFor(context, treeId) {
  return context?.modules?.trees?.find(item => item.treeId === treeId) ?? null;
}

function weatherSignals(context) {
  const weather = context?.modules?.weather;
  const observed = weather?.observed;
  const forecast = weather?.forecast;
  const triggers = [];
  if (!observed || !forecast) return { available: false, triggers };
  if (finite(observed.rainfallMm) && observed.rainfallMm > 0.5) triggers.push('rain_observed');
  if (finite(observed.relativeHumidityPct) && observed.relativeHumidityPct >= 80) triggers.push('high_humidity');
  const recentRainfall = (observed.recentRainfall ?? []).filter(item => item.quality === 'valid' && finite(item.rainfallMm));
  if (recentRainfall.reduce((sum, item) => sum + item.rainfallMm, 0) >= 5) triggers.push('recent_rain');
  const soilMoisture = observed.soilMoisture?.value;
  if (finite(soilMoisture) && soilMoisture >= 65) triggers.push('soil_moisture_high');
  const steps = Array.isArray(forecast.steps) ? forecast.steps : [];
  if (steps.some(step => finite(step.rainfallMm) && step.rainfallMm >= 2)) triggers.push('rain_forecast');
  if (steps.some(step => finite(step.rainProbabilityPct) && step.rainProbabilityPct >= 60)) triggers.push('rain_probability');
  return { available: true, triggers: unique(triggers) };
}

function marketSignals(context) {
  const prices = context?.modules?.market?.prices;
  const demand = context?.modules?.market?.demand;
  const demandValue = demand?.value, demandBaseline = demand?.baselineValue;
  const demandTrigger = Number.isFinite(demandValue) && Number.isFinite(demandBaseline) && demandBaseline > 0 && Math.abs(demandValue / demandBaseline - 1) >= 0.1 ? ['demand_change'] : [];
  if (!Array.isArray(prices) || prices.length < 2) return { available: false, triggers: demandTrigger };
  const values = prices.map(row => row.value).filter(finite);
  if (values.length < 2) return { available: false, triggers: [] };
  const first = values[0];
  const last = values.at(-1);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const denominator = Math.max(Math.abs(first), 1);
  const rangeRatio = (high - low) / denominator;
  const trendRatio = Math.abs(last - first) / denominator;
  return { available: true, triggers: unique([...(rangeRatio >= 0.08 || trendRatio >= 0.08 ? ['market_change'] : []), ...demandTrigger]) };
}

function inspectionSignals(context, treeId) {
  const evidence = (context?.modules?.inspection?.evidence ?? []).filter(item => item.treeId === treeId);
  if (!evidence.length) return { available: false, triggers: [], blockers: ['inspection_evidence'] };
  const blockers = evidence.some(item => item.geometryRegistered === false) ? ['geometry_registration'] : [];
  const detections = evidence.flatMap(item => item.detections ?? []);
  const triggers = detections.some(item => item.reviewStatus !== 'rejected') ? ['inspection_finding'] : [];
  return { available: true, triggers, blockers };
}

function healthSignals(context, treeId, tree) {
  const records = (context?.modules?.health?.records ?? []).filter(item => item.treeId === treeId);
  const symptoms = records.some(item => (item.symptomCodes ?? []).length > 0);
  const triggers = tree?.healthStatus === 'watch' || tree?.healthStatus === 'confirmed_issue' || symptoms ? ['health_finding'] : [];
  return { available: records.length > 0, triggers };
}

function growthSignals(context, treeId) {
  const rows = (context?.modules?.growth?.measurements ?? []).filter(item => item.treeId === treeId && finite(item.circumferenceCm));
  const blockers = rows.length < 2 ? ['growth_measurements'] : [];
  const ordered = [...rows].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
  const first = ordered[0]?.circumferenceCm;
  const last = ordered.at(-1)?.circumferenceCm;
  const triggers = finite(first) && first > 0 && finite(last) && Math.abs(last - first) / first >= 0.08 ? ['growth_change'] : [];
  return { blockers, triggers };
}

function route({ treeId, kind, complexity, executor, status, triggers, blockers, recommendedGenerator, reason, delegation }) {
  return {
    ...(delegation ? { delegation } : {}),
    version: STRATEGY_ROUTE_VERSION,
    treeId,
    kind,
    complexity,
    executor,
    status,
    triggers: unique(triggers),
    blockers: unique(blockers),
    recommendedGenerator,
    reason,
  };
}

/**
 * Classify one tree's current strategy request.  No store, model, or network
 * call is touched here.  The returned codes are stable for the frontend and
 * the Chinese reason is suitable for a demo operator.  `sampleKey` (the run
 * id) is only passed by the runtime: one in AUDIT_EVERY delegated requests
 * still goes to the big brain so the delegation keeps being checked.
 */
export function classifyStrategyRoute(context, { treeId, kind, sampleKey = null } = {}) {
  const tree = treeFor(context, treeId);
  if (!TREE_KINDS.has(kind)) {
    return route({ treeId, kind, complexity: 'blocked', executor: 'blocked', status: 'blocked', blockers: ['unsupported_kind'], reason: '当前页面只允许单树策略能力，无法分流。' });
  }
  if (!tree) {
    return route({ treeId, kind, complexity: 'blocked', executor: 'blocked', status: 'blocked', blockers: ['tree_profile'], reason: '没有这棵树的档案，先补充树木基础资料。' });
  }

  const blockers = [];
  const triggers = [];
  const weather = weatherSignals(context);
  const market = marketSignals(context);
  const inspection = inspectionSignals(context, treeId);
  const health = healthSignals(context, treeId, tree);

  if (WEATHER_KINDS.has(kind)) {
    if (!weather.available) blockers.push('weather');
    else triggers.push(...weather.triggers);
  }
  if (MARKET_KINDS.has(kind)) triggers.push(...market.triggers);
  if (kind === 'tapping_angle') {
    if (['resting', 'blocked', 'immature', 'unknown'].includes(tree.tappingStatus)) blockers.push('tapping_status');
    if (!finite(tree.circumferenceCm)) blockers.push('circumference');
    triggers.push(...inspection.triggers, ...health.triggers);
    blockers.push(...inspection.blockers);
  }
  if (kind === 'surface_action') {
    blockers.push(...inspection.blockers);
    triggers.push(...inspection.triggers);
  }
  if (kind === 'growth_plan') {
    const growth = growthSignals(context, treeId);
    blockers.push(...growth.blockers);
    triggers.push(...growth.triggers);
    if (!finite(tree.circumferenceCm)) blockers.push('circumference');
  }
  if (kind === 'pest_risk') triggers.push(...health.triggers);

  const finalBlockers = unique(blockers);
  const finalTriggers = unique(triggers);
  if (finalBlockers.length) {
    return route({ treeId, kind, complexity: 'blocked', executor: 'blocked', status: 'blocked', triggers: finalTriggers, blockers: finalBlockers, reason: `当前先暂停策略输出：${labels(finalBlockers, BLOCKER_LABELS)}。请补齐现场数据后再分析。` });
  }
  const signature = signatureOf(finalTriggers);
  const delegated = finalTriggers.length ? routingDelegationsFor(context?.siteId).find(item => item.kind === kind && item.signature === signature) : null;
  if (delegated) {
    const audit = sampleKey !== null && sampleHash(`${sampleKey}:${treeId}`) % AUDIT_EVERY === 0;
    const delegation = { id: delegated.id, approvedAt: delegated.approvedAt, audit };
    if (!audit) return route({ treeId, kind, complexity: 'simple', executor: 'small_brain', status: 'ready', triggers: finalTriggers, blockers: [], recommendedGenerator: 'demo_rules', delegation, reason: `检测到${labels(finalTriggers, SIGNAL_LABELS)}；这类情况经大脑与小脑对照后已批准下沉，由小脑规则直接给出策略。` });
    return route({ treeId, kind, complexity: 'complex', executor: 'big_brain', status: 'needs_big_brain', triggers: finalTriggers, blockers: [], recommendedGenerator: 'configured', delegation, reason: `检测到${labels(finalTriggers, SIGNAL_LABELS)}；这类情况已下沉给小脑，本次是每 ${AUDIT_EVERY} 次抽 1 次的大脑抽检。` });
  }
  if (finalTriggers.length) {
    return route({ treeId, kind, complexity: 'complex', executor: 'big_brain', status: 'needs_big_brain', triggers: finalTriggers, blockers: [], recommendedGenerator: 'configured', reason: `检测到${labels(finalTriggers, SIGNAL_LABELS)}，需要大脑综合多源条件后输出策略包。` });
  }
  return route({ treeId, kind, complexity: 'simple', executor: 'small_brain', status: 'ready', triggers: [], blockers: [], recommendedGenerator: 'demo_rules', reason: '当前条件在规则边界内，可由小脑规则直接给出策略。' });
}
