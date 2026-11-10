import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc,parseAst} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {recordTime,recordSource,tappingState,matchesStrategyInput,frozenMeasurements,profileDifference} from '../src/integration/treeEvidence.ts';
import {getTreeYieldSeries} from '../src/workspace/analyticsData.ts';
import {treeAlias} from '../src/workspace/model.ts';
import {treeWorkRecords} from '../src/workspace/treeWorkModel.ts';
import {operationDateLabel} from '../src/workspace/operationsModel.ts';
import {demoTaskAngle} from '../../shared/demoTaskChain.ts';

const sourceRoot=new URL('../src/',import.meta.url);
async function declarations(file,names){
 const {code}=await transformWithOxc(readFileSync(new URL(file,sourceRoot),'utf8'),file,{lang:file.endsWith('.tsx')?'tsx':'ts',jsx:{runtime:'classic'}});
 const nodes=parseAst(code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node).filter(Boolean).filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id?.name));
 for(const name of names)assert.ok(nodes.some(node=>node.id.name===name),name);
 return nodes.map(node=>code.slice(node.start,node.end)).join('\n');
}
const code=[
 await declarations('integration/Views.tsx',['State','Chart','StrategyBody','TreeProfile','TreeInputEvidence','TreeDecision']),
 await declarations('workspace/TreeWorkSummary.tsx',['TreeWorkSummary','TreeWorkDetails'])
].join('\n');
const provenance={sourceId:'current-measurement',sourceClass:'sensor_device',mode:'simulated'};
const current={treeId:'T-0042',variety:'品种样本',plantedAt:'2012-06-15',heightM:10.8,circumferenceCm:66,measuredAt:'2026-10-07T02:00:00Z',tappingStatus:'available',provenance};
const frozen={...current,circumferenceCm:60,measuredAt:'2026-10-06T02:00:00Z',provenance:{...provenance,sourceId:'frozen-measurement'}};
const measurement=(treeId,observedAt,value)=>({observationId:treeId+observedAt,treeId,observedAt,circumferenceCm:value,measurementHeightM:1.3,provenance,quality:'valid'});
const context={snapshotId:'input-growth',version:3,asOf:'2026-10-06T03:00:00Z',modules:{trees:[frozen],growth:{measurements:[measurement('T-0042','2026-10-06T02:00:00Z',60),measurement('T-0001','2026-10-01T02:00:00Z',888),measurement('T-0042','2026-10-01T02:00:00Z',59)]}}};
const strategy={kind:'growth_plan',summary:'本轮生长建议',strategyId:'strategy-growth',runId:'run-growth',revision:2,inputSnapshot:{snapshotId:context.snapshotId,version:3},generatedAt:'2026-10-06T03:01:00Z',expiresAt:'2026-10-08T03:00:00Z',reasons:[],proposal:{predictions:[],futurePanelPlan:[]}};
const view={tree:frozen,strategy,strategyStatus:'available',asOf:context.asOf,run:{runId:'run-growth',status:'succeeded'}};
const park={asOf:'2026-10-07T03:00:00Z',trees:[current],modules:{growth:{measurements:[measurement('T-0042',current.measuredAt,66),measurement('T-0042','2026-10-07T02:30:00Z',999)]}}};
function runtime(reads){
 const calls=[];
 const useRead=path=>{if(path)calls.push(path);const item=reads[path];return item?.error?{error:item.error,reload(){}}:{data:item,reload(){}};};
 const exports=new Function('React','useState','useRef','useEffect','useRead','binding','DATA_MODE','valid','when','adopt','reviewSurface','adoptWeather','alias','kinds','statuses','TreeModelGeneration','recordTime','recordSource','tappingState','matchesStrategyInput','frozenMeasurements','profileDifference','treeWorkRecords','operationDateLabel','incidentResult','getTreeYieldSeries','treeAlias','StrategyRecommendation','demoTaskAngle','StrategyRefreshStatus',code+'\nreturn {TreeProfile,TreeInputEvidence,TreeDecision,TreeWorkSummary};')(
 React,React.useState,React.useRef,React.useEffect,useRead,index=>({treeId:`T-${String(index+1).padStart(4,'0')}`}),'mixed_demo',()=>true,recordTime,()=>{},()=>{},()=>{},id=>id,{growth_plan:'生长与割线'},{available:'建议可查看'},()=>null,recordTime,recordSource,tappingState,matchesStrategyInput,frozenMeasurements,profileDifference,treeWorkRecords,operationDateLabel,()=> '',getTreeYieldSeries,treeAlias,()=>null,demoTaskAngle,()=>null);
 return {...exports,calls};
}
test('single tree profile uses the current archive and shows its measurement time and source',()=>{
 const r=runtime({'/api/demo/park':park});
 const html=renderToStaticMarkup(React.createElement(r.TreeProfile,{index:41}));
 assert.match(html,/66/);
 assert.ok(html.includes(recordTime(current.measuredAt)));
 assert.ok(html.includes(recordTime(park.asOf)));
 assert.match(html,/current-measurement|模拟记录 · 设备通道|离地 1.3 m/);
 assert.doesNotMatch(html,/2026\.09\.20|frozen-measurement/);
 assert.deepEqual(r.calls,['/api/demo/park']);
});
test('imported profile labels measured dimensions independently from simulated planting and status',()=>{
 const imported={...current,circumferenceCm:68,fieldRecord:{recordId:'field-profile-test',sourceTreeId:'现场测试42',sourceName:'隔离测试测量表',observedAt:current.measuredAt,importedAt:park.asOf,measurementHeightM:null,longitude:110.25,latitude:19.75,elevationM:42,elevationDatum:'测试基准',provenance:{mode:'measured',sourceClass:'farmer_expert',sourceId:'field-profile-test'}}};
 const r=runtime({'/api/demo/park':{...park,trees:[imported]}});
 const html=renderToStaticMarkup(React.createElement(r.TreeProfile,{index:41}));
 assert.match(html,/品种与尺寸来源<\/dt><dd>实测记录 · 胶农与专家通道/);
 assert.match(html,/种植与状态来源<\/dt><dd>模拟记录 · 设备通道/);
 assert.match(html,/测量高度<\/dt><dd>未提供<\/dd>/);
 assert.match(html,/现场测试42|110.25, 19.75（WGS84）|42 m · 测试基准/);
 assert.ok(html.includes('field-profile-test'));
});
test('unreadable current archive does not silently display a saved strategy profile',()=>{
 const r=runtime({'/api/demo/park':{error:'档案服务离线'}});
 const html=renderToStaticMarkup(React.createElement(r.TreeProfile,{index:41}));
 assert.match(html,/档案服务离线.*重试/);
 assert.doesNotMatch(html,/66|60|当前档案 ·/);
});
test('strategy input shows frozen version, cutoff and measurement alongside newer current record',()=>{
 const r=runtime({});
 const html=renderToStaticMarkup(React.createElement(r.TreeInputEvidence,{treeId:'T-0042',view,context,currentTree:current,reload(){}}));
 assert.match(html,/v3|input-growth|frozen-measurement/);
 assert.ok(html.includes(recordTime(context.asOf)));
 assert.ok(html.includes(recordTime(frozen.measuredAt)));
 assert.ok(html.includes(recordTime(current.measuredAt)));
 assert.match(html,/当前档案记录时间晚于本轮输入/);
 assert.match(html,/仍依据生成时保存的资料/);
});
test('growth chart reads the strategy frozen history rather than current park measurements',()=>{
 const r=runtime({'/api/demo/trees/T-0042/view?kind=growth_plan&dataMode=mixed_demo':view,'/api/demo/park':park,'/internal/harness/runs/run-growth/context':context});
 const html=renderToStaticMarkup(React.createElement(r.TreeDecision,{index:41,initial:'growth_plan'}));
 assert.match(html,/本轮输入树围 cm趋势/);
 assert.match(html,/2026-10-01：59 本轮输入树围 cm/);
 assert.match(html,/2026-10-06：60 本轮输入树围 cm/);
 assert.doesNotMatch(html,/999|888|：66 本轮输入树围 cm/);
 assert.ok(r.calls.includes('/internal/harness/runs/run-growth/context'));
});
test('a mismatched or unreadable strategy input never substitutes another historical curve',()=>{
 for(const input of [{...context,snapshotId:'different'},{...context,version:4},{error:'输入读取失败'}]){
  const r=runtime({'/api/demo/trees/T-0042/view?kind=growth_plan&dataMode=mixed_demo':view,'/api/demo/park':park,'/internal/harness/runs/run-growth/context':input});
  const html=renderToStaticMarkup(React.createElement(r.TreeDecision,{index:41,initial:'growth_plan'}));
  assert.match(html,/暂不展示其他时间的档案曲线/);
  assert.doesNotMatch(html,/本轮输入树围 cm趋势|current-measurement|frozen-measurement/);
 }
});
test('single-tree yield paths expose independent deterministic simulation samples',()=>{
 const r=runtime({});
 const htmlByIndex=[];
 for(const index of [0,41]){
  const html=renderToStaticMarkup(React.createElement(r.TreeWorkSummary,{index,tasks:[],onTask(){},onPhoto(){}}));
  htmlByIndex.push(html);
  assert.match(html,/独立模拟胶乳样本|按树号生成的可复现独立模拟序列|尚未接入本树真实采胶记录/);
  assert.doesNotMatch(html,/最近三次胶乳记录|<strong>近期胶乳/);
 }
 assert.notEqual(htmlByIndex[0],htmlByIndex[1]);
 const workspace=readFileSync(new URL('workspace/WorkspaceApp.tsx',sourceRoot),'utf8');
 assert.doesNotMatch(workspace,/'更新时间','2026\.09\.20'|坡角30° · 采集记录完整|09.21 · 常规割胶 · 胶乳0.24 kg/);
 assert.match(workspace,/按树号生成的可复现独立模拟序列；尚未接入本树真实采胶记录/);
});


