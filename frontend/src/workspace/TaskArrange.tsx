import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, Settings2, CheckCircle2, ArrowLeft, ArrowRight, Bot, MousePointer2, Scan, ChevronDown } from 'lucide-react';
import type { Task } from './model';
import { taskTreeIndices, treeAlias } from './model';
import { adoptDemoTaskStrategy, clockOf, currentTreeIndex, processedCount, durationFor, minuteOf, phaseLabels, scheduleIssue, suggestedStart, transitionTask, treeTaskState, type TaskEvent } from './taskFlow';
import { SurfaceIncidentView, incidentResult } from './SurfaceIncidentView';
import './taskFlow.css';

type Props = { selected:number[]; onSelection:(trees:number[])=>void; mode:'point'|'box'; onMode:(mode:'point'|'box')=>void; onSelecting:(value:boolean)=>void; tasks:Task[]; onCreate:(task:Task)=>void; onClose:()=>void };

export function TaskFlow({ selected, onSelection, mode, onMode, onSelecting, tasks, onCreate, onClose }:Props) {
 const [options,setOptions] = useState(false), [robotChoice,setRobot] = useState('auto'), [customTime,setCustomTime] = useState('');
 const [error,setError] = useState(''), [busy,setBusy] = useState(false), [surfaceCheck,setSurfaceCheck] = useState(false);
 const lock = useRef(false), [requestId] = useState(()=>crypto.randomUUID());
 const settingsButton = useRef<HTMLButtonElement>(null), settings = useRef<HTMLElement>(null);
 useEffect(()=>onSelecting(!options),[options,onSelecting]);
 useEffect(()=>{ if(options) settings.current?.focus(); },[options]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key!=='Escape')return;
   if(options){setOptions(false);settingsButton.current?.focus();}
   else onClose();
  };
  window.addEventListener('keydown',key);
  return()=>window.removeEventListener('keydown',key);
 },[options,onClose]);
 const occupied=(name:string)=>tasks.some(t=>t.robot===name&&t.dispatch?.auto&&!['completed','cancelled','failed'].includes(t.dispatch.phase));
 const robot=robotChoice==='auto'?['Robot 01','Robot 02'].find(n=>!occupied(n))??'Robot 01':robotChoice;
 const start=customTime||suggestedStart(tasks,robot,selected.length,selected);
 const issue=selected.length?(occupied(robot)?'这台机器人正在作业，请在设置中更换设备。':scheduleIssue(tasks,robot,start,selected.length,selected)):'';
 const blocks=[...new Set(selected.map(i=>'ABCD'[Math.floor(i/50)]))].sort();
 const end=start?clockOf(minuteOf(start)+durationFor(selected.length)):'';
 function submit(){
  if(lock.current||!selected.length||issue)return;
  lock.current=true;setBusy(true);
  const now=Date.now(),ordered=[...selected].sort((a,b)=>a-b);
  const task:Task={id:'JOB-'+requestId.slice(0,8),site:'hainan',title:blocks.join('/')+'区割胶',block:blocks.join('/'),robot,start,end,kind:'割胶',count:selected.length,done:0,status:'待开始',treeIndices:ordered,dispatch:{phase:'waiting',requestId,history:[{time:new Date(now).toISOString(),label:'开始割胶演示'}],...(surfaceCheck?{demoSurfaceTree:ordered[Math.min(1,ordered.length-1)]}:{}),auto:{stage:'travel',startedAt:now,nextAt:now+1000}}};
  try{onCreate(task);}catch{setError('未能保存，请重试');lock.current=false;setBusy(false);}
 }
 return <section className="tf-lite tf-arrange" aria-label="安排割胶">
  <div className="tf-context"><button className="ws-link" onClick={onClose}><ArrowLeft size={17}/>返回总览</button><span>/</span><strong>安排割胶</strong></div>
  <div className="tf-command">
   <header className="tf-selection-heading"><div><span className="tf-eyebrow">作业范围</span><h2>{selected.length?<><strong>{selected.length}</strong> 棵已选 <small>{blocks.join(' / ')} 区</small></>:'选择需要割胶的树'}</h2></div><button className="ws-link" disabled={!selected.length} onClick={()=>onSelection([])}>清空选择</button></header>
   <p className="tf-selection-hint">{mode==='box'?'在场景中拖动框选；也可以按分区批量选择。':'点击树木选中，再点取消；也可以按分区批量选择。'}</p>
   <div className="tf-command-row">
    <div className="tf-mode" aria-label="选树方式">
     <button aria-pressed={mode==='point'} onClick={()=>onMode('point')}><MousePointer2 size={16}/>点选</button>
     <button aria-pressed={mode==='box'} onClick={()=>onMode('box')}><Scan size={16}/>框选</button>
     <details><summary>按分区<ChevronDown size={15}/></summary><div>{['A','B','C','D'].map((b,n)=><button key={b} onClick={e=>{onSelection([...new Set([...selected,...Array.from({length:50},(_,i)=>n*50+i)])]);e.currentTarget.closest('details')?.removeAttribute('open');}}>{b}区 · 50棵</button>)}</div></details>
    </div>
    <div className="tf-assignment"><Bot size={19}/><span>{robot}<small>{start?`计划 ${start}–${end}`:'请调整计划时段'}</small></span></div>
    <button ref={settingsButton} className="ws-secondary tf-settings" aria-expanded={options} aria-controls="task-options" onClick={()=>setOptions(v=>!v)}><Settings2 size={17}/>设置</button>
    <button className="ws-primary" disabled={!selected.length||!!issue||busy} onClick={submit}><Play size={17}/>{busy?'正在启动':'开始割胶'}</button>
   </div>
   {(issue||error)&&<div className="tf-inline-notice" role="alert">{error||issue}<button className="ws-link" onClick={()=>setOptions(true)}>修改安排</button></div>}
  </div>
  {options&&<aside ref={settings} tabIndex={-1} id="task-options" className="tf-options" aria-label="作业设置"><header><h3>作业设置</h3><button className="ws-icon" aria-label="关闭作业设置" onClick={()=>{setOptions(false);settingsButton.current?.focus();}}><X size={18}/></button></header>
   <label>机器人<select value={robotChoice} onChange={e=>setRobot(e.target.value)}><option value="auto">自动匹配 · {robot}</option><option>Robot 01</option><option>Robot 02</option></select></label>
   <label>计划时段<input type="time" value={start} onChange={e=>setCustomTime(e.target.value)}/></label>
   <details><summary>演示选项</summary><p>时间加速，开始后自动执行。</p><label className="tf-check"><input type="checkbox" checked={surfaceCheck} onChange={e=>setSurfaceCheck(e.target.checked)}/>包含一次树表异常处理</label></details>
   <button className="ws-link" onClick={()=>{setRobot('auto');setCustomTime('');}}>恢复自动安排</button>
  </aside>}
 </section>;
}

