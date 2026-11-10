import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc,parseAst} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {eventHoldForTask} from '../src/workspace/operationalEvents.ts';
import {treeAlias,parseTreeAlias} from '../src/workspace/model.ts';
import {accountTreeIndices,rolePages} from '../src/workspace/identityModel.ts';

// Run the real workspace entry callbacks and inspect the compiled JSX wiring.
// This covers stale click targets without mounting the app or touching storage.
const source=readFileSync(new URL('../src/workspace/WorkspaceApp.tsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source,'WorkspaceApp.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const component=parseAst(code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
 .find(node=>node?.type==='FunctionDeclaration'&&node.id.name==='WorkspaceApp');
assert.ok(component);
function walk(node,predicate){
 if(!node||typeof node!=='object')return [];
 const found=predicate(node)?[node]:[];
 for(const value of Object.values(node)){
  if(Array.isArray(value))for(const item of value)found.push(...walk(item,predicate));
  else if(value&&typeof value==='object')found.push(...walk(value,predicate));
 }
 return found;
}
function declaration(name){
 const node=component.body.body.flatMap(node=>node.type==='VariableDeclaration'?node.declarations:[]).find(node=>node.id.name===name);
 assert.ok(node,`${name} remains a workspace navigation entry`);return node;
}
const expression=(node,dependencies={})=>new Function(...Object.keys(dependencies),`return (${code.slice(node.start,node.end)});`)(...Object.values(dependencies));
const props=node=>node.arguments[1]?.properties??[];
const property=(node,name)=>props(node).find(item=>(item.key.name??item.key.value)===name)?.value;
const elements=walk(component,node=>node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='createElement');
function element(name){const found=elements.find(node=>node.arguments[0]?.name===name);assert.ok(found,`${name} is rendered`);return found;}
function freeze(value){
 if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
 return value;
}
const task=(overrides={})=>({id:'HN-old-date',site:'hainan',date:'2026-09-18',start:'07:00',end:'08:00',title:'历史作业',status:'待开始',kind:'割胶',count:1,done:0,treeIndices:[44],...overrides});

function mount(tasks,options={}){
 const savedRef={current:freeze({tasks,activities:[{id:'existing-activity'}],decisions:{existing:'keep'}})};
 const state={site:'xsbn',scope:'all',page:'home',selectedTaskId:'previous',tree:85,monitorId:'previous-monitor',arranging:true,contextOpen:true,showTreeList:true,search:'历史',modal:'search',source:{page:'decisions',tree:85},robotFocus:3,focusZone:2,reviewTarget:{site:'xsbn',treeId:'T-0086',kind:'capture',request:1},request:options.request??null};
 const messages=[],mutations=[],events=[],location={hash:'home'};
 const set=(key)=>value=>{state[key]=typeof value==='function'?value(state[key]):value;events.push([key,state[key]]);};
 const dependencies={
  openWindow:id=>{state.window=id;},savedRef,saved:savedRef.current,location,role:options.role??'manager',useCallback:callback=>callback,notify:message=>messages.push(message),allowedSite:()=>true,
  setSite:set('site'),setScope:set('scope'),setPage:set('page'),setSelectedTaskId:set('selectedTaskId'),setTree:set('tree'),
  setMonitorId:set('monitorId'),setArranging:set('arranging'),setContextOpen:set('contextOpen'),setShowTreeList:set('showTreeList'),
  setSearch:set('search'),setModal:set('modal'),setSource:set('source'),setTaskOpenRequest:set('request'),setRobotFocus:set('robotFocus'),setRobotTarget:set('robotTarget'),
  setFocusZone:set('focusZone'),setReviewTarget:set('reviewTarget'),
  setDataTab:set('dataTab'),setDataReference:set('dataReference'),setDataAnalysis:set('dataAnalysis'),
  updateTask:value=>mutations.push(['updateTask',value]),setSaved:value=>mutations.push(['setSaved',value]),
 };
 const resolveTask=expression(declaration('resolveTask').init,dependencies);
 const chooseSite=expression(declaration('chooseSite').init,dependencies);
 const navigate=expression(declaration('navigate').init,dependencies);
 const shared={...dependencies,resolveTask,chooseSite,navigate};
 return {savedRef,state,messages,mutations,events,location,resolveTask,chooseSite,navigate,
  openTask:expression(declaration('openTask').init,shared),openFlow:expression(declaration('openFlow').init,shared)};
}

test('grower data navigation defaults to prices while explicit analysis links remain direct',()=>{
 const grower=mount([],{role:'grower'});
 grower.navigate('analytics');assert.equal(grower.state.dataTab,'collection');
 grower.navigate('analytics','analytics');assert.equal(grower.state.dataTab,'analytics');
 const manager=mount([],{role:'manager'});
 manager.navigate('analytics');assert.equal(manager.state.dataTab,'catalog');
});

test('resolveTask uses the current snapshot rather than a stale rendered task',()=>{
 const stale=task({revision:1}),current=task({revision:2,status:'已完成',done:1});
 const mounted=mount([current]);assert.equal(mounted.resolveTask(stale),current);
 assert.deepEqual(mounted.messages,[]);assert.deepEqual(mounted.mutations,[]);
});

test('the same resolver sees a replaced saved ref without another render',()=>{
 const first=task({revision:1}),second=task({revision:2,status:'待处理'}),mounted=mount([first]);
 assert.equal(mounted.resolveTask(first),first);
 mounted.savedRef.current=freeze({tasks:[second],activities:[],decisions:{}});
 assert.equal(mounted.resolveTask(first),second);
});

test('identical task ids in different parks resolve only in the clicked park',()=>{
 const hn=task(),xs=task({site:'xsbn',title:'另一园区同号任务'}),mounted=mount([xs,hn]);
 assert.equal(mounted.resolveTask({...hn}),hn);assert.equal(mounted.resolveTask({...xs}),xs);
 assert.deepEqual(mounted.messages,[]);
});

for(const [label,tasks] of [
 ['deleted task',[]],
 ['same id now only in another park',[task({site:'xsbn'})]],
 ['duplicate identity in one park',[task({revision:1}),task({revision:2})]],
]){
 test(`resolveTask rejects ${label} with an explicit notice`,()=>{
  const mounted=mount(tasks);assert.equal(mounted.resolveTask(task()),null);
  assert.equal(mounted.messages.length,1);assert.equal(typeof mounted.messages[0],'string');assert.ok(mounted.messages[0].trim());
  assert.deepEqual(mounted.events,[]);assert.deepEqual(mounted.mutations,[]);
 });
 test(`openTask leaves the current view untouched for ${label}`,()=>{
  const mounted=mount(tasks),before=structuredClone(mounted.state);mounted.openTask(task());
  assert.deepEqual(mounted.state,before);assert.deepEqual(mounted.events,[]);
  assert.equal(mounted.messages.length,1);assert.deepEqual(mounted.mutations,[]);
 });
 test(`openFlow leaves the current view untouched for ${label}`,()=>{
  const mounted=mount(tasks),before=structuredClone(mounted.state);mounted.openFlow(task({dispatch:{phase:'moving'}}));
  assert.deepEqual(mounted.state,before);assert.deepEqual(mounted.events,[]);
  assert.equal(mounted.messages.length,1);assert.deepEqual(mounted.mutations,[]);
 });
}

test('openTask selects the requested task after park switching and closes obstructing overlays',()=>{
 const first=task({id:'HN-first'}),target=task(),mounted=mount([first,target]);mounted.openTask({...target});
 assert.equal(mounted.state.site,'hainan');assert.equal(mounted.state.scope,'hainan');
 assert.equal(mounted.state.selectedTaskId,target.id);assert.equal(mounted.state.page,'operations');assert.equal(mounted.location.hash,'operations');
 assert.deepEqual(mounted.state.request,{id:target.id,site:'hainan',sequence:1});
 for(const key of ['arranging','contextOpen','showTreeList'])assert.equal(mounted.state[key],false,key);
 for(const key of ['tree','monitorId','modal','robotFocus','focusZone','reviewTarget'])assert.equal(mounted.state[key],null,key);
 assert.equal(mounted.state.search,'');assert.deepEqual(mounted.mutations,[]);
});

test('reopening the same task issues a fresh navigation sequence every time',()=>{
 const target=task(),mounted=mount([target]);mounted.openTask(target);mounted.openTask(target);mounted.openTask({...target});
 assert.deepEqual(mounted.state.request,{id:target.id,site:'hainan',sequence:3});
});

test('navigation sequences continue across task and park changes',()=>{
 const target=task({site:'xsbn'}),mounted=mount([target],{request:{id:'other',site:'hainan',sequence:8}});
 mounted.openTask(target);assert.deepEqual(mounted.state.request,{id:target.id,site:'xsbn',sequence:9});
 assert.equal(mounted.state.site,'xsbn');assert.equal(mounted.state.scope,'xsbn');
});

for(const phase of ['moving','paused','completed','cancelled']){
 test(`viewing a ${phase} flow task opens Operations without starting or updating it`,()=>{
  const target=task({dispatch:{phase,treeIndices:[44]}}),mounted=mount([target]),before=JSON.stringify(mounted.savedRef.current);
  mounted.openTask(target);
  assert.equal(mounted.state.page,'operations');assert.equal(mounted.state.monitorId,null);
  assert.equal(mounted.state.request.id,target.id);assert.equal(JSON.stringify(mounted.savedRef.current),before);
  assert.deepEqual(mounted.mutations,[]);assert.equal(target.dispatch.auto,undefined);
 });
}

test('openFlow only opens the latest existing flow and does not create automatic execution',()=>{
 const stale=task({dispatch:{phase:'moving'}}),current=task({revision:2,dispatch:{phase:'paused'}}),mounted=mount([current]);
 const before=JSON.stringify(mounted.savedRef.current);mounted.openFlow(stale);
 assert.equal(mounted.state.site,'hainan');assert.equal(mounted.state.scope,'hainan');
 assert.equal(mounted.state.page,'home');assert.equal(mounted.location.hash,'home');assert.equal(mounted.state.tree,null);
 assert.equal(mounted.state.monitorId,current.id);assert.equal(mounted.state.selectedTaskId,current.id);
 assert.equal(mounted.state.modal,null);assert.equal(mounted.state.contextOpen,false);
 assert.equal(mounted.state.request,null);assert.deepEqual(mounted.mutations,[]);
 assert.equal(JSON.stringify(mounted.savedRef.current),before);assert.equal(current.dispatch.auto,undefined);
});

test('robot location opens current task without inventing a removed dispatch',()=>{
 const current=task(),mounted=mount([current]),before=structuredClone(mounted.state);
 mounted.openFlow(task({dispatch:{phase:'moving'}}));assert.equal(mounted.state.page,'home');assert.equal(mounted.state.monitorId,null);
 assert.deepEqual(mounted.mutations,[]);assert.equal(mounted.messages.length,0);
});

test('an older non-flow snapshot can open the flow present in the current task',()=>{
 const current=task({dispatch:{phase:'completed',auto:{stage:'complete'}}}),mounted=mount([current]);
 mounted.openFlow(task());assert.equal(mounted.state.monitorId,current.id);assert.equal(mounted.state.page,'home');
 assert.deepEqual(mounted.mutations,[]);
});

test('overview, field plan, and both single-tree views use the shared task navigation',()=>{
 for(const name of ['Overview','FieldPlan','TreeWorkSummary','TreeWorkHistory']){
  const callback=property(element(name),'onTask');assert.equal(callback?.type,'Identifier',`${name} has a shared callback`);assert.equal(callback.name,'openTask');
 }
});

test('Operations receives the explicit open request and a separate flow-view callback',()=>{
 const operations=element('OperationsPage');
 assert.equal(property(operations,'openRequest')?.name,'taskOpenRequest');
 assert.equal(property(operations,'onOpenFlow')?.name,'openFlow');
});

function monitorTask(tasks,site,monitorId){
 const currentTasks=expression(declaration('currentTasks').init,{saved:{tasks},site});
 const monitorMatches=expression(declaration('monitorMatches').init,{currentTasks,monitorId});
 return expression(declaration('monitoredTask').init,{monitorMatches});
}

test('flow monitoring resolves same-id tasks within the selected park',()=>{
 const hn=task({dispatch:{phase:'moving'}}),xs=task({site:'xsbn',dispatch:{phase:'completed'}});
 assert.equal(monitorTask([xs,hn],'hainan',hn.id),hn);
 assert.equal(monitorTask([hn,xs],'xsbn',xs.id),xs);
});

test('flow monitoring does not fall back to another park when the selected task disappears',()=>{
 const other=task({site:'xsbn',dispatch:{phase:'moving'}});
 assert.equal(monitorTask([other],'hainan',other.id),undefined);
});

test('flow monitoring hides ambiguous duplicate tasks in the current park',()=>{
 const first=task({dispatch:{phase:'moving'}}),second=task({dispatch:{phase:'completed'}});
 assert.equal(monitorTask([first,second],'hainan',first.id),undefined);
});

test('TaskMonitor receives the uniquely resolved task and a park-specific component key',()=>{
 const monitor=element('TaskMonitor');assert.equal(property(monitor,'task')?.name,'monitoredTask');
 const hnKey=expression(property(monitor,'key'),{site:'hainan',monitoredTask:task()});
 const xsKey=expression(property(monitor,'key'),{site:'xsbn',monitoredTask:task({site:'xsbn'})});
 assert.notEqual(hnKey,xsKey);assert.ok(hnKey.includes('hainan'));assert.ok(xsKey.includes('xsbn'));
});

function taskUpdater(tasks,events=[],executionHold=()=>undefined){
 const mounted=mount(tasks),renders=[],generated=[];
 const setSaved=expression(declaration('setSaved').init,{useCallback:callback=>callback,savedRef:mounted.savedRef,setSavedState:value=>renders.push(value)});
 const update=expression(declaration('updateTask').init,{
  resolveTask:mounted.resolveTask,setSaved,eventHoldForTask,executionHold,eventsRef:{current:events},notify:message=>mounted.messages.push(message),timeLabel:()=> '10:00',crypto:{randomUUID:()=>{generated.push('new-activity');return 'new-activity';}},
 });
 return {...mounted,update,renders,generated};
}

test('updating a monitored task preserves another park with the same id and records the correct site',()=>{
 const other=task({site:'xsbn',title:'另一园区记录'}),current=task(),next=task({status:'执行中',dispatch:{phase:'running',auto:{stage:'travel'}}});
 const mounted=taskUpdater([other,current]),before=mounted.savedRef.current;mounted.update(next);
 assert.deepEqual(mounted.savedRef.current.tasks,[other,next]);assert.equal(mounted.savedRef.current.tasks[0],other);
 assert.equal(mounted.savedRef.current.decisions,before.decisions);
 assert.equal(mounted.savedRef.current.activities.length,2);assert.equal(mounted.savedRef.current.activities[0].site,'hainan');
 assert.equal(mounted.savedRef.current.activities[0].title,next.title);assert.equal(mounted.savedRef.current.activities[1],before.activities[0]);
 assert.equal(mounted.renders.length,1);assert.equal(mounted.renders[0],mounted.savedRef.current);assert.deepEqual(mounted.messages,[]);
});

test('updating a missing or duplicate task cannot write tasks or fabricate an activity',()=>{
 for(const tasks of [[],[task({site:'xsbn'})],[task({revision:1}),task({revision:2})]]){
  const mounted=taskUpdater(tasks),before=mounted.savedRef.current;mounted.update(task({status:'执行中'}));
  assert.equal(mounted.savedRef.current,before);assert.deepEqual(mounted.renders,[]);assert.deepEqual(mounted.generated,[]);
  assert.equal(mounted.messages.length,1);assert.ok(mounted.messages[0].trim());
 }
});

const scenes=elements.filter(node=>node.arguments[0]?.name==='DigitalTwinScene');
assert.equal(scenes.length,2,'the persistent Hainan simulator and passive park scene have separate mounts');
const hainanScene=scenes.find(node=>property(node,'site')?.value==='hainan');
const passiveScene=scenes.find(node=>property(node,'site')?.name==='site');
assert.ok(hainanScene);assert.ok(passiveScene);

test('each field scene takes monitored trees only from its own selected park',()=>{
 const hn=task({treeIndices:[44]}),xs=task({site:'xsbn',treeIndices:[85,86]}),xa=task({site:'xian',treeIndices:[9]});
 for(const [site,expected] of [['hainan',hn.treeIndices],['xsbn',xs.treeIndices],['xian',xa.treeIndices]]){
  const monitoredTask=monitorTask([xs,hn,xa],site,hn.id);
  assert.equal(expression(property(site==='hainan'?hainanScene:passiveScene,'selectedTrees'),{site,arranging:false,monitoredTask}),expected);
  if(site!=='hainan')assert.equal(expression(property(hainanScene,'selectedTrees'),{site,arranging:false,monitoredTask}),undefined);
 }
 for(const scene of scenes){
  const selectedTrees=property(scene,'selectedTrees');
  assert.equal(expression(selectedTrees,{site:'hainan',arranging:false,monitoredTask:undefined}),undefined);
  const targets=[20,21];assert.equal(expression(selectedTrees,{site:'hainan',arranging:true,targets,monitoredTask:hn}),targets);
 }
});

function sceneElement(scene,patch={}){
 const deps={accountTreeIndices,account:undefined,visibleTreeIndices:accountTreeIndices(undefined,patch.site??'hainan'),React:{createElement:(type,props)=>({type,props})},DigitalTwinScene:'DigitalTwinScene',
  eventHoldForTask,operationalEvents:[],currentTreeIndex:task=>task.treeIndices?.[0],site:'hainan',page:'home',sceneLoaded:true,hainanProfiles:undefined,siteProfiles:undefined,animatedTask:undefined,arranging:false,selecting:false,selectionMode:'point',
  monitorId:null,monitoredTask:undefined,targets:[20,21],resetKey:0,layer:0,selectedTree:44,focusKey:1,focusZone:null,...patch};
 deps.sceneVisible=expression(declaration('sceneVisible').init,{page:deps.page});
 const branch=walk(component,node=>node.type==='LogicalExpression'&&node.right===scene)[0];assert.ok(branch);
 return expression(branch,deps);
}

test('browsing other parks keeps one Hainan simulator mounted but hides and disconnects their selection',()=>{
 for(const site of ['xsbn','xian']){
  const scene=sceneElement(hainanScene,{site,arranging:true,selecting:true,animatedTask:{dispatch:{auto:{stage:'travel'},phase:'running'}},monitoredTask:task({site,treeIndices:[85]})});
  assert.equal(scene.type,'DigitalTwinScene');assert.equal(scene.props.site,'hainan');assert.equal(scene.props.key,'hainan');
  assert.equal(scene.props.visible,false);assert.equal(scene.props.selectionMode,'off');assert.equal(scene.props.selectedTree,null);
  assert.equal(scene.props.selectedTrees,undefined);assert.equal(scene.props.demoMotion,undefined);
 }
});

test('switching workspace pages preserves the loaded Hainan mount and its stable key',()=>{
 for(const site of ['hainan','xsbn','xian'])for(const page of ['home','operations','robots','workbench','decisions','analytics','overview']){
  const scene=sceneElement(hainanScene,{site,page});assert.equal(scene.props.key,'hainan');assert.equal(scene.props.site,'hainan');
  assert.equal(scene.props.visible,page==='home'&&site==='hainan');
 }
 assert.equal(sceneElement(hainanScene,{sceneLoaded:false}),false);
});

test('passive scene uses the selected park and is mounted only for spatial or task views',()=>{
 for(const site of ['xsbn','xian'])for(const page of ['home','operations','robots','workbench']){
  const scene=sceneElement(passiveScene,{site,page,selectedTree:85});
  if(['home','operations'].includes(page)){
   assert.equal(scene.props.site,site);assert.equal(scene.props.key,site);assert.equal(scene.props.visible,page==='home');assert.equal(scene.props.selectedTree,85);
  }else assert.equal(scene,false);
 }
 assert.equal(sceneElement(passiveScene,{site:'hainan'}),false);
});

test('opening another park or page never resets the already loaded Hainan simulator flag',()=>{
 const effect=walk(component,node=>node.type==='CallExpression'&&node.callee.name==='useEffect')
  .find(node=>walk(node.arguments[0],child=>child.type==='CallExpression'&&child.callee.name==='setSceneLoaded').length);
 assert.ok(effect);const updates=[];
 for(const site of ['hainan','xsbn','xian'])for(const page of ['home','operations','robots','workbench']){
  const sceneVisible=expression(declaration('sceneVisible').init,{page});
  expression(effect.arguments[0],{sceneVisible,site,setSceneLoaded:value=>updates.push([site,page,value])})();
 }
 assert.deepEqual(updates,[['hainan','home',true],['hainan','operations',true]]);
});

test('robot center receives current-park tasks and the shared read-only tree and task navigation',()=>{
 const robots=element('RobotCenter');
 for(const [name,expected] of [['site','site'],['tasks','currentTasks'],['onTree','openTree'],['onTask','openTask']])assert.equal(property(robots,name)?.name,expected);
 const hn=task(),xs=task({site:'xsbn'}),xa=task({site:'xian'});
 for(const site of ['hainan','xsbn','xian']){
  const currentTasks=expression(declaration('currentTasks').init,{saved:{tasks:[hn,xs,xa]},site});
  assert.deepEqual(currentTasks,[{hainan:hn,xsbn:xs,xian:xa}[site]]);
  assert.equal(expression(property(robots,'key'),{site}),site);
 }
});

test('robot spatial navigation focuses the Hainan robot or the selected local zone tree',()=>{
 const callback=property(element('RobotCenter'),'onScene');
 for(const site of ['hainan','xsbn','guangdong-maoming','xian']){
  const state={tree:44,robotFocus:3,page:'robots',focusKey:4};
  expression(callback,{site,setTree:value=>{state.tree=value;},setFocusKey:update=>{state.focusKey=update(state.focusKey);},setRobotFocus:value=>{state.robotFocus=value;},navigate:value=>{state.page=value;}})(2);
  assert.equal(state.tree,site==='hainan'?null:100);assert.equal(state.page,'home');assert.equal(state.robotFocus,site==='hainan'?2:null);
  assert.equal(state.focusKey,5);
 }
 for(const site of ['hainan','xsbn','guangdong-maoming','xian']){
  const mounted=mount([task()]);mounted.chooseSite(site);assert.equal(mounted.state.robotFocus,null);
  assert.equal(mounted.state.site,site);assert.deepEqual(mounted.mutations,[]);
 }
});

test('map and workbench device navigation preserve device source and zone across parks and both Hainan fleets',()=>{
 const callbacks=[property(element('Overview'),'onMapRobot'),property(element('DecisionWorkbench'),'onRobot')],initialRobot=property(element('RobotCenter'),'initialRobot');
 for(const callback of callbacks)for(const site of ['hainan','xsbn','guangdong-maoming','xian'])for(const source of site==='hainan'?['fleet','task']:['task'])for(const zone of [1,2,3]){
  const mounted=mount([task()]),target={source,zone};
  expression(callback,{chooseSite:mounted.chooseSite,setRobotTarget:value=>{mounted.state.robotTarget=value;},navigate:value=>{mounted.state.page=value;}})(site,target);
  assert.equal(mounted.state.site,site);assert.equal(mounted.state.page,'robots');
  assert.deepEqual(expression(initialRobot,{robotTarget:mounted.state.robotTarget}),target);
  assert.deepEqual(mounted.mutations,[]);
 }
});

test('search task results, attention cards, and linked strategies call shared task navigation',()=>{
 for(const [label,className,argName] of [['search task result','ws-search-result','t'],['attention card','ws-attention','t'],['linked strategy','ws-primary','linkedTask']]){
  const buttons=elements.filter(node=>node.arguments[0]?.value==='button'&&property(node,'className')?.value===className);
  const handlers=buttons.map(node=>property(node,'onClick')).filter(Boolean);
  const callback=handlers.find(handler=>walk(handler,node=>node.type==='CallExpression'&&node.callee.name==='openTask'&&node.arguments[0]?.name===argName).length);
  assert.ok(callback,`${label} opens its task through openTask`);
  const target=task(),opened=[],invoke=expression(callback,{[argName]:target,openTask:value=>opened.push(value)});
  invoke();assert.deepEqual(opened,[target]);
 }
});


for(const site of ['hainan','xsbn','xian'])test(`${site} tree search round-trips all 200 aliases and rejects another park`,()=>{
 for(let index=0;index<200;index++){
  const alias=treeAlias(index,site);
  assert.equal(parseTreeAlias(alias,site),index);
  assert.equal(parseTreeAlias(alias.toLowerCase(),site),index);
  for(const other of ['hainan','xsbn','xian'].filter(value=>value!==site))assert.equal(parseTreeAlias(alias,other),null);
 }
 for(const value of [treeAlias(0,site).replace('0001','0000'),treeAlias(0,site).replace('0001','0051'),treeAlias(0,site).replace('-A-','-E-')])assert.equal(parseTreeAlias(value,site),null);
});

const searchResult=elements.find(node=>node.arguments[0]?.value==='button'&&property(node,'className')?.value==='ws-search-result'&&walk(property(node,'onClick'),item=>item.type==='CallExpression'&&item.callee.name==='openTree').length);
assert.ok(searchResult,'The tree search result is rendered');
for(const site of ['xsbn','xian'])test(`${site} tree search opens its current tree without changing park`,()=>{
 const match=search=>expression(declaration('matchedSearchIndex').init,{search,site,parseTreeAlias});
 const index=expression(declaration('searchIndex').init,{matchedSearchIndex:match(` ${treeAlias(85,site)} `),ownsTree:()=>true});
 assert.equal(index,85);
 assert.equal(expression(declaration('searchIndex').init,{matchedSearchIndex:match('HN-B-0036'),ownsTree:()=>true}),null);
 const opened=[],changes=[];
 expression(property(searchResult,'onClick'),{searchIndex:index,openTree:value=>opened.push(value),chooseSite:value=>changes.push(value)})();
 assert.deepEqual(opened,[85]);assert.deepEqual(changes,[]);
 const label=walk(searchResult,node=>node.type==='CallExpression'&&node.callee.name==='treeAlias')[0];
 assert.equal(expression(label,{searchIndex:index,site,treeAlias}),treeAlias(index,site));
});

test('search empty state uses a visible tree alias and a device actually in its tasks',()=>{
 const message=elements.find(node=>node.arguments[0]?.value==='p'&&node.arguments.some(arg=>arg.type==='Literal'&&String(arg.value).includes('未找到匹配记录')));
 assert.ok(message);
 const html=renderToStaticMarkup(expression(message,{React,site:'xian',treeAlias,visibleTreeIndices:accountTreeIndices(undefined,'xian'),currentTasks:[task({site:'xian',robot:'西安试验台 08'})]}));
 assert.match(html,/XA-A-0001/);assert.match(html,/西安试验台 08/);assert.doesNotMatch(html,/HN-|Robot 01/);
 const growerHtml=renderToStaticMarkup(expression(message,{React,site:'hainan',treeAlias,visibleTreeIndices:[50,51,52],currentTasks:[]}));
 assert.match(growerHtml,/HN-B-0001/);assert.doesNotMatch(growerHtml,/HN-B-0036/);
});

const heldEvent={id:'rain',siteId:'demo-hainan',kind:'rain',zone:0,status:'active',note:'现场降雨',createdAt:'2026-10-19T00:00:00Z',mode:'simulation'};
test('an event arriving after a monitor render blocks stale progress or resume, while pause and cancel remain available',()=>{
 for(const phase of ['running','completed','resume-requested','pause-requested','cancel-requested']){
  const current=task({status:'待处理',dispatch:{phase:'paused'}}),mounted=taskUpdater([current],[heldEvent]);
  const next={...current,status:phase==='completed'?'已完成':phase==='running'?'执行中':'待处理',dispatch:{phase}};
  mounted.update(next);
  assert.equal(mounted.renders.length,['pause-requested','cancel-requested'].includes(phase)?1:0,phase);
 }
});
test('a weather or schedule hold without an event blocks progress the same way and tells the user why',()=>{
 const reason='未来时段降雨风险较高，暂缓割胶';
 for(const phase of ['running','completed','resume-requested','pause-requested','cancel-requested']){
  const current=task({status:'待处理',dispatch:{phase:'paused'}}),mounted=taskUpdater([current],[],()=>reason);
  mounted.update({...current,status:phase==='completed'?'已完成':phase==='running'?'执行中':'待处理',dispatch:{phase}});
  const allowed=['pause-requested','cancel-requested'].includes(phase);
  assert.equal(mounted.renders.length,allowed?1:0,phase);
  assert.deepEqual(mounted.messages,allowed?[]:[reason],phase);
 }
});
test('an active event freezes the legacy scene presentation without changing the task execution record',()=>{
 const current=task({status:'执行中',dispatch:{phase:'running',auto:{stage:'work'}}});
 const held=sceneElement(hainanScene,{animatedTask:current,operationalEvents:[heldEvent]});
 assert.equal(held.props.demoMotion.phase,'paused');assert.equal(current.dispatch.phase,'running');
 const resumed=sceneElement(hainanScene,{animatedTask:current,operationalEvents:[{...heldEvent,status:'closed'}]});
 assert.equal(resumed.props.demoMotion.phase,'running');
});

test('workbench strategy navigation carries its kind into the single-tree panel and remounts on a new kind',()=>{
 const callback=property(element('DecisionWorkbench'),'onStrategy');
 const strategyPanel=elements.find(node=>node.arguments[0]?.name==='TreeDecision'&&property(node,'initial')?.name==='treeStrategyKind');
 assert.ok(strategyPanel);
 const state={kind:'tapping_angle',tab:'概览',index:null,site:'hainan'},keys=[];
 const openTree=expression(declaration('openTree').init,{
  accountTreeIndices,account:undefined,siteRef:{current:'hainan'},setTreeStrategyKind:value=>state.kind=value,setMonitorId(){},setTree:value=>state.index=value,setFocusKey(){},setTreeTab:value=>state.tab=value,
  setSource(){},navigate(){},setShowTreeList(){},setModal(){},page:'workbench',selectedTree:null,
 });
 const open=expression(callback,{chooseSite:value=>state.site=value,openTree,setTreeStrategyKind:value=>state.kind=value,setTreeTab:value=>state.tab=value});
 for(const kind of ['growth_plan','surface_action','pest_risk']){
  open('xsbn',44,kind);
  assert.equal(state.tab,'一树一策');assert.equal(state.kind,kind);assert.equal(state.index,44);
  const current={site:state.site,selectedTree:state.index,treeStrategyKind:state.kind};
  assert.equal(expression(property(strategyPanel,'initial'),current),kind);
  keys.push(expression(property(strategyPanel,'key'),current));
 }
 assert.equal(new Set(keys).size,3);
 openTree(45);assert.equal(state.kind,'tapping_angle');assert.equal(state.tab,'概览');
});

test('grower data shortcuts preserve selected park and request the exact data-center tab',()=>{
 const callback=property(element('DecisionWorkbench'),'onData');
 for(const tab of ['analytics','collection']){
  const calls=[];expression(callback,{scope:'xsbn',chooseSite:site=>calls.push(['site',site]),navigate:(...args)=>calls.push(['navigate',...args])})(tab);
  assert.deepEqual(calls,[['site','xsbn'],['navigate','analytics',tab]]);
 }
 assert.equal(property(element('DataCenter'),'initialTab').name,'dataTab');
});

test('assistant market navigation opens the market tab with its saved model and clears it for latest',()=>{
 const state={site:'hainan',scope:'all',tab:'tree',page:'workbench',selected:null},scopeRef={current:'all'};
 const open=expression(declaration('openMarketModel').init,{
  chooseSite:value=>state.site=value,setScope:value=>state.scope=value,overviewScopeRef:scopeRef,
  setSelectedMarketModel:value=>state.selected=value,setStrategyTab:value=>state.tab=value,navigate:value=>state.page=value,
 });
 assert.equal(property(element('DecisionWorkbench'),'onMarket').name,'openMarketModel');
 for(const id of ['saved-old-round','saved-new-round']){
  open('guangdong-maoming',id);
  assert.deepEqual(state,{site:'guangdong-maoming',scope:'guangdong-maoming',tab:'market',page:'decisions',selected:{site:'guangdong-maoming',modelId:id}});
  assert.equal(scopeRef.current,'guangdong-maoming');
  const selection=property(element('StrategyCenter'),'marketModelId');
  assert.equal(expression(selection,{site:'guangdong-maoming',selectedMarketModel:state.selected}),id);
  assert.equal(expression(selection,{site:'xsbn',selectedMarketModel:state.selected}),null);
 }
 expression(property(element('StrategyCenter'),'onLatestMarket'),{setSelectedMarketModel:value=>state.selected=value})();
 assert.equal(state.selected,null);
});


test('grower tree list, search, and scene entries preserve the same 33 owned positions',()=>{
 const account={role:'grower',siteIds:['demo-hainan'],plot:{siteId:'demo-hainan',treeIds:Array.from({length:33},(_,i)=>`T-${String(i+51).padStart(4,'0')}`)}};
 const visibleTreeIndices=accountTreeIndices(account,'hainan');
 assert.deepEqual(expression(declaration('treeIndices').init,{visibleTreeIndices,treeFilter:'全部'}),Array.from({length:33},(_,i)=>50+i));
 assert.deepEqual(expression(declaration('treeIndices').init,{visibleTreeIndices,treeFilter:'A'}),[]);
 const ownsTree=index=>visibleTreeIndices.includes(index);
 for(const [query,expected] of [['HN-A-0001',null],['HN-B-0001',50],['HN-B-0033',82],['HN-B-0034',null]]){
  const matchedSearchIndex=expression(declaration('matchedSearchIndex').init,{search:query,site:'hainan',parseTreeAlias});
  assert.equal(expression(declaration('searchIndex').init,{matchedSearchIndex,ownsTree}),expected);
 }
 const opened=[];
 const open=expression(declaration('openTree').init,{accountTreeIndices,account,siteRef:{current:'hainan'},setTreeStrategyKind(){},setMonitorId(){},setTree:index=>opened.push(index),setFocusKey(){},setTreeTab(){},setSource(){},navigate(){},setShowTreeList(){},setModal(){},page:'home',selectedTree:null});
 open(0);open(50);open(82);open(83);assert.deepEqual(opened,[50,82]);
 const scene=sceneElement(hainanScene,{account,visibleTreeIndices});
 assert.deepEqual(scene.props.selectableTrees,visibleTreeIndices);
 const select=expression(property(hainanScene,'onTreeSelect'),{ownsTree,arranging:false,monitorId:null,setContextOpen(){},setTree:index=>opened.push(index),setFocusKey(){},setTreeTab(){}});
 select(0);select(51);assert.deepEqual(opened,[50,82,51]);
});


test('strategy task entry opens task controls in Operations without entering the scene',()=>{
 const strategy=element('StrategyCenter');
 assert.equal(property(strategy,'onTask')?.name,'openTask');
 assert.equal(property(strategy,'onOpenFlow'),undefined);
 assert.equal(property(strategy,'onTasks')?.name,'openStrategyTasks');
});

test('task plan navigation keeps ordinary tasks in Operations and opens the exact saved production or market origin',()=>{
 const ordinary=task(),mounted=mount([ordinary]),state=mounted.state;
 const setters={chooseSite:mounted.chooseSite,setScope:value=>state.scope=value,setStrategyTab:value=>state.strategyTab=value,navigate:mounted.navigate,
  setSelectedParkPlan:value=>state.parkPlan=value,setSelectedMarketModel:value=>state.marketModel=value,overviewScopeRef:{current:'all'}};
 const openParkPlan=expression(declaration('openParkPlan').init,setters);
 const openMarketModel=expression(declaration('openMarketModel').init,setters);
 const open=expression(declaration('openDemoStrategy').init,{openParkPlan,openMarketModel,openTask:mounted.openTask});
 open(ordinary);assert.equal(state.page,'operations');assert.equal(state.selectedTaskId,ordinary.id);
 for(const id of ['historical-plan','newer-plan']){
  open(task({site:'xsbn',sourceParkPlanId:id}));
  assert.deepEqual(state.parkPlan,{site:'xsbn',planId:id});assert.equal(state.site,'xsbn');assert.equal(state.scope,'xsbn');assert.equal(state.strategyTab,'park');assert.equal(state.page,'decisions');
  assert.equal(expression(property(element('StrategyCenter'),'parkPlanId'),{site:'xsbn',selectedParkPlan:state.parkPlan}),id);
  assert.equal(expression(property(element('StrategyCenter'),'parkPlanId'),{site:'hainan',selectedParkPlan:state.parkPlan}),null);
 }
 open(task({site:'guangdong-maoming',sourceScenarioId:'original-market-round'}));
 assert.deepEqual(state.marketModel,{site:'guangdong-maoming',modelId:'original-market-round'});
 assert.equal(state.site,'guangdong-maoming');assert.equal(state.scope,'guangdong-maoming');assert.equal(state.strategyTab,'market');assert.equal(state.page,'decisions');
 assert.deepEqual(mounted.mutations,[]);
});

test('strategy evidence links open the requested data reference in the same park and respect role access',()=>{
 const callback=property(element('StrategyCenter'),'onData');
 const mounted=mount([]);mounted.chooseSite('xsbn');
 const open=expression(callback,{account:{role:'manager'},rolePages,navigate:mounted.navigate});
 for(const [tab,reference,analysis] of [['public','industry'],['public','weather'],['business',undefined],['analytics',undefined,'health'],['analytics',undefined]]){
  open(tab,reference,analysis);
  assert.equal(mounted.state.site,'xsbn');assert.equal(mounted.state.page,'analytics');assert.equal(mounted.state.dataTab,tab);
  assert.equal(mounted.state.dataReference,reference??'market');
  assert.equal(mounted.state.dataAnalysis,analysis??'trend');
  assert.equal(property(element('DataCenter'),'initialReference').name,'dataReference');
  assert.equal(property(element('DataCenter'),'initialAnalysis').name,'dataAnalysis');
  assert.equal(expression(property(element('DataCenter'),'key'),{site:'xsbn',dataTab:tab,dataReference:mounted.state.dataReference,dataAnalysis:mounted.state.dataAnalysis}),`xsbn:${tab}:${reference??'market'}:${analysis??'trend'}`);
 }
 assert.equal(expression(callback,{account:{role:'operator'},rolePages,navigate:mounted.navigate}),undefined);
});

test('brain administration opens from the header and workbench with the selected park and stays hidden for operational roles',()=>{
 const entry=elements.find(node=>property(node,'className')?.value==='ws-brain-entry');assert.ok(entry);
 const entryGuard=walk(component,node=>node.type==='LogicalExpression'&&node.right===entry)[0];assert.ok(entryGuard);
 const brainPage=element('BrainManagement');
 const pageGuard=walk(component,node=>node.type==='LogicalExpression'&&node.right===brainPage)[0];assert.ok(pageGuard);
 for(const role of ['grower','operator','manager','executive']){
  const calls=[],account={role},bindings={React,account,rolePages,page:'brain',site:'xsbn',Brain:()=>null,BrainManagement:()=>null,setScope:value=>calls.push(['scope',value]),navigate:value=>calls.push(['page',value])};
  const visible=role==='manager'||role==='executive',button=expression(entryGuard,bindings),page=expression(pageGuard,bindings);
  assert.equal(React.isValidElement(button),visible);assert.equal(React.isValidElement(page),visible);
  if(visible){button.props.onClick();assert.deepEqual(calls,[['scope','xsbn'],['page','brain']]);assert.equal(page.props.site,'xsbn');}
 }
 for(const [scope,expected] of [['xsbn','xsbn'],['all','hainan']]){
  const calls=[];expression(property(element('DecisionWorkbench'),'onCerebellum'),{scope,site:'hainan',chooseSite:value=>calls.push(['site',value]),setScope:value=>calls.push(['scope',value]),navigate:value=>calls.push(['page',value])})();
  assert.deepEqual(calls,[['site',expected],['scope',expected],['page','brain']]);
 }
});

test('park-plan task entry waits for synchronization and opens only the requested task',async()=>{
 const target=task({site:'xsbn',id:'new-plan-task'}),mounted=mount([]),opened=[];
 let release;
 const refreshed=new Promise(resolve=>{release=()=>{mounted.savedRef.current={tasks:[target]};resolve();};});
 const callback=expression(declaration('openStrategyTasks').init,{
  site:'xsbn',savedRef:mounted.savedRef,syncControllerRef:{current:{refresh:()=>refreshed}},
  navigate:()=>{throw Error('must locate the task');},openTask:value=>opened.push(value),
 });
 const pending=callback(target.id);assert.deepEqual(opened,[]);
 release();await pending;assert.deepEqual(opened,[target]);
});

test('park-plan navigation rejects a missing target without opening another task',async()=>{
 const mounted=mount([task({site:'xsbn',id:'unrelated'})]),opened=[];
 const callback=expression(declaration('openStrategyTasks').init,{
  site:'xsbn',savedRef:mounted.savedRef,syncControllerRef:{current:{refresh:async()=>{}}},
  navigate:()=>opened.push('page'),openTask:value=>opened.push(value),
 });
 await assert.rejects(callback('missing-plan-task'),/尚未同步/);assert.deepEqual(opened,[]);
});


