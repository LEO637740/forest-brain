import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc, parseAst} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {assessIndustry, latestIndustryRunId, industryRecordState, industrySourceUrl, industryTime} from '../src/integration/industryBriefData.ts';
import {publicSourceState} from '../src/integration/publicMarketData.ts';
import {prepareIndustry} from '../scripts/prepare-industry.mjs';

const now = Date.now();
const record = {observationId:'source-annual',topic:'production',title:'全国天然橡胶年度产量',scope:'全国 · 年度统计',period:'2025 年度',retrievedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),sourceUrl:'https://example.org/statistics',content:'{}',quality:'valid',provenance:{sourceId:'source-annual',sourceClass:'web_service',mode:'measured'}};
const context = {snapshotId:'industry-input',version:1,asOf:new Date(now-1000).toISOString(),modules:{industry:{records:[record],gaps:['园区位置未确定']}}};
const strategy = {kind:'industry_brief',strategyId:'industry-strategy',runId:'industry-run',revision:1,summary:'行业规则演示总结',reasons:[],inputSnapshot:{snapshotId:context.snapshotId,version:1},generatedAt:context.asOf,expiresAt:record.expiresAt,modelVersion:null,qualityReview:{status:'pending',notes:[]},proposal:{horizon:{start:context.asOf,end:record.expiresAt},findings:[{topic:'production',assessment:'产量为年度统计，不能代入当日产量。',limitation:'缺少实际园区产胶记录',sourceRefs:[record.observationId]}],recommendations:[{priority:'high',action:'确认车辆交接与可用库存',reason:'企业运输和库存仍是模拟记录',sourceRefs:[record.observationId]}],missingData:['缺少真实业务库存'],uncertainty:'未验证增产效果，需专家复核。',reviewRequired:true}};
const ready = {runId:'industry-run',requestId:'industry-request',status:'succeeded',updatedAt:context.asOf,strategy};

test('the latest industry run remains selected when it failed instead of falling back to an old success', () => {
  const list = {items:[{runId:'latest-failed',kind:'industry_brief',status:'failed'},{runId:'older-success',kind:'industry_brief',status:'succeeded'}]};
  assert.equal(latestIndustryRunId(list),'latest-failed');
  assert.equal(latestIndustryRunId({items:[{runId:'tree-run',kind:'tapping_angle',status:'succeeded'}]}),undefined);
});

test('only a current nonwithdrawn industry strategy with matching frozen input is available', () => {
  assert.equal(assessIndustry(ready,context,undefined,now).available,true);
  assert.equal(assessIndustry(ready,context,undefined,Date.parse(strategy.expiresAt)).status,'expired');
  assert.equal(assessIndustry({...ready,strategy:{...strategy,qualityReview:{status:'withdrawn'}}},context,undefined,now).status,'withdrawn');
  assert.equal(assessIndustry(ready,{...context,snapshotId:'other'},undefined,now).available,false);
  assert.equal(assessIndustry(ready,{...context,version:2},undefined,now).available,false);
  assert.equal(assessIndustry(ready,context,'服务离线',now).available,false);
  assert.equal(assessIndustry(ready,undefined,undefined,now).available,false);
  assert.equal(assessIndustry({...ready,strategy:{...strategy,expiresAt:'bad-time'}},context,undefined,now).available,false);
});

test('source statistics keep their original period and explicit simulation/expiry labels', () => {
  assert.equal(record.period,'2025 年度');
  assert.equal(industryRecordState(record,now),'公开统计');
  assert.match(industryRecordState({...record,expiresAt:new Date(now).toISOString()},now),/已过期/);
  assert.match(industryRecordState({...record,provenance:{...record.provenance,mode:'simulated'}},now),/模拟演示/);
  assert.equal(industrySourceUrl({...record,sourceUrl:'javascript:alert(1)'}),undefined);
  assert.equal(industrySourceUrl({...record,sourceUrl:'demo://warehouse'}),undefined);
  assert.equal(industryTime('bad-time'),'时间待核验');
});

