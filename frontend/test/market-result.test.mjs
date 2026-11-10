import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {hasNewStrategy} from '../src/integration/strategyRefreshState.ts';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/MarketSimulation.tsx',import.meta.url),'utf8'),'MarketSimulation.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declaration=parseAst(code).body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name==='MarketSimulation').declaration;
const daily=sales=>sales.map((soldKg,index)=>({day:index+1,at:`2026-10-${19+index}T00:00:00Z`,incomingKg:10,soldKg,stockKg:900+10*(index+1)-sales.slice(0,index+1).reduce((sum,value)=>sum+value,0),priceCnyPerKg:15+index*.1}));
const scenario={id:'sell_phased',name:'分批销售',schedule:'前 3 天使用一半运力，第 4 天起使用全部运力',producedKg:70,soldKg:220,endingStockKg:750,endingAvailableKg:740,revenueCny:3378,productionCostCny:100,transportCostCny:40,holdingCostCny:8,cashContributionCny:3230,endingInventoryValueCny:11544,comparisonValueCny:14774,overflowKg:0,feasible:true,daily:daily([20,20,20,40,40,40,40])};
const immediate={...scenario,id:'sell_now',name:'立即销售',schedule:'每天按可用运力销售可售库存',soldKg:280,endingStockKg:690,endingAvailableKg:680,daily:daily([40,40,40,40,40,40,40])};
const held={...scenario,id:'hold_short',name:'短期囤货',schedule:'暂存 3 天，第 4 天起按可用运力销售',soldKg:160,endingStockKg:810,endingAvailableKg:800,daily:daily([0,0,0,40,40,40,40])};
const model={id:'market-result',generatedAt:'2026-10-19T00:00:00Z',params:{storageKg:1200,stockKg:900,heldKg:10,transportKgPerDay:40,demandIndex:105,demandBaseline:100,dryKgPerTapping:.2,costPerTapping:1,careLimit:3},recommendedFrequency:2,demand:{value:105,baselineValue:100,unit:'index',band:'balanced',provenanceMode:'simulated'},eligibleTreeCount:180,excludedTreeCount:20,exclusions:[{reason:'休割',count:20}],policyReasons:['需求与价格信号平衡'],limitation:'仅供模拟方案比较',forecast:[],scenarios:[{frequency:2,produced:70,endingStock:690,feasible:true,contribution:80}],sales:{productionFrequencyPerWeek:2,scenarios:[scenario,immediate,held],recommendedScenarioId:scenario.id,recommendationReason:'分批销售的比较值较高',basis:['报价采用模拟预测']}};
const shipments=scenario.daily.map(day=>({id:`shipment-${day.day}`,modelId:model.id,siteId:'demo-hainan',scenarioId:scenario.id,scenarioName:scenario.name,day:day.day,plannedDepartureAt:day.at,plannedKg:day.soldKg,status:'planned'}));
const adoptedPlan=(patch={})=>({modelId:model.id,scenarioId:scenario.id,scenario,adoptedAt:'2026-10-19T00:00:00Z',shipments,...patch});
const inventory=(patch={})=>({siteId:'demo-hainan',openingStockKg:900,processedKg:0,processedBatches:0,stockKg:860,availableKg:850,heldKg:10,dispatchedKg:40,inTransitKg:20,soldKg:20,salesRevenueCny:300,updatedAt:'2026-10-20T03:00:00Z',mode:'simulation',unit:'kg_dry_rubber',...patch});
const Card=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);
function render({data=model,dirty=false,choice=scenario.id,salesPlan=null,currentInventory=inventory()}={}){
  const values=[900,40,105,data,false,'',dirty,'',[],choice,salesPlan,'baseline'];let index=0;
  const useState=()=>[values[index++],()=>{}];
  const Component=new Function('React','useState','useEffect','useRead','post','DATA_MODE','siteIdOf','Card','Chart','CommodityReference','EconomicFactors','EudrReadiness','n','time','hasNewStrategy',code.slice(declaration.start,declaration.end)+';return MarketSimulation;')(React,useState,()=>{},path=>path?.includes('/sales-inventory?')?{data:{inventory:currentInventory}}:{},()=>{},'demo',site=>`demo-${site}`,Card,()=>null,()=>null,()=>null,()=>null,value=>value.toLocaleString('zh-CN',{maximumFractionDigits:2}),value=>value,hasNewStrategy);
  return renderToStaticMarkup(React.createElement(Component,{onProductionPlan:()=>{}}));
}

