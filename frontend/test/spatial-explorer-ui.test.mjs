import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst,transformWithOxc} from 'vite';
import {sites,treeAlias} from '../src/workspace/model.ts';
import {orgNodeIds,orgNodes,parks,regions,productionRegions,productionSites} from '../../shared/parkCatalog.ts';
import {treePosition,treeZone} from '../src/workspace/workbenchModel.ts';
import {buildSpatialTrees,spatialSitePosition,spatialZones,fieldBoundaryPoints} from '../src/workspace/spatial/spatialCatalog.ts';
import {fieldBoundaryTemplate} from '../src/workspace/fieldImportModel.ts';
import {DEMO_SPATIAL_SOURCE,demoTreePosition,demoParkBoundary,demoZoneBoundary,isDemoSpatialRecord} from '../../shared/demoSpatial.ts';
import {FLAG_LABELS,RUBBER_PRODUCERS,RUBBER_PRODUCTION_SOURCE,TIER_LABELS,productionTier} from '../../shared/rubberProducers.ts';
import {CHINA_M49,domesticProduction,producerMarkers,provinceAreas,provincePoints,wanTonnes,worldShare} from '../src/workspace/spatial/worldMapModel.ts';

// The sources API as the backend returns it: official national and Hainan totals for the same year.
const productionSources={sources:[
  {id:'production_national',status:'available',url:'https://nkj.moa.gov.cn/',data:{publisher:'农垦局',metrics:[{name:'天然橡胶产量',value:97.3,unit:'万吨',scope:'中国',period:'2025'}]}},
  {id:'production_hainan',status:'available',url:'https://stats.hainan.gov.cn/',data:{publisher:'海南省统计局',metrics:[{name:'橡胶产量',value:34.95,unit:'万吨',scope:'海南省',period:'2025'}]}},
]};

