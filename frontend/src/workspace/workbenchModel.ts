import {parks, regions} from '../../../shared/parkCatalog.ts';
import type {Site, Task} from './model';

export const roleViews = {
  manager: {label:'农场管理', title:'今日生产与经营', focus:'生产进度、库存销售与待办安排。', primary:'decisions'},
  grower: {label:'胶农', title:'我的地块', focus:'先看胶价，再看承包树状态、产胶与收益。', primary:'home'},
  operator: {label:'机器人运营', title:'今日设备与任务', focus:'设备状态、执行进度与异常处理。', primary:'robots'},
  executive: {label:'中心管理', title:'跨园区运营概览', focus:'比较各园区进度，跟进经营与重点问题。', primary:'overview'},
} as const;
export type RoleView = keyof typeof roleViews;
export function parseRoleView(value:string|null):RoleView {
  return value && Object.prototype.hasOwnProperty.call(roleViews,value) ? value as RoleView : 'manager';
}
export const siteHierarchy = Object.fromEntries(Object.values(parks).map(park=>[park.key,{
  center:park.regionId?'生产中心':'试验中心',
  region:park.regionId?regions[park.regionId].name:'陕西 · 西安',
  park:park.name,
  note:park.regionId?'模拟园区 · A–D 四个分区 · 200 棵独立树档案':'联调样本 · 不计入生产产量',
}])) as Record<Site,{center:string;region:string;park:string;note:string}>;
export function treePosition(treeId:string):number|null {
  const match=/^T-(\d{4})$/.exec(treeId);
  if(!match)return null;
  const index=Number(match[1])-1;
  return index>=0&&index<200?index:null;
}
export function treeZone(treeId:string):string|null {
  const index=treePosition(treeId);
  return index===null?null:'ABCD'[Math.floor(index/50)];
}
export function scopedTasks(tasks:Task[],scope:'all'|Site,zone:string|null=null):Task[] {
  return tasks.filter(t=>(scope==='all'||t.site===scope)&&(!zone||t.block===zone));
}
