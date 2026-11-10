import {sameDispatchJob} from './fleetJobIdentity.ts';
import {executionWindowBlock,mergeExecutionWindow,type ExecutionWindow} from './workspace/taskExecutionWindow.ts';

export type Point={x:number;y:number;z:number};
export type ZoneRoute={zone:number;points:Point[];distances:number[];stations:Record<number,number>};
export function buildZoneRoutes(trees:{x:number;z:number}[],height:(x:number,z:number)=>number):ZoneRoute[]{
 if(trees.length!==200)throw Error('Expected 200 trees');
 return Array.from({length:4},(_,zone)=>{
  const points:Point[]=[],distances:number[]=[],stations:Record<number,number>={};
  const add=(x:number,z:number)=>{const p={x,y:height(x,z)+.15,z},last=points.at(-1);
   distances.push((distances.at(-1)??0)+(last?Math.hypot(p.x-last.x,p.y-last.y,p.z-last.z):0));points.push(p);};
  for(let row=0;row<5;row++){
   const indices=Array.from({length:10},(_,c)=>zone*50+row*10+(row%2?9-c:c));
   const first=trees[indices[0]];
   if(!row)add(first.x+.22-3,first.z+1.25);
   if(row){const last=points.at(-1)!,side=row%2?1:-1,edge=first.x+side*3;
    // Row connectors run around the row end, not through its trunks.
    add(edge,last.z);add(edge,first.z+1.25);
   }
   for(const index of indices){const t=trees[index];add(t.x+.22,t.z+1.25);stations[index]=distances.at(-1)!;}
  }
  const last=points.at(-1)!;add(last.x+3,last.z);
  // Keep every work station fixed; round only the two outer connector corners.
  const stationPoints=new Map(Object.entries(stations).map(([id,d])=>[points[distances.indexOf(d)],Number(id)]));
  const raw=[...points];points.length=0;distances.length=0;
  for(let i=0;i<raw.length;i++){
   const p=raw[i],id=stationPoints.get(p);
   if(i>0&&i<raw.length-1&&id===undefined){
    const a=raw[i-1],b=raw[i+1],da=Math.hypot(a.x-p.x,a.z-p.z),db=Math.hypot(b.x-p.x,b.z-p.z),radius=Math.min(1.2,da*.4,db*.4);
    const u={x:p.x+(a.x-p.x)*radius/da,z:p.z+(a.z-p.z)*radius/da},v={x:p.x+(b.x-p.x)*radius/db,z:p.z+(b.z-p.z)*radius/db};
    for(let j=0;j<=8;j++){const t=j/8,k=1-t;add(k*k*u.x+2*k*t*p.x+t*t*v.x,k*k*u.z+2*k*t*p.z+t*t*v.z);}
   }else{add(p.x,p.z);if(id!==undefined)stations[id]=distances.at(-1)!;}
  }
  return {zone,points,distances,stations};
 });
}
export function routePoint(route:ZoneRoute,distance:number):Point{
 const d=Math.max(0,Math.min(route.distances.at(-1)!,distance));
 let i=1;while(i<route.points.length-1&&route.distances[i]<d)i++;
 const a=route.points[i-1],b=route.points[i],u=(d-route.distances[i-1])/(route.distances[i]-route.distances[i-1]||1);
 return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u};
}
export type FleetJob={observation?:{reviewId:string;captureId:string;treeId:string;siteId:string};harnessSource?:{treeId:string;strategyId:string;runId:string;revision:number;angle:number;expiresAt:string;adoptedAt:string;mode:'simulation';dataMode?:'demo'|'mixed_demo';siteId?:string};id:string;attemptId?:string;planVersion:string;angle:number;requestedAt:string;taskWindow?:ExecutionWindow;notBefore?:number;notAfter?:number;weatherBlock?:string;blockedReason?:string;strategyBlock?:string;validation?:'required'|'pending'|'valid'|'invalid'};
export type FleetValidationTiming=Pick<FleetJob,'notBefore'|'notAfter'|'weatherBlock'>;
export type FleetValidator=(index:number,job:FleetJob)=>Promise<void|FleetValidationTiming>;
export function fleetBlockReason(job:FleetJob,now=Date.now()){
 return job.blockedReason||job.strategyBlock||executionWindowBlock(job.taskWindow,now)||job.weatherBlock||(job.harnessSource&&!(Date.parse(job.harnessSource.expiresAt)>now)?'已采用策略过期，请取消待执行任务并重新确认策略':'')||((job.notAfter??Infinity)<=now?'天气窗口已失效，请重新确认':'');
}
export type ZoneState={zone:number;distance:number;active:number|null;queue:number[];phase:'idle'|'moving'|'working'|'retracting';elapsed:number;completed:number;paused:boolean;eventHoldReason?:string;eventHoldWeatherOnly?:boolean;observationWeatherOverride?:boolean;retractFrom:number};
/** A simulated camera task may ignore the live-weather hold, never an event hold. */
export function fleetZoneHoldReason(state:ZoneState,job?:FleetJob):string|undefined {
 return state.eventHoldReason&&!(state.eventHoldWeatherOnly&&state.observationWeatherOverride&&job?.observation)?state.eventHoldReason:undefined;
}
export type FleetResult={index:number;job?:FleetJob;outcome:'completed'|'cancelled';finishedAt:string};
export function workPose(phase:ZoneState['phase'],elapsed:number,retractFrom=0){
 const at=(t:number)=>({arm:t<1?t*.36:t<6?.36:Math.max(0,(8-t)/2*.36),slider:t>1&&t<7?.22*Math.min(1,t-1,7-t):0});
 if(phase==='working')return at(elapsed);
 if(phase==='retracting'){const p=at(retractFrom),k=1-Math.min(1,elapsed);return {arm:p.arm*k,slider:p.slider*k};}
 return {arm:0,slider:0};
}
export function createZoneScheduler(routes:ZoneRoute[],onComplete:(index:number,job?:FleetJob)=>void=()=>{},onCancel:(index:number,job?:FleetJob)=>void=()=>{},now:()=>number=Date.now,validate?:FleetValidator){
 const zones:ZoneState[]=routes.map(r=>({zone:r.zone,distance:r.stations[r.zone*50],active:null,queue:[],phase:'idle',elapsed:0,completed:0,paused:false,retractFrom:0}));
 const jobs:Record<number,FleetJob>={};
 const attempts=new WeakMap<FleetJob,symbol>();
 const cutting=new WeakSet<FleetJob>();
 const invalidate=(job:FleetJob)=>{attempts.delete(job);cutting.delete(job);job.validation='required';job.strategyBlock='';};
 const blocked=(index:number)=>!!fleetBlockReason(jobs[index],now())||(jobs[index]?.notBefore??0)>now();
 const requestValidation=(index:number,atCut:boolean)=>{
  const job=jobs[index],validator=validate;if(!validator)return false;
  const attempt=Symbol(),input={...job,harnessSource:job.harnessSource?{...job.harnessSource}:undefined};
  attempts.set(job,attempt);
  job.validation='pending';job.strategyBlock=job.observation?'正在核对补拍目标与任务':'正在核验策略和天气约束';
  const current=()=>jobs[index]===job&&attempts.get(job)===attempt;
  Promise.resolve().then(()=>validator(index,input)).then(timing=>{
   if(!current())return;
   // Only the successful attempt can replace cached weather constraints.
   if(timing)Object.assign(job,mergeExecutionWindow({notBefore:timing.notBefore,notAfter:timing.notAfter,weatherBlock:timing.weatherBlock||''},job.taskWindow));
   attempts.delete(job);job.validation=atCut?'valid':'required';job.strategyBlock='';
  },error=>{if(current()){attempts.delete(job);job.validation='invalid';job.strategyBlock=(error as Error)?.message||(job.observation?'无法核对补拍任务，请重试':'无法核验策略，请重试');}});
  return true;
 };
 const validateCut=(index:number)=>{
  const job=jobs[index];if(!validate||job.validation==='valid')return true;
  if(job.validation==='pending'||job.validation==='invalid')return false;
  requestValidation(index,true);
  return false;
 };
 const start=(s:ZoneState)=>{if(s.active===null&&!s.paused){const q=s.queue.findIndex(i=>!fleetZoneHoldReason(s,jobs[i])&&!blocked(i));if(q>=0){s.active=s.queue.splice(q,1)[0];s.phase='moving';s.elapsed=0;}}};
 const finish=(s:ZoneState,cancelled:boolean)=>{const index=s.active!;const job=jobs[index];s.active=null;s.phase='idle';s.elapsed=0;delete jobs[index];
  if(cancelled)onCancel(index,job);else{if(!job?.observation)s.completed++;onComplete(index,job);}start(s);};
 return {zones,jobs,setValidator(next?:FleetValidator){validate=next;for(const job of Object.values(jobs))invalidate(job);},restore(checkpoint:{zones:ZoneState[];jobs:Record<number,FleetJob>}){
  if(!checkpoint||checkpoint.zones?.length!==4||!checkpoint.jobs)return false;
  const indices:number[]=[];
  for(const state of checkpoint.zones){const route=routes[state.zone];if(!route||!['idle','moving','working','retracting'].includes(state.phase)||!Number.isFinite(state.distance)||state.distance<0||state.distance>route.distances.at(-1)!||!Number.isFinite(state.elapsed)||state.elapsed<0||state.elapsed>8||!Array.isArray(state.queue))return false;
   for(const index of [...state.queue,...(state.active===null?[]:[state.active])]){if(!Number.isInteger(index)||Math.floor(index/50)!==state.zone||!checkpoint.jobs[index]||indices.includes(index))return false;indices.push(index);}
  }
  if(new Set(checkpoint.zones.map(z=>z.zone)).size!==4||Object.keys(checkpoint.jobs).length!==indices.length)return false;
  for(const state of checkpoint.zones)Object.assign(zones[state.zone],state,{queue:[...state.queue]});for(const [key,job] of Object.entries(checkpoint.jobs))jobs[+key]={...job,validation:'required',strategyBlock:''};return true;
 },enqueue(index:number,job?:FleetJob){
  if(!Number.isInteger(index)||index<0||index>=200)return false;
  const s=zones[Math.floor(index/50)];if(!s||s.active===index||s.queue.includes(index))return false;
  jobs[index]={...(job??{id:'tree-'+index,planVersion:'baseline-v1',angle:30,requestedAt:new Date(now()).toISOString()}),validation:'required'};
  s.queue.push(index);start(s);return true;
 },setEventHold(zone:number,reason:string,weatherOnly=false){
  const s=zones[zone];if(!s||(s.eventHoldReason??'')===reason&&Boolean(s.eventHoldWeatherOnly)===Boolean(reason&&weatherOnly))return false;
  // Event recovery and manual pause are independent. Clearing an event does not
  // release a manual pause, and every resumed cut must check its evidence again.
  s.eventHoldReason=reason||undefined;s.eventHoldWeatherOnly=Boolean(reason&&weatherOnly);
  for(const index of [...s.queue,...(s.active===null?[]:[s.active])])invalidate(jobs[index]);
  start(s);return true;
 },setObservationWeatherOverride(enabled:boolean){
  let changed=false;for(const s of zones){if(Boolean(s.observationWeatherOverride)===enabled)continue;s.observationWeatherOverride=enabled;changed=true;start(s);}return changed;
 },resetZonePosition(zone:number){
  const s=zones[zone],route=routes[zone];
  if(!s||!route||s.active!==null||s.queue.length||s.paused)return false;
  s.distance=route.stations[zone*50];return true;
 },pause(zone:number,paused:boolean){const s=zones[zone];if(!s||s.phase==='retracting')return false;
  const resumable=s.active!==null?!fleetZoneHoldReason(s,jobs[s.active]):s.queue.some(index=>!fleetZoneHoldReason(s,jobs[index]));
  if(!paused&&s.eventHoldReason&&!resumable)return false;
  if(s.paused!==paused){s.paused=paused;for(const index of [...s.queue,...(s.active===null?[]:[s.active])])invalidate(jobs[index]);}if(!paused)start(s);return true;
 },cancel(index:number){
  const s=zones[Math.floor(index/50)];if(!s)return false;
  if(s.active===index){
   if(s.phase==='retracting')return false;
   invalidate(jobs[index]);s.retractFrom=s.phase==='working'?s.elapsed:0;s.elapsed=0;s.phase='retracting';return true;
  }
  const q=s.queue.indexOf(index);if(q<0)return false;
  s.queue.splice(q,1);const job=jobs[index];delete jobs[index];onCancel(index,job);return true;
 },retire(index:number){
  // Another client has already finished/cancelled this task. Do not emit a second receipt.
  const s=zones[Math.floor(index/50)];if(!s||!jobs[index])return false;
  if(s.active===index){s.active=null;s.phase='idle';s.elapsed=0;}
  s.queue=s.queue.filter(i=>i!==index);delete jobs[index];start(s);return true;
 },retryValidation(index:number){
  const job=jobs[index],s=zones[Math.floor(index/50)];
  if(!job||!s||fleetZoneHoldReason(s,job)||job.validation==='pending'||(s.active===index&&(s.phase==='retracting'||(s.phase==='working'&&job.validation==='valid'))))return false;
  // A manual retry checks fresh evidence even when old weather data blocks movement.
  // It never resumes a paused zone and must be checked again at the cut boundary.
  return requestValidation(index,false);
 },patchJob(index:number,patch:Partial<FleetJob>){
  const s=zones[Math.floor(index/50)],job=jobs[index];if(!s||!job)return false;
  // Historical checkpoints did not store the task schedule. Attach it once,
  // including during a cut, without allowing a later weather patch to widen it.
  const addedWindow=!!patch.taskWindow&&!job.taskWindow;
  if(addedWindow)job.taskWindow={...patch.taskWindow};
  const {taskWindow:_taskWindow,...updates}=patch;
  // Never silently change an executing cut's parameters or plan version.
  if(s.active===index){if(s.phase==='working'||s.phase==='retracting'){if(addedWindow)invalidate(job);return addedWindow;}let changed=addedWindow;for(const key of ['notBefore','notAfter','weatherBlock','blockedReason'] as const)if(key in updates&&job[key]!==updates[key]){Object.assign(job,{[key]:updates[key]});changed=true;}if(changed)invalidate(job);return changed;}
  const changed=addedWindow||Object.entries(updates).some(([key,value])=>job[key as keyof FleetJob]!==value);
  if(changed){Object.assign(job,updates);invalidate(job);}start(s);return changed;
 },reset(){for(const s of zones){s.queue=[];s.active=null;s.phase='idle';s.elapsed=0;s.paused=false;s.completed=0;s.distance=routes[s.zone].stations[s.zone*50];}for(const key of Object.keys(jobs))delete jobs[Number(key)];
 },update(dt:number){
  if(!Number.isFinite(dt)||dt<=0)return;
  for(const s of zones){
   start(s);if(s.active===null||((s.paused||fleetZoneHoldReason(s,jobs[s.active]))&&s.phase!=='retracting')||(s.phase==='moving'&&blocked(s.active)))continue;
   if(s.phase==='moving'){const target=routes[s.zone].stations[s.active],delta=target-s.distance;
    s.distance+=Math.sign(delta)*Math.min(Math.abs(delta),dt*9);
    if(Math.abs(target-s.distance)<1e-7){s.distance=target;if(!validateCut(s.active))continue;jobs[s.active].validation='valid';cutting.add(jobs[s.active]);s.phase='working';s.elapsed=0;}
   }else if(s.phase==='working'){
    // Keep an uninterrupted cut's parameters frozen; resume/restore requires a fresh check.
    const job=jobs[s.active];
    const scheduleBlock=executionWindowBlock(job.taskWindow,now());
    if(scheduleBlock){job.validation='invalid';job.strategyBlock=scheduleBlock;continue;}
    if(job.validation!=='valid'||!cutting.has(job)){
     if(blocked(s.active)){if(job.validation==='valid'){job.validation='invalid';job.strategyBlock=fleetBlockReason(job,now())||'尚未到已采用的天气窗口，请等待后重新核验';}continue;}
     if(!validateCut(s.active))continue;job.validation='valid';cutting.add(job);
    }
    const duration=job.observation?2:8;s.elapsed=Math.min(duration,s.elapsed+dt);
    if(s.elapsed===duration)finish(s,false);
   }else if(s.phase==='retracting'){
    s.elapsed=Math.min(1,s.elapsed+dt);if(s.elapsed===1)finish(s,true);
   }
  }
 }};
}
export type FleetSnapshot={ready:boolean;error:string|null;zones:ZoneState[];jobs:Record<number,FleetJob>};
export type FleetDispatchEntry={index:number;job:FleetJob};
/** Synchronous admission: no frame can cut and no listener sees half a batch.
 * The task owner must accept the same snapshot before the fleet publishes it. */
