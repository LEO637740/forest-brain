import type { Task } from './model';
import { makeDemoTaskReceipt } from '../../../shared/demoTaskChain.ts';

export type DispatchPhase = 'waiting'|'scheduled'|'running'|'review'|'recapturing'|'pause-requested'|'paused'|'resume-requested'|'cancel-requested'|'cancelled'|'failed'|'completed';
export type SurfaceIncident = {
 treeIndex:number; detectedAt:string; status:'review'|'recapturing'|'adopted'|'completed'|'skipped'|'cancelled';
 category:'结构隆起'; photoUrl?:string; captures:number; lastCaptureAt:string;
 action?:'adopt'|'skip'; decidedAt?:string; completedAt?:string;
};
export type Dispatch = { phase:DispatchPhase; requestId:string; history:{time:string;label:string}[]; auto?:{eventHeldAt?:number;nextAt:number;startedAt:number;stage:'travel'|'work'}; demoSurfaceTree?:number; incident?:SurfaceIncident; skipped?:number[] };
export const phaseLabels:Record<DispatchPhase,string> = {
 waiting:'等待机器人接收',scheduled:'已接收 · 等待作业时间',running:'执行中',
 'pause-requested':'等待暂停确认',paused:'已暂停','resume-requested':'等待继续确认',
 review:'割线附近发现隆起',recapturing:'正在补拍树表',
 'cancel-requested':'等待取消确认',cancelled:'已取消',failed:'机器人未接收',completed:'作业结束'
};
export function processedCount(task:Task){return task.done+(task.dispatch?.skipped?.length??0);}
export function currentTreeIndex(task:Task){return task.treeIndices?.[processedCount(task)];}
export function treeTaskState(task:Task,index:number){
 if(task.dispatch?.skipped?.includes(index))return '已跳过 · 待复查';
 const position=task.treeIndices?.indexOf(index)??-1;
 if(position>=0&&position<processedCount(task))return '已完成割胶';
 if(currentTreeIndex(task)===index&&['review','recapturing'].includes(task.dispatch?.phase??''))return '等待处理树表';
 if(currentTreeIndex(task)===index&&task.dispatch?.phase==='running')return task.dispatch.auto?.stage==='travel'?'机器人正在前往':'正在割胶';
 return isClosed(task)?'未作业':'待作业';
}
export type TaskEvent = 'accept'|'start'|'progress'|'pause'|'resume'|'cancel'|'ack'|'reject'|'retry';
/** Continue older non-rail tasks through the existing demo workflow without rewriting their recorded progress. */
export function prepareSimulatedExecution(task:Task,time=new Date().toISOString()):Task {
 if(task.site==='hainan'||task.kind!=='割胶'||task.dispatch||task.railJob||task.railBatch||isClosed(task))return task;
 const zone='ABCD'.indexOf(task.block);
 if(zone<0)return task;
 return {...task,treeIndices:task.treeIndices??Array.from({length:task.count},(_,i)=>zone*50+i),
  end:Number.isFinite(minuteOf(task.end))?task.end:clockOf(Math.min(1439,minuteOf(task.start)+durationFor(task.count))),
  dispatch:{phase:task.done>0?'running':'scheduled',requestId:task.id,
   history:[{time,label:`继续模拟任务，保留已有进度 ${task.done}/${task.count} 棵；后续由模拟流程记录结果`}]}};
}
export function adoptDemoTaskStrategy(task:Task,time=new Date().toISOString()):Task {
 if(!task.demoStrategy||task.demoStrategy.adoptedAt)return task;
 return {...task,demoStrategy:{...task.demoStrategy,adoptedAt:time,adoptedBy:'演示管理员'},
  ...(task.dispatch?{dispatch:{...task.dispatch,history:[...task.dispatch.history,{time,label:`采用模拟作业方案：${task.demoStrategy.title}`} ]}}:{})};
}
export function transitionTask(task:Task,event:TaskEvent,now=new Date().toISOString()):Task {
 if(event==='start'&&task.dispatch?.phase==='scheduled')task=adoptDemoTaskStrategy(task,now);
 if(!task.dispatch) return task;
 const phase=task.dispatch.phase;
 let next=phase, done=task.done;
 if(event==='accept'&&phase==='waiting') next='scheduled';
 else if(event==='start'&&phase==='scheduled') next='running';
 else if(event==='progress'&&phase==='running'){done=Math.min(task.count-(task.dispatch.skipped?.length??0),done+1);if(done+(task.dispatch.skipped?.length??0)===task.count)next='completed';}
 else if(event==='pause'&&phase==='running')next='pause-requested';
 else if(event==='resume'&&phase==='paused')next='resume-requested';
 else if(event==='cancel'&&['waiting','scheduled','running','review','recapturing','paused','failed'].includes(phase))next='cancel-requested';
 else if(event==='ack'&&phase==='pause-requested')next='paused';
 else if(event==='ack'&&phase==='resume-requested')next='running';
 else if(event==='ack'&&phase==='cancel-requested')next='cancelled';
 else if(event==='reject'&&phase==='waiting')next='failed';
 else if(event==='retry'&&phase==='failed')next='waiting';
 else return task;
 let incident=task.dispatch.incident;
 if(event==='progress'&&incident?.status==='adopted'&&incident.treeIndex===currentTreeIndex(task))incident={...incident,status:'completed',completedAt:now};
 if(next==='cancelled'&&incident&&!['completed','skipped'].includes(incident.status))incident={...incident,status:'cancelled'};
 let demoReceipts=task.demoReceipts;
 if(task.demoStrategy){
  const treeIndex=currentTreeIndex(task);
  if(event==='progress'&&treeIndex!==undefined)demoReceipts=[...(demoReceipts??[]),makeDemoTaskReceipt(task.demoStrategy,treeIndex,'completed',now,incident?.treeIndex===treeIndex&&incident.status==='completed'?'按模拟避让方案完成':'模拟割胶完成')];
  if(next==='cancelled')demoReceipts=[...(demoReceipts??[]),...(task.treeIndices??[]).slice(processedCount(task)).map(index=>makeDemoTaskReceipt(task.demoStrategy!,index,'cancelled',now,'模拟取消剩余作业'))];
 }
 return {...task,...(task.demoStrategy?{demoReceipts:demoReceipts??[]}:{}),done,status:next==='cancelled'?'已取消':next==='completed'?'已完成':next==='running'?'执行中':['waiting','scheduled'].includes(next)?'待开始':'待处理',
  dispatch:{...task.dispatch,incident,phase:next,history:[...task.dispatch.history,{time:now,label:event==='progress'?`完成 ${done}/${task.count} 棵`:phaseLabels[next]}]}};
}
// Decisions act on the blocked tree only. Repeated clicks cannot progress the next tree.
export function resolveSurface(task:Task,action:'adopt'|'recapture'|'skip',now=Date.now()):Task {
 const d=task.dispatch,i=d?.incident;
 if(!d||!i||d.phase!=='review'||i.status!=='review')return task;
 const time=new Date(now).toISOString();
 const skipped=action==='skip'?[...(d.skipped??[]),i.treeIndex]:d.skipped;
 const finished=task.done+(skipped?.length??0)>=task.count;
 const phase:DispatchPhase=action==='recapture'?'recapturing':finished?'completed':'running';
 const incident:SurfaceIncident={...i,status:action==='recapture'?'recapturing':action==='skip'?'skipped':'adopted',...(action!=='recapture'?{action,decidedAt:time}:{})};
 return {...task,...(action==='skip'&&task.demoStrategy?{demoReceipts:[...(task.demoReceipts??[]),makeDemoTaskReceipt(task.demoStrategy,i.treeIndex,'skipped',time,'树表隆起，跳过并保留复查记录')]}:{}),status:phase==='completed'?'已完成':phase==='running'?'执行中':'待处理',dispatch:{...d,phase,skipped,incident,
  auto:d.auto?{stage:action==='adopt'?'work':'travel',startedAt:now,nextAt:now+(action==='recapture'?3000:2500)}:undefined,
  history:[...d.history,{time,label:action==='adopt'?'已采用避让路线，继续当前树':action==='skip'?'已跳过当前树，保留复查记录':'已请求补拍，当前树保持等待'}]}};
}
export function isClosed(task:Task){return task.status==='已完成'||task.dispatch?.phase==='cancelled';}
// Local demo clock, never a device transport. One transition per tick, no catch-up bursts.
export function advanceDemo(task:Task,now:number,eventHeld=false):Task {
 const d=task.dispatch,a=d?.auto;
 if(d&&a&&!['pause-requested','cancel-requested','cancelled','completed'].includes(d.phase)){
  if(eventHeld)return a.eventHeldAt===undefined?{...task,dispatch:{...d,auto:{...a,eventHeldAt:now}}}:task;
  if(a.eventHeldAt!==undefined){const {eventHeldAt,...clock}=a;return {...task,dispatch:{...d,auto:{...clock,nextAt:a.nextAt+Math.max(0,now-eventHeldAt)}}};}
 }
 if(!d||!a||now<a.nextAt||['review','paused','failed','completed','cancelled'].includes(d.phase))return task;
 const time=new Date(now).toISOString();
 if(d.phase==='recapturing'&&d.incident)return {...task,dispatch:{...d,phase:'review',incident:{...d.incident,status:'review',captures:d.incident.captures+1,lastCaptureAt:time},history:[...d.history,{time,label:'补拍回执已到，等待选择处理方式'}]}};
 let next=task,stage=a.stage,delay=1000;
 if(d.phase==='waiting')next=transitionTask(task,'accept',time);
 else if(d.phase==='scheduled'){next=transitionTask(task,'start',time);stage='travel';delay=3000;}
 else if(['pause-requested','resume-requested','cancel-requested'].includes(d.phase)){next=transitionTask(task,'ack',time);delay=stage==='travel'?3000:2500;}
 else if(d.phase==='running'){
  if(stage==='travel'){
   const index=currentTreeIndex(task);
   if(index!==undefined&&index===d.demoSurfaceTree&&!d.incident)return {...task,status:'待处理',dispatch:{...d,phase:'review',auto:{...a,stage:'work'},incident:{treeIndex:index,detectedAt:time,lastCaptureAt:time,status:'review',category:'结构隆起',captures:1},history:[...d.history,{time,label:'树表检查发现割线附近隆起，当前树暂停'}]}};
   stage='work';delay=2500;
  }
  else{next=transitionTask(task,'progress',time);stage='travel';delay=3000;}
 }
 return {...next,dispatch:{...next.dispatch!,auto:{startedAt:now,nextAt:now+delay,stage}}};
}
export function minuteOf(value:string){const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);return m?Number(m[1])*60+Number(m[2]):NaN;}
export function clockOf(value:number){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
export function durationFor(count:number){return Math.max(15,count*2);}
export function scheduleIssue(tasks:Task[],robot:string,start:string,count:number,targets:number[]=[]){
 const from=minuteOf(start),to=from+durationFor(count);
 if(!Number.isFinite(from)||to>=1440)return '请选择当天有效时段，结束时间不能跨日。';
 if(tasks.some(t=>!isClosed(t)&&t.robot===robot&&from<minuteOf(t.end)&&minuteOf(t.start)<to))return '这个时段机器人已有任务，请调整时间或更换机器人。';
 if(tasks.some(t=>{
  if(isClosed(t)||from>=minuteOf(t.end)||minuteOf(t.start)>=to)return false;
  const indices=t.treeIndices??Array.from({length:t.count},(_,i)=>Math.max(0,'ABCD'.indexOf(t.block))*50+i);
  return indices.some(i=>targets.includes(i));
 }))return '部分树木在这个时段已有作业，请调整时间，避免重复安排。';
 return '';
}
export function suggestedStart(tasks:Task[],robot:string,count:number,targets:number[]=[]){
 for(let from=6*60;from+durationFor(count)<1440;from+=15)if(!scheduleIssue(tasks,robot,clockOf(from),count,targets))return clockOf(from);
 return '';
}
