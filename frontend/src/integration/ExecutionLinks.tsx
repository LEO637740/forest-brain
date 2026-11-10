import type {Site,Task} from '../workspace/model';
import {treeAlias} from '../workspace/model';
import {treeWorkRecords} from '../workspace/treeWorkModel';
import {Card} from './Views';
import {demoTaskAngleRange} from '../../../shared/demoTaskChain';

/** The workspace owns task synchronization; all views read the same task version. */
export function ExecutionLinks({tasks,site,onTask}:{tasks:Task[];site:Site;onTask?:(task:Task)=>void}){
 const demoTasks=tasks.filter(task=>task.site===site&&task.demoStrategy).sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.block.localeCompare(b.block));
 const rows=tasks.filter(task=>task.site===site).flatMap(task=>(task.treeIndices??[]).flatMap(index=>{
  const recordedSource=(task.railBatch?.jobs[index]??task.railJob)?.harnessSource;
  return recordedSource?treeWorkRecords([task],index,site).map(record=>({record,source:record.plan?.harnessSource})):[];
 })).sort((a,b)=>(b.record.time??-Infinity)-(a.record.time??-Infinity));
 return <Card title="关联的模拟执行记录">{demoTasks.length>0&&<table><thead><tr><th>任务方案</th><th>采用状态</th><th>任务执行</th><th>逐树回传</th></tr></thead><tbody>{demoTasks.map(task=>{
  const strategy=task.demoStrategy!,receipts=task.demoReceipts??[];
  return <tr key={task.id}><td>{onTask?<button className="demo-task-execution-link" onClick={()=>onTask(task)}>{strategy.title} →</button>:strategy.title}<small> · v{strategy.revision} · {demoTaskAngleRange(strategy)}°</small></td><td>{strategy.adoptedAt?'已采用':'待采用'}</td><td>{task.status} · {task.done}/{task.count} 棵</td><td>{receipts.filter(receipt=>receipt.outcome==='completed').length} 完成 · {receipts.filter(receipt=>receipt.outcome==='skipped').length} 跳过{receipts.some(receipt=>receipt.outcome==='cancelled')?` · ${receipts.filter(receipt=>receipt.outcome==='cancelled').length} 取消`:''}</td></tr>;
 })}</tbody></table>}{rows.length>0&&<table><thead><tr><th>树木</th><th>采用角度</th><th>作业状态</th><th>策略版本</th><th>核对依据</th></tr></thead><tbody>{rows.slice(0,30).map(({record,source})=><tr key={`${record.task.id}:${record.index}`}><td>{treeAlias(record.index,site)}</td><td>{record.plan?`${record.plan.angle}°`:'待核对'}</td><td>{record.status}</td><td>{source?<details><summary>v{source.revision}</summary>{source.strategyId}</details>:'待核对'}</td><td><details><summary>{record.timeLabel}</summary><p>{record.note}</p><p>{record.task.title} · 任务记录：{record.task.status}</p></details></td></tr>)}</tbody></table>}{!rows.length&&!demoTasks.length&&<p>当前园区尚无关联策略的模拟任务。</p>}</Card>;
}
