import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseAst,transformWithOxc} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/EudrReadiness.tsx',import.meta.url),'utf8'),'EudrReadiness.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const batch={id:'batch-a',title:'A区加工批次',dryKg:34,productName:'天然干胶',hsCode:'4001',countryOfProduction:'中国',sourceZones:['A'],productionPeriod:{from:'2026-10-21T01:00:00Z',to:'2026-10-21T03:00:00Z'},plots:[{id:'plot-a',name:'A区',areaHa:1.2}],evidence:[],supplier:null,buyer:null,status:'missing',statusLabel:'待整理资料',missing:['生产地合法性说明','无毁林证明'],nextStep:'整理本批地块和来源证明。',traceabilityNote:'本批可追到A区加工任务。',riskReview:{status:'not_assessed',summary:'演示资料已整理仍需客户完成风险评估。',actions:['核验地块证明','完成风险评估后提交正式声明']},allocatedKg:0,remainingKg:34,checks:[{key:'source',label:'来源树木与地块',ok:true,detail:'1 个分区地块'},{key:'shipment',label:'出货单对应',ok:false,detail:'尚未指定给任何出货单'}]};
const sample={siteId:'demo-hainan',parkName:'海南海口',summary:'已找到2批加工干胶，按批次准备客户资料。',nextStep:'先完成收胶和加工入库。',batches:[batch,{...batch,id:'batch-b',title:'B区加工批次',sourceZones:['B']}],rules:{cutoffDate:'2020-12-31',productScope:'天然橡胶及列明制品',role:'经营者按角色履行尽职调查。',geolocation:'关联所有生产地块。',dates:[{role:'适用主体',date:'2026-12-30'}],sources:[{title:'官方法规',url:'https://eur-lex.europa.eu/'}],checkedAt:'2026-10-21'},inventory:{note:'期初库存与汇总出货尚未分配到加工批次。'},shipments:[]};
function walk(node,predicate){return React.isValidElement(node)?[...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))]:[];}
function text(node){return typeof node==='string'||typeof node==='number'?String(node):React.isValidElement(node)?React.Children.toArray(node.props.children).map(text).join(''):'';}
const button=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node)===label)[0];
function harness(initial=sample){
  let data=initial,cursor=0,dirty=false,effects=[];
  const slots=[],dependencies=[],posts=[],reads=[],reloads=[],downloads=[],blobs=[],listeners=new Map();
  const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],update=>{const value=typeof update==='function'?update(slots[index]):update;if(slots[index]!==value){slots[index]=value;dirty=true;}}];};
  const useEffect=(callback,values)=>{const index=cursor++;if(!dependencies[index]||values.some((value,i)=>value!==dependencies[index][i])){dependencies[index]=values;effects.push(callback);}};
  const bindings={React,useState,useEffect,useRead:path=>({data,reload:()=>reloads.push(path)}),siteIdOf:site=>`demo-${site}`,currentAccount:()=>null,can:()=>true,
    post:async(path,input)=>{posts.push({path,input});if(path==='/api/eudr/allocate'){const shipment={...data.shipments.find(item=>item.id===input.shipmentId),traceStatus:'traceable',traceLabel:'来源可追溯',allocation:{parts:[{batchId:input.batchIds[0],title:'A区加工批次',kg:20}],sourceZones:['A']}};data={...data,shipments:data.shipments.map(item=>item.id===shipment.id?shipment:item)};return shipment;}const next={...data.batches.find(item=>item.id===input.batchId),status:'demo_prepared',statusLabel:'演示资料已整理',missing:[]};data={...data,batches:data.batches.map(item=>item.id===next.id?next:item)};return next;},
    read:async path=>{reads.push(path);return {status:'demo_prepared',batch:data.batches.find(item=>path.includes(item.id)),disclaimer:'模拟资料，尚未提交正式声明'};},
    window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)},
    Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:pack';},revokeObjectURL(){}},document:{createElement:()=>{const link={click(){downloads.push({...link});}};return link;}},
  };
  const Component=new Function(...Object.keys(bindings),`${declarations};return EudrReadiness;`)(...Object.values(bindings));
  return {posts,reads,reloads,downloads,blobs,listeners,render(){let tree,passes=0;do{cursor=0;dirty=false;effects=[];tree=Component({site:'hainan'});effects.forEach(effect=>effect());assert.ok(++passes<8);}while(dirty);return tree;}};
}

test('batch preparation and export target the selected batch through the authenticated client',async()=>{
  const h=harness();let tree=h.render();
  walk(tree,node=>node.type==='select')[0].props.onChange({target:{value:'batch-b'}});
  tree=h.render();await button(tree,'补齐本批模拟材料').props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/eudr/demo-prepare',input:{siteId:'demo-hainan',batchId:'batch-b'}}]);
  assert.ok(h.reloads.includes('/api/eudr/readiness?siteId=demo-hainan'));
  tree=h.render();assert.match(text(tree),/演示资料已整理/);
  assert.equal(button(tree,'补齐本批模拟材料'),undefined);
  await button(tree,'下载本批演示资料').props.onClick();
  assert.deepEqual(h.reads,['/api/eudr/package?siteId=demo-hainan&batchId=batch-b']);
  assert.match(h.downloads[0].download,/demo-hainan.*batch-b\.json$/);
  const exported=JSON.parse(await h.blobs[0].text());assert.equal(exported.batch.id,'batch-b');
  assert.equal(exported.batch.status,'demo_prepared');
  h.listeners.get('harness-sales-shipments-changed')();assert.equal(h.reloads.length,2);
});

