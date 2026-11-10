import { KINDS } from './contracts.js';
import { s, id, validate } from './schema.js';
import { invariant } from './errors.js';
import { digest, iso } from './util.js';
import { makeMixedContext, makeIndustryContext } from './adapters/public-context.js';
import { makeParkContext } from './adapters/park-demo.js';
import { classifyStrategyRoute } from './strategy-routing.js';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

// Automatic analysis can be configured for the full 200-tree demonstration
// park.  A tapping-angle request still targets one tree, so the full-park
// configuration expands that capability into one job per tree; the other
// tree-level capabilities may also be split per tree to keep model payloads
// and strategy outputs bounded.
const configSchema=s.obj({enabled:s.bool(),intervalMinutes:s.int({minimum:5,maximum:1440}),maxRunsPer24Hours:s.int({minimum:1,maximum:2000}),maxModelRequestsPer24Hours:s.int({minimum:1,maximum:4000}),maxRequestsPerRun:s.int({minimum:1,maximum:2}),maxConsecutiveFailures:s.int({minimum:1,maximum:5}),jobs:s.arr(s.obj({id,kind:s.enum(...KINDS),treeIds:s.arr(id,{maxItems:200,uniqueItems:true})}),{minItems:1,maxItems:1000})});
const terminal=status=>['succeeded','needs_data','failed'].includes(status);
const severe=new Set(['LLM_ACCOUNT_UNAVAILABLE','LLM_NOT_CONFIGURED','LLM_REQUEST_REJECTED']);
const contentOnlyFailure=new Set(['CANDIDATE_REJECTED','INVALID_CANDIDATE','LLM_INCOMPLETE']);
const controlFailure=new Set(['MODEL_PAUSED','AUTO_PAUSED','AUTO_BUDGET_EXHAUSTED']);
const defaultTreeContext=options=>options.dataMode==='demo'?makeParkContext(options):makeMixedContext(options);
export class AutomaticRunner {
  constructor({store,runtime,service,config,clock=()=>new Date(),outputDirectory=null,treeContext=defaultTreeContext,dataMode='mixed_demo'}) {
    validate(configSchema,config,'INVALID_CONFIG');
    invariant(['demo','mixed_demo'].includes(dataMode),'INVALID_CONFIG','自动分析数据模式必须为 demo 或 mixed_demo');
    invariant(new Set(config.jobs.map(j=>j.id)).size===config.jobs.length,'INVALID_CONFIG','自动任务 id 不能重复');
    for(const j of config.jobs)invariant(j.kind==='industry_brief'?j.treeIds.length===0:j.treeIds.length>0&&j.treeIds.every(t=>/^T-\d{4}$/.test(t)&&Number(t.slice(2))>=1&&Number(t.slice(2))<=200),'INVALID_CONFIG','自动任务需指定有效演示树；行业任务不绑定树');
    for(const job of config.jobs)invariant(job.kind!=='tapping_angle'||job.treeIds.length===1,'INVALID_CONFIG','自动角度分析任务必须且只能绑定一棵树');
    Object.assign(this,{store,runtime,service,config,clock,outputDirectory,treeContext,dataMode});this.timer=null;this.inflight=null;this.stopped=false;this.pendingTrigger=null;
    this.save({configuredEnabled:config.enabled,requestLimit:config.maxModelRequestsPer24Hours});
    runtime.onTerminal(run=>this.finalizeRun(run));
    store.transaction(()=>{
      for(const row of store.db.prepare('SELECT run_id FROM automatic_runs ORDER BY rowid').all())store.publishAutomaticTreeViews(row.run_id);
    });
    // Covers a crash after the terminal result was committed but before its
    // automatic bookkeeping. Legacy runs already included in lastFinishedAt
    // are marked without replaying old failures or clearing a user's resume.
    const existingState=this.store.getAutomaticState();
    const hasBookkeeping=existingState.terminalBookkeepingVersion===1||Boolean(this.store.db.prepare("SELECT 1 FROM events WHERE stage='automatic_finished' LIMIT 1").get());
    const accountedThrough=hasBookkeeping?undefined:existingState.lastFinishedAt;
    for(const row of this.store.db.prepare("SELECT r.id FROM runs r JOIN automatic_runs a ON a.run_id=r.id WHERE r.status IN ('succeeded','needs_data','failed') ORDER BY r.rowid").all()) {
      this.finalizeRun(this.store.getRun(row.id),{accountedThrough});
    }
    // A crash can occur after the provider fault is persisted but before the
    // fallback result is committed. Block recovery's next paid request first.
    for(const row of this.store.db.prepare("SELECT r.id FROM runs r JOIN automatic_runs a ON a.run_id=r.id WHERE r.status IN ('queued','running') ORDER BY r.rowid").all()) {
      const run=this.store.getRun(row.id),fallback=this.attemptFallback(run);
      if(!severe.has(fallback?.reasonCode))continue;
      this.store.transaction(()=>{
        const recorded=this.store.db.prepare("SELECT 1 FROM events WHERE run_id=? AND stage='automatic_fault' AND json_extract(data,'$.attempt')=?").get(run.runId,run.attempt);
        if(recorded)return;
        const state=this.store.getAutomaticState(),error={code:fallback.reasonCode,message:fallback.message};
        this.save({consecutiveFailures:(state.consecutiveFailures??0)+1,lastError:error,circuitReason:state.circuitReason??error,updatedAt:iso(this.clock())});
        this.store.event(run.runId,'automatic_fault',iso(this.clock()),{attempt:run.attempt,...error});
      });
    }
    this.save({terminalBookkeepingVersion:1});
  }
  save(patch) {this.store.saveAutomaticState({...this.store.getAutomaticState(),...patch});}
  attemptEvent(run,stage) {
    const row=this.store.db.prepare(`SELECT data FROM events WHERE run_id=? AND stage=?
      AND seq>COALESCE((SELECT MAX(seq) FROM events WHERE run_id=? AND stage IN ('retry_requested','recovered')),0)
      ORDER BY seq DESC LIMIT 1`).get(run.runId,stage,run.runId);
    return row?JSON.parse(row.data):null;
  }
  attemptFallback(run) {
    // A fallback can end in needs_data if its input expires before publication.
    // Never reuse a failure from an earlier retry or recovered attempt.
    return run.result?.strategy?.fallback??this.attemptEvent(run,'candidate_fallback');
  }
  finalizeRun(run,{accountedThrough}={}) {
    if(!run?.result||!terminal(run.status))return;
    const isAutomatic=this.store.transaction(()=>{
      if(!this.store.db.prepare('SELECT 1 FROM automatic_runs WHERE run_id=?').get(run.runId))return false;
      const done=this.store.db.prepare("SELECT 1 FROM events WHERE run_id=? AND stage='automatic_finished' AND COALESCE(json_extract(data,'$.attempt'),1)=?").get(run.runId,run.attempt);
      if(done)return true;
      const alreadyAccounted=accountedThrough&&Date.parse(run.updatedAt)<=Date.parse(accountedThrough);
      if(!alreadyAccounted) {
        const state=this.store.getAutomaticState(),fallback=this.attemptFallback(run);
        const error=fallback?{code:fallback.reasonCode,message:fallback.message}:run.result.error;
        const errorCode=error?.code,contentFailure=contentOnlyFailure.has(errorCode);
        const operationalFailure=Boolean(error)&&!contentFailure&&!controlFailure.has(errorCode);
        const faultAlreadyCounted=Boolean(this.store.db.prepare("SELECT 1 FROM events WHERE run_id=? AND stage='automatic_fault' AND json_extract(data,'$.attempt')=?").get(run.runId,run.attempt));
        // Free rule work and paused/budget-limited work are not successful
        // provider calls, so they cannot reset consecutive provider failures.
        // needs_data after candidate validation means the provider worked but
        // the evidence expired. needs_data before generation is not a success.
        const modelSucceeded=!fallback&&(run.status==='succeeded'&&run.result.strategy?.provenance.mode==='estimated'||run.status==='needs_data'&&['llm','candidate_service'].includes(this.attemptEvent(run,'generating')?.generator)&&Boolean(this.attemptEvent(run,'validating')));
        const count=operationalFailure?(state.consecutiveFailures??0)+(faultAlreadyCounted?0:1):contentFailure||modelSucceeded?0:(state.consecutiveFailures??0);
        this.save({consecutiveFailures:count,lastRunId:run.runId,lastResultStatus:run.status,lastError:operationalFailure?error:contentFailure||modelSucceeded?null:state.lastError??null,...((operationalFailure&&(severe.has(errorCode)||count>=this.config.maxConsecutiveFailures))?{circuitReason:{code:errorCode,message:error.message}}:{}),lastFinishedAt:iso(this.clock()),updatedAt:iso(this.clock())});
      }
      this.store.event(run.runId,'automatic_finished',iso(this.clock()),{attempt:run.attempt,status:run.status,...(alreadyAccounted?{alreadyAccounted:true}:{})});
      return true;
    });
    if(!isAutomatic||!this.outputDirectory)return;
    try {
      // Each attempt is immutable. The unsuffixed legacy name denotes attempt
      // one, not the latest result; the database is authoritative for latest.
      mkdirSync(this.outputDirectory,{recursive:true});const path=resolve(this.outputDirectory,`${run.runId}${run.attempt===1?'':`-attempt-${run.attempt}`}.json`);
      if(!existsSync(path))writeFileSync(path,JSON.stringify({recordedAt:iso(this.clock()),attempt:run.attempt,request:run.request,result:run.result,context:this.store.getRunContext(run.runId),events:this.store.events(run.runId)},null,2)+'\n',{flag:'wx'});
    } catch(error) {
      // The SQLite result remains authoritative; stop further paid work if its
      // supplementary archive cannot be written, without masking account errors.
      if(!this.store.getAutomaticState().circuitReason)this.save({circuitReason:{code:'AUTO_ARCHIVE_FAILED',message:'自动结果已保存到数据库，但 JSON 归档失败，请检查存储后恢复'},updatedAt:iso(this.clock())});
      throw error;
    }
  }
  setPaused(paused) {
    this.save({paused,...(!paused?{circuitReason:null,consecutiveFailures:0}:{}),updatedAt:iso(this.clock())});
    if(!paused&&!this.stopped)this.wake();
    return this.status();
  }
  resumeOnStart() {
    // Startup resumes ordinary scheduling; provider/account faults still need
    // an explicit recovery action and must not be hidden by restarting.
    this.save({paused:false,updatedAt:iso(this.clock())});
    return this.status();
  }
  notifyDataChange(change = {}) {
    if (this.stopped || !this.config.enabled) return;
    const sourceIds = Array.isArray(change.sourceIds) ? [...new Set(change.sourceIds)].sort() : [];
    const eventId = change.eventId ?? `source-change-${digest({ sourceIds, at: change.at ?? iso(this.clock()) }).slice(0,24)}`;
    this.pendingTrigger = { type: 'event', eventId, sourceIds, at: change.at ?? iso(this.clock()) };
    this.save({ lastTrigger: this.pendingTrigger, updatedAt: iso(this.clock()) });
    this.wake();
  }
  status() {
    const state=this.store.getAutomaticState(),now=this.clock(),budget=this.store.automaticBudget(iso(now));
    let next=state.lastStartedAt?Date.parse(state.lastStartedAt)+this.config.intervalMinutes*60000:+now;
    if(budget.runs>=this.config.maxRunsPer24Hours)next=Math.max(next,Date.parse(budget.oldestRunAt)+86400000);
    if(budget.modelRequests>=this.config.maxModelRequestsPer24Hours)next=Math.max(next,Date.parse(budget.oldestRequestAt)+86400000);
    const reason=!this.config.enabled?'disabled':state.paused?'paused':this.store.getModelControl().paused?'model_paused':state.circuitReason?'error_paused':this.inflight||this.hasPendingRun()?'running':budget.runs>=this.config.maxRunsPer24Hours||budget.modelRequests>=this.config.maxModelRequestsPer24Hours?'budget_wait':'waiting';
    return {status:reason,config:this.config,...state,dataMode:this.dataMode,budget,nextCheckAt:['disabled','paused','model_paused','error_paused'].includes(reason)?null:iso(Math.max(+now,next)),jobs:this.config.jobs,runs:this.store.automaticRuns(12).map(r=>({runId:r.runId,kind:r.request.kind,status:r.status,createdAt:r.createdAt,qualityReview:r.result?.strategy?.qualityReview??null,summary:r.result?.strategy?.summary??r.result?.error?.message??null}))};
  }
  wake() {this.tick().catch(e=>this.save({circuitReason:{code:e.code??'AUTO_ERROR',message:'自动流程发生错误，请检查记录后恢复'},updatedAt:iso(this.clock())}));}
  start() {
    this.stopped=false;
    this.pendingTrigger={type:'event',eventId:`startup-${digest({at:iso(this.clock())}).slice(0,24)}`,sourceIds:[],at:iso(this.clock())};
    this.wake();
    this.timer=setInterval(()=>this.wake(),60000);this.timer.unref();
  }
  async stop() {this.stopped=true;clearInterval(this.timer);if(this.inflight)await this.inflight;}
  async waitRun(id) {
    const started=Date.now();
    while(true){const run=this.store.getRun(id);if(terminal(run.status))return run;
      invariant(Date.now()-started<300000,'AUTO_WAIT_TIMEOUT','自动运行等待超时，请查看运行记录',503);
      await new Promise(r=>setTimeout(r,25));
    }
  }
  async tick() {
    if(this.inflight)return this.inflight;
    if(this.stopped||!this.config.enabled)return;
    const state=this.store.getAutomaticState(),now=this.clock(),trigger=this.pendingTrigger;
    if(state.paused||state.circuitReason||!trigger&&state.lastStartedAt&&+now-Date.parse(state.lastStartedAt)<this.config.intervalMinutes*60000)return;
    // Let a recovered automatic run finish (and open its circuit if necessary)
    // before submitting another paid cycle after a restart.
    if(this.hasPendingRun())return;
    const budget=this.store.automaticBudget(iso(now));
    if(budget.runs>=this.config.maxRunsPer24Hours||budget.modelRequests>=this.config.maxModelRequestsPer24Hours)return;
    if(trigger&&this.pendingTrigger===trigger)this.pendingTrigger=null;
    this.inflight=this.cycle(trigger??{type:'scheduled',eventId:`cycle-${Math.floor(+now/(this.config.intervalMinutes*60000))}`}).finally(()=>{this.inflight=null;if(this.pendingTrigger)this.wake();});
    return this.inflight;
  }
  hasPendingRun() {return Boolean(this.store.db.prepare("SELECT 1 FROM runs r JOIN automatic_runs a ON a.run_id=r.id WHERE r.status IN ('queued','running') LIMIT 1").get());}
  async cycle(trigger={type:'scheduled',eventId:`cycle-${Math.floor(+this.clock()/(this.config.intervalMinutes*60000))}`}) {
    if(this.stopped||this.store.getAutomaticState().paused)return;
    invariant(this.dataMode==='demo'||this.service,'INVALID_CONFIG','混合模式自动分析需要公开数据服务');
    invariant(this.runtime.contextProvider.mode==='demo','INVALID_CONFIG','当前自动任务使用本地演示快照；远程业务需配置专门触发器');
    const now=this.clock(),cycleKey=trigger.type==='scheduled'?`cycle-${Math.floor(+now/(this.config.intervalMinutes*60000))}`:trigger.eventId;
    this.save({lastStartedAt:iso(now),cycleKey,updatedAt:iso(now)});
    // Collection archives real responses first; unavailable inputs are marked simulated in the context.
    if(this.dataMode==='mixed_demo')await this.service.refresh({notify:false});
    for(const job of this.config.jobs) {
      const state=this.store.getAutomaticState();if(this.stopped||state.paused||state.circuitReason)break;
      let run=this.store.automaticRun(job.id,cycleKey);
      if(!run){
        const budget=this.store.automaticBudget(iso(this.clock()));if(budget.runs>=this.config.maxRunsPer24Hours||budget.modelRequests>=this.config.maxModelRequestsPer24Hours)break;
        const context=job.kind==='industry_brief'?makeIndustryContext({service:this.service,now:this.clock(),dataMode:this.dataMode}):this.treeContext({service:this.service,treeIds:job.treeIds,now:this.clock(),dataMode:this.dataMode});
        this.store.saveContext(context);
        const routes=job.kind==='industry_brief'?[]:job.treeIds.map(treeId=>classifyStrategyRoute(context,{treeId,kind:job.kind}));
        const generatorMode=routes.length&&routes.every(route=>route.status!=='needs_big_brain')?'demo_rules':'configured';
        // Pausing the model still permits simple rule jobs to finish. Complex
        // jobs wait for an explicit model resume and are not recorded as
        // misleading failures.
        if(this.store.getModelControl().paused&&generatorMode==='configured')continue;
        const request={requestId:`auto-${digest({cycleKey,jobId:job.id,trigger}).slice(0,24)}`,kind:job.kind,siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode,trigger:{type:trigger.type,eventId:trigger.eventId}};
        const accepted=this.runtime.submit(request,{...this.config,cycleKey,jobId:job.id});run=this.store.getRun(accepted.runId);
      }
      run=await this.waitRun(run.runId);
      this.finalizeRun(run);
    }
    this.save({lastFinishedAt:iso(this.clock())});
  }
}
