import type {View} from './client';
import type {FleetJob,FleetValidationTiming} from '../zoneFleet';

export type FleetVerificationDependencies={
 refreshWeather:()=>Promise<unknown>;
 weatherTiming:(index:number)=>{notBefore?:number;notAfter?:number;weatherBlock?:string};
 treeId:(index:number)=>string|undefined;
 siteId?:string;
 dataMode:'demo'|'mixed_demo';
 read:<T>(path:string)=>Promise<T>;
 post:<T>(path:string,input:unknown)=>Promise<T>;
 now:()=>number;
};

/** The same cut-boundary gates are used by the browser and offline acceptance runner. */
export async function verifyFleetJobWith(index:number,job:FleetJob,deps:FleetVerificationDependencies):Promise<FleetValidationTiming>{
 const siteId=deps.siteId??'demo-hainan';
 if(job.observation){
  const o=job.observation;
  if(o.siteId!==siteId||o.treeId!==deps.treeId(index))throw Error('补拍对象与当前园区或树位不一致');
  const verified=await deps.post<{treeId:string;siteId:string}>(`/api/simulation/reviews/${o.reviewId}/photo/verify`,{siteId,captureId:o.captureId});
  if(verified.siteId!==siteId||verified.treeId!==o.treeId)throw Error('补拍任务对象不一致');
  return {weatherBlock:''};
 }
 if(job.harnessSource?.siteId!==undefined&&job.harnessSource.siteId!==siteId)throw Error('已采用策略不属于当前园区，请重新确认');
 await deps.refreshWeather();
 const timing=deps.weatherTiming(index);
 if(timing.weatherBlock)throw Error(timing.weatherBlock);
 if(timing.notAfter!==undefined&&(!Number.isFinite(timing.notAfter)||timing.notAfter<=deps.now()))throw Error('天气窗口已失效，请重新确认');
 if((timing.notBefore??0)>deps.now())throw Error('尚未到已采用的天气窗口，请等待后重新核验');
 const id=deps.treeId(index);if(!id)throw Error('未找到树位映射');
 const dataMode=job.harnessSource?.dataMode||deps.dataMode;
 if(job.harnessSource){
  const source=job.harnessSource;
  if(!(Date.parse(source.expiresAt)>deps.now()))throw Error('已采用策略过期，请取消待执行任务并重新确认策略');
  const response=await deps.post<{items:{treeId:string;strategyId:string;siteId?:string;valid:boolean;reason?:string}[]}>('/api/simulation/strategy-validity',{strategies:[{...source,siteId,dataMode}]});
  const checked=response.items.find(item=>item.treeId===id&&item.strategyId===source.strategyId&&(item.siteId===undefined||item.siteId===siteId));
  if(!checked?.valid)throw Error(checked?.reason||'策略无法核验，请重新确认');
 }
 const view=await deps.read<View>(`/api/demo/trees/${id}/view?kind=surface_action&dataMode=${dataMode}&siteId=${encodeURIComponent(siteId)}`);
 if([view.siteId,view.tree.siteId,view.strategy?.siteId].some(value=>value!==undefined&&value!==siteId))throw Error('树表策略不属于当前园区，请重新确认');
 if(view.tree.treeId!==id)throw Error('树表策略的树木对象不一致，请重新确认');
 if(view.tree.tappingStatus==='resting'||view.tree.circumferenceCm===null)throw Error('当前树木休割或缺少树围，请重新确认');
 if(view.strategyStatus!=='available'||!view.strategy||view.strategy.qualityReview?.status==='withdrawn'||!(Date.parse(view.strategy.expiresAt)>deps.now()))throw Error('树表策略不可用，请重新确认');
 if(view.strategy.kind==='surface_action'&&view.strategy.proposal.findings.some(finding=>finding.treeId===id)){
  const actions=await deps.read<{items:{kind:string;treeId:string;strategyId:string;siteId?:string;disposition?:string;expiresAt:string}[]}>(`/api/simulation/actions?treeId=${id}&siteId=${encodeURIComponent(siteId)}`);
  const review=actions.items.find(item=>item.kind==='surface_review'&&item.treeId===id&&item.strategyId===view.strategy!.strategyId&&(item.siteId??'demo-hainan')===siteId&&Date.parse(item.expiresAt)>deps.now());
  if(review?.disposition!=='allow')throw Error('树表异常尚未复核放行，请重新确认');
 }
 // The HTTP checks can outlive the accepted window or source strategy.
 if((timing.notAfter??Infinity)<=deps.now())throw Error('天气窗口已失效，请重新确认');
 if(job.harnessSource&&!(Date.parse(job.harnessSource.expiresAt)>deps.now()))throw Error('已采用策略过期，请取消待执行任务并重新确认策略');
 if(!(Date.parse(view.strategy.expiresAt)>deps.now()))throw Error('树表策略不可用，请重新确认');
 return {notBefore:timing.notBefore,notAfter:timing.notAfter,weatherBlock:''};
}
