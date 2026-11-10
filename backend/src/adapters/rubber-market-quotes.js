// The public webpage reads this fixed RU endpoint once per minute. Its current
// /data/config/web_config.dat setting is delaymarket_delaymin=30 (2026-11-02).
export const RUBBER_QUOTE_URL = 'https://www.shfe.com.cn/data/tradedata/future/delaymarket/delaymarket_ru.dat';
const SOURCE_URL = 'https://www.shfe.com.cn/reports/marketdata/delayedquotes/?query_params=delaymarket_f&query_product_code=ru_f';
const CACHE_MS = 30000;
const number = value => {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const nonnegative = value => { const result = number(value); return result !== null && result >= 0 ? result : null; };
const positive = value => { const result = number(value); return result !== null && result > 0 ? result : null; };
const contractName = value => /^ru\d{2}(?:0[1-9]|1[0-2])$/i.test(String(value).trim()) ? String(value).trim().toUpperCase() : null;
const timestamp = value => {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value ?? '')) return null;
  const result = value.replace(' ', 'T') + '+08:00';
  return Number.isFinite(Date.parse(result)) ? result : null;
};
const base = () => ({status:'unavailable', mode:'delayed', provider:'上海期货交易所', sourceUrl:SOURCE_URL,
  delayMinutes:30, quoteAt:null, fetchedAt:null, tradeDate:null, quotes:[]});

function quote(contract, lastPrice, previousSettlement, volumeLots, openInterestLots) {
  const change = previousSettlement === null ? null : Math.round((lastPrice - previousSettlement) * 100) / 100;
  return {contract, lastPrice, previousSettlement, change,
    changePct:change === null ? null : Math.round(change / previousSettlement * 10000) / 100,
    volumeLots:nonnegative(volumeLots), openInterestLots:nonnegative(openInterestLots)};
}

export function normalizeRubberQuotes(raw, fetchedAt) {
  const rows = new Map();
  const times = [];
  for (const row of raw?.delaymarket ?? []) {
    const contract = contractName(row.contractname), lastPrice = positive(row.lastprice);
    if (!contract || lastPrice === null) continue;
    const at = timestamp(row.updatetime);
    if (at) times.push(at);
    rows.set(contract, quote(contract, lastPrice, positive(row.presettlementprice), row.volume, row.openinterest));
  }
  if (!rows.size || !times.length) throw new Error('上期所暂未发布有效橡胶报价');
  // updatetime is the source's snapshot time, not our retrieval time. It is not
  // a trading date: night sessions can belong to the following trading day.
  return {...base(), status:'available', quoteAt:times.sort().at(-1), fetchedAt,
    quotes:[...rows.values()].sort((a,b) => a.contract.localeCompare(b.contract))};
}

function dailyQuotes(source) {
  const data = source?.data;
  if (data?.priceType !== 'futures' || data.currency !== 'CNY' || data.priceUnit !== 'CNY/tonne'
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.tradeDate ?? '') || !Array.isArray(data.contracts)) return null;
  const quotes = data.contracts.flatMap(row => {
    const contract = contractName(row.contract);
    const lastPrice = positive(row.closeCnyPerTonne);
    return contract && lastPrice !== null ? [quote(contract,lastPrice,positive(row.previousSettlementCnyPerTonne),row.volumeLots,row.openInterestLots)] : [];
  });
  if (!quotes.length) return null;
  return {...base(),status:'stale',mode:'daily',delayMinutes:null,tradeDate:data.tradeDate,
    fetchedAt:source.retrievedAt ?? null,sourceUrl:source.sourceUrl ?? 'https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/',
    quotes:quotes.sort((a,b) => a.contract.localeCompare(b.contract)),message:'盘中行情暂未更新，显示最近交易日收盘价。'};
}

/** Shared, read-only snapshot for the homepage; no per-client upstream polling. */
export class RubberMarketQuoteService {
  constructor({fetchImpl=fetch,clock=()=>new Date(),enabled=true,dailySource=()=>undefined}={}) {
    Object.assign(this,{fetchImpl,clock,enabled,dailySource});
    this.cached=null; this.latest=null; this.attemptedAt=null; this.inflight=null;
  }
  async quotes() {
    if (!this.enabled) return {...base(),status:'offline',message:'离线演示未连接期货行情。'};
    if (this.inflight) return this.inflight;
    const now = +this.clock();
    if (this.cached && now - this.attemptedAt < CACHE_MS) return this.cached;
    this.attemptedAt=now;
    this.inflight=this.load().finally(() => {this.inflight=null;});
    return this.inflight;
  }
  async load() {
    try {
      const response=await this.fetchImpl(RUBBER_QUOTE_URL,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(6000)});
      if (!response.ok) throw new Error('行情源暂不可用');
      const raw=await response.json();
      this.latest=normalizeRubberQuotes(raw,this.clock().toISOString());
      this.cached=this.latest;
    } catch {
      this.cached=this.latest ? {...this.latest,status:'stale',message:'更新暂未完成，保留上次行情。'}
        : dailyQuotes(this.dailySource()) ?? {...base(),message:'暂未读到期货行情，稍后自动更新。'};
    }
    return this.cached;
  }
}
