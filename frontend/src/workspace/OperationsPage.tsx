import type {LatexBatch,CollectionInput,BatchAction,BatchActionInput} from '../../../shared/logistics.ts';
import type {SalesInventory,SalesShipment} from '../../../shared/salesShipments';
import {SalesShipmentPanel} from './SalesShipmentPanel';
import {OperationalEventsPanel} from './OperationalEventsPanel';
import {eventHoldForTask,type OperationalEvent} from './operationalEvents';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudSun,
  FileClock,
  ListTree,
  MapPin,
  Play,
  Search,
  StepForward,
  Trees,
  X,
} from 'lucide-react';
import type { Site, Story, Task, TaskStatus } from './model';
import { sites, taskTreeIndices, treeAlias } from './model';
import { Modal } from './Modal';
import './operations.css';
import { SurfaceReturn } from './SurfaceReturn';
import {ZoneTaskControls} from './ZoneFleetControls';
import {useSyncExternalStore} from 'react';
import {getFleetSnapshot,subscribeFleet} from '../zoneFleet';
import { phaseLabels, treeTaskState, prepareSimulatedExecution } from './taskFlow';
import { TaskLifecycle } from './TaskLifecycle';
import { TaskMonitor } from './TaskArrange';
import {taskFleetControls} from './taskFleetControlModel';
import { LogisticsPanel } from './LogisticsPanel';
import { groupOperationsTasks, isCalendarDay, isClosed, needsDeviceAssignment, operationDateLabel, shanghaiDay, taskConflicts, taskDate, taskScheduleIssue, timeToMinutes, timelineTasks, unverifiedSchedules, type OperationsScope } from './operationsModel';

export type TaskOpenRequest = { id: string; site: Site; sequence: number };
export type ShipmentOpenRequest = { id?: string; site: Site; sequence: number };
export type BatchOpenRequest = { id?: string; site: Site; sequence: number };

export type OperationsPageProps = {
  readOnly?:boolean;
  demoWeather?:boolean;
  onDemoWeatherChange?:(enabled:boolean)=>void;
  executionHold?:(task:Task)=>string|undefined;
  shipments:SalesShipment[];
  salesInventory:SalesInventory|null;
  shipmentError:string;
  shipmentOpenRequest?:ShipmentOpenRequest|null;
  batchOpenRequest?:BatchOpenRequest|null;
  onAdvanceShipment:(id:string)=>Promise<void>;
  onShipmentSource:(modelId:string)=>void;
  batches:LatexBatch[];
  onCreateBatch:(input:CollectionInput)=>Promise<void>;
  onBatchAction:(id:string,action:BatchAction,input:BatchActionInput)=>Promise<void>;
  events:OperationalEvent[];
  eventViewRequest?:number;
  onCreateEvent:(input:{kind:OperationalEvent['kind'];zone:number|null;note:string})=>Promise<void>;
  onResolveEvent:(id:string,note:string)=>Promise<void>;
  onResumeEvent:(id:string,note:string)=>Promise<void>;
  site: Site;
  tasks: Task[];
  selectedTaskId: string;
  openRequest?: TaskOpenRequest | null;
  onSelectTask: (id: string) => void;
  onTree: (index: number) => void;
  onTreeHistory: (index: number) => void;
  onStory: (story: Story, treeIndex?: number) => void;
  onTaskUpdate: (task: Task) => void;
  onNotify: (message: string) => void;
  onOpenFlow: (task:Task) => void;
  onRetryRail: (task:Task) => void;
  onStartRailBatch: (task:Task) => void;
  onReview?: () => void;
  onStrategy?: (task:Task) => void;
};

const statusOrder: TaskStatus[] = ['待处理', '执行中', '待开始', '已完成', '已取消'];
const statusClass: Record<TaskStatus, string> = {
  执行中: 'running',
  待处理: 'attention',
  待开始: 'pending',
  已完成: 'complete',
  已取消: 'cancelled',
};

function progressOf(task: Task) {
  if (!task.count) return 0;
  return Math.max(0, Math.min(100, Math.round((task.done / task.count) * 100)));
}

function canRetryRailDispatch(task: Task) {
  return task.site === 'hainan' && task.kind === '割胶' && task.status === '待处理'
    && !task.dispatch && !task.id.startsWith('rail-') && !task.railBatch && !task.railJob && !task.railResult
    && task.done < task.count;
}

function canAdjustSchedule(task: Task) {
  if (isClosed(task) || task.id.startsWith('rail-') || task.railBatch) return false;
  if (task.dispatch) return ['paused', 'failed', 'review', 'recapturing'].includes(task.dispatch.phase) || (!task.dispatch.auto && ['waiting', 'scheduled'].includes(task.dispatch.phase));
  return task.status === '待开始' || task.status === '待处理';
}

