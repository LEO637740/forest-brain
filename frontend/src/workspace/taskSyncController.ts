import type {Task} from './model';
import {TaskSync,taskContent,type TaskConflict,type TaskWriteResult} from './taskSync.ts';

export type TaskSyncJournal={pendingWrites:Task[];rejected:{task:Task;conflict:TaskConflict}[]};
export type TaskSyncState={
 phase:'loading'|'syncing'|'synced'|'pending'|'error'|'conflict';
 pendingCount:number;lastSuccessAt:number|null;error:string|null;conflicts:TaskConflict[];
 notice:string|null;hydrated:boolean;busy:boolean;
};
export const initialTaskSyncState:TaskSyncState={phase:'loading',pendingCount:0,lastSuccessAt:null,error:null,conflicts:[],notice:null,hydrated:false,busy:false};

export function parseTaskSyncJournal(raw:string|null):TaskSyncJournal{
 if(raw===null)return {pendingWrites:[],rejected:[]};
 const value=JSON.parse(raw);
 const task=(item:Task)=>item&&typeof item.id==='string'&&typeof item.site==='string'&&typeof item.status==='string'&&Number.isInteger(item.count);
 if(!value||!Array.isArray(value.pendingWrites)||!value.pendingWrites.every(task)||!Array.isArray(value.rejected)
  ||!value.rejected.every((item:TaskSyncJournal['rejected'][number])=>task(item?.task)&&item.conflict?.taskId===item.task.id&&typeof item.conflict.message==='string'))throw Error('未确认提交记录无法读取，请保留本地记录后处理');
 return value;
}

type Dependencies={
 getTasks:()=>Task[];
 applyTasks:(tasks:Task[])=>void;
 readTasks:()=>Promise<Task[]>;
 writeTasks:(tasks:Task[])=>Promise<TaskWriteResult>;
 persistJournal:(journal:TaskSyncJournal)=>void;
 onState:(state:TaskSyncState)=>void;
 onRemote?:(before:Task[],after:Task[],remote:Task[])=>void;
 journal?:TaskSyncJournal;
 now?:()=>number;
};

/** One serialized read/write loop; failed writes retain the exact submitted snapshot. */
export class TaskSyncController{
 private sync:TaskSync;
 private rejected:TaskSyncJournal['rejected'];
 private state={...initialTaskSyncState};
 private lastRead:number|null=null;
 private mustRead=true;
 private forceQueued=false;
 private running:Promise<void>|null=null;
 private disposed=false;
 private now:()=>number;
 private deps:Dependencies;
 constructor(deps:Dependencies){
  this.deps=deps;
  this.sync=new TaskSync(deps.journal?.pendingWrites??[]);
  this.rejected=structuredClone(deps.journal?.rejected??[]);
  this.now=deps.now??Date.now;
 }
 private save(){this.deps.persistJournal({pendingWrites:this.sync.pendingWrites(),rejected:this.rejected});}
 private pending(){
  // An unconfirmed request still counts even if a later local edit matches the
  // last server read. Resolve that request before declaring the task synchronized.
  const local=this.deps.getTasks(),pending=new Map(this.sync.changes(local).map(task=>[task.id,task]));
  for(const task of this.sync.pendingWrites())if(!pending.has(task.id))pending.set(task.id,local.find(item=>item.id===task.id)??task);
  return [...pending.values()];
 }
 private blocked(task:Task){return this.rejected.some(item=>item.task.id===task.id&&taskContent(item.task)===taskContent(task));}
 private report(){
  if(this.disposed)return;
  const pending=this.pending(),local=this.deps.getTasks();
  this.rejected=this.rejected.filter(item=>local.some(task=>task.id===item.task.id&&taskContent(task)===taskContent(item.task)));
  const conflicts=this.rejected.map(item=>item.conflict);
  this.state={...this.state,pendingCount:pending.length,conflicts,
   phase:this.state.busy?(this.state.hydrated?'syncing':'loading'):this.state.error?'error':conflicts.length?'conflict':!this.state.hydrated?'loading':pending.length?'pending':'synced'};
  this.deps.onState(this.state);
 }
 localChanged(){this.report();}
 private merge(remote:Task[],submitted:Task[]=[],conflicts:TaskConflict[]=[]){
  if(this.disposed)return;
  const before=this.deps.getTasks(),after=this.sync.receive(before,remote,submitted,conflicts);
  if(after!==before)this.deps.applyTasks(after);
  this.deps.onRemote?.(before,after,remote);
  for(const conflict of conflicts){
   this.rejected=this.rejected.filter(item=>item.task.id!==conflict.taskId);
   if(!conflict.task){const task=submitted.find(item=>item.id===conflict.taskId);if(task)this.rejected.push({task,conflict});}
  }
  const resolved=conflicts.filter(item=>item.task);
  if(resolved.length)this.state.notice='已采用服务器最新记录：'+resolved.map(item=>`${item.taskId}：${item.message}`).join('；');
  this.save();
 }
 refresh(force=false):Promise<void>{
  if(this.disposed)return Promise.resolve();
  if(force)this.forceQueued=true;
  if(this.running)return this.running;
  this.running=this.pump().finally(()=>{this.running=null;});
  return this.running;
 }
 private async pump(){
  do{
   const force=this.forceQueued;this.forceQueued=false;
   await this.cycle(force);
  }while(this.forceQueued&&!this.disposed);
 }
 private async cycle(force:boolean){
  if(this.disposed)return;
  const needsRead=force||this.mustRead||this.lastRead===null||this.now()-this.lastRead>=10000;
  if(!needsRead&&!this.pending().some(task=>!this.blocked(task))){this.report();return;}
  this.state={...this.state,busy:true};this.report();
  try{
   if(needsRead){
    const remote=await this.deps.readTasks();if(this.disposed)return;
    this.merge(remote);this.lastRead=this.now();this.mustRead=false;this.state.hydrated=true;
   }
   const changes=this.pending().filter(task=>!this.blocked(task));
   if(changes.length){
    const submitted=this.sync.beginWrite(changes);
    // Save before sending: a reload must still recognize a write with a lost response.
    this.save();
    const result=await this.deps.writeTasks(submitted);if(this.disposed)return;
    this.merge(result.tasks,submitted,result.conflicts);
   }
   this.state.error=null;
   if(!this.pending().length)this.state.lastSuccessAt=this.now();
  }catch(error){
   if(!this.disposed){this.mustRead=true;this.state.error=(error as Error)?.message||'任务服务暂不可用';}
  }finally{
   if(!this.disposed){this.state.busy=false;this.report();}
  }
 }
 dispose(){this.disposed=true;this.forceQueued=false;}
}
