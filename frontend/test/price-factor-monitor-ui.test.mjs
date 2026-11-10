import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst,transformWithOxc} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/PriceFactorMonitor.tsx',import.meta.url),'utf8'),'PriceFactorMonitor.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
function walk(node,predicate){return React.isValidElement(node)?[...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))]:[];}
function text(node){return typeof node==='string'||typeof node==='number'?String(node):React.isValidElement(node)?React.Children.toArray(node.props.children).map(text).join(''):'';}
const factor=(key,horizon,level,levelLabel,extra={})=>({key,horizon,label:`${key}因素`,teacher:'老师原文',reading:`${key}读数`,rule:'规则',priceEffect:'作用',action:`${key}动作`,
 scenarioId:null,decisions:['park_plan'],owner:'农场管理',level,levelLabel,sources:[{label:'上期所 RU2701 日行情',mode:'measured',at:'2026-10-21',url:'https://www.shfe.com.cn/'},{label:'园区需求',mode:'simulated',at:null,url:null}],missing:['台风预警'],...extra});
const report={siteId:'demo-hainan',park:'海口',generatedAt:'2026-10-21T06:00:00Z',headline:'价格因素体检：1 项预警、1 项关注',counts:{alert:1,watch:1,normal:1,unknown:0},
 recommendedScenarioId:'typhoon',recommendation:'自然灾害与运输预警：建议按对应情景重算。',
 factors:[factor('hazard','short','alert','预警',{scenarioId:'typhoon'}),factor('futures','short','watch','关注'),factor('labor','long','normal','正常')],
 interactions:[{key:'a',title:'灾害涨价 × 树体养护',active:true,text:'不突破可割条件'}],study:{document:'/x.pdf',views:['约 20 年一个周期']},basis:'依据说明'};
function render(props){
 const reads=[];
 const Component=new Function('React','useRead','MarketEvents',`${declarations};return PriceFactorMonitor;`)(React,path=>{reads.push(path);return {data:report,reload(){}};},()=>null);
 return {tree:Component(props),reads};
}

test('monitor groups short and long factors, labels public versus simulated sources and offers the recommended scenario',()=>{
 const chosen=[];
 const {tree,reads}=render({siteId:'demo-hainan',scenarioId:'baseline',onUseScenario:id=>chosen.push(id)});
 assert.deepEqual(reads,['/api/economics/price-factors?siteId=demo-hainan']);
 const content=text(tree);
 assert.match(content,/短期因素.*hazard因素.*futures因素.*长期因素.*labor因素/s);
 assert.match(content,/公开数据上期所 RU2701 日行情/);
 assert.match(content,/模拟园区需求/);
 assert.match(content,/待接入台风预警/);
 assert.match(content,/灾害涨价 × 树体养护/);
 walk(tree,node=>node.type==='button'&&text(node)==='选用建议情景')[0].props.onClick();
 assert.deepEqual(chosen,['typhoon']);
 const same=render({siteId:'demo-hainan',scenarioId:'typhoon',onUseScenario(){}});
 assert.equal(walk(same.tree,node=>node.type==='button'&&text(node)==='选用建议情景').length,0);
});
