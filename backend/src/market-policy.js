// Transparent market-to-frequency policy used by both the rule generator and
// the independent validator.  It is deliberately a demo policy: the
// thresholds must be fitted against orchard outcomes before live adoption.

// One weekly tapping scale for the whole system: the park-wide stances and the sales
// scenarios both use it. Holding at two cuts a week is about one cut every three days
// (S/2 d3); the care limit caps every plan, model output and validation at three.
export const WEEKLY_TAPPINGS = Object.freeze({pause:0, reduce:1, hold:2, increase:3});
export const CARE_LIMIT_PER_WEEK = 3;
/** Saved plan parameters without the care limit, which always follows the shared scale. */
export const withoutCareLimit = ({careLimit, ...params} = {}) => params;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const measurementValue = value => value && typeof value === 'object' ? value.value : value;

function priceTrend(prices = []) {
  const values = prices.map(item => item?.value).filter(finite);
  if (values.length < 2 || values[0] <= 0) return null;
  return (values.at(-1) - values[0]) / values[0];
}

export function marketDemandBand(market = {}) {
  const demand = market.demand;
  const value = finite(demand?.value) ? demand.value : null;
  const baseline = finite(demand?.baselineValue) && demand.baselineValue > 0 ? demand.baselineValue : null;
  if (value === null || baseline === null) return { band: 'unknown', value, baselineValue: baseline, ratio: null };
  const ratio = value / baseline;
  // Price is a secondary signal.  It can move independently of demand and
  // therefore never replaces the explicit demand indicator.
  const trend = priceTrend(market.prices);
  const low = ratio <= 0.9 || trend !== null && trend <= -0.05;
  const high = ratio >= 1.1 || trend !== null && trend >= 0.05;
  return { band: low && !high ? 'low' : high && !low ? 'high' : 'balanced', value, baselineValue: baseline, ratio, priceTrend: trend };
}

function weatherCap(weather = {}) {
  const observed = weather.observed;
  if (!observed) return { cap: null, reasons: [] };
  const reasons = [];
  const soil = measurementValue(observed.soilMoisture);
  if (finite(observed.rainfallMm) && observed.rainfallMm > 0) reasons.push('现场有降雨');
  if (finite(observed.relativeHumidityPct) && observed.relativeHumidityPct >= 85) reasons.push('相对湿度偏高');
  if (finite(soil) && soil >= 65) reasons.push('土壤水分偏高');
  return { cap: reasons.length ? 1 : null, reasons };
}

export function marketTreeExclusion(tree) {
  if (!tree) return '缺少树木档案';
  if (tree.tappingStatus !== 'available') return tree.tappingStatus === 'resting' ? '休割养护' : '当前作业状态不可割胶';
  if (!finite(tree.circumferenceCm)) return '缺少树围测量';
  if (tree.healthStatus === 'watch' || tree.healthStatus === 'confirmed_issue') return '健康状态需复核';
  if (tree.healthStatus === 'unknown') return '健康状态未知';
  return null;
}

function treeEligibility(trees = []) {
  const eligible = [];
  const counts = new Map();
  const exclude = reason => counts.set(reason, (counts.get(reason) ?? 0) + 1);
  for (const tree of trees) {
    const reason = marketTreeExclusion(tree);
    if (reason) { exclude(reason); continue; }
    eligible.push(tree);
  }
  return { eligible, exclusions: [...counts.entries()].map(([reason, count]) => ({ reason, count })) };
}

export function deriveMarketFrequencyPolicy({ market = {}, trees = [], weather = {}, health = {}, maxTappingsPerWeek = CARE_LIMIT_PER_WEEK } = {}) {
  const demand = marketDemandBand(market);
  const eligibility = treeEligibility(trees);
  const weatherState = weatherCap(weather);
  const limit = Math.max(0, Math.min(7, Number.isInteger(maxTappingsPerWeek) ? maxTappingsPerWeek : CARE_LIMIT_PER_WEEK));
  // Low demand reduces to recover the trees; high demand may increase within the care
  // limit when site conditions allow. Unknown demand never authorizes an increase.
  const demandTarget = Math.min(limit, WEEKLY_TAPPINGS[demand.band === 'high' ? 'increase' : demand.band === 'low' ? 'reduce' : 'hold']);
  const targetFrequencyPerWeek = Math.min(demandTarget, weatherState.cap ?? limit);
  const reasons = [];
  if (demand.band === 'low') reasons.push(`需求/价格信号偏低，演示测算按每周 ${WEEKLY_TAPPINGS.reduce} 次估算产量并养护树势`);
  else if (demand.band === 'high') reasons.push(`需求/价格信号偏高，演示测算在养护上限内按每周 ${WEEKLY_TAPPINGS.increase} 次估算产量`);
  else if (demand.band === 'balanced') reasons.push(`需求处于平衡区间，演示测算按基础割次每周 ${WEEKLY_TAPPINGS.hold} 次估算产量`);
  else reasons.push(`缺少需求指标，保持基础割次每周 ${WEEKLY_TAPPINGS.hold} 次，不能因行情缺项而增加割次`);
  if (weatherState.reasons.length) reasons.push(`天气/水分约束将频次上限收敛为每周 ${weatherState.cap} 次：${weatherState.reasons.join('、')}`);
  if (!eligibility.eligible.length) reasons.push('没有满足作业状态、树围和健康条件的目标树');
  return {
    demand,
    eligible: eligibility.eligible,
    exclusions: eligibility.exclusions,
    weatherCap: weatherState.cap,
    weatherReasons: weatherState.reasons,
    maxTappingsPerWeek: limit,
    targetFrequencyPerWeek: eligibility.eligible.length ? targetFrequencyPerWeek : 0,
    reasons,
    method: 'demo-demand-price-care-policy-v1',
    limitation: '需求、价格与频次阈值为透明演示先验；需用真实订单、行情、产量、树势和耗皮/恢复数据回测后，才能用于生产。',
  };
}

export { priceTrend };
