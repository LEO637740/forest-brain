import {invariant} from './errors.js';
import {normalizeSiteId,parkSite,TREE_IDS} from './adapters/park-demo.js';
import {assessWeatherWindow,thresholdsFor,thresholdVersionFor,WEATHER_THRESHOLDS} from './weather-policy.js';
import {PARAMETER_SPECS} from './cerebellum.js';
import {classifyStrategyRoute,SIGNAL_LABELS,BLOCKER_LABELS} from './strategy-routing.js';

// Recursive self-improvement of the small brain ("递归自我提升", 10-11 meeting).
// The brain keeps an experience store of real past mornings (forecast the rule
// would have seen, rain that actually fell), replays candidate thresholds
// through the exact small-brain weather rule in a side-effect-free sandbox,
// proposes the best single guarded step with its evidence, and reviews the
// adopted version once enough new mornings have passed.  Each approved review
// becomes the baseline of the next cycle.  People still approve every change.
export const RSI_POLICY_VERSION = 'brain-rsi-v1';
const DAY = 86400000, HISTORY_DAYS = 60, WARMUP_DAYS = 7, REVIEW_MIN_DAYS = 7, WINDOW_HOURS = [5, 9];
// Field truth is fixed and independent of the thresholds being judged.
export const RAIN_TRUTH = Object.freeze({windowMm:1, hourlyMm:0.5});
export const REPLAY_COST = Object.freeze({miss:3, falseDefer:1, extraReview:0.2});
const TUNABLE = ['rainProbabilityDeferPct', 'lightRainMaxMmPerPeriod', 'recentWetSpellMm'];
const OUTCOME_LABELS = {correct_tap:'正确开割', correct_defer:'正确暂缓', false_defer:'误停（未下雨却暂缓）', miss:'漏停（下雨仍安排割胶）', extra_review:'多余复核（未下雨却要求现场复核）'};
const DECISION_LABELS = {suitable:'可割', review:'现场复核后割', defer:'暂缓'};
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const beijingDate = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const hash = text => { let value = 2166136261; for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619) >>> 0; } return value; };

/** Group hourly Open-Meteo rows into one record per morning tapping window. */
export function dailyExperience(forecast, archive) {
  const days = new Map(), day = date => days.get(date) ?? days.set(date, {date, forecastMaxProbPct:0, forecastMaxHourlyMm:0, actualWindowMm:0, actualMaxHourlyMm:0, actualDayMm:0, preWindowMm:0, complete:true}).get(date);
  const hourOf = time => Number(time.slice(11, 13)), inWindow = hour => hour >= WINDOW_HOURS[0] && hour < WINDOW_HOURS[1];
  forecast.hourly.time.forEach((time, i) => {
    if (!inWindow(hourOf(time))) return;
    const row = day(time.slice(0, 10)), mm = forecast.hourly.precipitation[i], prob = forecast.hourly.precipitation_probability[i];
    if (mm === null || prob === null) row.complete = false;
    row.forecastMaxProbPct = Math.max(row.forecastMaxProbPct, prob ?? 0);
    row.forecastMaxHourlyMm = round(Math.max(row.forecastMaxHourlyMm, mm ?? 0), 2);
  });
  archive.hourly.time.forEach((time, i) => {
    const row = day(time.slice(0, 10)), mm = archive.hourly.precipitation[i], hour = hourOf(time);
    if (mm === null) { row.complete = false; return; }
    row.actualDayMm = round(row.actualDayMm + mm, 2);
    if (hour === WINDOW_HOURS[0] - 1) row.preWindowMm = round(mm, 2);
    if (inWindow(hour)) { row.actualWindowMm = round(row.actualWindowMm + mm, 2); row.actualMaxHourlyMm = round(Math.max(row.actualMaxHourlyMm, mm), 2); }
  });
  return [...days.values()].filter(row => row.complete).map(({complete, ...row}) => row).sort((a, b) => a.date.localeCompare(b.date));
}

