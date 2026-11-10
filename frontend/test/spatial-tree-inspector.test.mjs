import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';
import {treeAlias} from '../src/workspace/model.ts';
import {treePosition,treeZone} from '../src/workspace/workbenchModel.ts';
import {treeWorkRecords} from '../src/workspace/treeWorkModel.ts';
import {taskDate} from '../src/workspace/operationsModel.ts';
import {taskRobotTarget} from '../src/workspace/robotCenterModel.ts';
import {makeDemoTasks} from '../../backend/src/adapters/demo-tasks.js';

const {code}=await transformWithOxc(readFileSync(new URL('../src/workspace/spatial/TreeSpatialInspector.tsx',import.meta.url),'utf8'),'TreeSpatialInspector.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const source=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const kinds={tapping_angle:'角度优化',surface_action:'树表识别',growth_plan:'生长与割线',pest_risk:'健康风险'};
const stub=()=>{};
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
function mount({site='hainan',treeId='T-0001',trees,tasks=[],view={strategyStatus:'needs_generation',strategy:null},account=null}={}){
  const reads=[],calls=[],slots=[],prepared=[];
  let cursor=0,element;
  const bindings={React,kinds,treeAlias,treePosition,treeZone,treeWorkRecords,taskDate,taskRobotTarget,DATA_MODE:'mixed_demo',siteIdOf:site=>'demo-'+site,statuses:{expired:'建议已过期'},
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>slots[index]=value];},
    useRead(path){reads.push(path);return {data:path.includes('/park')?{trees:trees??[{treeId,circumferenceCm:61,heightM:11,provenance:{mode:'simulated'}}]}:view,reload:stub};},
    StrategyRecommendation:({strategy})=>React.createElement('article',{'aria-label':'推荐策略'},strategy.summary),
    post:stub,read:stub,currentAccount:()=>account,can:(who,permission)=>who.permissions.includes(permission),
    prepareRuleStrategies:async(siteId,treeIds)=>{prepared.push({siteId,treeIds});return {runs:treeIds.length*4,succeeded:treeIds.length*4,unsettled:0,other:0};},
  };
  const components=new Function(...Object.keys(bindings),source+';return {TreeSpatialDetails,TreeSpatialInspector};')(...Object.values(bindings));
  const props={site,treeId,tasks,...Object.fromEntries(['onTree','onStrategy','onRobot','onTask'].map(name=>[name,(...args)=>calls.push([name,...args])]))};
  const render=()=>{cursor=0;element=components.TreeSpatialDetails(props);};
  render();
  return {...components,props,reads,calls,prepared,render,get element(){return element;},click(label){const button=walk(element,node=>node.type==='button'&&text(node).includes(label))[0];assert.ok(button,label);button.props.onClick();}};
}
const task=(id,site,treeIndices,robot='设备记录')=>({id,site,treeIndices,robot,title:id,status:'待开始',count:1,done:0,block:'A',kind:'割胶',start:'06:00',end:'07:00'});

test('map inspector opens archive and selected strategy for the same tree and site',()=>{
  const page=mount({site:'xsbn',treeId:'T-0052'});
  assert.ok(page.reads.includes('/api/demo/park?siteId=demo-xsbn'));
  page.click('单树档案');assert.deepEqual(page.calls.at(-1),['onTree',51]);
  for(const kind of Object.keys(kinds)){
    walk(page.element,node=>node.props['aria-label']==='地图单树策略类型')[0].props.onChange({target:{value:kind}});
    page.render();page.click('完整策略');
    assert.deepEqual(page.calls.at(-1),['onStrategy',51,kind]);
    assert.ok(page.reads.includes(`/api/demo/trees/T-0052/view?kind=${kind}&dataMode=mixed_demo&siteId=demo-xsbn`));
  }
  const first=page.TreeSpatialInspector(page.props),newTree=page.TreeSpatialInspector({...page.props,treeId:'T-0001'}),newSite=page.TreeSpatialInspector({...page.props,site:'hainan'});
  assert.equal(first.key,'xsbn:T-0052');assert.notEqual(first.key,newTree.key);assert.notEqual(first.key,newSite.key);
});