test('business next steps lead and unfinished origin allocation remains visible in folded detail',()=>{
  const html=renderToStaticMarkup(harness().render()),visible=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(visible,/整理本批地块和来源证明/);
  assert.match(visible,/待补齐：生产地合法性说明；无毁林证明/);
  assert.match(visible,/不表示已完成正式尽职调查声明/);
  assert.doesNotMatch(visible,/HS 4001|2020-12-31|期初库存与汇总出货|1 个分区地块/);
  assert.match(html,/<details class="hb-eudr-details"><summary>资料核验 · 1\/2 项已齐/);
  assert.match(html,/期初库存与汇总出货尚未分配到加工批次/);
  assert.match(html,/演示资料已整理仍需客户完成风险评估/);
  assert.match(html,/核验地块证明/);
  const empty=renderToStaticMarkup(harness({...sample,batches:[]}).render());
  assert.match(empty,/到任务中心完成收胶与加工入库/);
  assert.doesNotMatch(empty,/下载本批演示资料|补齐本批模拟材料/);
});

test('an unallocated shipment takes the selected prepared batch, then exports its own source pack',async()=>{
  const prepared={...batch,status:'demo_prepared',statusLabel:'演示资料已整理',missing:[]};
  const shipment={id:'ship-1',day:1,plannedDepartureAt:'2026-10-22T00:00:00Z',plannedKg:20,status:'planned',buyer:'欧盟示例客户',traceStatus:'unallocated',traceLabel:'待指定来源批次',allocation:null};
  const h=harness({...sample,batches:[prepared],shipments:[shipment,{...shipment,id:'ship-2',day:2,status:'received',traceStatus:'shipped_untraced',traceLabel:'已出货，来源未指定'}]});
  let tree=h.render();
  assert.match(text(tree),/欧盟订单须在发车前指定/);
  assert.equal(walk(tree,node=>node.type==='select').length,0,'one batch does not need a batch picker');
  assert.match(text(tree),/已出货，来源未指定/);
  assert.equal(walk(tree,node=>node.type==='button'&&text(node)==='用所选批次').length,1);
  assert.equal(button(tree,'用所选批次').props.disabled,true);
  walk(tree,node=>node.type==='input'&&node.props.value==='batch-a')[0].props.onChange({target:{checked:true}});
  tree=h.render();
  assert.equal(button(tree,'用所选批次').props.disabled,false);
  await button(tree,'用所选批次').props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/eudr/allocate',input:{siteId:'demo-hainan',shipmentId:'ship-1',batchIds:['batch-a']}}]);
  tree=h.render();assert.match(text(tree),/来源可追溯/);
  await button(tree,'下载出货资料').props.onClick();
  assert.deepEqual(h.reads,['/api/eudr/shipment-package?siteId=demo-hainan&shipmentId=ship-1']);
  assert.match(h.downloads[0].download,/欧盟出货资料-ship-1\.json$/);
});

test('multiple source batches can be selected together for a shipment larger than one batch',async()=>{
  const prepared={...batch,status:'demo_prepared',statusLabel:'演示资料已整理',missing:[]};
  const shipment={id:'ship-40',day:1,plannedDepartureAt:'2026-10-22T00:00:00Z',plannedKg:40,status:'planned',buyer:'欧盟示例客户',traceStatus:'unallocated',traceLabel:'待指定来源批次',allocation:null};
  const h=harness({...sample,batches:[prepared,{...prepared,id:'batch-b',title:'B区加工批次',sourceZones:['B']}],shipments:[shipment]});
  let tree=h.render();
  walk(tree,node=>node.type==='input'&&node.props.value==='batch-a')[0].props.onChange({target:{checked:true}});
  tree=h.render();
  assert.match(text(tree),/已选 1 个批次，可用合计 34 公斤/);
  assert.equal(button(tree,'用所选批次').props.disabled,true);
  assert.equal(button(tree,'用所选批次').props.title,'还需选择 6 公斤来源批次');
  walk(tree,node=>node.type==='input'&&node.props.value==='batch-b')[0].props.onChange({target:{checked:true}});
  tree=h.render();
  assert.match(text(tree),/已选 2 个批次，可用合计 68 公斤/);
  assert.equal(button(tree,'用所选批次').props.disabled,false);
  await button(tree,'用所选批次').props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/eudr/allocate',input:{siteId:'demo-hainan',shipmentId:'ship-40',batchIds:['batch-a','batch-b']}}]);
});
