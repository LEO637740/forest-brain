import type {RobotTarget} from '../robotCenterModel';
import {useEffect,useMemo,useState} from 'react';
import type {FieldTreeCatalog} from '../../../../shared/fieldTrees';
import {demoParkBoundary,demoZoneBoundary,isDemoSpatialRecord,type DemoSpatialZone} from '../../../../shared/demoSpatial';
import {orgNodeIds,orgNodes,parks,regions,productionRegions,productionSites,type OrgNodeId,type RegionId} from '../../../../shared/parkCatalog';
import {siteIdOf,type Park} from '../../integration/client';
import {useSpatialRead as useRead} from './useSpatialRead';
import type {TreeKind} from '../../integration/modelGenerationFlow';
import {sites,treeAlias,type Site,type Task} from '../model';
import {GeoMapCanvas,type GeoArea,type GeoMarker,type GeoView} from './GeoMapCanvas';
import {buildSpatialTrees,spatialZones,fieldBoundaryPoints,type SpatialTree} from './spatialCatalog';
import {FLAG_LABELS,RUBBER_PRODUCERS,RUBBER_PRODUCTION_SOURCE,TIER_LABELS,productionTier} from '../../../../shared/rubberProducers';
import {CHINA_M49,domesticProduction,producerMarkers,provinceAreas,provincePoints,wanTonnes,worldShare,type ProductionSource} from './worldMapModel';
import {TreeSpatialInspector} from './TreeSpatialInspector';
import {OrchardMap} from '../restructure/OrchardMap';
import './spatialExplorer.css';

type Level='world'|'overview'|'region'|'park'|'zone'|'tree';
export type SpatialExplorerProps={
  tasks:Task[];scope:'all'|Site;allowedSites?:Site[];
  onScope:(scope:'all'|Site)=>void;
  onTree:(site:Site,index:number)=>void;
  onStrategy:(site:Site,index:number,kind:TreeKind)=>void;
  onRobot:(site:Site,robot:RobotTarget)=>void;
  onData:(site:Site)=>void;
  onTask:(task:Task)=>void;
  onField:(site:Site)=>void;
};
const regionalView:GeoView={center:{longitude:107,latitude:23.5},zoom:5};
// Fixed rather than fitted: fitting across the antimeridian would put the Americas east of Asia.
const worldView:GeoView={center:{longitude:15,latitude:6},zoom:2};
const located=(entry:SpatialTree)=>entry.position!==null;


