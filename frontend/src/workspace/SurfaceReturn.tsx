import { useState } from 'react';
import { receiveSurfaceTask, type Task, type SurfaceReceipt } from './model';

export function SurfaceReturn({task,onUpdate,onTree,readOnly=false}:{task:Task;onUpdate:(task:Task)=>void;onTree:(index:number)=>void;readOnly?:boolean}){
 const [outcome,setOutcome]=useState<SurfaceReceipt['outcome']>('已完成处理');
 const [note,setNote]=useState(''),[error,setError]=useState('');
 return <section className="ws-workflow-status" aria-label="模拟处理回传">
   <h3>模拟处理回传</h3>
   <p>安排：{task.surfacePlan?.action??task.title}</p>
   {task.receipt&&<p>最近回传：{task.receipt.time} · {task.receipt.outcome} · {task.receipt.note}</p>}
   {readOnly?null:task.status==='待开始'?<p>先模拟启动任务，再填写处理结果。</p>:task.status!=='已完成'?<form onSubmit={e=>{e.preventDefault();try{onUpdate(receiveSurfaceTask(task,{outcome,note,time:new Date().toLocaleString('zh-CN')}));setError('');setNote('');}catch(err){setError((err as Error).message);}}}>
     <label className="ws-field">处理结果<select value={outcome} onChange={e=>setOutcome(e.target.value as SurfaceReceipt['outcome'])}><option>已完成处理</option><option>需再次处理</option></select></label>
     <label className="ws-field">现场说明<textarea value={note} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="记录实际处理内容；未完成时说明原因。" required/></label>
     {error&&<p role="alert">{error}</p>}
     <button className="ws-primary" type="submit">保存模拟回传</button>
   </form>:<p>此次处理已完成，回执已归入单树记录，不重复提交。</p>}
   <p className="ws-muted">本演示只记录处理结论，不连接真实相机、机器人或人员派单；后续效果待观察。</p>
 </section>;
}
