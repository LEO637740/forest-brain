import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';
import {roleViews,scopedTasks,siteHierarchy,treePosition,treeZone} from '../src/workspace/workbenchModel.ts';
import {sites,treeAlias} from '../src/workspace/model.ts';
import {getRecentLatex} from '../src/workspace/analyticsData.ts';
import {eventKindLabels,eventScopeLabel,eventStatusLabels,eventHoldForZone} from '../src/workspace/operationalEvents.ts';
import {accountSites,can} from '../src/workspace/identityModel.ts';
import {robotViews} from '../src/workspace/robotCenterModel.ts';

async function declarations(file){
  const {code}=await transformWithOxc(readFileSync(new URL(`../src/workspace/${file}`,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
  return parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
}
const source=await declarations('DecisionWorkbench.tsx');
const highlightsSource=await declarations('RoleHighlights.tsx');
const stub=()=>null;
const BusinessAssistant=()=>React.createElement('section',{'aria-label':'园区业务助手'},'问橡胶大脑');
const TodayDecisions=()=>React.createElement('section',{'aria-label':'角色今日事项'},'角色今日事项');
const accountFor=role=>({role,accountId:role,siteIds:role==='executive'?['demo-hainan','demo-xsbn','demo-xian']:['demo-hainan'],permissions:role==='grower'?['plot.read']:['site.read'],...(role==='grower'?{plot:{siteId:'demo-hainan',treeIds:['T-0051'],zone:'B',areaMu:1,treeCount:1,label:'B区承包地'}}:{})});
const trees=[['T-0001','available'],['T-0002','resting'],['T-0051','blocked'],['T-0052','unknown']].map(([treeId,tappingStatus])=>({treeId,tappingStatus,healthStatus:'normal',circumferenceCm:60,measuredAt:'2026-10-19',provenance:{mode:'simulated',sourceId:'sample'}}));
const task=(id,site,status)=>({id,site,status,title:id,block:'A',robot:'R-A',count:2,done:0,kind:'割胶'});
const tasks=[task('海南待复核','hainan','待处理'),task('海南待安排','hainan','待开始'),task('海南执行中','hainan','执行中'),task('版纳待复核','xsbn','待处理'),task('西安已完成','xian','已完成')];
const events=[
  {id:'rain',siteId:'demo-hainan',kind:'rain',zone:null,status:'active',note:'园区降雨'},
  {id:'fault',siteId:'demo-hainan',kind:'device_fault',zone:1,status:'resolved',note:'割胶头检修完成'},
  {id:'closed',siteId:'demo-hainan',kind:'device_fault',zone:0,status:'closed',note:'历史已恢复'},
  {id:'foreign',siteId:'demo-xsbn',kind:'rain',zone:null,status:'active',note:'版纳降雨'},
];
function text(element){
  if(typeof element==='string'||typeof element==='number')return String(element);
  if(!React.isValidElement(element))return '';
  if(typeof element.type==='function')return text(element.type(element.props));
  return React.Children.toArray(element.props.children).map(text).join('');
}
function walk(element,predicate){
  if(!React.isValidElement(element))return [];
  if(typeof element.type==='function')return walk(element.type(element.props),predicate);
  return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];
}
function mount(role,scope='hainan',parkTrees=trees,strategyView={strategyStatus:'needs_generation'}){
  let cursor=0,element;const slots=[],requests=[],highlightRequests=[],calls=[];
  const highlightsBindings={React,ArrowRight:stub,Bot:stub,sites,accountSites,scopedTasks,siteHierarchy,eventHoldForZone,robotViews,
    useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),subscribeFleet:stub,getFleetSnapshot:()=>({ready:false,jobs:{},zones:[]}),siteIdOf:site=>'demo-'+site,
    useRead(url){highlightRequests.push(url);return {data:{inventory:{availableKg:41,stockKg:68,inTransitKg:12,salesRevenueCny:206}},reload:stub};}};
  const RoleHighlights=new Function(...Object.keys(highlightsBindings),highlightsSource+';return RoleHighlights;')(...Object.values(highlightsBindings));
  const bindings={
    React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=value];},useEffect:stub,
    ArrowRight:stub,Bot:stub,Database:stub,GitBranch:stub,ListChecks:stub,MapPin:stub,Sprout:stub,BusinessAssistant,TodayDecisions,RoleHighlights,accountSites,
    DATA_MODE:'demo',kinds:{tapping_angle:'角度',surface_action:'树表',growth_plan:'生长',pest_risk:'健康'},statuses:{needs_generation:'尚未生成',available:'可采用',stale:'需要更新'},
    StrategyRecommendation:({strategy})=>React.createElement('article',{'aria-label':'推荐策略'},strategy.summary),
    siteIdOf:site=>'demo-'+site,when:value=>value,sites,treeAlias,roleViews,scopedTasks,siteHierarchy,treePosition,treeZone,getRecentLatex,eventKindLabels,eventScopeLabel,eventStatusLabels,
    useRead(url){requests.push(url);return {data:!url?undefined:url==='/api/meta'?{generator:'demo_rules'}:url.includes('/park')?{trees:parkTrees,asOf:'2026-10-19'}:strategyView,reload:stub};},
  };
  const Component=new Function(...Object.keys(bindings),source+';return DecisionWorkbench;')(...Object.values(bindings));
  const props={role,scope,tasks,events,synced:true,...Object.fromEntries(['onScope','onNavigate','onTree','onStrategy','onMarket','onData','onTask','onEvents','onRobot'].map(name=>[name,(...args)=>calls.push([name,...args])]))};
  const render=(patch={})=>{Object.assign(props,patch);cursor=0;element=Component(props);return element;};
  render();
  return {calls,requests,highlightRequests,render,get element(){return element;},click(label){const button=walk(element,node=>node.type==='button'&&text(node).includes(label))[0];assert.ok(button,label);button.props.onClick();render();}};
}