/** Reproducible stand-in used only when the archive cannot be reached; always labelled simulated. */
export function simulatedExperience(siteId, endDate, days = HISTORY_DAYS) {
  const park = parkSite(siteId), wetness = {tropical:34, tropical_highland:42, subtropical:30, temperate_trial:18}[park.climate];
  return Array.from({length:days}, (_, i) => {
    const date = beijingDate(Date.parse(`${endDate}T00:00:00+08:00`) - (days - 1 - i) * DAY), seed = hash(`${park.key}:${date}`);
    const prob = Math.max(0, Math.min(100, wetness + (seed % 70) - 35)), rainy = (seed >>> 8) % 100 < prob * 0.7;
    const windowMm = rainy ? round(((seed >>> 4) % 60) / 10, 1) : 0;
    return {date, forecastMaxProbPct:prob, forecastMaxHourlyMm:round(prob >= 50 ? ((seed >>> 12) % 20) / 10 : 0, 1), actualWindowMm:windowMm,
      actualMaxHourlyMm:round(windowMm / 2, 1), actualDayMm:round(windowMm * 1.8 + ((seed >>> 16) % 30) / 10 * (rainy ? 1 : 0.2), 1), preWindowMm:0};
  });
}

/** Run the real small-brain weather rule on each past morning with the given thresholds. */
export function replayDecisions(days, thresholds) {
  const rows = [];
  for (let i = WARMUP_DAYS; i < days.length; i++) {
    const day = days[i];
    const observed = {observationId:`replay-${day.date}`, rainfallMm:day.preWindowMm,
      recentRainfall:days.slice(i - WARMUP_DAYS, i).map(prev => ({observationId:`replay-${prev.date}`, rainfallMm:prev.actualDayMm, quality:'valid'}))};
    const decision = assessWeatherWindow({observed, step:{rainfallMm:day.forecastMaxHourlyMm, rainProbabilityPct:day.forecastMaxProbPct}, thresholds}).suitability;
    const rained = day.actualWindowMm >= RAIN_TRUTH.windowMm || day.actualMaxHourlyMm >= RAIN_TRUTH.hourlyMm;
    const outcome = decision === 'defer' ? (rained ? 'correct_defer' : 'false_defer') : rained ? 'miss' : decision === 'review' ? 'extra_review' : 'correct_tap';
    rows.push({date:day.date, decision, rained, outcome, forecastMaxProbPct:day.forecastMaxProbPct, forecastMaxHourlyMm:day.forecastMaxHourlyMm, actualWindowMm:day.actualWindowMm});
  }
  const count = outcome => rows.filter(row => row.outcome === outcome).length;
  const metrics = {days:rows.length, rainyMornings:rows.filter(row => row.rained).length, tappedDays:rows.filter(row => row.decision !== 'defer').length,
    correctTap:count('correct_tap'), correctDefer:count('correct_defer'), falseDefer:count('false_defer'), miss:count('miss'), extraReview:count('extra_review')};
  metrics.cost = round(metrics.miss * REPLAY_COST.miss + metrics.falseDefer * REPLAY_COST.falseDefer + metrics.extraReview * REPLAY_COST.extraReview, 1);
  return {metrics, rows};
}

const better = (a, b) => a.cost < b.cost - 1e-9 || (Math.abs(a.cost - b.cost) < 1e-9 && a.miss < b.miss);

