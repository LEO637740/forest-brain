import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';

const file='../src/workspace/AssistantOperation.tsx';
const compiled=await transformWithOxc(readFileSync(new URL(file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
const code=parseAst(compiled.code).body.filter(node=>node.type!=='ImportDeclaration')
  .map(node=>compiled.code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const operation={id:'operation-recompute',label:'重新计算生产计划',kind:'recompute_plan',targetId:null,step:null,
  state:'prepared',siteId:'demo-hainan',payload:{}};
const completed={...operation,state:'completed',result:{id:'new-park-plan'}};
const path='/api/assistant/sessions/session-owner/operations/operation-recompute';

function harness({postResult=async()=>completed,readResult=async()=>completed}={}){
  const state=[],calls={posts:[],reads:[],events:[]};let cursor=0,token='owner-token';
  const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;
    return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];};
  const bindings={React,useState,sessionToken:()=>token,
    assistantSessionPath:id=>`/api/assistant/sessions/${encodeURIComponent(id)}`,
    useRead:()=>({data:operation}),
    post:async(...args)=>{calls.posts.push(args);return postResult(...args);},
    read:async(...args)=>{calls.reads.push(args);return readResult(...args);},
    window:{dispatchEvent:event=>calls.events.push(event.type)},
    Event,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
  };
  const Component=new Function(...Object.keys(bindings),code+';return AssistantOperation;')(...Object.values(bindings));
  return {calls,setToken:value=>{token=value;},render:()=>{cursor=0;return Component({sessionId:'session-owner',operationId:operation.id,onClose:()=>{}});}};
}
function walk(node,predicate){if(!React.isValidElement(node))return [];
  return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];}
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);
  return React.isValidElement(node)?React.Children.toArray(node.props.children).map(text).join(''):'';}
const button=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node)===label)[0];
const alert=tree=>walk(tree,node=>node.props.role==='alert').map(text).join('');

test('slow recomputation uses the same 180-second allowance as the production-plan page',async()=>{
  const gate=Promise.withResolvers(),h=harness({postResult:()=>gate.promise});
  const pending=button(h.render(),'确认执行').props.onClick();
  assert.deepEqual(h.calls.posts,[[`${path}/confirm`,{},{timeoutMs:180_000}]]);
  assert.equal(button(h.render(),'正在执行…').props.disabled,true);
  assert.deepEqual(h.calls.reads,[]);
  gate.resolve(completed);await pending;
  assert.match(text(h.render()),/新方案已生成，尚未采用/);
  assert.equal(alert(h.render()),'');
  assert.equal(h.calls.posts.length,1);
});

test('a lost confirmation response recovers the committed receipt for the same operation without executing again',async()=>{
  const h=harness({postResult:async()=>{throw Error('Failed to fetch');}});
  await button(h.render(),'确认执行').props.onClick();
  assert.deepEqual(h.calls.reads,[[path]]);
  assert.equal(h.calls.posts.length,1);
  assert.match(text(h.render()),/新方案已生成，尚未采用/);
  assert.equal(button(h.render(),'确认执行'),undefined);
  assert.equal(alert(h.render()),'');
  assert.equal(h.calls.events.length,3);
});

test('an operation still prepared after a timeout stays retryable under its existing ID',async()=>{
  let attempts=0;
  const h=harness({postResult:async()=>{if(++attempts===1)throw Error('The operation timed out');return completed;},readResult:async()=>operation});
  await button(h.render(),'确认执行').props.onClick();
  assert.match(alert(h.render()),/timed out/);
  assert.equal(button(h.render(),'确认执行').props.disabled,false);
  assert.deepEqual(h.calls.events,[]);
  assert.equal(h.calls.posts.length,1,'recovery must never automatically execute');
  await button(h.render(),'确认执行').props.onClick();
  assert.deepEqual(h.calls.posts.map(call=>call[0]),[`${path}/confirm`,`${path}/confirm`]);
  assert.deepEqual(h.calls.reads,[[path]]);
  assert.equal(alert(h.render()),'');
});

test('login failures are preserved without reading an older success receipt',async()=>{
  const h=harness({postResult:async()=>{throw Error('登录身份已失效，请重新选择身份。');}});
  await button(h.render(),'确认执行').props.onClick();
  assert.match(alert(h.render()),/登录身份已失效/);
  assert.deepEqual(h.calls.reads,[]);assert.deepEqual(h.calls.events,[]);
  assert.doesNotMatch(text(h.render()),/新方案已生成/);
});

test('changing identity during receipt recovery cannot publish the old account result',async()=>{
  const gate=Promise.withResolvers();
  const h=harness({postResult:async()=>{throw Error('Failed to fetch');},readResult:()=>gate.promise});
  const pending=button(h.render(),'确认执行').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.calls.reads,[[path]]);
  h.setToken('different-account-token');gate.resolve(completed);await pending;
  assert.match(alert(h.render()),/登录身份已变更/);
  assert.deepEqual(h.calls.events,[]);
  assert.doesNotMatch(text(h.render()),/新方案已生成/);
});