test('sales advice leads with schedule, quantity, reason and next action while calculated metrics stay folded',()=>{
  const html=render();
  const visible=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.ok(visible.indexOf('推荐销售方案')<visible.indexOf('销售测算的生产假设'));
  assert.match(visible,/假设每周采割 <strong>2<\/strong> 次/);
  assert.match(visible,/180 棵纳入测算，20 棵暂不纳入/);
  assert.match(visible,/查看全园割胶策略/);
  assert.match(visible,/推荐销售方案/);
  assert.match(visible,/分批销售/);
  assert.match(visible,/前 3 天使用一半运力，第 4 天起使用全部运力/);
  assert.match(visible,/未来 7 天预计卖出/);
  assert.match(visible,/220 <small>公斤干胶/);
  assert.match(visible,/先卖一部分回款，再增加出货/);
  assert.match(visible,/下一步/);
  assert.match(visible,/采纳此方案后，将生成10月19日首批 20 公斤干胶及后续的模拟出货任务/);
  assert.doesNotMatch(visible,/完整经济指标|现金贡献|比较值|库存估值|期末总库存|销售收入|3,378|仓容（kg 干胶）|market-result/);
  assert.match(html,/<details class="hb-result-details hb-market-inputs"><summary>调整测算条件/);
  assert.match(html,/name="market-sales-scenario" value="sell_now"/);
  assert.match(html,/<details class="hb-result-details"><summary>查看计算指标与每日明细/);
  assert.match(html,/完整经济指标/);
  for(const metric of ['3,378','3,230','11,544','14,774'])assert.ok(html.includes(metric),metric+' is retained in details');
  assert.match(html,/期末总库存 750 公斤，其中可售 740 公斤、冻结 10 公斤/);
  assert.match(html,/所选方案每日出货与库存/);
  assert.match(html,/第 7 天 · 10\/25/);
  assert.match(html,/系统推荐依据与模拟假设/);
  assert.match(html,/分批销售的比较值较高/);
  assert.match(html,/报价采用模拟预测/);
});

test('switching alternatives updates the schedule, quantity, tradeoff and first actual shipment',()=>{
  const now=render({choice:'sell_now'}).replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(now,/当前所选方案 · 立即销售/);
  assert.match(now,/每天按可用运力销售可售库存/);
  assert.match(now,/280 <small>公斤干胶/);
  assert.match(now,/这项安排的取舍/);
  assert.match(now,/尽早回款，持续腾出仓储空间/);
  assert.match(now,/10月19日首批 40 公斤干胶/);
  assert.doesNotMatch(now,/先卖一部分回款|分批销售的比较值较高|推荐原因/);

  const later=render({choice:'hold_short'}).replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(later,/当前所选方案 · 短期囤货/);
  assert.match(later,/暂存 3 天，第 4 天起按可用运力销售/);
  assert.match(later,/160 <small>公斤干胶/);
  assert.match(later,/模拟报价后段较高/);
  assert.match(later,/回款会相应推迟/);
  assert.match(later,/10月22日首批 40 公斤干胶/);
  assert.doesNotMatch(later,/10月19日首批|分批销售的比较值较高|推荐原因/);
});

test('changed conditions and infeasible sales keep the existing adoption restrictions visible',()=>{
  const dirty=render({dirty:true});
  assert.match(dirty,/参数已改变，请重新计算后采用建议/);
  assert.match(dirty,/<button>查看全园割胶策略/);
  assert.match(dirty,/<button disabled="">采纳销售方案/);
  const infeasible=render({data:{...model,sales:{...model.sales,scenarios:[{...scenario,feasible:false,overflowKg:25}]}}});
  assert.match(infeasible,/最高超过仓容 25 公斤，需调整条件/);
  assert.match(infeasible,/<button disabled="">采纳销售方案/);
  const unavailable=render({data:{...model,recommendedFrequency:null}});
  assert.match(unavailable,/暂无可行生产假设/);
  assert.match(unavailable,/<button>查看全园割胶策略/);
  const noSales=render({choice:'',data:{...model,sales:{...model.sales,recommendedScenarioId:null,recommendationReason:'请调整仓容或运力'}}});
  assert.match(noSales,/当前条件下暂无可采用方案/);
  assert.match(noSales,/请调整仓容或运力/);
});

