import type {Task} from '../workspace/model';
import {treeAlias} from '../workspace/model';
import {Card,when} from './Views';
import {demoTaskAngleRange} from '../../../shared/demoTaskChain';
import {DemoTaskAngleDetails} from './DemoTaskAngleDetails';
import './demo-task-strategies.css';

export function DemoTaskStrategies({tasks,selectedTaskId,onSelect,onTask,onOpenFlow}:{tasks:Task[];selectedTaskId?:string|null;onSelect?:(id:string)=>void;onTask?:(task:Task)=>void;onOpenFlow?:(task:Task)=>void}) {
 const choices=tasks.filter(task=>task.demoStrategy).sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.block.localeCompare(b.block));
 const task=choices.find(item=>item.id===selectedTaskId)??choices[0];
 if(!task)return <Card title="任务方案"><p>当前园区暂无模拟任务方案。</p></Card>;
 const strategy=task.demoStrategy!,receipts=task.demoReceipts??[];
 const completed=receipts.filter(receipt=>receipt.outcome==='completed').length;
 const skipped=receipts.filter(receipt=>receipt.outcome==='skipped').length;
 const cancelled=receipts.filter(receipt=>receipt.outcome==='cancelled').length;
 const finished=task.status==='已完成'||task.status==='已取消';
 const adopted=Boolean(strategy.adoptedAt||task.sourceParkPlanId||task.sourceScenarioId);
 const openExecution=onTask??onOpenFlow;
 const range=strategy.treeIndices;
 return <div className="hb-master demo-task-strategies">
  <Card title="任务方案">{choices.map(item=><button key={item.id} className={'hb-select '+(item.id===task.id?'active':'')} aria-pressed={item.id===task.id} onClick={()=>onSelect?.(item.id)}><strong>{item.block} 区 · {item.count} 棵</strong><span>{item.demoStrategy!.title}</span><small>{item.date} · {(item.demoStrategy!.adoptedAt||item.sourceParkPlanId||item.sourceScenarioId)?item.status:'待采用'}</small></button>)}</Card>
  <div className="demo-task-detail"><Card title={strategy.title}>
   <p className="hb-muted">模拟规则生成 · v{strategy.revision} · {adopted?'已采用':'待采用'}</p>
   <h3 className="demo-task-advice">{strategy.summary}</h3>
   <dl className="demo-task-parameters"><div><dt>割线角度</dt><dd>{demoTaskAngleRange(strategy)}<small>°</small></dd></div><div><dt>切割深度</dt><dd>{strategy.parameters.cutDepthMm}<small> mm</small></dd></div><div><dt>作业速度</dt><dd>{strategy.parameters.speedMmPerSec}<small> mm/s</small></dd></div></dl>
   <p className="demo-task-range">{task.block} 区 · {range.length} 棵 · {treeAlias(range[0],task.site)} — {treeAlias(range[range.length-1],task.site)}</p>
   <div className="demo-task-actions">{openExecution&&<button className="demo-task-primary" onClick={()=>openExecution(task)}>{finished?'查看执行结果':'打开任务执行'} →</button>}</div>
   <p className="demo-task-progress">{task.status} · {task.done}/{task.count} 棵 · 回传 {completed} 完成{skipped?` · ${skipped} 跳过`:""}{cancelled?` · ${cancelled} 取消`:""}</p>
   <details className="demo-task-basis"><summary>采用与执行时间线</summary>
   <ol className="demo-task-chain" aria-label="策略到回传进度"><li className="done"><strong>1 · 策略生成</strong><span>{when(strategy.generatedAt)}</span></li><li className={adopted?'done':'current'}><strong>2 · 采用方案</strong><span>{strategy.adoptedAt?when(strategy.adoptedAt):adopted?'生产方案已采用':'启动时采用本方案'}</span></li><li className={finished?'done':adopted?'current':''}><strong>3 · 任务执行</strong><span>{task.status} · {task.done}/{task.count} 棵</span></li><li className={finished?'done':''}><strong>4 · 结果回传</strong><span>{completed} 完成{skipped?` · ${skipped} 跳过`:''}{cancelled?` · ${cancelled} 取消`:''}</span></li></ol>
   </details>
   <DemoTaskAngleDetails task={task}/>
   <details className="demo-task-basis"><summary>查看依据与异常处理</summary><ul>{strategy.basis.map((basis,index)=><li key={index}>{basis}</li>)}</ul><p>树表异常：{strategy.surfaceAction}</p><p className="hb-muted">策略编号：{strategy.strategyId}<br/>关联任务：{task.id}{strategy.adoptedBy&&<><br/>采用人：{strategy.adoptedBy}</>}</p></details>
  </Card>
  <DemoTaskReceipts task={task}/></div>
 </div>;
}

export function DemoTaskReceipts({task}:{task:Task}) {
 const receipts=task.demoReceipts??[],finished=task.status==='已完成'||task.status==='已取消';
 return <details className="demo-task-receipt-panel" open={finished}><summary>逐树回传 · {receipts.length} 条</summary>{receipts.length?<div className="demo-task-receipts"><table><thead><tr><th>树木</th><th>结果</th><th>角度</th><th>回传时间</th></tr></thead><tbody>{receipts.slice().reverse().map(receipt=><tr key={receipt.receiptId}><td>{treeAlias(receipt.treeIndex,task.site)}</td><td><strong>{receipt.outcome==='completed'?'完成':receipt.outcome==='skipped'?'跳过':'取消'}</strong><small>{receipt.note}</small></td><td>{receipt.angleDeg}° · v{receipt.strategyRevision}</td><td>{when(receipt.finishedAt)}</td></tr>)}</tbody></table></div>:<p>开始演示后，每完成一棵树会自动回传结果。</p>}</details>;
}