export function commitFleetDispatch(scheduler:Pick<ReturnType<typeof createZoneScheduler>,'jobs'|'zones'|'enqueue'|'retire'>,entries:FleetDispatchEntry[],commit:(fleet:FleetSnapshot)=>boolean):boolean{
 if(!entries.length||new Set(entries.map(entry=>entry.index)).size!==entries.length
  ||entries.some(({index})=>!Number.isInteger(index)||index<0||index>=200||scheduler.jobs[index]))return false;
 const accepted:FleetDispatchEntry[]=[];
 let committed=false;
 try{
  for(const entry of entries){if(!scheduler.enqueue(entry.index,entry.job))return false;accepted.push(entry);}
  if(entries.some(({index,job})=>scheduler.jobs[index]?.id!==job.id))return false;
  committed=commit({ready:true,error:null,zones:scheduler.zones.map(zone=>({...zone,queue:[...zone.queue]})),jobs:structuredClone(scheduler.jobs)});
  return committed;
 }finally{
  if(!committed)for(const {index,job} of accepted)if(scheduler.jobs[index]?.id===job.id)scheduler.retire(index);
 }
}
let snapshot:FleetSnapshot={ready:false,error:null,zones:[],jobs:{}};
const listeners=new Set<()=>void>();
let attached:ReturnType<typeof createZoneScheduler>|null=null;
let fleetValidator:FleetValidator|undefined;
let fleetEventHolds:string[]|undefined;
let fleetWeatherOnly:boolean[]|undefined;
let fleetObservationWeatherOverride=false;
export const setFleetValidator=(validate?:FleetValidator)=>{fleetValidator=validate;attached?.setValidator(validate);publish();};
export function setFleetEventHolds(reasons:string[],weatherOnly:boolean[]=[]){
 fleetEventHolds=[...reasons];fleetWeatherOnly=[...weatherOnly];
 if(!attached)return;
 let changed=false;
 for(const zone of attached.zones)if(attached.setEventHold(zone.zone,reasons[zone.zone]??'',weatherOnly[zone.zone]===true))changed=true;
 if(changed){saveFleetCheckpoint(true);publish();}
}
export function setFleetObservationWeatherOverride(enabled:boolean){
 fleetObservationWeatherOverride=enabled;
 if(attached?.setObservationWeatherOverride(enabled)){saveFleetCheckpoint(true);publish();}
}
export const getFleetSnapshot=()=>snapshot;
export const subscribeFleet=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
const publish=()=>{if(attached)publishFleet(attached.zones,true,null,attached.jobs);};
export const dispatchTree=(index:number,job?:FleetJob)=>{const ok=attached?.enqueue(index,job)??false;if(ok)publish();return ok;};
export const dispatchFleetJobs=(entries:FleetDispatchEntry[],commit:(fleet:FleetSnapshot)=>boolean)=>{
 if(!attached)return false;
 try{return commitFleetDispatch(attached,entries,commit);}finally{publish();}
};
export type FleetControlGuard={index:number;job:FleetJob;paused:boolean};
function currentControlTarget(index:number,expected:FleetJob){
 if(!attached||!snapshot.ready||!Number.isInteger(index)||index<0||index>=200)return false;
 const zone=attached.zones.find(state=>state.zone===Math.floor(index/50));
 return !!zone&&(zone.active===index||zone.queue.includes(index))&&sameDispatchJob(attached.jobs[index],expected);
}
// UI commands carry the dispatch shown when the button was rendered. Check the
// scheduler itself at mutation time, even if its last published snapshot is old.
export const pauseZone=(zone:number,paused:boolean,guard?:FleetControlGuard)=>{
 if(guard&&(Math.floor(guard.index/50)!==zone||!currentControlTarget(guard.index,guard.job)
  ||attached?.zones.find(state=>state.zone===zone)?.paused!==guard.paused))return false;
 const ok=attached?.pause(zone,paused)??false;if(ok)publish();return ok;
};
export const cancelTree=(index:number,expected?:FleetJob)=>{if(expected&&!currentControlTarget(index,expected))return false;const ok=attached?.cancel(index)??false;if(ok)publish();return ok;};
export const retireFleetJob=(index:number)=>{const ok=attached?.retire(index)??false;if(ok)publish();return ok;};
export const retryFleetValidation=(index:number,expected?:FleetJob)=>{if(expected&&!currentControlTarget(index,expected))return false;const ok=attached?.retryValidation(index)??false;if(ok)publish();return ok;};
export const patchFleetJob=(index:number,patch:Partial<FleetJob>)=>{const ok=attached?.patchJob(index,patch)??false;if(ok)publish();return ok;};
export const resetFleet=()=>{attached?.reset();saveFleetCheckpoint(true);publish();};
/** Restore only one idle simulated robot's position, leaving tasks and receipts untouched. */
export const resetZonePosition=(zone:number)=>{const ok=attached?.resetZonePosition(zone)??false;if(ok){saveFleetCheckpoint(true);publish();}return ok;};
export function attachFleet(scheduler:ReturnType<typeof createZoneScheduler>){
 attached=scheduler;scheduler.setValidator(fleetValidator);try{const raw=localStorage.getItem('rubber-fleet-checkpoint-v1');if(raw)scheduler.restore(JSON.parse(raw));}catch{}
 if(fleetEventHolds)for(const zone of scheduler.zones)scheduler.setEventHold(zone.zone,fleetEventHolds[zone.zone]??'',fleetWeatherOnly?.[zone.zone]===true);
 scheduler.setObservationWeatherOverride(fleetObservationWeatherOverride);
 publish();
}
export function publishFleet(zones:ZoneState[],ready=true,error:string|null=null,jobs:Record<number,FleetJob>={}){
 saveFleetCheckpoint();
 // UI consumes task state, not frame-by-frame transforms. Keep its snapshot
 // stable while travelling; exact positions remain in the scene scheduler.
 const unchanged=snapshot.ready===ready&&snapshot.error===error&&snapshot.zones.length===zones.length
  &&JSON.stringify(snapshot.jobs)===JSON.stringify(jobs)
  &&zones.every((s,i)=>{const old=snapshot.zones[i];return old.zone===s.zone&&old.active===s.active&&old.phase===s.phase&&old.paused===s.paused&&old.eventHoldReason===s.eventHoldReason&&old.eventHoldWeatherOnly===s.eventHoldWeatherOnly&&old.observationWeatherOverride===s.observationWeatherOverride
   &&old.completed===s.completed&&old.queue.length===s.queue.length&&old.queue.every((id,j)=>id===s.queue[j]);});
 if(unchanged)return;
 snapshot={ready,error,zones:zones.map(s=>({...s,queue:[...s.queue]})),jobs:Object.fromEntries(Object.entries(jobs).map(([i,job])=>[i,{...job}]))};listeners.forEach(fn=>fn());
}
export function detachFleet(error:string|null=null){saveFleetCheckpoint(true);attached=null;publishFleet([],false,error);}


let lastCheckpoint=0;
export function saveFleetCheckpoint(force=false){if(!attached||(!force&&Date.now()-lastCheckpoint<1000))return;lastCheckpoint=Date.now();try{localStorage.setItem('rubber-fleet-checkpoint-v1',JSON.stringify({version:1,savedAt:new Date().toISOString(),zones:attached.zones,jobs:attached.jobs}));}catch{}}
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>saveFleetCheckpoint(true));
