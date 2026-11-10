import type {FleetJob, FleetSnapshot, ZoneState} from '../zoneFleet';
import {fleetBlockReason,fleetZoneHoldReason} from '../zoneFleet.ts';
import {sameDispatchJob} from '../fleetJobIdentity.ts';
import {parks} from '../../../shared/parkCatalog.ts';
import {currentTreeIndex,processedCount,phaseLabels} from './taskFlow.ts';
import type {Site, Task} from './model';
import {taskEvidence} from './taskLifecycleModel.ts';

export type RobotView = {
  source: 'fleet' | 'task';
  zone: number;
  name: string;
  state?: Pick<ZoneState,'active'|'queue'|'completed'>;
  status: string;
  currentTask?: Task;
  history?: Task[];
};

export type RobotTarget = Pick<RobotView,'source'|'zone'>;
export function taskRobotTarget(task:Task,treeIndex:number):RobotTarget {
  return {source:task.site==='hainan'&&(task.railJob||task.railBatch)?'fleet':'task',zone:Math.floor(treeIndex/50)};
}

/** A robot belongs to its fixed Hainan zone; task labels never assign ownership. */
export function fleetTask(index: number, job: FleetJob | undefined, tasks: Task[]): Task | undefined {
  if (!job) return undefined;
  const matches = tasks.filter(task => task.site === 'hainan' && task.kind === '割胶'
    && taskEvidence(task).validDispatchIndices.includes(index)
    && sameDispatchJob(task.railBatch?.jobs[index] ?? task.railJob, job));
  return matches.length === 1 ? matches[0] : undefined;
}

export function robotStatus(state: ZoneState, fleet: FleetSnapshot, now = Date.now()): string {
  const hold=state.active!==null?fleetZoneHoldReason(state,fleet.jobs[state.active]):state.eventHoldReason;
  if (hold) return state.phase === 'retracting' ? '收臂中 · ' + hold : hold;
  if (state.phase === 'retracting') return state.paused ? '收臂中 · 本区暂停' : '收臂中';
  if (state.paused) return '本区已暂停';
  if (state.active !== null) {
    const job = fleet.jobs[state.active];
    return fleetBlockReason(job, now) || ((job.notBefore ?? 0) > now ? '等待作业窗口'
      : ({idle: '待执行', moving: '沿轨道前往单树', working: job.observation ? '正在拍照' : '模拟割胶中', retracting: '收臂中'})[state.phase]);
  }
  return state.queue.length ? '等待排队任务的作业条件' : '空闲';
}

export function robotViews(site: Site, fleet: FleetSnapshot, tasks: Task[], now = Date.now()): RobotView[] {
  const taskViews=Array.from({length:4},(_,zone)=>{
    const currentTask=tasks.filter(task=>task.site===site&&task.kind==='割胶'&&task.block==='ABCD'[zone]
      &&(site!=='hainan'||(task.dispatch&&!task.railJob&&!task.railBatch)))
      .sort((a,b)=>(b.date??'').localeCompare(a.date??'')||Number(b.status==='执行中'||b.status==='待处理')-Number(a.status==='执行中'||a.status==='待处理'))[0];
    const phase=currentTask?.dispatch?.phase;
    const ended=currentTask?.status==='已完成'||currentTask?.status==='已取消';
    const waiting=phase==='waiting'||phase==='scheduled';
    const active=currentTask&&!ended&&!waiting?currentTreeIndex(currentTask)??null:null;
    return {source:'task' as const,zone,name:currentTask?.robot??`${parks[site].treePrefix}-模拟机器人-${'ABCD'[zone]}`,
      status:phase?phaseLabels[phase]:currentTask?.status??'暂无模拟任务',currentTask,
      state:{active,queue:currentTask&&!ended?(currentTask.treeIndices??[]).slice(processedCount(currentTask)+(active===null?0:1)):[],completed:currentTask?.done??0}};
  });
  if(site!=='hainan')return taskViews;
  const liveViews:RobotView[]=Array.from({length: 4}, (_, zone) => {
    const state = fleet.ready ? fleet.zones.find(value => value.zone === zone) : undefined;
    return {
      source:'fleet',zone, name: `R-${'ABCD'[zone]}`, state,
      status: state ? robotStatus(state, fleet, now) : fleet.error ? '模拟机群加载失败' : '模拟机群尚未加载',
      currentTask: state?.active !== null && state?.active !== undefined
        ? fleetTask(state.active, fleet.jobs[state.active], tasks) : undefined,
    };
  });
  return liveViews.map(robot=>{
    const demo=taskViews[robot.zone];
    const history=tasks.filter(task=>task.site===site&&task.kind==='割胶'&&
      (task.treeIndices?.length ? task.treeIndices.some(index=>Math.floor(index/50)===robot.zone) : task.block==='ABCD'[robot.zone]))
      .sort((a,b)=>(b.date??'').localeCompare(a.date??''));
    const ongoing=demo.currentTask&&!['已完成','已取消'].includes(demo.currentTask.status);
    // One identity per zone. Live rail work (including photography) takes priority.
    // Completed task snapshots belong to history, never a second device.
    if(ongoing&&robot.state?.active==null&&!robot.state?.queue.length&&!fleet.error){
      return {...demo,name:robot.name,history};
    }
    return {...robot,history};
  });
}