/** Explore each tunable threshold step by step inside its guardrails; propose only the first step. */
export function searchImprovement(days, current) {
  const baseline = replayDecisions(days, current).metrics, directions = [];
  for (const key of TUNABLE) {
    const spec = PARAMETER_SPECS[key];
    for (const sign of [-1, 1]) {
      const path = [];
      for (let value = round(current[key] + sign * spec.step, spec.digits); value >= spec.min - 1e-9 && value <= spec.max + 1e-9; value = round(value + sign * spec.step, spec.digits))
        path.push({to:value, metrics:replayDecisions(days, {...current, [key]:value}).metrics});
      if (!path.length) continue;
      const best = path.reduce((winner, step, index) => better(step.metrics, winner.metrics) ? {...step, steps:index + 1} : winner, {...path[0], steps:1});
      directions.push({key, label:spec.label, unit:spec.unit, from:current[key], firstStep:path[0], best, gain:round(baseline.cost - best.metrics.cost, 1)});
    }
  }
  // A worse first step is never proposed, even if the far end of the path looks better.
  const viable = directions.filter(item => item.gain > 0 && item.firstStep.metrics.cost <= baseline.cost + 1e-9 && item.firstStep.metrics.miss <= baseline.miss)
    .sort((a, b) => b.gain - a.gain || a.best.steps - b.best.steps);
  return {baseline, recommendation:viable[0] ?? null, explored:directions.map(item => ({key:item.key, label:item.label, direction:item.firstStep.to > item.from ? 'up' : 'down',
    firstStep:{to:item.firstStep.to, cost:item.firstStep.metrics.cost}, best:{to:item.best.to, steps:item.best.steps, cost:item.best.metrics.cost}, gain:item.gain}))};
}

export function changedDays(before, after) {
  return after.rows.map((row, i) => ({row, prev:before.rows[i]})).filter(({row, prev}) => row.decision !== prev.decision)
    .map(({row, prev}) => ({date:row.date, before:DECISION_LABELS[prev.decision], after:DECISION_LABELS[row.decision], rained:row.rained,
      actualWindowMm:row.actualWindowMm, effect:row.outcome === prev.outcome ? '结果不变' : `${OUTCOME_LABELS[prev.outcome]} → ${OUTCOME_LABELS[row.outcome]}`}));
}

/** Experience store: real past mornings per park, cached in SQLite. */
export class WeatherExperience {
  constructor({store, clock = () => new Date(), fetchJson = null, offline = false}) {
    Object.assign(this, {store, clock, offline});
    this.fetchJson = fetchJson ?? (async url => { const response = await fetch(url, {signal:AbortSignal.timeout(15000)}); invariant(response.ok, 'SOURCE_UNAVAILABLE', `历史天气服务返回 ${response.status}`, 502); return response.json(); });
    store.db.exec(`CREATE TABLE IF NOT EXISTS brain_weather_days (
      site_id TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL, retrieved_at TEXT NOT NULL, PRIMARY KEY(site_id, date)
    )`);
  }
  range() { const now = +this.clock(); return {start:beijingDate(now - HISTORY_DAYS * DAY), end:beijingDate(now - DAY)}; }
  cached(siteId) {
    const {start, end} = this.range();
    const rows = this.store.db.prepare('SELECT body,retrieved_at FROM brain_weather_days WHERE site_id=? AND date>=? AND date<=? ORDER BY date').all(siteId, start, end);
    if (!rows.length) return null;
    return {days:rows.map(row => JSON.parse(row.body)), source:'measured', retrievedAt:rows.map(row => row.retrieved_at).sort().at(-1)};
  }
  async load(siteId) {
    siteId = normalizeSiteId(siteId);
    const {start, end} = this.range(), cached = this.cached(siteId);
    if (cached && cached.days.at(-1).date >= end && cached.days.length >= HISTORY_DAYS - 5) return {...cached, start, end, stale:false};
    if (!this.offline) {
      try {
        const {latitude, longitude} = parkSite(siteId).center, common = `latitude=${latitude}&longitude=${longitude}&start_date=${start}&end_date=${end}&timezone=Asia%2FShanghai`;
        const [forecast, archive] = await Promise.all([
          this.fetchJson(`https://historical-forecast-api.open-meteo.com/v1/forecast?${common}&hourly=precipitation,precipitation_probability`),
          this.fetchJson(`https://archive-api.open-meteo.com/v1/archive?${common}&hourly=precipitation`)]);
        const days = dailyExperience(forecast, archive), retrievedAt = this.clock().toISOString();
        invariant(days.length > WARMUP_DAYS, 'SOURCE_UNAVAILABLE', '历史天气记录不足，无法回放。', 502);
        const save = this.store.db.prepare('INSERT OR REPLACE INTO brain_weather_days VALUES(?,?,?,?)');
        this.store.transaction(() => { for (const day of days) save.run(siteId, day.date, JSON.stringify(day), retrievedAt); });
        return {days, source:'measured', retrievedAt, start, end, stale:false};
      } catch (error) {
        if (cached) return {...cached, start, end, stale:true, error:error.message};
      }
    }
    return {days:simulatedExperience(siteId, end), source:'simulated', retrievedAt:null, start, end, stale:false};
  }
}

