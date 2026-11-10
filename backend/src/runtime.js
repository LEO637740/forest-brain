import { randomUUID } from 'node:crypto';
import { requestSchema, resultSchema, CATALOG } from './contracts.js';
import { validate } from './schema.js';
import { checkContext, checkCandidate, evidenceIndex, walk } from './validation.js';
import { invariant, AppError } from './errors.js';
import { RuleGenerator } from './capabilities/rules.js';
import { classifyStrategyRoute } from './strategy-routing.js';
import { iso, digest } from './util.js';

const RETRYABLE = new Set(['CONTEXT_UNAVAILABLE', 'CANDIDATE_SERVICE_UNAVAILABLE']);
const HOUR = 3600000, DAY = 24 * HOUR;
const TREE_KINDS = new Set(['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk']);
// A model candidate can be unsafe or simply unable to reproduce the frozen
// facts.  Keep the rejection in the audit trail, then publish a separately
// labelled conservative rule package so a normal business scenario still has
// a reviewable answer.  MODEL_PAUSED remains a real control decision and is
// intentionally not silently bypassed.
const FALLBACK_GENERATION_ERRORS = new Set([
  'LLM_NOT_CONFIGURED', 'LLM_ACCOUNT_UNAVAILABLE', 'LLM_REQUEST_REJECTED',
  'LLM_INPUT_TOO_LARGE',
  'CANDIDATE_SERVICE_NOT_CONFIGURED', 'CANDIDATE_SERVICE_UNAVAILABLE', 'CANDIDATE_SERVICE_REJECTED',
  'INVALID_CANDIDATE', 'CANDIDATE_REJECTED', 'LLM_INCOMPLETE', 'LLM_REFUSED',
]);

// Use the same implicit evidence lifetimes as checkContext, including evidence
// whose upstream record has no explicit expiresAt field.
function strategyExpiry(kind, candidate, context, index, now) {
  const m = context.modules;
  const deadlines = [+now + HOUR, Date.parse(context.validUntil), ...m.knowledge.rules.map(r => Date.parse(r.validUntil))];
  for (const evidence of index.values()) if (evidence.expiresAt) deadlines.push(Date.parse(evidence.expiresAt));
  if (m.weather?.observed) deadlines.push(Date.parse(m.weather.observed.observedAt) + 2 * HOUR);
  if (kind === 'weather_window' && m.weather?.forecast) {
    deadlines.push(Date.parse(m.weather.forecast.issuedAt) + (m.weather.forecast.issuedAtBasis === 'retrieved' ? 2 : 24) * HOUR);
    deadlines.push(...candidate.proposal.windows.map(w => Date.parse(w.end)));
  }
  for (const evidence of m.inspection?.evidence ?? []) deadlines.push(Date.parse(evidence.capturedAt) + DAY);
  if (m.health) {
    // A recent observation is required for every tree, even when no finding is
    // emitted. Each observation actually used for a finding also limits it.
    for (const treeId of context.targetSnapshot.treeIds) {
      deadlines.push(Math.max(...m.health.records.filter(r => r.treeId === treeId).map(r => Date.parse(r.observedAt))) + 7 * DAY);
    }
    const refs = new Set();
    walk(candidate.proposal, item => { if (item.sourceRefs) for (const ref of item.sourceRefs) refs.add(ref); });
    for (const record of m.health.records) if (refs.has(record.recordId)) deadlines.push(Date.parse(record.observedAt) + 7 * DAY);
  }
  // Older prices may remain as history; the latest price supports the current
  // calculation and is the record subject to the seven-day quote lifetime.
  if (m.market) deadlines.push(Math.max(...m.market.prices.map(p => Date.parse(p.observedAt))) + 7 * DAY);
  return Math.min(...deadlines);
}

