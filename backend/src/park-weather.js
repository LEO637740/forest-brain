import {parkSite} from './adapters/park-demo.js';
import {normalizeWeather, weatherUrl} from './adapters/public-data.js';
import {assessWeatherWindow, thresholdsFor, WEATHER_POLICY_VERSION} from './weather-policy.js';
import {digest} from './util.js';

const REFRESH_MS = 60 * 60000;
const MAX_AGE_MS = 120 * 60000;
const RETRY_MS = 2 * 60000;
const iso = value => new Date(value).toISOString();
const locationOf = park => ({name: park.name, ...park.center, siteId: park.siteId, confirmed: false});
const sourceUrl = location => weatherUrl(location, {forecastDays:8});

// Weather-only advice uses the selected park's coordinates. It deliberately
// does not create a strategy adoption or substitute a forecast for field checks.
export class ParkWeatherWindows {
  constructor({service, clock = () => new Date()}) {
    this.service = service;
    this.clock = clock;
    this.records = new Map();
    this.inflight = new Map();
  }

  peek(siteId) {
    const park = parkSite(siteId);
    return this.describe(park, locationOf(park), this.records.get(park.siteId));
  }

  async read(siteId, {force = false, maxAgeMs = REFRESH_MS} = {}) {
    const park = parkSite(siteId);
    const location = locationOf(park);
    let record = this.records.get(park.siteId);
    const now = +this.clock();
    const due = force || !record || now - record.attemptedAt >= (record.error ? RETRY_MS : maxAgeMs);
    if (this.service && due) {
      if (!this.inflight.has(park.siteId)) {
        const request = (async () => {
          try {
            const raw = await this.service.get(sourceUrl(location), 'json', 8000);
            const fetchedAt = this.clock();
            this.records.set(park.siteId, {data: normalizeWeather(raw, location, fetchedAt, {forecastHours:168, includeCurrentHour:true}), attemptedAt: +fetchedAt, error: null});
          } catch (error) {
            this.records.set(park.siteId, {...this.records.get(park.siteId), attemptedAt: +this.clock(),
              error: {code: error.code ?? 'SOURCE_UNAVAILABLE', message: error.code ? error.message : '天气服务暂时不可用'}});
          }
        })().finally(() => this.inflight.delete(park.siteId));
        this.inflight.set(park.siteId, request);
      }
      await this.inflight.get(park.siteId);
      record = this.records.get(park.siteId);
    }
    return this.describe(park, location, record);
  }