const SOURCE_NOTE = {
  measured:'Open-Meteo 历史预报（各次预报最初时段拼接，代表当天早上能看到的预报）与 ERA5 再分析实况降雨，按园区中心坐标取 5–9 点割胶时段。',
  simulated:'未能取得历史天气，使用按园区气候生成的模拟早晨记录；结论只演示流程。',
};

export class BrainEvolution {
  constructor({cerebellum, makeParkContext, experience, clock = () => new Date(), routingEvolution = null}) {
    Object.assign(this, {cerebellum, makeParkContext, experience, clock, routingEvolution});
    // Model and rule proposals are replayed on the cached experience before anyone approves them.
    cerebellum.replayer = (siteId, changes) => this.replayChanges(siteId, changes);
  }

  replayChanges(siteId, changes, experience = this.experience.cached(siteId)) {
    if (!experience || experience.days.length <= WARMUP_DAYS) return null;
    const current = thresholdsFor(siteId), next = {...current, ...Object.fromEntries(changes.map(change => [change.key, change.to]))};
    const before = replayDecisions(experience.days, current), after = replayDecisions(experience.days, next);
    const verdict = after.metrics.cost < before.metrics.cost - 1e-9 ? 'better' : after.metrics.cost > before.metrics.cost + 1e-9 ? 'worse' : 'same';
    return {policyVersion:RSI_POLICY_VERSION, source:experience.source, sourceNote:SOURCE_NOTE[experience.source], from:experience.days[WARMUP_DAYS]?.date, to:experience.days.at(-1).date,
      costModel:REPLAY_COST, truth:RAIN_TRUTH, before:before.metrics, after:after.metrics, verdict, changedDays:changedDays(before, after)};
  }

  /** Post-adoption review: compare the active version with its predecessor on mornings after activation. */
  review(siteId, days) {
    const active = this.cerebellum.history(siteId)[0];
    if (!active) return {status:'default', summary:'仍使用默认参数，尚无上线版本需要复盘。'};
    const since = beijingDate(Date.parse(active.activatedAt));
    const index = days.findIndex(day => day.date > since), after = index < 0 ? [] : days.slice(Math.max(0, index - WARMUP_DAYS));
    const collected = index < 0 ? 0 : days.length - index;
    if (collected < REVIEW_MIN_DAYS) return {status:'collecting', version:active.version, activatedAt:active.activatedAt, collectedDays:collected, neededDays:REVIEW_MIN_DAYS,
      summary:`v${active.version} 上线后已有 ${collected} 个早晨的实况，满 ${REVIEW_MIN_DAYS} 个后自动复盘。`};
    const now = replayDecisions(after, active.thresholds).metrics, before = replayDecisions(after, active.previous ?? WEATHER_THRESHOLDS).metrics;
    const verdict = now.cost <= before.cost ? 'keep' : 'rollback_suggested';
    return {status:'reviewed', version:active.version, activatedAt:active.activatedAt, collectedDays:collected, active:now, previous:before, verdict,
      summary:verdict === 'keep' ? `v${active.version} 上线后 ${collected} 个早晨：误停 ${now.falseDefer}、漏停 ${now.miss}，不差于旧参数（误停 ${before.falseDefer}、漏停 ${before.miss}），建议保留。`
        : `v${active.version} 上线后 ${collected} 个早晨：误停 ${now.falseDefer}、漏停 ${now.miss}，比旧参数（误停 ${before.falseDefer}、漏停 ${before.miss}）差，建议回退到上一版本。`};
  }

