import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChevronDown} from 'lucide-react';
import {transformWithOxc,parseAst} from 'vite';
import {getTreeYieldSeries} from '../src/workspace/analyticsData.ts';
import {treeAlias} from '../src/workspace/model.ts';
import {treeWorkRecords} from '../src/workspace/treeWorkModel.ts';
import {operationDateLabel} from '../src/workspace/operationsModel.ts';
import {demoTaskAngle} from '../../shared/demoTaskChain.ts';
import {makeDemoTasks} from '../../backend/src/adapters/demo-tasks.js';

const sourceRoot=new URL('../src/workspace/',import.meta.url);
async function compile(file){
 const {code}=await transformWithOxc(readFileSync(new URL(file,sourceRoot),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
 return {code,ast:parseAst(code)};
}
const incidentModule=await compile('SurfaceIncidentView.tsx');
const incidentNode=incidentModule.ast.body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node).find(node=>node?.type==='FunctionDeclaration'&&node.id.name==='incidentResult');
assert.ok(incidentNode);
const incidentResult=new Function(incidentModule.code.slice(incidentNode.start,incidentNode.end)+';return incidentResult;')();
const component=await compile('TreeWorkSummary.tsx');
const declarations=component.ast.body.filter(node=>node.type!=='ImportDeclaration').map(node=>component.code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const {TreeWorkSummary,TreeWorkHistory}=new Function('React','treeWorkRecords','operationDateLabel','incidentResult','ChevronDown','getTreeYieldSeries','treeAlias','demoTaskAngle',declarations+';return {TreeWorkSummary,TreeWorkHistory};')(React,treeWorkRecords,operationDateLabel,incidentResult,ChevronDown,getTreeYieldSeries,treeAlias,demoTaskAngle);

const requestedAt='2026-10-18T02:00:00.000Z';
const source={treeId:'T-0001',strategyId:'strategy-one',runId:'run-one',revision:2,angle:30,adoptedAt:'2026-10-18T01:00:00.000Z',expiresAt:'2026-10-18T03:00:00.000Z',mode:'simulation',siteId:'demo-hainan'};
const job=(id='work-one',patch={})=>({id,attemptId:`attempt-${id}`,planVersion:'fixture-v2',angle:30,requestedAt,...patch});
const task=(patch={})=>({id:'work-one',site:'hainan',title:'本树任务一',block:'A',robot:'Robot A',date:'2026-10-18',start:'10:00',end:'11:00',count:1,done:0,status:'执行中',kind:'割胶',treeIndices:[0],railJob:job(),...patch});
const receipt=(index,original,outcome='completed',finishedAt='2026-10-18T02:01:00.000Z')=>({index,job:structuredClone(original),outcome,finishedAt});
function completed(patch={}){
 const value=task({status:'已完成',done:1,...patch});
 return {...value,railResult:receipt(0,value.railJob)};
}
function batch(patch={}){
 return task({id:'batch',title:'三树批次任务',count:3,treeIndices:[0,1,2],railJob:undefined,railBatch:{baseDone:0,jobs:{0:job('job-0'),1:job('job-1'),2:job('job-2')},results:{}},...patch});
}
function walk(element,predicate){
 if(!React.isValidElement(element))return [];
 if(typeof element.type==='function')return walk(element.type(element.props),predicate);
 return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];
}
function text(element){
 if(typeof element==='string'||typeof element==='number')return String(element);
 if(!React.isValidElement(element))return '';
 if(typeof element.type==='function')return text(element.type(element.props));
 return React.Children.toArray(element.props.children).map(text).join('');
}
function render(Component,tasks,patch={}){
 return Component({index:0,tasks,onTask(){},onPhoto(){},site:'hainan',...patch});
}
function html(Component,tasks,patch={}){return renderToStaticMarkup(render(Component,tasks,patch));}
function status(Component,value){
 const element=render(Component,[value]);
 const labels=walk(element,node=>node.type===(Component===TreeWorkSummary?'h3':'summary'));
 assert.equal(labels.length,1);
 return text(labels[0]);
}
function assertStatuses(value,expected){
 assert.equal(status(TreeWorkSummary,value),expected);
 assert.ok(status(TreeWorkHistory,value).startsWith(expected),status(TreeWorkHistory,value));
}

test('summary and expanded history show the same verified single-tree completion and original strategy',()=>{
 const original=completed({railJob:job('work-one',{harnessSource:source})});
 assertStatuses(original,'已完成割胶');
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  const value=html(Component,[original]);
  assert.match(value,/关联模拟策略 v2 · T-0001/);
  assert.match(value,/fixture-v2 · 30°/);
  assert.match(value,/回执时间：2026\/10\/18 10:01:00（北京时间）/);
  assert.match(value,/通过关联核对的模拟执行回执/);
  assert.match(value,/本树结果不代表整批已完成或实测产胶量/);
 }
});

