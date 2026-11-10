import {randomUUID} from 'node:crypto';
import {normalizeSiteId, parkSite} from './adapters/park-demo.js';
import {invariant} from './errors.js';

const SNAPSHOT_KINDS = [
  ['tapping_angle','单树割线方案'], ['surface_action','树表异常处理'],
  ['growth_plan','生长与割面规划'], ['pest_risk','健康巡查建议'],
  ['weather_window','天气作业窗口'], ['market_scenario','经营情景分析'],
  ['industry_brief','行业与经营研判'], ['scenarios','演示场景'],
];
const BUSINESS_KINDS = [['park_plan','全园生产计划'],['market_sales','经营与销售比较']];
const details = error => ({code:error?.code ?? 'STRATEGY_REFRESH_FAILED', message:error?.message ?? '后台策略更新未完成'});
const item = ([kind,label]) => ({kind,label,status:'idle',lastSuccessAt:null});

/** Background generation only. This service never adopts strategies or dispatches tasks. */
export class StrategyRefresh {
  constructor({store,clock=()=>new Date(),config={},prepareSnapshots=null,prepareSiteSnapshots=null,refreshProduction,productionFresh,
    refreshMarket,marketFresh}) {
    const intervalMinutes=config.intervalMinutes ?? 60;
    invariant(Number.isFinite(intervalMinutes)&&intervalMinutes>=1,'INVALID_CONFIG','策略更新间隔无效。');
    Object.assign(this,{store,clock,prepareSnapshots,prepareSiteSnapshots,refreshProduction,productionFresh,refreshMarket,marketFresh});
    this.config={enabled:config.enabled===true,intervalMinutes,startupCatchUp:config.startupCatchUp!==false,modelsEnabled:config.modelsEnabled!==false,
      treeModelsEnabled:config.treeModelsEnabled===true,maxTreeModelRequestsPer24Hours:config.maxTreeModelRequestsPer24Hours??1566};
    invariant(Number.isInteger(this.config.maxTreeModelRequestsPer24Hours)&&this.config.maxTreeModelRequestsPer24Hours>0,'INVALID_CONFIG','单树模型调用额度无效。');
    this.store.db.exec('CREATE TABLE IF NOT EXISTS strategy_refresh_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    const saved=this.store.db.prepare('SELECT body FROM strategy_refresh_state WHERE id=1').get();
    this.state=saved?JSON.parse(saved.body):{paused:false,sites:{}};
    this.state.sites??={};
    this.running=null;this.pending=new Map();this.stopped=true;this.timer=null;
    for(const site of Object.values(this.state.sites)) {
      if(site.status==='running')site.status='idle';
      for(const entry of site.items??[])if(entry.status==='running')entry.status='idle';
    }
    for(const siteId of config.siteIds ?? ['demo-hainan'])this.ensureSite(siteId);
    this.persist();
  }
  persist() {
    this.store.db.prepare('INSERT INTO strategy_refresh_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(this.state));
    this.store.saveAutomaticState({...this.store.getAutomaticState(),refreshEnabled:this.config.enabled&&this.config.treeModelsEnabled,
      refreshPaused:this.state.paused,refreshRequestLimit:this.config.maxTreeModelRequestsPer24Hours});
  }
  ensureSite(value) {
    const siteId=normalizeSiteId(value);
    const snapshots=siteId==='demo-hainan'?SNAPSHOT_KINDS:SNAPSHOT_KINDS.filter(([kind])=>!['industry_brief','scenarios'].includes(kind));
    if(!this.state.sites[siteId])this.state.sites[siteId]={siteId,status:'idle',lastStartedAt:null,lastFinishedAt:null,
      nextRunAt:null,lastError:null,items:[...snapshots,...(parkSite(siteId).regionId?BUSINESS_KINDS:[])].map(item)};
    return this.state.sites[siteId];
  }
  setPrepareSnapshots(callback) {invariant(typeof callback==='function','INVALID_CONFIG','缺少后台快照准备回调。');this.prepareSnapshots=callback;return this;}
  activateSite(value) {
    if(!this.config.enabled)return;
    const siteId=normalizeSiteId(value),existed=Boolean(this.state.sites[siteId]);
    this.ensureSite(siteId);
    if(!existed){this.persist();if(!this.stopped){this.pending.set(siteId,'site_activated');this.wake();}}
  }
  setPaused(paused) {
    this.state.paused=Boolean(paused);this.persist();
    if(!paused&&!this.stopped){for(const siteId of Object.keys(this.state.sites))this.pending.set(siteId,'startup');this.wake();}
    return this.status();
  }
  status(siteId) {
    const selected=siteId?this.state.sites[normalizeSiteId(siteId)]:null;
    const sites=selected?[selected]:Object.values(this.state.sites);
    const latest=sites.slice().sort((a,b)=>(b.lastStartedAt??'').localeCompare(a.lastStartedAt??''))[0];
    const circuitReason=this.config.treeModelsEnabled?this.store.getAutomaticState().circuitReason:null;
    const paused=this.state.paused||this.store.getModelControl().paused||Boolean(circuitReason);
    const runStatus=!this.config.enabled?'disabled':paused?'paused':sites.some(site=>site.status==='running')?'running':selected?.status??latest?.status??'idle';
    const next=sites.map(site=>site.nextRunAt).filter(Boolean).sort()[0]??null;
    return {...this.config,status:runStatus,paused:Boolean(paused),lastStartedAt:latest?.lastStartedAt??null,
      lastFinishedAt:latest?.lastFinishedAt??null,nextRunAt:this.config.enabled&&!paused?next:null,lastError:circuitReason??latest?.lastError??null,
      items:(selected?.items??latest?.items??[]).map(entry=>({...entry})),
      scope:{siteIds:Object.keys(this.state.sites),kinds:[...new Set(sites.flatMap(site=>site.items.map(entry=>entry.kind)))]},
      ...(siteId?{siteId:normalizeSiteId(siteId)}:{}),generationOnly:true};
  }
  start() {
    if(!this.stopped)return this;
    this.stopped=false;
    if(this.config.enabled){
      for(const site of Object.values(this.state.sites)) {
        if(this.config.startupCatchUp)this.pending.set(site.siteId,'startup');
        else site.nextRunAt??=new Date(+this.clock()+this.config.intervalMinutes*60000).toISOString();
      }
      this.persist();this.wake();
      this.timer=setInterval(()=>this.wake(),30_000);this.timer.unref?.();
    }
    return this;
  }
  async stop() {this.stopped=true;clearInterval(this.timer);this.timer=null;if(this.running)await this.running;}
  wake() {void this.tick().catch(error=>{
    const site=Object.values(this.state.sites).find(row=>row.status==='running');
    if(site){site.status='failed';site.lastError=details(error);site.lastFinishedAt=this.clock().toISOString();
      site.nextRunAt=new Date(+this.clock()+this.config.intervalMinutes*60000).toISOString();this.persist();}
  });}
  async tick() {
    if(this.running)return this.running;
    if(this.stopped||!this.config.enabled||this.state.paused)return;
    const now=+this.clock();
    for(const site of Object.values(this.state.sites))if(site.nextRunAt&&Date.parse(site.nextRunAt)<=now&&!this.pending.has(site.siteId))this.pending.set(site.siteId,'scheduled');
    const next=this.pending.entries().next().value;
    if(!next)return;
    const [siteId,reason]=next;this.pending.delete(siteId);
    this.running=this.cycle(siteId,reason).finally(()=>{this.running=null;if(this.pending.size&&!this.stopped)this.wake();});
    return this.running;
  }
  assertActive(model=false) {
    invariant(!this.stopped&&!this.state.paused,'STRATEGY_REFRESH_PAUSED','后台策略更新已暂停。',409);
    if(model)invariant(!this.store.getModelControl().paused,'MODEL_PAUSED','模型调用已暂停。',409);
  }
  async cycle(siteId,reason) {
    const site=this.ensureSite(siteId),started=this.clock(),cycleId=`refresh-${randomUUID()}`;
    site.status='running';site.lastStartedAt=started.toISOString();site.lastError=null;site.nextRunAt=null;
    for(const entry of site.items){entry.status='idle';delete entry.error;}
    this.persist();
    const mark=(kinds,patch)=>{for(const entry of site.items)if(kinds.includes(entry.kind))Object.assign(entry,patch);this.persist();};
    const failures=[];let interrupted=false;
    const run=async(kinds,callback)=>{
      const previousSuccess=new Map(site.items.map(entry=>[entry.kind,entry.lastSuccessAt]));
      try {
        this.assertActive();mark(kinds,{status:'running'});
        const result=await callback();
        mark(kinds,{status:result?.skipped?'current':'succeeded',lastSuccessAt:this.clock().toISOString()});
        if(Array.isArray(result?.items))for(const row of result.items){
          const target=site.items.find(entry=>entry.kind===row.kind);
          if(target){
            Object.assign(target,row);
            if(['failed','partial'].includes(row.status)){target.lastSuccessAt=previousSuccess.get(row.kind)??null;
              target.error=typeof row.error==='string'?{code:'SNAPSHOT_INCOMPLETE',message:row.error}:row.error??{code:'SNAPSHOT_INCOMPLETE',message:'部分策略尚未更新。'};failures.push(target.error);}
          }
        }
        this.persist();return true;
      } catch(error) {
        const errorDetail=details(error);failures.push(errorDetail);
        interrupted=['MODEL_PAUSED','STRATEGY_REFRESH_PAUSED'].includes(errorDetail.code);
        mark(kinds,{status:interrupted?'paused':'failed',error:errorDetail});return false;
      }
    };
    const snapshotKinds=site.items.filter(entry=>SNAPSHOT_KINDS.some(([kind])=>kind===entry.kind)).map(entry=>entry.kind);
    const prepared=await run(snapshotKinds,async()=>{
      const prepare=siteId==='demo-hainan'?this.prepareSnapshots:this.prepareSiteSnapshots;
      invariant(prepare,'STRATEGY_PREPARATION_UNAVAILABLE','后台快照准备尚未配置。',503);
      return prepare({siteId,reason,cycleId,modelsEnabled:this.config.treeModelsEnabled,authorize:()=>this.assertActive()});
    });
    if(parkSite(siteId).regionId&&!interrupted) {
      if(!this.config.modelsEnabled)mark(['park_plan'],{status:'skipped',error:{code:'MODEL_NOT_CONFIGURED',message:'离线演示未配置模型，全园模型策略未生成。'}});
      else if(this.store.getModelControl().paused)mark(['park_plan'],{status:'paused',error:{code:'MODEL_PAUSED',message:'模型调用已暂停，保留原全园方案。'}});
      else if(prepared)await run(['park_plan'],async()=>{
        if(reason!=='scheduled'&&await this.productionFresh?.(siteId,started))return {skipped:true};
        return this.refreshProduction(siteId,()=>this.assertActive(true));
      });
      else mark(['park_plan'],{status:'failed',error:{code:'SNAPSHOT_PREPARATION_FAILED',message:'基础策略准备未完成，全园模型留待下一轮。'}});
      if(!interrupted)await run(['market_sales'],async()=>{
        if(reason!=='scheduled'&&await this.marketFresh?.(siteId,started))return {skipped:true};
        this.assertActive();return this.refreshMarket(siteId);
      });
    }
    const ended=this.clock();
    site.lastFinishedAt=ended.toISOString();
    site.nextRunAt=new Date(Math.max(+started+this.config.intervalMinutes*60000,+ended+1000)).toISOString();
    site.lastError=failures[0]??null;
    site.status=interrupted?'paused':failures.length?(site.items.some(entry=>['succeeded','current'].includes(entry.status))?'partial':'failed'):'idle';
    this.persist();return this.status(siteId);
  }
}
