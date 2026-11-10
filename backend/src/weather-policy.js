// Weather and tapping-window policy shared by the rule generator, independent
// candidate validation and model decision support.  The thresholds are
// deliberately named demo guards: they make the demo behaviour reproducible
// while keeping a future agronomy calibration separate from the contract.
export const WEATHER_POLICY_VERSION = 'demo-weather-timing-v3';

export const WEATHER_THRESHOLDS = Object.freeze({
  lightRainMaxMmPerPeriod: 0.5,
  rainProbabilityDeferPct: 60,
  recentWetSpellMm: 5,
  soilWetPct: 65,
  dryRubberLowPct: 30,
});

// Approved cerebellum (small-brain) parameter sets, keyed by park.  The rule
// generator, the independent validator and model decision support all read
// the same entry, so a strategy and its validation always use one parameter
// version.  Changes only arrive through the reviewed CerebellumTuning flow.
const siteThresholds = new Map();
export function setCerebellumThresholds(siteId, thresholds, version) {
  if (!thresholds) { siteThresholds.delete(siteId); return; }
  siteThresholds.set(siteId, {thresholds:Object.freeze({...WEATHER_THRESHOLDS, ...thresholds}), version});
}
export function clearCerebellumThresholds() { siteThresholds.clear(); }
export function thresholdsFor(siteId) { return siteThresholds.get(siteId)?.thresholds ?? WEATHER_THRESHOLDS; }
export function thresholdVersionFor(siteId) { return siteThresholds.get(siteId)?.version ?? 'default'; }

const finite = value => typeof value === 'number' && Number.isFinite(value);
const measurementValue = measurement => measurement && typeof measurement === 'object' ? measurement.value : measurement;

function validRainfall(observed) {
  return (observed?.recentRainfall ?? []).filter(row => row?.quality === 'valid' && finite(row.rainfallMm));
}

export function weatherFacts(observed, T = WEATHER_THRESHOLDS) {
  const history = validRainfall(observed);
  const recentRainfallTotalMm = Math.round(history.reduce((sum, row) => sum + row.rainfallMm, 0) * 1000) / 1000;
  const recentRainfallPeakMm = history.reduce((peak, row) => Math.max(peak, row.rainfallMm), 0);
  const currentRainfallMm = observed?.rainfallMm;
  const soilMoisturePct = measurementValue(observed?.soilMoisture);
  const dryRubberContentPct = measurementValue(observed?.dryRubberContent);
  const wetSpell = recentRainfallTotalMm >= T.recentWetSpellMm;
  const soilWet = finite(soilMoisturePct) && soilMoisturePct >= T.soilWetPct;
  const dryRubberStatus = !finite(dryRubberContentPct)
    ? 'missing'
    : dryRubberContentPct < T.dryRubberLowPct ? 'available_low' : 'available_good';
  return {
    currentRainfallMm: finite(currentRainfallMm) ? currentRainfallMm : null,
    recentRainfallTotalMm: history.length ? recentRainfallTotalMm : null,
    recentRainfallPeakMm: history.length ? recentRainfallPeakMm : null,
    soilMoisturePct: finite(soilMoisturePct) ? soilMoisturePct : null,
    dryRubberContentPct: finite(dryRubberContentPct) ? dryRubberContentPct : null,
    dryRubberStatus,
    wetSpell,
    soilWet,
    history,
  };
}

/**
 * Assess one future forecast segment.  A small amount of rain is explicitly
 * allowed when current conditions permit it. Historical rainfall alone is a
 * field-check reminder; wet soil or measured low dry-rubber content can still
 * require recovery review.  This is a transparent demo policy, not an
 * agronomy claim.
 */