test('workbench embeds one assistant and workspace has no floating assistant',()=>{
 const page=mount('manager');
 assert.equal(React.Children.toArray(page.element.props.children).filter(node=>node.type===BusinessAssistant).length,1);
 const source=readFileSync(new URL('../src/workspace/WorkspaceApp.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/FusionWindow|fusion-assistant-launch/);
});
test('full strategy opens the selected kind for the same tree across successive choices',()=>{
  const page=mount('manager');
  for(const kind of ['growth_plan','pest_risk','surface_action','tapping_angle']){
    const selector=walk(page.element,node=>node.props['aria-label']==='工作台策略类型')[0];selector.props.onChange({target:{value:kind}});page.render();page.click('打开策略');
    assert.deepEqual(page.calls.at(-1),['onStrategy','hainan',0,kind]);
    assert.ok(page.requests.some(url=>url?.includes(`kind=${kind}`)));
  }
});

test('single-tree strategy leads with recommendation and folds routing and provenance behind details',()=>{
  const page=mount('manager','hainan',trees,{strategyStatus:'available',strategy:{summary:'按 30° 割胶',generatedAt:'2026-10-19',generationMetadata:{},modelVersion:'test-model'},strategyRoute:{executor:'big_brain',reason:'树况需要综合分析',blockers:[]}});
  const area=walk(page.element,node=>node.props['aria-label']==='单树决策依据')[0];
  const content=React.Children.toArray(area.props.children).flatMap(child=>React.isValidElement(child)&&child.type===React.Fragment?React.Children.toArray(child.props.children):[child]);
  const recommendationIndex=content.findIndex(node=>React.isValidElement(node)&&typeof node.type==='function');
  const statusIndex=content.findIndex(node=>React.isValidElement(node)&&node.props.className?.startsWith('dw-result-status'));
  assert.ok(recommendationIndex>=0);assert.ok(recommendationIndex<statusIndex);
  assert.match(text(content[recommendationIndex]),/按 30° 割胶/);
  const details=walk(area,node=>node.type==='details')[0];
  assert.notEqual(details.props.open,true);assert.match(text(details),/树况需要综合分析/);assert.match(text(details),/test-model/);
  const outsideDetails=content.filter(node=>!React.isValidElement(node)||node.type!=='details').map(text).join('');
  assert.doesNotMatch(outsideDetails,/处理路径|结果来源|test-model/);
  assert.ok(walk(area,node=>node.type==='button'&&text(node).trim()==='打开策略')[0]);
});

test('missing or stale strategies keep the next action and adoption limit visible',()=>{
  const empty=mount('grower'),area=walk(empty.element,node=>node.props['aria-label']==='单树决策依据')[0];
  assert.match(text(area),/尚未生成角度策略，打开策略后可发起分析/);
  const stale=mount('manager','hainan',trees,{strategyStatus:'stale',strategy:{summary:'之前建议 30°',generatedAt:'2026-10-18'},strategyRoute:{executor:'needs_data',reason:'树围缺失',blockers:['circumference']}});
  const staleArea=walk(stale.element,node=>node.props['aria-label']==='单树决策依据')[0];
  assert.match(text(staleArea),/当前结果不可用于新任务/);assert.match(text(staleArea),/下一步：补测树围/);
});

test('grower has scoped care objects and direct yield and collection entries instead of management queues',()=>{
  const page=mount('grower');
  assert.equal(walk(page.element,node=>node.props['aria-label']==='农场管理待办'||node.props['aria-label']==='所选范围任务状态').length,0);
  page.click('产胶记录');assert.deepEqual(page.calls.at(-1),['onData','analytics']);
  page.click('收胶与报价');assert.deepEqual(page.calls.at(-1),['onData','collection']);
  const zones=walk(page.element,node=>node.type==='button'&&node.props['aria-pressed']!==undefined);zones[0].props.onClick();page.render();
  const care=walk(page.element,node=>node.props['aria-label']==='所选区域养护对象')[0];
  assert.match(text(care),/HN-A-0002/);assert.doesNotMatch(text(care),/HN-B-/);
  walk(care,node=>node.type==='button')[0].props.onClick();assert.deepEqual(page.calls.at(-1),['onStrategy','hainan',1,'growth_plan']);
  assert.equal(walk(page.element,node=>node.props['aria-label']==='工作台单树')[0].props.value,'T-0001');
});

test('manager prioritizes the selected park pending tasks and opens their actual record',()=>{
  const page=mount('manager'),queue=walk(page.element,node=>node.props['aria-label']==='农场管理待办')[0];
  assert.match(text(queue),/海南待复核/);assert.match(text(queue),/海南待安排/);
  assert.doesNotMatch(text(queue),/版纳待复核|海南执行中/);
  page.click('海南待复核');assert.equal(page.calls.at(-1)[1],tasks[0]);
});

test('signed-in manager sees production tasks and stock before the assistant, scoped to the selected park',()=>{
  const page=mount('manager');
  page.requests.length=0;
  page.render({account:accountFor('manager')});
  const labels=['机器人运营工作区','组织与园区下钻','单树决策依据','工作台单树'];
  assert.equal(walk(page.element,node=>labels.includes(node.props['aria-label'])).length,0);
  assert.match(text(page.element),/海南待复核|海南待安排/);
  assert.doesNotMatch(text(page.element),/版纳待复核/);
  assert.ok(text(page.element).indexOf('海南待复核')<text(page.element).indexOf('问橡胶大脑'));
  assert.match(text(page.element),/可售库存41公斤干胶/);
  assert.ok(page.highlightRequests.includes('/api/simulation/sales-inventory?siteId=demo-hainan'));
  page.click('查看流转台账');assert.deepEqual(page.calls.at(-1),['onData','business']);
  assert.ok(page.requests.every(request=>request===null),'hidden tree and strategy data is no longer requested');
  const summary=()=>walk(page.element,node=>node.props['aria-label']==='作业概况')[0];
  const counts=()=>walk(summary(),node=>node.type==='strong').map(text);
  assert.deepEqual(counts(),['1','1','1','0']);
  const entries=walk(summary(),node=>node.type==='button');
  assert.equal(entries.length,4);
  for(const entry of entries){entry.props.onClick();assert.deepEqual(page.calls.at(-1),['onNavigate','operations']);}
  page.render({scope:'xsbn'});assert.deepEqual(counts(),['0','0','1','0']);
  page.render({scope:'all'});assert.deepEqual(counts(),['1','1','2','1']);
  walk(summary(),node=>node.type==='button')[0].props.onClick();assert.deepEqual(page.calls.at(-1),['onNavigate','overview']);
  page.render({synced:false});assert.deepEqual(counts(),['—','—','—','—']);
});

test('each signed-in role has its own first-screen focus before one shared assistant',()=>{
  const page=mount('operator');
  for(const role of ['operator','manager','grower','executive']){
    page.requests.length=0;
    page.render({role,account:accountFor(role)});
    assert.equal(React.Children.toArray(page.element.props.children).filter(node=>node.type===BusinessAssistant).length,1);
    assert.equal(walk(page.element,node=>node.props['aria-label']==='作业概况').length,['operator','manager'].includes(role)?1:0);
    const focusLabel={operator:'设备状态重点',manager:'库存与销售重点',grower:'角色今日事项',executive:'中心运营重点'}[role];
    assert.equal(walk(page.element,node=>node.props['aria-label']===focusLabel).length,1);
    const labels=walk(page.element,node=>Boolean(node.props['aria-label'])).map(node=>node.props['aria-label']);
    assert.ok(labels.indexOf(focusLabel)<labels.indexOf('园区业务助手'));
    assert.equal(walk(page.element,node=>node.props['aria-label']==='组织与园区下钻').length,0);
    if(role==='operator')assert.doesNotMatch(text(page.element),/库存|销售|胶价|收胶与报价/);
    assert.deepEqual(page.requests,[null,null]);
  }
});

test('signed-in operator sees four devices and can open event and task records directly',()=>{
  const page=mount('operator');page.render({account:accountFor('operator')});
  const fleet=walk(page.element,node=>node.props['aria-label']==='设备状态重点')[0];
  const deviceCards=walk(fleet,node=>node.type==='button'&&/^R-[ABCD]/.test(text(node)));
  assert.equal(deviceCards.length,4);assert.match(text(fleet),/降雨/);
  for(let zone=0;zone<4;zone++){deviceCards[zone].props.onClick();assert.deepEqual(page.calls.at(-1),['onRobot','hainan',{source:'fleet',zone}]);}
  const operations=walk(page.element,node=>node.props['aria-label']==='机器人运营工作区')[0];
  walk(operations,node=>node.type==='button'&&text(node).includes('割胶头检修完成'))[0].props.onClick();assert.deepEqual(page.calls.at(-1),['onEvents','hainan']);
  page.click('海南执行中');assert.equal(page.calls.at(-1)[1],tasks[2]);
});

test('signed-in center all-parks home stays populated and restricts comparisons to accessible parks',()=>{
  const page=mount('executive','all');page.render({account:accountFor('executive')});
  const comparison=()=>walk(page.element,node=>node.props['aria-label']==='跨园区比较')[0];
  const rows=()=>walk(comparison(),node=>node.type==='tbody')[0].props.children;
  assert.equal(rows().length,3);assert.match(text(page.element),/可见园区3个/);
  assert.match(text(comparison()),/海南|西双版纳|西安/);assert.doesNotMatch(text(comparison()),/茂名/);
  walk(rows().find(row=>text(row).includes(sites.xsbn)),node=>node.type==='button')[0].props.onClick();
  assert.deepEqual(page.calls.at(-1),['onNavigate','overview','xsbn']);
  page.render({scope:'xsbn'});assert.match(text(page.element),/可见园区1个/);
  assert.match(text(page.element),/待处理任务1项/);assert.match(text(page.element),/未关闭异常1项/);
  assert.equal(rows().length,1);assert.ok(text(rows()[0]).includes(sites.xsbn));
});

test('operator sees live event records and execution queue, without tree-analysis panels',()=>{
  const page=mount('operator'),area=walk(page.element,node=>node.props['aria-label']==='机器人运营工作区')[0];
  assert.match(text(area),/园区降雨/);assert.match(text(area),/割胶头检修完成/);assert.match(text(area),/已解除 · 待确认恢复/);assert.match(text(area),/海南执行中/);
  assert.doesNotMatch(text(area),/历史已恢复|版纳降雨|版纳待复核/);
  assert.equal(walk(page.element,node=>node.props['aria-label']==='单树决策依据').length,0);
  assert.equal(page.requests.filter(url=>url?.includes('/trees/')).length,0);
  page.click('割胶头检修完成');assert.deepEqual(page.calls.at(-1),['onEvents','hainan']);
  page.click('海南执行中');assert.equal(page.calls.at(-1)[1],tasks[2]);
});

test('center view compares actual park task counts and keeps the trial site without production values',()=>{
  const page=mount('executive','all'),comparison=walk(page.element,node=>node.props['aria-label']==='跨园区比较')[0];
  const rows=walk(comparison,node=>node.type==='tbody')[0].props.children;
  assert.equal(rows.length,10);assert.match(text(rows.find(row=>text(row).includes(sites.hainan))),/海南.*1.*1.*0 \/ 3/);assert.match(text(rows.find(row=>text(row).includes(sites.xian))),/西安.*1 \/ 1.*试验站 · 无生产序列/);
  assert.match(text(comparison),/2026-09-16—09-22/);
  walk(rows.find(row=>text(row).includes(sites.xsbn)),node=>node.type==='button')[0].props.onClick();assert.deepEqual(page.calls.at(-1),['onNavigate','overview','xsbn']);
  assert.equal(walk(page.element,node=>node.props['aria-label']==='组织与园区下钻').length,0);
});

const dataSource=await declarations('DataCenter.tsx');
test('grower data center opens prices by default and preserves explicit yield shortcuts',()=>{
  const AnalyticsPage=stub,CollectionPoints=()=>null;
  const Component=new Function('React','useState','sites','can','AnalyticsPage','CollectionPoints','PublicMarket','PublicWeather',dataSource+';return DataCenter;')(React,initial=>[initial,stub],sites,can,AnalyticsPage,CollectionPoints,stub,stub);
  for(const [initialTab,type] of [[undefined,CollectionPoints],['analytics',AnalyticsPage],['collection',CollectionPoints]]){
    const result=Component({account:accountFor('grower'),site:'hainan',initialTab,onTree:stub,onStory:stub,onNotify:stub});
    const child=React.Children.toArray(result.props.children).find(node=>node.type===type);assert.ok(child);assert.equal(child.props.site,'hainan');
    const navigation=walk(result,node=>node.props['aria-label']==='数据中心视图')[0];
    assert.deepEqual(walk(navigation,node=>node.type==='button').map(text),['胶价与收胶点','地块产胶','树木资料','数据来源']);
  }
});

test('available trees with health watch or missing circumference stay in grower care and zone counts',()=>{
  const parkTrees=[
    {...trees[0]},
    {...trees[0],treeId:'T-0012',healthStatus:'watch'},
    {...trees[0],treeId:'T-0013',circumferenceCm:null},
    {...trees[0],treeId:'T-0051',healthStatus:'confirmed_issue'},
  ];
  const page=mount('grower','hainan',parkTrees),zones=walk(page.element,node=>node.type==='button'&&node.props['aria-pressed']!==undefined);
  assert.match(text(zones[0]),/2 棵养护 \/ 待确认/);
  zones[0].props.onClick();page.render();
  const care=walk(page.element,node=>node.props['aria-label']==='所选区域养护对象')[0];
  assert.match(text(care),/2 \/ 3 棵/);assert.match(text(care),/HN-A-0012健康关注/);assert.match(text(care),/HN-A-0013树围待补测/);
  assert.doesNotMatch(text(care),/HN-A-0001|HN-B-0001/);
  const buttons=walk(care,node=>node.type==='button');
  buttons[0].props.onClick();assert.deepEqual(page.calls.at(-1),['onStrategy','hainan',11,'pest_risk']);
  buttons[1].props.onClick();assert.deepEqual(page.calls.at(-1),['onStrategy','hainan',12,'growth_plan']);
});

