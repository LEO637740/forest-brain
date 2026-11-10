import {demoRobotMotions} from './demoRobotMotion';


import {parks, productionRegions, productionSites, regions} from '../../../shared/parkCatalog.ts';
import type {LatexBatch} from '../../../shared/logistics.ts';
import type {SalesInventory,SalesShipment} from '../../../shared/salesShipments';
import {eventHoldForTask,eventHoldForZone,type OperationalEvent} from './operationalEvents';
import {CurrentClock} from '../integration/CurrentClock';
import {verifyDispatch,verifyFleetJob,post,read,refreshWeather,weatherTiming,siteWeatherBlock,siteIdOf,useRead,type Park} from '../integration/client';
import {SCENE_PLANTED_MU,type TreeProfile as SceneTreeProfile} from '../sceneTreeLayout';
import {TreeProfile,TreeDecision} from '../integration/Views';
import {ReviewDesk} from '../integration/ReviewDesk';
import {useRobotObservation} from '../observation/robotObservation';
import type {TreeKind} from '../integration/modelGenerationFlow';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { Brain, LogOut, Leaf, Search, Bell, UserRound, Layers3, LayoutDashboard, ListChecks, ChartNoAxesCombined, FlaskConical, ChevronRight, ArrowLeft, X, CloudRain, Bot, Droplets, Check, AlertTriangle, Image as ImageIcon, Download, ChevronDown, Clock, Maximize2, Play, PanelLeftClose, PanelRightClose } from 'lucide-react';
const DigitalTwinScene = lazy(()=>import('../DigitalTwinScene').then(module=>({default:module.DigitalTwinScene})));
import { RailPreviewEntry } from './RailPreviewEntry';
import { RailRowEntry,RailRowResult } from './RailRowEntry';
import { segmentForTree } from '../railSegments';
import { RailPreviewResult } from './RailPreviewResult';
import { OperationsPage, type TaskOpenRequest, type ShipmentOpenRequest, type BatchOpenRequest } from './OperationsPage';
import { RobotCenter } from './RobotCenter';
import type {RobotTarget} from './robotCenterModel';
import { DataCenter, type DataTab, type PublicReferenceTab } from './DataCenter';
import type {AnalyticsTopic} from './AnalyticsPage';
import {BrainManagement} from './BrainManagement';
import { DecisionWorkbench } from './DecisionWorkbench';
import {parseRoleView,roleViews,type RoleView} from './workbenchModel';
import {accountSites,accountTreeIndices,can,canUseSite,rolePages,rolePageLabel,type DemoAccount} from './identityModel';
import {FieldPlan} from './FieldPlan';
import { Modal } from './Modal';
import { TaskFlow, TaskMonitor } from './TaskArrange';
import { advanceDemo, currentTreeIndex } from './taskFlow';
import {taskExecutionBlock,taskExecutionWindow,mergeExecutionWindow} from './taskExecutionWindow';
import { SurfaceIncidentView } from './SurfaceIncidentView';
import { TreeWorkSummary, TreeWorkHistory } from './TreeWorkSummary';
import { InspectionPhoto } from './InspectionPhoto';
import { sites, pages, stories, initialTasks, treeAlias, parseTreeAlias, timeLabel, type Site, type Page, type Story, type Task, type Activity } from './model';
import './workspace.css';
import {ZoneTreeDispatch,ZoneBatchDispatch} from './ZoneFleetControls';
import {dispatchFleetJobs,setFleetEventHolds,setFleetObservationWeatherOverride,getFleetSnapshot,subscribeFleet,patchFleetJob,resetFleet,setFleetValidator,retireFleetJob,fleetBlockReason,fleetZoneHoldReason,type FleetResult} from '../zoneFleet';
import {jobForTree,syncRailTask,finishRailTask,recoverTasks} from './railTaskBridge';
import {Overview} from './restructure/Overview';
import {StrategyCenter,type StrategyTab} from './restructure/StrategyCenter';
import {getTreeYieldSeries} from './analyticsData';

import {fleetJobsToRetire,type TaskWriteResult} from './taskSync';
import {TaskSyncController,initialTaskSyncState,parseTaskSyncJournal,type TaskSyncState} from './taskSyncController';
import {TaskSyncStatus} from './TaskSyncStatus';
import {RailDispatchController,findDueRailTask} from './railDispatchController';
import {useWeatherSample} from './restructure/useWeatherSample';
import './restructure/workbench.css';
import './engineeringTheme.css';