export function assessWeatherWindow({ observed, step, siteId = null, thresholds = null }) {
  // `thresholds` lets the brain replay candidate parameters through this exact rule.
  const T = thresholds ?? (siteId ? thresholdsFor(siteId) : WEATHER_THRESHOLDS);
  const facts = weatherFacts(observed, T);
  const currentRain = facts.currentRainfallMm;
  const forecastRain = finite(step?.rainfallMm) ? step.rainfallMm : null;
  const forecastProbability = finite(step?.rainProbabilityPct) ? step.rainProbabilityPct : null;
  const currentHeavy = currentRain !== null && currentRain > T.lightRainMaxMmPerPeriod;
  const forecastHeavy = forecastRain !== null && forecastRain > T.lightRainMaxMmPerPeriod;
  const probabilityHigh = forecastProbability !== null && forecastProbability >= T.rainProbabilityDeferPct;
  const hardRain = currentHeavy || forecastHeavy || probabilityHigh;
  const currentLight = currentRain !== null && currentRain > 0 && !currentHeavy;
  const forecastLight = forecastRain !== null && forecastRain > 0 && !forecastHeavy;
  const lightRain = currentLight || forecastLight;
  const wetRecovery = facts.wetSpell || facts.soilWet;
  const wetReasons = [
    facts.wetSpell ? `近 7 日降雨累计 ${facts.recentRainfallTotalMm} mm 达到巡查提示阈值 ${T.recentWetSpellMm} mm` : null,
    facts.soilWet ? `土壤水分 ${facts.soilMoisturePct}% 达到偏湿阈值 ${T.soilWetPct}%` : null,
  ].filter(Boolean).join('，');
  const dryRubberLow = facts.dryRubberStatus === 'available_low';
  const dryRubberMissing = facts.dryRubberStatus === 'missing';

  let suitability = 'suitable';
  let recoveryStatus = 'clear';
  let reason = '当前无明显降雨信号，土壤水分和近 7 日雨史未触发演示阈值，可进入现场确认。';
  if (hardRain) {
    suitability = 'defer';
    recoveryStatus = 'heavy_rain';
    reason = `降雨量或降雨概率超过小雨作业边界（${T.lightRainMaxMmPerPeriod} mm/时段、${T.rainProbabilityDeferPct}%）；建议暂缓，雨停后重新评估。`;
  } else if (dryRubberLow && wetRecovery) {
    suitability = 'defer';
    recoveryStatus = 'wet_recovery';
    reason = `当前为放晴/小雨窗口，但${wetReasons}，且干胶含量 ${facts.dryRubberContentPct}% 低于演示阈值 ${T.dryRubberLowPct}%；建议延迟，补测干胶含量后复核。`;
  } else if (facts.soilWet) {
    suitability = 'review';
    recoveryStatus = 'wet_recovery';
    reason = `当前降雨信号已减弱，但${wetReasons}；需现场复核地表、排水和干胶含量。`;
  } else if (facts.wetSpell) {
    recoveryStatus = lightRain ? 'light_rain' : 'clear';
    reason = `本时段${lightRain ? '仅有小雨信号' : '降雨信号未超过作业边界'}，可安排作业；${wetReasons}，仅作现场巡查提示，不单独限制排程。开工前核对割面与排水${dryRubberMissing ? '，干胶含量未测可补录' : ''}。`;
  } else if (lightRain) {
    suitability = 'suitable';
    recoveryStatus = 'light_rain';
    reason = `仅有小雨信号（不超过 ${T.lightRainMaxMmPerPeriod} mm/时段），近期雨史和土壤水分未偏湿，可正常作业，但仍需现场确认；干胶含量${dryRubberMissing ? '缺失，需补测' : `为 ${facts.dryRubberContentPct}%`}。`;
  } else if (dryRubberMissing) {
    // A missing assay does not turn an otherwise dry weather window into a
    // hard stop.  It remains a conditional candidate and the UI explicitly
    // asks for a field check instead of treating the missing value as zero.
    recoveryStatus = 'insufficient';
    reason = '天气信号允许作业，但当前干胶含量缺失；窗口仅供现场复核采用，不能把缺失值当成正常。';
  }
  return {
    policyVersion: WEATHER_POLICY_VERSION,
    suitability,
    recoveryStatus,
    reason,
    currentRainfallMm: facts.currentRainfallMm,
    forecastRainfallMm: forecastRain,
    forecastRainProbabilityPct: forecastProbability,
    recentRainfallTotalMm: facts.recentRainfallTotalMm,
    recentRainfallPeakMm: facts.recentRainfallPeakMm,
    soilMoisturePct: facts.soilMoisturePct,
    dryRubberContentPct: facts.dryRubberContentPct,
    dryRubberStatus: facts.dryRubberStatus,
    wetSpell: facts.wetSpell,
    soilWet: facts.soilWet,
    lightRainAllowed: lightRain && suitability === 'suitable' && !dryRubberLow,
    thresholds: T,
    sourceRefs: [observed?.observationId, ...facts.history.map(row => row.observationId)].filter(Boolean),
  };
}

export function weatherAssessment(observed, siteId = null) {
  const T = siteId ? thresholdsFor(siteId) : WEATHER_THRESHOLDS;
  const facts = weatherFacts(observed, T);
  return {
    policyVersion: WEATHER_POLICY_VERSION,
    currentRainfallMm: facts.currentRainfallMm,
    recentRainfallTotalMm: facts.recentRainfallTotalMm,
    recentRainfallPeakMm: facts.recentRainfallPeakMm,
    soilMoisturePct: facts.soilMoisturePct,
    dryRubberContentPct: facts.dryRubberContentPct,
    dryRubberStatus: facts.dryRubberStatus,
    wetSpell: facts.wetSpell,
    soilWet: facts.soilWet,
    lightRainAllowed: false,
    thresholds: T,
    sourceRefs: [observed?.observationId, ...facts.history.map(row => row.observationId)].filter(Boolean),
  };
}