for(const outcome of ['completed','cancelled'])test(`an old-attempt ${outcome} receipt is unverified in both tree views`,()=>{
 const original=completed();original.railResult=receipt(0,{...original.railJob,attemptId:'old-attempt'},outcome);
 assertStatuses(original,'作业记录待核对');
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  const value=html(Component,[original]);
  assert.match(value,/暂不能确认完成或取消/);
  assert.doesNotMatch(value,/回执时间|已完成割胶|已取消作业/);
 }
});

for(const batchStatus of ['执行中','已完成','已取消'])test(`batch status ${batchStatus} does not become the current tree result without its receipt`,()=>{
 const original=batch({status:batchStatus,done:batchStatus==='已完成'?3:1});
 original.railBatch.results[1]=receipt(1,original.railBatch.jobs[1]);
 assertStatuses(original,'等待本树回执');
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  const value=html(Component,[original]);
  assert.match(value,/尚无本树通过核对的回执/);
  assert.match(value,/不能据此确认本树完成、取消或正在执行/);
 }
});

test('a verified current-tree cancellation stays cancelled when another batch tree completes',()=>{
 const original=batch({done:1,status:'待处理'});
 original.railBatch.results[0]=receipt(0,original.railBatch.jobs[0],'cancelled');
 original.railBatch.results[1]=receipt(1,original.railBatch.jobs[1]);
 assertStatuses(original,'已取消作业');
 for(const Component of [TreeWorkSummary,TreeWorkHistory])assert.match(html(Component,[original]),/回执时间/);
});

for(const mismatch of [{siteId:'demo-xsbn'},{treeId:'T-0002'},{revision:0}])test(`invalid original source is not displayed as an adopted strategy: ${JSON.stringify(mismatch)}`,()=>{
 const original=completed({railJob:job('work-one',{harnessSource:{...source,...mismatch}})});
 assertStatuses(original,'作业记录待核对');
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  const value=html(Component,[original]);
  assert.doesNotMatch(value,/关联模拟策略|fixture-v2 · 30°|回执时间/);
 }
});

test('both tree views filter other sites, unrelated targets, and tasks with no explicit target list',()=>{
 const original=completed(),foreign=completed({id:'foreign',title:'别园记录',site:'xsbn',railJob:job('foreign')});
 const unrelated=completed({id:'unrelated',title:'别树记录',treeIndices:[1],railJob:job('unrelated')});
 const unscoped=task({id:'unscoped',title:'无范围记录',treeIndices:undefined,railJob:undefined});
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  const value=html(Component,[foreign,unrelated,unscoped,original]);
  assert.match(value,/本树任务一/);assert.doesNotMatch(value,/别园记录|别树记录|无范围记录/);
  const other=html(Component,[original,foreign],{site:'xsbn'});
  assert.match(other,/别园记录/);assert.doesNotMatch(other,/本树任务一/);
 }
});

test('summary selects the newest recorded work and history sorts callbacks with their own task',()=>{
 const older=completed({id:'older',title:'较早回执',railJob:job('older')});
 const newer=completed({id:'newer',title:'较新回执',railJob:job('newer')});
 newer.railResult.finishedAt='2026-10-18T04:00:00.000Z';
 const undated=task({id:'undated',title:'无时间计划',railJob:undefined,date:'2099-01-01'});
 const tasks=[undated,older,newer],opened=[];
 const summary=render(TreeWorkSummary,tasks,{onTask:value=>opened.push(value)});
 assert.match(text(summary),/较新回执/);assert.doesNotMatch(text(summary),/较早回执|无时间计划/);
 const summaryLinks=walk(summary,node=>node.type==='button'&&text(node)==='查看关联任务 →');
 assert.equal(summaryLinks.length,1);summaryLinks[0].props.onClick();assert.equal(opened[0],newer);
 const history=render(TreeWorkHistory,tasks,{onTask:value=>opened.push(value)});
 const details=walk(history,node=>node.type==='details');assert.equal(details.length,3);
 assert.deepEqual(details.map(element=>text(walk(element,node=>node.type==='summary')[0])).map(label=>tasks.find(value=>label.includes(value.title))?.id),['newer','older','undated']);
 for(const detail of details){
  const summaries=walk(detail,node=>node.type==='summary');assert.equal(summaries.length,1);
  const links=walk(detail,node=>node.type==='button'&&text(node)==='查看关联任务 →');assert.equal(links.length,1);
  links[0].props.onClick();
 }
 assert.deepEqual(opened,[newer,newer,older,undated]);
 assert.match(text(history),/时间/);assert.match(text(details[2]),/记录时间待核对/);
});