async function componentDeclarations(file) {
  const {code} = await transformWithOxc(readFileSync(new URL('../src/integration/'+file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
  return parseAst(code).body.map(node => node.type==='ExportNamedDeclaration'?node.declaration:node).filter(node => node?.type==='FunctionDeclaration').map(node => code.slice(node.start,node.end)).join('\n');
}
const proposalCode = await componentDeclarations('IndustryProposal.tsx');
const IndustryProposal = new Function('React','industryTime',proposalCode+';return IndustryProposal;')(React,industryTime);
const pageCode = await componentDeclarations('IndustryBrief.tsx');
const Card = ({title,children}) => React.createElement('section',null,React.createElement('h2',null,title),children);
const State = ({error}) => React.createElement('p',null,error || '正在读取…');
function renderPage({run=ready,input=context,paused=false,list,readError,dataMode='mixed_demo',configured=false,configuredError,ruleRun}={}) {
  const calls=[];
  const fixtures = {
    [`/internal/harness/runs?kind=industry_brief&dataMode=${dataMode}&generatorMode=configured&limit=20`]:configured ? list || {items:[{runId:'industry-run',kind:'industry_brief',status:run.status}]} : {items:[]},
    [`/internal/harness/runs?kind=industry_brief&dataMode=${dataMode}&generatorMode=demo_rules&limit=20`]:list || {items:[{runId:ruleRun?'industry-rule':'industry-run',kind:'industry_brief',status:(ruleRun??run).status}]},
    '/internal/harness/runs/industry-run':run,
    '/internal/harness/runs/industry-run/context':input,
    '/internal/harness/runs/industry-rule':ruleRun,
    '/internal/harness/runs/industry-rule/context':input,
    '/api/sources':{sources:[]},
    '/api/model/control':{paused},
  };
  const useRead = path => {if(path)calls.push(path);const error=path?.includes('generatorMode=configured')?configuredError:path?.includes('/context')?readError:undefined;return {data:error?undefined:fixtures[path],error,reload(){}};};
  const Component = new Function('React','useRead','DATA_MODE','Card','State','IndustryProposal','assessIndustry','latestIndustryRunId','industryRecordState','industrySourceUrl','industryTime','publicSourceState',pageCode+';return IndustryBrief;')(React,useRead,dataMode,Card,State,IndustryProposal,assessIndustry,latestIndustryRunId,industryRecordState,industrySourceUrl,industryTime,publicSourceState);
  return {html:renderToStaticMarkup(React.createElement(Component)),calls};
}

test('the real industry page renders judgements, management advice, gaps and frozen statistical periods while model is paused', () => {
  const {html,calls}=renderPage({paused:true});
  assert.match(html,/行业判断/);
  assert.match(html,/确认车辆交接与可用库存/);
  assert.match(html,/缺少真实业务库存/);
  assert.match(html,/2025 年度/);
  assert.match(html,/模型调用已暂停/);
  assert.match(html,/演示规则（未调用大模型）/);
  assert.ok(calls.includes('/internal/harness/runs?kind=industry_brief&dataMode=mixed_demo&generatorMode=configured&limit=20'));
  assert.ok(calls.includes('/internal/harness/runs?kind=industry_brief&dataMode=mixed_demo&generatorMode=demo_rules&limit=20'));
  assert.ok(calls.every(path=>!path.includes('refresh')&&!path.includes('prepare')));
  const demo=renderPage({dataMode:'demo'});
  assert.ok(demo.calls.includes('/internal/harness/runs?kind=industry_brief&dataMode=demo&generatorMode=configured&limit=20'));
});

test('management actions lead the result while judgement and source metadata are collapsed', () => {
  const {html}=renderPage();
  assert.ok(html.indexOf('确认车辆交接与可用库存') < html.indexOf('行业判断'));
  assert.match(html,/<details class="hb-result-details"><summary>行业判断/);
  assert.match(html,/<details class="hb-result-details hb-industry-input-details"><summary>研判时间与引用依据/);
  assert.doesNotMatch(html,/<table|当前公开来源状态/);
  assert.match(html,/<details><summary>原因与依据<\/summary><p>企业运输和库存仍是模拟记录/);
  assert.doesNotMatch(html,/<details[^>]*open/);
});

test('a long model summary remains available in collapsed details after the management actions', () => {
  const summary='forecastCoverageStart、soilMoistureM3M3 等完整研判信息。'.repeat(20);
  const {html}=renderPage({run:{...ready,strategy:{...strategy,summary}}});
  assert.ok(html.indexOf('确认车辆交接与可用库存') < html.indexOf(summary));
  assert.ok(html.includes(`<details class="hb-result-details"><summary>研判摘要</summary><p>${summary}</p></details>`));
  assert.doesNotMatch(html,/<h3>forecastCoverageStart/);
});

test('stock field names in a management action read as business terms while the original remains traceable', () => {
  const action='接入 ERP/WMS/TMS，逐批登记 onHandKg、reservedKg、heldKg、availableKg。';
  const proposal={...strategy.proposal,recommendations:[{...strategy.proposal.recommendations[0],action}]};
  const {html}=renderPage({run:{...ready,strategy:{...strategy,proposal}}});
  assert.match(html,/<h4>接入 经营、仓储和运输系统，逐批登记 在库量、已预留量、质检冻结量、可用量。<\/h4>/);
  assert.doesNotMatch(html,/<h4>[^<]*(?:onHandKg|reservedKg|heldKg|availableKg|ERP\/WMS\/TMS)/);
  assert.ok(html.includes(`<details><summary>原因与依据</summary><p>企业运输和库存仍是模拟记录</p><p class="hb-industry-references">原始建议：${action}</p>`));
});

test('expired, withdrawn, failed, queued, missing and unreadable input never render current advice', () => {
  const cases = [
    {run:{...ready,strategy:{...strategy,expiresAt:new Date(now-1000).toISOString()}},label:/已过期/},
    {run:{...ready,strategy:{...strategy,qualityReview:{status:'withdrawn',notes:['依据错误']}}},label:/已撤回/},
    {run:{status:'failed',error:{message:'模型调用已暂停'}},label:/研判失败/},
    {run:{status:'queued'},label:/等待分析/},
    {run:{status:'running'},label:/正在分析/},
    {run:{status:'needs_data',missingData:[{reason:'缺少统计资料'}]},label:/需要补充数据/},
    {input:{...context,snapshotId:'wrong'},label:/输入版本不一致/},
    {readError:'连接中断',label:/读取失败/},
  ];
  for(const item of cases){const {html}=renderPage(item);assert.match(html,item.label);assert.doesNotMatch(html,/确认车辆交接与可用库存|行业规则演示总结/);}
  assert.match(renderPage({list:{items:[]}}).html,/尚无行业研判记录/);
});

test('a failed configured attempt can be replaced by the prepared rule record while active or successful runs remain authoritative', () => {
  const failed=renderPage({configured:true,run:{status:'failed',error:{message:'实际模型失败'}}});
  assert.match(failed.calls.join('|'),/generatorMode=demo_rules/);
  const expired=renderPage({configured:true,run:{...ready,strategy:{...strategy,expiresAt:new Date(now-1000).toISOString()}}});
  assert.match(expired.calls.join('|'),/generatorMode=demo_rules/);
  const withdrawn=renderPage({configured:true,run:{...ready,strategy:{...strategy,expiresAt:new Date(now-1000).toISOString(),qualityReview:{status:'withdrawn',notes:['人工撤回']}}}});
  assert.doesNotMatch(withdrawn.calls.join('|'),/generatorMode=demo_rules/);
  assert.match(withdrawn.html,/已撤回/);
  const unreadable=renderPage({configuredError:'来源记录服务暂不可用'});
  assert.doesNotMatch(unreadable.calls.join('|'),/generatorMode=demo_rules/);
  assert.match(unreadable.html,/来源记录服务暂不可用/);
});

test('a fresh hourly rule package replaces an expired model display while retaining explicit rule provenance',()=>{
 const old={...ready,strategy:{...strategy,expiresAt:new Date(now-1000).toISOString(),summary:'过期的旧模型建议'}};
 const ruleRun={...ready,strategy:{...strategy,summary:'本轮后台规则更新结果'}};
 const {html}=renderPage({configured:true,run:old,ruleRun});
 assert.match(html,/本轮后台规则更新结果/);assert.match(html,/规则演示 · 待人工复核/);
 assert.doesNotMatch(html,/过期的旧模型建议|模型研判 · 待人工复核/);
});

test('explicit rule preparation preserves usable configured attempts and replaces terminal failures', async () => {
  for(const status of ['succeeded','failed','needs_data','queued','running']){
    const calls=[];
    const job=await prepareIndustry(async(path,body)=>{
      calls.push({path,body});
      if(path.includes('generatorMode=configured'))return {items:[{runId:'configured-run',kind:'industry_brief',status,generatorMode:'configured',result:{strategy:{expiresAt:new Date(Date.now()+3600000).toISOString()}}}]};
      if(path.includes('generatorMode=demo_rules'))return {items:[]};
      if(path==='/api/sources/industry-context')return {siteId:'public-rubber-industry',targetSnapshotId:'industry-target',inputSnapshot:{snapshotId:'cached-input',version:1}};
      return {runId:'rule-industry',status:'queued'};
    },{dataMode:'mixed_demo',stamp:'test'});
    if(['succeeded','queued','running'].includes(status)){
      assert.equal(job.runId,'configured-run');assert.equal(job.preservedConfigured,true);assert.equal(calls.length,1);
    }else{
      assert.equal(job.runId,'rule-industry');assert.equal(job.preservedConfigured,undefined);assert.equal(calls.length,4);assert.equal(calls[3].body.generatorMode,'demo_rules');
    }
    assert.match(calls[0].path,/dataMode=mixed_demo&generatorMode=configured/);
  }
});

test('initial preparation freezes the selected data mode and submits only a rule industry candidate', async () => {
  for(const dataMode of ['demo','mixed_demo']){
    const calls=[];
    const job=await prepareIndustry(async(path,body)=>{
      calls.push({path,body});
      if(!body)return {items:[]};
      if(path==='/api/sources/industry-context')return {siteId:'public-rubber-industry',targetSnapshotId:'industry-target',inputSnapshot:{snapshotId:'cached-input',version:1}};
      return {runId:'rule-industry',status:'queued'};
    },{dataMode,stamp:'test'});
    assert.equal(job.runId,'rule-industry');
    assert.deepEqual(calls[2].body,{dataMode});
    assert.equal(calls[3].body.kind,'industry_brief');assert.equal(calls[3].body.generatorMode,'demo_rules');
    assert.equal(calls[3].body.inputSnapshot.snapshotId,'cached-input');
    assert.ok(calls.every(item=>!item.path.includes('refresh')&&!item.path.includes('control')));
  }
});

test('the actual strategy-record renderer includes the shared industry body and traceable references', async () => {
  const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/Views.tsx',import.meta.url),'utf8'),'Views.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
  const node=parseAst(code).body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration'&&node.declaration.id.name==='StrategyBody').declaration;
  const StrategyBody=new Function('React','useState','useRef','useEffect','useRead','valid','when','IndustryProposal','StrategyRecommendation',code.slice(node.start,node.end)+';return StrategyBody;')(React,React.useState,React.useRef,React.useEffect,()=>({}),s=>s.qualityReview?.status!=='withdrawn'&&Date.parse(s.expiresAt)>Date.now(),industryTime,IndustryProposal,()=>null);
  const html=renderToStaticMarkup(React.createElement(StrategyBody,{s:strategy}));
  assert.match(html,/行业判断/);assert.match(html,/管理建议/);assert.match(html,/缺少真实业务库存/);assert.match(html,/未验证增产效果/);
  assert.match(html,/引用编号：source-annual/);assert.match(html,/industry-input/);
  const frozen=renderToStaticMarkup(React.createElement(IndustryProposal,{s:strategy,records:[record]}));
  assert.match(frozen,/来源记录：全国天然橡胶年度产量/);
});
