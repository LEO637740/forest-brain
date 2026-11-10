import {adoption,weatherTiming} from '../integration/client';
import type {FleetJob} from '../zoneFleet';
import type {Task} from './model';
import {treeAlias} from './model';
export {finishRailTask,syncRailTask} from './railTaskState';
export function recoverTasks(tasks:Task[]):Task[]{
 return tasks.map(t=>{
  if((t.id.startsWith('rail-')||t.railBatch)&&['执行中','待开始','待处理'].includes(t.status))return {...t,status:'待处理'};
  // Historical seed plans are not robots currently running in this session.
  if(t.site==='hainan'&&t.kind==='割胶'&&!t.dispatch&&!t.id.startsWith('rail-')&&!t.railBatch&&!['已完成','已取消'].includes(t.status))
   return {...t,robot:'R-'+t.block,status:t.status==='执行中'?'待开始':t.status};
  return t;
 });
}

export function weatherStart(now=Date.now()){
 const d=new Date(now);d.setHours(8,0,0,0);return d.getTime();
}
export function jobForTree(index:number,id:string,tasks:Task[],decisions:Record<string,string>,now=Date.now()):FleetJob{
 const alias=treeAlias(index),angle=decisions['hainan:angle:'+alias],accepted=adoption(index,true);
 const surface=tasks.find(t=>t.site==='hainan'&&t.story==='surface'&&t.treeIndices?.includes(index)&&t.status!=='已取消');
 return {id,requestedAt:new Date(now).toISOString(),planVersion:accepted?'harness-'+accepted.revision:angle?.includes('28°')?'single-tree-28-v1':'baseline-30-v1',angle:accepted?.angle??(angle?.includes('28°')?28:30), ...(accepted?{harnessSource:accepted}:{}),
  ...(Math.floor(index/50)===2&&decisions['hainan:weather:all']==='C区调整为08:00–09:30'?{notBefore:weatherStart(now)}:{}),
  ...weatherTiming(index),...(surface&&surface.status!=='已完成'?{blockedReason:'等待树表处理回传'}:{})};
}
