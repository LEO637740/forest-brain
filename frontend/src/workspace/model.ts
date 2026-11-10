import {treeDisplayLabel,resolveTreeIdentity} from '../../../shared/treeIdentity.ts';
import type { Dispatch } from './taskFlow';
import type {DemoTaskStrategy,DemoTaskReceipt} from '../../../shared/demoTaskChain.ts';
import type {FleetJob,FleetResult} from '../zoneFleet';
import {parks, type Site} from '../../../shared/parkCatalog.ts';
export type {Site} from '../../../shared/parkCatalog.ts';
export {sites} from '../../../shared/parkCatalog.ts';
export type Page = 'workbench' | 'home' | 'operations' | 'analytics' | 'overview' | 'decisions' | 'robots' | 'brain';
export type Story = 'angle' | 'surface' | 'growth' | 'weather' | 'market' | 'health';
export type TaskStatus = '待开始' | '执行中' | '已完成' | '待处理' | '已取消';
export type RailDispatchCheck = {time:string; outcome:'blocked'|'passed'; message:string};
export type SurfaceReceipt = { outcome:'已完成处理'|'需再次处理'; note:string; time:string };
export type Task = { railDispatchChecks?:RailDispatchCheck[];demoStrategy?:DemoTaskStrategy;demoReceipts?:DemoTaskReceipt[];revision?:number;autoPlanned?:boolean;sourceScenarioId?:string;sourceParkPlanId?:string; date?:string; id:string; site:Site; title:string; block:string; robot:string; start:string; end:string; count:number; done:number; status:TaskStatus; kind:string; treeIndices?:number[]; story?:Story; decisionKey?:string; surfacePlan?:{mark:string;action:string}; receipt?:SurfaceReceipt; dispatch?:Dispatch; railJob?:FleetJob; railResult?:FleetResult; railBatch?:{jobs:Record<number,FleetJob>;results:Record<number,FleetResult>;baseDone:number} };
export function receiveSurfaceTask(task:Task, receipt:SurfaceReceipt):Task {
 if(task.story!=='surface'||!['执行中','待处理'].includes(task.status))throw new Error('请先启动处理任务，已完成任务不能重复回传');
 if(!receipt.note.trim())throw new Error('请填写现场结果或未完成原因');
 if(!['已完成处理','需再次处理'].includes(receipt.outcome))throw new Error('请选择处理结果');
 return {...task,receipt:{...receipt,note:receipt.note.trim()},status:receipt.outcome==='已完成处理'?'已完成':'待处理',done:receipt.outcome==='已完成处理'?task.count:task.done};
}
export const pages: Record<Page,string> = {workbench:'决策工作台',overview:'园区地图',analytics:'数据中心',decisions:'策略中心',home:'胶园空间',operations:'任务中心',robots:'机器人管理',brain:'大脑管理'};
export const stories: Record<Story,{title:string;summary:string;action:string}> = {
 angle:{title:'单树割线方案',summary:'结合近期观测与历史割面，提前准备下次作业方案。',action:'确认纳入计划'},
 surface:{title:'树表检查与路径处理',summary:'检查回传照片中的标记，再选择处理方式。',action:'确认处理安排'},
 growth:{title:'生长预测与割面规划',summary:'沿时间查看预测与割面安排，不触发即时割胶。',action:'保存未来规划'},
 weather:{title:'天气与作业安排',summary:'C区原定06:00作业，建议调整至08:00；其他作业不变。',action:'确认调整'},
 market:{title:'市场与生产情景',summary:'比较割次与养护安排，再将选定情景纳入计划。',action:'保存计划情景'},
 health:{title:'林区巡查与健康跟踪',summary:'B区有叶片变化记录，请安排巡查核实。',action:'安排巡查'}
};
export const initialTasks:Task[] = ([
 ['HN-01','hainan','B区晨间割胶','B','Robot 01','06:00','07:30',36,18,'执行中','割胶'],
 ['HN-02','hainan','A区常规割胶','A','Robot 02','06:30','08:00',30,12,'执行中','割胶'],
 ['HN-03','hainan','C区上午割胶','C','Robot 01','06:00','07:30',28,0,'待处理','割胶'],
 ['HN-04','hainan','D区常规割胶','D','Robot 02','09:00','10:30',32,0,'待开始','割胶'],
 ['HN-05','hainan','A区清晨巡检','A','巡检员 林','05:00','05:45',20,20,'已完成','巡检'],
 ['XS-01','xsbn','山地作业带巡查','A','巡检员 周','08:00','10:00',24,0,'待开始','巡检'],
 ['XS-02','xsbn','谷地割胶计划','B','Robot 03','06:00','08:00',32,16,'执行中','割胶'],
 ['XA-01','xian','割胶头轨迹联调','测试区','测试台 01','09:00','10:00',8,0,'待开始','联调']
] as const).map(([id,site,title,block,robot,start,end,count,done,status,kind])=>({id,site,title,block,robot,start,end,count,done,status,kind}));
// Stable UI-only adapter over the unchanged scene's 4 × 50 ordered positions.
// The previous scene has no stored business IDs; these mock aliases do not alter its records.
export function treeAlias(index:number,site:Site='hainan') { return treeDisplayLabel(index,site); }
export function parseTreeAlias(value:string,site:Site='hainan') { return resolveTreeIdentity(site,value)?.index??null; }
export function taskTreeIndices(task:Task) {if(task.treeIndices)return task.treeIndices;const offset=Math.max(0,'ABCD'.indexOf(task.block))*50;return Array.from({length:task.count},(_,i)=>offset+i);}
export type Activity = {id:string;site:Site;time:string;title:string;detail:string;contextKey?:string};
export function timeLabel(){return new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
