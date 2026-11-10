import {randomUUID} from 'node:crypto';
import {TREE_IDS,normalizeSiteId} from './adapters/park-demo.js';
import {treePreparationSkipReason} from './tree-preparation-policy.js';
import {classifyStrategyRoute} from './strategy-routing.js';

const kinds=[['tapping_angle','单树割线'],['surface_action','树表异常'],['growth_plan','生长与割面'],['pest_risk','健康巡查']];
const defaults={maxRunsPer24Hours:783,maxModelRequestsPer24Hours:1566,maxRequestsPerRun:2,maxConsecutiveFailures:2};
const controlCodes=new Set(['MODEL_PAUSED','AUTO_PAUSED','AUTO_BUDGET_EXHAUSTED']);
const providerCodes=new Set(['LLM_NOT_CONFIGURED','LLM_ACCOUNT_UNAVAILABLE','LLM_REQUEST_REJECTED','CANDIDATE_SERVICE_NOT_CONFIGURED']);

// One shared path for every park. Paid work is single-tree and serial; ordinary
// rules remain batched. Only advice is published: this never adopts or dispatches.
export async function prepareStrategySnapshots({siteId,reason='scheduled',cycleId='refresh-'+randomUUID(),store,runtime,makeContext,
  dataMode='mixed_demo',clock=()=>new Date(),modelsEnabled=false,modelLimits={},authorize=()=>{},treeIds=TREE_IDS}) {
  siteId=normalizeSiteId(siteId);
  const limits={...defaults,...modelLimits},items=[];
  let modelRequests=0;
  const protectedReason=(treeId,kind,requireBrain=false)=>treePreparationSkipReason({store,treeId,siteId,kind,dataMode,
    now:clock(),background:true,refreshReason:reason,preserveConfigured:true,requireBrain});
  const contextFor=ids=>{
    const context=makeContext({siteId,treeIds:ids,dataMode,now:clock()});
    if(context.siteId!==siteId||context.targetSnapshot.siteId!==siteId)throw Error('后台策略输入不属于当前园区');
    return context;
  };
  const modelBlocked=()=>{
    const state=store.getAutomaticState(),budget=store.automaticBudget(clock().toISOString());
    if(store.getModelControl().paused)return '模型调用已暂停，等待恢复后自动分析';
    if(state.circuitReason)return `模型服务异常，等待在大脑管理中恢复自动分析：${state.circuitReason.message}`;
    if(budget.runs>=limits.maxRunsPer24Hours||budget.modelRequests>=limits.maxModelRequestsPer24Hours)return '自动分析已达到滚动 24 小时额度，额度恢复后的后台周期继续分析';
    return null;
  };
  const generate=async(kind,ids,generatorMode='demo_rules',context=contextFor(ids))=>{
    authorize();store.saveContext(context);
    const previousBindings=new Map(ids.map(treeId=>[treeId,store.getTreeViewBinding(treeId,kind,dataMode,siteId)]));
    const requestId='refresh-'+randomUUID();
    const before=store.automaticBudget(clock().toISOString()).modelRequests;
    const accepted=runtime.submit({requestId,kind,siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,
      inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode,
      trigger:{type:reason==='scheduled'?'scheduled':'event',eventId:cycleId}},generatorMode==='configured'?{
        ...limits,cycleKey:cycleId,jobId:`refresh-tree:${siteId}:${kind}:${ids.join(',')}`} : undefined);
    // Register the pending view before yielding so polling sees real progress.
    // No completion-time rebind: a later manual action/request remains authoritative.
    for(const treeId of ids)store.bindTreeView({treeId,siteId,kind,dataMode,preparationId:requestId,requestId,
      runId:accepted.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
    await runtime.execute(accepted.runId);
    // A normal runtime pump may have already claimed a queued run.
    while(['queued','running'].includes(store.getRun(accepted.runId).status))await new Promise(resolve=>setTimeout(resolve,25));
    const run=store.getRun(accepted.runId);
    // A person may stop/skip/withdraw the displayed prior strategy while a
    // slow model is in flight. Restore that decision only if this is still
    // our pending binding; never overwrite a newer manually generated view.
    for(const treeId of ids){
      const previous=previousBindings.get(treeId),current=store.getTreeViewBinding(treeId,kind,dataMode,siteId);
      if(!previous||current?.runId!==accepted.runId)continue;
      const withdrawn=store.getRun(previous.runId)?.result?.strategy?.qualityReview?.status==='withdrawn';
      const protection=withdrawn?'withdrawn':protectedReason(treeId,kind);
      if(['withdrawn','angle_adopted','review_skip'].includes(protection))store.preserveTreeView(previous,accepted.runId,clock().toISOString(),protection);
    }
    modelRequests+=store.automaticBudget(clock().toISOString()).modelRequests-before;
    return run;
  };
  const record=(item,run,count)=>{
    if(run.status==='needs_data'){item.needsData+=count;item.prepared+=count;return;}
    if(run.status!=='succeeded'){
      if(controlCodes.has(run.result?.error?.code))item.deferred+=count;else item.failed+=count;
      item.error=run.result?.error?.message??'后台策略未完成';return;
    }
    item.prepared+=count;
    const fallback=run.result?.strategy?.fallback;
    if(fallback){item.fallbacks+=count;item.error=`大脑未形成可采用结果，已标明规则保底，等待复核：${fallback.message}`;}
    // AutomaticRunner normally records provider faults. Standalone/internal
    // callers still stop the cycle after an account/configuration failure.
    if(providerCodes.has(fallback?.reasonCode)){
      const state=store.getAutomaticState();
      store.saveAutomaticState({...state,circuitReason:state.circuitReason??{code:fallback.reasonCode,message:fallback.message}});
    }
  };
  for(const [kind,label] of kinds){
    const item={kind,label,status:'succeeded',prepared:0,preserved:0,needsData:0,failed:0,deferred:0,fallbacks:0};items.push(item);
    const simple=[],complex=[];
    for(const treeId of treeIds){
      authorize();
      const context=contextFor([treeId]),route=classifyStrategyRoute(context,{treeId,kind});
      // Delegated routes must also reach runtime's 1-in-5 model audit decision.
      const requireBrain=modelsEnabled&&(route.status==='needs_big_brain'||Boolean(route.delegation));
      if(protectedReason(treeId,kind,requireBrain)){item.preserved++;continue;}
      (requireBrain?complex:simple).push(treeId);
    }
    // Fill free/missing-data views even if the model is paused or out of quota.
    const size=kind==='tapping_angle'?1:10;
    for(let offset=0;offset<simple.length;offset+=size){
      authorize();const ids=simple.slice(offset,offset+size).filter(treeId=>{if(protectedReason(treeId,kind)){item.preserved++;return false;}return true;});
      if(!ids.length)continue;
      try{record(item,await generate(kind,ids),ids.length);}catch(error){if(error.code==='STRATEGY_REFRESH_PAUSED')throw error;item.failed+=ids.length;item.error=error.message;}
    }
    for(const treeId of complex){
      authorize();
      if(protectedReason(treeId,kind,true)){item.preserved++;continue;}
      const blocked=modelBlocked();
      if(blocked){item.deferred++;item.error=blocked;continue;}
      try{record(item,await generate(kind,[treeId],'configured'),1);}
      catch(error){if(error.code==='STRATEGY_REFRESH_PAUSED')throw error;if(controlCodes.has(error.code))item.deferred++;else item.failed++;item.error=error.message;}
    }
    if(item.failed||item.deferred||item.fallbacks||item.needsData){
      item.status=item.failed&&!item.prepared&&!item.preserved&&!item.deferred?'failed':'partial';
      item.error??=`${item.needsData} 棵树的策略等待补充业务数据，已保留待补充状态`;
    }
  }
  for(const [kind,label] of [['weather_window','天气与作业'],['market_scenario','经营情景规则']]){
    authorize();
    const item={kind,label,status:'succeeded',prepared:0,preserved:0,needsData:0,failed:0};items.push(item);
    const previous=store.listRuns({kind,dataMode,siteId,limit:1}).items[0],strategy=previous?.result?.strategy;
    if(strategy?.qualityReview?.status==='withdrawn'||previous&&['queued','running'].includes(previous.status)
      ||strategy&&Date.parse(strategy.expiresAt)>+clock()&&(reason!=='scheduled'||previous.request.generatorMode==='configured')){item.preserved++;continue;}
    try{
      // Non-tree packages do not belong in the single-tree view index.
      const context=contextFor(treeIds);store.saveContext(context);const requestId='refresh-'+randomUUID();
      const accepted=runtime.submit({requestId,kind,siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,
        inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode:'demo_rules',
        trigger:{type:reason==='scheduled'?'scheduled':'event',eventId:cycleId}});
      await runtime.execute(accepted.runId);
      while(['queued','running'].includes(store.getRun(accepted.runId).status))await new Promise(resolve=>setTimeout(resolve,25));
      const run=store.getRun(accepted.runId);
      if(!['succeeded','needs_data'].includes(run.status))throw Error(run.result?.error?.message??'规则快照未完成');
      item.prepared++;if(run.status==='needs_data'){item.needsData++;item.status='partial';item.error='缺少必要业务数据，已保留待补充状态';}
    }catch(error){item.status='failed';item.failed++;item.error=error.message;}
  }
  return {siteId,dataMode,reason,items,preparedAt:clock().toISOString(),modelRequests};
}