export class HarnessRuntime {
  constructor({ store, contextProvider, generator = new RuleGenerator(), concurrency = 2, clock = () => new Date() }) {
    Object.assign(this, { store, contextProvider, generator, concurrency, clock });
    this.active = new Set(); this.terminalListeners = new Set(); this.stopping = false; this.scheduled = false;
  }
  onTerminal(listener) { this.terminalListeners.add(listener); return () => this.terminalListeners.delete(listener); }
  start() { this.store.recover(iso(this.clock())); this.kick(); }
  submit(request, automatic) {
    validate(requestSchema, request);
    // This delivered service is a simulation integration baseline. No browser flag can enable live execution.
    invariant(request.executionMode === 'simulation', 'LIVE_MODE_DISABLED', '当前交付服务仅接受 simulation，实机环境需另行部署和验证', 403);
    const result = this.store.submit(request, iso(this.clock()), automatic);
    this.kick();
    return { runId: result.run.runId, requestId: result.run.requestId, status: result.run.status, created: result.created };
  }
  retry(runId) { const run = this.store.retry(runId, iso(this.clock())); this.kick(); return { runId, requestId: run.requestId, status: run.status }; }
  kick() {
    if (this.stopping || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; this.pump(); });
  }
  pump() {
    if (this.stopping) return;
    for (const id of this.store.pending()) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(id)) continue;
      const promise = this.execute(id);
      this.active.add(id);
      promise.catch(error => { console.error('Harness persistence failure:', error.code ?? error.name); }).finally(() => { this.active.delete(id); this.kick(); });
    }
  }
  async execute(runId) {
    if (!this.store.start(runId, iso(this.clock()))) return;
    const request = this.store.getRun(runId).request;
    // Older internal callers omitted generatorMode; treat that as the
    // configured big-brain path so complex runs still receive the labelled
    // rule fallback when the provider is unavailable.
    const generatorMode = request.generatorMode ?? 'configured';
    const stage = (name, data) => this.store.stage(runId, name, iso(this.clock()), data);
    try {
      stage('context', { tool: 'getContext', inputSnapshot: request.inputSnapshot });
      const frozen = this.store.getRunContext(runId);
      // Keep a full immutable snapshot for retries and route classification.
      // Older runs may have persisted the capability-projected context, so
      // recover the original manifest from the context table when available.
      const storedSnapshot = frozen
        ? this.store.getContext(request.inputSnapshot.snapshotId, request.inputSnapshot.version)
        : null;
      const loaded = storedSnapshot ?? frozen ?? await this.contextProvider.getContext(request.inputSnapshot, { kind: request.kind, onManifest: c => this.store.saveContext(c) });
      const { context, missing } = checkContext(request, loaded, this.clock());
      if (!frozen && this.contextProvider.mode !== 'remote') this.store.saveContext(loaded);
      this.store.saveRunContext(runId, loaded);
      stage('snapshot', { snapshotId: context.snapshotId, version: context.version, contentHash: digest(loaded), modules: Object.keys(context.modules), targetCount: context.targetSnapshot.treeIds.length });
      if (missing.length) {
        const result = { runId, requestId: request.requestId, status: 'needs_data', updatedAt: iso(this.clock()), missingData: missing };
        validate(resultSchema, result, 'INVALID_RESULT'); this.store.finish(runId, result); return;
      }
      // Routing needs the full validated snapshot: the candidate context is
      // projected by capability and intentionally omits cross-module signals
      // such as inspection/health/market data used to decide small vs big
      // brain. Candidate generation below still receives the projected context.
      const routes = TREE_KINDS.has(request.kind)
        ? loaded.targetSnapshot.treeIds.map(treeId => classifyStrategyRoute(loaded, { treeId, kind: request.kind, sampleKey: runId }))
        : [];
      const routeUsesRules = routes.length > 0 && routes.every(route => route.status !== 'needs_big_brain');
      const requestedGenerator = generatorMode === 'demo_rules' ? new RuleGenerator() : this.generator;
      // Simple tree conditions are the small-brain path even when the caller
      // asked for the configured generator. Complex conditions keep the
      // configured model path and may use the labelled fallback below.
      const generator = routeUsesRules ? new RuleGenerator() : requestedGenerator;
      stage('routing', { executor: routeUsesRules ? 'small_brain' : generatorMode === 'configured' ? 'big_brain' : 'small_brain', routes: routes.map(route => ({ treeId: route.treeId, status: route.status, triggers: route.triggers, blockers: route.blockers, ...(route.delegation ? { delegation: route.delegation } : {}) })) });
      const index = evidenceIndex(context);
      stage('tools', { modules: CATALOG.find(c => c.kind === request.kind).modules, evidenceCount: index.size, sources: [...new Set([...index.values()].filter(x => x.provenance).map(x => x.provenance.sourceClass))] });
      stage('generating', { generator: generator.mode });
      let generationMetadata, fallback, candidate, constraintsChecked;
      const onEvent = (name, data) => {
        if(name === 'llm_request' || name === 'candidate_request') {
          this.store.assertModelEnabled();
          this.store.reserveAutomaticRequest(runId, iso(this.clock()));
        }
        stage(name, data);
        if(name === 'llm_completed' || name === 'candidate_completed') generationMetadata = {
          provider: data?.provider ?? generator.mode,
          model: data?.model ?? generator.modelVersion ?? generator.mode,
          promptVersion: data?.promptVersion ?? 'candidate-service',
          responseId: data?.responseId ?? null,
          promptHash: data?.promptHash ?? digest({ runId, kind: request.kind, generator: generator.mode }),
          inputTokens: data?.inputTokens ?? null,
          outputTokens: data?.outputTokens ?? null,
          attempts: data?.attempts ?? 1,
        };
      };
      try {
        if (generator.mode !== 'demo_rules') this.store.assertModelEnabled();
        candidate = await generator.generate({ kind: request.kind, context, runId, now: this.clock(),
          validateCandidate: value => checkCandidate(request.kind, value, context, this.clock()), onEvent,
        });
        // A configured complex request served by a rule-only backend is still
        // a model-unavailable run. Let the configured generator finish first
        // so its frozen-time behavior is preserved, then route through the
        // same labelled fallback path as other provider errors.
        if (generatorMode === 'configured' && !routeUsesRules && generator.mode === 'demo_rules') {
          throw new AppError('LLM_NOT_CONFIGURED', '当前没有可用的大脑模型服务');
        }
        stage('validating', { candidate });
        constraintsChecked = checkCandidate(request.kind, candidate, context, this.clock());
      } catch (error) {
        if (generatorMode !== 'configured' || routeUsesRules || !(error instanceof AppError) || !FALLBACK_GENERATION_ERRORS.has(error.code)) throw error;
        const details = (Array.isArray(error.details) && error.details.length ? error.details : [error.message])
          .map(detail => typeof detail === 'string' ? detail : JSON.stringify(detail));
        fallback = { reasonCode: error.code, message: error.message, details: details.slice(0, 12), generator: 'demo_rules', reviewRequired: true };
        stage('candidate_fallback', { reasonCode: error.code, message: error.message, details: details.slice(0, 12), generator: 'demo_rules' });
        const ruleGenerator = new RuleGenerator();
        candidate = await ruleGenerator.generate({ kind: request.kind, context, runId, now: this.clock() });
        candidate = {
          ...candidate,
          summary: `【大脑候选未采用，规则保底待复核】${candidate.summary}`,
          reasons: [{ text: `大脑本轮未形成可采用候选：${error.message}。以下为同一输入快照生成的保守规则策略，需人工复核。`, sourceRefs: candidate.evidenceRefs }, ...candidate.reasons],
        };
        stage('fallback_validating', { candidate });
        constraintsChecked = checkCandidate(request.kind, candidate, context, this.clock());
        generationMetadata = {
          provider: 'harness-fallback', model: 'demo_rules', promptVersion: 'fallback-v1', responseId: null,
          promptHash: digest({ runId, kind: request.kind, reasonCode: error.code }), inputTokens: null, outputTokens: null, attempts: 1,
        };
      }
      // Slow upstream calls may outlive the snapshot. Check freshness again before publication.
      const finalCheck = checkContext(request, loaded, this.clock());
      if (finalCheck.missing.length) {
        this.store.finish(runId, { runId, requestId: request.requestId, status: 'needs_data', updatedAt: iso(this.clock()), missingData: finalCheck.missing }); return;
      }
      const now = this.clock();
      const expiresAt = strategyExpiry(request.kind, candidate, context, index, now);
      if (expiresAt <= +now) {
        this.store.finish(runId, { runId, requestId: request.requestId, status: 'needs_data', updatedAt: iso(now), missingData: [{ module: 'context', field: 'validUntil', objectId: context.snapshotId, reason: '支撑策略的证据已到有效期边界，请更新输入后重新分析' }] }); return;
      }
      const strategy = {
        strategyId: `strategy-${randomUUID()}`, revision: 1, runId, kind: request.kind, siteId: request.siteId,
        targetSnapshotId: request.targetSnapshotId, inputSnapshot: request.inputSnapshot,
        generatedAt: iso(now), expiresAt: new Date(expiresAt).toISOString(),
        executionMode: request.executionMode, provenance: { sourceId: 'harness-brain', sourceClass: 'research_partner', mode: fallback ? 'simulated' : ['llm','candidate_service'].includes(generator.mode) ? 'estimated' : 'simulated' },
        schemaVersion: '2.1.0', ...(generationMetadata ? { generationMetadata } : {}),
        ...(fallback ? { fallback } : {}),
        ...(context.dataPolicy ? {dataPolicy:context.dataPolicy} : {}),
        ruleBindings: context.modules.knowledge.rules.map(r=>({ruleId:r.ruleId,version:r.version,contentHash:digest(r)})),
        ruleVersion: context.constraints.ruleSetId, modelVersion: fallback ? null : generator.modelVersion,
        constraintsChecked, ...candidate,
      };
      const result = { runId, requestId: request.requestId, status: 'succeeded', updatedAt: iso(now), strategy };
      validate(resultSchema, result, 'INVALID_RESULT');
      this.store.finish(runId, result);
    } catch (error) {
      const known = error instanceof AppError;
      const result = { runId, requestId: request.requestId, status: 'failed', updatedAt: iso(this.clock()), error: {
        code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '运行失败，请检查服务端日志', retryable: RETRYABLE.has(error.code),
        ...(known && Array.isArray(error.details) ? { details: error.details } : {}),
      } };
      if (!known) console.error('Harness run failure:', error);
      validate(resultSchema, result, 'INVALID_RESULT');
      this.store.finish(runId, result);
    } finally {
      const run = this.store.getRun(runId);
      if (run?.result && ['succeeded', 'needs_data', 'failed'].includes(run.status)) {
        for (const listener of this.terminalListeners) {
          // A bookkeeping/archive failure must not overwrite a committed model
          // result. Listeners own their operational error state.
          try { listener(run); } catch (error) { console.error('Harness terminal bookkeeping failure:', error.code ?? error.name); }
        }
      }
    }
  }
  async idle(timeoutMs = 5000) {
    const start = Date.now();
    while (this.active.size || this.store.pending().length || this.scheduled) {
      if (Date.now() - start > timeoutMs) throw new Error('Runtime wait timeout');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  async stop() {
    this.stopping = true;
    while (this.active.size) await new Promise(resolve => setTimeout(resolve, 10));
  }
}
