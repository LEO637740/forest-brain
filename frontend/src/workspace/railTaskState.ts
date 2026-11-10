import {fleetBlockReason,type FleetJob,type FleetResult,type FleetSnapshot} from '../zoneFleet.ts';
import type {Task} from './model';
import {sameDispatchAttempt,sameDispatchJob,sameDispatchSource,taskEvidence} from './taskLifecycleModel.ts';

const railTask=(t:Task)=>t.site==='hainan'&&t.kind==='割胶'&&!t.dispatch&&t.status!=='已取消'&&t.status!=='已完成'
 &&Number.isInteger(t.count)&&t.count>0&&Number.isInteger(t.done)&&t.done>=0&&t.done<=t.count
 &&!!t.treeIndices&&t.treeIndices.length===t.count&&new Set(t.treeIndices).size===t.count
 &&t.treeIndices.every(i=>Number.isInteger(i)&&i>=0&&i<200);
const batchShape=(t:Task)=>!!t.railBatch&&!t.railJob&&!t.railResult
 &&Number.isInteger(t.railBatch.baseDone)&&t.railBatch.baseDone>=0
 &&Object.keys(t.railBatch.jobs).length+t.railBatch.baseDone===t.count
 &&Object.keys(t.railBatch.jobs).every(key=>String(Number(key))===key&&t.treeIndices!.includes(Number(key)))
 &&new Set(Object.values(t.railBatch.jobs).map(job=>job?.id)).size===Object.keys(t.railBatch.jobs).length;
function batchHistory(t:Task){
 if(!batchShape(t))return null;
 const evidence=taskEvidence(t);
 return evidence.receipts.length===evidence.rawReceipts.length&&t.done===t.railBatch!.baseDone+evidence.completedReceipts?evidence:null;
}
const matchingLive=(saved:FleetJob|undefined,live:FleetJob|undefined)=>sameDispatchAttempt(saved,live)&&sameDispatchSource(saved,live)
 &&!!live&&Number.isFinite(live.angle)&&typeof live.planVersion==='string'&&!!live.planVersion.trim()
 // A waiting baseline job may adopt the existing local 28°/30° choice.
 // Model-adopted plans keep their recorded source and execution parameters.
 &&(!saved?.harnessSource||sameDispatchJob(saved,live));

export function syncRailTask(t:Task,fleet:FleetSnapshot,now=Date.now()):Task{
 if(!railTask(t)||!fleet.ready)return t;
 if(t.railBatch){
  const evidence=batchHistory(t);if(!evidence)return t;
  const pending=Object.keys(t.railBatch.jobs).map(Number).filter(i=>!t.railBatch!.results[i]);
  const live=pending.filter(i=>evidence.validDispatchIndices.includes(i)&&matchingLive(t.railBatch!.jobs[i],fleet.jobs[i]));
  if(!live.length)return t;
  const running=live.some(i=>{const s=fleet.zones[Math.floor(i/50)];return s?.active===i&&!s.paused&&!s.eventHoldReason&&!fleetBlockReason(fleet.jobs[i],now)&&(fleet.jobs[i].notBefore??0)<=now;});
  const held=live.some(i=>{const s=fleet.zones[Math.floor(i/50)];return s?.paused||s?.eventHoldReason||fleetBlockReason(fleet.jobs[i],now);});
  const status=running?'执行中':held?'待处理':'待开始';
  const jobs={...t.railBatch.jobs};for(const i of live)jobs[i]=fleet.jobs[i];
  return status===t.status&&JSON.stringify(jobs)===JSON.stringify(t.railBatch.jobs)?t:{...t,status,railBatch:{...t.railBatch,jobs}};
 }
 if(!t.id.startsWith('rail-')||t.count!==1||t.railResult||t.railJob?.id!==t.id)return t;
 const index=t.treeIndices?.[0],s=index===undefined?undefined:fleet.zones[Math.floor(index/50)],job=index===undefined?undefined:fleet.jobs[index];
 if(!s||!job||!taskEvidence(t).validDispatchIndices.includes(index!)||!matchingLive(t.railJob,job))return t;
 const status=s.eventHoldReason||fleetBlockReason(job,now)||s.paused?'待处理':(job.notBefore??0)>now?'待开始':s.active===index?'执行中':'待开始';
 const start=job.notBefore?new Date(job.notBefore).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}):t.start;
 return status===t.status&&start===t.start&&JSON.stringify(job)===JSON.stringify(t.railJob)?t:{...t,status,start,railJob:job};
}

export function finishRailTask(t:Task,result:FleetResult):Task{
 if(!railTask(t)||!result||!Number.isInteger(result.index))return t;
 if(t.railBatch){
  const before=batchHistory(t);if(!before)return t;
  const expected=t.railBatch.jobs[result.index];
  if(!expected||t.railBatch.results[result.index])return t;
  // Existing malformed receipts stay intact for review. Never count them,
  // silently replace them, or roll back progress already sent to the server.
  const results={...t.railBatch.results,[result.index]:result};
  const evidence=taskEvidence({...t,railBatch:{...t.railBatch,results}});
  if(evidence.receipts.length!==before.receipts.length+1||!evidence.receipts.includes(result))return t;
  const all=evidence.receipts.length===Object.keys(t.railBatch.jobs).length;
  const done=t.railBatch.baseDone+evidence.completedReceipts;
  return {...t,done,status:all?(done===t.count?'已完成':'已取消'):t.status,
   end:all?new Date(result.finishedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}):t.end,railBatch:{...t.railBatch,results}};
 }
 if(t.count!==1||t.done!==0||!t.railJob||t.railResult)return t;
 if(!taskEvidence({...t,railResult:result}).receipts.includes(result))return t;
 return {...t,status:result.outcome==='completed'?'已完成':'已取消',done:result.outcome==='completed'?1:0,
  end:new Date(result.finishedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}),railResult:result};
}
