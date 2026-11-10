import {resolveTreeIdentity} from '../../../shared/treeIdentity.ts';
import {parks, type Site} from '../../../shared/parkCatalog.ts';
import {eventHoldForZone,type OperationalEvent} from '../workspace/operationalEvents';
import {useEffect,useState} from 'react';
import type {ContextSnapshot,Strategy,RunResponse} from './contracts';
import mapping from './tree-map.json';
import type {FleetJob} from '../zoneFleet';
import {verifyFleetJobWith} from './fleetVerification';
import {weatherTimingFor,withLiveWeather,type LiveWeatherConstraint,type WeatherAdoption,type WeatherTiming} from './weatherConstraints';
export type {WeatherAdoption} from './weatherConstraints';
const FLEET_SITE_ID='demo-hainan';
export const DATA_MODE:'demo'|'mixed_demo'=import.meta.env.VITE_HARNESS_DATA_MODE==='demo'?'demo':'mixed_demo';
export type Tree=NonNullable<ContextSnapshot['modules']['trees']>[number]&{profile:string};
export type Park={asOf:string;trees:Tree[];modules:ContextSnapshot['modules']};
export type Session={preparedAt:string;jobs:{key:string;runId:string;title:string}[];trees:{treeId:string;label:string}[]};
export type EnvironmentSite=Site;
export const siteIdOf=(site:EnvironmentSite)=>`demo-${site}`;
export type StrategyRoute={version:'strategy-route-v1';treeId:string;kind:string;complexity:'simple'|'complex'|'blocked';executor:'small_brain'|'big_brain'|'blocked';status:'ready'|'needs_big_brain'|'blocked';triggers:string[];blockers:string[];recommendedGenerator:'configured'|'demo_rules'|null;reason:string;checkedAt:string;delegation?:{id:string;approvedAt?:string;audit:boolean}};
export type View={tree:Tree;siteId?:string;strategy:Strategy|null;strategyStatus:string;asOf:string|null;strategyRoute?:StrategyRoute;automaticSkipReason?:string|null;status?:string;run?:{runId:string;requestId:string;status:string;stage:string;updatedAt:string;generatorMode?:'configured'|'demo_rules'}|null;missingData?:{field:string;reason:string}[];error?:{code:string;message:string;retryable?:boolean;details?:string[]}};
export type Business={records:{topic:string;content:string}[];asOf:string};
export const BASE=import.meta.env.VITE_HARNESS_URL||'http://127.0.0.1:4188';
// The signed-in demo identity travels with every request; the server checks
// park, plot and write permissions against it.
import {IDENTITY_STORAGE_KEY,currentAccount} from '../workspace/identityModel';
export {IDENTITY_STORAGE_KEY};
export function sessionToken():string|null{try{return JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY)||'null')?.token??null;}catch{return null;}}
export function sessionHeaders(token=sessionToken()):Record<string,string>{return token?{'X-Rubber-Session':token}:{};}
function sessionLost(status:number,token:string|null){if(status===401&&token&&token===sessionToken())window.dispatchEvent(new Event('harness-login-required'));}
function requireCurrentSession(token:string|null){if(token!==sessionToken())throw Error('登录身份已变更，请重新读取。');}
async function write<T>(method:'POST'|'PUT',path:string,input:unknown,{timeoutMs=12000}:{timeoutMs?:number}={}):Promise<T>{const token=sessionToken();const r=await fetch(BASE+path,{method,headers:{'Content-Type':'application/json',...sessionHeaders(token)},body:JSON.stringify(input),signal:AbortSignal.timeout(timeoutMs)});const data=await r.json();if(!r.ok){sessionLost(r.status,token);throw Error(data.error?.message||data.message||`保存失败 (${r.status})`);}requireCurrentSession(token);return data;}
export const post=<T,>(path:string,input:unknown,options?:{timeoutMs?:number})=>write<T>('POST',path,input,options);
export const put=<T,>(path:string,input:unknown,options?:{timeoutMs?:number})=>write<T>('PUT',path,input,options);
const pending=new Map<string,Promise<unknown>>();
export function read<T>(path:string):Promise<T>{
 const token=sessionToken(),key=JSON.stringify([token,path]);if(pending.has(key))return pending.get(key) as Promise<T>;
 const local=path.startsWith('/harness-session');
 const request=fetch(local?path:BASE+path,{signal:AbortSignal.timeout(12000),cache:'no-store',headers:local?{}:sessionHeaders(token)}).then(async r=>{if(!r.ok){sessionLost(r.status,token);const detail=await r.json().catch(()=>null);throw Error(r.status===403&&detail?.error?.message?detail.error.message:`读取失败 (${r.status})`);}const data=await r.json();requireCurrentSession(token);return data;}).finally(()=>pending.delete(key));pending.set(key,request);return request;
}
export type ReadOptions={pollMs?:number};
export function useRead<T>(path:string|null,options:ReadOptions={}){const [result,setResult]=useState<{key:string;data?:T;error?:string}>({key:''});const [revision,reload]=useState(0);
 const pollMs=options.pollMs??0,token=sessionToken(),key=JSON.stringify([token,path]);
 useEffect(()=>{let active=true;if(!path)return;
  // Keep the last successful value visible while a background refresh is in flight.
  // Clearing it here made every periodic read look like a full-page refresh.
  setResult(previous=>previous.key===key?{...previous,error:undefined}:{key});
  read<T>(path).then(data=>{if(active&&token===sessionToken())setResult({key,data});},e=>{if(active&&token===sessionToken())setResult(previous=>previous.key===key?{...previous,error:e.message||'服务暂不可用'}:{key,error:e.message||'服务暂不可用'});});
  return()=>{active=false;};
 },[path,token,revision]);
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===IDENTITY_STORAGE_KEY||event.key===null)reload(n=>n+1);};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 useEffect(()=>{if(!path||pollMs<=0)return;const id=setInterval(()=>reload(n=>n+1),pollMs);return()=>clearInterval(id);},[path,pollMs]);
 useEffect(()=>{if(path!=='/api/model/control'&&path!=='/api/automatic'&&!path?.startsWith('/api/strategy-refresh/status?'))return;const refresh=()=>reload(n=>n+1);window.addEventListener('harness-model-control-changed',refresh);return()=>window.removeEventListener('harness-model-control-changed',refresh);},[path]);
 useEffect(()=>{if(!path?.startsWith('/api/demo/park')&&!path?.startsWith('/api/demo/trees/'))return;const refresh=()=>reload(n=>n+1);window.addEventListener('harness-field-data-changed',refresh);return()=>window.removeEventListener('harness-field-data-changed',refresh);},[path]);
 return {...(result.key===key?result:{}),reload:()=>reload(n=>n+1)};
}
export const binding=(index:number)=>mapping.find(t=>t.sceneIndex===index);
export const indexOf=(id:string)=>mapping.find(t=>t.treeId===id)?.sceneIndex;
export const alias=(id:string,siteId='demo-hainan')=>resolveTreeIdentity(siteId,id)?.label??id;
export const valid=(s:Strategy)=>s.qualityReview?.status!=='withdrawn'&&Date.parse(s.expiresAt)>Date.now();
export const kinds={tapping_angle:'角度优化',surface_action:'树表识别',growth_plan:'生长与割线',pest_risk:'健康风险',weather_window:'天气与作业',market_scenario:'市场与生产',industry_brief:'行业分析'};
export const statuses:Record<string,string>={available:'建议可查看',needs_generation:'尚未生成',pending:'正在分析',expired:'建议已过期',withdrawn:'建议已撤回',needs_data:'策略包待补充数据',failed:'分析失败',succeeded:'已生成',queued:'等待分析',running:'正在分析'};
type SiteHealthResponse={result:RunResponse;context:ContextSnapshot};
export function useScenario(key:string,site:EnvironmentSite='hainan'){
 const session=useRead<Session>(site==='hainan'?'/harness-session.json':null);
 const siteHealth=useRead<SiteHealthResponse>(site!=='hainan'&&key==='park-health'?`/api/demo/health?siteId=${siteIdOf(site)}`:null);
 const job=session.data?.jobs.find(j=>j.key===key);
 const id=job?.runId;
 const result=useRead<RunResponse>(id?'/internal/harness/runs/'+id:null);
 const context=useRead<ContextSnapshot>(id?'/internal/harness/runs/'+id+'/context':null);
 const sessionError=session.data&&!id?'本轮尚无该分析结果，可切换其他记录':undefined;
 if(site!=='hainan'&&key==='park-health')return {session:{error:siteHealth.error,reload:siteHealth.reload},result:{data:siteHealth.data?.result,error:siteHealth.error,reload:siteHealth.reload},context:{data:siteHealth.data?.context,error:siteHealth.error,reload:siteHealth.reload}};
 return {session,result:{...result,error:result.error||sessionError},context:{...context,error:context.error||(!context.data&&sessionError?'本轮尚无该分析快照':undefined)}};
}
export type Adoption={treeId:string;strategyId:string;runId:string;revision:number;angle:number;expiresAt:string;adoptedAt:string;mode:'simulation';dataMode?:'demo'|'mixed_demo';siteId?:string};
const adoptionKey=(treeId:string,siteId='demo-hainan')=>`${siteId}:${treeId}`;
const requireFleetSite=(view:View)=>{if([view.siteId,view.tree.siteId,view.strategy?.siteId].some(value=>value!==undefined&&value!==FLEET_SITE_ID))throw Error('策略不属于当前园区，请重新确认');};
export async function verifyDispatch(indices:number[]){
 await refreshWeather();
 for(const index of indices){const timing=weatherTiming(index);if(timing.weatherBlock)throw Error(timing.weatherBlock);}
 for(const index of indices){
  const id=binding(index)?.treeId;if(!id)throw Error('未找到树位映射');
  const surface=await read<View>(`/api/demo/trees/${id}/view?kind=surface_action&dataMode=${DATA_MODE}&siteId=${FLEET_SITE_ID}`);
  requireFleetSite(surface);
  if(surface.tree.treeId!==id)throw Error(alias(id)+' 树表建议的树木对象不一致，请重新读取');
  if(surface.strategyStatus!=='available'||!surface.strategy||!valid(surface.strategy))throw Error(alias(id)+' 树表建议尚不可用，请稍后重试');
  if(surface.strategy.kind==='surface_action'&&surface.strategy.proposal.findings.some(finding=>finding.treeId===id)){
   const actions=await read<{items:{kind:string;treeId:string;strategyId:string;siteId?:string;disposition?:string;expiresAt:string}[]}>(`/api/simulation/actions?treeId=${id}&siteId=${FLEET_SITE_ID}`);
   const review=actions.items.find(a=>a.kind==='surface_review'&&a.treeId===id&&a.strategyId===surface.strategy!.strategyId&&(a.siteId??'demo-hainan')===FLEET_SITE_ID&&Date.parse(a.expiresAt)>Date.now());
   if(review?.disposition!=='allow')throw Error(alias(id)+(review?.disposition==='skip'?' 已复核跳过本次割胶':' 存在树表标记，请在一树一策中复核后再安排'));
  }
 }
 const views=await Promise.all(indices.map(async index=>{const id=binding(index)?.treeId;if(!id)throw Error('未找到树位映射');const v=await read<View>(`/api/demo/trees/${id}/view?kind=tapping_angle&dataMode=${DATA_MODE}&siteId=${FLEET_SITE_ID}`);requireFleetSite(v);const siteId=FLEET_SITE_ID;const actions=await read<{items:(Adoption&{kind:string})[]}>(`/api/simulation/actions?treeId=${id}&siteId=${siteId}`);const remote=actions.items.find(a=>a.kind==='adopt_angle'&&(a.siteId??'demo-hainan')===siteId);if(remote){const cache=JSON.parse(localStorage.getItem('harness-adoptions-v1')||'{}');localStorage.setItem('harness-adoptions-v1',JSON.stringify({...cache,[adoptionKey(id,siteId)]:remote}));}const accepted=remote||adoption(index,true,siteId);if(accepted&&(accepted.siteId??'demo-hainan')!==siteId)throw Error(alias(id)+' 的已选建议不属于当前园区，请重新确认');if(v.tree.tappingStatus==='resting')throw Error(alias(id)+' 当前休割养护');if(v.tree.circumferenceCm===null)throw Error(alias(id)+' 缺少树围，请先复测');if(accepted&&(Date.parse(accepted.expiresAt)<=Date.now()||v.strategyStatus!=='available'||!v.strategy||!valid(v.strategy)||v.strategy.strategyId!==accepted.strategyId))throw Error(alias(id)+' 的已选建议发生变化，请重新查看');return v;}));return views;
}
export function adoption(index:number,includeExpired=false,siteId='demo-hainan'):Adoption|undefined{try{const id=binding(index)?.treeId;if(!id)return undefined;const all=JSON.parse(localStorage.getItem('harness-adoptions-v1')||'{}');const a=all[adoptionKey(id,siteId)]??(siteId==='demo-hainan'?all[id]:undefined);return a&&(includeExpired||Date.parse(a.expiresAt)>Date.now())?a:undefined;}catch{return undefined;}}
export async function adopt(s:Extract<Strategy,{kind:'tapping_angle'}>){if(!valid(s))throw Error('建议已失效，请刷新');const siteId=s.siteId??'demo-hainan';const a=await post<Adoption>('/api/simulation/actions',{requestId:crypto.randomUUID(),kind:'adopt_angle',treeId:s.proposal.treeId,strategyId:s.strategyId,siteId,dataMode:DATA_MODE});const all=JSON.parse(localStorage.getItem('harness-adoptions-v1')||'{}');localStorage.setItem('harness-adoptions-v1',JSON.stringify({...all,[adoptionKey(a.treeId,siteId)]:a}));return a;}
export async function reviewSurface(s:Extract<Strategy,{kind:'surface_action'}>,disposition:'allow'|'skip',selectedTreeId?:string){
 if(!valid(s))throw Error('建议已失效，请刷新');
 const targets=[...new Set(s.proposal.findings.map(finding=>finding.treeId))];
 const treeId=selectedTreeId??(targets.length===1?targets[0]:undefined);
 if(!treeId)throw Error(targets.length?'请选择要复核的树':'没有需要复核的树');
 if(!targets.includes(treeId))throw Error('当前树没有需要复核的树表标记');
 return post('/api/simulation/actions',{requestId:crypto.randomUUID(),kind:'surface_review',strategyId:s.strategyId,treeId,siteId:s.siteId,disposition,dataMode:DATA_MODE});
}
let weatherFailure:string|undefined;
let currentOperationalEvents:OperationalEvent[]=[];
const liveWeatherBySite:Record<string,LiveWeatherConstraint|undefined>={};
const weatherErrorsBySite:Record<string,string|undefined>={};
export function siteWeatherBlock(site:EnvironmentSite):string|undefined{
 const id=siteIdOf(site);
 if(weatherErrorsBySite[id])return weatherErrorsBySite[id];
 if(!liveWeatherBySite[id])return '正在核验当前园区天气';
 return withLiveWeather({},liveWeatherBySite[id]).weatherBlock;
}
export function weatherTiming(index:number):WeatherTiming{
 try{
  const rows:WeatherAdoption[]=JSON.parse(localStorage.getItem('harness-weather-v1')||'[]');
  const timing=withLiveWeather(weatherTimingFor(binding(index)?.treeId||'',rows,{siteId:FLEET_SITE_ID,now:Date.now(),failure:weatherFailure}),liveWeatherBySite[FLEET_SITE_ID]);
  const eventHold=eventHoldForZone('hainan',Math.floor(index/50),currentOperationalEvents);
  return eventHold?{...timing,weatherBlock:eventHold}:timing;
 }catch{return {weatherBlock:'天气约束记录不可用，请重新核验'};}
}
export async function adoptWeather(s:Extract<Strategy,{kind:'weather_window'}>,start:string){const c=await read<ContextSnapshot>('/internal/harness/runs/'+s.runId+'/context');const result=await post('/api/simulation/actions',{requestId:crypto.randomUUID(),kind:'adopt_weather',treeId:c.targetSnapshot.treeIds[0],strategyId:s.strategyId,siteId:s.siteId,start});window.dispatchEvent(new Event('harness-weather-changed'));return result;}

