export type PublicSource<T = unknown> = {
  id: string;
  title?: string;
  provider?: string;
  status: string;
  stale?: boolean;
  sourceUrl?: string;
  url?: string;
  retrievedAt?: string;
  validUntil?: string | null;
  lastError?: {code?: string; message?: string} | null;
  data?: T;
};
export type FuturesContract = {
  contract: string;
  closeCnyPerTonne: number | null;
  settlementCnyPerTonne: number | null;
  volumeLots?: number | null;
  openInterestLots?: number | null;
};
export type FuturesData = {
  tradeDate: string;
  priceType: string;
  currency: string;
  priceUnit: string;
  contracts: FuturesContract[];
};
export type WarehouseData = {reportDate: string; quantityTonnes: number; changeTonnes: number; scope: string};
export type MonthlyData = {
  title: string;
  publishedAt: string;
  period: string;
  metrics: {name: string; value: number; unit: string; scope: string; period: string}[];
};
export type PublicSources = {asOf: string; refreshing?: boolean; sources: PublicSource[]};

const price = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

// Keep contract quotes separate. Missing prices never become zero or a simulated quote.
export function futuresRows(data: FuturesData | undefined): FuturesContract[] {
  if (!data || data.priceType !== 'futures' || data.currency !== 'CNY' || data.priceUnit !== 'CNY/tonne' || !/^\d{4}-\d{2}-\d{2}$/.test(data.tradeDate) || !Array.isArray(data.contracts)) return [];
  const seen = new Set<string>();
  return data.contracts.flatMap(row => {
    if (!row || !/^RU\d{4}$/.test(row.contract) || seen.has(row.contract)) return [];
    const closeCnyPerTonne = price(row.closeCnyPerTonne), settlementCnyPerTonne = price(row.settlementCnyPerTonne);
    if (closeCnyPerTonne === null && settlementCnyPerTonne === null) return [];
    seen.add(row.contract);
    return [{...row, closeCnyPerTonne, settlementCnyPerTonne}];
  }).sort((a, b) => a.contract.localeCompare(b.contract));
}

export function publicSourceState(source: PublicSource | undefined, now = Date.now()) {
  if (!source?.data) return {label: '数据不可用', warning: true, expired: false};
  const expiresAt = source.validUntil ? Date.parse(source.validUntil) : NaN;
  const expired = source.stale === true || source.status === 'stale' || (Number.isFinite(expiresAt) && expiresAt <= now);
  const failed = source.status === 'refresh_failed' || Boolean(source.lastError);
  return {
    label: expired ? (failed ? '已过期 · 最近更新失败' : '已过期 · 仅供历史参考') : failed ? '最近更新失败 · 保留上次数据' : source.status === 'available' && Number.isFinite(expiresAt) ? '真实公开数据 · 日报 / 月报' : '来源状态待核验',
    warning: expired || failed || source.status !== 'available' || !Number.isFinite(expiresAt),
    expired,
  };
}

export function officialSourceUrl(source: PublicSource | undefined): string | undefined {
  const address = source?.sourceUrl || source?.url;
  try {
    const url = new URL(address || '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {return undefined;}
}

export function metricUnit(unit: string): string {
  return unit === 'CNY/tonne_dry_rubber' ? '元 / 吨干胶' : unit === 'CNY/tonne' ? '元 / 吨' : unit;
}
