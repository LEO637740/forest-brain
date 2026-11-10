import {sites} from '../../shared/parkCatalog.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/StrategyWorkspace.tsx',import.meta.url),'utf8'),'StrategyWorkspace.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const selected=new Set(['tabs','BackendStrategyWorkspace','topic','Logistics']);
const source=parseAst(code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node).filter(node=>node&&(node.type==='FunctionDeclaration'?selected.has(node.id?.name):node.type==='VariableDeclaration'&&node.declarations.some(d=>selected.has(d.id.name)))).map(node=>code.slice(node.start,node.end)).join('\n');
const business={records:[
 {topic:'inventory',content:JSON.stringify({totals:{onHandKg:1000,availableKg:600,reservedKg:100,heldKg:300},items:[]})},
 {topic:'processing',content:JSON.stringify({batches:[{batchId:'B-冻结',quantityKg:300,stage:'quality_hold',qualityStatus:'needs_recheck'}]})},
 {topic:'transport',content:JSON.stringify({shipments:[{shipmentId:'S-延误',batchId:'B-运输',quantityKg:200,status:'delayed',plannedArrivalAt:'原定时间',estimatedArrivalAt:'到货时间',delayReason:'车辆故障'}]})},
]};
const noop=()=>null;
const bindings={sites,React,StrategyRefreshStatus:noop,useState:initial=>[initial,noop],Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children),State:noop,Chart:noop,when:value=>value,useRead:()=>({data:business}),ModelControlPanel:()=>React.createElement('p',null,'模型调用控制'),ReviewDesk:noop,IndustryBrief:noop,MarketSimulation:noop,Market:noop,Health:noop,Trees:noop,Weather:noop,History:noop,ActionHistory:noop,ExecutionLinks:noop,ParkTappingPlan:noop};
const {BackendStrategyWorkspace,Logistics}=new Function(...Object.keys(bindings),source+';return {BackendStrategyWorkspace,Logistics};')(...Object.values(bindings));
function visibleText(node){
 if(typeof node==='string'||typeof node==='number')return String(node);
 if(!React.isValidElement(node))return '';
 if(typeof node.type==='function')return visibleText(node.type(node.props));
 const children=React.Children.toArray(node.props.children);
 return (node.type==='details'&&!node.props.open?children.filter(child=>React.isValidElement(child)&&child.type==='summary'):children).map(visibleText).join(' ');
}
function walk(node,predicate){
 if(!React.isValidElement(node))return [];
 if(typeof node.type==='function')return walk(node.type(node.props),predicate);
 return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];
}

test('strategy has four decision categories and keeps datasets and model controls out of the page',()=>{
 const page=BackendStrategyWorkspace({tab:'park',onTab(){},onTree(){},tasks:[]});
 const nav=walk(page,node=>node.type==='nav'&&node.props['aria-label']==='策略分类')[0];
 assert.deepEqual(walk(nav,node=>node.type==='button').map(visibleText),['生产计划','经营销售','单树与异常','策略记录']);
 assert.doesNotMatch(visibleText(page),/模型调用控制|储运与交付|库存构成|任务方案|大脑学习与参数/);
 assert.equal(walk(page,node=>node.type==='details'&&node.props.className==='hb-workspace-settings').length,0);
});

test('related topics highlight their decision category and data links target the relocated views',()=>{
 for(const [tab,group,target,reference] of [['weather','生产计划','public','weather'],['industry','经营销售','public','industry'],['market','经营销售','business','weather'],['health','单树与异常','analytics','weather'],['reviews','单树与异常','analytics','weather'],['records','策略记录','catalog','weather']]){
  const calls=[];
  const page=BackendStrategyWorkspace({tab,tasks:[],onTab(){},onTree(){},onData:(...args)=>calls.push(args),onTasks:()=>calls.push('tasks')});
  const active=walk(page,node=>node.type==='button'&&node.props['aria-current']==='page');
  assert.deepEqual(active.map(visibleText),[group]);
  walk(page,node=>node.type==='button'&&visibleText(node)==='查看数据 →')[0].props.onClick();
  walk(page,node=>node.type==='button'&&visibleText(node)==='查看执行 →')[0].props.onClick();
  assert.deepEqual(calls,[tab==='health'?['analytics',undefined,'health']:[target,reference],'tasks']);
 }
});

test('operational roles keep weather and execution entry points without mounting economic plans',()=>{
 const scopedBindings={...bindings,ParkTappingPlan:()=>{throw Error('economic plan must not mount');},MarketSimulation:()=>{throw Error('market model must not mount');},Weather:()=>React.createElement('p',null,'本园天气窗口')};
 const Workspace=new Function(...Object.keys(scopedBindings),source+';return BackendStrategyWorkspace;')(...Object.values(scopedBindings));
 for(const tab of ['park','market','industry']){
  const opened=[],page=Workspace({tab,allowBusiness:false,tasks:[],onTab:value=>opened.push(value),onTree(){},onTasks:()=>opened.push('tasks')});
  const content=visibleText(page);assert.match(content,/本园天气窗口/);assert.doesNotMatch(content,/经营销售|全园割胶安排|生产与销售方案/);
  walk(page,node=>node.type==='button'&&visibleText(node)==='查看执行 →')[0].props.onClick();
  walk(page,node=>node.type==='button'&&visibleText(node)==='作业天气')[0].props.onClick();
  assert.deepEqual(opened,['tasks','weather']);
 }
});

test('storage actions retain task navigation and expose inventory through a closed detail',()=>{
 let opened=0;
 const page=Logistics({onTasks:()=>opened++});
 const button=walk(page,node=>node.type==='button'&&visibleText(node)==='查看作业与运输任务 →')[0];
 button.props.onClick();assert.equal(opened,1);
 const inventory=walk(page,node=>node.type==='details')[0];
 assert.equal(inventory.props.open,undefined);
 assert.match(visibleText({...inventory,props:{...inventory.props,open:true}}),/库存构成/);
});

test('sales production link opens the same parks latest full plan after viewing a historical plan',()=>{
 let tab='market',parkPlanId='historical-park-plan',salesProps,planProps;
 const scopedBindings={...bindings,
  MarketSimulation:props=>{salesProps=props;return React.createElement('button',{onClick:props.onProductionPlan},'查看全园割胶策略');},
  ParkTappingPlan:props=>{planProps=props;return React.createElement('p',null,'当前园区方案');}};
 const Workspace=new Function(...Object.keys(scopedBindings),source+';return BackendStrategyWorkspace;')(...Object.values(scopedBindings));
 const render=()=>Workspace({site:'guangdong-maoming',tab,tasks:[],parkPlanId,onTab:value=>{tab=value;},onLatestParkPlan:()=>{parkPlanId=null;},onTree(){}});
 const page=render();
 walk(page,node=>node.type==='button'&&visibleText(node)==='查看全园割胶策略')[0].props.onClick();
 assert.equal(tab,'park');assert.equal(parkPlanId,null);
 visibleText(render());
 assert.equal(salesProps.site,'guangdong-maoming');
 assert.equal(planProps.site,'guangdong-maoming');assert.equal(planProps.planId,null);
});
