import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {sites} from '../src/workspace/model.ts';
import {catalogTime} from '../src/workspace/dataCatalog.ts';

async function compiled(file){
  const {code}=await transformWithOxc(readFileSync(new URL('../src/workspace/'+file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
  return {code,ast:parseAst(code)};
}
const summary=await compiled('MapInventorySummary.tsx');
const declarations=summary.ast.body.filter(node=>node.type!=='ImportDeclaration').map(node=>summary.code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const MapInventorySummary=new Function('React','sites','catalogTime',declarations+';return MapInventorySummary;')(React,sites,catalogTime);
const inventory={siteId:'demo-hainan',openingStockKg:800,stockKg:808.9,availableKg:408.9,heldKg:400,processedKg:14.8,processedBatches:2,dispatchedKg:5.9,inTransitKg:0,soldKg:5.9,salesRevenueCny:86.49,updatedAt:'2026-10-26T08:52:53Z',unit:'kg_dry_rubber',mode:'simulation'};
const noop=()=>{};
const html=props=>renderToStaticMarkup(React.createElement(MapInventorySummary,{site:'hainan',inventory,onRefresh:noop,...props}));

test('map inventory uses the selected park business ledger and distinguishes stock, held stock and sales transit',()=>{
  const result=html({inventory:{...inventory,inTransitKg:6.2}});
  assert.match(result,/海南海口模拟园区/);
  for(const value of ['808.9','408.9','400','6.2'])assert.ok(result.includes(value),value);
  assert.match(result,/累计加工入库 14.8 公斤干胶 · 2 批/);
  assert.match(result,/销售在途/);
  assert.doesNotMatch(result,/预留|独立企业|鲜胶乳/);
});

test('map inventory does not show the previous park stock while a new park is loading',()=>{
  const waiting=html({site:'xsbn'});
  assert.match(waiting,/云南景洪模拟园区/);
  assert.match(waiting,/正在读取本园区库存/);
  assert.doesNotMatch(waiting,/808.9|408.9/);
  const loaded=html({site:'xsbn',inventory:{...inventory,siteId:'demo-xsbn',stockKg:34,availableKg:30}});
  assert.match(loaded,/34/);assert.match(loaded,/30/);
  assert.doesNotMatch(loaded,/808.9|408.9/);
});

test('all-park map asks for a park rather than presenting one park as an aggregate',()=>{
  const result=html({site:null});
  assert.match(result,/选择园区后/);
  assert.doesNotMatch(result,/808.9|海南|重新读取库存/);
});

test('unavailable inventory shows the read error without inventing zero quantities',()=>{
  const result=html({inventory:null,error:'库存服务暂不可用'});
  assert.match(result,/role="alert"/);assert.match(result,/库存服务暂不可用/);
  assert.doesNotMatch(result,/公斤干胶<\/small>|累计加工入库 0/);
  const cached=html({error:'刷新失败，保留上次记录'});
  assert.match(cached,/刷新失败/);assert.match(cached,/808.9/);
});

test('inventory refresh and detailed ledger controls invoke the supplied page actions',()=>{
  const calls=[];
  const element=MapInventorySummary({site:'hainan',inventory,onRefresh:()=>calls.push('refresh'),onData:()=>calls.push('data')});
  const walk=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(walk)];
  const buttons=walk(element).filter(node=>node.type==='button');
  assert.equal(buttons.length,2);
  buttons[0].props.onClick();buttons[1].props.onClick();
  assert.deepEqual(calls,['refresh','data']);
});

const workspace=await compiled('WorkspaceApp.tsx');
const app=workspace.ast.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name==='WorkspaceApp')?.declaration;
assert.ok(app);
const effect=app.body.body.find(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&node.expression.callee.name==='useEffect'&&workspace.code.slice(node.start,node.end).includes('/api/simulation/sales-inventory'))?.expression.arguments[0];
assert.ok(effect);
const effectSource=workspace.code.slice(effect.start,effect.end);
function mountRefresh({page='overview',site='hainan',read}={}){
  const windowEvents=new Map(),documentEvents=new Map();
  let interval,delay,cleared=false;
  const events=map=>({addEventListener:(name,fn)=>map.set(name,fn),removeEventListener:(name,fn)=>{if(map.get(name)===fn)map.delete(name);}});
  const window={...events(windowEvents),setInterval:(fn,ms)=>{interval=fn;delay=ms;return 1;},clearInterval:()=>{cleared=true;}};
  const document={hidden:false,...events(documentEvents)},stocks=[],shipments=[],errors=[],requests=[];
  let current=inventory;
  const reader=read??(url=>Promise.resolve(url.includes('sales-inventory')?{inventory:current}:{items:[]}));
  const run=new Function('read','page','site','setShipmentError','setSalesShipments','setSalesInventory','window','document',`return (${effectSource});`)(url=>{requests.push(url);return reader(url);},page,site,value=>errors.push(value),value=>shipments.push(value),value=>stocks.push(value),window,document);
  const close=run();
  return {requests,stocks,errors,windowEvents,documentEvents,document,close,get delay(){return delay;},get cleared(){return cleared;},tick:()=>interval(),setInventory:value=>{current=value;}};
}
const flush=()=>new Promise(setImmediate);

test('map inventory refreshes the selected site on the 30 second timer and when the page becomes active',async()=>{
  const page=mountRefresh({site:'xsbn'});await flush();
  assert.equal(page.delay,30000);
  assert.ok(page.requests.every(url=>url.endsWith('siteId=demo-xsbn')));
  page.setInventory({...inventory,siteId:'demo-xsbn',stockKg:34});
  page.windowEvents.get('focus')();await flush();
  assert.equal(page.stocks.at(-1).stockKg,34);
  const before=page.requests.length;page.document.hidden=true;page.tick();assert.equal(page.requests.length,before);
  page.document.hidden=false;page.documentEvents.get('visibilitychange')();await flush();
  assert.ok(page.requests.length>before);
  page.setInventory({...inventory,stockKg:808.9});page.tick();await flush();assert.equal(page.stocks.at(-1).stockKg,808.9);
  page.close();assert.equal(page.cleared,true);assert.equal(page.windowEvents.size,0);assert.equal(page.documentEvents.size,0);
});

test('leaving a park prevents an old in-flight inventory response from replacing the next park state',async()=>{
  const resolve=[];
  const page=mountRefresh({read:()=>new Promise(done=>resolve.push(done))});
  page.close();resolve[0]({items:[]});resolve[1]({inventory});await flush();
  assert.equal(page.stocks.length,0);
  const other=mountRefresh({page:'workbench'});assert.equal(other.requests.length,0);assert.equal(other.close,undefined);
});
