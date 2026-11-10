import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Bot, MapPin, ArrowRight, Trees} from 'lucide-react';
import {transformWithOxc, parseAst} from 'vite';
import {fleetTask, robotStatus, robotViews} from '../src/workspace/robotCenterModel.ts';
import {taskEvidence} from '../src/workspace/taskLifecycleModel.ts';
import {sites, treeAlias} from '../src/workspace/model.ts';
import {eventHoldForZone} from '../src/workspace/operationalEvents.ts';
import {makeDemoTasks} from '../../backend/src/adapters/demo-tasks.js';

const requestedAt='2026-10-19T02:00:00.000Z';
const job=(id='job-0',patch={})=>({id,attemptId:`attempt-${id}`,planVersion:'plan-v1',angle:30,requestedAt,...patch});
const task=(patch={})=>({id:'job-0',site:'hainan',title:'A区单树作业',block:'A',robot:'R-A',start:'10:00',end:'11:00',kind:'割胶',status:'执行中',treeIndices:[0],count:1,done:0,railJob:job(),...patch});
const fleet=(patch={})=>({ready:true,error:null,jobs:{},zones:Array.from({length:4},(_,zone)=>({zone,distance:0,active:null,queue:[],phase:'idle',elapsed:0,completed:0,paused:false,retractFrom:0})),...patch});
const activeFleet=(original=job())=>{const value=fleet({jobs:{0:original}});Object.assign(value.zones[0],{active:0,phase:'moving'});return value;};
const now=Date.parse(requestedAt);

test('only Hainan uses the live fleet; other parks show their own four demo devices',()=>{
 const current=activeFleet(),tasks=[task()];
 assert.deepEqual(robotViews('hainan',current,tasks,now).map(value=>[value.name,value.zone]),[['R-A',0],['R-B',1],['R-C',2],['R-D',3]]);
 for(const [site,prefix] of [['xsbn','XS'],['xian','XA']]){
  const robots=robotViews(site,current,tasks,now);
  assert.deepEqual(robots.map(value=>[value.name,value.zone]),'ABCD'.split('').map((block,zone)=>[`${prefix}-模拟机器人-${block}`,zone]));
  assert.ok(robots.every(value=>value.currentTask===undefined&&value.state.active===null&&value.state.queue.length===0&&value.state.completed===0));
 }
 const before=JSON.stringify([current,tasks]);robotViews('hainan',current,tasks,now);assert.equal(JSON.stringify([current,tasks]),before);
});

test('Maoming demo devices follow their own scheduled, running, review and completed tasks',()=>{
 const tasks=makeDemoTasks(new Date(now)),current=activeFleet(),before=JSON.stringify([current,tasks]);
 const robots=robotViews('guangdong-maoming',current,tasks,now);
 assert.deepEqual(robots.map(value=>value.state.active),[null,62,108,null]);
 assert.deepEqual(robots.map(value=>value.state.completed),[0,12,8,32]);
 assert.deepEqual(robots.map(value=>value.state.queue.length),[30,23,19,0]);
 assert.ok(robots.every(value=>value.currentTask.site==='guangdong-maoming'));
 assert.equal(robots[1].currentTask.demoStrategy.siteId,'demo-guangdong-maoming');
 assert.equal(JSON.stringify([current,tasks]),before);
});

test('Hainan sample robots retain task state beside the separate browser fleet before and after loading',()=>{
 const tasks=makeDemoTasks(new Date(now));
 for(const current of [fleet({ready:false}),fleet()]){
  const robots=robotViews('hainan',current,tasks,now);
  assert.equal(robots.length,4);
  assert.deepEqual(robots.map(r=>r.name),['R-A','R-B','R-C','R-D']);
  assert.equal(robots[3].currentTask,undefined);
  assert.equal(robots[3].history[0].done,32);
  const samples=robots.filter(robot=>robot.source==='task');
  assert.deepEqual(samples.map(robot=>robot.state.active),[null,62,108]);
  assert.deepEqual(samples.map(robot=>robot.state.completed),[0,12,8]);
  assert.ok(samples.every(robot=>robot.currentTask.site==='hainan'));
 }
});

