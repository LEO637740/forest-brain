import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseAst,transformWithOxc} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/CommodityReference.tsx',import.meta.url),'utf8'),'CommodityReference.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const reference={
  asOf:'2026-10-21T00:00:00Z',exchange:{name:'浙江国际大宗商品交易中心有限公司',shortName:'浙江大宗',website:'https://www.zme.com.cn/'},
  rubber:{name:'橡胶',category:'合成材料',categoryCode:'2613',listing:'原有品种',specificGrades:'材料未细分'},
  documents:[{id:'approval',title:'关于调整并新增备案交易品种事项的批复',publishedAt:'2026-09-20',pages:3,summary:'合成材料分类包括橡胶。',url:'/materials/zhejiang-commodity-approval-20260920.pdf'}],
  publicEvidence:[{id:'notice',title:'交易中心公开信息',publishedAt:'2026-10-20',url:'https://www.zme.com.cn/notice',summary:'公布交易品种调整信息。'}],
  quote:{status:'not_connected',message:'尚未取得交易中心公开橡胶报价；本园区销售使用模拟报价。'},
  marketReferences:[{id:'market',title:'上期所天然橡胶期货',provider:'上期所',sourceUrl:'https://www.shfe.com.cn/',stale:true,status:'available',data:{},note:'其他市场期货参考，不能作为浙江交易中心报价。'}],
  connection:{product:'园区天然干胶（模拟产品，牌号待对接）',availableKg:374,stockKg:774,processedKg:34,pendingShipmentKg:20,nextStep:'准备可用干胶数量、胶种牌号和质检资料，向交易中心询价并核对交收条件。',summary:'先核对牌号和质量要求，再据报价调整销售安排。',priceBasis:'园区模拟干胶报价，非交易中心报价'},
};
function harness(initial=reference){
  let data=initial;
  const listeners=new Map(),reads=[],reloads=[],events=[];
  const bindings={React,BASE:'http://127.0.0.1:4188',siteIdOf:site=>`demo-${site}`,useEffect:callback=>callback(),useRead:path=>{reads.push(path);return {data,reload:()=>reloads.push(path)};},EudrReadiness:()=>null,State:()=>React.createElement('p',null,'正在读取…'),window:{addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event),dispatchEvent:event=>events.push(event)},CustomEvent};
  const Component=new Function(...Object.keys(bindings),`${declarations};return CommodityReference;`)(...Object.values(bindings));
  return {reads,reloads,events,listeners,setData(next){data=next;},render(props={}){return renderToStaticMarkup(React.createElement(Component,props));},tree(props={}){return Component(props);}};
}
function walk(element,predicate){if(!React.isValidElement(element))return [];return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];}

