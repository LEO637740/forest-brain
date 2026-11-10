import {parks, type Site} from '../../../shared/parkCatalog.ts';
import {pages, type Page} from './model.ts';
import {treePosition,type RoleView} from './workbenchModel.ts';

export type DemoAccount = {
  accountId:string;name:string;title:string;role:RoleView;roleLabel:string;siteIds:string[];summary:string;permissions:string[];
  plot?:{siteId:string;zone:string;label:string;areaMu:number;treeCount:number;treeIds:string[]};
};
export type SignedIn = {token:string;expiresAt:string;account:DemoAccount};
export const IDENTITY_STORAGE_KEY = 'rubber-identity-v1';
/** The signed-in account for components that only need to know what the user may do. */
export function currentAccount():DemoAccount|null {
  try { return parseSignedIn(localStorage.getItem(IDENTITY_STORAGE_KEY))?.account ?? null; } catch { return null; }
}

export const roleOrder:RoleView[] = ['grower','manager','operator','executive'];
export const roleIntro:Record<RoleView,{title:string;text:string}> = {
  grower:{title:'胶农',text:'先看胶价和承包树状态，再看地块产胶、收益估算和养护安排。'},
  manager:{title:'农场管理',text:'先看全园生产进度和待办，再安排割胶、收胶储运与库存销售。'},
  operator:{title:'机器人运营',text:'先看设备状态、执行队列和异常，再处理派发、暂停与恢复。'},
  executive:{title:'中心管理',text:'先看跨园区运营和重点问题，再查看经营分析、参数与经验审批。'},
};
const siteBySiteId = Object.fromEntries(Object.values(parks).map(park => [park.siteId, park.key])) as Record<string,Site>;

/** Park keys the account may open, in catalogue order. */
export function accountSites(account:DemoAccount):Site[] {
  return account.siteIds.map(siteId => siteBySiteId[siteId]).filter(Boolean);
}
export function canUseSite(account:DemoAccount, site:Site|'all'):boolean {
  return site === 'all' ? account.role === 'executive' : accountSites(account).includes(site);
}
export function can(account:DemoAccount, permission:string):boolean { return account.permissions.includes(permission); }

/** Keep scene positions stable when the server returns only the grower's plot. */
export function accountTreeIndices(account:DemoAccount|undefined, site:Site):number[] {
  if(account&&!canUseSite(account,site))return [];
  if(account?.plot)return account.plot.siteId===parks[site].siteId
    ? account.plot.treeIds.map(treePosition).filter((index):index is number=>index!==null) : [];
  return Array.from({length:200},(_,index)=>index);
}

/** Pages each role works in; a grower stays on the plot, tasks and collection prices. */
export function rolePages(role:RoleView):Page[] {
  if (role === 'grower') return ['workbench','analytics','home','operations'];
  if (role === 'operator') return ['workbench','robots','operations','home','decisions','overview'];
  if (role === 'executive') return ['workbench','overview','analytics','decisions','operations','robots','home','brain'];
  return ['workbench','decisions','operations','analytics','overview','robots','home','brain'];
}
const roleLabels:Record<RoleView,Partial<Record<Page,string>>> = {
  grower:{workbench:'我的地块',analytics:'胶价与收益',home:'承包地树木',operations:'我的作业'},
  manager:{workbench:'生产经营',decisions:'生产与销售',operations:'作业与储运',analytics:'生产经营数据'},
  operator:{workbench:'设备与任务',robots:'设备状态',operations:'执行队列',home:'作业现场',decisions:'作业方案'},
  executive:{workbench:'跨园概览',analytics:'经营分析',decisions:'经营与生产策略'},
};
export function rolePageLabel(role:RoleView,page:Page):string {
  return roleLabels[role][page] ?? pages[page];
}
export function workbenchLabel(role:RoleView):string {
  return rolePageLabel(role,'workbench');
}

export function parseSignedIn(raw:string|null, now = Date.now()):SignedIn|null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || typeof value.token !== 'string' || !value.account?.accountId || !Array.isArray(value.account.siteIds)) return null;
    return Date.parse(value.expiresAt) > now ? value as SignedIn : null;
  } catch { return null; }
}