test('unloaded or failed fleet does not present persisted snapshot data as live activity',()=>{
 const stale=activeFleet();stale.ready=false;
 for(const robot of robotViews('hainan',stale,[task()],now)){assert.equal(robot.state,undefined);assert.equal(robot.currentTask,undefined);assert.equal(robot.status,'模拟机群尚未加载');}
 stale.error='机器人加载失败，请刷新重试';assert.ok(robotViews('hainan',stale,[],now).every(value=>value.status==='模拟机群加载失败'));
});

test('robot task navigation binds the current attempt and site, not a robot label or an ID alone',()=>{
 const expected=task(),otherSite=task({site:'xsbn'}),oldAttempt=task({railJob:job('job-0',{attemptId:'old'})}),wrongTree=task({treeIndices:[1]});
 assert.equal(fleetTask(0,job(),[otherSite,oldAttempt,wrongTree,expected]),expected);
 assert.equal(fleetTask(0,job(),[otherSite,oldAttempt,wrongTree]),undefined);
 assert.equal(fleetTask(0,job(),[expected,{...expected,title:'重复记录'}]),undefined);
 assert.equal(fleetTask(0,undefined,[expected]),undefined);
});

test('batch robot task navigation keeps the parent task identity and the correct per-tree dispatch',()=>{
 const value=task({id:'batch',count:2,treeIndices:[0,50],railJob:undefined,railBatch:{baseDone:0,jobs:{0:job(),50:job('job-50')},results:{}}});
 assert.equal(fleetTask(50,job('job-50'),[value]),value);
 assert.equal(fleetTask(0,job('job-50'),[value]),undefined);
 assert.equal(fleetTask(50,job('job-50',{planVersion:'different'}),[value]),undefined);
});

test('strategy sources from another park cannot create a current-task link',()=>{
 const source={treeId:'T-0001',strategyId:'strategy-1',runId:'run-1',revision:1,angle:30,expiresAt:'2026-10-20T00:00:00.000Z',adoptedAt:'2026-10-19T01:00:00.000Z',mode:'simulation',siteId:'demo-xsbn'};
 const original=job('job-0',{harnessSource:source});
 assert.equal(fleetTask(0,original,[task({railJob:original})]),undefined);
 source.siteId='demo-hainan';const value=task({railJob:original});assert.equal(fleetTask(0,original,[value]),value);
});

test('robot status follows paused, blocked, scheduled and retracting simulator phases',()=>{
 const current=activeFleet(),state=current.zones[0];
 assert.equal(robotStatus(state,current,now),'沿轨道前往单树');
 state.paused=true;assert.equal(robotStatus(state,current,now),'本区已暂停');
 state.phase='retracting';assert.equal(robotStatus(state,current,now),'收臂中 · 本区暂停');
 state.paused=false;state.phase='moving';current.jobs[0].weatherBlock='降雨暂缓';assert.equal(robotStatus(state,current,now),'降雨暂缓');
 current.jobs[0].weatherBlock='';current.jobs[0].notBefore=now+1000;assert.equal(robotStatus(state,current,now),'等待作业窗口');
});

let currentFleet=fleet(),selectedRobot={source:'fleet',zone:0};
const path=new URL('../src/workspace/RobotCenter.tsx',import.meta.url);
const {code}=await transformWithOxc(readFileSync(path,'utf8'),'RobotCenter.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const ast=parseAst(code);
const declarations=ast.body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const RobotCenter=new Function('React','useState','useSyncExternalStore','getFleetSnapshot','subscribeFleet','Bot','MapPin','ArrowRight','Trees','sites','treeAlias','taskEvidence','fleetTask','robotViews','eventHoldForZone',declarations+';return RobotCenter;')(
 React,()=>[selectedRobot,value=>{selectedRobot=value;}],(_subscribe,getSnapshot)=>getSnapshot(),()=>currentFleet,()=>()=>{},Bot,MapPin,ArrowRight,Trees,sites,treeAlias,taskEvidence,fleetTask,robotViews,eventHoldForZone);
function text(element){if(typeof element==='string'||typeof element==='number')return String(element);if(!React.isValidElement(element))return '';if(typeof element.type==='function')return text(element.type(element.props));return React.Children.toArray(element.props.children).map(text).join('');}
function walk(element,predicate){if(!React.isValidElement(element))return [];if(typeof element.type==='function')return walk(element.type(element.props),predicate);return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];}
const render=(patch={})=>RobotCenter({site:'hainan',tasks:[],events:[],onEvents(){},onTree(){},onTask(){},onScene(){},...patch});

