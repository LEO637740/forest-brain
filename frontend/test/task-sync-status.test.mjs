import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';

const source=readFileSync(new URL('../src/workspace/TaskSyncStatus.tsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source,'TaskSyncStatus.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const TaskSyncStatus=new Function('React',declarations+';return TaskSyncStatus;')(React);
const state={phase:'synced',pendingCount:0,lastSuccessAt:Date.parse('2026-10-17T02:03:04.000Z'),error:null,conflicts:[],notice:null,hydrated:true,busy:false};
const render=(patch={},props={})=>renderToStaticMarkup(React.createElement(TaskSyncStatus,{state:{...state,...patch},onRetry(){},...props}));

test('initial read failure explains the missing server baseline without claiming browser persistence',()=>{
 const html=render({phase:'error',error:'请求超时',hydrated:false,lastSuccessAt:null});
 assert.match(html,/任务记录同步失败/);
 assert.match(html,/尚未取得服务端任务记录/);
 assert.match(html,/尚无成功同步记录/);
 assert.match(html,/同步失败：请求超时/);
 assert.doesNotMatch(html,/已保存到本地|本地保存成功|设备离线|机器人离线/);
 assert.match(html,/<details[^>]*aria-label="全部园区任务记录同步状态"/);
});

test('a later failure distinguishes the last confirmed snapshot from current browser updates',()=>{
 const html=render({phase:'error',pendingCount:2,error:'服务暂不可用'});
 assert.match(html,/最近一次成功同步后的变化尚未核实/);
 assert.match(html,/2 条待确认/);
 assert.match(html,/2026\/10\/17 10:03:04（北京时间）/);
 assert.doesNotMatch(html,/尚未取得服务端任务记录|服务端已确认<\/span>/);
});

test('pending browser updates are explicitly unconfirmed and include the all-site scope',()=>{
 const html=render({phase:'pending',pendingCount:3});
 assert.match(html,/浏览器更新待确认/);
 assert.match(html,/3 条待确认/);
 assert.match(html,/服务端确认前，不能视为已提交/);
 assert.match(html,/>全部园区<\/span>/);
 assert.match(html,/待服务端确认<\/dt><dd>3 条/);
 assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);
});

test('confirmed records show server confirmation and a Shanghai timestamp regardless of process timezone',()=>{
 const previous=process.env.TZ;
 try{
  process.env.TZ='UTC';const utc=render();
  process.env.TZ='America/Los_Angeles';const west=render();
  assert.equal(utc,west);
  assert.match(utc,/服务端已确认/);
  assert.match(utc,/2026\/10\/17 10:03:04（北京时间）/);
  assert.doesNotMatch(utc,/\d+ 条待确认/);
  assert.match(utc,/待服务端确认<\/dt><dd>0 条/);
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('conflicts retain the task identity and explain an absent remote record',()=>{
 const html=render({phase:'conflict',conflicts:[{taskId:'task-17',message:'任务版本不一致',task:null}]});
 assert.match(html,/任务记录需核对/);
 assert.match(html,/任务 task-17/);
 assert.match(html,/任务版本不一致/);
 assert.match(html,/已保留本地内容，请核对并修正任务后再同步/);
 assert.match(html,/aria-label="需要核对的任务"/);
});

test('busy synchronization disables retry and rendering never invokes it',()=>{
 let calls=0;const html=render({phase:'syncing',busy:true,pendingCount:1},{onRetry(){calls++;}});
 assert.equal(calls,0);
 assert.match(html,/aria-busy="true"/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>正在同步…<\/button>/);
});

test('manual retry uses the provided callback once',()=>{
 let calls=0;const element=TaskSyncStatus({state,onRetry(){calls++;}});
 function findButton(node){
  if(!React.isValidElement(node))return undefined;
  if(node.type==='button')return node;
  return React.Children.toArray(node.props.children).map(findButton).find(Boolean);
 }
 const button=findButton(element);
 assert.ok(button);assert.equal(button.props.disabled,false);
 button.props.onClick();assert.equal(calls,1);
});

test('local persistence errors stay prominent even when the server has confirmed current records',()=>{
 const html=render({}, {storageError:'浏览器存储空间不足'});
 assert.match(html,/任务记录同步状态：本地保存异常/);
 assert.match(html,/本地保存失败：浏览器存储空间不足/);
 assert.match(html,/刷新或关闭页面后丢失/);
 assert.match(html,/ws-task-sync--error/);
 assert.doesNotMatch(html,/已保存到本地|本地保存成功/);
});

test('error and conflict messages render as text rather than executable markup',()=>{
 const html=render({phase:'conflict',error:'<script>alert(1)</script>',notice:'<img src=x onerror=alert(1)>',conflicts:[{taskId:'<b>id</b>',message:'<svg onload=alert(1)>',task:null}]});
 assert.doesNotMatch(html,/<script>|<img|<svg|<b>/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&lt;svg/);
});
