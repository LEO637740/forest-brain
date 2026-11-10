import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {normalizeSiteId,parkSite} from './adapters/park-demo.js';
import {checkContext} from './validation.js';
import {handlers} from './capabilities/rules.js';
import {classifyStrategyRoute,setRoutingDelegations,signatureOf,SIGNAL_LABELS,AUDIT_EVERY} from './strategy-routing.js';

// Self-improvement of the routing itself ("分流自我改进").  Every past big-brain
// run is replayed through the small-brain rule on the same frozen snapshot (a
// shadow run: nothing is written).  Runs are grouped by the exact trigger
// combination that sent them to the brain.  When a combination has enough
// samples and the brain keeps reaching the rule's structured conclusion, or
// almost always fails validation and falls back to the rule anyway, the brain
// may propose handing that combination down to the small brain.  A manager or
// the center approves it; afterwards one in AUDIT_EVERY such requests still
// goes to the brain, and those audits decide whether to keep or revoke it.
export const ROUTING_EVOLUTION_VERSION = 'routing-evolution-v2';
export const DELEGATION_RULES = Object.freeze({minSamples:10, minAgreement:0.95, unreliableFallback:0.8, auditMinSamples:5, auditMaxDisagreement:0.05});
const TREE_KINDS = ['tapping_angle', 'surface_action', 'pest_risk', 'growth_plan'];
const VALIDATION_FAILURES = new Set(['INVALID_CANDIDATE', 'CANDIDATE_REJECTED']);
export const KIND_LABELS = {tapping_angle:'单树割胶参数', surface_action:'树表异常处置', pest_risk:'病虫害风险', growth_plan:'生长与割面规划'};
// Fields the validator already forces to equal the rule calculation; agreement there is by construction.
const LOCKED = {tapping_angle:'割线坡角由校验器锁定为后端角度计算值', surface_action:'处置动作由校验器按割线几何和异常类别锁定'};
const VERDICT_LABELS = {delegate:'建议下沉给小脑', brain_unreliable:'大脑多数未通过校验', keep_brain:'保留在大脑', insufficient:'样本不足', delegated:'已下沉', pending:'下沉待审批'};
const pct = value => `${Math.round(value * 100)}%`;
const sorted = list => [...(list ?? [])].sort();

/** Compare the structured conclusion of the brain with the rule on the same snapshot. */
export const COMPARE = {
  tapping_angle(rule, brain) {
    const same = Number.isFinite(brain?.recommendedCutSlopeDeg) && Math.abs(rule.recommendedCutSlopeDeg - brain.recommendedCutSlopeDeg) <= 1;
    return {same, detail:`坡角 小脑 ${rule.recommendedCutSlopeDeg}° / 大脑 ${brain?.recommendedCutSlopeDeg ?? '缺失'}°`};
  },
  surface_action(rule, brain) {
    const key = list => sorted((list ?? []).map(item => `${item.detectionId}:${item.action}`)).join(',');
    return {same:key(rule.findings) === key(brain?.findings), detail:`处置 小脑 ${key(rule.findings) || '无'} / 大脑 ${key(brain?.findings) || '无'}`};
  },
  pest_risk(rule, brain) {
    const key = list => sorted(list).join(',');
    return {same:key(rule.inspectionTargets) === key(brain?.inspectionTargets), detail:`巡查对象 小脑 ${key(rule.inspectionTargets) || '无'} / 大脑 ${key(brain?.inspectionTargets) || '无'}`};
  },
  growth_plan(rule, brain) {
    const key = list => sorted((list ?? []).map(item => `${item.treeId}:${Math.round(item.value)}`)).join(',');
    return {same:key(rule.predictions) === key(brain?.predictions), detail:'30 天树围预测'};
  },
};

