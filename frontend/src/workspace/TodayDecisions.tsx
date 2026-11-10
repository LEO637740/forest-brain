import {ArrowRight} from 'lucide-react';
import {siteIdOf, useRead} from '../integration/client';
import type {Site} from './model';
import type {DemoAccount} from './identityModel';
import {StrategyRefreshStatus} from '../integration/StrategyRefreshStatus';
import {GrowerFocus} from './GrowerFocus';

export type BriefAction =
  | {type:'park_plan';planId?:string;label:string}
  | {type:'price_factors';scenarioId:string;label:string}
  | {type:'cerebellum'|'events'|'robots'|'collection'|'plot';label:string}
  | {type:'task';taskId:string;label:string}
  | {type:'plot_tree';treeId:string;label:string}
  | {type:'assistant';message:string;label:string};
export type BriefItem = {id:string;priority:'high'|'medium'|'info';title:string;conclusion:string;reason:string;sourceRefs:string[];action:BriefAction};
export type PlotSummary = {label:string;zone:string;treeCount:number;treeIds:string[];care:{treeId:string;reasons:string[]}[];
  completedTaps:number;estimatedLatexKg:number;estimatedIncomeCny:number|null;basis:string;
  collectionPoints:{id:string;name:string;distanceKm:number;latexPrice:number}[]};
export type WorkspaceBrief = {siteId:string;park:string;role:string;generatedAt:string;items:BriefItem[];plot?:PlotSummary};

export const priorityLabels = {high:'先处理', medium:'待安排', info:'参考'} as const;
export function briefPath(site:Site) { return `/api/workspace/brief?siteId=${siteIdOf(site)}`; }

type Props = {account:DemoAccount;site:Site;onAction:(action:BriefAction)=>void;onTree:(index:number)=>void};

/** The brain's short list of decisions for the signed-in role, each with its reason and one action. */
export function TodayDecisions({account,site,onAction,onTree}:Props) {
  const brief = useRead<WorkspaceBrief>(briefPath(site), {pollMs:30000});
  const growerPlot = account.role === 'grower' ? brief.data?.plot : undefined;
  const decisions = brief.data?.items.filter(item => !(growerPlot && ['plot-care','plot-income'].includes(item.id)) && (item.priority === 'high' || item.action.type !== 'cerebellum')) ?? [];
  const improvements = brief.data?.items.filter(item => item.priority !== 'high' && item.action.type === 'cerebellum') ?? [];
  const renderItem = (item:BriefItem) => <article key={item.id} className={`td-item td-${item.priority}`}>
    <small>{priorityLabels[item.priority]}</small>
    <h3>{item.title}</h3>
    <p>{item.conclusion}</p>
    {item.reason && <details className="td-reason"><summary>查看依据</summary><p>{item.reason}</p></details>}
    <button type="button" onClick={() => onAction(item.action)}>{item.action.type === 'park_plan' && item.action.planId ? '查看本周方案' : item.action.label}<ArrowRight size={14}/></button>
  </article>;
  return <section className="td-panel" aria-labelledby="td-title">
    <header><h2 id="td-title">{account.role === 'grower' ? '今天我的地块' : account.role === 'operator' ? '作业提醒' : account.role === 'executive' ? '本园区经营与审批' : '今天需要你决定的事'}</h2>
      <span>{brief.data ? `${brief.data.park} · ${account.role==='grower'?'地块为模拟数据':'模拟数据'}` : '正在整理…'}</span></header>
    {brief.error && <p role="alert">暂时无法整理今日事项：{brief.error} <button className="rb-button" onClick={brief.reload}>重试</button></p>}
    {growerPlot && <GrowerFocus plot={growerPlot} account={account} site={site} onCollection={() => onAction({type:'collection',label:'比较收胶点报价'})} onTree={onTree}/>}
    {brief.data && <div className="td-list">{decisions.map(renderItem)}</div>}
    {(account.role==='manager'||account.role==='executive')&&<details className="td-followup"><summary>策略更新状态</summary><StrategyRefreshStatus site={site}/></details>}
    {improvements.length > 0 && <details className="td-followup"><summary>规则改进 · {improvements.length} 项</summary><div className="td-list">{improvements.map(renderItem)}</div></details>}
  </section>;
}
