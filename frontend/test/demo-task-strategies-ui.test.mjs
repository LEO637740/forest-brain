import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {treeAlias} from '../src/workspace/model.ts';
import {phaseLabels} from '../src/workspace/taskFlow.ts';
import {taskEvidence} from '../src/workspace/taskLifecycleModel.ts';
import {treeWorkRecords} from '../src/workspace/treeWorkModel.ts';
import {demoTaskAngleRange} from '../../shared/demoTaskChain.ts';

async function component(file,name,bindings){
 const {code}=await transformWithOxc(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
 const source=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
 return new Function(...Object.keys(bindings),source+`;return ${name};`)(...Object.values(bindings));
}
const Card=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);
const DemoTaskAngleDetails=await component('integration/DemoTaskAngleDetails.tsx','DemoTaskAngleDetails',{React,treeAlias});
const ExecutionLinks=await component('integration/ExecutionLinks.tsx','ExecutionLinks',{React,treeAlias,treeWorkRecords,Card,demoTaskAngleRange});
const DemoTaskStrategies=await component('integration/DemoTaskStrategies.tsx','DemoTaskStrategies',{React,treeAlias,Card,when:value=>value,demoTaskAngleRange,DemoTaskAngleDetails});
const DemoTaskReceipts=await component('integration/DemoTaskStrategies.tsx','DemoTaskReceipts',{React,treeAlias,Card,when:value=>value,demoTaskAngleRange,DemoTaskAngleDetails});
const TaskLifecycle=await component('workspace/TaskLifecycle.tsx','TaskLifecycle',{React,treeAlias,taskEvidence,taskHoldReason:()=>null,phaseLabels,TaskEvidenceActions:()=>null,demoTaskAngleRange,DemoTaskAngleDetails,DemoTaskReceipts});
const fixture=(block='A',adopted=false)=>({id:`demo-${block}`,site:'hainan',date:'2026-10-19',block,title:`${block}区任务`,status:adopted?'执行中':'待开始',count:2,done:adopted?1:0,treeIndices:[0,1],dispatch:{phase:adopted?'running':'scheduled',history:[],requestId:`demo-${block}`},demoStrategy:{strategyId:`strategy-${block}`,taskId:`demo-${block}`,siteId:'demo-hainan',revision:1,mode:'simulation',generator:'demo_rules',generatedAt:'2026-10-19T01:00:00Z',adoptedAt:adopted?'2026-10-19T01:02:00Z':null,adoptedBy:adopted?'演示操作员':null,title:`${block}区割胶方案`,summary:`${block}区按28度割线执行`,basis:['模拟树围与天气样本'],treeIndices:[0,1],parameters:{angleDeg:28,cutDepthMm:1.2,speedMmPerSec:18},surfaceAction:'绕过隆起后继续'},demoReceipts:adopted?[{receiptId:`demo-${block}:tree:0`,taskId:`demo-${block}`,siteId:'demo-hainan',strategyId:`strategy-${block}`,strategyRevision:1,treeIndex:0,treeId:'T-0001',finishedAt:'2026-10-19T01:03:00Z',outcome:'completed',angleDeg:28,note:'模拟完成',mode:'simulation'}]:[]});
function elements(node,predicate){if(!React.isValidElement(node))return [];return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>elements(child,predicate))];}
const text=node=>renderToStaticMarkup(node);

test('task strategy selection opens the exact linked task and its saved parameters',()=>{
 const first=fixture(),selected=fixture('C',true),opened=[],flows=[],selections=[];
 const node=DemoTaskStrategies({tasks:[first,selected],selectedTaskId:selected.id,onTask:task=>opened.push(task),onOpenFlow:task=>flows.push(task),onSelect:id=>selections.push(id)});
 const html=text(node);
 assert.match(html,/C区按28度割线执行/);assert.doesNotMatch(html,/<h3[^>]*>A区按/);
 assert.match(html,/切割深度/);assert.match(html,/1\.2/);assert.match(html,/逐树回传 · 1 条/);assert.match(html,/HN-A-0001/);
 assert.ok(html.indexOf('打开任务执行')<html.indexOf('采用与执行时间线'));
 assert.match(html,/<details class="demo-task-receipt-panel"><summary>逐树回传/);
 const buttons=elements(node,element=>element.type==='button');
 buttons.find(button=>text(button).includes('打开任务执行')).props.onClick();
 buttons[0].props.onClick();
 assert.equal(opened[0],selected);assert.deepEqual(flows,[]);assert.deepEqual(selections,[first.id]);
});

