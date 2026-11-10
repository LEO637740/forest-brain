import { ChevronDown } from 'lucide-react';
import { incidentResult } from './SurfaceIncidentView';
import { operationDateLabel } from './operationsModel';
import { treeWorkRecords } from './treeWorkModel';
import type { TreeWorkRecord } from './treeWorkModel';
import {treeAlias,type Site,type Task} from './model';
import {getTreeYieldSeries} from './analyticsData';
import {demoTaskAngle} from '../../../shared/demoTaskChain';

type TreeWorkProps = {index:number;tasks:Task[];onTask:(t:Task)=>void;onPhoto:(t:Task)=>void;site?:Site};

function TreeWorkDetails({record,onTask,onPhoto,showActions=true}:{record:TreeWorkRecord;onTask:(t:Task)=>void;onPhoto:(t:Task)=>void;showActions?:boolean}){
 const {task,index,plan}=record,incident=task.dispatch?.incident;
 return <div className="ws-tree-work-details">
  <p className="ws-muted">{record.timeLabel}</p>
  <p>{record.note}</p>
  <p className="ws-muted">计划日期：{operationDateLabel(task)} · {task.start}–{task.end}</p>
  {plan?.harnessSource&&<p>关联模拟策略 v{plan.harnessSource.revision} · {plan.harnessSource.treeId}</p>}
  {plan&&<p>原派发方案：{plan.planVersion} · {plan.angle}°</p>}
  {record.demoStrategy&&<p>关联模拟策略：{record.demoStrategy.title} · v{record.demoStrategy.revision}<br/>割胶角度 {record.demoReceipt?.angleDeg??demoTaskAngle(record.demoStrategy,index)}° · 深度 {record.demoStrategy.parameters.cutDepthMm} mm · 速度 {record.demoStrategy.parameters.speedMmPerSec} mm/s</p>}
  {task.surfacePlan&&<p>处理安排：{task.surfacePlan.mark} → {task.surfacePlan.action}</p>}
  {record.kind==='record'&&task.receipt&&<p>人工填写结果：{task.receipt.outcome}；{task.receipt.note}</p>}
  {record.kind==='flow'&&record.status!=='流程记录待核对'&&incident?.treeIndex===index&&<p>{incidentResult(incident)}</p>}
  {showActions&&<button className="ws-link" onClick={()=>onTask(task)}>查看关联任务 →</button>}
  {showActions&&incident?.treeIndex===index&&<button className="ws-secondary ws-full" onClick={()=>onPhoto(task)}>查看树表照片与处理记录</button>}
 </div>;
}

export function TreeWorkHistory({index,tasks,onTask,onPhoto,site='hainan'}:TreeWorkProps){
 const records=treeWorkRecords(tasks,index,site);
 return <section aria-label="本树处理与作业">
  <h3>本树处理与作业</h3>
  {records.length?<>
   {records.map(record=><details className="ws-disclosure" key={record.task.id}>
    <summary>{record.status} · {record.task.title}<ChevronDown size={15}/></summary>
    <TreeWorkDetails record={record} onTask={onTask} onPhoto={onPhoto}/>
   </details>)}
  </>:<p>暂无本树新增处理任务</p>}
 </section>;
}

export function TreeWorkSummary({index,tasks,onTask,onPhoto,site='hainan'}:TreeWorkProps){
 const records=treeWorkRecords(tasks,index,site),record=records[0];
 const treeCode=treeAlias(index,site);
 const series=getTreeYieldSeries(index,site).map(point=>({date:point.date.slice(5).replace('-','.'),value:point.actual}));
 const latest=series[series.length-1];
 const chart=series.map((point,i)=>({x:28+i*264/(series.length-1),y:56-(point.value-Math.min(...series.map(p=>p.value)))/Math.max(.001,Math.max(...series.map(p=>p.value))-Math.min(...series.map(p=>p.value)))*32}));
 return <>
  {record&&<section className="ws-tree-task-card"><span>本树作业记录 · {record.task.robot}</span><h3>{record.status}</h3><p>{record.task.title}</p><button className="ws-link" onClick={()=>onTask(record.task)}>查看关联任务 →</button>{record.task.dispatch?.incident?.treeIndex===index&&<button className="ws-secondary ws-full" onClick={()=>onPhoto(record.task)}>查看树表照片与处理记录</button>}<details className="ws-disclosure"><summary>作业详情<ChevronDown size={15}/></summary><TreeWorkDetails record={record} onTask={onTask} onPhoto={onPhoto} showActions={false}/></details>{records.length>1&&<p className="ws-muted">共 {records.length} 条记录，见“作业产胶”。</p>}</section>}
  <section className="ws-yield-mini" aria-label={`${treeCode}${latest?'独立模拟胶乳样本':'产胶记录'}`}><header><strong>{treeCode} · {latest?'独立胶乳样本':'产胶记录'}</strong><span>{latest?`末次 ${latest.value.toFixed(3)} kg`:'暂无产胶数据'}</span></header>{latest?<><p className="ws-muted">模拟样本 · 2026年9月18日—22日。</p><svg viewBox="0 0 320 84" role="img" aria-label={`${treeCode}独立模拟样本：${series.map(point=>`${point.date}${point.value.toFixed(3)}千克`).join('，')}`}><path d="M25 56H295" stroke="#42664f"/><path d={chart.map((point,i)=>`${i?'L':'M'}${point.x} ${point.y}`).join(' ')} fill="none" stroke="#8fe0b5" strokeWidth="2"/>{series.map((point,i)=><g key={point.date}><circle cx={chart[i].x} cy={chart[i].y} r="3.5" fill="#8fe0b5"/><text x={chart[i].x} y={chart[i].y-8} textAnchor="middle">{point.value.toFixed(3)}</text><text x={chart[i].x} y="76" textAnchor="middle">{point.date}</text></g>)}</svg></>:<p className="ws-muted">西安为设备联调站点，暂无本树产胶序列。</p>}</section>
 </>;
}