test('imported dimensions and source remain visible without turning logical groups into surveyed boundaries',()=>{
  const trees=[{treeId:'T-0001',circumferenceCm:68,heightM:12,provenance:{mode:'simulated'},fieldRecord:{sourceTreeId:'实测树 21',provenanceMode:'measured',sourceName:'现场测量表'}}];
  const page=mount({trees,view:{strategyStatus:'available',strategy:{summary:'明早按 30° 割胶'}}});
  assert.match(text(page.element),/实测树 21.*HN-A-0001.*68 cm树围.*12 m树高.*导入实测 · 现场测量表/);
  assert.match(text(page.element),/明早按 30° 割胶/);
  assert.match(text(page.element),/A区模拟分组/);
  const device=walk(page.element,node=>node.props['aria-label']==='本树关联设备')[0];
  assert.match(text(device),/R-A分区模拟设备/);
  page.click('查看设备');assert.deepEqual(page.calls.at(-1),['onRobot',{source:'fleet',zone:0}]);
});

test('tree tasks require exact tree and site membership; other parks do not invent a robot',()=>{
  const exact=task('本树作业','xsbn',[0],'版纳任务设备'),sameBlock=task('同分区其他树','xsbn',[1]),foreign=task('其他园区','hainan',[0]);
  const page=mount({site:'xsbn',tasks:[exact,sameBlock,foreign]});
  const jobs=walk(page.element,node=>node.props['aria-label']==='地图本树任务')[0];
  assert.match(text(jobs),/本树作业/);assert.match(text(jobs),/日期待核对 · 06:00–07:00/);assert.doesNotMatch(text(jobs),/同分区其他树|其他园区/);
  page.click('本树作业');assert.equal(page.calls.at(-1)[1],exact);
  const devices=walk(page.element,node=>node.props['aria-label']==='本树关联设备')[0];
  assert.match(text(devices),/版纳任务设备来自本树关联任务记录/);assert.doesNotMatch(text(devices),/R-A|分区模拟设备/);
  const empty=mount({site:'xsbn',tasks:[sameBlock,foreign]});
  assert.match(text(empty.element),/暂无本树关联设备记录/);assert.doesNotMatch(text(empty.element),/版纳任务设备|R-A/);
});


test('Hainan task devices and browser fleet keep distinct map navigation identities',()=>{
  const tasks=makeDemoTasks(new Date('2026-10-23T01:00:00Z'));
  const page=mount({treeId:'T-0063',tasks});
  const device=walk(page.element,node=>node.props['aria-label']==='本树关联设备')[0];
  assert.match(text(device),/HN-模拟机器人-B来自本树关联任务记录/);
  assert.match(text(page.element),/2026-10-23 · /);
  assert.doesNotMatch(text(device),/R-B/);
  page.click('查看设备');assert.deepEqual(page.calls.at(-1),['onRobot',{source:'task',zone:1}]);
  const rail={...task('rail-B','hainan',[62],'R-B'),block:'B',railJob:{id:'rail-B'}};
  const fleetPage=mount({treeId:'T-0063',tasks:[rail]});
  fleetPage.click('查看设备');assert.deepEqual(fleetPage.calls.at(-1),['onRobot',{source:'fleet',zone:1}]);
  const maoming=mount({site:'guangdong-maoming',treeId:'T-0063',tasks});
  maoming.click('查看设备');assert.deepEqual(maoming.calls.at(-1),['onRobot',{source:'task',zone:1}]);
  assert.match(text(maoming.element),/GD-MM-模拟机器人-B/);
});

test('a park without fresh advice offers rule generation for the tree or its zone to managers, not growers',async()=>{
  const manager={permissions:['strategy.adopt']},grower={permissions:['plot.read']};
  const page=mount({site:'xsbn',treeId:'T-0055',account:manager,view:{strategyStatus:'expired',strategy:null}});
  assert.match(text(page.element),/暂无/);
  page.click('生成本区 50 棵');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(page.prepared.length,1);assert.equal(page.prepared[0].siteId,'demo-xsbn');
  assert.deepEqual(page.prepared[0].treeIds,Array.from({length:50},(_,offset)=>`T-${String(51+offset).padStart(4,'0')}`));
  page.render();assert.match(text(page.element),/已生成 200 项规则建议/);
  assert.equal(walk(mount({site:'xsbn',treeId:'T-0055',account:grower,view:{strategyStatus:'expired',strategy:null}}).element,node=>node.type==='button'&&/生成本/.test(text(node))).length,0);
  const fresh=mount({site:'xsbn',treeId:'T-0055',account:manager,view:{strategyStatus:'available',strategy:{summary:'坡角 26°'}}});
  assert.equal(walk(fresh.element,node=>node.type==='button'&&/生成本/.test(text(node))).length,0);
});
