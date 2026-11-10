import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {normalizeSiteId,parkSite} from './adapters/park-demo.js';
import {WEATHER_THRESHOLDS,setCerebellumThresholds,thresholdsFor,thresholdVersionFor} from './weather-policy.js';

// "Brain adjusts the small brain": the conversation brain reflects on the
// park climate and recent execution feedback, then proposes bounded changes
// to the rule thresholds used by every small-brain decision.  A proposal never
// applies itself.  A manager of that park or the center approves it, the new
// version becomes the input of the rule generator *and* of the independent
// validator, and any version can be rolled back.  This is iterative
// configuration with an audit trail, not model training.
export const CEREBELLUM_POLICY_VERSION = 'cerebellum-tuning-v1';

export const PARAMETER_SPECS = Object.freeze({
  lightRainMaxMmPerPeriod:{label:'小雨作业上限',unit:'mm/时段',min:0.2,max:1.5,step:0.3,digits:1},
  rainProbabilityDeferPct:{label:'降雨概率暂缓阈值',unit:'%',min:40,max:80,step:10,digits:0},
  recentWetSpellMm:{label:'近7日连阴雨判定',unit:'mm',min:3,max:15,step:3,digits:1},
  soilWetPct:{label:'土壤偏湿阈值',unit:'%',min:55,max:80,step:5,digits:0},
  dryRubberLowPct:{label:'干胶含量偏低阈值',unit:'%',min:25,max:35,step:3,digits:1},
});
const KEYS = Object.keys(PARAMETER_SPECS);
const CLIMATE_LABELS = {tropical:'热带低海拔',tropical_highland:'热带高原（雾多、湿度高）',subtropical:'南亚热带（秋季台风雨）',temperate_trial:'温带试验站'};
const round = (value,digits) => Math.round(value*10**digits)/10**digits;
const FEEDBACK_DAYS = 14;

/** Bounds and step limits are hard safety rails for both rule and model proposals. */
export function checkChanges(current, changes) {
  const problems = [];
  invariant(Array.isArray(changes) && changes.length > 0 && changes.length <= KEYS.length, 'INVALID_PROPOSAL', '参数调整至少包含一项、且不能超过可调参数数量。');
  const seen = new Set();
  for (const change of changes) {
    const spec = PARAMETER_SPECS[change?.key];
    if (!spec) { problems.push(`未知参数 ${change?.key}`); continue; }
    if (seen.has(change.key)) problems.push(`${spec.label}重复`);
    seen.add(change.key);
    if (!Number.isFinite(change.to)) { problems.push(`${spec.label}缺少新值`); continue; }
    if (change.to < spec.min || change.to > spec.max) problems.push(`${spec.label}须在 ${spec.min}–${spec.max}${spec.unit} 内`);
    if (Math.abs(change.to - current[change.key]) > spec.step + 1e-9) problems.push(`${spec.label}单次最多调整 ${spec.step}${spec.unit}`);
    if (change.to === current[change.key]) problems.push(`${spec.label}没有变化`);
  }
  return problems;
}