test('an empty page exposes calculation inputs and a saved nonrecommended choice stays identified as the user selection',()=>{
  const empty=render({data:null});
  assert.match(empty,/<details class="hb-result-details hb-market-inputs" open="">/);
  assert.match(empty,/计算并保存/);
  const adopted=render({choice:'sell_now',salesPlan:adoptedPlan({scenarioId:'sell_now',scenario:immediate})});
  assert.match(adopted,/当前所选方案/);
  assert.match(adopted,/已采纳：立即销售/);
  assert.match(adopted,/查看出货任务/);
  assert.match(adopted,/已生成 7 个模拟出货任务，前往任务中心演示发车、签收与结果回传/);
});

function walk(element,predicate){if(!React.isValidElement(element))return [];return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];}
function text(element){if(typeof element==='string'||typeof element==='number')return String(element);return React.isValidElement(element)?React.Children.toArray(element.props.children).map(text).join(''):'';}
const button=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node)===label)[0];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness({savedModel=model,savedPlan=null,post=async()=>adoptedPlan(),onProductionPlan=()=>{}}={}){
  const slots=[],deps=[],posts=[],reads=[],events=[],reloads=[];
  const listeners=new Map();
  const salesPath=`/api/simulation/market-sales-plan?siteId=demo-hainan&modelId=${savedModel.id}`;
  const inventoryPath='/api/simulation/sales-inventory?siteId=demo-hainan';
  const responses=new Map([[`/api/simulation/market/${savedModel.id}?siteId=demo-hainan`,savedModel],[salesPath,{salesPlan:savedPlan}],[inventoryPath,{inventory:inventory()}]]);
  let cursor=0,dirty=false,effects=[];
  const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{if(slots[index]!==value){slots[index]=value;dirty=true;}}];};
  const useEffect=(callback,values)=>{const index=cursor++;if(!deps[index]||values.some((value,i)=>value!==deps[index][i])){deps[index]=values;effects.push(callback);}};
  const bindings={React,useState,useEffect,hasNewStrategy,useRead:path=>{reads.push(path);return {data:responses.get(path),reload:()=>reloads.push(path)};},
    post:async(path,input)=>{posts.push({path,input});const result=await post(path,input);responses.set(salesPath,{salesPlan:result});return result;},
    DATA_MODE:'demo',siteIdOf:site=>`demo-${site}`,Card,Chart:()=>null,CommodityReference:()=>null,EconomicFactors:()=>null,EudrReadiness:()=>null,n:value=>value.toLocaleString('zh-CN',{maximumFractionDigits:2}),time:value=>value,
    window:{dispatchEvent:event=>{events.push({type:event.type,detail:event.detail});listeners.get(event.type)?.();},addEventListener:(type,callback)=>listeners.set(type,callback),removeEventListener:type=>listeners.delete(type)},
    Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
  };
  const Component=new Function(...Object.keys(bindings),code.slice(declaration.start,declaration.end)+';return MarketSimulation;')(...Object.values(bindings));
  return {posts,reads,events,reloads,responses,salesPath,inventoryPath,listeners,render(){let tree,passes=0;do{cursor=0;dirty=false;effects=[];tree=Component({site:'hainan',modelId:savedModel.id,onProductionPlan});effects.forEach(effect=>effect());assert.ok(++passes<10);}while(dirty);return tree;}};
}

test('adoption creates visible shipment progress then navigates to the exact unfinished shipment without adopting twice',async()=>{
  const h=harness();
  button(h.render(),'采纳销售方案').props.onClick();
  await settle();
  const tree=h.render();
  assert.deepEqual(h.posts,[{path:'/api/simulation/market-sales-plan',input:{siteId:'demo-hainan',modelId:model.id,scenarioId:scenario.id}}]);
  assert.match(text(tree),/已生成 7 个模拟出货任务/);
  assert.match(text(tree),/计划出货 220 公斤干胶 · 已签收 0 公斤干胶/);
  assert.ok(h.events.some(event=>event.type==='harness-sales-shipments-changed'));
  assert.ok(h.reloads.includes(h.salesPath));
  assert.ok(h.reloads.includes(h.inventoryPath));
  button(tree,'查看出货任务').props.onClick();
  assert.deepEqual(h.events.at(-1),{type:'harness-open-sales-shipments',detail:{site:'hainan',id:'shipment-1'}});
  assert.equal(h.posts.length,1);
});