test('business conclusion and next step lead while exact category, grade limits and original materials stay folded',()=>{
  const h=harness(),html=h.render(),visible=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(visible,/浙江橡胶交易对接/);
  assert.match(visible,/374 公斤干胶/);
  assert.match(visible,/准备可用干胶数量、胶种牌号和质检资料/);
  assert.match(visible,/本园区销售使用模拟报价/);
  assert.doesNotMatch(visible,/2613|原有品种|about:blank/);
  assert.match(html,/<details class="hb-commodity-details"><summary>查看品种、园区对接资料与来源/);
  assert.match(html,/合成材料（2613）· 橡胶 · 原有品种/);
  assert.match(html,/材料未细分/);
  assert.match(html,/园区天然干胶（模拟产品，牌号待对接）/);
  assert.match(html,/href="\/materials\/zhejiang-commodity-approval-20260920.pdf"/);
  assert.doesNotMatch(html,/4188\/materials\//);
  assert.match(html,/href="https:\/\/www\.shfe\.com\.cn\/"/);
  assert.match(html,/不能作为浙江交易中心报价/);
});

test('processing or shipment updates refresh the selected park quantity used for inquiry',()=>{
  const h=harness();
  assert.match(h.render({site:'guangdong-maoming'}),/374 公斤干胶/);
  assert.equal(h.reads.at(-1),'/api/commodity/rubber?siteId=demo-guangdong-maoming');
  h.listeners.get('harness-sales-shipments-changed')();
  assert.deepEqual(h.reloads,['/api/commodity/rubber?siteId=demo-guangdong-maoming']);
  h.setData({...reference,connection:{...reference.connection,availableKg:354,stockKg:754}});
  assert.match(h.render({site:'guangdong-maoming'}),/354 公斤干胶/);
});

test('compact sales reference keeps the advice small and opens the same park detailed materials',()=>{
  const h=harness(),props={site:'xsbn',compact:true},html=h.render(props);
  assert.doesNotMatch(html,/<details|id="commodity-rubber-reference"|2613/);
  assert.match(html,/374 公斤干胶/);
  assert.match(html,/查看交易资料/);
  walk(h.tree(props),node=>node.type==='button')[0].props.onClick();
  assert.equal(h.events[0].type,'harness-open-commodity-market');
  assert.deepEqual(h.events[0].detail,{site:'xsbn'});
});

test('historical product terms stay separate from current inquiry advice and admission is unverified',()=>{
  const listing={id:'zme-2026-125',announcement:'浙江大宗 2026 年第 125 号公告',publishedAt:'2026-06-08',saleDate:'2026-06-09',title:'预售公告',seller:'物产中大资本管理(浙江)有限公司',channel:'产能预售系统',
    productName:'中大橡胶2026年6月交收第三批',productCode:'WZX26063',brand:'诗董',pricing:{unit:'元/吨',method:'基差报价',referenceContract:'RU2609',startBasisCnyPerTonne:-150,tickCnyPerTonne:10},
    quantityTonnes:404,minOrderTonnes:202,deposit:{issueCnyPerTonne:50,transferPct:20},quality:[{key:'impurity',label:'杂质',limit:'≤ 0.16%'},{key:'pri',label:'塑性保持率 PRI',limit:'≥ 40'}],
    delivery:{method:'自提',warehouses:['青岛港'],lastTradeDate:'2026-06-16',from:'2026-06-17',to:'2026-06-24',note:'按实际重量结算。'},transcriptionNote:'待核对',sourceUrl:'https://finance.sina.com.cn/x',imageUrl:'/materials/zhejiang-rubber-presale-2026-125.png',basis:'核实'};
  const data={...reference,listings:[listing],quote:{status:'reference',message:'沿用历史基差的计算示例，不是当前可成交报价。',referenceCnyPerTonne:19485,contract:'RU2701'},
    documents:[{...reference.documents[0],groupNote:'群聊补充：经国家证监会审批，待核实。'}],
    tradability:{listingId:listing.id,ready:null,conclusion:'可按本园实际可供数量准备询价；当前产品准入、订货和交收条件仍需向交易中心核对。',nextStep:'整理可供数量、胶种牌号和已有质检资料，向交易中心核对当前交易条件并取得报价。',
      checks:[{key:'quantity',label:'可供数量与订货条件',ok:null,detail:'本园可用 374 公斤。以实际可供数量询价，当前订货条件待对方确认。'},{key:'member',label:'参与方式',ok:null,detail:'向交易中心确认参与条件。'}]}};
  const full=harness(data).render(),compact=harness(data).render({compact:true});
  assert.match(full,/按本园实际可供数量准备询价/);
  assert.match(full,/核对当前交易条件并取得报价/);
  assert.match(full,/约 19,485 元\/吨（RU2701 \+ 历史基差，计算示例）/);
  assert.match(full,/历史橡胶商品案例/);
  assert.match(full,/本园交易对接待核对事项/);
  assert.match(full,/条件适用于该历史商品/);
  assert.match(full,/最小订货 202 吨/);
  assert.match(full,/WZX26063/);
  assert.match(full,/起拍基差 -150 元\/吨/);
  assert.match(full,/杂质 ≤ 0\.16%；塑性保持率 PRI ≥ 40/);
  assert.match(full,/href="http:\/\/127\.0\.0\.1:4188\/materials\/zhejiang-rubber-presale-2026-125\.png"|href="\/materials\/zhejiang-rubber-presale-2026-125\.png"/);
  assert.doesNotMatch(full,/还差 \d+ 项|最小订货量的|汇总到 202 吨/);
  assert.match(full,/待核实/);
  assert.doesNotMatch(compact,/19,485/);
  assert.match(compact,/当前报价待询价/);
  assert.match(full,/沿用历史基差的计算示例，不是当前可成交报价/);
  const visible=full.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(visible,/当前报价待询价/);
  assert.doesNotMatch(visible,/沿用历史基差|19,485/);
  assert.ok(full.indexOf('本园交易对接待核对事项')<full.indexOf('历史橡胶商品案例'));
  assert.match(full,/<details class="hb-commodity-details"><summary>历史商品与报价示例/);
  assert.doesNotMatch(compact,/WZX26063|最小订货量/);
});