const storyIcons={angle:FlaskConical,surface:ImageIcon,growth:Leaf,weather:CloudRain,market:ChartNoAxesCombined,health:AlertTriangle};
const pageIcons={workbench:LayoutDashboard,overview:ChartNoAxesCombined,decisions:FlaskConical,home:Layers3,operations:ListChecks,robots:Bot,analytics:ChartNoAxesCombined,brain:Brain};
type Saved={tasks:Task[];activities:Activity[];decisions:Record<string,string>};
const baseStorageKey='rubber-brain-demo-workspace-v1';
const baseSyncJournalKey='rubber-brain-task-sync-v1';
// Read-only accounts start from the server's records instead of the local demo seed.
function getSaved(storageKey=baseStorageKey,readOnly=false,sites?:Site[]):Saved{if(readOnly)return {tasks:[],activities:[],decisions:{}};const own=(tasks:Task[])=>sites?tasks.filter(task=>sites.includes(task.site)):tasks;try{const v=JSON.parse(localStorage.getItem(storageKey)||'null');if(v && Array.isArray(v.tasks)&&v.tasks.every((t:Task)=>typeof t.id==='string'&&typeof t.count==='number')&&Array.isArray(v.activities))return {...v,tasks:own(recoverTasks(v.tasks)),decisions:v.decisions||{}};}catch{}return {tasks:own(recoverTasks(initialTasks)),activities:[],decisions:{}};}
function selectedPage():Page{const value=location.hash.slice(1).split('?')[0];return Object.prototype.hasOwnProperty.call(pages,value)?value as Page:'workbench';}
function Disclosure({title,children,defaultOpen=false}:{title:string;children:ReactNode;defaultOpen?:boolean}){return <details className="ws-disclosure" open={defaultOpen || undefined}><summary>{title}<ChevronDown size={15}/></summary><div>{children}</div></details>;}
function Definition({items}:{items:[string,ReactNode][]}){return <dl className="ws-facts">{items.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;}
function Pill({children}:{children:ReactNode}){return <span className="ws-pill">{children}</span>;}
const treePhoto='/assets/ui/tree-inspection.png';

const treeProfiles=(park:Park|undefined):SceneTreeProfile[]|undefined=>{
 if(!park)return undefined;
 const byId=new Map(park.trees.map(tree=>[tree.treeId,tree]));
 return Array.from({length:200},(_,index)=>byId.get(`T-${String(index+1).padStart(4,'0')}`));
};
export function WorkspaceApp({account,onLogout}:{account?:DemoAccount;onLogout?:()=>void}={}){
 const [assistantContext,setAssistantContext]=useState<{site:Site;index:number;request:number}|null>(null);
 const [page,setPage]=useState<Page>(()=>{const next=selectedPage();return account&&!rolePages(account.role).includes(next)?'workbench':next;});
 // A signed-in account fixes the role and the parks; without one the legacy demo switcher remains.
 const homeSite:Site=account?accountSites(account)[0]??'hainan':'hainan';
 const allowedSite=(next:'all'|Site)=>!account||canUseSite(account,next);
 // Browser-side records are kept per account so one person's local state never appears in another's session.
 const storageKey=account?`${baseStorageKey}:${account.accountId}`:baseStorageKey;
 const syncJournalKey=account?`${baseSyncJournalKey}:${account.accountId}`:baseSyncJournalKey;
 const readOnlyTasks=Boolean(account&&!can(account,'tasks.write'));
 const bodyRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{bodyRef.current?.scrollTo({top:0,left:0});},[page]);
 const [role,setRole]=useState<RoleView>(()=>{if(account)return account.role;try{return parseRoleView(localStorage.getItem('rubber-role-view'));}catch{return 'manager';}});
 useEffect(()=>{try{localStorage.setItem('rubber-role-view',role);}catch{}},[role]);
 const [folds,setFolds]=useState<{left:boolean;right:boolean}>(()=>{try{return JSON.parse(localStorage.getItem('rubber-field-panels-v2')||'null')||{left:false,right:true};}catch{return {left:false,right:true};}});
 useEffect(()=>{try{localStorage.setItem('rubber-panel-folds',JSON.stringify(folds));}catch{}},[folds]);
 const [arranging,setArranging]=useState(false),[targets,setTargets]=useState<number[]>([]);
 const [selectionMode,setSelectionMode]=useState<'point'|'box'>('point');
 const [selecting,setSelecting]=useState(true);
 const [monitorId,setMonitorId]=useState<string|null>(null);
 const [incidentTaskId,setIncidentTaskId]=useState<string|null>(null);
 const startArrange=(index?:number)=>{if(fleetEnabled&&index!==undefined){queueTrees([index]);return;}setSelecting(index===undefined);setTargets(index===undefined?[]:[index]);setSelectionMode('point');setMonitorId(null);setTree(null);setContextOpen(false);setArranging(true);navigate('home');};
 const dispatchControllerRef=useRef<RailDispatchController|null>(null);
 const [site,setSiteState]=useState<Site>(homeSite);
 const visibleTreeIndices=accountTreeIndices(account,site);
 const ownsTree=(index:number)=>visibleTreeIndices.includes(index);
 const treeReadOnly=Boolean(account&&!can(account,'strategy.adopt'));
 const siteRef=useRef<Site>(homeSite);
 const setSite=useCallback((next:Site)=>{
  if(!allowedSite(next))return;
  if(siteRef.current!==next)dispatchControllerRef.current?.cancelPending();
  siteRef.current=next;setSiteState(next);
 },[]);
 const [saved,setSavedState]=useState<Saved>(()=>getSaved(storageKey,readOnlyTasks,account?accountSites(account):undefined));
 // Scene trees take their recorded height and girth, index-aligned with T-0001…T-0200.
 const hainanPark=useRead<Park>('/api/demo/park?siteId=demo-hainan');
 const sitePark=useRead<Park>(site!=='hainan'?`/api/demo/park?siteId=${siteIdOf(site)}`:null);
 const hainanProfiles=useMemo(()=>treeProfiles(hainanPark.data),[hainanPark.data]);
 const siteProfiles=useMemo(()=>treeProfiles(sitePark.data),[sitePark.data]);
 const [operationalEvents,setOperationalEvents]=useState<OperationalEvent[]>([]);
 const eventsRef=useRef<OperationalEvent[]>([]),businessWriteVersion=useRef(0);
 const [eventViewRequest,setEventViewRequest]=useState(0);
 const [,setWeatherVersion]=useState(0);
 const [demoWeather,setDemoWeatherState]=useState(()=>{try{return sessionStorage.getItem('rubber-demo-weather')==='1';}catch{return false;}});
 const demoWeatherRef=useRef(demoWeather);
 const setDemoWeather=(enabled:boolean)=>{demoWeatherRef.current=enabled;setDemoWeatherState(enabled);setFleetObservationWeatherOverride(enabled);try{sessionStorage.setItem('rubber-demo-weather',enabled?'1':'0');}catch{}};
 useEffect(()=>{setFleetObservationWeatherOverride(demoWeatherRef.current);return()=>setFleetObservationWeatherOverride(false);},[]);
 const executionHold=(task:Task)=>{if(task.kind!=='割胶'||['已完成','已取消'].includes(task.status))return;const fleet=getFleetSnapshot(),zone='ABCD'.indexOf(task.block);return taskExecutionBlock(task)||(demoWeatherRef.current&&task.dispatch&&!task.id.startsWith('rail-')&&!task.railJob&&!task.railBatch&&!task.railResult?undefined:siteWeatherBlock(task.site))||(task.site==='hainan'&&task.dispatch?(!fleet.ready?'正在加载三维机器人':fleet.zones[zone]?.paused?'本区机器人已暂停':fleet.zones[zone]?.active!==null&&fleet.zones[zone]?.active!==undefined||fleet.zones[zone]?.queue.length?'本区机器人正在执行另一项轨道任务':undefined):undefined);};
 const applyOperationalEvents=useCallback((events:OperationalEvent[])=>{
  if(JSON.stringify(eventsRef.current)!==JSON.stringify(events))setOperationalEvents(events);
  eventsRef.current=events;
  const weather=siteWeatherBlock('hainan')||'',eventHolds=[0,1,2,3].map(zone=>eventHoldForZone('hainan',zone,events));
  setFleetEventHolds(eventHolds.map(reason=>reason||weather),eventHolds.map(reason=>!reason&&Boolean(weather)));
 },[]);
 const recordOperationalEvent=async(path:string,input:unknown)=>{
  const event=await post<OperationalEvent>(path,input);
  businessWriteVersion.current++;
  applyOperationalEvents([...eventsRef.current.filter(item=>item.id!==event.id),event]);
 };
 const [logisticsBatches,setLogisticsBatches]=useState<LatexBatch[]>([]);
 const batchesRef=useRef<LatexBatch[]>([]);
 const applyLogisticsBatches=useCallback((batches:LatexBatch[])=>{
  if(JSON.stringify(batchesRef.current)!==JSON.stringify(batches))setLogisticsBatches(batches);
  batchesRef.current=batches;
 },[]);
 const recordLogisticsBatch=async(path:string,input:object)=>{
  const batch=await post<LatexBatch>(path,{...input,requestId:crypto.randomUUID()});
  businessWriteVersion.current++;
  applyLogisticsBatches([batch,...batchesRef.current.filter(item=>item.id!==batch.id)]);
  if(batch.processing)window.dispatchEvent(new Event('harness-sales-shipments-changed'));
 };
 const openOperationalEvents=()=>{setEventViewRequest(value=>value+1);navigate('operations');};
 const [salesShipments,setSalesShipments]=useState<SalesShipment[]>([]);
 const [salesInventory,setSalesInventory]=useState<SalesInventory|null>(null);
 const [shipmentError,setShipmentError]=useState('');
 const [shipmentRevision,setShipmentRevision]=useState(0);
 const [shipmentOpenRequest,setShipmentOpenRequest]=useState<ShipmentOpenRequest|null>(null);
 const [batchOpenRequest,setBatchOpenRequest]=useState<BatchOpenRequest|null>(null);
 useEffect(()=>{
  if(page!=='operations'&&page!=='overview')return;
  let active=true;setShipmentError('');
  const load=()=>Promise.all([
   read<{items:SalesShipment[]}>(`/api/simulation/sales-shipments?siteId=demo-${site}`),
   read<{inventory:SalesInventory}>(`/api/simulation/sales-inventory?siteId=demo-${site}`),
  ]).then(
   ([result,stock])=>{if(active){setShipmentError('');setSalesShipments(result.items);setSalesInventory(stock.inventory);}},
   error=>{if(active)setShipmentError(`出货与库存读取失败：${error.message}`);},
  );
  void load();
  const refresh=()=>{if(!document.hidden)void load();};
  const timer=window.setInterval(refresh,30000);
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',refresh);
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[page,site,shipmentRevision]);
 useEffect(()=>{
  const refresh=()=>setShipmentRevision(value=>value+1);
  window.addEventListener('harness-sales-shipments-changed',refresh);
  return()=>window.removeEventListener('harness-sales-shipments-changed',refresh);
 },[]);
 const advanceSalesShipment=async(id:string)=>{
  const updated=await post<SalesShipment>(`/api/simulation/sales-shipments/${encodeURIComponent(id)}/advance`,{siteId:`demo-${site}`});
  setSalesShipments(current=>current.map(shipment=>shipment.id===updated.id?updated:shipment));
  const result=await read<{inventory:SalesInventory}>(`/api/simulation/sales-inventory?siteId=demo-${site}`);
  setSalesInventory(result.inventory);
 };
 const [hydrated,setHydrated]=useState(false);
 const savedRef=useRef(saved);
 // Receipts and HTTP responses can arrive in one React batch. Update the shared
 // reference immediately so a later response cannot overwrite an unrendered receipt.
 const setSaved=useCallback((action:Saved|((current:Saved)=>Saved))=>{
  const next=typeof action==='function'?action(savedRef.current):action;
  if(next!==savedRef.current){savedRef.current=next;setSavedState(next);}
 },[]);
 const hydratedRef=useRef(false);
 const [syncState,setSyncState]=useState<TaskSyncState>(initialTaskSyncState);
 const [storageError,setStorageError]=useState('');
 const syncControllerRef=useRef<TaskSyncController|null>(null);
 const retrySyncRef=useRef<()=>void>(()=>{});
 const sample=useWeatherSample(saved.tasks);
 const [strategyTab,setStrategyTab]=useState<StrategyTab>('park');
 const [selectedMarketModel,setSelectedMarketModel]=useState<{site:Site;modelId:string}|null>(null);
 const [selectedParkPlan,setSelectedParkPlan]=useState<{site:Site;planId:string}|null>(null);
 const [dataTab,setDataTab]=useState<DataTab>(account?.role==='grower'?'collection':'catalog');
 const [dataReference,setDataReference]=useState<PublicReferenceTab>('market');
 const [dataAnalysis,setDataAnalysis]=useState<AnalyticsTopic>('trend');
 const [scope,setScopeState]=useState<'all'|Site>(()=>account&&account.role!=='executive'?homeSite:selectedPage()==='decisions'?homeSite:'all');
 const setScope=(next:'all'|Site)=>{if(allowedSite(next))setScopeState(next);};
 const overviewScopeRef=useRef<'all'|Site>(account&&account.role!=='executive'?homeSite:'all');
 const widePage=page==='workbench'||page==='overview'||page==='decisions'||page==='analytics'||page==='robots'||page==='brain';
 const multiSitePage=page==='workbench'||page==='overview';
 useEffect(()=>{const visibleScope=multiSitePage?scope:site;document.title=`橡胶大脑｜${rolePageLabel(role,page)}｜${visibleScope==='all'?'全部园区':sites[visibleScope]}`;},[page,multiSitePage,scope,site,role]);
 const [layer,setLayer]=useState(0),[resetKey,setReset]=useState(0);
 const [focusKey,setFocusKey]=useState(0);
 const [focusZone,setFocusZone]=useState<number|null>(null);
 const [reviewTarget,setReviewTarget]=useState<{site:Site;treeId:string;kind:'capture'|'measure'|'inspect';request:number}|null>(null);
 const [selectedTree,setTree]=useState<number|null>(null),[treeTab,setTreeTab]=useState('概览');
 const [treeStrategyKind,setTreeStrategyKind]=useState<TreeKind>('tapping_angle');
  // Only Hainan exposes the production fleet overlay for now. Other sites remain
  // independent simulation/integration scenes until their layouts are rebuilt.
 const fleetEnabled=site==='hainan'&&new URLSearchParams(location.search).get('legacyRail')!=='1';
 const dispatchEnabledRef=useRef(fleetEnabled);
 dispatchEnabledRef.current=fleetEnabled;
 const [fleetBusy,setFleetBusy]=useState(0);
 useEffect(()=>{const update=()=>{const fleet=getFleetSnapshot();const zones=new Set(fleet.zones.filter(z=>z.active!==null&&!z.paused&&!fleetZoneHoldReason(z,fleet.jobs[z.active])&&!fleetBlockReason(fleet.jobs[z.active])).map(z=>z.zone));for(const task of savedRef.current.tasks)if(task.site==='hainan'&&task.dispatch?.auto&&task.dispatch.phase==='running'&&!eventHoldForTask(task,eventsRef.current)&&!executionHold(task))zones.add('ABCD'.indexOf(task.block));setFleetBusy(zones.size);};update();return subscribeFleet(update);},[saved.tasks]);
 const isRailTree=!fleetEnabled&&site==='hainan'&&selectedTree===44&&new URLSearchParams(location.search).get('homeRailPilot')==='1';
 const isRailRowTree=!fleetEnabled&&site==='hainan'&&selectedTree!==null&&selectedTree>=110&&selectedTree<=119&&new URLSearchParams(location.search).get('homeRailPilot')==='1'&&new URLSearchParams(location.search).get('jointRow')!=='0';
 const [selectedTaskId,setSelectedTaskId]=useState('HN-01');
 const [taskOpenRequest,setTaskOpenRequest]=useState<TaskOpenRequest|null>(null);
 const [contextOpen,setContextOpen]=useState(false);
 const triggerRef=useRef<HTMLElement|null>(null),contextRef=useRef<HTMLElement|null>(null);
 const closeContext=()=>{setContextOpen(false);triggerRef.current?.focus();};
 useEffect(()=>{if(contextOpen)contextRef.current?.focus();},[contextOpen]);
 const [story,setStory]=useState<Story>('angle'),[storyTab,setStoryTab]=useState('当前方案');
 const [search,setSearch]=useState(''),[toast,setToast]=useState('');
 const [modal,setModal]=useState<null|'weather'|'confirm'|'notifications'|'profile'|'search'|'reset'>(null);
 const [confirmStory,setConfirmStory]=useState<Story>('angle');
 const [surfaceMark,setSurfaceMark]=useState('结构隆起'),[surfaceAction,setSurfaceAction]=useState('复核局部绕行方案'),[showMarks,setMarks]=useState(true),[photoZoom,setPhotoZoom]=useState(false);
 const [growthYear,setGrowthYear]=useState(2027),[marketPlan,setMarketPlan]=useState('均衡安排');
 const [source,setSource]=useState<{page:Page;tree:number|null}>({page:'home',tree:null});
 const [showTreeList,setShowTreeList]=useState(false),[treeFilter,setTreeFilter]=useState('全部');
 // Every site has a visible spatial scene. Only Hainan enables the live fleet
 // overlay; Xishuangbanna and Xi'an remain honest simulation/integration views.
 const sceneVisible=page==='home'||page==='operations';
 const [sceneLoaded,setSceneLoaded]=useState(sceneVisible&&site==='hainan');
 useEffect(()=>{if(sceneVisible&&site==='hainan')setSceneLoaded(true);},[sceneVisible,site]);
 useEffect(()=>{if((page==='robots'&&site==='hainan')||saved.tasks.some(t=>t.site==='hainan'&&t.dispatch?.auto&&t.status==='执行中'))setSceneLoaded(true);},[page,site,saved.tasks]);
 const [robotFocus,setRobotFocus]=useState<number|null>(null);
 const [robotTarget,setRobotTarget]=useState<RobotTarget|undefined>();
 useEffect(()=>{
  if(robotFocus===null||site!=='hainan'||page!=='home')return;
  const focus=()=>{if(getFleetSnapshot().ready){window.dispatchEvent(new CustomEvent('zone-fleet-focus',{detail:robotFocus}));window.dispatchEvent(new CustomEvent('zone-fleet-follow',{detail:robotFocus}));setRobotFocus(null);}};
  focus();return subscribeFleet(focus);
 },[robotFocus,site,page]);
 const recent=saved.activities.filter(a=>a.site===site);
 const currentTasks=saved.tasks.filter(t=>t.site===site);
 const monitorMatches=currentTasks.filter(t=>t.id===monitorId);
 const monitoredTask=monitorMatches.length===1?monitorMatches[0]:undefined;
 const animatedTask=currentTasks.find(t=>t.id===monitorId&&t.dispatch?.auto)??currentTasks.find(t=>t.dispatch?.auto&&!['completed','cancelled','failed'].includes(t.dispatch.phase));
 useEffect(()=>{
  const timer=window.setInterval(()=>setSaved(s=>{
   if(!hydratedRef.current)return s;
   const tasks=s.tasks.map(t=>advanceDemo(t,Date.now(),Boolean(eventHoldForTask(t,eventsRef.current)||executionHold(t))));
   return tasks.some((t,i)=>t!==s.tasks[i])?{...s,tasks}:s;
  }),500);
  return()=>window.clearInterval(timer);
 },[]);
 const attentionTask=currentTasks.find(t=>t.decisionKey===`${site}:surface:${treeAlias(85,site)}`);
 const treeId=treeAlias(selectedTree??85,site);
 const decisionKey=`${site}:${story}:${story==='angle'||story==='growth'||story==='surface'?treeId:'all'}`;
 const decision=saved.decisions[decisionKey];
 const related=recent.filter(a=>a.contextKey===decisionKey);
 const linkedTask=currentTasks.find(t=>t.decisionKey===decisionKey);
 const treeTasks=currentTasks.filter(t=>t.treeIndices?.includes(selectedTree??-1));
 const blockedTasks=currentTasks.filter(t=>['review','recapturing'].includes(t.dispatch?.phase??''));
 const resumeTask=blockedTasks[0]??currentTasks.find(t=>t.dispatch&&!['completed','cancelled'].includes(t.dispatch.phase))??currentTasks.find(t=>t.dispatch);
 // Navigation reads the latest snapshot; an old link must never rewrite or
 // resume a task, or select a different task after its target disappears.
 const resolveTask=(task:Task)=>{
  const matches=savedRef.current.tasks.filter(t=>t.site===task.site&&t.id===task.id);
  if(matches.length!==1){notify(matches.length?'关联任务编号重复，请核对任务记录。':'关联任务已不在当前记录中，请刷新后核对。');return null;}
  return matches[0];
 };
 const openTask=(task:Task)=>{
  const current=resolveTask(task);if(!current)return;
  chooseSite(current.site);setScope(current.site);setSelectedTaskId(current.id);
  setTaskOpenRequest(previous=>({id:current.id,site:current.site,sequence:(previous?.sequence??0)+1}));
  navigate('operations');
 };
 const openStrategyTasks=async(taskId?:string)=>{
  if(!taskId){navigate('operations');return;}
  const targetSite=site;
  await syncControllerRef.current?.refresh(true);
  const matches=savedRef.current.tasks.filter(task=>task.site===targetSite&&task.id===taskId);
  if(matches.length!==1)throw Error('关联任务尚未同步，请重试查看执行与回传。');
  openTask(matches[0]);
 };
 const openParkPlan=(target:Site,planId?:string)=>{
  chooseSite(target);setScope(target);setSelectedParkPlan(planId?{site:target,planId}:null);setStrategyTab('park');navigate('decisions');
 };
 useEffect(()=>{
  const open=(event:Event)=>{const detail=(event as CustomEvent).detail;openParkPlan(detail?.site??site,detail?.planId);};
  window.addEventListener('harness-open-park-plan',open);
  return()=>window.removeEventListener('harness-open-park-plan',open);
 });

 const openDemoStrategy=(task:Task)=>{
  if(task.sourceParkPlanId){openParkPlan(task.site,task.sourceParkPlanId);return;}
  if(task.sourceScenarioId){openMarketModel(task.site,task.sourceScenarioId);return;}
  openTask(task);
 };
 const openFlow=(task:Task)=>{
  const current=resolveTask(task);if(!current)return;
  if(current.kind!=='割胶'){notify('此任务没有割胶机器人定位。');return;}
  chooseSite(current.site);setScope(current.site);setSelectedTaskId(current.id);
  navigate('home');setTree(null);setMonitorId(current.dispatch?current.id:null);setRobotFocus(current.site==='hainan'?'ABCD'.indexOf(current.block):null);if(current.site!=='hainan')setFocusZone('ABCD'.indexOf(current.block));
 };
 const notify=(message:string)=>setToast(message);
 useRobotObservation(notify);

 const queueTrees=(indices:number[])=>dispatchControllerRef.current?.queueTrees(indices);
 const startRailBatch=(task:Task)=>dispatchControllerRef.current?.startBatch(task.id);
 const retryRailTask=(task:Task)=>dispatchControllerRef.current?.retry(task.id);
 useEffect(()=>{
  const controller=new RailDispatchController({
   getState:()=>savedRef.current,
   updateTasks:update=>setSaved(current=>{
    const tasks=update(current.tasks);return tasks===current.tasks?current:{...current,tasks};
   }),
   getFleet:getFleetSnapshot,verify:verifyDispatch,makeJob:jobForTree,dispatch:dispatchFleetJobs,
   isEnabled:()=>siteRef.current==='hainan'&&dispatchEnabledRef.current&&hydratedRef.current,
   notify,
  });
  dispatchControllerRef.current=controller;
  const unsubscribe=subscribeFleet(()=>{if(!getFleetSnapshot().ready)controller.cancelPending();});
  return()=>{controller.dispose();unsubscribe();dispatchControllerRef.current=null;};
 },[]);
 useEffect(()=>{
  const unsubscribe=subscribeFleet(()=>setSaved(s=>{
   const tasks=s.tasks.map(t=>syncRailTask(t,getFleetSnapshot()));return tasks.some((t,i)=>t!==s.tasks[i])?{...s,tasks}:s;
  }));
  const complete=(event:Event)=>{const result=(event as CustomEvent<FleetResult>).detail;if(result.job?.observation)return;setSaved(s=>{
   const tasks=s.tasks.map(t=>finishRailTask(t,result));if(tasks.every((t,i)=>t===s.tasks[i]))return s;
   return {...s,tasks,activities:[{id:crypto.randomUUID(),site:'hainan',time:timeLabel(),title:treeAlias(result.index)+(result.outcome==='completed'?' 割胶完成':' 作业已取消'),detail:`R-${'ABCD'[Math.floor(result.index/50)]} · ${result.job?.planVersion} · ${result.job?.angle}°`},...s.activities]};
  });};
  window.addEventListener('zone-fleet-result',complete);
  return()=>{unsubscribe();window.removeEventListener('zone-fleet-result',complete);};
 },[]);

 useEffect(()=>{
  try{localStorage.setItem(storageKey,JSON.stringify(savedRef.current));setStorageError('');}
  catch{setStorageError('浏览器无法保存当前任务，请保留此页面；关闭或刷新可能丢失尚未同步的更新。');}
  syncControllerRef.current?.localChanged();
 },[saved]);
 // All task reads/writes, durable pending submissions and retries share one owner.
 useEffect(()=>{
  let active=true,controller:TaskSyncController|null=null;
  const initialize=()=>{
   try{
    const journal=parseTaskSyncJournal(localStorage.getItem(syncJournalKey));
    controller=new TaskSyncController({
     journal,getTasks:()=>savedRef.current.tasks,
     applyTasks:tasks=>setSaved(current=>({...current,tasks})),
     readTasks:async()=>{
      const version=businessWriteVersion.current;
      const result=await read<{items:Task[];operationalEvents:OperationalEvent[];logisticsBatches:LatexBatch[]}>('/api/simulation/tasks');
      if(active&&version===businessWriteVersion.current){applyOperationalEvents(result.operationalEvents);applyLogisticsBatches(result.logisticsBatches);}
      return result.items;
     },
     // Accounts without task write permission answer every local change with the server's version.
     writeTasks:tasks=>readOnlyTasks?read<{items:Task[]}>('/api/simulation/tasks').then(remote=>({accepted:0,tasks:remote.items,conflicts:tasks.map(task=>({taskId:task.id,code:'READ_ONLY',message:'当前身份只能查看任务',revision:remote.items.find(item=>item.id===task.id)?.revision??0,task:remote.items.find(item=>item.id===task.id)??null}))}) as unknown as TaskWriteResult):post<TaskWriteResult>('/api/simulation/task-receipts',{tasks}),
     persistJournal:journal=>{
      try{
       localStorage.setItem(storageKey,JSON.stringify(savedRef.current));
       localStorage.setItem(syncJournalKey,JSON.stringify(journal));setStorageError('');
      }catch{setStorageError('未确认提交无法保存在浏览器中，请保留此页面后重试。');throw Error('无法保存待同步记录，本次提交尚未发送或确认');}
     },
     onRemote:(before,after,remote)=>{for(const index of fleetJobsToRetire(before,after,remote,getFleetSnapshot().jobs))retireFleetJob(index);},
     onState:state=>{
      if(!active)return;
      setSyncState(previous=>JSON.stringify(previous)===JSON.stringify(state)?previous:{...state});
      hydratedRef.current=state.hydrated&&!state.error;
      if(!hydratedRef.current)dispatchControllerRef.current?.cancelPending();
      setHydrated(hydratedRef.current);
     },
    });
    syncControllerRef.current=controller;void controller.refresh(true);
   }catch(error){
    hydratedRef.current=false;dispatchControllerRef.current?.cancelPending();setHydrated(false);
    setSyncState({...initialTaskSyncState,phase:'error',error:(error as Error).message||'未确认提交记录无法读取'});
   }
  };
  const refresh=()=>{if(controller)void controller.refresh(true);else initialize();};
  retrySyncRef.current=refresh;initialize();
  const timer=setInterval(()=>void controller?.refresh(),1000);
  window.addEventListener('harness-tasks-created',refresh);
  window.addEventListener('online',refresh);
  return()=>{active=false;controller?.dispose();syncControllerRef.current=null;retrySyncRef.current=()=>{};clearInterval(timer);window.removeEventListener('harness-tasks-created',refresh);window.removeEventListener('online',refresh);};
 },[]);
 useEffect(()=>{setFleetValidator(async(index,job)=>{if(!hydratedRef.current)throw Error('尚未同步服务器任务，等待连接后重试核验');return verifyFleetJob(index,job);});return()=>setFleetValidator(undefined);},[]);
 // Accepted strategies affect waiting work; an in-progress cut keeps its plan.
 useEffect(()=>{
  const fleet=getFleetSnapshot();
  for(const [key,current] of Object.entries(fleet.jobs)){
   if(current.observation)continue;
   const index=Number(key),next=jobForTree(index,current.id,saved.tasks,saved.decisions),zone=fleet.zones[Math.floor(index/50)];
   if(!current.taskWindow){
    const task=saved.tasks.find(task=>task.site==='hainan'&&(task.railJob?.id===current.id||task.railBatch?.jobs[index]?.id===current.id));
    if(task){const taskWindow=taskExecutionWindow(task);if(taskWindow.notBefore!==undefined)patchFleetJob(index,{taskWindow});}
   }
   if(zone?.phase!=='working'&&(current.blockedReason??'')!==(next.blockedReason??''))patchFleetJob(index,{blockedReason:next.blockedReason??''});
   if(!current.harnessSource&&zone?.active!==index&&(current.angle!==next.angle||current.notBefore!==next.notBefore))
    patchFleetJob(index,{angle:next.angle,planVersion:next.planVersion,notBefore:next.notBefore});
  }
 },[saved.decisions,saved.tasks]);
 useEffect(()=>{
  let active=true,busy=false;
  const update=async()=>{
   if(busy)return;busy=true;
   const sitesToCheck=[...new Set([siteRef.current,...savedRef.current.tasks.filter(task=>task.dispatch?.auto&&!['已完成','已取消'].includes(task.status)).map(task=>task.site)])];
   await Promise.allSettled(sitesToCheck.map(next=>refreshWeather(next)));
   busy=false;
   if(!active)return;
   setWeatherVersion(value=>value+1);
   applyOperationalEvents(eventsRef.current);
   const fleet=getFleetSnapshot();
   for(const [key,job] of Object.entries(fleet.jobs)){
    if(job.observation)continue;
    const index=+key,zone=fleet.zones[Math.floor(index/50)];
    if(zone?.active===index&&['working','retracting'].includes(zone.phase))continue;
    const next=mergeExecutionWindow(weatherTiming(index),job.taskWindow);
    if(job.notBefore!==next.notBefore||job.notAfter!==next.notAfter||job.weatherBlock!==next.weatherBlock)patchFleetJob(index,{notBefore:next.notBefore,notAfter:next.notAfter,weatherBlock:next.weatherBlock||''});
   }
  };
  void update();const timer=setInterval(()=>void update(),5000);
  window.addEventListener('harness-weather-changed',update);window.addEventListener('harness-park-weather-changed',update);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('harness-weather-changed',update);window.removeEventListener('harness-park-weather-changed',update);};
 },[site]);
 useEffect(()=>{
  if(!hydrated||!fleetEnabled)return;
  let busy=false;
  const tick=setInterval(async()=>{
   if(busy)return;
   const task=findDueRailTask(savedRef.current.tasks.filter(task=>!eventHoldForTask(task,eventsRef.current)),getFleetSnapshot());if(!task)return;
   busy=true;try{await dispatchControllerRef.current?.startBatch(task.id);}finally{busy=false;}
  },3000);
  return()=>clearInterval(tick);
 },[hydrated,fleetEnabled]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t);},[toast]);
 useEffect(()=>{const f=()=>{const next=selectedPage();setContextOpen(false);setPage(next);if(next==='overview')setScope(overviewScopeRef.current);};window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f);},[]);
 const navigate=(next:Page,initialDataTab:DataTab=role==='grower'?'collection':'catalog',initialReference:PublicReferenceTab='market',initialAnalysis:AnalyticsTopic='trend')=>{if(next==='analytics'){setDataTab(initialDataTab);setDataReference(initialReference);setDataAnalysis(initialAnalysis);}setContextOpen(false);setPage(next);location.hash=next;setShowTreeList(false);if(next!=='home'){setArranging(false);setMonitorId(null);}};
 const openStrategy=()=>{setModal(null);if(scope==='all')setScope(site);navigate('decisions');};
 const openWeatherSample=()=>{setStrategyTab('weather');if(page==='overview')overviewScopeRef.current=scope;setModal(null);setScope('hainan');navigate('decisions');};
 const overview=()=>{setScope(overviewScopeRef.current);navigate('overview');};
 const openTree=(index:number)=>{if(!accountTreeIndices(account,siteRef.current).includes(index))return;setTreeStrategyKind('tapping_angle');setMonitorId(null);setTree(index);setFocusKey(k=>k+1);setTreeTab('概览');setSource({page,tree:selectedTree});navigate('home');setShowTreeList(false);setModal(null);};
 const openStory=(next:Story,index?:number)=>{
   triggerRef.current=document.activeElement as HTMLElement;
   setStory(next);setStoryTab('当前方案');
   if(next==='surface'){
     const prior=currentTasks.find(t=>t.decisionKey===`${site}:surface:${treeAlias(index??selectedTree??85,site)}`);
     setSurfaceMark(prior?.surfacePlan?.mark??'结构隆起');
     setSurfaceAction(prior?.surfacePlan?.action??'复核局部绕行方案');
   }
   if(next==='weather'){setContextOpen(false);setModal('weather');return;}
   if(next==='angle'||next==='growth'||next==='surface'){
     setTree(index??selectedTree??85);
     if(page==='home')setTreeTab(next==='surface'?'健康证据':'一树一策');
   }
   setContextOpen(true);
 };
 const back=()=>{setTree(source.tree);navigate(source.page);};
 const home=()=>{setArranging(false);setMonitorId(null);setSite('hainan');setTree(null);setLayer(0);setReset(n=>n+1);navigate('home');};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;if(e.key==='Escape'&&!modal){if(contextOpen)closeContext();else if(photoZoom)setPhotoZoom(false);else if(showTreeList)setShowTreeList(false);else if(selectedTree!==null){setTree(null);setReset(n=>n+1);}else if(page==='decisions')overview();else if(page!=='home'&&page!=='overview')back();}if(e.key.toLowerCase()==='r'&&!modal)setReset(n=>n+1);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
 const updateTask=(task:Task)=>{const current=resolveTask(task);if(!current)return;const hold=eventHoldForTask(current,eventsRef.current)||executionHold(task);const advances=task.done>current.done||(!current.dispatch?.auto&&Boolean(task.dispatch?.auto))||task.dispatch?.phase==='resume-requested'||(task.status==='执行中'&&task.dispatch?.phase!== 'pause-requested')||task.status==='已完成';if(hold&&advances){notify(hold);return;}setSaved(s=>({...s,tasks:s.tasks.map(t=>t.id===task.id&&t.site===task.site?task:t),activities:[{id:crypto.randomUUID(),site:task.site,time:timeLabel(),title:task.title,contextKey:task.decisionKey,detail:task.receipt?`${task.status} · ${task.receipt.outcome} · ${task.receipt.note}（模拟回执）`:`${task.status} · ${task.done}/${task.count} 棵（模拟回执）`},...s.activities]}));};
 const canRescheduleWeather=(t:Task)=>t.site===site&&t.block==='C'&&t.done===0&&!t.dispatch&&(t.status==='待开始'||(t.id==='HN-03'&&t.status==='待处理'));
 const weatherNeedsUpdate=currentTasks.some(t=>canRescheduleWeather(t)&&(t.start!=='08:00'||t.end!=='09:30'));
 const commit=(kind:Story,approve=true)=>{
   const key=`${site}:${kind}:${kind==='angle'||kind==='growth'||kind==='surface'?treeId:'all'}`;
   const repairWeather=kind==='weather'&&approve&&weatherNeedsUpdate&&saved.decisions[key]==='C区调整为08:00–09:30';
   if(saved.decisions[key]&&!repairWeather){notify('这条方案已经处理，可在历史记录中查看');setModal(null);return;}
   const detail=!approve?'保留原方案':kind==='weather'?'C区调整为08:00–09:30':kind==='angle'?'下次作业采用28°示例方案':kind==='growth'?`保存${growthYear}年割面规划`:kind==='market'?`保存「${marketPlan}」情景`:kind==='surface'?`${surfaceMark} · ${surfaceAction}`:'已安排B区人工巡查';
   setSaved(s=>{
     if((s.decisions[key]&&!repairWeather)||s.tasks.some(t=>t.decisionKey===key))return s;
     let tasks=s.tasks;
     if(approve&&kind==='weather')tasks=tasks.map(t=>canRescheduleWeather(t)?{...t,start:'08:00',end:'09:30',status:'待开始' as const}:t);
     if(approve&&(kind==='health'||kind==='surface'||kind==='angle')){
       tasks=[...tasks,{id:`DEMO-${crypto.randomUUID().slice(0,8)}`,site,title:kind==='health'?'B区叶片巡查':kind==='surface'?`${treeId} · ${surfaceAction}`:`${treeId} 单树计划`,block:kind==='health'?'B':'ABCD'[Math.floor((selectedTree??85)/50)],robot:kind==='angle'?'待分配':'巡检员 林',start:'10:30',end:'11:00',count:kind==='health'?8:1,done:0,status:'待开始',kind:kind==='angle'?'割胶':'巡检',treeIndices:kind==='health'?Array.from({length:8},(_,i)=>i+50):[selectedTree??85],story:kind,decisionKey:key,...(kind==='surface'?{surfacePlan:{mark:surfaceMark,action:surfaceAction}}:{})}];
     }
     return {...s,tasks,decisions:{...s.decisions,[key]:detail},activities:[{id:crypto.randomUUID(),site,time:timeLabel(),title:stories[kind].title,contextKey:key,detail:`${detail} · 模拟操作，未发送至设备`},...s.activities]};
   });setModal(null);notify(`${detail}，记录已保存（模拟）`);
 };
 const requestConfirm=(kind:Story)=>{setConfirmStory(kind);setModal('confirm');};
 const chooseSite=(next:Site)=>{if(!allowedSite(next)){notify('当前身份不能查看该园区');return;}setFocusZone(null);setReviewTarget(null);setRobotFocus(null);setRobotTarget(undefined);setArranging(false);setMonitorId(null);setContextOpen(false);setSite(next);setTree(null);setSearch('');setSelectedTaskId(saved.tasks.find(t=>t.site===next)?.id||'');setModal(null);setSource({page:'home',tree:null});};
 const openMarketModel=(target:Site,modelId:string)=>{chooseSite(target);setScope(target);overviewScopeRef.current=target;setSelectedMarketModel({site:target,modelId});setStrategyTab('market');navigate('decisions');};
 useEffect(()=>{
  const open=(event:Event)=>{
   const target=(event as CustomEvent<{site:Site;id?:string}>).detail;
   setSite(target.site);setScope(target.site);
   setBatchOpenRequest(null);
   setShipmentOpenRequest(previous=>({...target,sequence:(previous?.sequence??0)+1}));
   navigate('operations');
  };
  window.addEventListener('harness-open-sales-shipments',open);
  return()=>window.removeEventListener('harness-open-sales-shipments',open);
 },[setSite]);
 useEffect(()=>{
  const open=(event:Event)=>{
   const target=(event as CustomEvent<{site:Site;id?:string}>).detail;
   setSite(target.site);setScope(target.site);setShipmentOpenRequest(null);
   setBatchOpenRequest(previous=>({...target,sequence:(previous?.sequence??0)+1}));
   navigate('operations');
  };
  const openMarket=(event:Event)=>{
   const {site:target}=(event as CustomEvent<{site:Site}>).detail;
   setSite(target);setScope(target);setSelectedMarketModel(null);setStrategyTab('market');
   navigate('decisions');
  };
  window.addEventListener('harness-open-logistics',open);
  window.addEventListener('harness-open-market',openMarket);
  const openCommodity=(event:Event)=>{
   const {site:target,focus}=(event as CustomEvent<{site:Site;focus?:string}>).detail;
   setSite(target);setScope(target);
   navigate('analytics','public');
   if(focus==='eudr-readiness')requestAnimationFrame(()=>document.getElementById('eudr-readiness')?.scrollIntoView({block:'start'}));
  };
  window.addEventListener('harness-open-commodity-market',openCommodity);
  return()=>{
   window.removeEventListener('harness-open-logistics',open);
   window.removeEventListener('harness-open-market',openMarket);
   window.removeEventListener('harness-open-commodity-market',openCommodity);
  };
 },[setSite]);
 useEffect(()=>{
  const open=(event:Event)=>{
   const detail=(event as CustomEvent<{siteId:string;treeId:string;kind:'capture'|'measure'|'inspect'}>).detail;
   const target=Object.values(parks).find(park=>park.siteId===detail.siteId),index=Number(detail.treeId.slice(2))-1;
   if(!target||!allowedSite(target.key)||!accountTreeIndices(account,target.key).includes(index)||account&&!can(account,'reviews.write')){notify('当前身份不能处理该对象的核查');return;}
   chooseSite(target.key);navigate('home');setSceneLoaded(true);setTree(index);setFocusKey(key=>key+1);
   setReviewTarget({site:target.key,treeId:detail.treeId,kind:detail.kind,request:Date.now()});
  };
  window.addEventListener('harness-open-review',open);
  return()=>window.removeEventListener('harness-open-review',open);
 },[account]);
 const matchedSearchIndex=parseTreeAlias(search.trim(),site);
 const searchIndex=matchedSearchIndex!==null&&ownsTree(matchedSearchIndex)?matchedSearchIndex:null;
 const searchTasks=currentTasks.filter(t=>!search||`${t.title} ${t.id} ${t.robot}`.toLowerCase().includes(search.toLowerCase()));
 const treeIndices=visibleTreeIndices.filter(i=>treeFilter==='全部'||'ABCD'[Math.floor(i/50)]===treeFilter);
 const summaryPlan=currentTasks.length,summaryDone=currentTasks.filter(t=>t.status==='已完成').length;
 const statusContent=<span className="ws-sim">演示环境</span>;
 return <main className={'workspace-app rb-shell '+(widePage?'rb-wide':'')}>
  {site==='hainan'&&!fleetEnabled&&<RailPreviewResult onTree={()=>openTree(44)} onReplay={()=>{setTree(null);setContextOpen(false);}}/>}
  {site==='hainan'&&!fleetEnabled&&<RailRowResult onTree={openTree} onReplay={()=>{setTree(null);setContextOpen(false);navigate('home');}}/>}

  <Suspense fallback={page==='home'?<div className="dw-scene-loading" role="status">正在加载胶园空间…</div>:null}>
   {sceneLoaded&&<DigitalTwinScene getDemoMotions={()=>demoRobotMotions(savedRef.current.tasks,Date.now(),t=>Boolean(eventHoldForTask(t,eventsRef.current)||executionHold(t)))} key="hainan" site="hainan" treeProfiles={hainanProfiles} selectableTrees={accountTreeIndices(account,'hainan')} demoMotion={site==='hainan'&&animatedTask?{treeIndex:currentTreeIndex(animatedTask)??null,stage:animatedTask.dispatch!.auto!.stage,phase:eventHoldForTask(animatedTask,operationalEvents)?'paused':animatedTask.dispatch!.phase}:undefined} selectionMode={site!=='hainan'?'off':arranging?(selecting?selectionMode:'off'):monitorId?'off':'point'} selectedTrees={site==='hainan'?(arranging?targets:monitoredTask?.treeIndices):undefined} onTreesSelect={indices=>setTargets(current=>[...new Set([...current,...indices])])} resetKey={resetKey} activeLayer={layer} visible={page==='home'&&site==='hainan'} selectedTree={site==='hainan'?selectedTree:null} focusKey={focusKey} focusZone={site==='hainan'?focusZone:null} onTreeSelect={index=>{if(!ownsTree(index))return;if(arranging){if(!selecting)return;setTargets(current=>current.includes(index)?current.filter(i=>i!==index):[...current,index]);return;}if(monitorId)return;setContextOpen(false);setTree(index);setFocusKey(k=>k+1);setTreeTab('概览');}}/>}
   {site!=='hainan'&&sceneVisible&&<DigitalTwinScene key={site} site={site} treeProfiles={siteProfiles} selectableTrees={visibleTreeIndices} demoMotion={animatedTask?{treeIndex:currentTreeIndex(animatedTask)??null,stage:animatedTask.dispatch!.auto!.stage,phase:eventHoldForTask(animatedTask,operationalEvents)?'paused':animatedTask.dispatch!.phase}:undefined} selectionMode={arranging?(selecting?selectionMode:'off'):monitorId?'off':'point'} selectedTrees={arranging?targets:monitoredTask?.treeIndices} onTreesSelect={indices=>setTargets(current=>[...new Set([...current,...indices])])} resetKey={resetKey} activeLayer={layer} visible={page==='home'} selectedTree={selectedTree} focusKey={focusKey} focusZone={focusZone} onTreeSelect={index=>{if(!ownsTree(index))return;if(arranging){if(!selecting)return;setTargets(current=>current.includes(index)?current.filter(i=>i!==index):[...current,index]);return;}if(monitorId)return;setContextOpen(false);setTree(index);setFocusKey(k=>k+1);setTreeTab('概览');}}/>}
  </Suspense>
  <header className="ws-topbar"><button className="ws-brand" onClick={()=>navigate('workbench')}><Leaf size={27}/><strong>橡胶大脑</strong></button>{!widePage&&<form className="ws-search" onSubmit={e=>{e.preventDefault();setModal('search');}}><Search size={16}/><input aria-label="搜索树、区域或任务" placeholder="搜索树、区域或任务" value={search} onChange={e=>setSearch(e.target.value)}/></form>}<label className="rb-scope"><span>胶园范围</span><select aria-label="站点范围" value={multiSitePage?scope:site} onChange={e=>{const next=e.target.value as 'all'|Site;setScope(next);overviewScopeRef.current=next;if(next!=='all')chooseSite(next);}}>{multiSitePage&&allowedSite('all')&&<option value="all">全部中心与园区</option>}{productionRegions.filter(region=>productionSites.some(park=>parks[park].regionId===region&&allowedSite(park))).map(region=><optgroup key={region} label={regions[region].name}>{productionSites.filter(park=>parks[park].regionId===region&&allowedSite(park)).map(park=><option value={park} key={park}>{sites[park]}</option>)}</optgroup>)}{allowedSite('xian')&&<optgroup label="试验站"><option value="xian">{sites.xian}</option></optgroup>}</select></label><div className="rb-header-meta"><CurrentClock/><span>现场与作业为模拟演示{demoWeather?' · 模拟天气已开启':''}</span></div>{account?<div className="id-chip" aria-label="当前登录身份"><span><strong>{account.name}</strong> · {account.title}</span><b>{account.roleLabel}</b>{onLogout&&<button onClick={onLogout} aria-label="切换身份"><LogOut size={13}/> 切换身份</button>}</div>:<label className="dw-role"><span>角色视图</span><select aria-label="角色视图（演示）" value={role} onChange={e=>{const next=parseRoleView(e.target.value);setRole(next);if(next==='executive'){setScope('all');overviewScopeRef.current='all';}else setScope(site);navigate('workbench');}}>{(Object.keys(roleViews) as RoleView[]).map(key=><option value={key} key={key}>{roleViews[key].label}</option>)}</select></label>}{(!account||rolePages(account.role).includes('brain'))&&<button className="ws-brain-entry" aria-current={page==='brain'?'page':undefined} onClick={()=>{setScope(site);navigate('brain');}}><Brain size={16}/>大脑管理</button>}<button className="ws-icon" aria-label="通知" onClick={()=>setModal('notifications')}><Bell size={19}/></button><button className="ws-user" aria-label="演示设置" onClick={()=>setModal('profile')}><UserRound size={20}/></button></header>
  <nav className="ws-navigation" aria-label="工作空间">{rolePages(role).filter(p=>p!=='brain').map(p=>{const Icon=pageIcons[p];return <button key={p} onClick={()=>{if(p==='decisions'){setScope(site);navigate(p);}else{if(scope!=='all')chooseSite(scope);navigate(p);}}} aria-current={page===p?'page':undefined} className={page===p?'active':''}><Icon size={18}/>{rolePageLabel(role,p)}</button>;})}<span className="ws-spacer"/>{!readOnlyTasks&&page==='home'&&site==='hainan'&&!arranging&&!monitorId&&selectedTree===null&&<button className="ws-primary ws-dispatch-entry" onClick={()=>startArrange()}><Play size={16}/>补充安排</button>}{statusContent}</nav>
  <TaskSyncStatus state={syncState} storageError={storageError} onRetry={()=>retrySyncRef.current()}/>
  <div ref={bodyRef} className={`workspace-body page-${page} ${monitorId?'tf-monitor-mode':''} ${folds.left?'ws-fold-left':''} ${folds.right?'ws-fold-right':''}`}>
   {page==='workbench'&&<DecisionWorkbench onRobot={(target,robot)=>{chooseSite(target);setRobotTarget(robot);navigate('robots');}} assistantContext={assistantContext} onClearAssistantContext={()=>setAssistantContext(null)} account={account} onParkPlan={planId=>openParkPlan(scope==='all'?site:scope,planId)} onCerebellum={()=>{chooseSite(scope==='all'?site:scope);setScope(scope==='all'?site:scope);navigate('brain');}} role={role} scope={scope} tasks={saved.tasks} events={operationalEvents} synced={syncState.hydrated} syncLabel={syncState.phase==='synced'?'作业记录已与服务端核对':syncState.hydrated?'当前显示本地作业记录 · 同步状态见右下角':syncState.error?'任务服务核对失败，统计暂不可用':'正在核对作业记录，统计暂不可用'} onScope={next=>{setScope(next);overviewScopeRef.current=next;if(next!=='all')chooseSite(next);}} onNavigate={(next,target)=>{const nextScope=target??scope;if(target!==undefined){setScope(target);overviewScopeRef.current=target;}if(nextScope!=='all')chooseSite(nextScope);if(next==='decisions')setScope(nextScope==='all'?site:nextScope);navigate(next);}} onData={tab=>{if(scope!=='all')chooseSite(scope);navigate('analytics',tab);}} onTask={openTask} onMarket={openMarketModel} onEvents={target=>{if(target){chooseSite(target);setScope(target);}openOperationalEvents();}} onTree={(target,index)=>{chooseSite(target);openTree(index);}} onStrategy={(target,index,kind)=>{chooseSite(target);openTree(index);setTreeStrategyKind(kind);setTreeTab('一树一策');}}/>}
   {page==='overview'&&<Overview allowedSites={account?accountSites(account):undefined} onTree={(target,index)=>{chooseSite(target);openTree(index);}} onMapScope={next=>{setScope(next);overviewScopeRef.current=next;if(next!=='all')chooseSite(next);}} onMapStrategy={(target,index,kind)=>{chooseSite(target);openTree(index);setTreeStrategyKind(kind);setTreeTab('一树一策');}} onMapData={target=>{chooseSite(target);navigate('analytics','field');}} onMapRobot={(target,robot)=>{chooseSite(target);setRobotTarget(robot);navigate('robots');}} tasks={saved.tasks} scope={scope} salesInventory={salesInventory} inventoryError={shipmentError} onInventoryRefresh={()=>setShipmentRevision(value=>value+1)} onInventoryData={(!account||rolePages(account.role).includes('analytics'))?()=>{if(scope!=='all')chooseSite(scope);navigate('analytics','business');}:undefined} weatherStatus={sample.state.status} weatherProgress={sample.state.receipt?'已收到演示回执':sample.state.applied?'演示排程已更新':'尚未更新任务'} weatherWindow={sample.state} onWeather={()=>{const target=scope==='all'?site:scope;chooseSite(target);setScope(target);setStrategyTab('weather');navigate('decisions');}} onSite={s=>{setScope(s);overviewScopeRef.current=s;chooseSite(s);}} onField={s=>{chooseSite(s);navigate('home');}} onAnalysis={s=>{chooseSite(s);navigate('analytics');}} onTask={openTask}/>}
   {page==='decisions'&&<><StrategyCenter key={site} site={site} tasks={currentTasks} onTask={openTask} allowBusiness={!account||account.role==='manager'||account.role==='executive'} onData={(!account||rolePages(account.role).includes('analytics'))?(tab,reference,analysis)=>navigate('analytics',tab,reference,analysis):undefined} onTasks={openStrategyTasks} tab={strategyTab} onTab={setStrategyTab} marketModelId={selectedMarketModel?.site===site?selectedMarketModel.modelId:null} onLatestMarket={()=>setSelectedMarketModel(null)} parkPlanId={selectedParkPlan?.site===site?selectedParkPlan.planId:null} onLatestParkPlan={()=>setSelectedParkPlan(null)} onTree={index=>{openTree(index);}}/></>}
   {page==='home'&&!arranging&&<>
    {site!=='hainan'&&<div className="ws-site-context"><Leaf size={18}/><span>{site==='xian'?'低密度机器人联调场景':parks[site].sceneTemplate==='xsbn'?'山地胶园模拟场景':'平地胶园模拟场景'} · 200 棵独立树档案已接入</span><button className="ws-link" onClick={()=>navigate('operations')}>查看{site==='xian'?'联调任务':'园区作业'} →</button></div>}
    <section className="ws-scene-heading"><span>{sites[site]} / {site==='xian'?'联调基地':'生产示范区'}</span><h1>{site==='hainan'?'海南 · 标准化生产胶园':sites[site]}</h1><p>{site==='hainan'?`200 棵 · 株行距 3 m × 7 m · 约 ${SCENE_PLANTED_MU.toFixed(1)} 亩 · 清晨，多云`:'园区独立管理 · 模拟演示'}</p></section>
    <FieldPlan devicesEnabled={site==='hainan'&&!account?.plot} tasks={currentTasks} onTask={openTask} onQueue={()=>navigate('operations')} onTrees={()=>setShowTreeList(true)} onFold={()=>setFolds(f=>({...f,left:true}))}/>
    {selectedTree===null?<aside className="ws-home-right ws-panel"><header><h2>待处理事项</h2><button className="ws-icon" aria-label="收起待处理事项" onClick={()=>setFolds(f=>({...f,right:true}))}><PanelRightClose size={18}/></button></header>{currentTasks.filter(t=>t.status==='待处理').map(t=><button className="ws-attention" key={t.id} onClick={()=>openTask(t)}><AlertTriangle size={18}/><span><strong>{t.title}</strong><p>{t.block}区 · {t.robot}</p></span><ChevronRight size={16}/></button>)}{!currentTasks.some(t=>t.status==='待处理')&&<p>暂无待处理任务</p>}</aside>:<aside key={selectedTree} className="ws-tree-drawer ws-panel" style={reviewTarget?.site===site?{display:"none"}:undefined}><header><h2>单树档案</h2><button className="ws-link" onClick={()=>setFocusKey(k=>k+1)}>重新定位</button><button className="ws-icon" aria-label="关闭单树档案" onClick={()=>{setContextOpen(false);setTree(null);setReset(k=>k+1);}}><X size={20}/></button></header><p className="ws-muted">{sites[site]} / {'ABCD'[Math.floor(selectedTree/50)]}区 / {treeId}</p><button className="ws-secondary ws-full" onClick={()=>{setAssistantContext({site,index:selectedTree,request:Date.now()});setScope(site);navigate('workbench');}}>询问助理</button><nav className="ws-tabs">{['概览','一树一策','作业产胶','健康证据'].map(t=><button className={t===treeTab?'active':''} onClick={()=>setTreeTab(t)} key={t}>{t}</button>)}</nav>
     {treeTab==='概览'&&<>{!readOnlyTasks&&fleetEnabled&&<ZoneTreeDispatch index={selectedTree} onArrange={()=>queueTrees([selectedTree])}/>}{!readOnlyTasks&&isRailRowTree&&<RailRowEntry index={selectedTree} onOpen={()=>{setTree(null);setContextOpen(false);}}/>}<div className="ws-tree-overview"><div className="field-photo-empty"><strong>{treeId}</strong><span>暂无本树实拍</span></div><TreeProfile index={selectedTree} site={site}/></div><TreeWorkSummary index={selectedTree} tasks={treeTasks} onTask={openTask} onPhoto={t=>setIncidentTaskId(t.id)} site={site}/><Disclosure title="测量与历史记录"><p>{site==='xian'?'测量时间和来源见当前档案。本站点用于设备联调，暂无产胶历史。':'测量时间和来源见当前档案。胶乳曲线为按树号独立生成的模拟样本，尚未接入真实采胶历史。'}</p></Disclosure>{!readOnlyTasks&&!fleetEnabled&&site==='hainan'&&!isRailTree&&!(isRailRowTree&&segmentForTree(selectedTree))&&<button className="ws-primary ws-full" onClick={()=>startArrange(selectedTree)}>安排这棵树割胶</button>}<button className="ws-secondary ws-full" onClick={()=>{setContextOpen(false);setTreeTab('一树一策');}}>查看单树方案</button>{(!account||can(account,'reviews.write'))&&<button className="ws-secondary ws-full" onClick={()=>window.dispatchEvent(new CustomEvent('harness-open-review',{detail:{siteId:`demo-${site}`,treeId:`T-${String(selectedTree+1).padStart(4,'0')}`,kind:site==='hainan'?'capture':'measure'}}))}>{site==='hainan'?'补拍这棵树':'记录本树复测'}</button>}</>}
     {treeTab==='一树一策'&&<TreeDecision readOnly={treeReadOnly} key={`${site}:${selectedTree}:${treeStrategyKind}`} site={site} index={selectedTree} initial={treeStrategyKind}/>} 
     {treeTab==='作业产胶'&&<><TreeWorkHistory index={selectedTree} tasks={treeTasks} onTask={openTask} onPhoto={t=>setIncidentTaskId(t.id)} site={site}/><h3>{site==='xian'?'本树产胶记录':'本树独立胶乳样本'}</h3>{(() => { const samples=getTreeYieldSeries(selectedTree,site,5); const treeLabel=treeAlias(selectedTree,site); if(!samples.length)return <p className="ws-muted">{treeLabel} · 设备联调站点，暂无本树产胶序列。</p>; return <><p className="ws-muted">{treeLabel} · 按树号生成的可复现独立模拟序列；尚未接入本树真实采胶记录。</p>{samples.slice().reverse().map(sample=><Disclosure title={`${sample.date.slice(5)} · 模拟胶乳 ${sample.actual.toFixed(3)} kg`} key={sample.date}><p>独立树级模拟样本 · {treeLabel} · 当日园区降雨 {sample.rain} mm。不是现场采集记录。</p></Disclosure>)}</>; })()}<button className="ws-secondary ws-full" onClick={()=>navigate('analytics')}>查看园区趋势</button></>}
     {treeTab==='健康证据'&&<TreeDecision readOnly={treeReadOnly} key={'health-'+selectedTree} site={site} index={selectedTree} initial='surface_action'/>}
     </aside>}
    {!monitorId&&<>{folds.left&&<button className="ws-panel-tab left" onClick={()=>setFolds(f=>({...f,left:false}))}>执行计划 ›</button>}{folds.right&&selectedTree===null&&<button className="ws-panel-tab right" onClick={()=>setFolds(f=>({...f,right:false}))}>‹ 待处理事项</button>}</>}<nav className="ws-layers" aria-label="镜头控制"><button aria-pressed={focusZone===null&&selectedTree===null} onClick={()=>{setFocusZone(null);setTree(null);setContextOpen(false);setReset(n=>n+1);}} title="恢复全园镜头">全园视图</button>{[...new Set(visibleTreeIndices.map(index=>Math.floor(index/50)))].map(zone=><button key={zone} aria-pressed={focusZone===zone} onClick={()=>{setTree(null);setContextOpen(false);setFocusZone(zone);setFocusKey(k=>k+1);}}>{'ABCD'[zone]}区</button>)}</nav>
    <div className="field-status"><span>{site==='hainan'?`${fleetBusy} 台模拟设备执行中`:'设备机群尚未接入'}</span><button onClick={()=>navigate('operations')}>完成 {summaryDone}/{summaryPlan} 项</button><button onClick={()=>{setFolds(f=>({...f,right:false}));setTree(null);}}>待处理 {currentTasks.filter(t=>t.status==='待处理').length} 项</button><span>本地演示</span></div>
   </>}
   <div className="ws-page-host" hidden={page!=='operations'}><OperationsPage readOnly={readOnlyTasks} demoWeather={demoWeather} onDemoWeatherChange={setDemoWeather} executionHold={executionHold} batchOpenRequest={batchOpenRequest} salesInventory={salesInventory?.siteId===`demo-${site}`?salesInventory:null} shipments={salesShipments} shipmentError={shipmentError} shipmentOpenRequest={shipmentOpenRequest} onAdvanceShipment={advanceSalesShipment} onShipmentSource={modelId=>openMarketModel(site,modelId)} batches={logisticsBatches} onCreateBatch={input=>recordLogisticsBatch('/api/simulation/logistics-batches',{...input,siteId:`demo-${site}`})} onBatchAction={(id,action,input)=>recordLogisticsBatch(`/api/simulation/logistics-batches/${id}/${action}`,{...input,siteId:`demo-${site}`})} events={operationalEvents} eventViewRequest={eventViewRequest} onCreateEvent={input=>recordOperationalEvent('/api/simulation/operational-events',{...input,siteId:`demo-${site}`,requestId:crypto.randomUUID()})} onResolveEvent={(id,note)=>recordOperationalEvent(`/api/simulation/operational-events/${id}/resolve`,{siteId:`demo-${site}`,note})} onResumeEvent={(id,note)=>recordOperationalEvent(`/api/simulation/operational-events/${id}/resume`,{siteId:`demo-${site}`,note})} onReview={()=>{setScope(site);setStrategyTab('reviews');navigate('decisions');}} onStrategy={openDemoStrategy} site={site} tasks={saved.tasks} selectedTaskId={selectedTaskId} openRequest={taskOpenRequest} onRetryRail={retryRailTask} onStartRailBatch={startRailBatch} onSelectTask={id=>{setContextOpen(false);setSelectedTaskId(id);}} onTree={openTree} onTreeHistory={index=>{openTree(index);setTreeTab('作业产胶');}} onStory={(next,index)=>openStory(next,index)} onTaskUpdate={updateTask} onOpenFlow={openFlow} onNotify={notify}/></div>
   {page==='robots'&&<RobotCenter key={site} initialRobot={robotTarget} initialZone={robotFocus??0} site={site} events={operationalEvents} onEvents={openOperationalEvents} tasks={currentTasks} onTree={openTree} onTask={openTask} onScene={zone=>{setTree(site==='hainan'?null:zone*50);setFocusKey(k=>k+1);setRobotFocus(site==='hainan'?zone:null);navigate('home');}}/>}
   {page==='brain'&&(!account||rolePages(account.role).includes('brain'))&&<BrainManagement key={site} site={site}/>}
   {page==='analytics'&&<><DataCenter account={account} key={`${site}:${dataTab}:${dataReference}:${dataAnalysis}`} initialTab={dataTab} initialReference={dataReference} initialAnalysis={dataAnalysis} site={site} onStory={openStory} onTree={openTree} onNotify={notify} onTasks={()=>navigate('operations')}/></>}
   {arranging&&fleetEnabled&&<ZoneBatchDispatch selected={targets} onSubmit={()=>{queueTrees(targets);setArranging(false);}} onClose={()=>setArranging(false)}/>}{arranging&&!fleetEnabled&&<TaskFlow onSelecting={setSelecting} selected={targets} onSelection={setTargets} mode={selectionMode} onMode={setSelectionMode} tasks={currentTasks} onClose={()=>setArranging(false)} onCreate={task=>{const next={...saved,tasks:saved.tasks.some(t=>t.id===task.id)?saved.tasks:[task,...saved.tasks]};localStorage.setItem(storageKey,JSON.stringify(next));setSaved(next);setSelectedTaskId(task.id);setArranging(false);setMonitorId(task.id);}}/>}{!arranging&&monitoredTask?.dispatch&&<TaskMonitor readOnly={readOnlyTasks} demoWeather={demoWeather} onDemoWeatherChange={setDemoWeather} key={`${site}:${monitoredTask.id}`} holdReason={eventHoldForTask(monitoredTask,operationalEvents)} executionIssue={executionHold(monitoredTask)} task={monitoredTask} onTree={openTree} onUpdate={updateTask} onClose={()=>setMonitorId(null)}/>}{contextOpen&&<section ref={contextRef} tabIndex={-1} aria-label={stories[story].title+'详情'} className="ws-context-detail">
    <header className="ws-context-header"><div><small>{pages[page]} / {sites[site]} / {story==='market'?'生产计划':story==='health'?'B区巡查':treeId}</small><h2>{stories[story].title}</h2></div><button className="ws-icon" aria-label="收起方案详情" onClick={closeContext}><X size={20}/></button></header>
    <section className="ws-strategy-main"><p>{stories[story].summary}</p>{linkedTask&&<div className="ws-workflow-status"><strong>{linkedTask.status==='已完成'?'处理已回传':linkedTask.status==='待处理'?'待再次处理':'已安排处理'} · {linkedTask.status}</strong><p>{linkedTask.receipt?`${linkedTask.receipt.outcome}：${linkedTask.receipt.note}`:'安排已进入作业中心，等待现场结果。'}</p><button className="ws-primary" onClick={()=>openTask(linkedTask)}>查看关联任务</button><p className="ws-muted">后续产胶与树体变化仍待观察。</p></div>}
     {story==='market'&&<p>当前选择：<strong>{marketPlan}</strong></p>}
     {story==='surface'&&<label className="ws-field">处理方式<select disabled={!!decision} value={surfaceAction} onChange={e=>setSurfaceAction(e.target.value)}>{['复核局部绕行方案','安排现场处理','补拍此位置'].map(a=><option key={a}>{a}</option>)}</select></label>}
     <div className="ws-context-action">{decision?<p className="ws-green"><Check size={16}/> {decision}</p>:<button className="ws-primary" disabled={site==='xian'&&(story==='market'||story==='health')} onClick={()=>requestConfirm(story)}>{stories[story].action}</button>}{!decision&&<button className="ws-link" onClick={()=>commit(story,false)}>保留原方案</button>}<button className="ws-link" onClick={closeContext}>收起，继续{page==='operations'?'处理任务':page==='analytics'?'查看分析':'查看树木'}</button></div>
     <nav className="ws-tabs" aria-label="方案详情层级">{['当前方案','历史记录','试验结果'].map(t=><button key={t} className={t===storyTab?'active':''} onClick={()=>setStoryTab(t)}>{t==='当前方案'?'方案内容':t==='历史记录'?'相关记录':'效果跟踪'}</button>)}</nav>
     {storyTab==='当前方案'&&<>
      {(story==='angle'||story==='surface'||story==='growth')&&<Disclosure key={story} defaultOpen={story==='surface'} title={story==='surface'?'回传照片与标记':'展开割面参考图'}><InspectionPhoto key={story} marks={story==='surface'} active={surfaceMark} onMark={mark=>{if(!decision)setSurfaceMark(mark);}} caption={story==='angle'?'基准角 → 多因素候选 · 参数示意，非精确配准割线':story==='growth'?`${growthYear}年规划预览 · 未改变实际树体`:undefined}/></Disclosure>}
      {story==='angle'&&<div className="ws-panel ws-content-panel"><h3>多因素角度候选</h3><div className="ws-two"><div><small>基准方案</small><h2>30°</h2><span>割线坡角（相对水平）</span></div><div><small>候选方案</small><h2 className="ws-green">28°</h2><span>尚未下发设备</span></div></div><table className="ws-table"><thead><tr><th>输入因素</th><th>演示值</th><th>角度贡献</th></tr></thead><tbody>{[['树种','热研 7-33-97（模拟）','+0.4°'],['树龄','14.0 年（模拟）','-0.5°'],['相对湿度','72%（模拟）','-0.1°'],['土壤水分 / 近7日降雨','32% / 0.8 mm（模拟）','+0.2°'],['胶乳黏度 / 干胶含量','391 mPa·s / 31.4%（模拟）','-0.3°']].map(row=><tr key={row[0]}>{row.map(v=><td key={v}>{v}</td>)}</tr>)}</tbody></table><Disclosure title="查看参数依据与适用条件"><p>候选角度由树种、树龄、湿度、土壤水分、近7日降雨、胶乳黏度和干胶含量的透明演示先验合成；每项输入均带 simulated 来源标记，不能替代实测或农艺实验。</p><p>当前状态为“演示先验 / 证据不足”，不代表已验证的最优角度。需要配对角度—流胶量—干胶量—树皮损耗实验和设备回执后再校准。</p></Disclosure></div>}
      {story==='surface'&&<div className="ws-panel ws-content-panel"><h3>{surfaceMark} · 当前标记</h3><p>{['结构隆起','结节'].includes(surfaceMark)?'识别为结节/结构异常候选：若与计划割线相交，建议跳刀或避让；先人工复核，再重新规划，不能直接下发设备。':['鸟粪','泥巴','表面附着物'].includes(surfaceMark)?`识别为${surfaceMark}等临时附着物：先清理或复拍，确认不影响割线后正常执行，不误触发跳刀。`:surfaceMark==='需重新拍摄'?'证据不足：先补拍并重新配准，暂不形成可执行作业建议。':'表面附着不直接等于跳刀；先判断是否遮挡测量和割线。'}</p><Disclosure title="原始记录与识别说明"><p>示例照片07:08回传，标注为人工设置的演示位置；未接真实识别模型和深度测量。</p></Disclosure><label className="ws-field">修正识别类别<select disabled={!!decision} value={surfaceMark} onChange={e=>setSurfaceMark(e.target.value)}><option>结构隆起</option><option>表面附着物</option><option>结节</option><option>鸟粪</option><option>泥巴</option><option>需重新拍摄</option></select></label><button className="ws-secondary" disabled={!!decision} onClick={()=>{setSaved(s=>({...s,activities:[{id:crypto.randomUUID(),site,time:timeLabel(),title:`${treeId} 标记修正`,contextKey:decisionKey,detail:`${surfaceMark} · 保存于模拟档案，尚未安排处理`},...s.activities]}));notify('标记修正已保存到操作记录');}}>保存当前标记</button></div>}
      {story==='growth'&&<div className="ws-panel ws-content-panel"><h3>未来割面安排</h3><label className="ws-field">查看年份：{growthYear}<input type="range" min="2027" max="2030" value={growthYear} onChange={e=>setGrowthYear(Number(e.target.value))}/></label><Definition items={[[ '预计树围',`${(62.3+(growthYear-2026)*1.4).toFixed(1)} cm（模拟中值）`],['预测范围',`${(61+(growthYear-2026)*1.1).toFixed(1)}–${(64+(growthYear-2026)*1.8).toFixed(1)} cm`],['规划重点',growthYear<2029?'现割面按序利用，保留恢复时间':'复查新割面条件后安排轮换']]} /><p className="ws-muted">示例预测区间，不是生长模型实测输出。保存规划不触发割胶。</p></div>}
      {story==='weather'&&<div className="ws-panel ws-content-panel"><CloudRain size={40}/><h2>C区作业窗口调整</h2><p>原计划06:00–07:30；拟调整08:00–09:30，28棵，其他区域保持不变。</p><button className="ws-primary" onClick={()=>setModal('weather')}>查看调整前后对比</button><Disclosure title="历史观测与预报"><p>过去6小时累计降雨12mm，未来3小时局部阵雨（模拟）。采集与预报时间分别记录，不把预报作为实测。</p></Disclosure></div>}
      {story==='market'&&<div className="ws-panel ws-content-panel"><h2>经营计划情景</h2><p>示例行情指数：近30日 100 → 104。此指数不是实际期货报价或场地售价。</p><div className="ws-scenarios">{['养护优先','均衡安排','增加有效作业窗口'].map((n,i)=><button className={marketPlan===n?'active':''} key={n} onClick={()=>setMarketPlan(n)}><h3>{n}</h3><strong>{[90,100,105][i]}<small> 产量情景指数</small></strong><p>{['增加恢复时间','保持现行割次','仅利用已获准窗口，不突破养护约束'][i]}</p></button>)}</div><Disclosure title="数据来源与计算假设"><p>全部为模拟情景；未接市场报价和成本数据库，故不输出精确利润。不构成证券交易建议。</p></Disclosure></div>}
      {story==='health'&&<div className="ws-panel ws-content-panel"><h2>B区叶片变化 · 等待巡查核实</h2><p>涉及8棵示例树，近三次巡查记录有变化。模型预测不是确诊。</p><div className="ws-health-list">{['09.18 例行观察：无明显变化','09.20 叶片变化记录：3棵','09.22 需现场核实：8棵'].map(t=><p key={t}><Clock size={17}/>{t}</p>)}</div><Disclosure title="查看巡查对象">{Array.from({length:8},(_,i)=><button className="ws-link ws-tree-row" key={i} onClick={()=>openTree(i+50)}>{treeAlias(i+50,site)}<ChevronRight size={13}/></button>)}</Disclosure><p>安排后由巡检员林执行；在作业中心模拟回传巡查结果。</p></div>}
     </>}
     {storyTab==='历史记录'&&<div className="ws-panel ws-content-panel"><h2>操作记录</h2>{related.length?related.map(a=><div className="ws-history" key={a.id}><time>{a.time}</time><div><strong>{a.title}</strong><p>{a.detail}</p></div></div>):<div className="ws-empty"><Clock size={28}/><h3>还没有操作记录</h3><p>确认一条方案后，会在这里保留采用内容与状态。</p></div>}</div>}
     {storyTab==='试验结果'&&<div className="ws-panel ws-content-panel"><h2>经验积累</h2><p>当前方案已有 {related.length} 条本地操作记录。采用方案不等于已证实效果。</p><table className="ws-table"><thead><tr><th>观察项目</th><th>当前状态</th></tr></thead><tbody><tr><td>计划与实际参数</td><td>{currentTasks.filter(t=>t.decisionKey===decisionKey&&t.status==='已完成').length ? `${currentTasks.filter(t=>t.decisionKey===decisionKey&&t.status==='已完成').length} 项任务已完成（模拟回执），尚不能判断策略效果` : '等待模拟任务回执'}</td></tr><tr><td>产胶与树体后效</td><td>尚无可比较样本</td></tr><tr><td>相似树对照</td><td>未分配实验组</td></tr></tbody></table><button className="ws-secondary" onClick={()=>navigate('operations')}>查看关联作业</button></div>}
    </section>

   </section>}
  </div>
  {reviewTarget&&page==='home'&&reviewTarget.site===site&&<aside className="ws-review-dock" aria-label="现场核查"><header><strong>{reviewTarget.kind==='measure'?'生长复测':'现场补拍与核查'}</strong><button className="ws-icon" aria-label="关闭现场核查" onClick={()=>setReviewTarget(null)}><X size={18}/></button></header><ReviewDesk key={`${reviewTarget.site}:${reviewTarget.treeId}:${reviewTarget.kind}`} site={reviewTarget.site} treeIds={[reviewTarget.treeId]} initialKind={reviewTarget.kind} openRequest={reviewTarget.request}/></aside>}
  {incidentTaskId&&currentTasks.find(t=>t.id===incidentTaskId)?.dispatch?.incident&&<SurfaceIncidentView task={currentTasks.find(t=>t.id===incidentTaskId)!} demoWeather={demoWeather} onDemoWeatherChange={!readOnlyTasks?setDemoWeather:undefined} readOnlyReason={eventHoldForTask(currentTasks.find(t=>t.id===incidentTaskId)!,operationalEvents)||executionHold(currentTasks.find(t=>t.id===incidentTaskId)!)} onUpdate={updateTask} onClose={()=>setIncidentTaskId(null)}/>}
  {showTreeList&&<Modal title="树群与档案" onClose={()=>setShowTreeList(false)}><p className="ws-muted">{sites[site]} · {visibleTreeIndices.length} 棵{account?.plot?'承包树':'业务树位置映射'} · 每棵树均可打开独立策略</p><nav className="ws-tabs">{['全部',...new Set(visibleTreeIndices.map(index=>'ABCD'[Math.floor(index/50)]))].map(b=><button key={b} className={treeFilter===b?'active':''} onClick={()=>setTreeFilter(b)}>{b==='全部'?b:b+'区'}</button>)}</nav><div className="ws-tree-grid">{treeIndices.map(i=><button className="ws-secondary" key={i} onClick={()=>openTree(i)}>{treeAlias(i,site)}</button>)}</div></Modal>}
  {modal==='weather'&&<Modal title="今日作业调整" wide onClose={()=>setModal(null)}><p className="ws-muted">{sites[site]} · C区 · 28棵 · 模拟数据</p><div className="ws-two"><section><h3>调整原因</h3><p>清晨降雨影响原定作业窗口，示例规则建议后移。</p><h3>作业时间对比</h3><table className="ws-table"><thead><tr><th>影响项目</th><th>原计划</th><th>调整后</th></tr></thead><tbody>{[['开始时间','06:00','08:00'],['完成时间','07:30','09:30'],['作业树数','28棵','28棵'],['执行设备','R-C','R-C']].map(r=><tr key={r[0]}>{r.map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table></section><section><h3>其他区域安排</h3><p>A/B/D区保持原计划。</p><p>R-C只执行C区任务，其他区域机器人独立工作。</p><Disclosure title="查看天气与土壤记录"><p>历史降雨12mm / 近6h（模拟）；土壤含水率32%（示例站点）。预测与观测分别存储，规则未用于真实生产。</p></Disclosure><p className="ws-muted">仅调整尚未开始的任务；执行中和已完成的任务不变。</p></section></div>{saved.decisions[site+':weather:all']&&<p role="status" className="ws-green">{saved.decisions[site+':weather:all']} · 已记录</p>}<footer className="ws-modal-actions"><button className="ws-secondary" disabled={site!=='hainan'||!!saved.decisions[site+':weather:all']} onClick={()=>commit('weather',false)}>保留原计划</button><button className="ws-primary" disabled={site!=='hainan'||(!!saved.decisions[site+':weather:all']&&!(weatherNeedsUpdate&&saved.decisions[site+':weather:all']==='C区调整为08:00–09:30'))} onClick={()=>commit('weather')}>{weatherNeedsUpdate&&saved.decisions[site+':weather:all']==='C区调整为08:00–09:30'?'同步任务时间':saved.decisions[site+':weather:all']?'已处理':site!=='hainan'?'此示例仅用于海南':'确认调整'}</button></footer></Modal>}
  {modal==='confirm'&&<Modal title={stories[confirmStory].action} onClose={()=>setModal(null)}><p>{sites[site]} · {confirmStory==='health'?'B区8棵':confirmStory==='market'?'园区生产计划':treeId}</p><Definition items={[[ '本次变化',confirmStory==='angle'?'候选坡角28°纳入下次计划':confirmStory==='surface'?surfaceAction:confirmStory==='growth'?`保存${growthYear}年规划`:confirmStory==='market'?marketPlan:'生成一项巡查任务'],['执行方式','仅本地模拟，不发送到设备']]} /><p>确认结果会保留在历史记录。真实参数与权限将在后端接入时校验。</p><footer className="ws-modal-actions"><button className="ws-secondary" onClick={()=>setModal(null)}>返回修改</button><button className="ws-primary" onClick={()=>commit(confirmStory)}>确认保存</button></footer></Modal>}
  {modal==='notifications'&&<Modal title="通知与操作记录" onClose={()=>setModal(null)}>{recent.length?recent.slice(0,20).map(a=><div className="ws-history" key={a.id}><time>{a.time}</time><div><strong>{a.title}</strong><p>{a.detail}</p></div></div>):<p>暂无新操作记录。首页关注事项可查看待处理方案。</p>}</Modal>}
  {modal==='profile'&&<Modal title="演示设置" onClose={()=>setModal(null)}><Definition items={[[ '当前身份',account?`${account.name} · ${account.roleLabel}（演示身份，服务端按身份检查权限）`:roleViews[role].label+'（演示视图，不代表账户授权）'],['数据保存','本机服务端任务记录 + 浏览器展示状态'],['真实设备连接','未启用']]} /><label><input type="checkbox" checked={demoWeather} onChange={e=>setDemoWeather(e.target.checked)}/> 演示天气：模拟适合作业</label><p className="ws-muted">仅供当前标签页模拟任务使用，不改变真实天气、作业时间和其他限制。</p><button className="ws-secondary" onClick={()=>setModal('reset')}>重置本地演示记录</button></Modal>}
  {modal==='reset'&&<Modal title="重置本地演示？" onClose={()=>setModal(null)}><p>将清除本轮确认和模拟执行记录，恢复初始任务；不影响三维资产或任何服务器数据。</p><button className="ws-primary" onClick={()=>{dispatchControllerRef.current?.cancelPending();resetFleet();setSaved({tasks:recoverTasks(initialTasks),activities:[],decisions:{}});setModal(null);notify('本地演示已重置');}}>确认重置</button></Modal>}
  {modal==='search'&&<Modal title="搜索结果" onClose={()=>setModal(null)}>{searchIndex!==null&&<button className="ws-search-result" onClick={()=>openTree(searchIndex)}><Leaf size={20}/>{treeAlias(searchIndex,site)} · 单树档案<ChevronRight size={15}/></button>}{searchTasks.map(t=><button className="ws-search-result" key={t.id} onClick={()=>openTask(t)}><ListChecks size={20}/>{t.title}<span>{t.robot}</span><ChevronRight size={15}/></button>)}{!searchTasks.length&&searchIndex===null&&<p>未找到匹配记录。可输入当前范围树号“{treeAlias(visibleTreeIndices[0]??0,site)}”、任务名称{currentTasks[0]&&<>或设备“{currentTasks[0].robot}”</>}。</p>}</Modal>}
  {toast&&<div className="ws-toast" role="status"><Check size={18}/>{toast}<button className="ws-icon" aria-label="关闭提示" onClick={()=>setToast('')}><X size={15}/></button></div>}
 </main>;
}







