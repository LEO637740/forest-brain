import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest, iso } from '../util.js';
import { AppError, invariant } from '../errors.js';
import { readBounded } from './context.js';
import { cleanText, articleParagraphs, discoverReport, normalizeReport } from './public-reports.js';
export { cleanText } from './public-reports.js';

export const SOURCE_INFO = {
  weather: { title: '区域天气与土壤水分', provider: 'Open-Meteo', url: 'https://open-meteo.com/en/docs', note: '真实气象服务的模型预报/估计，不是园区传感器实测；土壤水分为格点模型值。' },
  market: { title: '天然橡胶期货日行情', provider: '上海期货交易所', url: 'https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/', note: '按合约分别保存，单位元/吨；不替代胶农现货成交价，不据此直接计算销售收入。' },
  warehouse: { title: '天然橡胶仓单日报', provider: '上海期货交易所', url: 'https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/', note: '交易所注册仓单货物数量，不是本园区库存，也不是运输轨迹或全国总库存。' },
  bulletin: { title: '2026 年橡胶树重大病虫害预报', provider: '农业农村部农垦局', url: 'https://nkj.moa.gov.cn/rzny/202602/t20260228_6481796.htm', note: '年度宏观预报，非单树诊断或今日现场预警；最新病虫害指导由独立来源自动发现。' },
  monthly_report: {title:'橡胶月报 · 现货与进口',provider:'农业农村部农垦局',url:'https://nkj.moa.gov.cn/rzny/',note:'自动检查目录的最新市场月报；分开保留报价月和进口统计月，区域月均价不是园区成交价。'},
  production_national: {title:'全国天然橡胶产量',provider:'农业农村部网站（转载人民日报）',url:'https://nkj.moa.gov.cn/gzdt/202604/t20260402_6482912.htm',note:'2025 年全国年度产量及进口统计；固定报告，不代表当日生产或企业产量。'},
  production_hainan: {title:'海南橡胶产量',provider:'海南省统计局',url:'https://stats.hainan.gov.cn/tjj/tjgb/fzgb/2023_88252/202602/t20260226_4032927.html',note:'2025 年省级统计公报；固定年度基线，不推算某园区或某棵树的产量。'},
  pest_updates: {title:'最新橡胶病虫害指导',provider:'农业农村部农垦局',url:'https://nkj.moa.gov.cn/rzny/',note:'检查官方目录首页最新橡胶病虫害公告；指导范围见正文，不等于现场确诊。'},
  zhejiang_rubber: {title:'浙江大宗橡胶业务动态',provider:'浙江自贸',url:'https://ftz.zj.gov.cn/ceb-portal/news/queryNewsById?id=2154',note:'2026-10-12 发布的历史现货仓单融资案例；是业务资讯，不是橡胶报价或本园区库存。'},
};
const asNumber = (value, min = -Infinity, max = Infinity) => {
  if (!['number','string'].includes(typeof value) || value === '' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const requireNumber = (v, min = -Infinity, max = Infinity) => { const n = asNumber(v, min, max); invariant(n !== null, 'INVALID_PUBLIC_DATA', '上游缺少有效数值', 502); return n; };
const dayCN = date => new Date(+date + 8 * 3600000).toISOString().slice(0, 10);
export function candidateDays(now, count) { return Array.from({ length: count }, (_, i) => dayCN(new Date(+now - i * 86400000)).replaceAll('-', '')); }
export function validateConfig(config) {
  invariant(config && config.location && typeof config.location.confirmed === 'boolean', 'INVALID_CONFIG', '需要地点配置及 confirmed 标记');
  requireNumber(config.location.latitude, -90, 90); requireNumber(config.location.longitude, -180, 180);
  invariant(typeof config.location.name === 'string' && config.location.name.length > 0 && /^[A-Za-z0-9_.:-]+$/.test(config.location.siteId), 'INVALID_CONFIG', '需要地点名称和园区编号');
  requireNumber(config.refreshMinutes, 5, 1440); requireNumber(config.maxWeatherAgeMinutes, 1, 1440); requireNumber(config.marketLookbackDays, 1, 31);
  invariant(!config.enabledSources || Array.isArray(config.enabledSources) && config.enabledSources.length > 0 && config.enabledSources.every(x=>Object.hasOwn(SOURCE_INFO,x)), 'INVALID_CONFIG','enabledSources 含未知来源');
  return config;
}
export function weatherUrl(location, {forecastDays = 3} = {}) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude,
    current: 'temperature_2m,relative_humidity_2m,precipitation',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,rain,showers,soil_moisture_0_to_1cm',
    forecast_days: String(forecastDays), past_days: '7', timezone: 'Asia/Shanghai', timeformat: 'unixtime' }).toString();
  return u.href;
}
export function normalizeWeather(raw, location, now, {forecastHours = 48, includeCurrentHour = false} = {}) {
  const h = raw.hourly, units = raw.hourly_units;
  invariant(!raw.error && Array.isArray(h?.time) && h.time.length > 0 && units?.time === 'unixtime' && units.rain === 'mm' && units.showers === 'mm' && units.temperature_2m === '°C' && units.relative_humidity_2m === '%' && units.precipitation_probability === '%' && units.soil_moisture_0_to_1cm === 'm³/m³', 'INVALID_PUBLIC_DATA', '天气单位或结构发生变化', 502);
  for (const key of ['temperature_2m', 'relative_humidity_2m', 'precipitation_probability', 'rain', 'showers', 'soil_moisture_0_to_1cm']) invariant(Array.isArray(h[key]) && h[key].length === h.time.length, 'INVALID_PUBLIC_DATA', '天气时间序列长度不一致', 502);
  invariant(h.time.every((t,i) => Number.isFinite(t) && (!i || t - h.time[i-1] === 3600)), 'INVALID_PUBLIC_DATA', '预报时间序列不是连续整小时', 502);
  const hours = h.time.map((t, i) => {
    const rain = asNumber(h.rain[i], 0), showers = asNumber(h.showers[i], 0);
    return { at: iso(t * 1000), validFrom: iso((t - 3600) * 1000), validTo: iso(t * 1000),
      rainfallMm: rain === null || showers === null ? null : Math.round((rain + showers) * 1000) / 1000,
      rainProbabilityPct: asNumber(h.precipitation_probability[i], 0, 100), airTemperatureC: asNumber(h.temperature_2m[i], -100, 70),
      relativeHumidityPct: asNumber(h.relative_humidity_2m[i], 0, 100), soilMoistureM3M3: asNumber(h.soil_moisture_0_to_1cm[i], 0, 1) };
  });
  const forecast = hours.filter(x => includeCurrentHour ? Date.parse(x.validTo) > +now : Date.parse(x.validFrom) >= +now).slice(0, forecastHours);
  invariant(forecast.length >= 12, 'INVALID_PUBLIC_DATA', '上游未返回足够的未来预报', 502);
  const current = raw.current;
  const currentUnits = raw.current_units;
  const validCurrent = Number.isFinite(current?.time) && currentUnits?.time === 'unixtime' && currentUnits?.temperature_2m === '°C' && currentUnits?.relative_humidity_2m === '%' && currentUnits?.precipitation === 'mm';
  return { location: structuredClone(location), gridLocation: { latitude: requireNumber(raw.latitude,-90,90), longitude: requireNumber(raw.longitude,-180,180) },
    basis: 'weather_model', modelIssuedAt: null, fetchedAt: iso(now), attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
    currentEstimate: validCurrent ? { at: iso(current.time * 1000), intervalSeconds: requireNumber(current.interval,1,3600), airTemperatureC: asNumber(current.temperature_2m,-100,70), relativeHumidityPct: asNumber(current.relative_humidity_2m,0,100), precipitationMm: asNumber(current.precipitation,0) } : null,
    forecast, recentModelHistory: hours.filter(x => Date.parse(x.at) <= +now),
    limitation: '降雨和降雨概率对应时间戳之前一小时；过去七天为模型历史，不是站点观测。获取时间不冒充模型发布时间。' };
}
export function normalizeMarket(raw, expectedDate) {
  invariant(String(raw.report_date) === expectedDate && Array.isArray(raw.o_curinstrument), 'INVALID_PUBLIC_DATA', '行情报表日期或结构不匹配', 502);
  invariant(String(raw.o_trade_day ?? '').trim(), 'SOURCE_NOT_PUBLISHED', '当日结算行情尚未发布',503);
  const rows = raw.o_curinstrument.filter(r => String(r.PRODUCTID).trim() === 'ru_f' && /^\d{4}$/.test(String(r.DELIVERYMONTH).trim())).map(r => ({
    contract: `RU${String(r.DELIVERYMONTH).trim()}`, closeCnyPerTonne: asNumber(r.CLOSEPRICE,0), settlementCnyPerTonne: asNumber(r.SETTLEMENTPRICE,0),
    volumeLots: asNumber(r.VOLUME,0), openInterestLots: asNumber(r.OPENINTEREST,0), previousSettlementCnyPerTonne: asNumber(r.PRESETTLEMENTPRICE,0),
  })).filter(r => r.closeCnyPerTonne !== null || r.settlementCnyPerTonne !== null);
  invariant(rows.length > 0 && new Set(rows.map(r => r.contract)).size === rows.length, 'INVALID_PUBLIC_DATA', '没有有效且唯一的天然橡胶合约行', 502);
  return { tradeDate: expectedDate.replace(/^(....)(..)(..)$/, '$1-$2-$3'), publishedAt: raw.update_date ?? null, priceType: 'futures', currency: 'CNY', priceUnit: 'CNY/tonne', contracts: rows, limitation: SOURCE_INFO.market.note };
}
export function normalizeWarehouse(html, expectedDate) {
  const date = expectedDate.replace(/^(....)(..)(..)$/, '$1-$2-$3');
  invariant(cleanText(html).includes(date), 'INVALID_PUBLIC_DATA', '仓单日期不匹配', 502);
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => cleanText(x[1])));
  const start = rows.findIndex(r => r[0] === '天然橡胶' && r.some(c => c.includes('吨')));
  invariant(start >= 0, 'INVALID_PUBLIC_DATA', '未找到天然橡胶仓单表', 502);
  const total = rows.slice(start + 1).find(r => r[0] === '总计' || r.some(c => /^单位/.test(c)));
  invariant(total?.[0] === '总计' && total.length === 3, 'INVALID_PUBLIC_DATA', '天然橡胶仓单总计缺失', 502);
  return { reportDate: date, quantityTonnes: requireNumber(total[1].replaceAll(',',''),0), changeTonnes: requireNumber(total[2].replaceAll(',','')), scope: 'SHFE_registered_warrants', limitation: SOURCE_INFO.warehouse.note };
}
export function normalizeBulletin(html) {
  const meta = name => html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i'))?.[1];
  const title = meta('ArticleTitle'), publishedAt = meta('PubDate');
  invariant(title?.includes('橡胶树重大病虫害') && /^2026-02-28/.test(publishedAt ?? ''), 'INVALID_PUBLIC_DATA', '病虫害公告身份校验失败', 502);
  return { title, publishedAt: publishedAt.replace(' ', 'T') + '+08:00', publisher: meta('ContentSource'), scope: '全国橡胶产区', period: '2026 年度预测',
    summary: '农业农村部农垦局发布年度橡胶树重大病虫害趋势预报，适合作为宏观风险背景；具体园区需结合地点、物候和巡查记录复核。', paragraphs: articleParagraphs(html,{fullArticle:true}), sourceUrl: SOURCE_INFO.bulletin.url, limitation: SOURCE_INFO.bulletin.note };
}

