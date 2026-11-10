// A reproducible 30-day health-trend score for the demo. It is an ordering
// aid for inspection, never a disease probability or a diagnosis.
export const PEST_POLICY_VERSION = 'demo-pest-risk-v1';
const DAY = 86400000;
const SYMPTOM_WEIGHTS = Object.freeze({
  leaf_spot: 20,
  bark_lesion: 24,
  mite_trace: 16,
  leaf_wilt: 18,
});

const validRows = (records, now) => (records ?? []).filter(row => row?.quality === 'valid' && Date.parse(row.observedAt) <= +now);

export function calculatePestRiskAssessment({ records = [], humidityPct = null, weatherObservationId = null, treeId, now }) {
  const windowRows = validRows(records, now).filter(row => row.treeId === treeId && +now - Date.parse(row.observedAt) <= 30 * DAY);
  const recentRows = windowRows.filter(row => +now - Date.parse(row.observedAt) <= 7 * DAY);
  const symptoms = [...new Set(windowRows.flatMap(row => row.symptomCodes ?? []))];
  const recentSymptoms = [...new Set(recentRows.flatMap(row => row.symptomCodes ?? []))];
  const priorSymptomCount = windowRows.filter(row => +now - Date.parse(row.observedAt) > 7 * DAY)
    .reduce((sum, row) => sum + (row.symptomCodes?.length ?? 0), 0);
  const recentSymptomCount = recentRows.reduce((sum, row) => sum + (row.symptomCodes?.length ?? 0), 0);
  const trend = windowRows.length < 2 ? 'insufficient_history' : recentSymptomCount > priorSymptomCount ? 'increasing' : 'stable';
  // This is a transparent ordering score for the demo, not a probability.
  // Recent symptoms carry more weight than old observations; multiple or
  // different symptom codes add evidence, and humidity contributes only a
  // small contextual adjustment.  Keeping the calculation here makes the
  // same score available to both the rule generator and candidate validator.
  const symptomWeight = symptoms.reduce((sum, code) => sum + (SYMPTOM_WEIGHTS[code] ?? 12), 0);
  const recentWeight = recentSymptoms.reduce((sum, code) => sum + (SYMPTOM_WEIGHTS[code] ?? 12), 0);
  const priorWeight = Math.max(0, symptomWeight - recentWeight);
  const recencyScore = recentWeight ? Math.min(48, 30 + recentWeight * 0.45 + recentSymptomCount * 4) : Math.min(20, priorWeight * 0.35);
  const trendScore = !symptoms.length ? 0 : trend === 'increasing' ? 12 : trend === 'insufficient_history' ? 0 : 3;
  const humidityScore = humidityPct >= 85 ? 10 : humidityPct >= 75 ? 5 : 0;
  const riskIndex = Math.min(100, Math.round(recencyScore + Math.min(20, symptomWeight * 0.25) + trendScore + humidityScore));
  const riskLevel = riskIndex >= 60 ? 'review' : riskIndex >= 25 ? 'watch' : 'low';
  const observedDays = windowRows.length ? Math.round(Math.max(...windowRows.map(row => (+now - Date.parse(row.observedAt)) / DAY))) : 0;
  return {
    policyVersion: PEST_POLICY_VERSION,
    treeId,
    riskIndex,
    riskLevel,
    trend,
    monitoringWindowDays: 30,
    observedDays,
    basisSourceRefs: [...windowRows.map(row => row.recordId), weatherObservationId].filter(Boolean),
    preventiveActions: riskLevel === 'review'
      ? ['安排现场复核并补拍病斑图像', '复核叶面湿度与排水状况，必要时请植保人员给出处置意见']
      : riskLevel === 'watch'
        ? ['纳入下一轮巡查并记录症状变化', '保持通风排水，避免未经诊断直接施药']
        : ['按常规周期巡查并保留记录'],
    limitation: windowRows.length < 2
      ? '当前有效历史不足两条，风险指数仅作演示排序，不是病虫害概率或诊断。'
      : '风险指数为规则演示指标，不是病虫害概率或诊断。',
  };
}
