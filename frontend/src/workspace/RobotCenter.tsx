import {eventHoldForZone,type OperationalEvent} from './operationalEvents';
import {useState, useSyncExternalStore} from 'react';
import {Bot, MapPin, ArrowRight, Trees} from 'lucide-react';
import {getFleetSnapshot, subscribeFleet} from '../zoneFleet';
import {sites, treeAlias, type Site, type Task} from './model';
import {taskEvidence} from './taskLifecycleModel';
import {fleetTask, robotViews,type RobotTarget} from './robotCenterModel';
import './robotCenter.css';

type Props = {events:OperationalEvent[];onEvents:()=>void;site: Site; tasks: Task[]; initialZone?:number; initialRobot?:RobotTarget; onTree: (index: number) => void; onTask: (task: Task) => void; onScene: (zone: number) => void};

export function RobotCenter({events,onEvents,site, tasks,initialZone=0,initialRobot, onTree, onTask, onScene}: Props) {
  const fleet = useSyncExternalStore(subscribeFleet, getFleetSnapshot);
  const [selectedRobot, setSelectedRobot] = useState<RobotTarget>(initialRobot??{source:site==='hainan'?'fleet':'task',zone:initialZone});
  const robots = robotViews(site, fleet, tasks);
  const selected=robots.find(robot=>robot.zone===selectedRobot.zone)??robots[0];
  const state = selected?.state, index = state?.active, task = selected?.currentTask;
  const job = selected?.source==='fleet' && index !== null && index !== undefined ? fleet.jobs[index] : undefined;
  const source = task ? job?.harnessSource : undefined;
  const hold = eventHoldForZone(site,selected.zone,events);
  const evidence = task ? taskEvidence(task) : undefined;
  function queuedTree(tree:number, order:number){
    const queuedTask=selected.source==='fleet'?fleetTask(tree,fleet.jobs[tree],tasks):task;
    return <div key={tree}><span>{order+1}</span><button className="robot-tree-link" onClick={()=>onTree(tree)}>{treeAlias(tree,site)}</button>{queuedTask?<button className="rb-button" onClick={()=>onTask(queuedTask)}>{queuedTask.title}<ArrowRight size={14}/></button>:<small>待核对关联任务</small>}</div>;
  }
  return <section className="rb-page robot-center" aria-labelledby="robot-center-title">
    <header className="robot-center-head"><div><p className="robot-eyebrow">{sites[site]} · 模拟设备</p><h1 id="robot-center-title">机器人管理</h1></div><button className="rb-button" onClick={onEvents}>天气与设备联动</button></header>
    <>
      {hold&&<p className="robot-context robot-hold" role="status">{hold}</p>}
      <nav className="robot-list" aria-label={`${sites[site]}模拟机器人列表`}>{robots.map(robot => <button key={`${site}:${robot.zone}`} aria-pressed={selected.zone===robot.zone} onDoubleClick={()=>onScene(robot.zone)} title="双击在胶园中定位" onClick={()=>setSelectedRobot({source:robot.source,zone:robot.zone})}>
        <span className="robot-card-name"><Bot size={22}/><strong>{robot.name}</strong><small>{'ABCD'[robot.zone]}区 · 50 棵{robot.source==='task'?' · 模拟任务':''}</small></span><span className="robot-card-state">{robot.status}</span>
        <span className="robot-card-summary">{robot.state ? <>当前：{robot.state.active===null?'无作业树':treeAlias(robot.state.active,site)}<br/>排队 {robot.state.queue.length} 棵</> : '进入胶园空间后加载模拟机群'}</span>
      </button>)}</nav>
      <section className="robot-detail" aria-label={`${selected.name}机器人详情`}>
        <header><div><h2>{selected.name} · {'ABCD'[selected.zone]}区</h2><p>{treeAlias(selected.zone*50,site)} — {treeAlias(selected.zone*50+49,site)}</p></div><button className="rb-button" onClick={()=>onScene(selected.zone)}><MapPin size={16}/>{site!=='hainan'||fleet.ready?'在胶园中定位':'加载胶园与模拟机群'}</button></header>
        <div className="robot-current"><section aria-label="当前机器人作业"><h3>当前作业</h3><p className="robot-current-state" role="status">{selected.status}</p>{selected.source==='fleet'&&fleet.error&&<p role="alert">{fleet.error}</p>}
          {index!==null&&index!==undefined ? <><button className="robot-tree-link" onClick={()=>onTree(index)}><Trees size={16}/>{treeAlias(index,site)}<ArrowRight size={15}/></button>{job&&!job.observation&&<p className="robot-meta">割胶角度 {job.angle}°</p>}</> : <p>{state?'当前没有正在处理的树。':'机群加载后显示当前目标与排队进度。'}</p>}
        </section><section aria-label="机器人关联任务"><h3>当前任务</h3>{task ? <><h4>{task.title}</h4><p>{task.status} · 已完成 {evidence!.demoCompletedReceipts+evidence!.completedReceipts} / {task.count} 棵</p><button className="rb-button rb-primary" onClick={()=>onTask(task)}>打开任务 <ArrowRight size={16}/></button></>:<p>{job?job?.observation?'正在补拍目标树':'任务关联待核对。':'暂无执行任务。'}</p>}</section></div>
        {(task||job)&&<details className="robot-records"><summary>策略与派发记录</summary>{task?.demoStrategy?<p>{task.demoStrategy.adoptedAt?'已采用模拟方案':'待采用模拟方案'} {task.demoStrategy.title} · v{task.demoStrategy.revision}<br/>{task.demoStrategy.summary}</p>:source?<p>已采用策略 {source.strategyId} · v{source.revision}<br/>分析批次 {source.runId} · {source.treeId}</p>:<p>本次派发未关联模型策略，按记录的演示方案执行。</p>}{job&&<p className="robot-meta">派发 {job.id} · 方案 {job.planVersion}</p>}</details>}
        {!!state?.queue.length&&<section className="robot-queue" aria-label="本区排队树木"><h3>本区排队 · {state.queue.length} 棵</h3>{state.queue.slice(0,3).map(queuedTree)}{state.queue.length>3&&<details><summary>其余 {state.queue.length-3} 棵</summary><div className="robot-queue-rest">{state.queue.slice(3).map((tree,order)=>queuedTree(tree,order+3))}</div></details>}</section>}
        {!!selected.history?.length&&<details className="robot-records"><summary>任务记录 · {selected.history.length} 项</summary>{selected.history.map(record=><div key={record.id}><button className="rb-button" onClick={()=>onTask(record)}>{record.title}<ArrowRight size={14}/></button><p>{record.date} · {record.status} · 完成 {record.done}/{record.count} 棵</p></div>)}</details>}
        <details className="robot-owned" aria-label="机器人负责的树木"><summary>负责树木 · 50 棵</summary><div>{Array.from({length:50},(_,offset)=>{const tree=selected.zone*50+offset, active=state?.active===tree, queued=state?.queue.includes(tree);return <button key={tree} className={active?'is-active':queued?'is-queued':''} aria-label={`打开${treeAlias(tree,site)}单树档案`} onClick={()=>onTree(tree)}><span>{treeAlias(tree,site)}</span><small>{active?'当前作业':queued?'排队中':'查看档案'}</small></button>;})}</div></details>
      </section>
    </>
  </section>;
}

