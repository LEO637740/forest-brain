import type {Task} from './model';
import type {FleetJob} from '../zoneFleet';

export type TaskConflict={taskId:string;message:string;task?:Task|null;code?:string;revision?:number};
export type TaskWriteResult={tasks:Task[];conflicts:TaskConflict[]};
const revision=(task:Task)=>task.revision??0;
const copy=(task:Task):Task=>structuredClone(task);
// Server metadata changes do not count as new user edits.
export function taskContent(task:Task){const {revision:_,...content}=task;return JSON.stringify(content);}

/** One instance per workspace. HTTP operations must run serially. */
export class TaskSync {
 private acknowledged=new Map<string,Task>();
 private pending=new Map<string,Task>();
 constructor(pendingWrites:Task[]=[]){for(const task of pendingWrites)this.pending.set(task.id,copy(task));}
 pendingWrites():Task[]{return [...this.pending.values()].map(copy);}
 beginWrite(tasks:Task[]):Task[]{
  return tasks.map(task=>{
   // An uncertain write must be retried verbatim before a newer edit can be
   // sent. Otherwise a lost response would also erase the evidence of that write.
   const snapshot=this.pending.get(task.id)??copy(task);
   this.pending.set(task.id,snapshot);
   return copy(snapshot);
  });
 }
 changes(tasks:Task[]){return tasks.filter(task=>{const old=this.acknowledged.get(task.id);return !old||taskContent(old)!==taskContent(task);});}
 receive(local:Task[],remote:Task[],submitted:Task[]=[],conflicts:TaskConflict[]=[]):Task[]{
  const byId=new Map(local.map(task=>[task.id,task]));
  const sent=new Map([...this.pending,...submitted.map(task=>[task.id,task] as const)]);
  const rejected=new Set(conflicts.map(conflict=>conflict.taskId));
  for(const id of rejected)this.pending.delete(id);
  for(const server of remote){
   const old=this.acknowledged.get(server.id),current=byId.get(server.id),upload=sent.get(server.id);
   if(old&&revision(server)<revision(old))continue;
   this.acknowledged.set(server.id,copy(server));
   // An explicit refusal wins even on the first read at the same revision.
   if(rejected.has(server.id)){byId.set(server.id,server);continue;}
   if(upload&&taskContent(server)===taskContent(upload)){
    this.pending.delete(server.id);
    // This also recognizes a successful POST whose response was lost, after a
    // GET or a page reload. Keep any receipt produced while it was in flight.
    byId.set(server.id,!current||taskContent(current)===taskContent(upload)?server:{...current,revision:server.revision});
    continue;
   }
   if(upload&&revision(server)>revision(upload))this.pending.delete(server.id);
   // A persisted local edit may be waiting for its first successful write.
   // Keep it as a compare-and-set candidate when the server has not advanced;
   // otherwise an initial refresh would silently discard the edit before it can
   // be submitted. A newer server revision still wins.
   if(!old&&current&&taskContent(current)!==taskContent(server)&&revision(current)>=revision(server))continue;
   if(!current||revision(server)>revision(current)||(!old&&revision(server)>=revision(current)))byId.set(server.id,server);
  }
  const next=[...byId.values()];
  return next.length===local.length&&next.every((task,i)=>task===local[i])?local:next;
 }
}

const jobIds=(task:Task|undefined)=>new Set([
 task?.railJob?.id,task?.railResult?.job?.id,
 ...Object.values(task?.railBatch?.jobs??{}).map(job=>job.id),
 ...Object.values(task?.railBatch?.results??{}).map(result=>result.job?.id),
].filter((id):id is string=>typeof id==='string'));

/** Retire only jobs belonging to a task whose server state was actually adopted. */
export function fleetJobsToRetire(before:Task[],after:Task[],remote:Task[],jobs:Record<number,FleetJob>):number[]{
 const previous=new Map(before.map(task=>[task.id,task]));
 const merged=new Map(after.map(task=>[task.id,task]));
 const retired=new Set<string>();
 for(const server of remote){
  const task=merged.get(server.id);
  if(!task||revision(task)!==revision(server)||taskContent(task)!==taskContent(server))continue;
  const candidates=new Set([...jobIds(previous.get(task.id)),...jobIds(task)]);
  const keep=new Set<string>();
  if(!['已完成','已取消'].includes(task.status)){
   if(task.railJob&&!task.railResult)keep.add(task.railJob.id);
   for(const [index,job] of Object.entries(task.railBatch?.jobs??{}))
    if(!task.railBatch?.results[+index])keep.add(job.id);
  }
  for(const id of candidates)if(!keep.has(id))retired.add(id);
 }
 return Object.entries(jobs).filter(([,job])=>retired.has(job.id)).map(([index])=>+index);
}
