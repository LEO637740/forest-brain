import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc,parseAst} from 'vite';
import React from 'react';
import {strategyRefreshPath,refreshCovers} from '../src/integration/strategyRefreshState.ts';
import {renderToStaticMarkup} from 'react-dom/server';
import {generateTreeModel,modelBlockReason} from '../src/integration/modelGenerationFlow.ts';

const model={generator:'llm',modelVersion:'model-test',llm:{provider:'compatible',model:'model-test',configured:true}};
const makeView=(status='succeeded',runId='run-new',extra={})=>({tree:{treeId:'T-0001'},asOf:'2026-10-07T00:00:00Z',strategyStatus:status==='succeeded'?'available':status==='queued'||status==='running'?'pending':status,run:{runId,status,generatorMode:'configured'},strategy:status==='succeeded'?{runId,modelVersion:'model-test',generationMetadata:{provider:'compatible',model:'model-test'}}:null,...extra});
function fixture(views,extra={}){
  let time=0;
  const calls={prepare:[],reads:0,progress:[]};
  return {calls,deps:{
    preparationId:'request-test',
    prepare:async input=>{calls.prepare.push(input);return {items:[{treeId:'T-0001',runId:'run-new',status:'queued'}]};},
    readView:async()=>{calls.reads++;return views.shift()||makeView('running');},
    sleep:async milliseconds=>{time+=milliseconds;},
    now:()=>time,
    onProgress:view=>calls.progress.push(view.run.status),
    ...extra,
  }};
}

test('single model request waits past old completed view and only accepts its own completed run',async()=>{
  const f=fixture([makeView('succeeded','run-old'),makeView('queued'),makeView('running'),makeView()]);
  const result=await generateTreeModel('T-0001','tapping_angle','mixed_demo',new AbortController().signal,f.deps);
  assert.equal(result.run.runId,'run-new');
  assert.deepEqual(f.calls.prepare,[{preparationId:'request-test',treeIds:['T-0001'],kind:'tapping_angle',dataMode:'mixed_demo',generatorMode:'configured'}]);
  assert.equal(f.calls.reads,4);
  assert.deepEqual(f.calls.progress,['queued','running','succeeded']);
});

test('terminal model failure and missing data never retry or submit demo rules',async()=>{
  for(const status of ['failed','needs_data']){
    const final=makeView(status,'run-new',{error:{code:'LLM_NOT_CONFIGURED',message:'模型未配置'},missingData:[{reason:'缺少树围'}]});
    const f=fixture([final]);
    assert.equal(await generateTreeModel('T-0001','pest_risk','demo',new AbortController().signal,f.deps),final);
    assert.equal(f.calls.prepare.length,1);
    assert.equal(f.calls.prepare[0].generatorMode,'configured');
    assert.equal(f.calls.prepare[0].dataMode,'demo');
  }
});

test('rule output cannot be accepted as a successful model result',async()=>{
  const f=fixture([makeView('succeeded','run-new',{strategy:{runId:'run-new',modelVersion:null}})]);
  await assert.rejects(generateTreeModel('T-0001','tapping_angle','mixed_demo',new AbortController().signal,f.deps),/未返回可核验的大模型来源/);
  assert.equal(f.calls.prepare.length,1);
});

test('a replaced binding after matching current run cannot provide the current result',async()=>{
  const f=fixture([makeView('running'),makeView('succeeded','run-replaced')]);
  await assert.rejects(generateTreeModel('T-0001','growth_plan','mixed_demo',new AbortController().signal,f.deps),/另一轮分析更新/);
});

test('missing acceptance ID and timeout fail clearly without resubmitting a model request',async()=>{
  const missing=fixture([],{prepare:async()=>({items:[]})});
  await assert.rejects(generateTreeModel('T-0001','tapping_angle','mixed_demo',new AbortController().signal,missing.deps),/未返回本树的分析编号/);
  assert.equal(missing.calls.reads,0);
  const timeout=fixture([],{timeoutMs:1500});
  await assert.rejects(generateTreeModel('T-0001','tapping_angle','mixed_demo',new AbortController().signal,timeout.deps),/避免立即重复提交/);
  assert.equal(timeout.calls.prepare.length,1);
});

test('leaving a tree ignores the late response and stops polling',async()=>{
  const controller=new AbortController();
  const f=fixture([],{readView:async()=>{controller.abort();return makeView();}});
  await assert.rejects(generateTreeModel('T-0001','surface_action','mixed_demo',controller.signal,f.deps),{name:'AbortError'});
  assert.equal(f.calls.progress.length,0);
  assert.equal(f.calls.prepare.length,1);
});

