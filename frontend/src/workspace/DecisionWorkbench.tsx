import {useEffect,useState} from 'react';
import {ArrowRight, Bot, Database, GitBranch, ListChecks, MapPin, Sprout} from 'lucide-react';
import {DATA_MODE,kinds,siteIdOf,statuses,useRead,type Park,type View} from '../integration/client';
import type {TreeKind} from '../integration/modelGenerationFlow';
import {when} from '../integration/Views';
import {StrategyRecommendation} from '../integration/StrategyRecommendation';
import {BusinessAssistant} from './BusinessAssistant';
import {sites,treeAlias,type Page,type Site,type Task} from './model';
import {getRecentLatex} from './analyticsData';
import {eventKindLabels,eventScopeLabel,eventStatusLabels,type OperationalEvent} from './operationalEvents';
import {roleViews,scopedTasks,siteHierarchy,treePosition,treeZone,type RoleView} from './workbenchModel';
import {TodayDecisions,type BriefAction} from './TodayDecisions';
import {accountSites,type DemoAccount} from './identityModel';
import {RoleHighlights} from './RoleHighlights';
import type {RobotTarget} from './robotCenterModel';
import './decisionWorkbench.css';

type Props={
  assistantContext?:{site:Site;index:number;request:number}|null;onClearAssistantContext?:()=>void;
  role:RoleView;scope:'all'|Site;tasks:Task[];events:OperationalEvent[];synced:boolean;syncLabel?:string;
  onScope:(site:'all'|Site)=>void;onNavigate:(page:Page,scope?:'all'|Site)=>void;
  onTree:(site:Site,index:number)=>void;onStrategy:(site:Site,index:number,kind:TreeKind)=>void;
  onMarket:(site:Site,modelId:string)=>void;
  onData:(tab:'analytics'|'collection'|'business')=>void;onTask:(task:Task)=>void;onEvents:(site?:Site)=>void;
  onRobot?:(site:Site,robot:RobotTarget)=>void;
  account?:DemoAccount;onParkPlan?:(planId?:string)=>void;onCerebellum?:()=>void;
};
const stateName:Record<string,string>={available:'可进入作业评估',immature:'未开割',resting:'休割',blocked:'暂缓作业',unknown:'待确认'};
const blockerName:Record<string,string>={circumference:'补测树围',resting:'休割养护',inspection:'补充树表影像',registration:'完成影像配准',missing_evidence:'补充观测证据'};
const treeKinds:TreeKind[]=['tapping_angle','surface_action','growth_plan','pest_risk'];
const healthName={normal:'正常',watch:'健康关注',confirmed_issue:'已记录健康问题',unknown:'健康待确认'};
function careReasons(tree:Park['trees'][number]):string[]{
  const reasons:string[]=[];
  if(tree.tappingStatus!=='available')reasons.push(stateName[tree.tappingStatus]);
  if(tree.healthStatus!=='normal')reasons.push(healthName[tree.healthStatus]);
  if(tree.circumferenceCm===null)reasons.push('树围待补测');
  return reasons;
}

function TaskList({title,tasks,synced,onTask,onAll}:{title:string;tasks:Task[];synced:boolean;onTask:(task:Task)=>void;onAll:()=>void}){
  return <section className="dw-role-panel"><header><h2>{title}</h2><button className="rb-button" onClick={onAll}>任务中心 →</button></header>
    {!synced?<p>正在读取任务记录…</p>:tasks.length?<div className="dw-task-list">{tasks.slice(0,5).map(task=><button key={`${task.site}:${task.id}`} onClick={()=>onTask(task)}><span><strong>{task.title}</strong><small>{sites[task.site]} · {task.block}区 · {task.robot}{task.date?' · '+task.date:''}</small></span><span><b>{task.status}</b><small>{task.done} / {task.count} 棵</small></span><ArrowRight size={16}/></button>)}</div>:<p>当前范围暂无此类任务。</p>}
    {synced&&tasks.length>5&&<p>另有 {tasks.length-5} 项，可在任务中心查看。</p>}
  </section>;
}

