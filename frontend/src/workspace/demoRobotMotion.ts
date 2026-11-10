import type {Task} from './model';
import {currentTreeIndex,processedCount} from './taskFlow.ts';
export type DemoRobotMotion={taskId:string;zone:number;treeIndex:number;previousTree:number;stage:'travel'|'work';progress:number;paused:boolean;done:number};
/** Scene projection only: task clock remains the single source of progress and receipts. */
export function demoRobotMotions(tasks:Task[],now:number,held:(task:Task)=>boolean=()=>false):DemoRobotMotion[]{
 const result:DemoRobotMotion[]=[];
 for(let zone=0;zone<4;zone++){
  const task=tasks.filter(t=>t.site==='hainan'&&t.kind==='割胶'&&t.block==='ABCD'[zone]&&t.dispatch?.auto&&!t.railBatch&&!t.railJob)
   .sort((a,b)=>Number(b.status==='执行中'||b.status==='待处理')-Number(a.status==='执行中'||a.status==='待处理')||(b.dispatch!.auto!.startedAt-a.dispatch!.auto!.startedAt))[0];
  if(!task?.treeIndices?.length)continue;
  const d=task.dispatch!,a=d.auto!,position=Math.min(processedCount(task),task.treeIndices.length-1),treeIndex=currentTreeIndex(task)??task.treeIndices.at(-1)!;
  const paused=held(task)||!['running','completed'].includes(d.phase),time=a.eventHeldAt??(paused?Date.parse(d.history.at(-1)?.time??'')||a.startedAt:now);
  const progress=d.phase==='completed'?1:Math.max(0,Math.min(1,(time-a.startedAt)/Math.max(1,a.nextAt-a.startedAt)));
  result.push({taskId:task.id,zone,treeIndex,previousTree:position===0?zone*50:task.treeIndices[position-1],stage:d.phase==='completed'?'work':a.stage,progress,paused,done:task.done});
 }
 return result;
}