test('history uses native expandable details with the verified result and evidence inside each entry',()=>{
 const original=completed();
 const detail=walk(render(TreeWorkHistory,[original]),node=>node.type==='details')[0];
 assert.ok(detail);
 assert.equal(detail.props.open,undefined,'History entries should remain user-expandable instead of being forced open');
 const children=React.Children.toArray(detail.props.children);
 assert.equal(children[0].type,'summary');
 assert.match(text(children[0]),/已完成割胶.*本树任务一/);
 assert.match(children.slice(1).map(text).join(''),/回执时间.*模拟执行回执/);
 assert.match(renderToStaticMarkup(detail),/<details[^>]*><summary>/);
});

test('surface photo controls belong only to the selected tree and preserve callback task identity',()=>{
 const original=task({railJob:undefined,count:2,treeIndices:[0,1],status:'待处理',dispatch:{phase:'review',requestId:'surface-one',history:[{time:requestedAt,label:'已发现树表异常'}],incident:{treeIndex:0,status:'review',category:'结构隆起',captures:1,detectedAt:requestedAt,lastCaptureAt:requestedAt}}});
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  const opened=[];
  const selected=render(Component,[original],{onPhoto:value=>opened.push(value)});
  const buttons=walk(selected,node=>node.type==='button'&&text(node)==='查看树表照片与处理记录');
  assert.equal(buttons.length,1);buttons[0].props.onClick();assert.equal(opened[0],original);
  const another=render(Component,[original],{index:1,onPhoto:value=>opened.push(value)});
  assert.equal(walk(another,node=>node.type==='button'&&text(node)==='查看树表照片与处理记录').length,0);
 }
});

test('empty history offers no unrelated task or photo action',()=>{
 const original=completed({site:'xsbn'});
 const history=render(TreeWorkHistory,[original]);
 assert.equal(walk(history,node=>node.type==='details'||node.type==='button').length,0);
 assert.match(text(history),/暂无/);
 const summary=render(TreeWorkSummary,[original]);
 assert.equal(walk(summary,node=>node.type==='button').length,0);
 assert.match(text(summary),/独立胶乳样本/);
});

test('pending tree work shows its adopted angle before the first receipt exists',()=>{
 const pending=makeDemoTasks(new Date(requestedAt)).find(item=>item.site==='guangdong-maoming'&&item.block==='A');
 pending.demoStrategy.adoptedAngles=[{treeIndex:0,treeId:'T-0001',angleDeg:26.1,strategyId:'tree-angle',runId:'tree-run',revision:1,adoptedAt:requestedAt}];
 for(const Component of [TreeWorkSummary,TreeWorkHistory]){
  assert.match(text(render(Component,[pending],{site:pending.site,index:0})),/割胶角度 26\.1°/);
  assert.match(text(render(Component,[pending],{site:pending.site,index:1})),/割胶角度 29°/);
 }
});

test('WorkspaceApp wires both tree views to the same scoped tasks and real navigation callbacks',async()=>{
 const {ast}=await compile('WorkspaceApp.tsx');
 const calls=[];
 function visit(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'&&['TreeWorkSummary','TreeWorkHistory'].includes(node.arguments?.[0]?.name))calls.push(node);
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
 }
 visit(ast);
 assert.deepEqual(calls.map(node=>node.arguments[0].name).sort(),['TreeWorkHistory','TreeWorkSummary']);
 for(const call of calls){
  const props=Object.fromEntries(call.arguments[1].properties.map(property=>[property.key.name??property.key.value,property.value]));
  assert.equal(props.index.name,'selectedTree');assert.equal(props.tasks.name,'treeTasks');assert.equal(props.site.name,'site');
  assert.equal(props.onTask.name,'openTask');assert.equal(props.onPhoto.type,'ArrowFunctionExpression');
  assert.equal(props.onPhoto.body.type,'CallExpression');assert.equal(props.onPhoto.body.callee.name,'setIncidentTaskId');
  assert.equal(props.onPhoto.body.arguments[0].property.name,'id');
 }
});


test('Xi’an summary keeps work records but does not borrow a production curve from another park',()=>{
 const original=completed({site:'xian'});
 const value=html(TreeWorkSummary,[original],{site:'xian'});
 assert.match(value,/XA-A-0001/);
 assert.match(value,/西安为设备联调站点，暂无本树产胶序列/);
 assert.match(value,/已完成割胶/);
 assert.doesNotMatch(value,/<svg[^>]*role="img"|独立胶乳样本|末次|kg|NaN|Infinity/);
 assert.deepEqual(getTreeYieldSeries(0,'xian'),[]);
});

test('production park summaries use the same tree series as the detailed history',()=>{
 for(const site of ['hainan','xsbn']){
  const value=html(TreeWorkSummary,[],{site,index:41});
  for(const point of getTreeYieldSeries(41,site))assert.ok(value.includes(point.actual.toFixed(3)));
  assert.match(value,/独立模拟胶乳样本/);
 }
});