test('reopening a fixed saved model restores its adopted choice and current receipts from shipment storage',()=>{
  const savedPlan=adoptedPlan({shipments:shipments.map((shipment,index)=>index<2?{...shipment,status:'received',receipt:{receivedKg:shipment.plannedKg}}:shipment)});
  const h=harness({savedPlan}),tree=h.render();
  assert.ok(h.reads.includes(`/api/simulation/market/${model.id}?siteId=demo-hainan`));
  assert.ok(h.reads.includes(h.salesPath));
  assert.match(text(tree),/已签收 40 公斤干胶/);
  button(tree,'查看出货任务').props.onClick();
  assert.equal(h.events.at(-1).detail.id,'shipment-3');
  assert.equal(h.posts.length,0);
  h.responses.set(h.salesPath,{salesPlan:adoptedPlan({shipments:shipments.map(shipment=>({...shipment,status:'received',receipt:{receivedKg:shipment.plannedKg}}))})});
  assert.match(text(h.render()),/本方案 7 批出货已完成，已回传签收 220 公斤干胶/);
});

test('a rejected sales change preserves the adopted task link and does not announce new shipments',async()=>{
  const h=harness({savedPlan:adoptedPlan(),post:async()=>{throw Error('已有出货任务发车，请先完成当前方案');}});
  let tree=h.render();
  walk(tree,node=>node.type==='input'&&node.props.value==='sell_now')[0].props.onChange();
  tree=h.render();
  button(tree,'采纳销售方案').props.onClick();
  await settle();
  tree=h.render();
  assert.match(text(tree),/已有出货任务发车，请先完成当前方案/);
  assert.ok(button(tree,'查看已采纳方案的出货任务'));
  assert.equal(h.events.some(event=>event.type==='harness-sales-shipments-changed'),false);
  assert.equal(h.posts.length,1);
});

test('current inventory and confirmed sales stay separate from the saved forecast and monetary details',()=>{
  const html=render(),visible=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(visible,/仓内库存<\/dt><dd>860/);
  assert.match(visible,/可用库存<\/dt><dd>850/);
  assert.match(visible,/正在运输<\/dt><dd>20/);
  assert.match(visible,/累计已销售<\/dt><dd>20/);
  assert.match(visible,/原方案未来 7 天预计卖出/);
  assert.match(visible,/220 <small>公斤干胶/);
  assert.match(visible,/下方预估保留生成时的测算条件/);
  assert.doesNotMatch(visible,/累计销售额|演示初始库存|累计出库/);
  assert.match(html,/累计销售额 300 元/);
  assert.match(html,/期初库存 900 kg/);
});

test('shipment updates refresh the latest inventory and recalculation does not send the old model stock',async()=>{
  const nextModel={...model,id:'market-after-dispatch',params:{...model.params,stockKg:860}};
  const h=harness({post:async()=>nextModel});
  h.render();
  h.listeners.get('harness-sales-shipments-changed')();
  assert.ok(h.reloads.includes(h.inventoryPath));
  h.responses.set(h.inventoryPath,{inventory:inventory({inTransitKg:0,soldKg:40,salesRevenueCny:600})});
  let tree=h.render();
  assert.match(renderToStaticMarkup(tree),/累计已销售<\/dt><dd>40/);
  assert.match(renderToStaticMarkup(tree),/仓内库存<\/dt><dd>860/);
  button(tree,'重新计算并保存').props.onClick();
  await settle();
  tree=h.render();
  const calculation=h.posts.find(item=>item.path==='/api/simulation/market');
  assert.ok(calculation);
  assert.equal('stockKg' in calculation.input,false);
  assert.equal('heldKg' in calculation.input,false);
  assert.match(renderToStaticMarkup(tree),/期初库存 860 kg/);
  assert.equal(model.params.stockKg,900);
});

test('changing the economic scenario recalculates with that scenario and preserves original operating inputs',async()=>{
  const nextModel={...model,id:'market-typhoon',economicScenarioId:'typhoon'};
  const h=harness({post:async()=>nextModel});
  let tree=h.render();
  let picker=walk(tree,node=>typeof node.props.onCalculate==='function')[0];
  assert.equal(picker.props.value,'baseline');
  picker.props.onChange('typhoon');
  tree=h.render();
  assert.match(text(tree),/参数已改变/);
  picker=walk(tree,node=>typeof node.props.onCalculate==='function')[0];
  assert.equal(picker.props.value,'typhoon');
  await picker.props.onCalculate();
  const request=h.posts.find(item=>item.path==='/api/simulation/market');
  assert.deepEqual(request.input,{siteId:'demo-hainan',storageKg:1200,transportKgPerDay:40,demandIndex:105,demandBaseline:100,dryKgPerTapping:.2,costPerTapping:1,careLimit:3,economicScenarioId:'typhoon'});
  assert.doesNotMatch(text(h.render()),/参数已改变/);
});

