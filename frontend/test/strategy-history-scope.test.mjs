import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';
import {demoTaskAngleRange} from '../../shared/demoTaskChain.ts';
import {parks} from '../../shared/parkCatalog.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {treeAlias} from '../src/workspace/model.ts';
import {treeWorkRecords} from '../src/workspace/treeWorkModel.ts';
import {TaskSync} from '../src/workspace/taskSync.ts';

const sourceRoot=new URL('../src/',import.meta.url);
async function declarations(file,names){
 const {code}=await transformWithOxc(readFileSync(new URL(file,sourceRoot),'utf8'),file,{lang:file.endsWith('.tsx')?'tsx':'ts',jsx:{runtime:'classic'}});
 return parseAst(code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
  .filter(node=>node&&(node.type==='FunctionDeclaration'?names.includes(node.id?.name):node.type==='VariableDeclaration'&&node.declarations.some(item=>names.includes(item.id?.name))))
  .map(node=>code.slice(node.start,node.end)).join('\n');
}
const mapping=JSON.parse(readFileSync(new URL('integration/tree-map.json',sourceRoot),'utf8'));
const helpers=await declarations('integration/client.ts',['alias','siteIdOf','valid','kinds','statuses']);
const viewHelpers=await declarations('integration/Views.tsx',['Card','State','when','StrategyBody','surfaceActionLabels']);
const executionCode=await declarations('integration/ExecutionLinks.tsx',['ExecutionLinks']);
const historyCode=await declarations('integration/ActionHistory.tsx',['ActionHistory']);
const workspaceCode=await declarations('integration/StrategyWorkspace.tsx',['History']);
function runtime(reads={}){
 const paths=[];
 const useRead=path=>{paths.push(path);return {data:reads[path],reload(){}};};
 const components=new Function('resolveTreeIdentity','parks','React','useState','useRef','useEffect','useRead','mapping','treeAlias','treeWorkRecords','Result','RunActions','StrategyRecommendation','demoTaskAngleRange',
  helpers+'\n'+viewHelpers+'\n'+executionCode+'\n'+historyCode+'\n'+workspaceCode+'\nreturn {ExecutionLinks,ActionHistory,StrategyBody,History,alias};')(
  resolveTreeIdentity,parks,React,React.useState,React.useRef,React.useEffect,useRead,mapping,treeAlias,treeWorkRecords,()=>null,()=>null,()=>null,demoTaskAngleRange);
 return {...components,paths};
}
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const adoption={siteId:'demo-hainan',treeId:'T-0001',strategyId:'strategy-history',runId:'run-history',revision:2,angle:28,expiresAt:'2026-10-19T04:00:00Z',adoptedAt:'2026-10-19T02:00:00Z',mode:'simulation',dataMode:'demo'};
const job={id:'rail-history',attemptId:'attempt-new',requestedAt:'2026-10-19T02:01:00Z',planVersion:'harness-2',angle:28,harnessSource:adoption};
const completed={id:job.id,revision:2,date:'2026-10-19',site:'hainan',title:'策略记录关联任务',block:'A',robot:'R-A',start:'10:01',end:'10:02',kind:'割胶',count:1,done:1,status:'已完成',treeIndices:[0],railJob:job,railResult:{index:0,job:structuredClone(job),outcome:'completed',finishedAt:'2026-10-19T02:02:00Z'}};

for(const [name,mutate] of [
 ['旧尝试',task=>{task.railResult.job.attemptId='attempt-old';}],
 ['错树号',task=>{task.railResult.index=1;}],
 ['错策略',task=>{task.railResult.job.harnessSource.strategyId='other-strategy';}],
 ['未知结果',task=>{task.railResult.outcome='unknown';}],
])test(`strategy execution history agrees with single-tree history for ${name} receipts`,()=>{
 const task=structuredClone(completed);mutate(task);
 const html=render(runtime().ExecutionLinks,{tasks:[task],site:'hainan'});
 assert.match(html,/<td>作业记录待核对<\/td>/);
 assert.equal(treeWorkRecords([task],0,'hainan')[0].status,'作业记录待核对');
 assert.doesNotMatch(html,/<td>(模拟完成|已完成割胶|已取消作业)<\/td>/);
});

test('strategy history shows valid per-tree completion and cancellation with their original strategy',()=>{
 for(const outcome of ['completed','cancelled']){
  const task=structuredClone(completed);task.railResult.outcome=outcome;
  if(outcome==='cancelled'){task.done=0;task.status='已取消';}
  const html=render(runtime().ExecutionLinks,{tasks:[task],site:'hainan'});
  assert.match(html,outcome==='completed'?/<td>已完成割胶<\/td>/:/<td>已取消作业<\/td>/);
  assert.match(html,/strategy-history/);assert.match(html,/28°/);
 }
});

test('an unverified original source stays in history without claiming an adopted angle or strategy version',()=>{
 for(const sourceChange of [{siteId:'demo-xsbn'},{revision:0},{treeId:'T-0002'}]){
  const task=structuredClone(completed);Object.assign(task.railJob.harnessSource,sourceChange);
  const record=treeWorkRecords([task],0,'hainan')[0];assert.equal(record.plan,undefined);
  const html=render(runtime().ExecutionLinks,{tasks:[task],site:'hainan'});
  assert.match(html,/HN-A-0001/);assert.match(html,/策略记录关联任务/);assert.match(html,/<td>作业记录待核对<\/td>/);
  assert.equal((html.match(/<td>待核对<\/td>/g)||[]).length,2,'angle and strategy version both remain unverified');
  assert.doesNotMatch(html,/strategy-history|<summary>v\d|28°|尚无采用后端建议/);
 }
});

test('batch execution history does not turn a whole-task completion label into a missing tree receipt',()=>{
 const task={...structuredClone(completed),id:'batch-history',count:2,done:2,treeIndices:[0,1],railJob:undefined,railResult:undefined,railBatch:{baseDone:0,jobs:{0:structuredClone(job),1:{...structuredClone(job),id:'second',harnessSource:{...adoption,treeId:'T-0002'}}},results:{0:structuredClone(completed.railResult)}}};
 const html=render(runtime().ExecutionLinks,{tasks:[task],site:'hainan'});
 assert.match(html,/<td>已完成割胶<\/td>/);assert.match(html,/<td>等待本树回执<\/td>/);
});

test('execution history takes the synchronized task version without a second local or archive merge',()=>{
 const old={...completed,revision:1,done:0,status:'待开始',railResult:undefined};
 const current=new TaskSync().receive([old],[completed]);
 assert.equal(current[0].revision,2);
 const app=runtime();const html=render(app.ExecutionLinks,{tasks:current,site:'hainan'});
 assert.match(html,/<td>已完成割胶<\/td>/);assert.doesNotMatch(html,/等待本树回执/);
 assert.deepEqual(app.paths,[]);
});

test('execution history only renders current park even for the same task id',()=>{
 const other={...structuredClone(completed),site:'xsbn',title:'另一个园区任务'};
 const html=render(runtime().ExecutionLinks,{tasks:[completed,other],site:'hainan'});
 assert.match(html,/HN-A-0001/);assert.doesNotMatch(html,/另一个园区任务|XS-A-0001/);
});

test('ordinary demo tasks retain their strategy and returned results in execution history',()=>{
 const task={id:'demo-chain',site:'xsbn',title:'B区模拟执行',block:'B',date:'2026-10-19',status:'执行中',done:1,count:3,treeIndices:[50,51,52],demoStrategy:{title:'B区模拟割胶方案',treeIndices:[50,51,52],revision:1,adoptedAt:'2026-10-19T02:00:00Z',parameters:{angleDeg:29}},demoReceipts:[{outcome:'completed'},{outcome:'skipped'}]};
 const other={...task,site:'hainan',demoStrategy:{...task.demoStrategy,title:'另一个园区方案'}};
 const html=render(runtime().ExecutionLinks,{tasks:[task,other],site:'xsbn'});
 assert.match(html,/B区模拟割胶方案/);assert.match(html,/29°/);assert.match(html,/已采用/);assert.match(html,/1 完成 · 1 跳过/);
 assert.doesNotMatch(html,/另一个园区方案|尚无关联策略/);
});

for(const [site,prefix] of [['hainan','HN'],['xsbn','XS'],['xian','XA']])test(`${site} action history requests its park and uses the shared park tree alias`,()=>{
 const path=`/api/simulation/actions?siteId=demo-${site}`;
 const app=runtime({[path]:{items:[{requestId:'action',treeId:'T-0051',kind:'adopt_angle',angle:28,adoptedAt:adoption.adoptedAt,strategyId:'strategy-history'}]}});
 assert.match(render(app.ActionHistory,{site}),new RegExp(`${prefix}-B-0001`));
 assert.deepEqual(app.paths,[path]);
});

for(const site of ['xsbn','xian'])test(`${site} analysis history uses scoped server pagination`,()=>{
 const path=`/internal/harness/runs?siteId=demo-${site}&limit=20`;
 const app=runtime({[path]:{items:[],nextCursor:null}});
 render(app.History,{site});assert.deepEqual(app.paths,[path,null]);
});

for(const site of ['xsbn','xian'])test(`${site} strategy bodies show local aliases for growth, surface and health evidence`,()=>{
 const app=runtime(),prefix=site==='xsbn'?'XS':'XA';
 const base={siteId:`demo-${site}`,strategyId:'strategy',runId:'run',revision:1,summary:'园区策略',generatedAt:'2026-10-19T02:00:00Z',expiresAt:'2099-01-01T00:00:00Z',reasons:[]};
 const cases=[
  {...base,kind:'growth_plan',proposal:{predictions:[{treeId:'T-0051',at:'2026-11-01',value:55}],futurePanelPlan:[]}},
  {...base,kind:'surface_action',proposal:{findings:[{treeId:'T-0051',detectionId:'surface',action:'review',reason:'复核样本'}]}},
  {...base,kind:'pest_risk',proposal:{horizon:{start:'2026-10-19',end:'2026-11-19'},riskAssessments:[{treeId:'T-0051',riskIndex:1,riskLevel:'watch',trend:'stable',preventiveActions:[],limitation:'模拟'}],findings:[{treeId:'T-0051',reason:'巡查样本'}]}},
 ];
 for(const strategy of cases){
  const html=render(app.StrategyBody,{s:strategy});
  assert.match(html,new RegExp(`${prefix}-B-0001`));assert.doesNotMatch(html,/HN-B-0001/);
 }
 assert.equal(app.alias('T-0051'),'HN-B-0001');
 assert.equal(app.alias('unmapped',`demo-${site}`),'unmapped');
});

