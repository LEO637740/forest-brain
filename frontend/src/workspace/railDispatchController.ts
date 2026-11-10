import type {FleetDispatchEntry,FleetJob,FleetSnapshot} from '../zoneFleet';
import {taskTreeIndices,treeAlias,type Task,type RailDispatchCheck} from './model.ts';
import {isCalendarDay,isClosed,shanghaiDay,timeToMinutes} from './operationsModel.ts';
import {syncRailTask} from './railTaskState.ts';
import {taskExecutionBlock,taskExecutionWindow,mergeExecutionWindow} from './taskExecutionWindow.ts';

type DispatchState={tasks:Task[];decisions:Record<string,string>};
type Dependencies={
 getState:()=>DispatchState;
 updateTasks:(update:(tasks:Task[])=>Task[])=>void;
 getFleet:()=>FleetSnapshot;
 verify:(indices:number[])=>Promise<unknown>;
 makeJob:(index:number,id:string,tasks:Task[],decisions:Record<string,string>)=>FleetJob;
 dispatch:(entries:FleetDispatchEntry[],commit:(fleet:FleetSnapshot)=>boolean)=>boolean;
 isEnabled:()=>boolean;
 notify:(message:string)=>void;
 now?:()=>number;
 newId?:()=>string;
};
type Intent={taskId?:string;fingerprint?:string;indices:number[]};
const validIndex=(index:number)=>Number.isInteger(index)&&index>=0&&index<200;
const eligible=(task:Task)=>task.site==='hainan'&&task.kind==='割胶'&&!task.dispatch&&!isClosed(task)&&!task.railResult
 &&Number.isInteger(task.done)&&Number.isInteger(task.count)&&task.done>=0&&task.done<task.count;

function batchIndices(task:Task):number[]{
 if(!eligible(task)||(task.railJob&&!task.railBatch)||!['A','B','C','D'].includes(task.block))return [];
 const all=taskTreeIndices(task);
 if(all.length!==task.count||new Set(all).size!==all.length||all.some(i=>!validIndex(i)||Math.floor(i/50)!=='ABCD'.indexOf(task.block)))return [];
 const ids=task.railBatch?Object.keys(task.railBatch.jobs).map(Number).filter(i=>!task.railBatch!.results[i]):all.slice(task.done);
 return ids.length&&ids.every(i=>all.includes(i))?ids:[];
}

/** Automatic work requires an explicit, valid business date and Hainan fleet scope. */
export function findDueRailTask(tasks:Task[],fleet:FleetSnapshot,now=Date.now()):Task|undefined{
 if(!fleet.ready)return;
 const today=shanghaiDay(now),time=new Date(now).toLocaleTimeString('en-GB',{timeZone:'Asia/Shanghai',hour12:false}).slice(0,5);
 return tasks.find(task=>task.autoPlanned&&task.status==='待开始'&&!task.railBatch&&!task.railJob&&batchIndices(task).length>0
  &&isCalendarDay(task.date)&&Number.isFinite(timeToMinutes(task.start))
  &&(task.date<today||(task.date===today&&task.start<=time))
  &&!taskExecutionBlock(task,now)
  &&!fleet.zones['ABCD'.indexOf(task.block)]?.eventHoldReason
  &&!Object.keys(fleet.jobs).some(i=>Math.floor(+i/50)==='ABCD'.indexOf(task.block)));
}