export function OperationsPage({
  readOnly=false,
  demoWeather,onDemoWeatherChange,
  executionHold,
  shipments,salesInventory,shipmentError,shipmentOpenRequest,batchOpenRequest,onAdvanceShipment,onShipmentSource,
  batches,onCreateBatch,onBatchAction,events,eventViewRequest,onCreateEvent,onResolveEvent,onResumeEvent,
  site,
  tasks,
  selectedTaskId,
  openRequest,
  onSelectTask,
  onTree,
  onTreeHistory,
  onStory,
  onTaskUpdate,
  onNotify,
  onOpenFlow,
  onRetryRail,
  onStartRailBatch,
  onReview,
  onStrategy,
}: OperationsPageProps) {
  const fleet=useSyncExternalStore(subscribeFleet,getFleetSnapshot);
  const [view, setView] = useState<'tasks' | 'logistics' | 'events' | 'sales'>('tasks');
  useEffect(()=>{if(eventViewRequest)setView('events');},[eventViewRequest]);
  useEffect(()=>{if(shipmentOpenRequest?.site===site)setView('sales');},[shipmentOpenRequest,site]);
  useEffect(()=>{if(batchOpenRequest?.site===site)setView('logistics');},[batchOpenRequest,site]);
  const consumedRequest = useRef<string | null>(null);
  const followedExecution = useRef<{id:string;site:Site;date:string|null;kind:string}|null>(null);
  const currentTasks = useRef(tasks);
  currentTasks.current = tasks;
  const initializedSite = useRef<Site | null>(null);
  const [focusedRequest, setFocusedRequest] = useState<TaskOpenRequest | null>(null);
  const requestKey = openRequest ? JSON.stringify([openRequest.site, openRequest.id, openRequest.sequence]) : null;
  const requestPending = requestKey !== null && requestKey !== consumedRequest.current;
  const [query, setQuery] = useState('');
  const [today, setToday] = useState(() => shanghaiDay());
  const [day, setDay] = useState(() => shanghaiDay());
  const [followToday, setFollowToday] = useState(true);
  const [scope, setScope] = useState<OperationsScope>('day');
  const [limit, setLimit] = useState(30);
  const [status, setStatus] = useState('未完成');
  const [kind, setKind] = useState('割胶');
  const [treeDialogOpen, setTreeDialogOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [scheduleHeight,setScheduleHeight]=useState(172);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sessionLogs, setSessionLogs] = useState<Record<string, string[]>>({});
  const [assignmentNames, setAssignmentNames] = useState<Record<string, string>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, { date: string; start: string; end: string }>>({});

  const groups = useMemo(() => groupOperationsTasks(tasks, site, day), [site, tasks, day]);
  const followedMatches = followedExecution.current ? tasks.filter(task => task.id===followedExecution.current!.id&&task.site===followedExecution.current!.site&&taskDate(task)===followedExecution.current!.date&&task.kind===followedExecution.current!.kind) : [];
  const followedResult = view==='tasks'&&followedMatches.length===1&&followedMatches[0].site===site&&isClosed(followedMatches[0]) ? followedMatches[0] : null;
  const listStatus = followedResult ? '已结束' : status;
  const scopeTasks = followedResult&&scope==='carryover'&&!groups[scope].includes(followedResult) ? [...groups[scope],followedResult] : groups[scope];
  const siteTasks = useMemo(() => scopeTasks.filter(t => t.kind === kind), [scopeTasks, kind]);
  const kinds = useMemo(() => Array.from(new Set(['割胶', '巡检', ...tasks.filter(t => t.site === site).map(t => t.kind)])), [tasks, site]);
  const scopeKind = view === 'logistics' ? '割胶' : kind;
  const scopeCounts = Object.fromEntries(Object.entries(groups).map(([key, list]) => [key, list.filter(t => t.kind === scopeKind).length]));
  const scopeDescription = scope === 'day' ? `${day} 当日计划 · ${scopeKind}` : scope === 'carryover' ? `${day} 之前尚未结束的任务 · 保留原计划日期 · ${scopeKind}` : `原计划日期缺失或无效，暂不归入任何一天 · ${scopeKind}`;
  const visibleTasks = useMemo(() => siteTasks.filter(t => (listStatus === '已结束' ? isClosed(t) : !isClosed(t)) && (!query || [t.title, t.robot, t.block].join(' ').includes(query))).sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)), [siteTasks, listStatus, query]);
  const focusedTargets = focusedRequest ? tasks.filter(task => task.site === focusedRequest.site && task.id === focusedRequest.id) : [];
  const focusedTask = focusedTargets.length === 1 ? focusedTargets[0] : null;
  const focusMessage = requestPending
    ? (openRequest?.site === site ? '正在定位目标任务，请稍候。' : '正在切换园区并定位目标任务，请稍候。')
    : focusedRequest && (focusedRequest.site !== site || focusedTargets.length === 0)
      ? '当前园区已找不到目标任务，可能已移除或同步到其他园区。请重新打开记录，或手动选择任务。'
      : focusedRequest && focusedTargets.length > 1
        ? '当前园区存在多个同编号任务，暂时无法准确定位。请先核对任务记录，或手动选择其他任务。'
        : focusedRequest && focusedTask && !visibleTasks.includes(focusedTask)
          ? '目标任务的日期、类型或状态已变化，当前筛选下不可见。请重新打开该任务，或调整筛选查看。'
          : null;
  const selectedTask = requestPending || focusMessage ? null : focusedRequest ? focusedTask : followedResult&&visibleTasks.includes(followedResult) ? followedResult : visibleTasks.find(t => t.id === selectedTaskId) ?? visibleTasks[0] ?? null;
  useEffect(()=>{
    if(!followedResult)return;
    setStatus('已结束');
    if(scope==='carryover'&&taskDate(followedResult)){setDay(taskDate(followedResult)!);setScope('day');setFollowToday(false);}
  },[followedResult?.id,followedResult?.site,scope]);
  const listedTasks = visibleTasks.slice(0, limit);
  if (selectedTask && !listedTasks.includes(selectedTask)) listedTasks.unshift(selectedTask);
  const fleetControl = selectedTask ? taskFleetControls(selectedTask, fleet) : {live: [], canRetry: false, message: null};
  const scheduledTasks = scope === 'day' ? timelineTasks(tasks, site, day, kind) : [];
  const resources = Array.from(new Set(scheduledTasks.filter(t => !needsDeviceAssignment(t)).map(t => t.robot.trim())));
  const unassigned = scheduledTasks.filter(needsDeviceAssignment);
  const scheduleIssues = scope === 'day' ? siteTasks.filter(t => taskScheduleIssue(t)) : [];
  const timelineRows = resources.flatMap(resource => {
    const rows: Task[][] = [];
    for (const task of scheduledTasks.filter(t => t.robot.trim() === resource).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))) {
      const lane = rows.find(row => timeToMinutes(row.at(-1)!.end) <= timeToMinutes(task.start));
      (lane || (rows.push([]), rows.at(-1)!)).push(task);
    }
    return rows.map((tasks, lane) => ({ resource, lane, tasks }));
  });
  useEffect(() => setLimit(30), [site, kind, status, day, scope, query]);
  useEffect(() => {
    const refreshToday = () => {
      const next = shanghaiDay();
      setToday(next);
      if (followToday && !requestPending && !focusedRequest) setDay(next);
    };
    refreshToday();
    const timer = window.setInterval(refreshToday, 60_000);
    window.addEventListener('focus', refreshToday);
    document.addEventListener('visibilitychange', refreshToday);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshToday);
      document.removeEventListener('visibilitychange', refreshToday);
    };
  }, [followToday, requestPending, focusedRequest]);
  useEffect(() => {
    if (initializedSite.current === site) return;
    initializedSite.current = site;
    followedExecution.current=null;
    setFocusedRequest(null);
    setQuery('');
    setStatus('未完成');
    setKind(tasks.find(t => t.site === site && t.kind === '割胶')?.kind ?? tasks.find(t => t.site === site)?.kind ?? '割胶');
    setScope('day');
    setTreeDialogOpen(false);
    setRecordsOpen(false);
    setScheduleOpen(false);
  }, [site]);
  useEffect(()=>{
    if(selectedTask&&!isClosed(selectedTask))followedExecution.current={id:selectedTask.id,site:selectedTask.site,date:taskDate(selectedTask),kind:selectedTask.kind};
  },[selectedTask?.id,selectedTask?.site]);
  // A request is consumed once. Background synchronization must not restore old filters
  // after the user has chosen another view or date.
  useEffect(() => {
    if (!openRequest || !requestKey || consumedRequest.current === requestKey || openRequest.site !== site) return;
    consumedRequest.current = requestKey;
    followedExecution.current=null;
    setFocusedRequest(openRequest);
    setView('tasks');
    setQuery('');
    setTreeDialogOpen(false);
    setRecordsOpen(false);
    setScheduleOpen(false);
    const matches = tasks.filter(task => task.site === site && task.id === openRequest.id);
    if (matches.length !== 1) return;
    const target = matches[0];
    if(!isClosed(target))followedExecution.current={id:target.id,site:target.site,date:taskDate(target),kind:target.kind};
    const targetDay = taskDate(target);
    setFollowToday(false);
    if (targetDay) setDay(targetDay);
    setScope(targetDay ? 'day' : 'undated');
    setKind(target.kind);
    setStatus(isClosed(target) ? '已结束' : '未完成');
    onSelectTask(target.id);
  }, [requestKey, site, tasks]);

  function leaveFocusedTask() {
    followedExecution.current=null;
    setFocusedRequest(null);
  }

  function chooseDay(value: string) {
    if (!isCalendarDay(value)) return;
    leaveFocusedTask();
    setDay(value);
    setFollowToday(false);
  }

  function returnToToday() {
    leaveFocusedTask();
    const current = shanghaiDay();
    setToday(current);
    setDay(current);
    setFollowToday(true);
    setScope('day');
  }

  function selectTimelineTask(task: Task) {
    setQuery('');
    setKind(task.kind);
    setStatus(isClosed(task) ? '已结束' : '未完成');
    selectTask(task);
  }

  function selectTask(task: Task) {
    leaveFocusedTask();
    if(!isClosed(task))followedExecution.current={id:task.id,site:task.site,date:taskDate(task),kind:task.kind};
    setTreeDialogOpen(false);
    setRecordsOpen(false);
    setScheduleOpen(false);
    onSelectTask(task.id);
  }

  function log(taskId: string, message: string) {
    setSessionLogs((current) => ({ ...current, [taskId]: [message, ...(current[taskId] ?? [])].slice(0, 6) }));
  }

  function simulate(task: Task) {
    const hold=eventHoldForTask(task,events)||executionHold?.(task);if(hold){onNotify(hold);return;}
    if(isClosed(task)){onNotify(`${task.title}已结束，不能重新启动`);return;}
    if(task.id.startsWith('rail-')||task.railBatch)return;
    if(task.site==='hainan'&&task.kind==='割胶'&&!task.dispatch){onStartRailBatch(task);return;}
    if(task.dispatch){selectTask(task);return;}
    const simulated=prepareSimulatedExecution(task);
    const scheduleIssue = taskScheduleIssue(simulated);
    if (scheduleIssue) { onNotify(`${task.title}：${scheduleIssue}，请先调整排程`); return; }
    if(task.story==='surface'&&task.status!=='待开始'){onNotify('请在现场处理回传中记录结果，不能用进度按钮代替回执');return;}
    if (task.status === '已完成' || task.done >= task.count) {
      onNotify(`${task.title}已完成，无需继续模拟`);
      return;
    }
    if (task.status === '待处理') {
      onNotify(`${task.title}仍有待调整事项，请先查看天气调整`);
      return;
    }
    if (needsDeviceAssignment(task)) {
      onNotify(`${task.title}尚未分配设备，不能模拟执行`);
      return;
    }
    const conflicts = taskConflicts(simulated, tasks);
    if (task.status === '待开始' && conflicts.length > 0) {
      onNotify(`${task.title}与 ${conflicts.map((item) => item.id).join('、')} 存在设备排程冲突，请先处理`);
      return;
    }

    if(simulated!==task){followedExecution.current={id:simulated.id,site:simulated.site,date:taskDate(simulated),kind:simulated.kind};onTaskUpdate(simulated);return;}
    const starting = task.status === '待开始';
    const increment = starting ? 0 : Math.max(1, Math.ceil(task.count * 0.2));
    const nextDone = Math.min(task.count, task.done + increment);
    const nextStatus: TaskStatus = nextDone >= task.count ? '已完成' : '执行中';
    const next = { ...task, done: nextDone, status: nextStatus };
    onTaskUpdate(next);
    const message = starting
      ? `已模拟启动 ${task.title}（未连接真实设备）`
      : nextStatus === '已完成'
        ? `已模拟完成 ${task.title}（未连接真实设备）`
        : `已模拟推进 ${task.title} 至 ${nextDone}/${task.count}（未连接真实设备）`;
    log(task.id, message);
    onNotify(message);
  }

  function assignDevice(task: Task) {
    if(task.dispatch&&(!canAdjustSchedule(task)||currentTasks.current.find(current=>current.id===task.id&&current.site===task.site)!==task)){onNotify('请先暂停作业，再调整执行设备');return;}
    const robot = (assignmentNames[task.id] ?? '').trim();
    if (!robot) {
      onNotify('请先填写要分配的设备名称');
      return;
    }
    const next = { ...task, robot };
    onTaskUpdate(next);
    const message = `已在本地模拟中为 ${task.title} 分配 ${robot}（未下发设备）`;
    log(task.id, message);
    onNotify(message);
  }

  function saveSchedule(task: Task) {
    const latest = currentTasks.current.filter(current => current.id === task.id && current.site === task.site);
    if (latest.length !== 1 || latest[0] !== task || !canAdjustSchedule(task)) {
      onNotify('任务已变化；请在尚未开始、已暂停或等待异常处理时调整排程');
      return;
    }
    const draft = scheduleDraft(task);
    if (!isCalendarDay(draft.date)) { onNotify('请填写有效的排程日期'); return; }
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.end)){
      onNotify('请输入24小时制时间，例如08:00');return;
    }
    if (timeToMinutes(draft.end) <= timeToMinutes(draft.start)) {
      onNotify('结束时间必须晚于开始时间');
      return;
    }
    const candidate = { ...task, date: draft.date, start: draft.start, end: draft.end };
    const conflicts = taskConflicts(candidate, tasks);
    if (conflicts.length > 0) {
      onNotify(`调整后仍与 ${conflicts.map((item) => item.id).join('、')} 存在设备排程冲突`);
      return;
    }
    onTaskUpdate(candidate);
    followedExecution.current={id:candidate.id,site:candidate.site,date:taskDate(candidate),kind:candidate.kind};
    const message = `已将 ${task.title} 的模拟排程调整为 ${draft.date} ${draft.start}–${draft.end}（未启动设备）`;
    log(task.id, message);
    onNotify(message);
    setScheduleOpen(false);
    setDay(draft.date);
    setFollowToday(false);
    setScope('day');
    setQuery('');
    setKind(candidate.kind);
    setStatus(isClosed(candidate) ? '已结束' : '未完成');
    onSelectTask(candidate.id);
  }

  function scheduleDraft(task: Task) {
    return scheduleDrafts[task.id] ?? { date: taskDate(task) ?? '', start: task.start, end: task.end };
  }

  function updateScheduleDraft(task: Task, field: 'date' | 'start' | 'end', value: string) {
    setScheduleDrafts(current => ({ ...current, [task.id]: { ...(current[task.id] ?? scheduleDraft(task)), [field]: value } }));
  }

  const taskTrees = selectedTask ? taskTreeIndices(selectedTask) : [];
  const taskProgress = selectedTask ? progressOf(selectedTask) : 0;
  const selectedConflicts = selectedTask ? taskConflicts(selectedTask, tasks) : [];
  const selectedScheduleIssue = selectedTask ? taskScheduleIssue(selectedTask) : null;
  const selectedUnverified = selectedTask ? unverifiedSchedules(selectedTask, tasks) : [];
  const selectedExecutionIssue = selectedTask && (!selectedTask.dispatch?.auto||['paused','failed','review','recapturing'].includes(selectedTask.dispatch.phase))
    ? selectedScheduleIssue || (needsDeviceAssignment(selectedTask)?'请先分配执行设备':selectedConflicts.length?'设备时间冲突，请先调整排程':selectedUnverified.length?'同设备任务的日期或时段待核对':null)
    : null;
  const overviewTasks = scopeTasks.filter(task => task.kind === scopeKind);
  const completed = overviewTasks.filter((task) => task.status === '已完成').length;
  const running = overviewTasks.filter((task) => task.status === '执行中' && !isClosed(task)).length;

  return (
    <section style={{'--schedule-height':`${scheduleHeight}px`} as CSSProperties} className="op-page" aria-label={`${sites[site]}作业中心`}>
      <header className="op-heading">
        <div>
          <span>OPERATIONS / {sites[site].toUpperCase()}</span>
          <h1>{view==='sales'?'销售出货':day === today ? '今日作业' : day < today ? '历史作业' : '未来计划'}</h1>
          {view!=='sales'&&<><label className="op-date-select"><span>北京时间</span><input aria-label="作业日期" type="date" value={day} onInput={event => chooseDay(event.currentTarget.value)} onChange={event => chooseDay(event.currentTarget.value)} /></label>
          <button type="button" className="op-today" onClick={returnToToday}>{followToday && day === today ? '跟随今天' : '回到今天'}</button></>}
        </div>
        <nav className="op-view-switch" aria-label="作业中心视图">
          <button type="button" aria-pressed={view === 'tasks'} onClick={() => { leaveFocusedTask(); setView('tasks'); }}>作业任务</button>
          <button type="button" aria-pressed={view === 'events'} onClick={()=>{leaveFocusedTask();setView('events');}}>天气与设备联动</button>
          <button type="button" aria-pressed={view === 'logistics'} onClick={() => { leaveFocusedTask(); setView('logistics'); }}>储运联动</button>
          <button type="button" aria-pressed={view === 'sales'} onClick={() => { leaveFocusedTask(); setView('sales'); }}>销售出货</button>
        </nav>
        {view!=='sales'&&<div className="op-summary" aria-label="任务概览">
          <span><i className="op-dot running" />执行中 <strong>{running}</strong></span>
          <span><i className="op-dot complete" />已完成 <strong>{completed}</strong></span>
          <em>模拟数据</em>
        </div>}
      </header>

      {view!=='events'&&view!=='sales'&&<section className="op-scope" aria-label="任务日期范围">
        <nav aria-label="日期范围">{([['day', '当日计划'], ['carryover', '往期未结束'], ['undated', '日期待核']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { leaveFocusedTask(); setScope(value); }}>{label}<b>{scopeCounts[value]}</b></button>)}</nav>
        <p>{scopeDescription}</p>
      </section>}

      {view === 'sales' ? <>{shipmentError?<p role="alert">{shipmentError}</p>:<SalesShipmentPanel key={site} site={site} shipments={shipments} inventory={salesInventory} selectedId={shipmentOpenRequest?.site===site?shipmentOpenRequest.id:null} onAdvance={onAdvanceShipment} onSource={onShipmentSource}/>}</> : view === 'events' ? <OperationalEventsPanel key={site} site={site} tasks={tasks} batches={batches} events={events} onCreate={onCreateEvent} onResolve={onResolveEvent} onResume={onResumeEvent} onTask={task=>{setView('tasks');chooseDay(taskDate(task)??today);setScope(taskDate(task)?'day':'undated');setKind(task.kind);setStatus(isClosed(task)?'已结束':'未完成');setQuery('');selectTask(task);}}/> : view === 'tasks' ? <>
      <aside className="op-panel op-list-panel" aria-label="作业任务列表">
        <div className="op-panel-title">
          <div><span>任务队列</span><strong>{siteTasks.length}</strong></div>
          
        </div>
        <label className="op-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => { leaveFocusedTask(); setQuery(event.target.value); }} placeholder="搜索任务、区域或设备" />
          {query && <button type="button" onClick={() => { leaveFocusedTask(); setQuery(''); }} aria-label="清除搜索"><X size={14} /></button>}
        </label>
        <nav className="op-tabs" aria-label="作业类型">{kinds.map(k=><button key={k} aria-pressed={kind===k} onClick={()=>{ leaveFocusedTask(); setKind(k); }}>{k}</button>)}</nav>
        <nav className="op-tabs" aria-label="任务状态">{['未完成','已结束'].map(v=><button key={v} aria-pressed={listStatus===v} onClick={()=>{ leaveFocusedTask(); setStatus(v); }}>{v}</button>)}</nav>
        <div className="op-task-list">
          {listedTasks.map((task) => {
            const pct = progressOf(task);
            const conflicts = taskConflicts(task, tasks);
            return (
              <button
                type="button"
                className={`op-task ${selectedTask?.id === task.id ? 'selected' : ''}`}
                key={task.id}
                onClick={() => selectTask(task)}
                aria-pressed={selectedTask?.id === task.id}
              >
                <span className={`op-task-icon ${statusClass[task.status]}`}>
                  {task.status === '已完成' ? <CheckCircle2 size={17} /> : task.status === '执行中' ? <Activity size={17} /> : <Clock3 size={17} />}
                </span>
                <span className="op-task-copy">
                  <span className="op-task-line"><strong>{task.title}</strong><em className={statusClass[task.status]}>{task.dispatch?phaseLabels[task.dispatch.phase]:task.status}</em></span>
                  <small>{needsDeviceAssignment(task) ? '待分配设备' : task.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')}<i />{task.start}–{task.end}</small>
                  <small className="op-task-date">原计划：{operationDateLabel(task)}</small>
                  {!!taskScheduleIssue(task) && <span className="op-conflict-flag"><AlertTriangle size={10} />{taskScheduleIssue(task)}</span>}
                  {!taskScheduleIssue(task) && unverifiedSchedules(task, tasks).length > 0 && <span className="op-conflict-flag"><AlertTriangle size={10} />同设备有排程待核任务</span>}
                  {conflicts.length > 0 && <span className="op-conflict-flag" title={`与 ${conflicts.map((item) => item.id).join('、')} 时间重叠`}><AlertTriangle size={10} />设备时间冲突</span>}
                  <span className="op-mini-progress"><i style={{ width: `${pct}%` }} /></span>
                </span>
                <b>{task.done}/{task.count}</b>
              </button>
            );
          })}
          {visibleTasks.length>limit&&<button className="ws-link" onClick={()=>setLimit(n=>n+30)}>加载更多任务</button>}{!visibleTasks.length && <div className="op-empty"><strong>{siteTasks.length ? '没有符合当前筛选条件的任务' : '当前范围暂无此类作业任务'}</strong>{!siteTasks.length && <><p>前往策略中心采用方案并安排作业。</p>{onReview && <button type="button" className="op-empty-review" onClick={onReview}>前往策略中心</button>}</>}</div>}
        </div>
      </aside>

      <main className={`op-stage ${site !== 'hainan' ? 'op-stage-offline' : ''}`}>
        {site === 'hainan' ? (
          <>
            <div className="op-stage-tag">
              <MapPin size={16} />
              <span><small>当前定位</small><strong>{selectedTask ? `${selectedTask.block}区 · ${selectedTask.title}` : '请选择任务'}</strong></span>
            </div>
            
            
          </>
        ) : (
          <div className="op-unavailable op-site-scene-note">
            <Trees size={35} />
            <strong>{sites[site]} · 三维场景</strong>
            <span>独立场景布局重制中；当前仅保留任务查看。</span>
          </div>
        )}
      </main>

      <aside className="op-panel op-detail-panel" aria-label="作业任务详情">
        <div className="op-panel-title">
          <div><span>作业任务详情</span></div>
          {selectedTask && <em className={statusClass[selectedTask.status]}>{selectedTask.dispatch?phaseLabels[selectedTask.dispatch.phase]:selectedTask.status}</em>}
        </div>
        {selectedTask ? (
          <div className="op-detail">
            <div className="op-detail-head">
              
              <h2>{selectedTask.title}</h2>
            </div>
            <dl className="op-facts">
              
              
              <div><dt><Bot size={15} />执行设备</dt><dd>{needsDeviceAssignment(selectedTask) ? '待分配' : selectedTask.kind==='割胶'?<button className="ws-link" onClick={()=>onOpenFlow(selectedTask)}>{selectedTask.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')} · 在胶园查看</button>:selectedTask.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')}</dd></div>
              <div><dt><Clock3 size={15} />原计划日期</dt><dd>{operationDateLabel(selectedTask)}</dd></div>
              <div><dt><Clock3 size={15} />计划时间</dt><dd>{selectedTask.start}–{selectedTask.end}</dd></div>
            </dl>
            {!selectedTask.dispatch&&<div className="op-progress-block">
              <div><span>作业进度</span><strong>{selectedTask.done} / {selectedTask.count}</strong></div>
              <div className="op-progress"><i style={{ width: `${taskProgress}%` }} /></div>
              <small>{taskProgress}%</small>
            </div>}
            {selectedTask.dispatch&&<TaskMonitor readOnly={readOnly} demoWeather={demoWeather} onDemoWeatherChange={onDemoWeatherChange} key={`${selectedTask.site}:${selectedTask.id}`} embedded task={selectedTask} sessionNotes={sessionLogs[selectedTask.id]} holdReason={eventHoldForTask(selectedTask,events)} executionIssue={executionHold?.(selectedTask)||selectedExecutionIssue} onUpdate={next=>{followedExecution.current={id:selectedTask.id,site:selectedTask.site,date:taskDate(selectedTask),kind:selectedTask.kind};onTaskUpdate(next);}} onTree={onTree} onOpenScene={()=>onOpenFlow(selectedTask)} onEvents={()=>{leaveFocusedTask();setView('events');}}/>}
            <TaskLifecycle batches={batches} events={events} task={selectedTask} fleet={fleet} onReview={onReview} onStrategy={onStrategy} />
            {!readOnly&&fleetControl.live.slice(0,1).map(({index,job})=><ZoneTaskControls key={job.attemptId??job.id} index={index} expectedJob={job}/>)}
            {!readOnly&&fleetControl.canRetry&&<button className="ws-primary" onClick={()=>onRetryRail(selectedTask)}>{selectedTask.railBatch?'重新安排未完成树':'重新安排此任务'}</button>}
            {fleetControl.message&&<p className="ws-muted" role="status">{fleetControl.message}</p>}
            {selectedTask.id.startsWith('rail-')&&selectedTask.treeIndices?.length===1&&<button className="ws-secondary" onClick={()=>onTree(selectedTask.treeIndices![0])}>到场景查看这棵树</button>}
            {(selectedScheduleIssue || selectedUnverified.length > 0) && <div className="op-conflict-alert" role="status"><AlertTriangle size={16} /><span><strong>排程待核对</strong><small>{selectedScheduleIssue || `同设备任务 ${selectedUnverified.map(item => item.id).join('、')} 的日期或时段不完整，尚不能排除时间冲突。`}</small></span></div>}
            {selectedConflicts.length > 0 && (
              <div className="op-conflict-alert" role="status">
                <AlertTriangle size={16} />
                <span><strong>设备时间冲突</strong><small>{selectedTask.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')} 在 {operationDateLabel(selectedTask)} {selectedTask.start}–{selectedTask.end} 与 {selectedConflicts.map((item) => `${item.id} ${item.title}`).join('、')} 重叠</small></span>
              </div>
            )}
            {!readOnly && canAdjustSchedule(selectedTask) && (
              <div className="op-schedule-adjust">
                <button
                  type="button"
                  aria-expanded={scheduleOpen}
                  aria-controls={`op-schedule-form-${selectedTask.id}`}
                  onClick={() => setScheduleOpen((value) => !value)}
                >
                  <Clock3 size={14} />调整排程<ChevronRight className={scheduleOpen ? 'open' : ''} size={14} />
                </button>
                {scheduleOpen && (
                  <form
                    id={`op-schedule-form-${selectedTask.id}`}
                    aria-label={`${selectedTask.title}调整排程`}
                    onSubmit={(event) => { event.preventDefault(); saveSchedule(selectedTask); }}
                  >
                    <label className="op-schedule-date">排程日期<input type="date" aria-label="排程日期" value={scheduleDraft(selectedTask).date} onInput={event => updateScheduleDraft(selectedTask, 'date', event.currentTarget.value)} onChange={event => updateScheduleDraft(selectedTask, 'date', event.currentTarget.value)} /></label>
                    <label>开始时间<input type="text" inputMode="numeric" placeholder="08:00" maxLength={5} value={scheduleDraft(selectedTask).start} onChange={event => updateScheduleDraft(selectedTask, 'start', event.target.value)} /></label>
                    <label>结束时间<input type="text" inputMode="numeric" placeholder="08:00" maxLength={5} value={scheduleDraft(selectedTask).end} onChange={event => updateScheduleDraft(selectedTask, 'end', event.target.value)} /></label>
                    <button type="submit">保存排程</button>
                    
                  </form>
                )}
              </div>
            )}
            {!readOnly && needsDeviceAssignment(selectedTask) && (!selectedTask.dispatch||canAdjustSchedule(selectedTask)) && (
              <div className="op-assignment">
                <label htmlFor={`op-device-${selectedTask.id}`}>先分配执行设备</label>
                <div>
                  <input
                    id={`op-device-${selectedTask.id}`}
                    value={assignmentNames[selectedTask.id] ?? ''}
                    onChange={(event) => setAssignmentNames((current) => ({ ...current, [selectedTask.id]: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === 'Enter') assignDevice(selectedTask); }}
                    placeholder="输入设备名称"
                  />
                  <button type="button" onClick={() => assignDevice(selectedTask)}>确认分配</button>
                </div>
                
              </div>
            )}
            <div className="op-actions">
              {!readOnly&&!selectedTask.dispatch&&!selectedTask.id.startsWith('rail-')&&!selectedTask.railBatch&&!isClosed(selectedTask)&&<button type="button" className="op-primary" onClick={() => simulate(selectedTask)} disabled={(selectedTask.status === '待处理' && !canRetryRailDispatch(selectedTask)) || (needsDeviceAssignment(selectedTask)&&!(selectedTask.site==='hainan'&&selectedTask.kind==='割胶')) || (selectedTask.story==='surface'&&selectedTask.status==='执行中')}>
                {selectedTask.status === '待开始' || canRetryRailDispatch(selectedTask) ? <Play size={16} /> : <StepForward size={16} />}
                {canRetryRailDispatch(selectedTask)?'重新核验并执行':selectedTask.site==='hainan'&&selectedTask.kind==='割胶'?'开始机器人作业':needsDeviceAssignment(selectedTask) ? '请先分配设备' : selectedTask.status === '待开始' && selectedConflicts.length > 0 ? '处理冲突后启动' : selectedTask.status === '待开始' ? '模拟启动' : selectedTask.status === '已完成' ? '已完成' : selectedTask.story==='surface' ? '请填写现场回传' : selectedTask.status === '待处理' ? '待调整' : '模拟推进'}
              </button>}
              {!selectedTask.dispatch&&<><button type="button" onClick={() => setRecordsOpen((value) => !value)}><FileClock size={16} />执行记录</button>
              <button type="button" onClick={() => setTreeDialogOpen(true)}><ListTree size={16} />树木清单</button></>}
            </div>
            
            {selectedTask.story==='surface'&&<SurfaceReturn readOnly={readOnly} key={selectedTask.id} task={selectedTask} onUpdate={onTaskUpdate} onTree={onTreeHistory}/>}
            

            {recordsOpen && !selectedTask.dispatch && (
              <div className="op-records">
                <strong>执行记录</strong>
                {selectedTask.railBatch&&<>
                 <p>原始回执 {Object.keys(selectedTask.railBatch.results).length} / {Object.keys(selectedTask.railBatch.jobs).length} 份</p>
                </>}
                {selectedTask.id.startsWith('rail-')&&selectedTask.treeIndices?.length===1&&<>
                 {selectedTask.railJob&&<p>采用方案：{selectedTask.railJob.planVersion} · {selectedTask.railJob.angle}°</p>}
                 {selectedTask.railResult&&<p>原始回执：{selectedTask.railResult.outcome==='completed'?'完成':'取消'} · {new Date(selectedTask.railResult.finishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间） · {selectedTask.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')}</p>}
                </>}
                <ul>
                  <li className="op-record-summary">共享任务状态：{selectedTask.status} · 当前进度 {selectedTask.done}/{selectedTask.count} 株{needsDeviceAssignment(selectedTask) ? ' · 设备待分配' : ` · ${selectedTask.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')}`}</li>
                  {[...(selectedTask.railDispatchChecks ?? [])].reverse().map((check, index) => <li key={`dispatch-check:${check.time}:${index}`}>
                    {check.outcome === 'blocked' ? '派发核验未通过' : '派发核验通过'} · {new Date(check.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间） · {check.message}
                  </li>)}
                  {(sessionLogs[selectedTask.id] ?? []).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}
                  {selectedTask.railBatch && Object.keys(selectedTask.railBatch.results).length > 0 && <li className="op-record-muted">原始回执，核对结果见“任务记录”。</li>}
                  {Object.entries(selectedTask.railBatch?.results??{}).map(([index, result])=><li key={index}>原始回执：{treeAlias(result.index, selectedTask.site)} · {selectedTask.robot.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')} · {result.outcome==='completed'?'完成':'取消'} · {result.job?.planVersion} · {result.job?.angle}° · {new Date(result.finishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</li>)}
                  {!selectedTask.dispatch&&!selectedTask.railDispatchChecks?.length&&!(sessionLogs[selectedTask.id] ?? []).length && <li className="op-record-muted">本次会话暂无操作记录。</li>}
                </ul>
              </div>
            )}

            {!selectedTask.dispatch && !selectedTask.id.startsWith('rail-')&&!selectedTask.railBatch && selectedTask.status === '待处理' && selectedTask.story === 'weather' && (
              <button type="button" className="op-weather" onClick={() => onStory('weather')}>
                <CloudSun size={18} />
                <span><strong>天气调整建议</strong><small>查看建议作业时间</small></span>
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        ) : <div className="op-empty op-detail-empty" role={focusMessage ? 'status' : undefined}>{focusMessage ?? '当前分类暂无任务'}</div>}
      </aside>

      <section className="op-schedule" aria-label="设备作业日程">
        <div className="op-resize" role="separator" aria-label="调整日程高度" aria-orientation="horizontal" tabIndex={0} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setScheduleHeight(h=>Math.max(52,Math.min(window.innerHeight*.55,h+(e.key==='ArrowUp'?24:-24))));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const bottom=e.currentTarget.parentElement!.getBoundingClientRect().bottom;setScheduleHeight(Math.max(52,Math.min(window.innerHeight*.55,bottom-e.clientY)));}}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)} />
        <header>
          <div><strong>{`${day} · ${kind}日程`}</strong><button onClick={()=>setScheduleHeight(h=>h>52?52:220)}>{scheduleHeight>52?'收起':'展开'}</button></div>
          <span><i className="op-legend-bar active" />作业中<i className="op-legend-bar planned" />待开始<i className="op-legend-bar done" />已完成</span>
        </header>
        <div className="op-timeline">
          {scope !== 'day' ? <div className="op-timeline-note"><p>{scope === 'carryover' ? '往期任务保留各自原计划日期，不叠加到当前日期时间轴。' : '日期待核任务尚不能放入某一天的时间轴。'}</p><button type="button" onClick={() => { leaveFocusedTask(); setScope('day'); }}>返回当日计划</button></div> : <>
            <div className="op-time-axis"><span>设备 / 人员</span><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
            {timelineRows.map(({ resource, lane, tasks: rowTasks }) => <div className="op-timeline-row" key={resource + '-' + lane}><span className="op-resource"><Bot size={15} /><strong>{resource.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')}{lane > 0 ? ' · ' + (lane + 1) : ''}</strong></span><div className="op-track">{rowTasks.map(task => {
              const start = timeToMinutes(task.start), end = timeToMinutes(task.end);
              const conflict = taskConflicts(task, tasks).length > 0;
              return <button key={task.id} title={`${task.title} ${operationDateLabel(task)} ${task.start}–${task.end}${conflict ? ' · 时间冲突' : ''}`} aria-label={`${resource.replace(/^HN-模拟机器人-([ABCD])$/, 'R-$1')} ${task.title} ${task.start}`} className={'op-bar ' + statusClass[task.status] + (conflict ? ' conflict' : '')} style={{ left: start / 1440 * 100 + '%', width: (end - start) / 1440 * 100 + '%' }} onClick={() => selectTimelineTask(task)}><span>{task.title}</span></button>;
            })}</div></div>)}
            {!scheduledTasks.length && !scheduleIssues.length && <p className="op-timeline-note">当日暂无此类任务。</p>}
            {!!unassigned.length && <details className="op-unassigned"><summary>设备待分配 · {unassigned.length} 项</summary>{unassigned.map(task => <button key={task.id} onClick={() => selectTimelineTask(task)}>{task.title} · {task.start}–{task.end}</button>)}</details>}
            {!!scheduleIssues.length && <details className="op-unassigned" open><summary>时段待核对 · {scheduleIssues.length} 项（未画入时间轴）</summary>{scheduleIssues.map(task => <button key={task.id} onClick={() => selectTimelineTask(task)}>{task.title} · {taskScheduleIssue(task)}</button>)}</details>}
          </>}
        </div>
      </section>
      </> : <LogisticsPanel key={site} site={site} openRequest={batchOpenRequest?.site===site?batchOpenRequest:null} allTasks={tasks.filter(task=>task.site===site)} batches={batches} onCreateBatch={onCreateBatch} onBatchAction={onBatchAction} events={events} tasks={scopeTasks} fleet={fleet} onReview={onReview} onTask={task => {
        setView('tasks'); chooseDay(taskDate(task)??today); setScope(taskDate(task)?'day':'undated'); setKind(task.kind); setStatus(isClosed(task) ? '已结束' : '未完成'); setQuery(''); selectTask(task);
      }} />}

      {treeDialogOpen && selectedTask && (
        <div className="op-modal-host">
          <Modal title={`树木清单 · ${selectedTask.id}`} onClose={() => setTreeDialogOpen(false)}>
            <div className="op-dialog-content">
              <p><span>{selectedTask.block}区 · 共 {selectedTask.count} 株</span>选择一株查看作业状态与模拟回执。</p>
            <div className="op-tree-grid">
              {taskTrees.map((index, position) => (
                <button type="button" key={index} onClick={() => { onTree(index); setTreeDialogOpen(false); }}>
                  <Trees size={14} /><span>{treeAlias(index, site)}</span><em>{selectedTask.dispatch?treeTaskState(selectedTask,index):position < selectedTask.done ? '已作业' : '待作业'}</em>
                </button>
              ))}
            </div>
            </div>
          </Modal>
        </div>
      )}
    </section>
  );
}


