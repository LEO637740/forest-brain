import type {PublicSource} from '../integration/publicMarketData';

export type CatalogRecord = {provenance?: {mode?: string; sourceId?: string}; fieldRecord?: {provenance?: {mode?: string; sourceId?: string}; observedAt?: string}; quality?: string; observedAt?: string; measuredAt?: string | null; capturedAt?: string; issuedAt?: string; retrievedAt?: string};
export function catalogTime(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false}) : '未提供';
}
export function recordSummary(records: CatalogRecord[]) {
  const names: Record<string, string> = {simulated: '模拟数据', measured: '实测 / 已记录', forecast: '预测数据', estimated: '估计数据'};
  const modes = [...new Set(records.flatMap(row => [row.provenance?.mode, ...(row.fieldRecord ? [row.fieldRecord.provenance?.mode] : [])])
    .map(mode => names[mode || ''] || '来源待确认'))];
  const times = records.flatMap(row => [row.observedAt, row.measuredAt, row.capturedAt, row.issuedAt, row.retrievedAt, row.fieldRecord?.observedAt]).filter((time): time is string => !!time && Number.isFinite(Date.parse(time))).sort((a, b) => Date.parse(b) - Date.parse(a));
  const issues = records.filter(row => row.quality !== 'valid').length;
  return {label: modes.join(' / ') || '尚无记录', latest: times[0], issues, count: records.length};
}
export function catalogSourceState(source: PublicSource, now = Date.now()) {
  if (!source.data) return {label: '不可用', warning: true};
  const expiry = source.validUntil ? Date.parse(source.validUntil) : NaN;
  if (source.stale || source.status === 'stale' || Number.isFinite(expiry) && expiry <= now) return {label: '已过期 · 历史快照', warning: true};
  if (source.lastError || source.status === 'refresh_failed') return {label: '更新失败 · 保留缓存', warning: true};
  return source.status === 'available' && Number.isFinite(expiry) ? {label: '参考数据可用', warning: false} : {label: '时效 / 状态待确认', warning: true};
}
export function sourcePeriod(data: unknown) {
  if (!data || typeof data !== 'object') return '未提供';
  const row = data as Record<string, unknown>;
  for (const key of ['tradeDate', 'reportDate', 'period', 'publishedAt']) if (typeof row[key] === 'string') return row[key] as string;
  const forecast = row.forecast;
  if (Array.isArray(forecast) && forecast.length) {
    const dates = forecast.flatMap(step => typeof step?.validFrom === 'string' ? [step.validFrom] : []).filter(value => Number.isFinite(Date.parse(value))).sort();
    if (dates.length) return `${catalogTime(dates[0])} — ${catalogTime(dates.at(-1))}`;
  }
  return '未提供';
}