test('map entry initially opens the requested robot and its own 50 trees',()=>{
 currentFleet=fleet();
 const InitialRobotCenter=new Function('React','useState','useSyncExternalStore','getFleetSnapshot','subscribeFleet','Bot','MapPin','ArrowRight','Trees','sites','treeAlias','taskEvidence','fleetTask','robotViews','eventHoldForZone',declarations+';return RobotCenter;')(
  React,React.useState,(_subscribe,getSnapshot)=>getSnapshot(),()=>currentFleet,()=>()=>{},Bot,MapPin,ArrowRight,Trees,sites,treeAlias,taskEvidence,fleetTask,robotViews,eventHoldForZone);
 const props={site:'hainan',tasks:[],events:[],onEvents(){},onTree(){},onTask(){},onScene(){}};
 const html=renderToStaticMarkup(React.createElement(InitialRobotCenter,{...props,initialZone:1}));
 assert.match(html,/aria-label="R-B机器人详情"/);
 const sampleHtml=renderToStaticMarkup(React.createElement(InitialRobotCenter,{...props,tasks:makeDemoTasks(new Date(now)),initialRobot:{source:'task',zone:1}}));
 assert.match(sampleHtml,/aria-label="R-B机器人详情"/);
 assert.match(sampleHtml,/已完成 12 \/ 36 棵/);
 assert.match(sampleHtml,/HN-B-0013/);
 assert.match(html,/打开HN-B-0001单树档案/);assert.match(html,/打开HN-B-0050单树档案/);
 assert.doesNotMatch(html,/打开HN-A-0001单树档案/);
 const defaultHtml=renderToStaticMarkup(React.createElement(InitialRobotCenter,props));
 assert.match(defaultHtml,/aria-label="R-A机器人详情"/);
 const maoming=renderToStaticMarkup(React.createElement(InitialRobotCenter,{...props,site:'guangdong-maoming',tasks:makeDemoTasks(new Date(now)),initialZone:1}));
 assert.match(maoming,/aria-label="GD-MM-模拟机器人-B机器人详情"/);
 assert.match(maoming,/打开GD-MM-B-0001单树档案/);assert.match(maoming,/打开GD-MM-B-0050单树档案/);
 assert.match(maoming,/广东茂名模拟园区 · B区割胶方案/);
 assert.doesNotMatch(maoming,/打开GD-MM-A-0001单树档案|打开HN-B-/);
});

test('robot list drills into exactly its owned 50 tree aliases and tree callbacks',()=>{
 currentFleet=fleet();selectedRobot={source:'fleet',zone:0};const opened=[];
 const first=render({onTree:index=>opened.push(index)});
 const cards=walk(first,node=>node.type==='button'&&node.props['aria-pressed']!==undefined);assert.equal(cards.length,4);cards[2].props.onClick();
 const selected=render({onTree:index=>opened.push(index)});
 const treeButtons=walk(selected,node=>node.type==='button'&&node.props['aria-label']?.endsWith('单树档案'));
 assert.equal(treeButtons.length,50);assert.equal(treeButtons[0].props['aria-label'],'打开HN-C-0001单树档案');assert.equal(treeButtons.at(-1).props['aria-label'],'打开HN-C-0050单树档案');
 treeButtons[0].props.onClick();treeButtons.at(-1).props.onClick();assert.deepEqual(opened,[100,149]);
});

test('current and queued tasks open their own verified parent record, including same-ID foreign records',()=>{
 currentFleet=activeFleet();currentFleet.zones[0].queue=[1];currentFleet.jobs[1]=job('job-1');selectedRobot={source:'fleet',zone:0};
 const current=task(),queued=task({id:'job-1',title:'排队树任务',treeIndices:[1],railJob:job('job-1')}),foreign=task({site:'xian'}),opened=[];
 const element=render({tasks:[foreign,current,queued],onTask:value=>opened.push(value)});
 const currentButton=walk(element,node=>node.type==='button'&&text(node).startsWith('打开任务'))[0];currentButton.props.onClick();
 const queuedButton=walk(element,node=>node.type==='button'&&text(node)==='排队树任务')[0];queuedButton.props.onClick();
 assert.deepEqual(opened,[current,queued]);assert.match(text(element),/已完成 0 \/ 1 棵/);
});