const file='spatial/SpatialExplorer.tsx';
const transformed=await transformWithOxc(readFileSync(new URL(`../src/workspace/${file}`,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
const source=parseAst(transformed.code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>transformed.code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const noop=()=>{};
const field=(treeId,values)=>({treeId,recordId:`xsbn-${treeId}`,siteId:'demo-xsbn',sourceName:'地图交互测试资料',observedAt:'2026-10-19T00:00:00Z',importedAt:'2026-10-19T01:00:00Z',variety:null,circumferenceCm:null,heightM:null,measurementHeightM:null,coordinateSystem:'WGS84',provenanceMode:'measured',elevationDatum:null,...values});
const records=[
  field('T-0051',{sourceTreeId:'林地-051',longitude:100.81,latitude:22.01}),
  field('T-0052',{sourceTreeId:'林地-052',longitude:100.82,latitude:22.02,provenanceMode:'simulated'}),
  field('T-0053',{sourceTreeId:'林地-053',heightM:12}),
];
const parkTrees=['T-0001','T-0051','T-0052','T-0053'].map(treeId=>({treeId}));

function text(element){
  if(typeof element==='string'||typeof element==='number')return String(element);
  if(!React.isValidElement(element))return '';
  if(typeof element.type==='function')return text(element.type(element.props));
  return React.Children.toArray(element.props.children).map(text).join('');
}
function walk(element,predicate){
  if(!React.isValidElement(element))return [];
  const found=predicate(element)?[element]:[];
  if(typeof element.type==='function')return [...found,...walk(element.type(element.props),predicate)];
  return [...found,...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];
}

// The geographic renderer and detail card expose their public callbacks, keeping this test on navigation and site identity.
function GeoMapCanvas({markers,areas=[],onMarker}){
  return React.createElement('div',{'aria-label':'test-map'},[...markers,...areas].map(marker=>React.createElement('button',{key:marker.id,'aria-label':`map:${marker.id}`,onClick:()=>onMarker(marker.id)},marker.label)));
}
function TreeSpatialInspector({site,treeId,onTree,onStrategy,onRobot}){
  const index=treePosition(treeId);
  return React.createElement('aside',{'aria-label':'test-inspector'},`${site}:${treeId}`,
    React.createElement('button',{onClick:()=>onTree(index)},'打开单树档案'),
    React.createElement('button',{onClick:()=>onStrategy(index,'growth_plan')},'打开生长策略'),
    React.createElement('button',{onClick:()=>onRobot(treeZone(treeId))},'打开本区设备'));
}
function OrchardMap({site,tasks,onBack,onTree}){
  return React.createElement('section',{'aria-label':'test-orchard', 'data-site':site},
    React.createElement('span',null,`${site}:${tasks.map(task=>task.id).join(',')}`),
    React.createElement('button',{onClick:onBack},'返回园区地图'),
    React.createElement('button',{onClick:()=>onTree(51)},'打开三维主题中的树'));
}

function mount(initialScope='all',items=records,boundaries=undefined){
  const states=[],effects=[],requests=[],calls=[];
  let stateCursor=0,effectCursor=0,dirty=false,element;
  const pendingEffects=[];
  const props={scope:initialScope,tasks:[],...Object.fromEntries(['onTree','onStrategy','onRobot','onData','onTask','onField'].map(name=>[name,(...args)=>calls.push([name,...args])]))};
  props.onScope=scope=>{calls.push(['onScope',scope]);props.scope=scope;};
  const bindings={
    React,sites,treeAlias,orgNodeIds,orgNodes,parks,regions,productionRegions,productionSites,buildSpatialTrees,spatialSitePosition,spatialZones,fieldBoundaryPoints,demoParkBoundary,demoZoneBoundary,isDemoSpatialRecord,GeoMapCanvas,TreeSpatialInspector,OrchardMap,FLAG_LABELS,RUBBER_PRODUCERS,RUBBER_PRODUCTION_SOURCE,TIER_LABELS,productionTier,CHINA_M49,domesticProduction,producerMarkers,provinceAreas,provincePoints,wanTonnes,worldShare,
    siteIdOf:site=>`demo-${site}`,
    window:{addEventListener:noop,removeEventListener:noop},
    useState(initial){const i=stateCursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{const value=typeof next==='function'?next(states[i]):next;if(!Object.is(states[i],value)){states[i]=value;dirty=true;}}];},
    useMemo:factory=>factory(),
    useEffect(effect,deps){const i=effectCursor++,previous=effects[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){effects[i]={deps,cleanup:previous?.cleanup};pendingEffects.push(()=>{effects[i].cleanup?.();effects[i].cleanup=effect();});}},
    useRead(url){requests.push(url);return {data:!url?undefined:url.startsWith('/api/field/trees')?{boundaries:url.endsWith('demo-xsbn')?boundaries:undefined,items:url.endsWith('demo-xsbn')?items:[],importedCount:url.endsWith('demo-xsbn')?items.length:0}:url.startsWith('/api/demo/park')?{trees:parkTrees}:url==='/api/sources'?productionSources:undefined,reload:noop};},
  };
  const Component=new Function(...Object.keys(bindings),source+';return SpatialExplorer;')(...Object.values(bindings));
  function render(patch={}){Object.assign(props,patch);let passes=0;do{dirty=false;stateCursor=0;effectCursor=0;element=Component(props);for(const effect of pendingEffects.splice(0))effect();assert.ok(++passes<10,'navigation effects should settle');}while(dirty);return element;}
  render();
  return {
    calls,requests,render,
    get element(){return element;},
    get map(){return walk(element,node=>node.type===GeoMapCanvas)[0].props;},
    get inspector(){return walk(element,node=>node.type===TreeSpatialInspector)[0]?.props;},
    get breadcrumb(){return walk(element,node=>node.props['aria-label']==='地图层级')[0];},
    click(label,container=element){const button=walk(container,node=>node.type==='button'&&(node.props['aria-label']||text(node).trim())===label)[0];assert.ok(button,`visible button: ${label}`);button.props.onClick();render();},
  };
}

test('manager map navigation offers its own park while center and anonymous views retain the regional parks',()=>{
  const page=mount('guangdong-maoming');
  page.render({allowedSites:['guangdong-maoming']});
  page.click('广东',page.breadcrumb);
  const parkButtons=walk(page.element,node=>node.type==='button'&&node.props['aria-label']?.startsWith('进入广东'));
  assert.deepEqual(parkButtons.map(node=>node.props['aria-label']),['进入广东茂名模拟园区']);
  assert.deepEqual(page.map.markers.map(marker=>marker.id),['site:guangdong-maoming']);
  page.click('进入广东茂名模拟园区');
  assert.equal(page.calls.at(-1)[1],'guangdong-maoming');
  assert.ok(!page.requests.some(path=>path?.includes('demo-guangdong-zhanjiang')||path?.includes('demo-guangdong-yangjiang')));
  page.click('广东',page.breadcrumb);
  page.render({allowedSites:Object.keys(parks)});
  assert.equal(page.map.markers.length,3);
  page.render({allowedSites:undefined});
  assert.equal(page.map.markers.length,3);
});

test('theme view is restricted to the selected accessible park and returns to its map',()=>{
  const page=mount('xsbn');
  const tasks=[{id:'xsbn-task',site:'xsbn'},{id:'hainan-task',site:'hainan'}];
  page.render({allowedSites:['xsbn'],tasks});
  page.click('查看三维主题图层 →');
  const view=walk(page.element,node=>node.type===OrchardMap)[0];
  assert.ok(view,'the three-dimensional theme view should be mounted');
  assert.equal(view.props.site,'xsbn');
  assert.deepEqual(view.props.tasks.map(task=>task.id),['xsbn-task'],'tasks in another park must not reach this view');
  page.click('打开三维主题中的树');
  assert.deepEqual(page.calls.at(-1),['onTree','xsbn',51]);
  page.click('返回园区地图');
  assert.equal(page.element.props['data-level'],'park');
  assert.match(text(page.breadcrumb),/云南景洪模拟园区/);
  assert.equal(walk(page.element,node=>node.type===OrchardMap).length,0);

  page.render({allowedSites:['hainan']});
  assert.equal(walk(page.element,node=>node.type==='button'&&text(node).includes('查看三维主题图层')).length,0,'an inaccessible park must not expose the theme view');
  const revoked=mount('xsbn');
  revoked.render({allowedSites:['xsbn']});
  revoked.click('查看三维主题图层 →');
  revoked.render({allowedSites:['hainan']});
  assert.equal(walk(revoked.element,node=>node.type===OrchardMap).length,0,'revoked access must hide an already-open theme view');
  const trial=mount('xian');
  assert.equal(walk(trial.element,node=>node.type==='button'&&text(node).includes('查看三维主题图层')).length,0,'the trial station is not a production park');
});

test('changing park or clearing scope exits the previous theme view',()=>{
  const page=mount('xsbn');
  page.render({allowedSites:['xsbn','hainan']});
  page.click('查看三维主题图层 →');
  page.render({scope:'hainan'});
  assert.equal(walk(page.element,node=>node.type===OrchardMap).length,0);
  assert.match(text(page.breadcrumb),/海南海口模拟园区/);
  page.click('查看三维主题图层 →');
  assert.equal(walk(page.element,node=>node.type===OrchardMap)[0].props.site,'hainan');
  page.render({scope:'all'});
  assert.equal(walk(page.element,node=>node.type===OrchardMap).length,0);
  assert.equal(page.element.props['data-level'],'overview');
});

test('all-park entry starts at the three production regions and retains explicit global navigation',()=>{
  const page=mount();
  assert.equal(page.element.props['data-level'],'overview');
  assert.deepEqual(page.map.areas.map(area=>area.id),['region:yunnan','region:hainan','region:guangdong']);
  assert.deepEqual(page.map.markers.map(marker=>marker.id),['org:hangzhou','org:xian']);
  assert.match(text(page.element),/中国 · 云南 · 海南 · 广东/);
  page.click('全球',page.breadcrumb);
  assert.equal(page.element.props['data-level'],'world');
  assert.equal(page.map.markers.length,RUBBER_PRODUCERS.length);
  page.click('map:producer:159');
  assert.equal(page.element.props['data-level'],'overview');
  page.click('map:region:guangdong');
  page.click('map:site:guangdong-maoming');
  assert.equal(page.element.props['data-level'],'park');
  page.render({scope:'all'});
  assert.equal(page.element.props['data-level'],'overview');
  assert.deepEqual(page.map.areas.map(area=>area.id),['region:yunnan','region:hainan','region:guangdong']);
  const singlePark=mount('guangdong-maoming');
  assert.equal(singlePark.element.props['data-level'],'park');
  assert.match(text(singlePark.breadcrumb),/广东茂名模拟园区/);
});

test('world view separates ANRPC estimates and forecasts from the FAOSTAT country map',()=>{
  const page=mount();
  page.click('全球',page.breadcrumb);
  const outlook=walk(page.element,node=>node.props['aria-label']==='ANRPC 全球产量展望')[0];
  assert.ok(outlook);
  assert.match(text(outlook),/2025 年修订估算1495\.2 万吨/);
  assert.match(text(outlook),/2026 年全年预测1503\.9 万吨/);
  assert.match(text(outlook),/2026 年 8 月统计月报 · 2026-09-30 发布/);
  assert.match(text(outlook),/分国排行和地图仍采用 FAOSTAT 2024 年数据/);
  assert.ok(walk(outlook,node=>node.type==='a'&&node.props.href==='https://www.anrpc.org/newsla/anrpc-releases-monthly-nr-statistical-report-august-2026').length);
  assert.match(text(page.element),/FAOSTAT 2024 年 · 气泡大小表示产量量级/);
  assert.match(text(page.element),/主要产胶国 · 2024 年/);
  assert.match(text(page.element),/泰国.*478\.9 万吨/);
  assert.equal(page.map.markers.length,RUBBER_PRODUCERS.length);
});

test('one geographic drill-down keeps the same park when opening tree records, strategies and field data',()=>{
  const page=mount();
  // The regional default retains a global reference view through the breadcrumb.
  page.click('全球',page.breadcrumb);
  assert.equal(page.map.markers.length,RUBBER_PRODUCERS.length);
  assert.ok(page.map.markers.every(marker=>marker.kind==='producer'&&marker.size>0));
  assert.match(text(page.element),/泰国.*478\.9 万吨/);
  page.click('map:producer:764');
  assert.equal(page.map.markers.find(marker=>marker.id==='producer:764').selected,true);
  assert.match(text(page.element),/占全球 32\.3%/);
  page.click('map:producer:159');
  assert.deepEqual(page.map.areas.map(area=>area.id),['region:yunnan','region:hainan','region:guangdong']);
  assert.match(text(page.element),/全国天然橡胶产量 97\.3 万吨（2025 年，农垦局）/);
  assert.match(text(page.element),/34\.95 万吨（2025 年，海南省统计局）/);
  assert.match(text(page.element),/两省合计约 62\.35 万吨，由全国减海南推算/);
  page.click('map:region:yunnan');
  assert.deepEqual(page.map.markers.map(marker=>marker.id),['site:xsbn','site:yunnan-mengla','site:yunnan-menghai']);
  page.click('map:site:xsbn');
  assert.deepEqual(page.calls.at(-1),['onScope','xsbn']);
  assert.ok(page.requests.includes('/api/demo/park?siteId=demo-xsbn'));
  assert.deepEqual(page.map.center,parks.xsbn.center);
  assert.equal(page.map.fitPoints.length,2);
  assert.match(text(page.breadcrumb),/全球›中国›云南›云南景洪模拟园区/);
  assert.equal(walk(page.breadcrumb,node=>node.props['aria-current']==='page').map(text).join(''),'云南景洪模拟园区');

  page.click('map:zone:B');
  assert.equal(walk(page.breadcrumb,node=>node.props['aria-current']==='page').map(text).join(''),'B区');
  page.click('map:tree:T-0052');
  assert.match(text(page.breadcrumb),/全球›中国›云南›云南景洪模拟园区›B区›林地-052/);
  assert.equal(page.inspector.site,'xsbn');
  assert.equal(page.inspector.treeId,'T-0052');
  page.click('打开单树档案');assert.deepEqual(page.calls.at(-1),['onTree','xsbn',51]);
  page.click('打开生长策略');assert.deepEqual(page.calls.at(-1),['onStrategy','xsbn',51,'growth_plan']);
  page.click('打开本区设备');assert.deepEqual(page.calls.at(-1),['onRobot','xsbn','B']);
  page.click('现场资料');assert.deepEqual(page.calls.at(-1),['onData','xsbn']);

  page.click('中国',page.breadcrumb);
  assert.deepEqual(page.calls.at(-1),['onScope','all']);
  assert.equal(page.inspector,undefined);
  assert.equal(walk(page.breadcrumb,node=>node.type==='button').map(text).join(''),'全球中国');
  assert.deepEqual(page.map.markers.map(marker=>marker.id),['org:hangzhou','org:xian']);assert.equal(page.map.areas.length,3);
  page.click('全球',page.breadcrumb);
  assert.ok(page.map.markers.every(marker=>marker.kind==='producer'));
});

test('the Hangzhou center and the Xi\'an station are organisation nodes on the China map, never production parks',()=>{
  const page=mount();
  const nodes=page.map.markers;
  assert.deepEqual(nodes.map(marker=>[marker.id,marker.kind]),[['org:hangzhou','org'],['org:xian','org']]);
  assert.deepEqual(nodes[0].position,orgNodes.hangzhou.center);
  assert.deepEqual(nodes.map(marker=>marker.pinned),['杭州','西安']);
  assert.ok(nodes.every(marker=>/非产胶园区/.test(marker.detail)));
  assert.ok(nodes.every(marker=>page.map.fitPoints.some(point=>point===marker.position)),'both nodes stay in view');
  // Production lists keep their nine parks; neither node is one of them.
  assert.ok(!productionSites.includes('xian'));
  assert.match(text(page.element),/3 个产胶省 · 9 个模拟园区 · 2 个组织节点/);
  assert.match(text(page.element),/组织节点 · 不计入产胶园区/);
  // The center has no park to open: selecting it only shows what it does.
  const callsBefore=page.calls.length;
  page.click('map:org:hangzhou');
  assert.equal(page.calls.length,callsBefore);
  assert.equal(page.map.markers.find(marker=>marker.id==='org:hangzhou').selected,true);
  assert.match(text(page.element),/汇聚各园区数据，比较园区、审批全园策略与小脑参数；不种植橡胶/);
  assert.equal(page.map.areas.length,3);
  page.click('map:org:xian');
  assert.deepEqual(page.calls.at(-1),['onScope','xian']);
  assert.match(text(page.breadcrumb),/全球›中国›西安模拟试验站/);
});

test('only supplied coordinates become map markers and a simulated tree retains its source through drill-down',()=>{
  const page=mount('xsbn');
  page.click('map:zone:B');
  assert.deepEqual(page.map.markers.map(marker=>marker.id),['tree:T-0051','tree:T-0052']);
  assert.equal(page.map.markers.find(marker=>marker.id==='tree:T-0051').tone,'measured');
  const simulated=page.map.markers.find(marker=>marker.id==='tree:T-0052');
  assert.equal(simulated.tone,'simulated');assert.equal(simulated.detail,'导入模拟坐标');
  assert.match(text(page.element),/林地-053坐标待补充/);

  page.click('map:tree:T-0052');
  assert.equal(page.map.markers.find(marker=>marker.selected).tone,'simulated');
  const note=walk(page.element,node=>node.props.className==='sx-position-note')[0];
  assert.match(text(note),/模拟资料/);assert.doesNotMatch(text(note),/实测资料/);
  assert.equal(page.map.fitPoints,undefined,'single-tree focus must not be reset by automatic fit');
  assert.deepEqual(page.map.center,{longitude:100.82,latitude:22.02});
  assert.equal(page.map.zoom,20);
  assert.equal(page.map.showAreaLabels,false);
  assert.deepEqual(page.map.markers.map(marker=>marker.id),['tree:T-0051','tree:T-0052']);

  page.render({scope:'hainan'});
  assert.equal(page.inspector,undefined);
  assert.match(text(page.breadcrumb),/海南海口模拟园区/);assert.doesNotMatch(text(page.breadcrumb),/云南景洪|B区|林地-052/);
});

test('parks start with four zones; selecting a zone opens only its trees even without coordinates',()=>{
  const page=mount('xsbn',[]);
  assert.deepEqual(page.map.markers,[]);
  assert.equal(walk(page.element,node=>node.props['aria-label']==='地图树木列表').length,0,'park level should show zones before individual trees');
  assert.equal(walk(page.element,node=>node.props['aria-label']==='地图搜索树木').length,0);
  page.click('导入园区坐标 →');assert.deepEqual(page.calls.at(-1),['onData','xsbn']);
  const zones=walk(page.element,node=>node.props['aria-label']==='地图分区')[0];
  assert.deepEqual(walk(zones,node=>node.type==='button').map(node=>node.props['aria-label']),['选择A区','选择B区','选择C区','选择D区']);
  page.click('选择B区');
  assert.deepEqual(page.map.markers,[]);
  const list=walk(page.element,node=>node.props['aria-label']==='地图树木列表')[0];
  assert.equal(walk(list,node=>node.type==='button').length,3);
  assert.doesNotMatch(text(list),/XS-A-/);
  walk(list,node=>node.type==='button'&&text(node).startsWith('XS-B-0002'))[0].props.onClick();page.render();
  page.click('打开单树档案');assert.deepEqual(page.calls.at(-1),['onTree','xsbn',51]);

  page.click('选择A区');
  assert.equal(page.inspector,undefined,'zone switch should exit the selected tree');
  const nextList=walk(page.element,node=>node.props['aria-label']==='地图树木列表')[0];
  assert.equal(walk(nextList,node=>node.type==='button').length,1);
  assert.match(text(nextList),/XS-A-0001/);assert.doesNotMatch(text(nextList),/XS-B-/);
  page.click('云南景洪模拟园区',page.breadcrumb);
  assert.equal(walk(page.element,node=>node.props['aria-label']==='地图树木列表').length,0);
  assert.equal(walk(page.element,node=>node.type==='button'&&node.props['aria-pressed']===true).length,0);
});

test('built-in demo plots show all four selectable boundaries and keep the selected plot tied to its 50 trees',()=>{
  const demoRecords=Array.from({length:200},(_,index)=>field(`T-${String(index+1).padStart(4,'0')}`,{
    sourceName:DEMO_SPATIAL_SOURCE,provenanceMode:'simulated',...demoTreePosition('xsbn',index),
  }));
  const page=mount('xsbn',demoRecords);
  assert.deepEqual(page.map.areas.map(area=>area.id),['zone:A','zone:B','zone:C','zone:D']);
  assert.deepEqual(page.map.boundary,demoParkBoundary('xsbn'));
  assert.equal(page.map.markers.length,200,'overview retains all tree points');
  assert.match(text(page.element),/地块与树位均为模拟/);
  page.click('map:zone:B');
  assert.deepEqual(page.map.areas.filter(area=>area.selected).map(area=>area.id),['zone:B']);
  assert.equal(page.map.areas.length,1,'other zone labels and boundaries do not obstruct tree selection');
  assert.equal(page.map.showAreaLabels,false);
  assert.equal(page.map.markers.length,50);
  assert.ok(page.map.markers.every(marker=>Number(marker.id.slice(-4))>=51&&Number(marker.id.slice(-4))<=100));
  page.click('map:tree:T-0052');
  assert.equal(page.inspector.treeId,'T-0052');
  assert.equal(page.inspector.site,'xsbn');
});


test('each production region contains three independent parks and returning to the region allows switching parks',()=>{
  const page=mount();
  for(const region of productionRegions){
    page.click(`map:region:${region}`);
    const expected=productionSites.filter(site=>parks[site].regionId===region);
    assert.equal(expected.length,3);
    assert.deepEqual(page.map.markers.map(marker=>marker.id),expected.map(site=>`site:${site}`));
    for(const site of expected){
      page.click(`map:site:${site}`);
      assert.ok(page.requests.includes(`/api/demo/park?siteId=${parks[site].siteId}`));
      assert.ok(page.requests.includes(`/api/field/trees?siteId=${parks[site].siteId}`));
      page.click('选择A区');
      const list=walk(page.element,node=>node.props['aria-label']==='地图树木列表')[0];
      const first=walk(list,node=>node.type==='button')[0];
      first.props.onClick();page.render();
      assert.equal(page.inspector.site,site);
      page.click('打开生长策略');assert.deepEqual(page.calls.at(-1),['onStrategy',site,0,'growth_plan']);
      page.click(regions[region].name,page.breadcrumb);
      assert.equal(page.inspector,undefined);
      assert.deepEqual(page.map.markers.map(marker=>marker.id),expected.map(site=>`site:${site}`));
    }
    page.click('中国',page.breadcrumb);
  }
  assert.equal(page.map.areas.length,3);
});


test('persisted measured boundaries replace simulated shapes and retain source while tree positions keep their own provenance',()=>{
  const imported={...fieldBoundaryTemplate('xsbn').boundaries,sourceName:'现场园区边界测绘',observedAt:'2026-10-20T02:00:00Z',provenanceMode:'measured'};
  for(const polygon of [imported.park,...imported.zones.map(zone=>zone.polygon)])for(const point of polygon.coordinates[0])point[0]+=.01;
  const demoRecords=Array.from({length:200},(_,index)=>field(`T-${String(index+1).padStart(4,'0')}`,{sourceName:DEMO_SPATIAL_SOURCE,provenanceMode:'simulated',...demoTreePosition('xsbn',index)}));
  const page=mount('xsbn',demoRecords,imported);
  assert.deepEqual(page.map.boundary,fieldBoundaryPoints(imported.park));
  assert.notDeepEqual(page.map.boundary,demoParkBoundary('xsbn'));
  assert.deepEqual(page.map.areas.map(area=>area.tone),['measured','measured','measured','measured']);
  assert.match(text(page.element),/已导入实测园区与分区边界/);
  assert.match(text(page.element),/现场园区边界测绘/);
  assert.doesNotMatch(text(page.element),/园区、地块与树位均为模拟/);
  assert.ok(page.map.markers.every(marker=>marker.tone==='simulated'));
  page.click('map:zone:B');
  assert.deepEqual(page.map.areas.find(area=>area.id==='zone:B').points,fieldBoundaryPoints(imported.zones[1].polygon));
  assert.equal(page.map.markers.length,50);
  page.render({scope:'hainan'});
  assert.equal(page.map.boundary,undefined,'switching parks does not reuse another park boundary');
});