test('model UI blocks unknown, rules, unconfigured and paused services',()=>{
  assert.match(modelBlockReason(),/核验模型配置/);
  assert.match(modelBlockReason({...model,generator:'demo_rules'},{paused:false}),/演示规则/);
  assert.match(modelBlockReason({...model,llm:{...model.llm,configured:false}},{paused:false}),/尚未配置/);
  assert.match(modelBlockReason(model,{paused:true}),/已暂停/);
  assert.match(modelBlockReason(model,{paused:false},'网络中断'),/状态读取失败.*网络中断/);
  assert.equal(modelBlockReason(model,{paused:false}),'');
  assert.equal(modelBlockReason({...model,generator:'candidate_service',llm:{...model.llm,provider:'candidate_service'}},{paused:false}),'');
  assert.match(modelBlockReason({...model,generator:'candidate_service'},{paused:true}),/已暂停/);
});

test('single-tree button is explicit; paused or already running states remain disabled while unavailable models can use fallback',async()=>{
  const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/TreeModelGeneration.tsx',import.meta.url),'utf8'),'TreeModelGeneration.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
  const node=parseAst(code).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='TreeModelGeneration');
  const declaration=code.slice(node.start,node.end).replace(/^export /,'');
  const render=(meta,control,view,automatic)=>{
    const useRead=path=>({data:path==='/api/meta'?meta:path==='/api/model/control'?control:automatic});
    const Component=new Function('React','useState','useRef','useEffect','useRef','useRead','modelBlockReason','ModelControlPanel','strategyRefreshPath','refreshCovers',declaration+';return TreeModelGeneration;')(React,React.useState,React.useRef,React.useEffect,React.useRef,useRead,modelBlockReason,()=>null,strategyRefreshPath,refreshCovers);
    return renderToStaticMarkup(React.createElement(Component,{treeId:'T-0001',kind:'tapping_angle',view,onResult(){}}));
  };
  const ready=render(model,{paused:false},makeView());
  assert.match(ready,/大模型重新生成/);
  assert.doesNotMatch(ready,/disabled=""/);
  assert.match(ready,/可用大模型：compatible \/ model-test/);
  const firstModel=render(model,{paused:false},makeView('succeeded','run-rules',{run:{runId:'run-rules',status:'succeeded',generatorMode:'demo_rules'}}));
  assert.match(firstModel,/大模型生成/);
  assert.doesNotMatch(firstModel,/大模型重新生成/);
  const unavailable=render({...model,llm:{...model.llm,configured:false}},{paused:false},undefined);
  assert.doesNotMatch(unavailable,/disabled=""/);
  assert.match(unavailable,/大模型策略生成/);
  for(const [meta,control,view] of [[model,{paused:true},undefined],[model,{paused:false},makeView('running')]])assert.match(render(meta,control,view),/disabled=""/);
  assert.match(render(model,{paused:false},makeView('running')),/大模型分析中/);
  assert.match(render(model,{paused:false},makeView('running','run-rules',{run:{runId:'run-rules',status:'running',generatorMode:'demo_rules'}})),/建议生成中/);
  const automatic={enabled:true,treeModelsEnabled:true,intervalMinutes:60,status:'idle',scope:{siteIds:['demo-hainan'],kinds:['tapping_angle']},items:[]};
  const routed=makeView('succeeded','run-rules',{strategyRoute:{status:'needs_big_brain',reason:'树表异常'},run:{generatorMode:'demo_rules'}});
  const automaticHtml=render(model,{paused:false},routed,automatic);
  assert.match(automaticHtml,/判定需要大脑时自动调用，完成后回填结果/);
  assert.match(automaticHtml,/手动立即分析/);assert.doesNotMatch(automaticHtml,/自动任务已覆盖/);
  assert.match(render(model,{paused:false},{...routed,strategy:{fallback:{message:'校验未通过'}}},automatic),/手动重试大脑分析/);
});

