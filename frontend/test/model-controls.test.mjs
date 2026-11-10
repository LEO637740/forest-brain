import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {strategyRefreshPath,refreshStatusLabel} from '../src/integration/strategyRefreshState.ts';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {changeAutomaticPause,changeModelPause,modelResumeReason} from '../src/integration/modelControls.ts';

const meta={generator:'llm',modelVersion:'qwen2:7b',llm:{configured:true,provider:'ollama',model:'qwen2:7b'}};
const auto={status:'paused',paused:true,config:{enabled:true,intervalMinutes:60,maxRunsPer24Hours:6,maxModelRequestsPer24Hours:12},jobs:[{id:'surface',kind:'surface_action',treeIds:['T-0012']},{id:'industry',kind:'industry_brief',treeIds:[]}],budget:{runs:0,modelRequests:0}};

test('resuming model control sends one explicit model request and never resumes the scheduler',async()=>{
 const calls=[];
 const result=await changeModelPause(false,async(path,input)=>{calls.push({path,input});return {paused:false};});
 assert.equal(result.paused,false);
 assert.deepEqual(calls,[{path:'/api/model/control',input:{paused:false}}]);
});
test('automatic resume is refused while the model is paused or scheduler was not enabled',async()=>{
 const calls=[],send=async(path,input)=>{calls.push({path,input});return auto;};
 await assert.rejects(changeAutomaticPause(false,auto,meta,{paused:true},send),/先明确恢复模型/);
 await assert.rejects(changeAutomaticPause(false,{...auto,config:{...auto.config,enabled:false}},meta,{paused:false},send),/--automatic/);
 await assert.rejects(changeAutomaticPause(false,auto,{...meta,generator:'demo_rules'},{paused:false},send),/规则演示/);
 await assert.rejects(changeAutomaticPause(false,auto,undefined,undefined,send),/核验/);
 assert.equal(calls.length,0);
});
test('automatic resume changes only the scheduler and pause remains available without model metadata',async()=>{
 const calls=[],send=async(path,input)=>{calls.push({path,input});return {...auto,paused:input.paused};};
 assert.equal((await changeAutomaticPause(false,auto,meta,{paused:false},send)).paused,false);
 assert.equal((await changeAutomaticPause(true,undefined,undefined,undefined,send)).paused,true);
 assert.deepEqual(calls,[{path:'/api/automatic/control',input:{paused:false}},{path:'/api/automatic/control',input:{paused:true}}]);
});

test('hourly strategy refresh can resume through the shared control when legacy event scheduling is disabled',async()=>{
 const calls=[],send=async(path,input)=>{calls.push({path,input});return {paused:input.paused};};
 await changeAutomaticPause(false,{config:{enabled:false}},meta,{paused:false},send,{enabled:true});
 assert.deepEqual(calls,[{path:'/api/automatic/control',input:{paused:false}}]);
 await assert.rejects(changeAutomaticPause(false,undefined,meta,{paused:true},send,{enabled:true}),/先明确恢复模型/);
 assert.equal(calls.length,1);
});

async function controlComponent(){
 const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/ModelControlPanel.tsx',import.meta.url),'utf8'),'ModelControlPanel.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
 const n=parseAst(code).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='ModelControlPanel');
 return code.slice(n.start,n.end).replace(/^export /,'');
}
function renderControl(declaration,{model={paused:true},automatic=auto,modelMeta=meta,error,compact=false}={}){
 const calls=[];
 const useRead=path=>({data:path==='/api/meta'?modelMeta:path==='/api/model/control'?model:path?.startsWith('/api/strategy-refresh/')?undefined:automatic,error,reload(){}});
 const component=new Function('React','useState','useRead','modelResumeReason','changeModelPause','changeAutomaticPause','post','alias','kinds','strategyRefreshPath','refreshStatusLabel','StrategyRefreshStatus',declaration+';return ModelControlPanel;')(React,React.useState,useRead,modelResumeReason,changeModelPause,changeAutomaticPause,async(...args)=>{calls.push(args);},id=>id,{surface_action:'树表识别',industry_brief:'行业研判'},strategyRefreshPath,refreshStatusLabel,()=>null);
 return {html:renderToStaticMarkup(React.createElement(component,{compact})),calls};
}
test('opening paused controls does no POST and keeps automatic resume disabled with clear coverage',async()=>{
 const result=renderControl(await controlComponent());
 assert.equal(result.calls.length,0);
 assert.match(result.html,/恢复模型调用/);
 assert.match(result.html,/disabled=""[^>]*>恢复自动分析/);
 assert.match(result.html,/T-0012/);
 assert.match(result.html,/行业研判/);
 assert.match(result.html,/24 小时最多 6 项分析、12 次模型请求/);
});
test('model restoration permits a separate scheduler action while default startup explains its opt-in',async()=>{
 const declaration=await controlComponent();
 const ready=renderControl(declaration,{model:{paused:false}});
 assert.match(ready.html,/暂停模型调用/);
 assert.doesNotMatch(ready.html,/disabled=""[^>]*>恢复自动分析/);
 const disabled=renderControl(declaration,{automatic:{...auto,config:{...auto.config,enabled:false}},model:{paused:false}});
 assert.match(disabled.html,/本次启动未启用/);
 assert.match(disabled.html,/node start.mjs --automatic/);
 assert.match(disabled.html,/disabled=""[^>]*>恢复自动分析/);
 assert.equal(disabled.calls.length,0);
});
test('unreadable control state cannot render an enabled model resume',async()=>{
 const result=renderControl(await controlComponent(),{model:undefined,modelMeta:undefined,error:'offline'});
 assert.match(result.html,/状态暂不可读/);
 assert.match(result.html,/disabled=""[^>]*>恢复模型调用/);
 assert.equal(result.calls.length,0);
});