test('filtered grower archives do not renumber trees or switch strategy identity',()=>{
 const owned={...current,treeId:'T-0051',variety:'B区承包树',fieldRecord:{sourceTreeId:'HN-B-0001',provenance:{mode:'simulated'}}};
 const plot={...park,trees:[owned]};
 const r=runtime({'/api/demo/park':plot});
 const ownHtml=renderToStaticMarkup(React.createElement(r.TreeProfile,{index:50}));
 assert.match(ownHtml,/B区承包树|HN-B-0001/);
 const outsideHtml=renderToStaticMarkup(React.createElement(r.TreeProfile,{index:0}));
 assert.match(outsideHtml,/没有这棵树的档案/);
 assert.doesNotMatch(outsideHtml,/B区承包树|HN-B-0001/);
 renderToStaticMarkup(React.createElement(r.TreeDecision,{index:50,readOnly:true}));
 assert.ok(r.calls.includes('/api/demo/trees/T-0051/view?kind=tapping_angle&dataMode=mixed_demo'));
 assert.ok(!r.calls.some(path=>path.includes('/trees/T-0001/view')));
});

test('read-only tree advice keeps results and hides unavailable analysis and adoption actions',()=>{
 const angle={...strategy,kind:'tapping_angle',proposal:{treeId:'T-0042',cutSlopeDeg:26.1,conditions:[]}};
 const advice={...view,strategy:angle};
 const r=runtime({'/api/demo/park':park,'/api/demo/trees/T-0042/view?kind=tapping_angle&dataMode=mixed_demo':advice});
 const html=renderToStaticMarkup(React.createElement(r.TreeDecision,{index:41,readOnly:true}));
 assert.doesNotMatch(html,/采用此角度|生成或更新建议/);
 const managerHtml=renderToStaticMarkup(React.createElement(r.TreeDecision,{index:41}));
 assert.match(managerHtml,/采用此角度|生成或更新建议/);
});