  /** How today's single-tree requests split between the small brain, the big brain and data holds. */
  routing(siteId) {
    const now = this.clock(), context = this.makeParkContext({siteId, treeIds:TREE_IDS, now});
    const routes = TREE_IDS.map(treeId => classifyStrategyRoute(context, {treeId, kind:'tapping_angle'}));
    const tally = (items, labels) => Object.entries(items.reduce((sum, key) => ({...sum, [key]:(sum[key] ?? 0) + 1}), {}))
      .map(([key, count]) => ({key, label:labels[key] ?? key, count})).sort((a, b) => b.count - a.count);
    const by = executor => routes.filter(route => route.executor === executor);
    return {kind:'tapping_angle', kindLabel:'单树割胶参数', total:routes.length, delegated:routes.filter(route => route.delegation).length,
      evolution:this.routingEvolution?.digest(siteId) ?? null,
      smallBrain:by('small_brain').length, bigBrain:by('big_brain').length, blocked:by('blocked').length,
      bigBrainReasons:tally(by('big_brain').flatMap(route => route.triggers), SIGNAL_LABELS),
      blockedReasons:tally(by('blocked').flatMap(route => route.blockers), BLOCKER_LABELS),
      examples:{bigBrain:by('big_brain').slice(0, 3).map(route => route.treeId), blocked:by('blocked').slice(0, 3).map(route => route.treeId)}};
  }

  /** Each approved version is one generation of the small brain, with the replay that justified it. */
  generations(siteId) {
    const proposals = this.cerebellum.proposals(siteId);
    return this.cerebellum.history(siteId).slice().reverse().map(set => {
      const proposal = proposals.find(item => item.id === set.proposalId);
      return {version:set.version, activatedAt:set.activatedAt, source:set.source, approvedBy:set.approvedBy, rolledBackTo:set.rolledBackTo ?? null,
        changes:proposal?.changes.map(change => `${change.label} ${change.from}→${change.to}${change.unit}`) ?? [],
        replay:proposal?.replay ? {before:proposal.replay.before.cost, after:proposal.replay.after.cost, source:proposal.replay.source} : null};
    });
  }

  summarize(siteId, experience) {
    const current = thresholdsFor(siteId), search = searchImprovement(experience.days, current), rec = search.recommendation;
    const pending = this.cerebellum.proposals(siteId).find(item => item.status === 'pending') ?? null;
    return {siteId, park:parkSite(siteId).name, policyVersion:RSI_POLICY_VERSION, generatedAt:this.clock().toISOString(),
      activeVersion:thresholdVersionFor(siteId), thresholds:current,
      experience:{source:experience.source, sourceNote:SOURCE_NOTE[experience.source], start:experience.start, end:experience.end, days:experience.days.length,
        retrievedAt:experience.retrievedAt, stale:experience.stale ?? false, rainyMornings:search.baseline.rainyMornings},
      costModel:REPLAY_COST, truth:RAIN_TRUTH, baseline:search.baseline, explored:search.explored,
      recommendation:rec ? {key:rec.key, label:rec.label, unit:rec.unit, from:rec.from, to:rec.firstStep.to, firstStep:rec.firstStep.metrics,
        best:{to:rec.best.to, steps:rec.best.steps, metrics:rec.best.metrics}, gain:rec.gain,
        summary:`${rec.label} ${rec.from}→${rec.firstStep.to}${rec.unit}：回放成本 ${search.baseline.cost}→${rec.firstStep.metrics.cost}${rec.firstStep.metrics.cost < search.baseline.cost ? '' : '（这一步持平，不增加误停和漏停）'}${rec.best.steps > 1 ? `；同方向调到 ${rec.best.to}${rec.unit}（${rec.best.steps} 步）可降到 ${rec.best.metrics.cost}，下一轮复盘后再走` : ''}。`} : null,
      headline:rec ? `过去 ${search.baseline.days} 个早晨回放：当前参数误停 ${search.baseline.falseDefer} 天、漏停 ${search.baseline.miss} 天、多余复核 ${search.baseline.extraReview} 天；${rec.firstStep.metrics.cost < search.baseline.cost
        ? `${rec.label}调整一步可把回放成本从 ${search.baseline.cost} 降到 ${rec.firstStep.metrics.cost}。`
        : `${rec.label}朝 ${rec.best.to}${rec.unit} 方向调整可把回放成本从 ${search.baseline.cost} 降到 ${rec.best.metrics.cost}，按护栏先走一步（${rec.from}→${rec.firstStep.to}${rec.unit}）。`}`
        : `过去 ${search.baseline.days} 个早晨回放：当前参数误停 ${search.baseline.falseDefer} 天、漏停 ${search.baseline.miss} 天、多余复核 ${search.baseline.extraReview} 天；在护栏内已没有更好的单步调整。`,
      pendingProposal:pending ? {id:pending.id, expectedEffect:pending.expectedEffect, verdict:pending.replay?.verdict ?? null} : null,
      review:this.review(siteId, experience.days), generations:this.generations(siteId), routing:this.routing(siteId),
      loop:['经验：真实早晨的预报与实况', '回放：同一条小脑规则重算', '提案：护栏内单步、附证据', '审批：人工批准才生效', '复盘：上线满 7 个早晨对比新旧参数'],
      limitations:['只回放天气窗口相关的三项阈值；土壤水分与干胶含量缺少历史实测，未参与回放。', `“下雨”按割胶时段累计 ≥ ${RAIN_TRUTH.windowMm} mm 或单小时 ≥ ${RAIN_TRUTH.hourlyMm} mm 判定；成本权重为演示先验。`,
        '回放用园区中心坐标的格点天气，不等于园区雨量计；接入现场雨量计后替换。']};
  }

