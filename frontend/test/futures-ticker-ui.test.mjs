import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';

const path=new URL('../src/workspace/FuturesTicker.tsx',import.meta.url);
const {code}=await transformWithOxc(readFileSync(path,'utf8'),'FuturesTicker.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const source=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
function walk(element,predicate){
  if(!React.isValidElement(element))return [];
  return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];
}
function text(element){
  if(typeof element==='string'||typeof element==='number')return String(element);
  return React.isValidElement(element)?React.Children.toArray(element.props.children).map(text).join(''):'';
}
const sample={status:'available',mode:'delayed',provider:'上海期货交易所',sourceUrl:'https://www.shfe.com.cn/reports/marketdata/delayedquotes/',
  delayMinutes:30,quoteAt:'2026-11-02T13:58:21+08:00',fetchedAt:'2026-11-02T14:28:22+08:00',tradeDate:'2026-11-02',quotes:[
    {contract:'RU2701',lastPrice:19260,previousSettlement:19180,change:80,changePct:.42,volumeLots:1120,openInterestLots:1800},
    {contract:'RU2703',lastPrice:19250,previousSettlement:19300,change:-50,changePct:-.26,volumeLots:830,openInterestLots:910},
  ]};
function mount(data=sample,error){
  let paused=false,reloads=0,current=data,currentError=error;
  const calls=[];
  const useState=()=>[paused,next=>{paused=typeof next==='function'?next(paused):next;}];
  const useRead=(url,options)=>{calls.push({url,options});return {data:current,error:currentError,reload:()=>reloads++};};
  const Component=new Function('React','useState','useRead',source+';return FuturesTicker;')(React,useState,useRead);
  let element=Component();
  return {calls,get element(){return element;},get reloads(){return reloads;},update(data,error){current=data;currentError=error;element=Component();},click(label){
    const button=walk(element,node=>node.type==='button'&&text(node)===label)[0];assert.ok(button,label);button.props.onClick();element=Component();
  }};
}

test('ticker shows the feed delay and quote time separately from refresh time and purchase-price units',()=>{
  const page=mount(),content=text(page.element);
  assert.match(content,/天然橡胶期货/);
  assert.match(content,/延时 30 分钟/);
  assert.match(content,/行情 11\/02 13:58:21/);
  assert.match(content,/最近读取 11\/02 14:28:22/);
  assert.match(content,/每 30 秒更新/);
  assert.match(content,/元 \/ 吨 · 涨跌较昨结 · 期货价格不等同鲜胶乳收购价/);
  assert.doesNotMatch(content,/实时行情|延时 15 分钟/);
  assert.deepEqual(page.calls[0],{url:'/api/market/quotes',options:{pollMs:30000}});
});

test('quote direction uses explicit signed changes and the looping copy is hidden from accessibility',()=>{
  const page=mount(),list=walk(page.element,node=>node.props['aria-label']==='天然橡胶合约报价')[0];
  const rows=walk(list,node=>node.props.role==='listitem');
  assert.equal(rows.length,2);
  assert.match(rows[0].props.className,/ft-up/);assert.match(text(rows[0]),/\+80 \/ \+0.42%/);
  assert.match(rows[1].props.className,/ft-down/);assert.match(text(rows[1]),/-50 \/ -0.26%/);
  const copy=walk(page.element,node=>node.props.className==='ft-group ft-duplicate')[0];
  assert.equal(String(copy.props['aria-hidden']),'true');assert.equal(walk(copy,node=>node.type==='button'||node.type==='a').length,0);
  assert.equal(walk(page.element,node=>node.props.className==='ft-viewport')[0].props.tabIndex,0);
});

test('pause and refresh are independent: pausing motion keeps incoming price updates visible',()=>{
  const page=mount();page.click('暂停滚动');assert.match(page.element.props.className,/ft-paused/);
  const updated={...sample,quotes:[{...sample.quotes[0],lastPrice:19300,change:120,changePct:.63}]};
  page.update(updated);assert.match(text(page.element),/19,300/);assert.match(text(page.element),/\+120 \/ \+0.63%/);
  assert.match(page.element.props.className,/ft-paused/);page.click('刷新行情');assert.equal(page.reloads,1);
  page.click('继续滚动');assert.doesNotMatch(page.element.props.className,/ft-paused/);
});

test('daily and retained quotes remain visibly labeled instead of becoming intraday prices',()=>{
  const daily=mount({...sample,mode:'daily',delayMinutes:null,quoteAt:null,tradeDate:'2026-10-30',status:'stale'});
  assert.match(text(daily.element),/收盘日报 · 保留上次行情/);assert.match(text(daily.element),/行情 2026-10-30/);
  assert.doesNotMatch(text(daily.element),/每 30 秒更新|盘中行情/);
  assert.match(text(daily.element),/收盘价（元 \/ 吨）/);
  const retained=mount(sample,'connection failed');
  assert.match(text(retained.element),/延时 30 分钟 · 保留上次行情/);assert.match(text(retained.element),/19,260/);
});

test('missing quotes and missing changes never turn into simulated zero-price movement',()=>{
  const offline=mount({...sample,status:'offline',quotes:[],message:'离线演示未连接期货行情。'});
  assert.match(text(offline.element),/离线演示未连接期货行情/);
  assert.equal(walk(offline.element,node=>node.props.className==='ft-track').length,0);
  assert.equal(walk(offline.element,node=>node.type==='button'&&text(node)==='暂停滚动').length,0);
  const unavailable=mount({...sample,status:'unavailable',quotes:[]});
  assert.match(text(unavailable.element),/暂未取得期货报价/);
  const absentChange=mount({...sample,quotes:[{...sample.quotes[0],change:null,changePct:null,volumeLots:null}]});
  assert.match(text(absentChange.element),/涨跌待更新/);assert.doesNotMatch(text(absentChange.element),/\+0|0%/);
});