/** An HTTP validation grants only this pending intent, never a future task version. */
export class RailDispatchController{
 private deps:Dependencies;
 private pending=new Set<Intent>();
 private disposed=false;
 constructor(deps:Dependencies){this.deps=deps;}
 cancelPending(){this.pending.clear();}
 dispose(){this.disposed=true;this.cancelPending();}
 private ready(){return !this.disposed&&this.deps.isEnabled()&&this.deps.getFleet().ready;}
 private current(intent:Intent):boolean{
  if(!this.pending.has(intent)||!this.ready())return false;
  if(!intent.taskId)return true;
  const task=this.deps.getState().tasks.find(t=>t.id===intent.taskId);
  return !!task&&eligible(task)&&JSON.stringify(task)===intent.fingerprint;
 }
 private begin(indices:number[],task?:Task):Intent|undefined{
  if(!this.ready()){if(!this.disposed)this.deps.notify('请等待海南机器人就绪并完成任务同步后再安排');return;}
  if(task){const reason=taskExecutionBlock(task,this.now());if(reason){this.deps.notify(reason);return;}}
  if(!indices.length||indices.some(i=>!validIndex(i))||new Set(indices).size!==indices.length){this.deps.notify('作业树号或任务范围不完整，请先核对');return;}
  if([...this.pending].some(p=>(task&&p.taskId===task.id)||p.indices.some(i=>indices.includes(i)))){
   this.deps.notify('相关任务正在核验，请勿重复安排');return;
  }
  if(indices.some(i=>this.deps.getFleet().jobs[i])){this.deps.notify('部分树已有任务，请先处理当前队列');return;}
  const intent:Intent={indices:[...indices],...(task?{taskId:task.id,fingerprint:JSON.stringify(task)}:{})};
  this.pending.add(intent);return intent;
 }
 private async validate(intent:Intent,markBlocked=false):Promise<boolean>{
  try{await this.deps.verify([...intent.indices]);}
  catch(error){
   if(this.current(intent)){
    const message=error instanceof Error?error.message:'派发核验失败，请稍后重试';
    if(markBlocked)this.deps.updateTasks(tasks=>tasks.map(task=>task.id===intent.taskId?this.withCheck({...task,status:'待处理'},'blocked',message):task));
    this.deps.notify(message);
   }
   return false;
  }
  if(!this.current(intent))return false;
  const task=intent.taskId?this.deps.getState().tasks.find(item=>item.id===intent.taskId):undefined;
  const scheduleBlock=task&&taskExecutionBlock(task,this.now());
  if(scheduleBlock){this.deps.notify(scheduleBlock);return false;}
  if(intent.indices.some(i=>this.deps.getFleet().jobs[i])){this.deps.notify('部分树已有任务，请先处理当前队列');return false;}
  return true;
 }
 private id(){return (this.deps.newId??(()=>crypto.randomUUID()))();}
 private now(){return (this.deps.now??Date.now)();}
 private withCheck(task:Task,outcome:RailDispatchCheck['outcome'],message:string):Task{
  const check:RailDispatchCheck={time:new Date(this.now()).toISOString(),outcome,message};
  return {...task,railDispatchChecks:[...(task.railDispatchChecks??[]),check].slice(-20)};
 }
 private makeJob(index:number,id:string,state:DispatchState,task?:Task):FleetJob{
  // Task IDs survive retries. Each actual dispatch needs its own identity,
  // including retries issued in the same millisecond.
  const job={...this.deps.makeJob(index,id,state.tasks,state.decisions),attemptId:this.id()};
  if(!task)return job;
  const taskWindow=taskExecutionWindow(task);
  return {...mergeExecutionWindow(job,taskWindow),taskWindow};
 }
 private submit(intent:Intent,entries:FleetDispatchEntry[],build:(tasks:Task[],fleet:FleetSnapshot)=>Task[]):boolean{
  if(!this.current(intent))return false;
  const accepted=this.deps.dispatch(entries,fleet=>{
   if(!this.current(intent))return false;
   let applied=false;
   this.deps.updateTasks(tasks=>{
    if(!this.current(intent))return tasks;
    applied=true;return build(tasks,fleet);
   });
   return applied;
  });
  if(!accepted&&this.current(intent))this.deps.notify('队列发生变化，本次未安排，请核对后重试');
  return accepted;
 }
 async queueTrees(indices:number[]):Promise<void>{
  const intent=this.begin([...new Set(indices)]);if(!intent)return;
  try{
   if(!await this.validate(intent))return;
   const state=this.deps.getState(),now=this.now();
   const entries=intent.indices.map(index=>({index,job:this.makeJob(index,'rail-'+this.id(),state)}));
   const accepted=this.submit(intent,entries,(tasks,fleet)=>{
    const added:Task[]=entries.map(({index,job})=>syncRailTask({date:shanghaiDay(now),id:job.id,site:'hainan',title:treeAlias(index)+' 割胶',block:'ABCD'[Math.floor(index/50)],robot:'R-'+'ABCD'[Math.floor(index/50)],
     start:new Date(job.notBefore??now).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}),end:'—',count:1,done:0,status:'待开始',kind:'割胶',treeIndices:[index],railJob:job},fleet,now));
    return [...added,...tasks];
   });
   if(accepted)this.deps.notify(`已安排 ${entries.length} 棵，各区机器人自动执行`);
  }catch(error){if(this.current(intent))this.deps.notify(error instanceof Error?error.message:'本次安排失败，请重试');}
  finally{this.pending.delete(intent);}
 }
 async startBatch(taskId:string):Promise<void>{
  const task=this.deps.getState().tasks.find(t=>t.id===taskId);if(!task||!eligible(task))return;
  const intent=this.begin(batchIndices(task),task);if(!intent)return;
  try{
   if(!await this.validate(intent,true))return;
   const state=this.deps.getState(),current=state.tasks.find(t=>t.id===taskId)!;
   const entries=intent.indices.map(index=>({index,job:this.makeJob(index,'batch-'+this.id(),state,current)}));
   const jobs={...current.railBatch?.jobs,...Object.fromEntries(entries.map(({index,job})=>[index,job]))};
   const accepted=this.submit(intent,entries,(tasks,fleet)=>tasks.map(t=>t.id===taskId?syncRailTask(this.withCheck({...t,robot:'R-'+t.block,treeIndices:taskTreeIndices(t),
    railBatch:{jobs,results:t.railBatch?.results??{},baseDone:t.railBatch?.baseDone??t.done}},'passed','派发核验通过，已交给本区机器人'),fleet,this.now()):t));
   if(accepted)this.deps.notify('剩余树已交给本区机器人，自动连续执行');
  }catch(error){if(this.current(intent))this.deps.notify(error instanceof Error?error.message:'本次安排失败，请重试');}
  finally{this.pending.delete(intent);}
 }
 async retry(taskId:string):Promise<void>{
  const task=this.deps.getState().tasks.find(t=>t.id===taskId);if(!task||!eligible(task))return;
  if(task.railBatch)return this.startBatch(taskId);
  if(!task.id.startsWith('rail-')||task.treeIndices?.length!==1||task.count!==1)return;
  const intent=this.begin(task.treeIndices,task);if(!intent)return;
  try{
   if(!await this.validate(intent,true))return;
   const state=this.deps.getState(),index=intent.indices[0],job=this.makeJob(index,taskId,state,task);
   const accepted=this.submit(intent,[{index,job}],(tasks,fleet)=>tasks.map(t=>t.id===taskId?syncRailTask(this.withCheck({...t,railJob:job},'passed','派发核验通过，已重新安排任务'),fleet,this.now()):t));
   if(accepted)this.deps.notify('任务已重新安排');
  }catch(error){if(this.current(intent))this.deps.notify(error instanceof Error?error.message:'本次安排失败，请重试');}
  finally{this.pending.delete(intent);}
 }
}