  async evaluate(siteId) { siteId = normalizeSiteId(siteId); return this.summarize(siteId, await this.experience.load(siteId)); }

  /** Cached-only view for the decision list and the assistant (never waits on the network). */
  snapshot(siteId) {
    siteId = normalizeSiteId(siteId);
    const cached = this.experience.cached(siteId);
    return cached && cached.days.length > WARMUP_DAYS ? this.summarize(siteId, {...cached, ...this.experience.range()}) : null;
  }

  async propose(siteId, createdBy) {
    siteId = normalizeSiteId(siteId);
    return this.proposeWith(siteId, await this.experience.load(siteId), createdBy);
  }

  /** Same proposal from the cached experience, for synchronous assistant tools; null when nothing is cached. */
  proposeFromCache(siteId, createdBy) {
    siteId = normalizeSiteId(siteId);
    const cached = this.experience.cached(siteId);
    return cached && cached.days.length > WARMUP_DAYS ? this.proposeWith(siteId, {...cached, ...this.experience.range()}, createdBy) : null;
  }

  proposeWith(siteId, experience, createdBy) {
    const summary = this.summarize(siteId, experience), rec = summary.recommendation;
    invariant(rec, 'NO_IMPROVEMENT', `回放过去 ${summary.baseline.days} 个早晨，当前参数在护栏内已是最优，暂不需要调整。`, 409);
    const change = {key:rec.key, label:rec.label, unit:rec.unit, from:rec.from, to:rec.to,
      reason:`回放 ${summary.baseline.days} 个早晨：误停 ${summary.baseline.falseDefer}→${rec.firstStep.falseDefer}、漏停 ${summary.baseline.miss}→${rec.firstStep.miss}、多余复核 ${summary.baseline.extraReview}→${rec.firstStep.extraReview}。`};
    const proposal = this.cerebellum.createProposal(siteId, [change], {createdBy, origin:'rsi_replay', summary:`大脑用${experience.source === 'measured' ? '真实' : '模拟'}天气回放 ${summary.baseline.days} 个早晨，找到护栏内的改进：${rec.summary}`,
      replay:this.replayChanges(siteId, [change], experience)});
    return {proposal, evaluation:this.summarize(siteId, experience)};
  }
}
