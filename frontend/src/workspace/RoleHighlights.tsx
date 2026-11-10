import {useSyncExternalStore} from 'react';
import {ArrowRight, Bot} from 'lucide-react';
import {useRead, siteIdOf} from '../integration/client';
import {getFleetSnapshot, subscribeFleet} from '../zoneFleet';
import type {SalesInventory} from '../../../shared/salesShipments';
import {accountSites, type DemoAccount} from './identityModel';
import {sites, type Page, type Site, type Task} from './model';
import {eventHoldForZone, type OperationalEvent} from './operationalEvents';
import {robotViews, type RobotTarget} from './robotCenterModel';
import {scopedTasks, siteHierarchy, type RoleView} from './workbenchModel';
import './roleHighlights.css';

type Props = {
  role:RoleView; scope:Site|'all'; tasks:Task[]; events:OperationalEvent[]; synced:boolean; account?:DemoAccount;
  onNavigate:(page:Page,scope?:Site|'all')=>void;
  onData:(tab:'analytics'|'collection'|'business')=>void;
  onRobot?:(site:Site,robot:RobotTarget)=>void;
};
const number = (value:number) => value.toLocaleString('zh-CN',{maximumFractionDigits:2});

function ManagerStock({site,onData}:{site:Site;onData:Props['onData']}) {
  const inventory = useRead<{inventory:SalesInventory}>(`/api/simulation/sales-inventory?siteId=${siteIdOf(site)}`);
  const stock = inventory.data?.inventory;
  return <section className="rh-section" aria-label="库存与销售重点">
    <header><div><h2>库存与销售</h2><p>本园业务台账 · 演示数据</p></div><button className="rb-button" onClick={()=>onData('business')}>查看流转台账 <ArrowRight size={14}/></button></header>
    <div className="rh-metrics">{([
      ['可售库存',stock?.availableKg,'公斤干胶'],['在库总量',stock?.stockKg,'公斤干胶'],
      ['销售在途',stock?.inTransitKg,'公斤干胶'],['累计销售额',stock?.salesRevenueCny,'元'],
    ] as const).map(([label,value,unit])=><button key={label} onClick={()=>onData('business')}><span>{label}</span><strong>{value===undefined?'—':number(value)}<small>{unit}</small></strong></button>)}</div>
    {inventory.error&&<p role="status">库存暂未读取，<button className="ws-link" onClick={inventory.reload}>重新读取</button></p>}
  </section>;
}

function OperatorFleet({site,tasks,events,synced,onNavigate,onRobot}:Omit<Props,'scope'|'role'|'onData'> & {site:Site}) {
  const fleet = useSyncExternalStore(subscribeFleet,getFleetSnapshot);
  const robots = robotViews(site,fleet,tasks);
  return <section className="rh-section" aria-label="设备状态重点">
    <header><div><h2>我的设备</h2><p>{sites[site]} · 模拟设备与作业状态</p></div><button className="rb-button" onClick={()=>onNavigate('robots')}>进入设备管理 <ArrowRight size={14}/></button></header>
    <div className="rh-robots">{robots.map(robot=>{
      const hold=eventHoldForZone(site,robot.zone,events);
      return <button key={robot.zone} className={hold?'rh-attention':''} onClick={()=>onRobot?onRobot(site,{source:robot.source,zone:robot.zone}):onNavigate('robots')}>
        <span><Bot size={19}/><strong>{robot.name}</strong><small>{'ABCD'[robot.zone]}区</small></span>
        <b>{synced?(hold||robot.status):'正在读取设备作业…'}</b>
        <small>{synced&&robot.currentTask?`${robot.currentTask.title} · ${robot.currentTask.done}/${robot.currentTask.count} 棵`:'查看设备与任务 →'}</small>
      </button>;
    })}</div>
  </section>;
}

export function RoleHighlights(props:Props) {
  const {role,scope,tasks,events,synced,account,onNavigate,onData}=props;
  if(role==='manager'&&scope!=='all'&&scope!=='xian')return <ManagerStock key={scope} site={scope} onData={onData}/>;
  if(role==='operator'&&scope!=='all')return <OperatorFleet {...props} site={scope}/>;
  if(role!=='executive')return null;
  const allowed=account?accountSites(account):Object.keys(siteHierarchy) as Site[];
  const visible=scope==='all'?allowed:allowed.filter(site=>site===scope);
  const relevant=scopedTasks(tasks,scope).filter(task=>visible.includes(task.site));
  const unresolved=events.filter(event=>event.status!=='closed'&&visible.some(site=>event.siteId===siteIdOf(site)));
  return <section className="rh-section" aria-label="中心运营重点">
    <header><div><h2>{scope==='all'?'各园区经营与执行':'所选园区经营与执行'}</h2><p>当前任务与异常记录 · 园区对照见下方</p></div><button className="rb-button" onClick={()=>onNavigate('overview',scope)}>查看园区地图 <ArrowRight size={14}/></button></header>
    <div className="rh-metrics">{[
      {label:'可见园区',value:visible.length,unit:'个'},
      {label:'执行中任务',value:synced?relevant.filter(task=>task.status==='执行中').length:'—',unit:'项'},
      {label:'待处理任务',value:synced?relevant.filter(task=>task.status==='待处理').length:'—',unit:'项'},
      {label:'未关闭异常',value:synced?unresolved.length:'—',unit:'项'},
    ].map(item=><div key={item.label}><span>{item.label}</span><strong>{item.value}<small>{item.unit}</small></strong></div>)}</div>
  </section>;
}