test('editing only transport preserves saved custom production inputs and leaves inventory to the current ledger',async()=>{
  const custom={...model,id:'market-custom-inputs',economicScenarioId:'robot_recovery',params:{
    storageKg:1700,stockKg:796.7,heldKg:400,transportKgPerDay:31,
    treeCount:91,dryKgPerTapping:.37,costPerTapping:1.83,careLimit:2,demandIndex:117,demandBaseline:109},eligibleTreeCount:85,excludedTreeCount:6};
  const updated={...custom,id:'market-new-transport',params:{...custom.params,transportKgPerDay:43,stockKg:794.4}};
  const h=harness({savedModel:custom,post:async()=>updated});
  h.responses.set(h.inventoryPath,{inventory:inventory({stockKg:794.4,heldKg:400,availableKg:394.4})});
  let tree=h.render();
  const label=walk(tree,node=>node.type==='label'&&text(node).startsWith('每日运力'))[0];
  const input=walk(label,node=>node.type==='input')[0];
  assert.equal(input.props.value,31);
  input.props.onChange({target:{value:'43'}});
  tree=h.render();
  assert.match(text(tree),/参数已改变/);
  await button(tree,'重新计算并保存').props.onClick();
  const request=h.posts.find(item=>item.path==='/api/simulation/market');
  assert.deepEqual(request.input,{siteId:'demo-hainan',storageKg:1700,transportKgPerDay:43,
    treeCount:91,dryKgPerTapping:.37,costPerTapping:1.83,careLimit:2,demandIndex:117,demandBaseline:109,economicScenarioId:'robot_recovery'});
  assert.equal('stockKg' in request.input,false);
  assert.equal('heldKg' in request.input,false);
  const html=renderToStaticMarkup(h.render());
  assert.match(html,/期初库存 794.4 kg/);
  assert.match(html,/85 棵纳入测算，6 棵暂不纳入/);
  assert.doesNotMatch(text(h.render()),/参数已改变/);
  assert.equal(custom.params.stockKg,796.7);
  assert.equal(custom.params.transportKgPerDay,31);
});

test('production receipts refresh current inventory without rewriting the saved model forecast',()=>{
  const h=harness();
  h.render();
  h.responses.set(h.inventoryPath,{inventory:inventory({processedKg:34,processedBatches:1,stockKg:894,availableKg:884})});
  h.listeners.get('harness-sales-shipments-changed')();
  const html=renderToStaticMarkup(h.render());
  assert.match(html,/累计加工入库 34 公斤干胶 · 1 批/);
  assert.match(html,/仓内库存<\/dt><dd>894/);
  assert.match(html,/期初库存 900 kg/);
  assert.equal(h.posts.length,0);
});


test('production action opens the park strategy without creating an independent rule task',()=>{
  let opened=0;
  const h=harness({onProductionPlan:()=>opened++}),tree=h.render();
  assert.match(text(tree),/尚未读取全园方案/);
  button(tree,'查看全园割胶策略').props.onClick();
  assert.equal(opened,1);
  assert.equal(h.posts.length,0);
  assert.equal(button(tree,'按此安排作业'),undefined);
});

test('background sales updates preserve historical selection and unsaved conditions until explicitly loaded',()=>{
 const h=harness({savedPlan:adoptedPlan()}),latest={...model,id:'market-background',generatedAt:'2026-10-29T02:00:00Z',params:{...model.params,transportKgPerDay:70}};
 let page=h.render();
 const transport=()=>walk(h.render(),node=>node.type==='label'&&text(node).startsWith('每日运力'))[0];
 walk(transport(),node=>node.type==='input')[0].props.onChange({target:{value:'43'}});
 h.responses.set('/api/simulation/market/latest?siteId=demo-hainan',{model:latest,plan:null,salesPlan:null});
 page=h.render();
 assert.match(text(page),/后台已有新的经营方案/);assert.match(text(page),/当前未保存的条件仍保留/);
 assert.equal(walk(transport(),node=>node.type==='input')[0].props.value,43);
 assert.match(text(page),/已采纳：分批销售/);assert.equal(h.posts.length,0);
 button(page,'放弃未保存条件并查看新方案').props.onClick();
 page=h.render();assert.equal(walk(transport(),node=>node.type==='input')[0].props.value,70);
 assert.doesNotMatch(text(page),/参数已改变|后台已有新的经营方案/);
 assert.equal(h.posts.length,0,'loading a generated result never adopts or recalculates it');
});