test('Hainan sample device selection opens its task and queued trees without requiring a rail job',()=>{
 currentFleet=fleet();selectedRobot={source:'task',zone:1};
 const tasks=makeDemoTasks(new Date(now)),opened=[];
 const expected=tasks.find(task=>task.site==='hainan'&&task.block==='B');
 const element=render({tasks,onTask:task=>opened.push(task)});
 assert.match(text(element),/R-B · B区/);
 assert.match(text(element),/已完成 12 \/ 36 棵/);
 walk(element,node=>node.type==='button'&&text(node).startsWith('打开任务'))[0].props.onClick();
 walk(element,node=>node.type==='button'&&text(node)===expected.title)[0].props.onClick();
 assert.deepEqual(opened,[expected,expected]);
 selectedRobot={source:'fleet',zone:0};
});

test('view and robot selection do not mutate the fleet or create task writes; locating uses the selected zone',()=>{
 currentFleet=activeFleet();selectedRobot={source:'fleet',zone:0};const tasks=[task()],before=JSON.stringify([currentFleet,tasks]),located=[];
 const element=render({tasks,onScene:zone=>located.push(zone)});const cards=walk(element,node=>node.type==='button'&&node.props['aria-pressed']!==undefined);cards[3].props.onClick();
 const selected=render({tasks,onScene:zone=>located.push(zone)});walk(selected,node=>node.type==='button'&&text(node)==='在胶园中定位')[0].props.onClick();
 assert.deepEqual(located,[3]);assert.equal(JSON.stringify([currentFleet,tasks]),before);
});

for(const [site,prefix] of [['xsbn','XS'],['xian','XA']])test(`${site} view shows local demo devices without inheriting Hainan tasks or fleet activity`,()=>{
 currentFleet=activeFleet();selectedRobot={source:'fleet',zone:0};const located=[],element=render({site,tasks:[task()],onScene:zone=>located.push(zone)}),html=renderToStaticMarkup(element);
 assert.match(html,new RegExp(`${prefix}-模拟机器人-A`));assert.match(html,/暂无模拟任务/);assert.doesNotMatch(html,/R-A|HN-A-|A区单树作业|沿轨道前往单树/);
 assert.equal(walk(element,node=>node.type==='button'&&node.props['aria-pressed']!==undefined).length,4);
 const treeButtons=walk(element,node=>node.type==='button'&&node.props['aria-label']?.endsWith('单树档案'));
 assert.equal(treeButtons.length,50);assert.equal(treeButtons[0].props['aria-label'],`打开${prefix}-A-0001单树档案`);
 const sceneButton=walk(element,node=>node.type==='button'&&text(node)==='在胶园中定位');assert.equal(sceneButton.length,1);sceneButton[0].props.onClick();assert.deepEqual(located,[0]);
});

test('Maoming robot details keep local tree, task and strategy links across B, C and D zones',()=>{
 currentFleet=activeFleet();selectedRobot={source:'task',zone:1};
 const tasks=makeDemoTasks(new Date(now)),openedTrees=[],openedTasks=[],located=[];
 const props={site:'guangdong-maoming',tasks,onTree:index=>openedTrees.push(index),onTask:value=>openedTasks.push(value),onScene:zone=>located.push(zone)};
 const element=render(props),content=text(element),expectedTask=tasks.find(value=>value.site===props.site&&value.block==='B');
 assert.match(content,/GD-MM-模拟机器人-B · B区/);assert.match(content,/GD-MM-B-0013/);
 assert.match(content,/已完成 12 \/ 36 棵/);
 assert.match(content,/已采用模拟方案 广东茂名模拟园区 · B区割胶方案/);
 assert.doesNotMatch(content,/HN-B-|沿轨道前往单树|派发 job-0/);
 walk(element,node=>node.type==='button'&&text(node)==='GD-MM-B-0013')[0].props.onClick();
 walk(element,node=>node.type==='button'&&text(node).startsWith('打开任务'))[0].props.onClick();
 walk(element,node=>node.type==='button'&&text(node)==='在胶园中定位')[0].props.onClick();
 assert.deepEqual(openedTrees,[62]);assert.deepEqual(openedTasks,[expectedTask]);assert.deepEqual(located,[1]);
 const cards=walk(element,node=>node.type==='button'&&node.props['aria-pressed']!==undefined);cards[2].props.onClick();
 const review=render(props);assert.match(text(review),/GD-MM-C-0009/);assert.match(text(review),/已完成 8 \/ 28 棵/);
 walk(review,node=>node.type==='button'&&text(node)==='GD-MM-C-0009')[0].props.onClick();
 cards[3].props.onClick();const completed=render(props);
 assert.match(text(completed),/已完成 32 \/ 32 棵/);
 assert.match(text(completed),/当前没有正在处理的树/);
 assert.equal(walk(completed,node=>node.props['aria-label']==='本区排队树木').length,0);
 assert.deepEqual(openedTrees,[62,108]);
});

