import type {View} from './client';

export type TreeKind = 'tapping_angle' | 'surface_action' | 'growth_plan' | 'pest_risk';
export type ModelMeta = {generator:string;modelVersion:string|null;llm:{provider:string;model:string|null;configured:boolean}|null};
export type ModelControl = {paused:boolean};
type Preparation = {items:{treeId:string;runId:string;status:string}[]};
type Dependencies = {
  prepare:(input:{preparationId:string;treeIds:string[];kind:TreeKind;dataMode:'demo'|'mixed_demo';generatorMode:'configured'|'demo_rules';siteId?:string})=>Promise<Preparation>;
  readView:()=>Promise<View>;
  sleep?:(milliseconds:number,signal:AbortSignal)=>Promise<void>;
  now?:()=>number;
  siteId?:string;
  preparationId?:string;
  timeoutMs?:number;
  onProgress?:(view:View)=>void;
};

export function modelBlockReason(meta?:ModelMeta,control?:ModelControl,error?:string):string {
  if(error)return `模型状态读取失败：${error}`;
  if(!meta||!control)return '正在核验模型配置…';
  if(!['llm','candidate_service'].includes(meta.generator))return '当前服务使用演示规则，请启用大模型服务后生成。';
  if(!meta.llm?.configured)return '大模型尚未配置，请配置模型名称和服务凭据后重启后端。';
  if(control.paused)return '大模型调用已暂停，可在上方恢复模型调用后生成。';
  return '';
}

export function modelPollDelay(milliseconds:number,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},milliseconds);
    signal.addEventListener('abort',onAbort,{once:true});
  });
}

/** Submit once, then only read the matching run. Old or replaced results cannot become this request's result. */
export async function generateTreeModel(treeId:string,kind:TreeKind,dataMode:'demo'|'mixed_demo',signal:AbortSignal,deps:Dependencies,generatorMode:'configured'|'demo_rules'='configured'):Promise<View> {
  signal.throwIfAborted();
  const preparation=await deps.prepare({preparationId:deps.preparationId??crypto.randomUUID(),treeIds:[treeId],kind,dataMode,generatorMode,...(deps.siteId?{siteId:deps.siteId}:{})});
  signal.throwIfAborted();
  const runId=preparation.items.find(item=>item.treeId===treeId)?.runId;
  if(!runId)throw Error('后端未返回本树的分析编号，请核验服务版本后重试。');
  const now=deps.now??Date.now,deadline=now()+(deps.timeoutMs??270000),sleep=deps.sleep??modelPollDelay;
  let matched=false;
  while(now()<deadline){
    signal.throwIfAborted();
    const view=await deps.readView();
    signal.throwIfAborted();
    if(view.run?.runId===runId){
      matched=true;
      deps.onProgress?.(view);
      if(['succeeded','needs_data','failed'].includes(view.run.status)){
        if(view.run.status==='succeeded'&&(!view.strategy||view.strategy.runId!==runId||view.strategyStatus!=='available'))throw Error('本轮结果已失效或尚未匹配，请重新读取。');
        if(view.run.status==='succeeded'&&generatorMode==='configured'&&!view.strategy?.fallback&&(!view.strategy?.generationMetadata||!view.strategy.modelVersion))throw Error('本轮未返回可核验的大模型来源，不能作为大模型策略展示。');
        return view;
      }
    }else if(matched){
      throw Error('当前树的建议已被另一轮分析更新，请刷新查看。');
    }
    await sleep(1200,signal);
  }
  throw Error('本轮分析仍未完成；后端可能继续运行，请刷新查看结果，避免立即重复提交。');
}