test('automatic coverage belongs to Haikou while same-numbered trees in other parks can generate their own rules',async()=>{
  const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/TreeModelGeneration.tsx',import.meta.url),'utf8'),'TreeModelGeneration.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
  const node=parseAst(code).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='TreeModelGeneration');
  const declaration=code.slice(node.start,node.end).replace(/^export /,'');
  const automatic={enabled:true,intervalMinutes:60,status:'running',scope:{siteIds:['demo-hainan'],kinds:['tapping_angle']},items:[]};
  const walk=element=>!React.isValidElement(element)?[]:[element,...React.Children.toArray(element.props.children).flatMap(walk)];
  for(const site of ['hainan','xsbn','guangdong-maoming']){
    const slots=[],posts=[],reads=[];let cursor=0,results=0;
    const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=value;}];};
    const useRef=initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];};
    const siteId=site==='hainan'?undefined:`demo-${site}`,runId=`rules-${site}`;
    const final=makeView('succeeded',runId,{siteId:`demo-${site}`,run:{runId,status:'succeeded',generatorMode:'demo_rules'},strategy:{runId,modelVersion:null}});
    const bindings={React,useState,useRef,useEffect(){},strategyRefreshPath,refreshCovers,generateTreeModel,modelBlockReason,ModelControlPanel:()=>null,DATA_MODE:'demo',
      useRead:path=>({data:path==='/api/meta'?{generator:'demo_rules',llm:null}:path==='/api/model/control'?{paused:true}:automatic}),
      post:async(path,input)=>{posts.push({path,input});return {items:[{treeId:'T-0001',runId,status:'queued'}]};},
      read:async path=>{reads.push(path);return final;},
    };
    const Component=new Function(...Object.keys(bindings),declaration+';return TreeModelGeneration;')(...Object.values(bindings));
    const props={site,treeId:'T-0001',kind:'tapping_angle',view:{strategyStatus:'needs_generation',strategyRoute:{status:'ready',reason:'模拟资料适合直接生成规则建议'}},onResult(){results++;}};
    const render=()=>{cursor=0;return Component(props);};
    const tree=render(),html=renderToStaticMarkup(tree);
    if(site==='hainan')assert.match(html,/本园区本维度已纳入每 60 分钟后台更新/);
    else{
      assert.match(html,/本园区本维度尚未纳入当前后台范围，可手动生成/);
      assert.doesNotMatch(html,/本园区本维度已纳入|后台会按周期生成并回填/);
    }
    const action=walk(tree).find(element=>element.type==='button'&&element.props.children==='小脑直接生成');
    assert.ok(action);assert.equal(action.props.disabled,false);
    await action.props.onClick();
    assert.equal(posts.length,1);assert.equal(posts[0].path,'/api/demo/trees/prepare');
    assert.equal(typeof posts[0].input.preparationId,'string');
    assert.deepEqual({...posts[0].input,preparationId:'generated'},{preparationId:'generated',treeIds:['T-0001'],kind:'tapping_angle',dataMode:'demo',generatorMode:'demo_rules',siteId});
    assert.deepEqual(reads,[`/api/demo/trees/T-0001/view?kind=tapping_angle&dataMode=demo${siteId?`&siteId=${siteId}`:''}`]);
    assert.equal(results,2);
    assert.match(renderToStaticMarkup(render()),/小脑规则策略已生成/);
  }
});

test('strategy renders actual model provenance and explicitly names rules when model was not called',async()=>{
  const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/Views.tsx',import.meta.url),'utf8'),'Views.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
  const nodes=parseAst(code).body.filter(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration'&&node.declaration.id.name==='StrategyBody');
  const declaration=code.slice(nodes[0].start,nodes[0].end).replace(/^export /,'');
  const StrategyBody=new Function('React','useState','useRef','useEffect','useRead','valid','when','StrategyRecommendation',declaration+';return StrategyBody;')(React,React.useState,React.useRef,React.useEffect,()=>({}),()=>true,()=> '10/07 13:37',()=>null);
  const strategy={kind:'tapping_angle',summary:'候选角度',strategyId:'strategy-test',revision:1,generatedAt:'2026-10-07T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z',modelVersion:null,reasons:[],proposal:{previousPlannedCutSlopeDeg:27,recommendedCutSlopeDeg:28,conditions:[]}};
  const render=s=>renderToStaticMarkup(React.createElement(StrategyBody,{s}));
  const rules=render(strategy);
  assert.match(rules,/演示规则（未调用大模型）/);
  assert.doesNotMatch(rules,/生成来源：大模型/);
  const llm=render({...strategy,modelVersion:'qwen-test',generationMetadata:{provider:'dashscope',model:'qwen-test'}});
  assert.match(llm,/生成来源：大模型 · dashscope \/ qwen-test/);
  assert.doesNotMatch(llm,/未调用大模型/);
});