test('pending strategy shows an adoption entry without claiming returned results',()=>{
 const task=fixture(),node=DemoTaskStrategies({tasks:[task],onOpenFlow(){}}),html=text(node);
 assert.match(html,/待采用/);assert.match(html,/打开任务执行/);assert.match(html,/逐树回传 · 0 条/);
 assert.match(html,/每完成一棵树会自动回传结果/);assert.doesNotMatch(html,/已采用|已完成割胶/);
});

test('completed strategy retains actual receipt counts and opens its task result',()=>{
 const task=fixture('D',true);task.status='已完成';task.done=2;task.demoReceipts.push({...task.demoReceipts[0],receiptId:'second',treeIndex:1,treeId:'T-0002'});
 const html=text(DemoTaskStrategies({tasks:[task],onTask(){},onOpenFlow(){}}));
 assert.match(html,/2 完成/);assert.match(html,/逐树回传 · 2 条/);assert.match(html,/查看执行结果/);assert.doesNotMatch(html,/继续任务演示|进入采用与执行/);
});

test('task lifecycle keeps its plan, basis and receipts in the selected task without a strategy-page detour',()=>{
 const task=fixture(),opened=[],node=TaskLifecycle({task,fleet:{},onStrategy:selected=>opened.push(selected)}),html=text(node);
 assert.match(html,/A区割胶方案/);assert.match(html,/等待采用方案/);assert.match(html,/策略已生成/);assert.doesNotMatch(html,/尚未关联策略|未携带可核对/);
 assert.match(html,/任务方案、依据与逐树回传/);assert.match(html,/模拟树围与天气样本/);assert.match(html,/绕过隆起后继续/);
 assert.match(html,/逐树回传 · 0 条/);assert.doesNotMatch(html,/查看关联策略/);
 assert.equal(elements(node,element=>element.type==='button').length,0);assert.deepEqual(opened,[]);
 const adopted=fixture('B',true),adoptedHtml=text(TaskLifecycle({task:adopted,fleet:{}}));
 assert.match(adoptedHtml,/策略已采用/);assert.match(adoptedHtml,/1 棵完成，均关联本方案 v1/);
 assert.match(adoptedHtml,/逐树回传 · 1 条/);assert.match(adoptedHtml,/HN-A-0001/);assert.match(adoptedHtml,/模拟完成/);
});

test('whole-park tasks retain their adopted origin and open the original plan in either execution mode',()=>{
 for(const demo of [false,true]){
  const task={...fixture('A',true),sourceParkPlanId:'park-plan-original'};
  if(!demo){delete task.demoStrategy;delete task.demoReceipts;}
  const opened=[],node=TaskLifecycle({task,fleet:{},onStrategy:selected=>opened.push(selected),onReview(){throw new Error('must open the original plan');}});
  const html=text(node);
  assert.match(html,/全园方案已采用/);
  assert.match(html,/park-plan-original/);
  assert.doesNotMatch(html,/尚未关联策略采用记录|当前任务未携带可核对/);
  elements(node,element=>element.type==='button'&&text(element).includes('查看原全园方案')).at(0).props.onClick();
  assert.equal(opened[0],task);
 }
});

test('production task lifecycle separates source adoption from local execution parameter binding',()=>{
 for(const source of ['sourceParkPlanId','sourceScenarioId'])for(const adopted of [false,true]){
  const task={...fixture('A',adopted),[source]:'adopted-production-source'};
  const node=TaskLifecycle({task,fleet:{}});
  const stage=elements(node,element=>element.type==='li')[1];
  assert.match(text(stage),/来源方案已采用/);
  assert.doesNotMatch(text(stage),/等待采用方案|策略已采用/);
  if(adopted){assert.match(text(stage),/执行参数绑定：演示操作员/);assert.match(text(stage),/北京时间/);}
  else assert.doesNotMatch(text(stage),/执行参数绑定/);
 }
});

test('task and strategy pages display per-tree execution angles and their adopted source',()=>{
 const task=fixture();
 task.demoStrategy.adoptedAngles=[{treeIndex:0,treeId:'T-0001',angleDeg:26.1,strategyId:'tree-angle-source',runId:'angle-run',revision:2,adoptedAt:'2026-10-19T00:00:00Z'}];
 for(const html of [text(DemoTaskStrategies({tasks:[task]})),text(TaskLifecycle({task,fleet:{}}))]){
  assert.match(html,/26\.1–28/);assert.match(html,/查看已采用的单树角度/);
  assert.match(html,/HN-A-0001/);assert.match(html,/tree-angle-source/);assert.match(html,/v2/);
 }
 assert.match(text(ExecutionLinks({tasks:[task],site:task.site})),/26\.1–28/);
});