  describe(park, location, record) {
    const now = +this.clock(), data = record?.data;
    const future = data?.forecast.filter(step => Date.parse(step.validTo) > now) ?? [];
    const validUntil = data ? iso(Date.parse(data.fetchedAt) + MAX_AGE_MS) : null;
    const stale = !data || now >= Date.parse(validUntil) || !future.length;
    const status = !data ? 'unavailable' : stale ? 'stale' : record.error ? 'refresh_failed' : 'available';
    const hours = data ? [...data.recentModelHistory, ...data.forecast].map(step => ({...step, atMs:Date.parse(step.at)})) : [];
    const windows = stale ? [] : future.map(step => {
      // Each future window has its own preceding seven days. Forecast rain only
      // enters recovery checks after its interval ends, never before it falls.
      const start = Date.parse(step.validFrom);
      const preceding = hours.filter(hour => hour.atMs > start - 7 * 86400000 && hour.atMs <= start);
      // Soil moisture is instantaneous at the API timestamp; take that hour's
      // model value, rather than carrying today's wet soil through the week.
      const soil = hours.find(hour => hour.atMs === start)?.soilMoistureM3M3;
      const observed = {
        rainfallMm: null,
        recentRainfall:preceding.filter(hour => hour.rainfallMm !== null).map(hour => ({rainfallMm:hour.rainfallMm, quality:'valid'})),
        soilMoisture:soil == null ? null : {value:soil * 100},
        dryRubberContent:null,
      };
      const assessment = assessWeatherWindow({observed, step, siteId: park.siteId});
      const missing = assessment.suitability !== 'defer' && (step.rainfallMm === null || step.rainProbabilityPct === null);
      return {start: step.validFrom, end: step.validTo, rainfallMm: step.rainfallMm, rainProbabilityPct: step.rainProbabilityPct,
        airTemperatureC: step.airTemperatureC, relativeHumidityPct: step.relativeHumidityPct,
        recentRainfallTotalMm:assessment.recentRainfallTotalMm, soilMoisturePct:assessment.soilMoisturePct,
        suitability: missing ? 'review' : assessment.suitability,
        reason: missing ? '本时段降雨预报不完整，请更新天气后复核。' : assessment.reason};
    });
    const suitable = windows.filter(step => step.suitability === 'suitable').length;
    const review = windows.filter(step => step.suitability === 'review').length;
    const summary = !data ? '尚未获取当前园区天气，暂不能判断作业窗口。'
      : stale ? '天气数据已过期，请更新后重新判断作业窗口。'
      : suitable ? `未来 ${windows.length} 个小时中有 ${suitable} 个天气候选时段，作业前核对现场条件。`
      : review === windows.length ? `未来 ${windows.length} 个小时均需现场复核，重点核对雨后地表与干胶含量。`
      : review ? `未来 ${windows.length} 个小时中有 ${review} 个时段需现场复核，其余时段建议暂缓。`
      : '未来预报时段降雨风险较高，建议暂缓割胶并等待天气更新。';
    const thresholds = thresholdsFor(park.siteId);
    const active = windows.find(step => Date.parse(step.start) <= now && Date.parse(step.end) > now);
    const current = data?.currentEstimate ?? null;
    const currentFresh = current && now >= Date.parse(current.at) && now - Date.parse(current.at) <= current.intervalSeconds * 1000;
    const currentRainfallMm = currentFresh ? current.precipitationMm : null;
    const currentHeavy = currentRainfallMm !== null && currentRainfallMm > thresholds.lightRainMaxMmPerPeriod;
    const suitability = status !== 'available' || !active ? 'unavailable' : currentHeavy ? 'defer' : active.suitability;
    const execution = {allowed:suitability === 'suitable', suitability, checkedAt:iso(now),
      windowStart:active?.start ?? null, windowEnd:active?.end ?? null, currentRainfallMm,
      reason:status === 'refresh_failed' ? '最新天气刷新失败，等待恢复后再核验开割。'
        : stale ? summary
        : !active ? '当前时段没有天气预报覆盖，等待天气更新后再开割。'
        : currentHeavy ? `当前 ${current.intervalSeconds / 60} 分钟降雨 ${currentRainfallMm} mm 已超过小时降雨边界 ${thresholds.lightRainMaxMmPerPeriod} mm，暂停开割并等待更新。`
        : active.suitability === 'review' ? `当前时段待现场复核，暂不允许开割：${active.reason}`
        : active.reason};
    const decisionFingerprint = digest({siteId:park.siteId, location, policyVersion:WEATHER_POLICY_VERSION, thresholds,
      windows:windows.map(({start,end,rainfallMm,rainProbabilityPct,suitability}) => ({start,end,rainfallMm,rainProbabilityPct,suitability})),
      execution:{allowed:execution.allowed,suitability:execution.suitability}});
    return {siteId: park.siteId, siteName: park.name, location, provider: 'Open-Meteo', sourceUrl: sourceUrl(location),
      basis: 'weather_model', fetchedAt: data?.fetchedAt ?? null, validUntil, checkedAt: iso(now), status, stale,
      error: record?.error ?? (!this.service ? {code: 'PUBLIC_SOURCES_DISABLED', message: '当前进程未启用在线天气服务'} : null),
      current, windows, summary, decisionFingerprint, execution,
      thresholds, policyVersion: WEATHER_POLICY_VERSION, refreshMinutes: REFRESH_MS / 60000,
      limitation: '按当前园区地图中心坐标获取 Open-Meteo 区域模型天气；园区坐标为演示位置，不是现场气象站实测。窗口按现有规则判断，干胶含量未测；作业前仍需核对现场情况。'};
  }
}