export async function refreshWeather(site:EnvironmentSite='hainan'){
 const siteId=siteIdOf(site),account=currentAccount();if(account&&!account.siteIds.includes(siteId))return;
 try{
  const result=await read<{constraints:WeatherAdoption[];operationalEvents:OperationalEvent[];liveWeather?:LiveWeatherConstraint;checkedAt:string}>(`/api/simulation/constraints?siteId=${siteId}`);
  if(!Array.isArray(result.constraints))throw Error('服务未提供完整天气约束');
  liveWeatherBySite[siteId]=result.liveWeather??{enabled:false};weatherErrorsBySite[siteId]=undefined;
  if(siteId===FLEET_SITE_ID){currentOperationalEvents=result.operationalEvents;localStorage.setItem('harness-weather-v1',JSON.stringify(result.constraints));weatherFailure=undefined;}
 }catch(error){
  const reason='天气约束核验失败，待恢复连接后重新确认';weatherErrorsBySite[siteId]=reason;
  if(siteId===FLEET_SITE_ID)weatherFailure=reason;throw error;
 }
}

/** Invoked at the cut boundary, and again after pause or checkpoint recovery. */
export async function verifyFleetJob(index:number,job:FleetJob){
 return verifyFleetJobWith(index,job,{refreshWeather,weatherTiming,treeId:index=>binding(index)?.treeId,siteId:FLEET_SITE_ID,dataMode:DATA_MODE,read,post,now:Date.now});
}