export function SpatialExplorer({tasks,scope,allowedSites,onScope,onTree,onStrategy,onRobot,onData,onTask,onField}:SpatialExplorerProps){
  const canOpenPark=(id:Site)=>!allowedSites||allowedSites.includes(id);
  const visibleProductionSites=productionSites.filter(canOpenPark);
  const parksInRegion=(id:RegionId)=>visibleProductionSites.filter(site=>parks[site].regionId===id);
  const visibleRegions=productionRegions.filter(id=>parksInRegion(id).length>0);
  const visibleOrgIds=orgNodeIds.filter(id=>!orgNodes[id].site||canOpenPark(orgNodes[id].site!));
  const [site,setSite]=useState<Site|null>(scope==='all'?null:scope);
  const [region,setRegion]=useState<RegionId|null>(scope==='all'?null:parks[scope].regionId);
  const [level,setLevel]=useState<Level>(scope==='all'?'overview':'park');
  const [producer,setProducer]=useState<string|null>(null);
  const selectedProducer=RUBBER_PRODUCERS.find(item=>item.m49===producer);
  const [org,setOrg]=useState<OrgNodeId|null>(null);
  const [zone,setZone]=useState<string|null>(null),[treeId,setTreeId]=useState<string|null>(null);
  const [query,setQuery]=useState('');
  const [showThemeMap,setShowThemeMap]=useState(false);
  const [view,setView]=useState<GeoView>(scope==='all'?regionalView:{center:parks[scope].center,zoom:17});
  // Official national and provincial totals; growers cannot read park sources and see outlines only.
  const sources=useRead<{sources:ProductionSource[]}>(level==='world'||level==='overview'?'/api/sources':null);
  const domestic=domesticProduction(sources.data?.sources);
  const catalog=useRead<FieldTreeCatalog>(site?`/api/field/trees?siteId=${siteIdOf(site)}`:null);
  const park=useRead<Park>(site?`/api/demo/park?siteId=${siteIdOf(site)}`:null);
  const records=catalog.data?.items??[];
  const entries=useMemo(()=>buildSpatialTrees(park.data?.trees??[],records),[park.data,records]);
  const zones=useMemo(()=>site?spatialZones(entries,tasks,site):[],[entries,tasks,site]);
  const currentZone=zones.find(item=>item.id===zone);
  const selected=entries.find(entry=>entry.treeId===treeId);
  const visibleTrees=entries.filter(entry=>(!zone||entry.zone===zone)&&`${treeAlias(entry.index,site!)} ${entry.record?.sourceTreeId??''} ${entry.treeId}`.toLowerCase().includes(query.toLowerCase()));
  const allLocated=entries.filter(located),scopeLocated=entries.filter(entry=>(!zone||entry.zone===zone)&&located(entry));
  const demoZones=zones.filter(item=>{const trees=entries.filter(entry=>entry.zone===item.id);return trees.length>0&&trees.every(entry=>entry.record&&isDemoSpatialRecord(entry.record));});
  const importedBoundaries=catalog.data?.boundaries;
  const areas:GeoArea[]=level==='overview'?provinceAreas(null,domestic,id=>parksInRegion(id).length).filter(area=>visibleRegions.some(id=>area.id===`region:${id}`)):level==='world'||level==='region'?[]:importedBoundaries?importedBoundaries.zones.map(item=>({id:`zone:${item.zoneId}`,label:`${item.zoneId}区`,points:fieldBoundaryPoints(item.polygon),selected:zone===item.zoneId,tone:importedBoundaries.provenanceMode})):site?demoZones.map(item=>({id:`zone:${item.id}`,label:item.name,points:demoZoneBoundary(site,item.id as DemoSpatialZone),selected:zone===item.id,tone:'simulated'})):[];
  const boundary=importedBoundaries?fieldBoundaryPoints(importedBoundaries.park):site&&demoZones.length===4?demoParkBoundary(site):undefined;
  const hasDemoLayout=!site||demoZones.length>0;

  useEffect(()=>{
    // Internal navigation already sets the level; a different scope comes from the global selector.
    if(scope===site||(scope==='all'&&site===null))return;
    setShowThemeMap(false);
    setSite(scope==='all'?null:scope);setRegion(scope==='all'?null:parks[scope].regionId);
    setLevel(scope==='all'?'overview':'park');setZone(null);setTreeId(null);setQuery('');
    setView(scope==='all'?regionalView:{center:parks[scope].center,zoom:17});
  },[scope]);

  function openPark(next:Site){if(!canOpenPark(next))return;setSite(next);setRegion(parks[next].regionId);setLevel('park');setZone(null);setTreeId(null);setQuery('');setView({center:parks[next].center,zoom:17});onScope(next);}
  function openZone(next:string){setZone(next);setLevel('zone');setTreeId(null);setQuery('');const position=zones.find(item=>item.id===next)?.position;if(position)setView({center:position,zoom:18});}
  function openTree(entry:SpatialTree){setZone(entry.zone);setTreeId(entry.treeId);setLevel('tree');if(entry.position)setView({center:entry.position,zoom:20});}
  function openWorld(){setSite(null);setRegion(null);setLevel('world');setZone(null);setTreeId(null);setQuery('');setView(worldView);onScope('all');}
  function openOrg(next:OrgNodeId){const target=orgNodes[next].site;if(target)openPark(target);else setOrg(current=>current===next?null:next);}
  function openRegion(next:RegionId|null){setSite(null);setRegion(next);setLevel(next?'region':'overview');setZone(null);setTreeId(null);setQuery('');setView(next?{center:regions[next].center,zoom:8}:regionalView);onScope('all');}

  const regionParks=region?parksInRegion(region):[];
  const parkMarkers:GeoMarker[]=regionParks.map(id=>({id:`site:${id}`,position:parks[id].center,kind:'site',label:sites[id],tone:'simulated',detail:'进入园区查看分区'}));
  const treeMarkers=(trees:SpatialTree[]):GeoMarker[]=>trees.map(entry=>({id:`tree:${entry.treeId}`,position:entry.position!,label:entry.record?.sourceTreeId||treeAlias(entry.index,site!),kind:'tree',tone:entry.record!.provenanceMode,selected:entry.treeId===treeId,detail:entry.record?.provenanceMode==='measured'?'导入实测坐标':'导入模拟坐标'}));
  // Organisation nodes use their own marker so they never read as a rubber park.
  const orgMarkers:GeoMarker[]=visibleOrgIds.map(id=>({id:`org:${id}`,position:orgNodes[id].center,kind:'org',label:orgNodes[id].short,pinned:orgNodes[id].short.split(' · ')[0],labelSide:id==='xian'?'above':'right',selected:org===id,detail:`${orgNodes[id].role} · 非产胶园区`}));
  const markers:GeoMarker[]=level==='world'?producerMarkers(producer):level==='overview'?orgMarkers:level==='region'?parkMarkers:level==='park'?[...zones.filter(item=>item.position&&!areas.some(area=>area.id===`zone:${item.id}`)).map((item):GeoMarker=>({id:`zone:${item.id}`,position:item.position!,label:`${item.name} · ${item.locatedCount} 棵已定位`,kind:'zone',tone:item.measuredCount?'measured':'simulated'})),...treeMarkers(allLocated)]:treeMarkers(scopeLocated);
  const fitPoints=level==='world'||level==='tree'?[]:level==='overview'?[...provincePoints(),...orgMarkers.map(marker=>marker.position)]:level==='region'?parkMarkers.map(marker=>marker.position):[...scopeLocated.map(entry=>entry.position!),...(zone?areas.find(item=>item.id===`zone:${zone}`)?.points??[]:boundary??[])];
  const mapAreas=level==='zone'||level==='tree'?areas.filter(area=>area.id===`zone:${zone}`):areas;
  function selectMarker(id:string){const [kind,value]=id.split(':');if(kind==='producer'){if(value===CHINA_M49)openRegion(null);else setProducer(value);}else if(kind==='org')openOrg(value as OrgNodeId);else if(kind==='region')openRegion(value as RegionId);else if(kind==='site')openPark(value as Site);else if(kind==='zone')openZone(value);else if(kind==='tree'){const entry=entries.find(item=>item.treeId===value);if(entry)openTree(entry);}}

  if(showThemeMap && site && canOpenPark(site) && productionSites.includes(site) && scope===site) return <OrchardMap key={site} site={site} tasks={tasks.filter(task=>task.site===site)} onBack={()=>setShowThemeMap(false)} onTree={index=>onTree(site,index)}/>;

  return <section className="sx-explorer" data-level={level} aria-label="区域到单树地图">
    <header className="sx-head"><div><h2>{level==='world'?'全球天然橡胶产地与产量':level==='overview'?'中国 · 云南 · 海南 · 广东':level==='region'?`${regions[region!].name} · 选择园区`:level==='park'?sites[site!]:level==='zone'?`${sites[site!]} · ${zone}区`:treeAlias(selected?.index??0,site!)}</h2></div><span className="sx-source">{level==='world'?`FAOSTAT ${RUBBER_PRODUCTION_SOURCE.year} 年 · 气泡大小表示产量量级`:level==='overview'?'省界轮廓 · 园区为模拟':importedBoundaries?`地理底图 · 已导入${importedBoundaries.provenanceMode==='measured'?'实测':'模拟'}园区与分区边界`:hasDemoLayout?'地理底图 · 园区、地块与树位均为模拟':'OpenStreetMap 地理底图'}</span></header>
    <nav className="sx-breadcrumb" aria-label="地图层级"><button aria-current={level==='world'?'page':undefined} onClick={openWorld}>全球</button>{level!=='world'&&<><span>›</span><button aria-current={level==='overview'?'page':undefined} onClick={()=>openRegion(null)}>中国</button></>}{region&&<><span>›</span><button aria-current={level==='region'?'page':undefined} onClick={()=>openRegion(region)}>{regions[region].name}</button></>}{site&&<><span>›</span><button aria-current={level==='park'?'page':undefined} onClick={()=>openPark(site)}>{sites[site]}</button></>}{zone&&<><span>›</span><button aria-current={level==='zone'?'page':undefined} onClick={()=>openZone(zone)}>{zone}区</button></>}{level==='tree'&&selected&&<><span>›</span><strong>{selected.record?.sourceTreeId||treeAlias(selected.index,site!)}</strong></>}</nav>
    <div className="sx-layout"><div className="sx-map-column">
      <div className="sx-map"><GeoMapCanvas center={view.center} zoom={view.zoom} markers={markers} areas={mapAreas} showAreaLabels={level!=='zone'&&level!=='tree'} boundary={boundary} onMarker={selectMarker} onViewChange={setView} fitPoints={fitPoints.length?fitPoints:undefined} ariaLabel="逐级下钻地理地图"/>
        {site&&(selected?!selected.position:scopeLocated.length===0)&&<div className="sx-coordinate-entry"><div><strong>{selected?'这棵树':zone?`${zone}区`:'当前园区'}尚未导入坐标</strong><p>导入坐标后显示地图点位。</p></div><button onClick={()=>onData(site)}>导入园区坐标 →</button></div>}
      </div>
      <div className="sx-map-caption"><span>{level==='world'?`${RUBBER_PRODUCERS.length} 个主要产胶国 · 合计占全球 ${(worldShare(RUBBER_PRODUCERS.reduce((sum,item)=>sum+item.tonnes,0))*100).toFixed(1)}%`:level==='overview'?`${visibleRegions.length} 个产胶省 · ${visibleProductionSites.length} 个模拟园区 · ${visibleOrgIds.length} 个组织节点（蓝色菱形，非产胶园区）`:level==='region'?`${regions[region!].name} · ${regionParks.length} 个模拟园区`:`${allLocated.length} / ${entries.length} 棵有坐标 · ${zone?`${zone}区 ${scopeLocated.length} 棵已定位 · 可放大地图或在列表选树`:'选择分区或树木查看详情'}`}</span></div>
      {(importedBoundaries||selected?.record)&&<details className="sx-map-records"><summary>坐标与来源</summary>
      {importedBoundaries&&<p className="sx-position-note">边界来源：{importedBoundaries.sourceName} · 采集 {new Date(importedBoundaries.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间） · 树位来源分别保留</p>}
      {selected?.record&&<div className="sx-position-note"><span>{selected.record.provenanceMode==='measured'?'实测资料':'模拟资料'} · {selected.position?`${selected.position.longitude}, ${selected.position.latitude}`:'未提供坐标'}</span>{selected.record.elevationM!=null&&<span>地面高程 {selected.record.elevationM} m · {selected.record.elevationDatum||'未注明基准'}</span>}</div>}
      </details>}
    </div><div className="sx-side">
      {level==='world'?<><section className="sx-anrpc" aria-label="ANRPC 全球产量展望">
        <h3>全球天然橡胶产量 · ANRPC</h3>
        <dl><div><dt>2025 年修订估算</dt><dd>1495.2 <small>万吨</small></dd></div><div><dt>2026 年全年预测</dt><dd>1503.9 <small>万吨</small></dd></div></dl>
        <p><a href="https://www.anrpc.org/newsla/anrpc-releases-monthly-nr-statistical-report-august-2026" target="_blank" rel="noreferrer">ANRPC 2026 年 8 月统计月报</a> · 2026-09-30 发布。全球合计，估算与预测会随报告修订。</p>
        <p>下方分国排行和地图仍采用 FAOSTAT 2024 年数据；两者来源、年份和统计口径不同，不直接混用。</p>
      </section><h3>主要产胶国 · {RUBBER_PRODUCTION_SOURCE.year} 年</h3>
        <div className="sx-tiers" aria-label="产量量级">{(['major','large','medium'] as const).map(tier=><span key={tier} className={`sx-tier sx-tier-${tier}`}><i aria-hidden="true"/>{TIER_LABELS[tier]} · {RUBBER_PRODUCERS.filter(item=>productionTier(item.tonnes)===tier).length} 国</span>)}</div>
        {selectedProducer&&<div className="sx-producer-detail"><strong>{selectedProducer.name} · {wanTonnes(selectedProducer.tonnes)} 万吨</strong><span>占全球 {(worldShare(selectedProducer.tonnes)*100).toFixed(1)}% · {TIER_LABELS[productionTier(selectedProducer.tonnes)]} · {FLAG_LABELS[selectedProducer.flag]}</span><small>公开统计，不是本系统的园区。</small></div>}
        <button className="sx-china-entry" onClick={()=>openRegion(null)}><strong>进入中国 →</strong><span>云南 · 海南 · 广东，可逐级查看到园区和单树</span></button>
        <ol className="sx-producer-list" aria-label="产胶国产量排行">{RUBBER_PRODUCERS.map(item=><li key={item.m49}><button aria-pressed={producer===item.m49} onClick={()=>item.m49===CHINA_M49?openRegion(null):setProducer(item.m49)}><span>{item.name}</span><span className="sx-bar" aria-hidden="true"><i style={{width:`${Math.max(2,item.tonnes/RUBBER_PRODUCERS[0].tonnes*100)}%`}}/></span><strong>{wanTonnes(item.tonnes)} 万吨</strong></button></li>)}</ol>
        <p className="sx-source-note">来源：<a href={RUBBER_PRODUCTION_SOURCE.url} target="_blank" rel="noreferrer">{RUBBER_PRODUCTION_SOURCE.title}</a>，{RUBBER_PRODUCTION_SOURCE.year} 年数据；全球合计 {wanTonnes(RUBBER_PRODUCTION_SOURCE.worldTonnes)} 万吨。气泡位置只标示主要种植区，不是种植园坐标。</p>
      </>:level==='overview'?<><h3>产胶省与园区</h3>
        <p className="sx-domestic-total">{domestic.national?<>全国天然橡胶产量 <strong>{domestic.national.value} 万吨</strong>（{domestic.national.period} 年，{domestic.national.publisher}）</>:'全国产量：暂未读取到官方数据'}</p>
        <div className="sx-site-list">{visibleRegions.map(id=><button key={id} aria-label={`选择${regions[id].name}区域`} onClick={()=>openRegion(id)}><strong>{regions[id].name} →</strong><span>{parksInRegion(id).length} 个园区{id==='hainan'&&domestic.hainan?` · ${domestic.hainan.value} 万吨（${domestic.hainan.period} 年，${domestic.hainan.publisher}）`:''}</span></button>)}</div>
        {domestic.rest!==null&&<p className="sx-source-note">云南、广东暂无官方全年分省产量；两省合计约 {domestic.rest} 万吨，由全国减海南推算。</p>}
        <section className="sx-org-nodes" aria-label="组织节点"><h4>组织节点 · 不计入产胶园区</h4>{visibleOrgIds.map(id=>{const node=orgNodes[id];return <button key={id} aria-pressed={org===id} onClick={()=>openOrg(id)}><strong>{node.name}{node.site?' →':''}</strong><span>{node.role}</span>{(org===id||node.site)&&<small>{node.note}</small>}</button>;})}</section></>:level==='region'?<><h3>{regions[region!].name}的园区</h3><div className="sx-site-list">{regionParks.map(id=><button key={id} aria-label={`进入${sites[id]}`} onClick={()=>openPark(id)}><strong>{sites[id]} →</strong><span>4 个分区 · 200 棵模拟树木</span></button>)}</div><button className="sx-center-toggle" onClick={()=>openRegion(null)}>← 返回区域选择</button></>:<>
        <div className={`sx-zone-nav${level==='park'?'':' is-compact'}`}><header><h3>园区分区</h3><span>{zones.length} 个分区 · {entries.length} 棵树</span></header><div className="sx-zone-strip" aria-label="地图分区">{zones.map(item=><button key={item.id} aria-label={`选择${item.name}`} aria-pressed={zone===item.id} onClick={()=>openZone(item.id)}><strong>{item.name}<span aria-hidden="true">{zone===item.id?'✓':'→'}</span></strong><span>{item.treeCount} 棵树</span><small>{item.locatedCount?`${item.locatedCount} 棵已定位`:'可按树号查看'}</small></button>)}</div></div>
        <div className="sx-side-content" key={`${site}:${level}:${zone}`}>
        {level==='tree'&&selected?<TreeSpatialInspector site={site!} treeId={selected.treeId} tasks={tasks} onTree={index=>onTree(site!,index)} onStrategy={(index,kind)=>onStrategy(site!,index,kind)} onRobot={next=>onRobot(site!,next)} onTask={onTask}/>:<div className="sx-park-summary"><h3>{zone?`${zone}区 · 选择单树`:'选择分区'}</h3><p>{zone?`${currentZone?.treeCount??0} 棵档案 · ${currentZone?.robotLabel}`:'查看树木、策略与设备。'}</p></div>}
        {level==='zone'&&<><input aria-label="地图搜索树木" placeholder={`搜索${zone}区树号或现场原树号`} value={query} onChange={event=>setQuery(event.target.value)}/><div className="sx-tree-list" aria-label="地图树木列表">{visibleTrees.map(entry=><button key={entry.treeId} onClick={()=>openTree(entry)}><strong>{entry.record?.sourceTreeId||treeAlias(entry.index,site!)}</strong><small>{entry.position?entry.record?.provenanceMode==='measured'?'实测定位':'模拟定位':'坐标待补充'} →</small></button>)}</div>{!visibleTrees.length&&<p className="sx-empty-search">未找到匹配树木，请更换树号。</p>}</>}
        {park.error&&<p role="status">档案读取失败：{park.error} <button onClick={park.reload}>重试</button></p>}
        </div>
        <div className="sx-side-actions">{site&&productionSites.includes(site)&&canOpenPark(site)&&<button onClick={()=>setShowThemeMap(true)}>查看三维主题图层 →</button>}<button onClick={()=>onData(site!)}>现场资料</button><button onClick={()=>onField(site!)}>三维演示场景 →</button></div>
      </>}
    </div></div>
  </section>;
}