/** Pure grouping of shadow observations into per-signature evidence and a verdict. */
export function groupObservations(observations, {delegations = [], pending = []} = {}) {
  const groups = new Map();
  for (const item of observations) {
    if (!item.signature) continue;
    const key = `${item.kind}|${item.signature}`;
    const group = groups.get(key) ?? groups.set(key, {kind:item.kind, signature:item.signature, rows:[]}).get(key);
    group.rows.push(item);
  }
  const R = DELEGATION_RULES;
  return [...groups.values()].map(({kind, signature, rows}) => {
    const count = outcome => rows.filter(row => row.outcome === outcome).length;
    const agree = count('agree'), disagree = count('disagree'), fallback = count('fallback'), failed = count('failed');
    const compared = agree + disagree, samples = rows.length, evaluated = compared + fallback + failed, excluded = samples - evaluated;
    const agreementRate = compared ? agree / compared : null, fallbackRate = evaluated ? (fallback + failed) / evaluated : 0;
    const llmCalls = rows.reduce((sum, row) => sum + row.llmCalls, 0), tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
    const signals = signature.split('+').map(code => SIGNAL_LABELS[code] ?? code);
    const active = delegations.find(item => item.kind === kind && item.signature === signature);
    const waiting = pending.find(item => item.kind === kind && item.signature === signature);
    let verdict = 'insufficient', explanation;
    if (compared >= R.minSamples && agreementRate >= R.minAgreement) {
      verdict = 'delegate';
      explanation = `大脑通过校验的 ${compared} 次里有 ${agree} 次与小脑规则结论一致（${pct(agreementRate)}）${fallback + failed ? `，另有 ${fallback + failed} 次候选没通过校验` : ''}；这类情况交给小脑可省下这些模型调用。`;
    } else if (evaluated >= R.minSamples && fallbackRate >= R.unreliableFallback && disagree === 0) {
      verdict = 'brain_unreliable';
      explanation = `${evaluated} 次有效评估里 ${fallback + failed} 次大脑没通过校验（${pct(fallbackRate)}）；可以下沉给小脑，或先改进大脑提示词。`;
    } else if (compared >= R.minSamples) {
      verdict = 'keep_brain';
      explanation = `大脑有 ${disagree} 次给出与小脑不同的结论（${pct(1 - agreementRate)}），说明这类情况规则覆盖不了，先保留在大脑，请人工看差异。`;
    } else explanation = `只有 ${evaluated} 次有效评估（通过校验 ${compared} 次），至少需要 ${R.minSamples} 次才判断。`;
    if (excluded) explanation += `另有 ${excluded} 次因服务不可用或未形成可比对候选，未计入下沉判断。`;
    const latest = rows.map(row => row.at).sort().at(-1);
    return {kind, kindLabel:KIND_LABELS[kind] ?? kind, signature, signals, samples, compared, agree, disagree, fallback, failed, excluded,
      agreementRate:agreementRate === null ? null : Math.round(agreementRate * 1000) / 1000, fallbackRate:Math.round(fallbackRate * 1000) / 1000,
      llmCalls, tokens, latestAt:latest ?? null, locked:LOCKED[kind] ?? null, verdict, verdictLabel:VERDICT_LABELS[verdict], explanation,
      eligible:['delegate', 'brain_unreliable'].includes(verdict),
      delegation:active ? {id:active.id, status:'active', approvedAt:active.approvedAt} : waiting ? {id:waiting.id, status:'pending'} : null,
      examples:{agree:rows.filter(row => row.outcome === 'agree').slice(-3).map(row => row.runId),
        disagree:rows.filter(row => row.outcome === 'disagree').slice(-3).map(row => ({runId:row.runId, detail:row.detail})),
        fallback:rows.filter(row => row.outcome === 'fallback').slice(-3).map(row => row.runId)}};
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.samples - a.samples);
}

export class RoutingEvolution {
  constructor({store, clock = () => new Date()}) {
    Object.assign(this, {store, clock});
    store.db.exec(`CREATE TABLE IF NOT EXISTS routing_delegations (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_by_stage ON events(stage, seq)`);
    this.cache = new Map();
    Object.assign(this, {brainRuns:new Set(), observed:new Map(), unfinished:new Map(), seenSeq:0});
    this.loadedSites = new Set();
    for (const row of store.db.prepare(`SELECT DISTINCT site_id FROM routing_delegations WHERE status='active'`).all()) this.reload(row.site_id);
  }
  close() { for (const siteId of this.loadedSites) setRoutingDelegations(siteId, null); }
  list(siteId) { return this.store.db.prepare('SELECT body FROM routing_delegations WHERE site_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50').all(siteId).map(row => JSON.parse(row.body)); }
  get(id) {
    const row = this.store.db.prepare('SELECT body FROM routing_delegations WHERE id=?').get(id);
    invariant(row, 'DELEGATION_NOT_FOUND', '下沉提案不存在。', 404);
    return JSON.parse(row.body);
  }
  save(item) {
    this.store.db.prepare(`INSERT INTO routing_delegations VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body`)
      .run(item.id, item.siteId, item.status, JSON.stringify(item), item.createdAt);
    this.cache.clear();
    return item;
  }
  reload(siteId) {
    setRoutingDelegations(siteId, this.list(siteId).filter(item => item.status === 'active')
      .map(item => ({id:item.id, kind:item.kind, signature:item.signature, approvedAt:item.decidedAt})));
    this.loadedSites.add(siteId);
  }

  /**
   * Shadow observations: every past run of this site that asked the big brain.
   * Finished runs never change, so each is replayed once and kept in memory;
   * later calls only scan events added since the last call.
   */
  observations(siteId) {
    const db = this.store.db;
    const added = db.prepare(`SELECT run_id, MAX(seq) AS seq FROM events WHERE seq>? AND stage='llm_request' GROUP BY run_id`).all(this.seenSeq);
    for (const row of added) this.brainRuns.add(row.run_id);
    this.seenSeq = db.prepare('SELECT MAX(seq) AS seq FROM events').get().seq ?? 0;
    const read = db.prepare(`SELECT r.id, r.request, r.status, r.created_at, json_extract(r.result,'$.error.code') AS error_code, s.body AS strategy, c.body AS context,
        (SELECT data FROM events INDEXED BY events_by_run WHERE run_id=r.id AND stage='routing') AS routing,
        (SELECT data FROM events INDEXED BY events_by_run WHERE run_id=r.id AND stage='candidate_fallback' ORDER BY seq DESC LIMIT 1) AS fallback,
        (SELECT COUNT(*) FROM events INDEXED BY events_by_run WHERE run_id=r.id AND stage='llm_request') AS calls,
        (SELECT COALESCE(SUM(json_extract(data,'$.inputTokens')),0)+COALESCE(SUM(json_extract(data,'$.outputTokens')),0) FROM events INDEXED BY events_by_run WHERE run_id=r.id AND stage='llm_completed') AS tokens
      FROM runs r LEFT JOIN strategies s ON s.run_id=r.id LEFT JOIN run_contexts c ON c.run_id=r.id WHERE r.id=?`);
    for (const runId of this.brainRuns) {
      if (this.observed.has(runId)) continue;
      const run = read.get(runId);
      if (!run) continue;
      const observation = this.observe(run);
      if (['succeeded', 'failed', 'needs_data'].includes(run.status)) this.observed.set(runId, observation);
      else this.unfinished.set(runId, observation);
    }
    for (const runId of this.unfinished.keys()) if (this.observed.has(runId)) this.unfinished.delete(runId);
    return [...this.observed.values(), ...this.unfinished.values()].filter(item => item?.siteId === siteId).sort((a, b) => a.at.localeCompare(b.at));
  }

  observe(run) {
    const request = JSON.parse(run.request);
    if (!TREE_KINDS.includes(request.kind) || !run.context) return null;
    const loaded = JSON.parse(run.context), routing = run.routing ? JSON.parse(run.routing) : null;
    // Runs from before routing existed are classified now from the same frozen snapshot.
    const routes = routing?.routes ?? loaded.targetSnapshot.treeIds.map(treeId => classifyStrategyRoute(loaded, {treeId, kind:request.kind}));
    const base = {runId:run.id, siteId:request.siteId, kind:request.kind, at:run.created_at, signature:signatureOf(routes.flatMap(route => route.triggers ?? [])),
      llmCalls:run.calls, tokens:run.tokens, auditOf:routes.find(route => route.delegation?.audit)?.delegation.id ?? null};
    const strategy = run.strategy ? JSON.parse(run.strategy) : null;
    const fallbackReason = strategy ? strategy.fallback?.reasonCode : run.fallback ? JSON.parse(run.fallback).reasonCode : null;
    const reasonCode = fallbackReason ?? run.error_code;
    // Account, request and connection failures say nothing about the model's
    // ability to produce a valid candidate for this business situation.
    if (reasonCode) return {...base, reasonCode, outcome:VALIDATION_FAILURES.has(reasonCode) ? (fallbackReason ? 'fallback' : 'failed') : 'other'};
    if (!strategy) return {...base, outcome:'other'};
    const now = new Date(strategy.generatedAt);
    try {
      const {context} = checkContext(request, loaded, now);
      const comparison = COMPARE[request.kind](handlers[request.kind](context, now).proposal, strategy.proposal);
      return {...base, outcome:comparison.same ? 'agree' : 'disagree', detail:comparison.detail};
    } catch (error) {
      return {...base, outcome:'other', detail:error.message};
    }
  }

  /** Requests served under one delegation since approval, and what the audits found. */
  review(delegation, observations) {
    const since = delegation.decidedAt;
    const routed = this.store.db.prepare(`SELECT data FROM events e JOIN runs r ON r.id=e.run_id
      WHERE e.stage='routing' AND r.created_at>=? AND json_extract(r.request,'$.siteId')=?`).all(since, delegation.siteId)
      .map(row => JSON.parse(row.data).routes ?? []);
    const handedDown = routed.filter(routes => routes.some(route => route.delegation?.id === delegation.id && !route.delegation.audit)).length;
    const audits = observations.filter(item => item.auditOf === delegation.id);
    const compared = audits.filter(item => ['agree', 'disagree'].includes(item.outcome)), disagree = compared.filter(item => item.outcome === 'disagree');
    const R = DELEGATION_RULES, rate = compared.length ? disagree.length / compared.length : 0;
    const base = {handedDown, audits:audits.length, auditCompared:compared.length, auditDisagree:disagree.length, savedCallsEstimate:handedDown};
    if (compared.length < R.auditMinSamples) return {...base, status:'collecting', summary:`已有 ${handedDown} 次直接由小脑处理、${audits.length} 次大脑抽检；满 ${R.auditMinSamples} 次可比对的抽检后自动复盘。`};
    const verdict = rate > R.auditMaxDisagreement ? 'revoke_suggested' : 'keep';
    return {...base, status:'reviewed', verdict, disagreementRate:Math.round(rate * 1000) / 1000,
      summary:verdict === 'keep' ? `抽检 ${compared.length} 次，大脑与小脑不一致 ${disagree.length} 次，建议继续由小脑处理。`
        : `抽检 ${compared.length} 次，大脑与小脑不一致 ${disagree.length} 次（${pct(rate)}），超过 ${pct(R.auditMaxDisagreement)}，建议收回给大脑。`,
      disagreements:disagree.slice(-3).map(item => ({runId:item.runId, detail:item.detail}))};
  }

  evaluate(siteId) {
    siteId = normalizeSiteId(siteId);
    const stamp = `${this.store.db.prepare('SELECT MAX(seq) AS seq FROM events').get().seq ?? 0}`;
    const hit = this.cache.get(siteId);
    if (hit?.stamp === stamp) return hit.value;
    const observations = this.observations(siteId), list = this.list(siteId);
    const active = list.filter(item => item.status === 'active'), pending = list.filter(item => item.status === 'pending');
    const groups = groupObservations(observations.filter(item => !item.auditOf), {delegations:active, pending});
    const completedTokens = observations.filter(item => item.tokens > 0);
    const tokensPerCall = completedTokens.length ? Math.round(completedTokens.reduce((sum, item) => sum + item.tokens, 0) / completedTokens.reduce((sum, item) => sum + Math.max(1, item.llmCalls), 0)) : null;
    const candidates = groups.filter(group => group.eligible && !group.delegation);
    const value = {siteId, park:parkSite(siteId).name, policyVersion:ROUTING_EVOLUTION_VERSION, generatedAt:this.clock().toISOString(), rules:DELEGATION_RULES, auditEvery:AUDIT_EVERY,
      totals:{brainRuns:observations.length, compared:observations.filter(item => ['agree', 'disagree'].includes(item.outcome)).length,
        agree:observations.filter(item => item.outcome === 'agree').length, fallback:observations.filter(item => item.outcome === 'fallback').length,
        excluded:observations.filter(item => item.outcome === 'other').length,
        llmCalls:observations.reduce((sum, item) => sum + item.llmCalls, 0), tokensPerCall},
      groups, candidates:candidates.length,
      delegations:list.map(item => item.status === 'active' ? {...item, review:this.review(item, observations)} : item),
      headline:!observations.length ? '这个园区还没有调用过大脑的单树策略记录，暂时无法判断哪些情况可以交给小脑。'
        : candidates.length ? `对照 ${observations.length} 次大脑记录，有 ${candidates.length} 类情况可以下沉给小脑；最多的是“${candidates[0].kindLabel}·${candidates[0].signals.join('+')}”：${candidates[0].explanation}`
        : `对照 ${observations.length} 次大脑记录，暂时没有新的情况适合下沉给小脑。`,
      loop:['对照：每次大脑运行，用同一份冻结数据让小脑规则影子重算', '归类：按触发大脑的信号组合统计一致、不同和候选校验失败，排除服务故障', '提案：有效样本够且一致（或候选多数校验失败）才提议下沉', '审批：园区管理或中心批准后生效，可随时收回', `抽检：下沉后每 ${AUDIT_EVERY} 次仍抽 1 次交大脑，不一致超过 ${pct(DELEGATION_RULES.auditMaxDisagreement)} 建议收回`],
      limitations:['一致只比较结构化结论（坡角、处置动作、巡查对象），大脑写的说明文字不参与比较。', '单树割胶参数的坡角、树表处置动作本来就由校验器锁定为规则值，这两类“一致”是设计使然；下沉省掉的是重复的模型调用和校验失败。',
        '“一致”不等于“正确”：真值仍需割胶回执、产量和树皮损伤记录；接入后可按效果打分。']};
    this.cache.set(siteId, {stamp, value});
    return value;
  }

  /** Small digest for the brain-evolution page, the decision list and the assistant. */
  digest(siteId) {
    const data = this.evaluate(siteId);
    const reviews = data.delegations.filter(item => item.status === 'active');
    return {headline:data.headline, candidates:data.groups.filter(group => group.eligible && !group.delegation).map(group => ({kind:group.kind, kindLabel:group.kindLabel, signature:group.signature, signals:group.signals, explanation:group.explanation})),
      active:reviews.map(item => ({id:item.id, label:item.label, review:item.review})), pending:data.delegations.filter(item => item.status === 'pending').map(item => ({id:item.id, label:item.label})),
      revokeSuggested:reviews.filter(item => item.review.verdict === 'revoke_suggested').map(item => ({id:item.id, label:item.label, summary:item.review.summary}))};
  }

  propose(siteId, {kind, signature}, createdBy) {
    siteId = normalizeSiteId(siteId);
    const data = this.evaluate(siteId), group = data.groups.find(item => item.kind === kind && item.signature === signature);
    invariant(group, 'DELEGATION_NO_EVIDENCE', '没有这类情况的大脑运行记录，不能提议下沉。', 404);
    invariant(group.delegation?.status !== 'active', 'DELEGATION_EXISTS', '这类情况已经下沉给小脑。', 409);
    invariant(group.eligible, 'DELEGATION_NOT_ELIGIBLE', `暂不满足下沉条件：${group.explanation}`, 409);
    const now = this.clock().toISOString();
    for (const old of this.list(siteId).filter(item => item.status === 'pending' && item.kind === kind && item.signature === signature))
      this.save({...old, status:'superseded', decidedAt:now, decisionNote:'被新的提案替代'});
    return this.save({id:`route-${randomUUID()}`, siteId, status:'pending', kind, signature, label:`${group.kindLabel}·${group.signals.join('+')}`,
      evidence:{samples:group.samples, compared:group.compared, agree:group.agree, disagree:group.disagree, fallback:group.fallback, failed:group.failed, excluded:group.excluded,
        agreementRate:group.agreementRate, fallbackRate:group.fallbackRate, llmCalls:group.llmCalls, tokens:group.tokens, verdict:group.verdict, locked:group.locked, examples:group.examples},
      summary:group.explanation, createdBy, createdAt:now, policyVersion:ROUTING_EVOLUTION_VERSION,
      effect:`批准后，${group.kindLabel}请求中只出现“${group.signals.join('、')}”时由小脑规则直接给出策略；多出任何其他信号仍交大脑；每 ${AUDIT_EVERY} 次抽 1 次交大脑复核。`,
      safety:'只改变分流，不改变规则和校验；已生成的策略不受影响，可随时收回。'});
  }

  decide(id, {decision, note = ''}, identity) {
    const item = this.get(id);
    identity?.require('cerebellum.approve', '只有园区管理或中心可以审批分流下沉。');
    identity?.requireSite(item.siteId);
    invariant(['approve', 'reject'].includes(decision), 'INVALID_DECISION', '请选择批准或驳回。');
    invariant(item.status === 'pending', 'PROPOSAL_DECIDED', '该提案已处理，请刷新后查看。', 409);
    const decided = this.save({...item, status:decision === 'approve' ? 'active' : 'rejected', decidedAt:this.clock().toISOString(), decidedBy:identity?.accountId ?? 'local-tool', decisionNote:String(note).slice(0, 300)});
    this.reload(item.siteId);
    return decided;
  }

  revoke(id, {note = ''}, identity) {
    const item = this.get(id);
    identity?.require('cerebellum.approve', '只有园区管理或中心可以收回分流下沉。');
    identity?.requireSite(item.siteId);
    invariant(item.status === 'active', 'DELEGATION_NOT_ACTIVE', '只有生效中的下沉可以收回。', 409);
    const revoked = this.save({...item, status:'revoked', revokedAt:this.clock().toISOString(), revokedBy:identity?.accountId ?? 'local-tool', revokeNote:String(note).slice(0, 300)});
    this.reload(item.siteId);
    return revoked;
  }
}