test('robot management opens the shared event workflow without changing fleet or tasks',()=>{
 currentFleet=activeFleet();selectedRobot={source:'fleet',zone:0};
 const tasks=[task()],events=[{id:'fault',siteId:'demo-hainan',kind:'device_fault',zone:0,status:'active',note:'割胶头检修'}];
 const before=JSON.stringify([currentFleet,tasks,events]),opened=[];
 for(const site of ['hainan','xsbn','xian']){
  const element=render({site,tasks,events,onEvents:()=>opened.push(site)});
  walk(element,node=>node.type==='button'&&text(node)==='天气与设备联动')[0].props.onClick();
 }
 assert.deepEqual(opened,['hainan','xsbn','xian']);
 assert.equal(JSON.stringify([currentFleet,tasks,events]),before);
});

test('selected robot shows its own pending faults alongside park rain and excludes other-site events',()=>{
 currentFleet=fleet({ready:false});selectedRobot={source:'fleet',zone:0};
 const events=[
  {id:'rain',siteId:'demo-hainan',kind:'rain',zone:null,status:'active',note:'海南全园降雨'},
  {id:'fault-c',siteId:'demo-hainan',kind:'device_fault',zone:2,status:'resolved',note:'R-C割胶头检修'},
  {id:'foreign',siteId:'demo-xsbn',kind:'rain',zone:null,status:'active',note:'西双版纳降雨'},
  {id:'closed',siteId:'demo-hainan',kind:'device_fault',zone:0,status:'closed',note:'此前A区故障'},
 ];
 const initial=render({events});
 assert.match(text(initial),/海南全园降雨/);assert.doesNotMatch(text(initial),/R-C割胶头检修|西双版纳降雨|此前A区故障/);
 walk(initial,node=>node.type==='button'&&node.props['aria-pressed']!==undefined)[2].props.onClick();
 const selected=render({events});
 assert.match(text(selected),/R-C割胶头检修（已解除，待确认恢复）/);assert.match(text(selected),/海南全园降雨/);
 assert.doesNotMatch(text(selected),/西双版纳降雨|此前A区故障/);
});


test('live photo work wins over sample tasks without duplicating any zone',()=>{
 const current=activeFleet(job('photo',{observation:{}}));current.zones[0].phase='working';
 const tasks=makeDemoTasks(new Date(now));
 const robots=robotViews('hainan',current,tasks,now);
 assert.equal(robots.length,4);assert.equal(new Set(robots.map(r=>r.zone)).size,4);
 assert.equal(robots[0].name,'R-A');assert.equal(robots[0].source,'fleet');
 assert.equal(robots[0].status,'正在拍照');assert.equal(robots[0].currentTask,undefined);
 assert.ok(robots[0].history.every(t=>t.site==='hainan'&&t.block==='A'));
});

test('completed tasks open from robot history instead of current work',()=>{
 currentFleet=fleet();selectedRobot={source:'task',zone:3};
 const tasks=makeDemoTasks(new Date(now)),opened=[];
 const element=render({tasks,onTask:t=>opened.push(t)});
 assert.match(text(element),/R-D · D区/);assert.match(text(element),/暂无执行任务/);
 const history=walk(element,n=>n.type==='details'&&text(n).startsWith('任务记录'))[0];
 assert.ok(history);walk(history,n=>n.type==='button')[0].props.onClick();
 assert.equal(opened[0].block,'D');assert.equal(opened[0].done,32);
});
