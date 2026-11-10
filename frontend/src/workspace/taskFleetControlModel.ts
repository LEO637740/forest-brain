import type {FleetJob,FleetSnapshot} from '../zoneFleet';
import type {Task} from './model';
import {isClosed} from './operationsModel.ts';
import {sameDispatchJob,taskEvidence} from './taskLifecycleModel.ts';

export type TaskFleetControls={
 live:Array<{index:number;job:FleetJob}>;
 canRetry:boolean;
 message:string|null;
};
const empty=(message:string|null=null):TaskFleetControls=>({live:[],canRetry:false,message});
const review=()=>empty('任务的派发或回执记录需核对，暂不能操作机器人或重新安排。');
const validIndex=(index:number)=>Number.isInteger(index)&&index>=0&&index<200;

/** Task details may control only their recorded execution, at its recorded tree. */
export function taskFleetControls(task:Task,fleet:FleetSnapshot):TaskFleetControls{
 if(task.site!=='hainan'||task.kind!=='割胶'||task.dispatch||isClosed(task))return empty();
 if(!task.railJob&&!task.railBatch&&!task.railResult&&!task.id.startsWith('rail-'))return empty();
 if(!Number.isInteger(task.count)||task.count<1||!Number.isInteger(task.done)||task.done<0||task.done>task.count
  ||!task.treeIndices||task.treeIndices.length!==task.count||new Set(task.treeIndices).size!==task.count
  ||!task.treeIndices.every(validIndex))return review();

 let entries:Array<{index:number;job:FleetJob}>;
 const evidence=taskEvidence(task);
 if(task.railBatch){
  const batch=task.railBatch,keys=Object.keys(batch.jobs);
  if(task.railJob||task.railResult||!Number.isInteger(batch.baseDone)||batch.baseDone<0
   ||batch.baseDone+keys.length!==task.count
   ||keys.some(key=>String(Number(key))!==key||!task.treeIndices!.includes(Number(key)))
   ||evidence.validDispatchIndices.length!==keys.length
   ||evidence.receipts.length!==evidence.rawReceipts.length
   ||batch.baseDone+evidence.completedReceipts!==task.done)return review();
  const received=new Set(evidence.receipts.map(result=>result.index));
  entries=keys.map(Number).filter(index=>!received.has(index)).map(index=>({index,job:batch.jobs[index]}));
 }else{
  if(task.count!==1||task.done!==0||task.railResult||!task.railJob||task.railJob.id!==task.id
   ||evidence.validDispatchIndices.length!==1)return review();
  entries=[{index:task.treeIndices[0],job:task.railJob}];
 }
 if(!entries.length)return review();
 if(!fleet.ready)return empty('机器人尚未就绪，请等待连接恢复。');

 const isMember=(index:number)=>{
  const zone=fleet.zones.find(state=>state.zone===Math.floor(index/50));
  return !!zone&&(zone.active===index||zone.queue.includes(index));
 };
 const occupied=(index:number)=>!!fleet.jobs[index]
  ||fleet.zones.some(zone=>zone.active===index||zone.queue.includes(index));
 const live=entries.filter(({index,job})=>sameDispatchJob(job,fleet.jobs[index])&&isMember(index))
  .sort((a,b)=>Number(fleet.zones.some(zone=>zone.active===b.index))-Number(fleet.zones.some(zone=>zone.active===a.index))||a.index-b.index);
 const foreign=entries.some(({index,job})=>occupied(index)&&!sameDispatchJob(job,fleet.jobs[index]));
 const inconsistent=entries.some(({index,job})=>sameDispatchJob(job,fleet.jobs[index])&&!isMember(index));
 return {
  live,
  canRetry:task.status==='待处理'&&live.length===0&&entries.every(({index})=>!occupied(index)),
  message:foreign?'待执行树位已有其它执行，请先核对当前队列。'
   :inconsistent?'待执行树位的队列记录不一致，请先核对当前执行。':null,
 };
}