export function DecisionWorkbench({assistantContext,onClearAssistantContext,role,scope,tasks,events,synced,onScope,onNavigate,onTree,onStrategy,onMarket,onData,onTask,onEvents,account,onParkPlan,onCerebellum,onRobot}:Props){
  useEffect(()=>{if(assistantContext&&scope===assistantContext.site)document.querySelector('[aria-label="园区业务助手"]')?.scrollIntoView({block:'start'});},[assistantContext?.request,scope]);
  const firstTree=account?.plot?.treeIds[0]??'T-0001';
  const [zone,setZone]=useState<string|null>(null),[treeId,setTreeId]=useState(firstTree);
  const [kind,setKind]=useState<TreeKind>('tapping_angle');
  useEffect(()=>{setZone(null);setTreeId(firstTree);},[scope]);
  const selectedSite=scope==='all'?null:scope;
  const showsTrees=!account&&(role==='grower'||role==='manager');
  const park=useRead<Park>(showsTrees&&selectedSite?`/api/demo/park?siteId=${siteIdOf(selectedSite)}`:null);
  const view=useRead<View>(showsTrees&&selectedSite?`/api/demo/trees/${treeId}/view?kind=${kind}&dataMode=${DATA_MODE}&siteId=${siteIdOf(selectedSite)}`:null);
  const focus=roleViews[role],relevant=scopedTasks(tasks,scope,showsTrees?zone:null);
  const trees=(park.data?.trees||[]).filter(t=>!zone||treeZone(t.treeId)===zone);
  const careTrees=trees.map(tree=>({tree,reasons:careReasons(tree)})).filter(item=>item.reasons.length);
  const current=park.data?.trees.find(t=>t.treeId===treeId);
  const route=view.data?.strategyRoute;
  const strategy=view.data?.strategy;
  const currentIndex=treePosition(treeId);
  const count=(status:Task['status'])=>synced?relevant.filter(t=>t.status===status).length:'—';
  const openEvents=events.filter(event=>event.status!=='closed'&&(scope==='all'||event.siteId===siteIdOf(scope)));
  const [prompt,setPrompt]=useState<{message:string;id:number}|null>(null);
  // Each brief item ends in one concrete next step; route it to the page or conversation that handles it.
  const runAction=(action:BriefAction)=>{
    if(action.type==='park_plan')onParkPlan?.(action.planId);
    else if(action.type==='price_factors')onParkPlan?.();
    else if(action.type==='cerebellum')onCerebellum?.();
    else if(action.type==='events')onEvents(selectedSite??undefined);
    else if(action.type==='robots')onNavigate('robots');
    else if(action.type==='collection')onData('collection');
    else if(action.type==='assistant')setPrompt({message:action.message,id:Date.now()});
    else if(action.type==='task'){const task=tasks.find(item=>item.id===action.taskId&&(!selectedSite||item.site===selectedSite));if(task)onTask(task);else onNavigate('operations');}
    else if(action.type==='plot_tree'&&selectedSite){const index=treePosition(action.treeId);if(index!==null)onStrategy(selectedSite,index,'growth_plan');}
    else if(selectedSite&&account?.plot){const index=treePosition(account.plot.treeIds[0]);if(index!==null)onTree(selectedSite,index);}
  };
  const chooseZone=(next:string)=>{setZone(next);const first=park.data?.trees.find(t=>treeZone(t.treeId)===next);if(first)setTreeId(first.treeId);};
  const actions=role==='grower'?[
    {icon:Sprout,title:'树木与养护',text:'查看单树档案与养护建议',action:()=>{if(selectedSite&&currentIndex!==null)onStrategy(selectedSite,currentIndex,'growth_plan');else onNavigate('home');}},
    {icon:Database,title:'产胶记录',text:'按日期和林班查看产胶样本',action:()=>onData('analytics')},
    {icon:MapPin,title:'收胶与报价',text:'比较收胶点、加工厂和示例报价',action:()=>onData('collection')},
    {icon:ListChecks,title:account?'我的作业':'本园作业',text:'查看已安排和已完成的任务',action:()=>onNavigate('operations')},
  ]:role==='operator'?[
    {icon:Bot,title:'设备与当前树',text:'定位机器人、负责片区与作业对象',action:()=>onNavigate('robots')},
    {icon:GitBranch,title:'处理天气与故障',text:'查看影响范围并跟进恢复',action:()=>onEvents()},
    {icon:ListChecks,title:'执行任务',text:'进入任务控制与回执记录',action:()=>onNavigate('operations')},
    {icon:MapPin,title:'胶园现场',text:'查看模拟路径与作业状态',action:()=>onNavigate('home')},
  ]:role==='executive'?[
    {icon:Database,title:'园区地图',text:'定位各园区并查看业务概况',action:()=>onNavigate('overview','all')},
    {icon:GitBranch,title:'经营与生产策略',text:'查看当前园区的经营安排',action:()=>onNavigate('decisions')},
    {icon:ListChecks,title:'任务与储运',text:'查看当前园区执行与交接',action:()=>onNavigate('operations')},
    {icon:Database,title:'来源与资料',text:'核对公开参考和现场资料',action:()=>onNavigate('analytics')},
  ]:[
    {icon:Database,title:'库存与销售',text:'查看库存、加工和销售出货',action:()=>onData('business')},
    {icon:GitBranch,title:'生产策略',text:'安排割胶和养护',action:()=>onNavigate('decisions')},
    {icon:Bot,title:'任务执行',text:'跟进作业与收胶',action:()=>onNavigate('operations')},
  ];
  const taskSummary=(role==='manager'||role==='operator')&&<section className="dw-task-overview" aria-label="作业概况">
    <header><h2>作业概况</h2><p>{scope==='all'?'全部园区':'当前园区'} · 点击查看任务</p></header>
    <div className="dw-metrics" aria-label="所选范围任务状态">{[['待安排',count('待开始')],['执行中',count('执行中')],['需处理',count('待处理')],['已完成',count('已完成')]].map(([label,value])=><button key={label} onClick={()=>onNavigate(scope==='all'?'overview':'operations')}><span>{label}</span><strong>{value}</strong><small>项{showsTrees&&zone?' · '+zone+'区':''}</small></button>)}</div>
  </section>;
  const shortcuts=<section className="dw-flow" aria-label={`${focus.label}常用操作`}>{actions.map(item=><button key={item.title} onClick={item.action}><item.icon size={22}/><strong>{item.title}</strong><small>{item.text}</small><ArrowRight size={16}/></button>)}</section>;
  const comparisonSites=(account?accountSites(account):Object.keys(siteHierarchy) as Site[]).filter(site=>scope==='all'||site===scope);
  const dataSections=<>
    {role==='manager'&&<div className="dw-role-grid" aria-label="农场管理待办"><TaskList title="优先处理" tasks={relevant.filter(t=>t.status==='待处理')} synced={synced} onTask={onTask} onAll={()=>onNavigate('operations')}/><TaskList title="待安排作业" tasks={relevant.filter(t=>t.status==='待开始')} synced={synced} onTask={onTask} onAll={()=>onNavigate('operations')}/></div>}
    {role==='operator'&&<div className="dw-role-grid" aria-label="机器人运营工作区">
      <section className="dw-role-panel"><header><h2>天气与设备异常</h2><button className="rb-button" onClick={()=>onEvents()}>处理异常 →</button></header>{!synced?<p>正在读取事件记录…</p>:openEvents.length?<div className="dw-event-list">{openEvents.map(event=><button key={event.id} onClick={()=>onEvents(event.siteId.replace('demo-','') as Site)}><span><strong>{eventKindLabels[event.kind]} · {eventScopeLabel(event)}</strong><small>{sites[event.siteId.replace('demo-','') as Site]} · {eventStatusLabels[event.status]}</small><p>{event.note}</p></span><ArrowRight size={16}/></button>)}</div>:<p>当前范围没有待处理的天气或设备事件。</p>}</section>
      <TaskList title="执行与待处理队列" tasks={relevant.filter(t=>t.status==='待处理'||t.status==='执行中'||t.status==='待开始')} synced={synced} onTask={onTask} onAll={()=>onNavigate('operations')}/>
    </div>}
    {role==='executive'&&<section className="dw-role-panel dw-comparison" aria-label="跨园区比较"><header><div><h2>{scope==='all'?'各园区对照':'园区执行概况'}</h2><p>任务来自当前记录；胶乳使用 2026-09-16—09-22 的 7 日演示样本。</p></div><button className="rb-button" onClick={()=>onNavigate('overview','all')}>在地图中查看 →</button></header><div className="dw-comparison-scroll"><table><thead><tr><th>园区 / 类型</th><th>待处理</th><th>执行中</th><th>已完成 / 全部</th><th>7 日胶乳样本</th><th>查看</th></tr></thead><tbody>{comparisonSites.map(site=>{const rows=scopedTasks(tasks,site),latex=getRecentLatex(site,7);return <tr key={site}><th>{sites[site]}<small>{siteHierarchy[site].center}</small></th><td>{synced?rows.filter(t=>t.status==='待处理').length:'—'}</td><td>{synced?rows.filter(t=>t.status==='执行中').length:'—'}</td><td>{synced?`${rows.filter(t=>t.status==='已完成').length} / ${rows.length}`:'—'}</td><td>{latex===null?'试验站 · 无生产序列':`${latex} kg`}</td><td><button className="rb-button" onClick={()=>onNavigate('overview',site)}>查看园区 →</button></td></tr>;})}</tbody></table></div></section>}
    {showsTrees&&<section className="dw-section" aria-label="组织与园区下钻"><header><div><h2>{role==='grower'?'所选胶园的树木与养护':'从中心进入胶园'}</h2><p>{role==='grower'?'查看承包树的状态与养护建议。':'选择园区、分区或单树。'}</p></div><button className="rb-button" onClick={()=>role==='grower'?onData('analytics'):onNavigate('overview')}>{role==='grower'?'查看产胶记录':'运营统计'}</button></header>
      <nav className="dw-breadcrumb" aria-label="当前管理层级"><button onClick={()=>onScope('all')}>{role==='grower'?'选择胶园':'全部中心'}</button>{selectedSite&&<><span>› {siteHierarchy[selectedSite].center} › {siteHierarchy[selectedSite].region} ›</span><button onClick={()=>setZone(null)}>{siteHierarchy[selectedSite].park}</button>{zone&&<span>› {zone}区</span>}</>}</nav>
      {scope==='all'?<div className="dw-sites">{(Object.keys(siteHierarchy) as Site[]).map(site=><button key={site} onClick={()=>onScope(site)}><MapPin size={20}/><small>{siteHierarchy[site].center} · {siteHierarchy[site].region}</small><h3>{siteHierarchy[site].park}</h3><p>{siteHierarchy[site].note}</p><span>进入胶园 <ArrowRight size={15}/></span></button>)}{role==='manager'&&<article><Database size={20}/><small>杭州 · 数据与云脑中心</small><h3>数据与模型服务</h3><p>跨园区数据与模型服务。</p><button className="rb-button" onClick={()=>onNavigate('analytics')}>查看现有数据</button></article>}</div>:<>
        <div className="dw-zones">{['A','B','C','D'].map(z=><button key={z} aria-pressed={zone===z} onClick={()=>chooseZone(z)}><strong>{z}区</strong><span>{park.data?park.data.trees.filter(t=>treeZone(t.treeId)===z).length:'—'} 棵档案</span><small>{role==='grower'?(park.data?`${park.data.trees.filter(t=>treeZone(t.treeId)===z&&careReasons(t).length>0).length} 棵养护 / 待确认`:'正在读取树木状态'):`${synced?scopedTasks(tasks,selectedSite!,z).filter(t=>!['已完成','已取消'].includes(t.status)).length:'—'} 项未结束任务`}</small></button>)}</div>
        {park.error&&<p role="alert">树档案读取失败：{park.error} <button className="rb-button" onClick={park.reload}>重试</button></p>}
        {role==='grower'&&<section className="dw-grower-care" aria-label="所选区域养护对象"><header><h3>{zone?zone+'区':'全园'} · 养护与待确认</h3><span>{park.data?`${careTrees.length} / ${trees.length} 棵`:'正在读取'}</span></header>{park.data&&(!careTrees.length?<p>当前分区暂无已标记的养护或待确认对象。</p>:<div>{careTrees.slice(0,6).map(({tree,reasons})=>{const index=treePosition(tree.treeId)!;return <button key={tree.treeId} onClick={()=>onStrategy(selectedSite!,index,tree.healthStatus!=='normal'||tree.tappingStatus==='blocked'||tree.tappingStatus==='unknown'?'pest_risk':'growth_plan')}><strong>{treeAlias(index,selectedSite!)}</strong><span>{reasons.join(' · ')}</span><small>查看养护依据 →</small></button>;})}</div>)}{careTrees.length>6&&<p>另有 {careTrees.length-6} 棵，可通过下方单树选择器查看。</p>}</section>}
        <div className="dw-tree-layout"><div className="dw-tree-list"><label>选择单树<select aria-label="工作台单树" value={treeId} onChange={e=>setTreeId(e.target.value)}>{trees.map(t=><option value={t.treeId} key={t.treeId}>{treePosition(t.treeId)===null?t.treeId:treeAlias(treePosition(t.treeId)!,selectedSite!)} · {stateName[t.tappingStatus]||t.tappingStatus}</option>)}</select></label>{current&&<p className="dw-tree-condition">{current.circumferenceCm===null?'树围待补测':`树围 ${current.circumferenceCm} cm`} · {stateName[current.tappingStatus]||current.tappingStatus}</p>}<button className="rb-button" disabled={currentIndex===null||!current} onClick={()=>onTree(selectedSite!,currentIndex!)}><Sprout size={16}/>打开单树档案</button><details className="dw-result-details"><summary>档案信息</summary><p>{park.data?`档案截至 ${when(park.data.asOf)}`:'正在读取树档案…'}</p>{current&&<dl><dt>档案来源</dt><dd>{current.fieldRecord?(current.fieldRecord.provenanceMode==='measured'?'导入实测':'导入模拟'):(current.provenance.mode==='simulated'?'模拟样本':current.provenance.mode)} · {current.fieldRecord?.sourceName??current.provenance.sourceId}</dd><dt>测量时间</dt><dd>{current.measuredAt?when(current.measuredAt):'未知'}</dd></dl>}</details></div>
          <section className="dw-reasoning" aria-label="单树决策依据"><header><h3>单树策略</h3><select aria-label="工作台策略类型" value={kind} onChange={e=>setKind(e.target.value as TreeKind)}>{treeKinds.map(k=><option key={k} value={k}>{kinds[k]}</option>)}</select></header>
            {view.error?<p role="alert">策略暂不可读：{view.error} <button className="rb-button" onClick={view.reload}>重新读取</button></p>:!view.data?<p>正在读取策略…</p>:<>
            {strategy?<StrategyRecommendation strategy={strategy}/>:<p className="dw-no-strategy">尚未生成{ kinds[kind] }策略，打开策略后可发起分析。</p>}
            <p className={`dw-result-status${view.data.strategyStatus==='available'?'':' dw-warning'}`}>{statuses[view.data.strategyStatus]||view.data.strategyStatus}{strategy&&view.data.strategyStatus!=='available'?' · 当前结果不可用于新任务':''}</p>
            {!!route?.blockers.length&&<p className="dw-warning">下一步：{route.blockers.map(key=>blockerName[key]||'补充所需数据').join('；')}</p>}
            <button className="rb-button rb-primary" disabled={currentIndex===null} onClick={()=>onStrategy(selectedSite!,currentIndex!,kind)}>打开策略 <ArrowRight size={16}/></button>
            <details className="dw-result-details"><summary>判断依据与来源</summary><dl><dt>处理路径</dt><dd>{route?route.executor==='small_brain'?'小脑规则':route.executor==='big_brain'?'大模型综合分析':'先补充数据':'暂无分流记录'}</dd><dt>判断依据</dt><dd>{route?.reason||'当前记录未提供分流依据'}</dd><dt>结果来源</dt><dd>{!strategy?'尚无策略包':strategy.fallback?'规则保底（大模型未产出可用结果）':strategy.generationMetadata?`模型结果 · ${strategy.modelVersion||'版本待核验'}`:'演示规则'}</dd>{strategy&&<><dt>生成时间</dt><dd>{when(strategy.generatedAt)}</dd></>}</dl></details></>}
          </section></div>
        {role==='manager'&&<div className="dw-device-line"><Bot size={19}/><p>{selectedSite==='hainan'?`${zone?`R-${zone}`:'R-A / R-B / R-C / R-D'} · 模拟设备`:'园区模拟设备'}</p><button className="rb-button" onClick={()=>onNavigate('robots')}>管理机器人</button><button className="rb-button" onClick={()=>onNavigate('home')}>查看胶园空间</button><button className="rb-button" onClick={()=>onNavigate('operations')}>任务与储运</button></div>}
      </>}
    </section>}
  </>;
  return <section className="dw-page rb-page" aria-labelledby="dw-title">
    <header className="dw-head"><div><h1 id="dw-title">{focus.title}</h1><p>{focus.focus}</p></div><button className="rb-button rb-primary" onClick={()=>onNavigate(focus.primary)}>{({decisions:'查看策略',home:'进入胶园',operations:'处理任务',robots:'管理机器人',overview:'查看运营统计'})[focus.primary]}<ArrowRight size={17}/></button></header>
    {account&&<RoleHighlights role={role} scope={scope} account={account} tasks={tasks} events={events} synced={synced} onNavigate={onNavigate} onData={onData} onRobot={onRobot}/>}
    {taskSummary}
    {account&&selectedSite&&<TodayDecisions account={account} site={selectedSite} onAction={runAction} onTree={index=>onTree(selectedSite,index)}/>}
    {dataSections}
    {(role!=='executive'||selectedSite)&&shortcuts}
    {selectedSite?<BusinessAssistant key={`${selectedSite}:${role}`} site={selectedSite} role={role} treeId={assistantContext?.site===selectedSite?'T-'+String(assistantContext.index+1).padStart(4,'0'):null} contextLabel={assistantContext?.site===selectedSite?treeAlias(assistantContext.index,selectedSite):undefined} onReturnToTree={assistantContext?.site===selectedSite?()=>onTree(selectedSite,assistantContext.index):undefined} onClearTree={onClearAssistantContext} zone={assistantContext?.site===selectedSite?'ABCD'[Math.floor(assistantContext.index/50)]:account?.plot?account.plot.zone:zone} tasks={tasks} onTask={onTask} onNavigate={onNavigate} onMarket={onMarket} onStrategy={onStrategy} prompt={prompt} onBrainAction={(type,planId)=>type==='park_plan'?onParkPlan?.(planId):type==='cerebellum'?onCerebellum?.():onData('collection')}/>:<div className="ba-select-site">选择一个园区后，可以连续讨论生产安排、天气调整与执行复盘。</div>}
  </section>;
}