export class CerebellumTuning {
  constructor({store, simulation, clock = () => new Date(), onApproved = null}) {
    Object.assign(this, {store, simulation, clock, onApproved});
    store.db.exec(`CREATE TABLE IF NOT EXISTS cerebellum_param_sets (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(site_id, version)
    );
    CREATE TABLE IF NOT EXISTS cerebellum_proposals (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    this.loadedSites = new Set();
    for (const row of store.db.prepare(`SELECT site_id,body FROM cerebellum_param_sets p WHERE version=(SELECT MAX(version) FROM cerebellum_param_sets WHERE site_id=p.site_id)`).all()) {
      const set = JSON.parse(row.body);
      setCerebellumThresholds(row.site_id, set.thresholds, `v${set.version}`);
      this.loadedSites.add(row.site_id);
    }
  }
  close() { for (const siteId of this.loadedSites) setCerebellumThresholds(siteId, null); }
  current(siteId) { return {...thresholdsFor(siteId)}; }
  history(siteId) {
    return this.store.db.prepare('SELECT body FROM cerebellum_param_sets WHERE site_id=? ORDER BY version DESC').all(siteId).map(row => JSON.parse(row.body));
  }
  proposals(siteId) {
    return this.store.db.prepare('SELECT body FROM cerebellum_proposals WHERE site_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(siteId).map(row => JSON.parse(row.body));
  }
  proposal(id) {
    const row = this.store.db.prepare('SELECT body FROM cerebellum_proposals WHERE id=?').get(id);
    invariant(row, 'PROPOSAL_NOT_FOUND', '参数调整提案不存在。', 404);
    return JSON.parse(row.body);
  }
  saveProposal(proposal) {
    this.store.db.prepare(`INSERT INTO cerebellum_proposals VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body`)
      .run(proposal.id, proposal.siteId, proposal.status, JSON.stringify(proposal), proposal.createdAt);
    return proposal;
  }
  status(siteId) {
    siteId = normalizeSiteId(siteId);
    const history = this.history(siteId);
    return {siteId, park:parkSite(siteId).name, climate:parkSite(siteId).climate, climateLabel:CLIMATE_LABELS[parkSite(siteId).climate],
      policyVersion:CEREBELLUM_POLICY_VERSION, activeVersion:thresholdVersionFor(siteId), thresholds:this.current(siteId),
      defaults:{...WEATHER_THRESHOLDS}, specs:PARAMETER_SPECS, history, proposals:this.proposals(siteId),
      note:'参数作用于本园区小脑规则（天气作业窗口、割胶策略可割天数）及其独立校验；批准前不生效，可随时回滚。'};
  }

  /** Execution feedback the brain reflects on; every count links back to records. */
  feedback(siteId) {
    const since = +this.clock() - FEEDBACK_DAYS * 86400000;
    const events = this.simulation.operationalEvents.list(siteId).filter(event => Date.parse(event.createdAt) >= since);
    const rainEvents = events.filter(event => event.kind === 'rain');
    const tasks = this.simulation.latestTasks(siteId).filter(task => task.kind === '割胶' && (!task.date || Date.parse(task.date) >= since - 86400000));
    const weatherHeld = tasks.filter(task => (task.dispatch?.history ?? []).some(item => /天气|降雨|雨情|暂缓/.test(item?.label ?? ''))
      || /天气|降雨|雨/.test(task.blockedReason ?? ''));
    const deferredWindows = this.simulation.list(null, siteId).filter(action => action.kind === 'adopt_weather' && Date.parse(action.adoptedAt ?? 0) >= since);
    const completed = tasks.filter(task => task.status === '已完成');
    const cancelled = tasks.filter(task => task.status === '已取消');
    return {
      windowDays:FEEDBACK_DAYS,
      fieldRainEvents:{count:rainEvents.length,sourceRefs:rainEvents.map(event => event.id)},
      weatherHeldTasks:{count:weatherHeld.length,sourceRefs:weatherHeld.map(task => task.id)},
      adoptedWeatherWindows:{count:deferredWindows.length,sourceRefs:deferredWindows.map(action => action.requestId)},
      completedTasks:{count:completed.length,sourceRefs:completed.map(task => task.id)},
      cancelledTasks:{count:cancelled.length,sourceRefs:cancelled.map(task => task.id)},
      mode:'simulation',
    };
  }

  /** Rule-based reflection: climate prior plus feedback, bounded by PARAMETER_SPECS. */
  reflect(siteId, {createdBy = 'brain-reflection', origin = 'brain_reflection'} = {}) {
    siteId = normalizeSiteId(siteId);
    const park = parkSite(siteId), current = this.current(siteId), feedback = this.feedback(siteId);
    const changes = [];
    const propose = (key, delta, reason) => {
      const spec = PARAMETER_SPECS[key];
      const to = round(Math.min(spec.max, Math.max(spec.min, current[key] + delta)), spec.digits);
      if (to !== current[key] && !changes.some(item => item.key === key)) changes.push({key, label:spec.label, unit:spec.unit, from:current[key], to, reason});
    };
    const held = feedback.weatherHeldTasks.count + feedback.adoptedWeatherWindows.count, field = feedback.fieldRainEvents.count;
    if (held >= 3 && field <= 1)
      propose('rainProbabilityDeferPct', 5, `近${FEEDBACK_DAYS}日因天气暂缓 ${held} 次，但现场登记降雨仅 ${field} 次，现有阈值可能过早停割。`);
    if (field >= 3 && held <= field)
      propose('rainProbabilityDeferPct', -5, `近${FEEDBACK_DAYS}日现场登记降雨 ${field} 次，多于事前暂缓 ${held} 次，应更早暂缓。`);
    if (field >= 3) propose('lightRainMaxMmPerPeriod', -0.1, '现场降雨偏多，收紧小雨作业上限，减少雨中割胶。');
    // Climate priors only apply while the park still runs the default set.
    if (thresholdVersionFor(siteId) === 'default') {
      if (park.climate === 'tropical_highland') propose('soilWetPct', 5, '高原胶园晨雾和露水使土壤水分长期偏高，默认 65% 会把雾湿误判为连阴雨。');
      if (park.climate === 'subtropical') propose('lightRainMaxMmPerPeriod', -0.1, '秋季台风外围阵雨来得急，小雨作业上限宜收紧。');
      if (park.climate === 'temperate_trial') propose('recentWetSpellMm', -2, '试验站土壤保水差，较少降雨即影响割面，宜降低连阴雨判定。');
    }
    if (!changes.length) return {proposal:null, feedback, reason:'近期执行反馈与当前参数一致，暂不建议调整。'};
    const problems = checkChanges(current, changes);
    invariant(!problems.length, 'INVALID_PROPOSAL', problems.join('；'));
    return {proposal:this.saveProposal({...this.makeProposal(siteId, changes, {feedback, createdBy, origin,
      summary:`根据${CLIMATE_LABELS[park.climate]}气候与近${FEEDBACK_DAYS}日执行反馈，建议调整 ${changes.length} 项小脑参数。`}), replay:this.replayer?.(siteId, changes) ?? null}), feedback};
  }
  /** Proposal from the replay sandbox (brain-evolution); same guardrails, stays pending. */
  createProposal(siteId, changes, {createdBy, origin, summary, replay}) {
    siteId = normalizeSiteId(siteId);
    const problems = checkChanges(this.current(siteId), changes);
    invariant(!problems.length, 'INVALID_PROPOSAL', problems.join('；'));
    return this.saveProposal({...this.makeProposal(siteId, changes, {feedback:this.feedback(siteId), createdBy, origin, summary}), replay});
  }
  /** A model tool may propose too; it passes through the same hard bounds and stays pending. */
  proposeFromModel(siteId, {changes, rationale}, createdBy) {
    siteId = normalizeSiteId(siteId);
    const current = this.current(siteId);
    const normalized = (changes ?? []).map(change => ({key:change.key, label:PARAMETER_SPECS[change.key]?.label ?? change.key,
      unit:PARAMETER_SPECS[change.key]?.unit ?? '', from:current[change.key], to:Number(change.to), reason:String(change.reason ?? rationale ?? '').slice(0,300)}));
    const problems = checkChanges(current, normalized);
    invariant(!problems.length, 'INVALID_PROPOSAL', `提案未通过参数护栏：${problems.join('；')}`);
    invariant(typeof rationale === 'string' && rationale.trim(), 'INVALID_PROPOSAL', '提案需要说明依据。');
    return this.saveProposal({...this.makeProposal(siteId, normalized, {feedback:this.feedback(siteId), createdBy, origin:'model_tool', summary:rationale.trim().slice(0,300)}),
      replay:this.replayer?.(siteId, normalized) ?? null});
  }
  makeProposal(siteId, changes, {feedback, createdBy, origin, summary}) {
    const now = this.clock().toISOString();
    for (const pending of this.proposals(siteId).filter(item => item.status === 'pending'))
      this.saveProposal({...pending, status:'superseded', decidedAt:now, decisionNote:'被新的提案替代'});
    return {id:`cereb-${randomUUID()}`, siteId, status:'pending', baseVersion:thresholdVersionFor(siteId), changes, summary,
      feedback, origin, createdBy, createdAt:now, policyVersion:CEREBELLUM_POLICY_VERSION,
      expectedEffect:changes.map(change => `${change.label} ${change.from}→${change.to}${change.unit}`).join('；'),
      safety:'仅改变规则阈值，不下发设备指令；批准后新生成的策略与独立校验同步使用新参数，已采用的任务保持原依据。'};
  }
  decide(id, {decision, note = ''}, identity) {
    const proposal = this.proposal(id);
    identity?.require('cerebellum.approve', '只有园区管理或中心可以审批小脑参数。');
    identity?.requireSite(proposal.siteId);
    invariant(['approve','reject'].includes(decision), 'INVALID_DECISION', '请选择批准或驳回。');
    invariant(proposal.status === 'pending', 'PROPOSAL_DECIDED', '该提案已处理，请刷新后查看。', 409);
    invariant(proposal.baseVersion === thresholdVersionFor(proposal.siteId), 'PROPOSAL_STALE', '参数已被其他提案更新，请重新生成提案。', 409);
    const now = this.clock().toISOString(), decidedBy = identity?.accountId ?? 'local-tool';
    if (decision === 'reject') return this.saveProposal({...proposal, status:'rejected', decidedAt:now, decidedBy, decisionNote:String(note).slice(0,300)});
    invariant(proposal.replay?.verdict !== 'worse' || String(note).trim(), 'REPLAY_WORSE_NEEDS_NOTE', '沙箱回放显示该提案比当前参数更差；如仍要批准，请在审批说明中写明理由。', 409);
    const next = {...this.current(proposal.siteId), ...Object.fromEntries(proposal.changes.map(change => [change.key, change.to]))};
    const set = this.activate(proposal.siteId, next, {source:'proposal', proposalId:proposal.id, approvedBy:decidedBy, note});
    const decided = this.saveProposal({...proposal, status:'approved', decidedAt:now, decidedBy, decisionNote:String(note).slice(0,300), activatedVersion:set.version});
    this.onApproved?.({proposal:decided, set});
    return decided;
  }
  rollback(siteId, {toVersion, note = ''}, identity) {
    siteId = normalizeSiteId(siteId);
    identity?.require('cerebellum.approve', '只有园区管理或中心可以回滚小脑参数。');
    identity?.requireSite(siteId);
    const target = toVersion === 0 ? {version:0, thresholds:{...WEATHER_THRESHOLDS}}
      : this.history(siteId).find(set => set.version === toVersion);
    invariant(target, 'VERSION_NOT_FOUND', '找不到要回滚的参数版本。', 404);
    return this.activate(siteId, target.thresholds, {source:'rollback', rolledBackTo:target.version, approvedBy:identity?.accountId ?? 'local-tool', note});
  }
  activate(siteId, thresholds, meta) {
    return this.store.transaction(() => {
      const version = (this.store.db.prepare('SELECT MAX(version) AS v FROM cerebellum_param_sets WHERE site_id=?').get(siteId)?.v ?? 0) + 1;
      const set = {id:`cereb-set-${siteId}-${version}`, siteId, version, thresholds:Object.fromEntries(KEYS.map(key => [key, thresholds[key]])),
        previous:this.current(siteId), activatedAt:this.clock().toISOString(), ...meta};
      this.store.db.prepare('INSERT INTO cerebellum_param_sets VALUES(?,?,?,?,?)').run(set.id, siteId, version, JSON.stringify(set), set.activatedAt);
      setCerebellumThresholds(siteId, set.thresholds, `v${version}`);
      this.loadedSites.add(siteId);
      return set;
    });
  }
}
