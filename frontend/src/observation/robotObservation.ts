import {useEffect,useRef} from 'react';
import {post as api} from '../integration/client';
import {dispatchTree,getFleetSnapshot,type FleetResult} from '../zoneFleet';

export type CameraFrame={image:string;width:640;height:480;position:number[]};
let camera:((index:number)=>CameraFrame)|undefined;
export function attachObservationCamera(fn:(index:number)=>CameraFrame){camera=fn;return()=>{if(camera===fn)camera=undefined;};}
export async function dispatchObservation(job:{id:string;treeId:string;siteId:string},requestId?:string){
 if(job.siteId!=='demo-hainan')throw Error('三维相机当前对应海南海口园区');
 const index=Number(job.treeId.slice(2))-1,fleet=getFleetSnapshot();
 if(!fleet.ready||!camera)throw Error('请先进入海南三维胶园，等待机器人加载完成');
 if(fleet.jobs[index])throw Error('这棵树已有排队任务，请先等待完成或停止当前任务');
 const saved=await api<{observation:{captureId:string;status:string}}>('/api/simulation/reviews/'+job.id+'/photo/start',{siteId:job.siteId,...(requestId?{requestId}:{})});
 if(saved.observation.status==='returned')return;
 const observation={reviewId:job.id,captureId:saved.observation.captureId,treeId:job.treeId,siteId:job.siteId};
 if(!dispatchTree(index,{id:observation.captureId,observation,planVersion:'camera-demo-v1',angle:0,requestedAt:new Date().toISOString()})){
  await api('/api/simulation/reviews/'+job.id+'/photo/fail',{siteId:job.siteId,captureId:observation.captureId,message:'设备队列发生变化，未派出'});throw Error('未能加入设备队列，请重试');
 }
 window.dispatchEvent(new CustomEvent('zone-fleet-focus',{detail:Math.floor(index/50)}));
 window.dispatchEvent(new CustomEvent('zone-fleet-follow',{detail:Math.floor(index/50)}));
 window.dispatchEvent(new Event('harness-reviews-changed'));
}
export function useRobotObservation(notify:(text:string)=>void){
 const notifyRef=useRef(notify);notifyRef.current=notify;
 useEffect(()=>{
  const timers=new Set<ReturnType<typeof setInterval>>();
  const queued=new Set<string>();
  const capture=(event:Event)=>{
   const job=(event as CustomEvent<{id:string;treeId:string;siteId:string;requestId:string}>).detail;
   if(!job.id||queued.has(job.requestId))return;
   queued.add(job.requestId);let attempts=0;
   const timer=setInterval(()=>{
    if(++attempts>60){clearInterval(timer);timers.delete(timer);queued.delete(job.requestId);notifyRef.current('现场尚未加载完成，请在补拍任务中重试');return;}
    if(!camera||!getFleetSnapshot().ready)return;
    clearInterval(timer);timers.delete(timer);
    const index=Number(job.treeId.slice(2))-1;
    if(getFleetSnapshot().jobs[index]?.observation?.reviewId===job.id){queued.delete(job.requestId);return;}
    void dispatchObservation(job,job.requestId).catch(e=>notifyRef.current('补拍未派出：'+(e as Error).message)).finally(()=>queued.delete(job.requestId));
   },500);timers.add(timer);
  };
  window.addEventListener('harness-assistant-capture',capture);
  const result=async(e:Event)=>{
   const r=(e as CustomEvent<FleetResult>).detail,o=r.job?.observation;if(!o)return;
   try{
    if(r.outcome==='cancelled'){
     await api('/api/simulation/reviews/'+o.reviewId+'/photo/fail',{siteId:o.siteId,captureId:o.captureId,message:'已停止补拍，未形成新证据'});notifyRef.current('补拍已停止');return;
    }
    // The scheduler publishes completion before applying the final frame transform.
    await Promise.resolve();
    if(!camera)throw Error('三维相机已关闭，请重新进入场景后补拍');
    const frame=camera(r.index);
    // Retry the exact same capture ID and image; server receipt is idempotent.
    let error:unknown;
    for(let attempt=0;attempt<3;attempt++){
     try{await api('/api/simulation/reviews/'+o.reviewId+'/photo/collect',{...frame,...o});error=undefined;break;}
     catch(e){error=e;await new Promise(resolve=>setTimeout(resolve,700));}
    }
    if(error)throw error;
    notifyRef.current('机器人已回传目标画面，请在补测与复核中核对证据');
   }catch(e){
    const message=(e as Error).message;
    try{await api('/api/simulation/reviews/'+o.reviewId+'/photo/fail',{siteId:o.siteId,captureId:o.captureId,message});}catch{/* Keep the unresolved backend request visible for explicit recovery. */}
    notifyRef.current('补拍未完成：'+message);
   }finally{window.dispatchEvent(new Event('harness-reviews-changed'));}
  };
  window.addEventListener('zone-fleet-result',result);return()=>{window.removeEventListener('zone-fleet-result',result);window.removeEventListener('harness-assistant-capture',capture);for(const timer of timers)clearInterval(timer);};
 },[]);
}