export function normalizeZhejiangRubber(raw) {
  const article = raw.data;
  const date = article?.releaseTime?.match(/^(\d{4})年(\d{2})月(\d{2})日$/);
  invariant(raw.code === 200 && article?.newsTotal?.includes('橡胶') && date && typeof article.digest === 'string' && article.digest.trim(), 'INVALID_PUBLIC_DATA', '浙江大宗橡胶业务资讯缺少正文或发布日期', 502);
  const publishedDay = date.slice(1).join('-');
  return { title: cleanText(article.newsTotal), publishedAt: `${publishedDay}T00:00:00+08:00`, summary: cleanText(article.digest),
    sourceUrl: SOURCE_INFO.zhejiang_rubber.url, articleUrl: article.newsInfo,
    scope: '浙江大宗橡胶现货仓单业务', period: `${publishedDay}发布的业务资讯`, limitation: SOURCE_INFO.zhejiang_rubber.note };
}

export class PublicDataService {
  constructor({ directory, config, fetchImpl = fetch, clock = () => new Date(), onChange = () => {} }) {
    Object.assign(this, { directory, config: validateConfig(config), fetchImpl, clock, onChange });
    this.sourceIds = config.enabledSources ?? Object.keys(SOURCE_INFO);
    mkdirSync(resolve(directory, 'snapshots'), { recursive: true });
    try { this.records = JSON.parse(readFileSync(resolve(directory,'latest.json'),'utf8')); } catch { this.records = {}; }
    this.inflight = null; this.timer = null;
  }
  async get(url, format = 'json', timeoutMs = 15000) {
    let response;
    try { response = await this.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: format === 'json' ? 'application/json' : 'text/html', 'User-Agent': 'RubberHarnessResearch/2.1' } }); }
    catch { throw new AppError('SOURCE_UNAVAILABLE','公开数据源网络不可用或超时',503); }
    if (!response.ok) throw new AppError(response.status === 404 ? 'SOURCE_NOT_PUBLISHED' : 'SOURCE_UNAVAILABLE',`上游返回 HTTP ${response.status}`,503);
    const raw = await readBounded(response, 4 * 1024 * 1024);
    if (format === 'text') return raw;
    try { return JSON.parse(raw); } catch { throw new AppError('INVALID_PUBLIC_DATA','上游不是合法 JSON',502); }
  }
  async collect(name) {
    const now = this.clock(); let raw, data, sourceUrl;
    if (name === 'weather') { sourceUrl = weatherUrl(this.config.location); raw = await this.get(sourceUrl); data = normalizeWeather(raw, this.config.location, now); }
    else if (name === 'bulletin') { sourceUrl = SOURCE_INFO.bulletin.url; raw = await this.get(sourceUrl,'text'); data = normalizeBulletin(raw); }
    else if (name === 'zhejiang_rubber') { sourceUrl = SOURCE_INFO.zhejiang_rubber.url; raw = await this.get(sourceUrl); data = normalizeZhejiangRubber(raw); }
    else if (['monthly_report','pest_updates','production_national','production_hainan'].includes(name)) {
      sourceUrl=SOURCE_INFO[name].url;
      if(['monthly_report','pest_updates'].includes(name)) { const directoryHtml=await this.get(sourceUrl,'text'); sourceUrl=discoverReport(directoryHtml,name,now).url; }
      raw=await this.get(sourceUrl,'text'); data=normalizeReport(raw,name,now);
    }
    else {
      for (const date of candidateDays(now, this.config.marketLookbackDays)) {
        sourceUrl = name === 'market' ? `https://www.shfe.com.cn/data/tradedata/future/dailydata/kx${date}.dat` : `https://www.shfe.com.cn/data/tradedata/future/stockdata/dailystock_${date}/ZH/all.html`;
        try { raw = await this.get(sourceUrl, name === 'market' ? 'json' : 'text'); }
        catch(e) { if (e.code === 'SOURCE_NOT_PUBLISHED') continue; throw e; }
        try { data = name === 'market' ? normalizeMarket(raw,date) : normalizeWarehouse(raw,date); }
        catch(e) { if (e.code === 'SOURCE_NOT_PUBLISHED') continue; throw e; }
        break;
      }
      invariant(data, 'SOURCE_NOT_PUBLISHED', '回查日期内没有已发布数据',503);
    }
    const contentHash = digest(raw), snapshotId = `${name}-${digest({ sourceUrl, contentHash, data, retrievedAt: iso(now) }).slice(0,24)}`;
    const packet = { snapshotId, source: name, provider: SOURCE_INFO[name].provider, sourceUrl, retrievedAt: iso(now), contentHash, data, raw };
    const path = resolve(this.directory, 'snapshots', `${snapshotId}.json`);
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(packet,null,2)+'\n', { flag:'wx' });
    return { snapshotId, sourceUrl, retrievedAt: packet.retrievedAt, contentHash, data };
  }
  async refresh({ force = false, notify = true } = {}) {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const changed = [];
      await Promise.all(this.sourceIds.map(async name => {
        const previous = this.records[name], now = this.clock();
        const cooldown = ['weather','market','warehouse'].includes(name) ? this.config.refreshMinutes * 60000 : 86400000;
        if (previous?.attemptedAt && +now - Date.parse(previous.attemptedAt) < (force ? 60000 : cooldown)) return;
        try {
          const next = await this.collect(name);
          if (previous?.contentHash && previous.contentHash !== next.contentHash) changed.push(name);
          this.records[name] = { ...next, attemptedAt: iso(now), lastError: null };
        }
        catch(e) { this.records[name] = { ...previous, attemptedAt: iso(now), lastError: { code: e.code ?? 'SOURCE_UNAVAILABLE', message: e instanceof AppError ? e.message : '数据源处理失败' } }; }
      }));
      const tmp = resolve(this.directory, 'latest.json.tmp'); writeFileSync(tmp, JSON.stringify(this.records,null,2)+'\n'); renameSync(tmp,resolve(this.directory,'latest.json'));
      if (notify && changed.length) {
        const sourceIds = [...new Set(changed)].sort();
        const eventId = `source-change-${digest({ sourceIds, snapshots: sourceIds.map(id => this.records[id]?.contentHash ?? null) }).slice(0,24)}`;
        await Promise.resolve(this.onChange({ sourceIds, eventId, at: iso(this.clock()) }));
      }
      return this.status();
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }
  status() {
    const now = this.clock();
    return { asOf: iso(now), location: this.config.location, refreshing: Boolean(this.inflight), sources: this.sourceIds.map(id => { const info=SOURCE_INFO[id];
      const r = this.records[id]; let stale = !r?.data;
      const validUntil = !r?.data ? null : id === 'weather' ? iso(Date.parse(r.retrievedAt) + this.config.maxWeatherAgeMinutes * 60000) : ['market','warehouse'].includes(id) ? iso(Date.parse((r.data.tradeDate ?? r.data.reportDate)+'T00:00:00+08:00')+10*86400000) : id === 'monthly_report' ? iso(Date.parse(r.data.publishedAt)+100*86400000) : id === 'bulletin' || id === 'pest_updates' ? `${String(r.data.publishedAt).slice(0,4)}-12-31T15:59:59.000Z` : iso(Date.parse(r.data.publishedAt)+550*86400000);
      if (r?.data) stale=+now>=Date.parse(validUntil) || id==='weather' && (JSON.stringify(r.data.location)!==JSON.stringify(this.config.location)||!r.data.forecast.some(x=>Date.parse(x.validFrom)>=+now));
      return { id, ...info, ...r, validUntil, stale, status: !r?.data ? 'unavailable' : r.lastError ? 'refresh_failed' : stale ? 'stale' : 'available' };
    }) };
  }
  archive(snapshotId) {
    invariant(/^[a-z_]+-[a-f0-9]{24}$/.test(snapshotId) && Object.hasOwn(SOURCE_INFO,snapshotId.split('-')[0]), 'INVALID_SOURCE_ID', '数据源快照编号无效',400);
    const path = resolve(this.directory,'snapshots',`${snapshotId}.json`); invariant(existsSync(path),'SOURCE_NOT_FOUND','数据源快照不存在',404);
    return JSON.parse(readFileSync(path,'utf8'));
  }
  start() { this.refresh().catch(e => console.error('Source refresh failed:',e.code ?? e.name)); this.timer = setInterval(() => this.refresh().catch(e => console.error('Source refresh failed:',e.code ?? e.name)),this.config.refreshMinutes * 60000); this.timer.unref(); }
  async stop() { clearInterval(this.timer); if(this.inflight) await this.inflight; }
}