export function TaskMonitor({task,onUpdate,onClose,onTree,holdReason,executionIssue,readOnly=false,embedded=false,onEvents,onOpenScene,sessionNotes=[],demoWeather,onDemoWeatherChange}:{holdReason?:string|null;executionIssue?:string|null;readOnly?:boolean;embedded?:boolean;onEvents?:()=>void;onOpenScene?:()=>void;sessionNotes?:string[];task:Task;onUpdate:(task:Task)=>void;onClose?:()=>void;onTree:(index:number)=>void;demoWeather?:boolean;onDemoWeatherChange?:(enabled:boolean)=>void}) {
 const [details,setDetails]=useState(false),[cancel,setCancel]=useState(false),[photo,setPhoto]=useState(false);
 const phase=task.dispatch!.phase,current=currentTreeIndex(task),skipped=task.dispatch!.skipped?.length??0;
 const cancelled=task.status==='已取消'||phase==='cancelled';
 const finished=task.status==='已完成'||cancelled||phase==='completed',needsReview=phase==='review'||phase==='recapturing';
 const automatic=Boolean(task.dispatch?.auto);
 const actionIssue=holdReason||executionIssue;
 const adoptedProductionPlan=Boolean(task.sourceParkPlanId||task.sourceScenarioId);
 const needsAdoption=Boolean(task.demoStrategy&&!task.demoStrategy.adoptedAt&&!adoptedProductionPlan);
 const label=holdReason?'事件暂缓':executionIssue?'作业暂缓':phase==='running'?(!automatic?'执行记录：执行中':task.dispatch?.auto?.stage==='travel'?'正在前往作业树':'正在割胶'):phase==='scheduled'?'准备出发':phaseLabels[phase];
 const remaining=Math.max(0,task.count-processedCount(task));
 const resultHeading=useRef<HTMLHeadingElement>(null);
 const currentTask=useRef(task),enablingTask=useRef<Task|null>(null);
 currentTask.current=task;
 useEffect(()=>{if(finished&&!photo)resultHeading.current?.focus();},[finished,photo]);
 function enableDemo(event?:'resume'|'retry'){
  if(actionIssue||currentTask.current!==task||finished||automatic||enablingTask.current===task)return;
  const now=Date.now();
  enablingTask.current=task;
  const adopted=adoptDemoTaskStrategy(task,new Date(now).toISOString());
  const enabled={...adopted,dispatch:{...adopted.dispatch!,auto:{stage:'travel' as const,startedAt:now,nextAt:now+1000},history:[...adopted.dispatch!.history,{time:new Date(now).toISOString(),label:'手动启用自动演示（未连接真实设备）'}]}};
  try{onUpdate(event?transitionTask(enabled,event,new Date(now).toISOString()):enabled);return true;}
  catch(error){enablingTask.current=null;throw error;}
 }
 function send(event:TaskEvent){
  if((actionIssue&&event!=='cancel'&&event!=='pause')||currentTask.current!==task||finished||!automatic)return;
  const next=transitionTask(task,event);
  if(next===task)return;
  if(next.dispatch?.auto)next.dispatch={...next.dispatch,auto:{...next.dispatch.auto,nextAt:Date.now()+650}};
  onUpdate(next);setCancel(false);
 }
 const log=<details className="tf-records"><summary>执行记录</summary><ol className="tf-log">{task.dispatch!.history.map((h,i)=><li key={i}><time>{new Date(h.time).toLocaleTimeString('zh-CN',{hour12:false})}</time><span>{h.label}</span></li>)}{sessionNotes.map((note,index)=><li key={`session-${index}`}><span>{note}</span></li>)}</ol></details>;
 const trees=<details className="tf-result-trees"><summary>本次树木 · {task.count} 棵</summary><div>{taskTreeIndices(task).map(index=><button key={index} onClick={()=>onTree(index)}><span>{treeAlias(index,task.site)}</span><span>{treeTaskState(task,index)}<ArrowRight size={14}/></span></button>)}</div>{onOpenScene&&<button type="button" className="ws-link" onClick={onOpenScene}>查看三维场景<ArrowRight size={14}/></button>}</details>;
 const incidentView=photo&&task.dispatch!.incident?<SurfaceIncidentView task={task} demoWeather={demoWeather} onDemoWeatherChange={!readOnly?onDemoWeatherChange:undefined} readOnlyReason={readOnly?'当前身份仅查看作业记录。':finished?'本任务已结束，仅可查看记录。':actionIssue?actionIssue:!automatic?'请先关闭记录并启用自动演示，再处理本树。':undefined} onUpdate={next=>{if(currentTask.current===task&&!finished&&automatic&&!actionIssue)onUpdate(next);}} onClose={()=>setPhoto(false)}/>:null;
 const incidentHost=incidentView&&embedded&&typeof document!=='undefined'?document.querySelector('.workspace-app'):null;
 return <section className={embedded?'tf-lite tf-embedded':'tf-lite'} aria-label="任务跟踪">
  {!embedded&&<div className="tf-context"><button className="ws-link" onClick={onClose}><ArrowLeft size={17}/>返回总览</button><span>/</span><strong>{task.block}区割胶</strong></div>}
  {actionIssue&&<div role="status" className="tf-execution-issue"><p>{actionIssue}</p>{holdReason&&onEvents&&<button type="button" className="ws-link" onClick={onEvents}>处理天气与设备影响 →</button>}</div>}
  {finished?<aside className="tf-result" aria-label="作业结果">
   <span className="tf-eyebrow">{task.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')} · {task.block}区</span>
   <h2 ref={resultHeading} tabIndex={-1}><CheckCircle2 size={26}/>{cancelled?'剩余作业已取消':skipped?'本次作业已结束':'本次割胶已完成'}</h2>
   <dl className="tf-result-counts"><div><dt>已割胶</dt><dd>{task.done}<small>棵</small></dd></div><div><dt>跳过待复查</dt><dd>{skipped}<small>棵</small></dd></div><div><dt>未作业</dt><dd>{remaining}<small>棵</small></dd></div></dl>
   {task.dispatch!.incident&&<section className="tf-result-incident"><strong>{treeAlias(task.dispatch!.incident.treeIndex,task.site)}</strong><p>{incidentResult(task.dispatch!.incident)}</p><button className="ws-link" onClick={()=>setPhoto(true)}>查看异常处理记录<ArrowRight size={16}/></button></section>}
   {trees}
   {log}
   {!embedded&&<button className="ws-primary ws-full" onClick={onClose}>完成，返回总览</button>}
  </aside>:<>
   <div className={`tf-command tf-running ${needsReview?'tf-needs-review':''}`}>
    <div className="tf-running-heading"><div><span className="tf-eyebrow">{task.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')} · {task.block}区</span><h2 role="status">{label}</h2></div><span className="tf-current-tree">{current!==undefined?treeAlias(current,task.site):''}</span></div>
    <div className="tf-command-row">
     <div className="tf-dock-progress"><strong>已割 {task.done} / {task.count} 棵{skipped>0&&<span> · 跳过 {skipped} 棵</span>}</strong><progress aria-label="已处理树木进度（含跳过）" value={processedCount(task)} max={task.count}/></div>
     {embedded&&onOpenScene&&<button className="ws-primary" onClick={onOpenScene}>查看现场<ArrowRight size={16}/></button>}
     {needsReview?<button className="ws-primary si-attention-button" disabled={!readOnly&&embedded&&!automatic&&!!actionIssue} onClick={()=>{if(!readOnly&&embedded&&!automatic){if(enableDemo())setPhoto(true);}else setPhoto(true);}}>{readOnly?'查看异常记录':embedded&&!automatic?'处理模拟异常':automatic&&!actionIssue?'处理树表异常':'查看异常记录'}<ArrowRight size={17}/></button>:automatic&&<span className="tf-auto-note">{holdReason?'等待解除并确认恢复':executionIssue?'等待作业条件恢复':phase==='paused'?'已暂停，等待继续':phase==='failed'?'接收失败，请重试':['pause-requested','cancel-requested','resume-requested'].includes(phase)?'等待设备确认':''}</span>}
     {!readOnly&&phase==='running'&&(automatic||!embedded)&&<button className="ws-secondary" disabled={!automatic} onClick={()=>send('pause')}><Pause size={16}/>暂停</button>}
     {!readOnly&&phase==='paused'&&<button className="ws-primary" disabled={(!automatic&&!embedded)||!!actionIssue} onClick={()=>automatic?send('resume'):embedded?enableDemo('resume'):undefined}><Play size={16}/>{embedded?'继续模拟作业':'继续作业'}</button>}
     {!readOnly&&phase==='failed'&&<button className="ws-primary" disabled={(!automatic&&!embedded)||!!actionIssue} onClick={()=>automatic?send('retry'):embedded?enableDemo('retry'):undefined}>{embedded?'重试模拟作业':'重试'}</button>}
     <button className="ws-link" aria-expanded={details} onClick={()=>setDetails(v=>!v)}>作业详情<ChevronDown size={16}/></button>
    </div>
    {!readOnly&&!automatic&&(!embedded||!['paused','failed','review','recapturing'].includes(phase))&&<div className="tf-inline-notice" role="status"><span>{embedded?(needsAdoption?'采用当前方案并逐树执行。':'启动后逐树执行并回传结果。'):task.demoStrategy?(!needsAdoption?'策略已采用，启动后继续演示并逐树回传结果。':'采用当前模拟策略后开始作业，执行结果会逐树回传。'):'模拟任务，等待启动。'}</span><button className="ws-primary" disabled={!!actionIssue} onClick={()=>enableDemo()}>{embedded||adoptedProductionPlan?(needsAdoption?'采用并开始模拟作业':'开始模拟作业'):needsAdoption?'采用策略并开始演示':'启用自动演示'}</button></div>}
   </div>
   {details&&<aside className="tf-options"><header><h3>作业详情</h3><button className="ws-icon" aria-label="收起作业详情" onClick={()=>setDetails(false)}><X size={18}/></button></header>
    <p>{task.count}棵 · 计划 {task.start}–{task.end}</p>
    {trees}
    {log}
    {task.dispatch!.incident&&<div className="tf-incident-record"><strong>{treeAlias(task.dispatch!.incident.treeIndex,task.site)}</strong><p>{incidentResult(task.dispatch!.incident)}</p><button className="ws-link" onClick={()=>setPhoto(true)}>查看异常处理记录 →</button></div>}
    {!readOnly&&phase!=='cancel-requested'&&!cancel&&<button className="ws-link" disabled={!automatic} onClick={()=>setCancel(true)}>取消剩余作业</button>}
    {cancel&&<div><p>取消剩余 {remaining} 棵？已完成记录会保留。</p><button className="ws-secondary" onClick={()=>setCancel(false)}>保留作业</button><button className="ws-primary" disabled={!automatic} onClick={()=>send('cancel')}>确认取消</button></div>}
   </aside>}
  </>}
  {incidentHost?createPortal(incidentView,incidentHost):incidentView}
 </section>;
}
