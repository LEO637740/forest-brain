import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { digest } from './util.js';
import { invariant } from './errors.js';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS contexts (id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, version));
      CREATE TABLE IF NOT EXISTS target_snapshots (id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_contexts (run_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, request TEXT NOT NULL,
        status TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, result TEXT, attempt INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), stage TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS strategies (id TEXT PRIMARY KEY, run_id TEXT UNIQUE NOT NULL REFERENCES runs(id), site_id TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
        UNIQUE(site_id, kind, target_id, revision));
      CREATE INDEX IF NOT EXISTS events_by_run ON events(run_id, seq);
      CREATE INDEX IF NOT EXISTS runs_by_date ON runs(created_at DESC);
      CREATE TABLE IF NOT EXISTS automatic_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL CHECK(paused IN (0,1)), updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automatic_runs (run_id TEXT PRIMARY KEY REFERENCES runs(id), job_id TEXT NOT NULL, cycle_key TEXT NOT NULL, created_at TEXT NOT NULL, max_requests INTEGER NOT NULL, daily_request_limit INTEGER NOT NULL, UNIQUE(job_id,cycle_key));
      CREATE TABLE IF NOT EXISTS automatic_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES automatic_runs(run_id), at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tree_preparations (preparation_id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tree_view_bindings (tree_id TEXT NOT NULL, kind TEXT NOT NULL, data_mode TEXT NOT NULL, preparation_id TEXT NOT NULL, request_id TEXT NOT NULL, run_id TEXT NOT NULL, context_snapshot_id TEXT NOT NULL, as_of TEXT NOT NULL, PRIMARY KEY(tree_id, kind, data_mode));
      CREATE INDEX IF NOT EXISTS tree_view_bindings_run ON tree_view_bindings(run_id);
    `);
  }
  transaction(fn) {
    const depth=this.transactionDepth??0,point=`nested_${depth}`;
    this.db.exec(depth?`SAVEPOINT ${point}`:'BEGIN IMMEDIATE');
    this.transactionDepth=depth+1;
    try {
      const result=fn();
      if(result instanceof Promise)throw new Error('Database transactions must be synchronous');
      this.db.exec(depth?`RELEASE SAVEPOINT ${point}`:'COMMIT');
      return result;
    } catch(error) {
      if(depth){this.db.exec(`ROLLBACK TO SAVEPOINT ${point}`);this.db.exec(`RELEASE SAVEPOINT ${point}`);}
      else this.db.exec('ROLLBACK');
      throw error;
    } finally {this.transactionDepth=depth;}
  }
  saveContext(context) {
    return this.transaction(() => {
    const target = context.targetSnapshot;
    const targetHash = digest({ siteId: target.siteId, treeIds: [...target.treeIds].sort() });
    let bound = this.db.prepare('SELECT hash FROM target_snapshots WHERE id=?').get(target.targetSnapshotId);
    if (!bound) {
      const existing = this.db.prepare("SELECT body FROM contexts WHERE json_extract(body,'$.targetSnapshot.targetSnapshotId')=? LIMIT 1").get(target.targetSnapshotId);
      if (existing) { const t = JSON.parse(existing.body).targetSnapshot; bound = { hash: digest({ siteId: t.siteId, treeIds: [...t.treeIds].sort() }) }; }
    }
    invariant(!bound || bound.hash === targetHash, 'TARGET_SNAPSHOT_CONFLICT', '目标快照编号已绑定其他园区或树成员，必须创建新目标快照', 409);
    const hash = digest(context);
    const old = this.db.prepare('SELECT hash FROM contexts WHERE id=? AND version=?').get(context.snapshotId, context.version);
    invariant(!old || old.hash === hash, 'IMMUTABLE_SNAPSHOT_CONFLICT', '同一快照版本的内容发生变化，必须创建新版本', 409);
    this.db.prepare('INSERT OR IGNORE INTO contexts VALUES(?,?,?,?)').run(context.snapshotId, context.version, hash, JSON.stringify(context));
    this.db.prepare('INSERT OR IGNORE INTO target_snapshots VALUES(?,?)').run(target.targetSnapshotId, targetHash);
    return context;
    });
  }
  getContext(id, version) { const row = this.db.prepare('SELECT body FROM contexts WHERE id=? AND version=?').get(id, version); return row ? JSON.parse(row.body) : null; }
  saveRunContext(runId, context) { this.db.prepare('INSERT OR REPLACE INTO run_contexts VALUES(?,?)').run(runId,JSON.stringify(context)); }
  getRunContext(runId) { const row = this.db.prepare('SELECT body FROM run_contexts WHERE run_id=?').get(runId); return row ? JSON.parse(row.body) : null; }
  submit(request, now, automatic) {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM runs WHERE request_id=?').get(request.requestId);
      if (previous) {
        invariant(previous.hash === digest(request), 'IDEMPOTENCY_CONFLICT', 'requestId 已用于不同请求；重试须保持请求内容一致', 409);
        if(automatic)this.publishAutomaticTreeViews(previous.id);
        return { run: this.decode(previous), created: false };
      }
      const pending = this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status IN ('queued','running')").get().n;
      invariant(pending < 100, 'QUEUE_FULL', '待处理队列已满，请稍后重试', 429);
      if(automatic) {
        const budget=this.automaticBudget(now);
        invariant(budget.runs<automatic.maxRunsPer24Hours&&budget.modelRequests<automatic.maxModelRequestsPer24Hours,'AUTO_BUDGET_EXHAUSTED','自动分析已达到滚动 24 小时次数上限',429);
      }
      const runId = `run-${randomUUID()}`;
      this.db.prepare("INSERT INTO runs(id,request_id,hash,request,status,stage,created_at,updated_at) VALUES(?,?,?,?,'queued','queued',?,?)").run(runId, request.requestId, digest(request), JSON.stringify(request), now, now);
      if(automatic)this.db.prepare('INSERT INTO automatic_runs VALUES(?,?,?,?,?,?)').run(runId,automatic.jobId,automatic.cycleKey,now,automatic.maxRequestsPerRun,automatic.maxModelRequestsPer24Hours);
      this.event(runId, 'queued', now, { kind: request.kind });
      // A queued run and its view index are committed together. A late model
      // response never republishes over a newer manual/automatic request.
      if(automatic)this.publishAutomaticTreeViews(runId);
      return { run: this.getRun(runId), created: true };
    });
  }
  decode(row) {
    if(!row)return null;
    const result=row.result?JSON.parse(row.result):null;
    if(result?.strategy)this.applyQualityReview(result.strategy);
    return {runId:row.id,requestId:row.request_id,request:JSON.parse(row.request),status:row.status,stage:row.stage,createdAt:row.created_at,updatedAt:row.updated_at,attempt:row.attempt,result};
  }
  applyQualityReview(strategy) {
    const reviews=this.db.prepare("SELECT at,data FROM events WHERE run_id=? AND stage='quality_review' ORDER BY seq").all(strategy.runId);
    strategy.qualityReview={status:reviews.length?'withdrawn':'pending',reviewRequired:true,reviewedAt:reviews.at(-1)?.at??null,notes:reviews.map(r=>String(JSON.parse(r.data).reason??'策略内容需复核，请勿采用'))};
    return strategy;
  }
  withdrawStrategy(runId,reason,at=new Date().toISOString()) {
    invariant(typeof reason==='string'&&reason.length>0&&reason.length<=2000,'INVALID_REVIEW','撤回须提供明确原因');
    const run=this.getRun(runId);invariant(run?.result?.strategy,'STRATEGY_NOT_FOUND','运行没有已保存策略',404);
    this.event(runId,'quality_review',at,{status:'withdrawn',reason});
    return this.getRun(runId).result.strategy.qualityReview;
  }
  getRun(id) { return this.decode(this.db.prepare('SELECT * FROM runs WHERE id=?').get(id)); }
  listRuns({ limit = 20, cursor, kind, dataMode, generatorMode, siteId } = {}) {
    // A stable descending key avoids offsets shifting when a new run is inserted.
    const conditions=[],params=[];
    if(cursor){conditions.push('r.rowid < ?');params.push(cursor);}
    if(kind){conditions.push("json_extract(r.request,'$.kind')=?");params.push(kind);}
    if(siteId){conditions.push("json_extract(r.request,'$.siteId')=?");params.push(siteId);}
    if(generatorMode){conditions.push("COALESCE(json_extract(r.request,'$.generatorMode'),'configured')=?");params.push(generatorMode);}
    if(dataMode){conditions.push("COALESCE(json_extract(rc.body,'$.dataPolicy.mode'),json_extract(c.body,'$.dataPolicy.mode'),CASE WHEN json_extract(r.request,'$.kind')='industry_brief' THEN 'public' ELSE 'demo' END)=?");params.push(dataMode);}
    const rows=this.db.prepare(`SELECT r.* FROM runs r
      LEFT JOIN run_contexts rc ON rc.run_id=r.id
      LEFT JOIN contexts c ON c.id=json_extract(r.request,'$.inputSnapshot.snapshotId') AND c.version=json_extract(r.request,'$.inputSnapshot.version')
      ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY r.rowid DESC LIMIT ?`).all(...params,limit+1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map(row => this.decode(row)), nextCursor: rows.length > limit && last ? String(this.db.prepare('SELECT rowid AS n FROM runs WHERE id=?').get(last.id).n) : null };
  }
  pending() { return this.db.prepare("SELECT id FROM runs WHERE status='queued' ORDER BY rowid").all().map(x => x.id); }
  recover(now) {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM runs WHERE status='running'").all();
      for (const row of rows) {
        this.db.prepare("UPDATE runs SET status='queued', stage='recovered', updated_at=?, attempt=attempt+1 WHERE id=?").run(now, row.id);
        this.event(row.id, 'recovered', now, { reason: '进程重启，从已保存的输入重新运行；未调用设备' });
      }
    });
  }
  start(id, now) { return this.db.prepare("UPDATE runs SET status='running',stage='context',updated_at=? WHERE id=? AND status='queued'").run(now, id).changes === 1; }
  stage(id, stage, now, data = {}) {
    this.transaction(() => { this.db.prepare('UPDATE runs SET stage=?,updated_at=? WHERE id=?').run(stage, now, id); this.event(id, stage, now, data); });
  }
  event(id, stage, at, data) { this.db.prepare('INSERT INTO events(run_id,stage,at,data) VALUES(?,?,?,?)').run(id, stage, at, JSON.stringify(data)); }
  events(id, after = 0) { return this.db.prepare('SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200').all(id, after).map(e => ({ seq: e.seq, runId: e.run_id, stage: e.stage, at: e.at, data: JSON.parse(e.data) })); }
  finish(id, result) {
    return this.transaction(() => {
      if (result.status === 'succeeded') {
        const s = result.strategy;
        this.applyQualityReview(s);
        const row = this.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM strategies WHERE site_id=? AND kind=? AND target_id=?').get(s.siteId, s.kind, s.targetSnapshotId);
        s.revision = row.revision;
        this.db.prepare('INSERT INTO strategies VALUES(?,?,?,?,?,?,?)').run(s.strategyId, id, s.siteId, s.kind, s.targetSnapshotId, s.revision, JSON.stringify(s));
      }
      this.db.prepare('UPDATE runs SET status=?,stage=?,updated_at=?,result=? WHERE id=?').run(result.status, result.status, result.updatedAt, JSON.stringify(result), id);
      this.event(id, result.status, result.updatedAt, { ...(result.strategy ? { strategyId: result.strategy.strategyId } : {}), ...(result.error ? { code: result.error.code } : {}) });
      return result;
    });
  }
  retry(id, now) {
    return this.transaction(() => {
      const run = this.getRun(id);
      invariant(run, 'RUN_NOT_FOUND', '运行不存在', 404);
      if (run.status === 'queued' || run.status === 'running') return run;
      invariant(run.status === 'failed' && run.result.error.retryable, 'RETRY_NOT_ALLOWED', '当前运行不支持原地重试；修正数据后请创建新请求', 409);
      invariant(run.attempt < 3, 'RETRY_LIMIT', '已达到 3 次尝试上限', 409);
      this.event(id, 'retry_requested', now, { previousResult: run.result, previousAttempt: run.attempt });
      this.db.prepare("UPDATE runs SET status='queued',stage='queued',updated_at=?,result=NULL,attempt=attempt+1 WHERE id=?").run(now, id);
      return this.getRun(id);
    });
  }
  getStrategy(id) { const row = this.db.prepare('SELECT body FROM strategies WHERE id=?').get(id); return row ? this.applyQualityReview(JSON.parse(row.body)) : null; }
  saveTreePreparation(preparation, hash) {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT hash,body FROM tree_preparations WHERE preparation_id=?').get(preparation.preparationId);
      if (old) {
        invariant(old.hash === hash, 'PREPARATION_CONFLICT', 'preparationId 已用于不同的准备参数；请使用新的 preparationId', 409);
        return JSON.parse(old.body);
      }
      this.db.prepare('INSERT INTO tree_preparations VALUES(?,?,?,?)').run(preparation.preparationId, hash, JSON.stringify(preparation), preparation.createdAt);
      return preparation;
    });
  }
  getTreePreparation(preparationId) {
    const row = this.db.prepare('SELECT body FROM tree_preparations WHERE preparation_id=?').get(preparationId);
    return row ? JSON.parse(row.body) : null;
  }
  bindTreeView(binding) {
    const siteId = binding.siteId ?? 'demo-hainan';
    // Keep the legacy table shape while namespacing non-Hainan trees. This
    // allows T-0001 to exist independently in all parks without a destructive
    // SQLite migration; old Hainan rows remain readable as plain tree IDs.
    const storageTreeId = siteId === 'demo-hainan' ? binding.treeId : `${siteId}::${binding.treeId}`;
    const previous=this.getTreeViewBinding(binding.treeId,binding.kind,binding.dataMode,siteId);
    const order=this.db.prepare('SELECT rowid AS n FROM runs WHERE id=?').get(binding.runId);
    invariant(order,'RUN_NOT_FOUND','策略视图不能绑定不存在的运行',404);
    const priorOrder=previous&&this.db.prepare('SELECT rowid AS n FROM runs WHERE id=?').get(previous.runId);
    if(priorOrder&&priorOrder.n>order.n)return previous;
    this.db.prepare(`INSERT INTO tree_view_bindings(tree_id,kind,data_mode,preparation_id,request_id,run_id,context_snapshot_id,as_of)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tree_id,kind,data_mode) DO UPDATE SET preparation_id=excluded.preparation_id,request_id=excluded.request_id,run_id=excluded.run_id,context_snapshot_id=excluded.context_snapshot_id,as_of=excluded.as_of`)
      .run(storageTreeId, binding.kind, binding.dataMode, binding.preparationId, binding.requestId, binding.runId, binding.contextSnapshotId, binding.asOf);
    return { ...binding, siteId };
  }
  preserveTreeView(binding,expectedRunId,now,reason) {
    return this.transaction(()=>{
      const siteId=binding.siteId??'demo-hainan',storageTreeId=siteId==='demo-hainan'?binding.treeId:`${siteId}::${binding.treeId}`;
      const changed=this.db.prepare(`UPDATE tree_view_bindings SET preparation_id=?,request_id=?,run_id=?,context_snapshot_id=?,as_of=?
        WHERE tree_id=? AND kind=? AND data_mode=? AND run_id=?`).run(binding.preparationId,binding.requestId,binding.runId,
          binding.contextSnapshotId,binding.asOf,storageTreeId,binding.kind,binding.dataMode,expectedRunId).changes;
      // Recovery must not republish a background result suppressed by a human
      // decision. Keep its model result in history, with the reason for hiding it.
      if(changed)this.event(expectedRunId,'automatic_view_preserved',now,{treeId:binding.treeId,siteId,reason,previousRunId:binding.runId});
      return Boolean(changed);
    });
  }
  // Call inside the submission/recovery transaction. This also repairs legacy
  // automatic runs whose result was saved without a tree-view binding.
  publishAutomaticTreeViews(runId) {
    if(!this.db.prepare('SELECT 1 FROM automatic_runs WHERE run_id=?').get(runId))return;
    const run=this.getRun(runId),request=run.request;
    if(!['tapping_angle','surface_action','growth_plan','pest_risk'].includes(request.kind))return;
    const context=this.getContext(request.inputSnapshot.snapshotId,request.inputSnapshot.version);
    if(!context?.modules.trees)return;
    const dataMode=context.dataPolicy?.mode??'demo';
    if(!['demo','mixed_demo'].includes(dataMode))return;
    for(const treeId of context.targetSnapshot.treeIds){
      if(this.db.prepare("SELECT 1 FROM events WHERE run_id=? AND stage='automatic_view_preserved' AND json_extract(data,'$.treeId')=? AND json_extract(data,'$.siteId')=?").get(runId,treeId,context.siteId))continue;
      this.bindTreeView({treeId,siteId:context.siteId,kind:request.kind,dataMode,
        preparationId:request.requestId,requestId:request.requestId,runId,
        contextSnapshotId:context.snapshotId,asOf:context.asOf});
    }
  }
  getTreeViewBinding(treeId, kind, dataMode, siteId = 'demo-hainan') {
    const scoped = siteId === 'demo-hainan' ? treeId : `${siteId}::${treeId}`;
    let row = this.db.prepare('SELECT * FROM tree_view_bindings WHERE tree_id=? AND kind=? AND data_mode=?').get(scoped, kind, dataMode);
    // Rows written before site scoping used plain T- IDs and belong to the
    // legacy Hainan demo only.
    if (!row && siteId === 'demo-hainan' && scoped !== treeId) row = this.db.prepare('SELECT * FROM tree_view_bindings WHERE tree_id=? AND kind=? AND data_mode=?').get(treeId, kind, dataMode);
    return row ? { treeId, siteId, kind: row.kind, dataMode: row.data_mode, preparationId: row.preparation_id, requestId: row.request_id, runId: row.run_id, contextSnapshotId: row.context_snapshot_id, asOf: row.as_of } : null;
  }
  // The Blender tree-view adapter needs the most recent strategy that directly
  // names one tree.  Strategy rows are immutable; scanning the small strategy
  // index keeps this lookup independent of proposal JSON layout in SQLite while
  // still allowing each proposal kind to expose its own tree references.
  latestTreeStrategy({ treeId, kind, siteId, dataMode = 'demo' } = {}) {
    const rows = this.db.prepare('SELECT body FROM strategies ORDER BY rowid DESC').all();
    for (const row of rows) {
      const strategy = this.applyQualityReview(JSON.parse(row.body));
      if (kind && strategy.kind !== kind) continue;
      if (siteId && strategy.siteId !== siteId) continue;
      const mode = strategy.dataPolicy?.mode === 'mixed_demo' ? 'mixed_demo' : 'demo';
      if (mode !== dataMode) continue;
      const proposal = strategy.proposal ?? {};
      const referencesTree = strategy.kind === 'tapping_angle' && proposal.treeId === treeId
        || strategy.kind === 'surface_action' && (proposal.findings ?? []).some(x => x.treeId === treeId)
        || strategy.kind === 'growth_plan' && ((proposal.predictions ?? []).some(x => x.treeId === treeId) || (proposal.futurePanelPlan ?? []).some(x => x.treeId === treeId))
        || strategy.kind === 'pest_risk' && ((proposal.findings ?? []).some(x => x.treeId === treeId) || (proposal.inspectionTargets ?? []).includes(treeId));
      if (referencesTree) return strategy;
    }
    return null;
  }
  getAutomaticState() { const row=this.db.prepare('SELECT body FROM automatic_state WHERE id=1').get();return row?JSON.parse(row.body):{}; }
  getModelControl() {
    const row=this.db.prepare('SELECT paused,updated_at FROM model_control WHERE id=1').get();
    return {paused:Boolean(row?.paused),updatedAt:row?.updated_at??null};
  }
  setModelPaused(paused,now) {
    invariant(typeof paused==='boolean','INVALID_MODEL_CONTROL','模型暂停开关必须为布尔值',422);
    this.db.prepare('INSERT INTO model_control VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET paused=excluded.paused,updated_at=excluded.updated_at').run(Number(paused),now);
    return this.getModelControl();
  }
  assertModelEnabled() {
    invariant(!this.getModelControl().paused,'MODEL_PAUSED','模型调用已暂停；请显式恢复模型调用后重新提交，或选择离线规则演示',409);
  }
  saveAutomaticState(state) { this.db.prepare('INSERT INTO automatic_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(state)); }
  automaticBudget(now) {
    const since=new Date(Date.parse(now)-86400000).toISOString();
    const runs=this.db.prepare('SELECT count(*) n,min(created_at) oldest FROM automatic_runs WHERE created_at>?').get(since);
    const calls=this.db.prepare('SELECT count(*) n,min(at) oldest FROM automatic_requests WHERE at>?').get(since);
    return {runs:runs.n,modelRequests:calls.n,oldestRunAt:runs.oldest,oldestRequestAt:calls.oldest};
  }
  automaticRuns(limit=20) { return this.db.prepare('SELECT r.* FROM runs r JOIN automatic_runs a ON a.run_id=r.id ORDER BY r.rowid DESC LIMIT ?').all(limit).map(r=>this.decode(r)); }
  automaticRun(jobId,cycleKey) { const row=this.db.prepare('SELECT run_id FROM automatic_runs WHERE job_id=? AND cycle_key=?').get(jobId,cycleKey);return row?this.getRun(row.run_id):null; }
  reserveAutomaticRequest(runId,now) {
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM automatic_runs WHERE run_id=?').get(runId);if(!row)return;
      const state=this.getAutomaticState();
      // Fusion tree refresh owns its enable/pause switches. The legacy
      // AutomaticRunner is intentionally disabled there, but both schedulers
      // still share the persisted rolling budget and provider fault circuit.
      const refresh=row.job_id.startsWith('refresh-tree:');
      const enabled=refresh?state.refreshEnabled===true&&!state.refreshPaused:state.configuredEnabled!==false&&!state.paused;
      invariant(enabled&&!state.circuitReason,'AUTO_PAUSED','自动运行已暂停，不再发送新的模型请求',409);
      const used=this.db.prepare('SELECT count(*) n FROM automatic_requests WHERE run_id=?').get(runId).n;
      const requestLimit=(refresh?state.refreshRequestLimit:state.requestLimit)??row.daily_request_limit;
      invariant(used<row.max_requests&&this.automaticBudget(now).modelRequests<Math.min(row.daily_request_limit,requestLimit),'AUTO_BUDGET_EXHAUSTED','自动模型调用预算已用完，未发送请求',429);
      // Persist before HTTP: even an interrupted/ambiguous request counts against the cap.
      this.db.prepare('INSERT INTO automatic_requests(run_id,at) VALUES(?,?)').run(runId,now);
    });
  }
  close() { this.db.close(); }
}
