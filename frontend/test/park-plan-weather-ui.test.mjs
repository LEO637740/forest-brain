import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {hasNewStrategy} from '../src/integration/strategyRefreshState.ts';
import {transformWithOxc,parseAst} from 'vite';

const file='../src/integration/ParkTappingPlan.tsx';
const compiled=await transformWithOxc(readFileSync(new URL(file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
const code=parseAst(compiled.code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>compiled.code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const noop=()=>null;
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!React.isValidElement(node))return '';if(typeof node.type==='function')return text(node.type(node.props));return React.Children.toArray(node.props.children).map(text).join('');}
function walk(node,predicate){if(!React.isValidElement(node))return [];if(typeof node.type==='function')return walk(node.type(node.props),predicate);return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];}
const button=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node).trim()===label)[0];
const now=Date.now(),at=minutes=>new Date(now+minutes*60_000).toISOString();
const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29'];
const plan={id:'live-plan',siteId:'demo-hainan',park:'海南海口模拟园区',generatedAt:at(0),validUntil:at(120),stance:'reduce',stanceLabel:'减产',frequencyPerWeek:1,marketTargetFrequency:3,baselineFrequency:2,
  headline:'经营目标每区每周3次，天气核验后实际安排各区0–1次',score:0,signals:[],
  modelProposal:{mode:'llm',provider:'test-provider',model:'test-model',generatedAt:at(0),summary:'高需求下建议每区3次',zones:[],drivers:[],risks:[],inputSnapshot:{},inputFingerprint:'inputs-1'},constraintAdjustments:[],
  readiness:{checkedAt:at(0),readyCount:80,reviewCount:0,totalCount:80,readyTrees:[],reviewTrees:[],exceptionCases:[]},
  outlook:dates.map((date,i)=>({date,rainProbabilityPct:i===2?null:i===0?20:80,rainMm:i===2?null:i===0?0:1,source:'live_weather',tappable:i===0,reasons:[['天气可用','降雨限制','天气缺失','雨后需复核'][i]],heldZones:[],blockReason:[undefined,'rain','missing_weather','review'][i]})),
  zones:[{zone:'A',robot:'R-A',eligibleTrees:40,excluded:[],frequency:1,dates:[dates[0]],expectedDryKg:12,hold:null,schedule:[{date:dates[0],start:'06:00',end:'07:20',windowStart:at(0),windowEnd:at(120)}]},
    {zone:'B',robot:'R-B',eligibleTrees:40,excluded:[],frequency:0,dates:[],expectedDryKg:0,hold:'连续适合作业的窗口不足，已减少安排次数'}],
  production:{expectedDryKg:12,baselineDryKg:48,deltaKg:-36},inventory:{stockKg:808.9,storageKg:900,utilization:.9,plannedSalesKg:0,projectedEndKg:820.9,overflowKg:0},
  cerebellumVersion:'v1',salesHint:'按计划安排',analogy:'天气与经营联合判断',limitations:[],
  weather:{mode:'live',provider:'Open-Meteo',fetchedAt:at(-5),validUntil:at(115),decisionFingerprint:'weather-1',status:'available',summary:'未来四天仅首日存在完整作业窗口',workingHours:'06:00–12:00',minutesPerTree:2},
  weatherCheck:{needsRecompute:false,reason:null,currentFetchedAt:at(-5)}};
function harness(initialPlan=plan,props={site:'hainan'},config={}){
  const state=[],refs=[],effectDeps=[],effects=[],listeners=new Map(),calls={reads:[],posts:[],postOptions:[],reloads:0,events:[]};let cursor=0,refCursor=0,effectCursor=0;
  let response={plan:initialPlan};
  const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],value=>state[i]=typeof value==='function'?value(state[i]):value];};
  const useRef=initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});};
  const useEffect=(fn,deps)=>{const i=effectCursor++;if(!effectDeps[i]||deps.some((value,index)=>value!==effectDeps[i][index])){effectDeps[i]=deps;effects.push(fn);}};
  const bindings={React,useState,useRef,useEffect,hasNewStrategy,ArrowRight:noop,CalendarDays:noop,CloudRain:noop,RefreshCw:noop,
    alias:value=>value,siteIdOf:site=>`demo-${site}`,when:value=>value,can:()=>true,currentAccount:()=>null,EconomicFactors:noop,ParkEconomicEvidence:noop,ParkModelReasoning:noop,
    ParkBusinessInputsEditor:props=>React.createElement('button',{onClick:props.onSaved},'保存经营输入（测试）'),
    useRead:(path,options)=>{calls.reads.push({path,options});return {data:response,reload:()=>calls.reloads++};},
    post:async(path,input,options)=>{calls.posts.push({path,input});calls.postOptions.push(options);if(config.error)throw Error(config.error);return {...plan,id:'recomputed-plan'};},
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>{calls.events.push(event.type);listeners.get(event.type)?.();}},
  };
  const exported=new Function(...Object.keys(bindings),code+';return {ParkTappingPlan,zoneCells};')(...Object.values(bindings));
  const render=()=>{cursor=0;refCursor=0;effectCursor=0;return exported.ParkTappingPlan(props);};
  const settle=()=>{let tree=render();for(let rounds=0;effects.length&&rounds<8;rounds++){effects.splice(0).forEach(fn=>fn());tree=render();}return tree;};
  return {calls,listeners,render,settle,zoneCells:exported.zoneCells,setResponse:value=>{response={plan:value};}};
}

test('final park plan separates target frequency from actual weather-adjusted trees, yield and time',()=>{
  const h=harness();const page=h.settle(),content=text(page);
  assert.match(content,/Open-Meteo.*获取于/);assert.match(content,/此次新增 1 项分区作业，40 树次，预计 12 kg 干胶/);
  assert.match(content,/模型的各区建议经硬约束核验后，实际每区最多 1 次 \/ 周/);
  assert.match(content,/06:00–07:20/);
  const cells=h.zoneCells(plan,plan.zones[0]);assert.deepEqual(cells.map(cell=>cell.label),['雨','雨','缺天气','待核']);
  assert.equal(cells[0].tap,true);assert.equal(cells[0].schedule.start,'06:00');
  assert.ok(h.zoneCells(plan,plan.zones[1]).every(cell=>cell.label==='窗口短'));
  assert.ok(h.calls.reads.every(call=>call.options.pollMs===60_000));
});

test('legacy weather plans without a separate economic target keep a readable frequency',()=>{
  const legacy={...plan};delete legacy.marketTargetFrequency;
  const content=text(harness(legacy).settle());
  assert.match(content,/实际每区最多 1 次 \/ 周/);
  assert.doesNotMatch(content,/undefined|NaN/);
});

test('the calendar and adoption distinguish existing partial work from new rounds',()=>{
 const retained={...plan,frequencyPerWeek:1,zones:plan.zones.map(zone=>({...zone,frequency:0,existingFrequency:1,totalFrequency:1,dates:[],schedule:[],expectedDryKg:0})),production:{expectedDryKg:0,baselineDryKg:12,deltaKg:-12}};
 const h=harness(retained),page=h.settle(),content=text(page);
 assert.match(content,/各区单树本周最多 1 次/);
 assert.match(content,/此次新增 0 次/);
 assert.match(content,/部分树已有最多 1 次，进度见原任务/);
 assert.ok(button(page,'采用保留现有安排'));
 assert.equal(button(page,'采用并生成任务'),undefined);
});

test('capacity-limited zones keep remaining tapping dates and do not label every rest day paused',()=>{
  const h=harness();
  const partial={...plan.zones[0],hold:'仓容只能容纳一次新增产出'};
  const cells=h.zoneCells({...plan,outlook:plan.outlook.map(day=>({...day,tappable:true,reasons:[],blockReason:undefined,rainProbabilityPct:20,rainMm:0}))},partial);
  assert.equal(cells[0].tap,true);assert.ok(cells.every(cell=>!cell.blocked));assert.ok(cells.every(cell=>cell.label!=='暂停'));
});

test('saving economic inputs preserves the plan snapshot and requires explicit recompute before adoption',async()=>{
  const h=harness({...plan,economics:{}});let page=h.settle();
  button(page,'保存经营输入（测试）').props.onClick();page=h.render();
  assert.equal(h.calls.reloads,1);assert.equal(button(page,'采用并生成任务').props.disabled,true);assert.match(text(page),/经营输入已更新.*下方仍为原方案的数据快照/);
  await button(page,'采用并生成任务').props.onClick();assert.deepEqual(h.calls.posts,[]);
  await button(h.render(),'按最新经营数据请模型重算').props.onClick();assert.equal(button(h.render(),'采用并生成任务').props.disabled,false);
  assert.deepEqual(h.calls.posts,[{path:'/api/park-plan',input:{siteId:'demo-hainan',economicScenarioId:'baseline'}}]);
});

test('server economic revision remains visible on saved plans without replacing adopted tasks',()=>{
  const h=harness({...plan,economics:{},economicCheck:{needsRecompute:true,reason:'订单数据已过期，请重新测算。'},adoption:{adoptedAt:at(-10),tasks:[{id:'old-task',zone:'A',date:dates[0],status:'已完成',done:40,count:40}],skipped:[],replacedTaskIds:[]}},{site:'hainan',onTasks:noop});
  const page=h.settle();assert.match(text(page),/订单数据已过期.*已采用任务保持原方案/);assert.match(text(page),/已完成（40\/40）/);assert.ok(button(page,'按最新经营数据请模型重算'));assert.deepEqual(h.calls.posts,[]);
});

test('online legacy and changed-weather plans remain reviewable but cannot be adopted until recomputed',async()=>{
  for(const changed of [{...plan,weather:undefined,weatherCheck:{needsRecompute:true,reason:'此旧方案使用模拟天气，请重新测算。',currentFetchedAt:at(0)}},
    {...plan,weatherCheck:{needsRecompute:true,reason:'作业窗口已经改变，请重新测算。',currentFetchedAt:at(0)}}]){
    const h=harness(changed);const page=h.settle();
    assert.equal(h.calls.posts.length,0,'viewing or polling does not compute or adopt automatically');
    assert.equal(button(page,'采用并生成任务').props.disabled,true);
    assert.ok(button(page,'按最新天气请模型重算'));
    await button(page,'采用并生成任务').props.onClick();assert.equal(h.calls.posts.length,0);
    await button(h.render(),'按最新天气请模型重算').props.onClick();
    assert.deepEqual(h.calls.posts,[{path:'/api/park-plan',input:{siteId:'demo-hainan',economicScenarioId:'baseline'}}]);
    assert.deepEqual(h.calls.postOptions,[{timeoutMs:180_000}],'allow time for the model to correct an inconsistent proposal');
    assert.equal(button(h.render(),'采用并生成任务').props.disabled,false);
  }
});

test('a weather update disables adoption immediately, reloads status and preserves existing tasks',()=>{
  const h=harness();h.settle();h.listeners.get('harness-park-weather-changed')();
  assert.equal(h.calls.reloads,1);assert.equal(button(h.render(),'采用并生成任务').props.disabled,true);
  h.setResponse({...plan,weatherCheck:{needsRecompute:true,reason:'预报变更，请重新测算。',currentFetchedAt:at(0)}});
  assert.equal(button(h.settle(),'采用并生成任务').props.disabled,true);assert.deepEqual(h.calls.posts,[]);
  const adopted={...plan,adoption:{adoptedAt:at(-10),adoptedBy:'manager',skipped:[],replacedTaskIds:[],tasks:[{id:'old-task',zone:'A',date:dates[0],status:'已完成',done:40,count:40}]},weatherCheck:{needsRecompute:true,reason:'天气变更',currentFetchedAt:at(0)}};
  const old=harness(adopted,{site:'hainan',onTasks:noop});const page=old.settle();
  assert.match(text(page),/原任务与回传仍可查看，重新测算不会自动替换任务/);
  assert.ok(button(page,'查看执行与回传'));assert.match(text(page),/已完成（40\/40）/);assert.deepEqual(old.calls.posts,[]);
});

test('ordinary polling and refreshed weather with unchanged decisions do not keep adoption disabled',()=>{
  const h=harness();assert.equal(button(h.settle(),'采用并生成任务').props.disabled,false);
  h.setResponse({...plan,weatherCheck:{needsRecompute:false,reason:null,currentFetchedAt:at(0)}});
  assert.equal(button(h.settle(),'采用并生成任务').props.disabled,false);
  h.listeners.get('harness-park-weather-changed')();
  assert.equal(button(h.render(),'采用并生成任务').props.disabled,true);
  h.setResponse({...plan,weatherCheck:{needsRecompute:false,reason:null,currentFetchedAt:at(1)}});
  assert.equal(button(h.settle(),'采用并生成任务').props.disabled,false);
  assert.deepEqual(h.calls.posts,[]);
});

test('expired API weather cannot expose an adoptable plan before the next poll',()=>{
  const h=harness({...plan,weather:{...plan.weather,validUntil:at(-1)}});const page=h.settle();
  assert.equal(button(page,'采用并生成任务').props.disabled,true);assert.match(text(page),/天气已过期/);
});

test('recomputing a linked historical plan polls the new candidate and never silently returns to the old one',async()=>{
  const h=harness({...plan,id:'historical'},{site:'hainan',planId:'historical'});h.settle();
  await button(h.render(),'请大模型重新生成').props.onClick();h.render();
  assert.equal(h.calls.reads.at(-1).path,'/api/park-plan/recomputed-plan?siteId=demo-hainan');
  assert.equal(h.calls.posts.length,1);assert.equal(h.calls.posts[0].path,'/api/park-plan');
});

test('zero-task pause offers a pause arrangement and uses the same explicit adoption action',async()=>{
  const paused={...plan,stance:'pause',stanceLabel:'暂停',frequencyPerWeek:0,zones:plan.zones.map(zone=>({...zone,frequency:0,dates:[],schedule:[],expectedDryKg:0})),production:{...plan.production,expectedDryKg:0}};
  const h=harness(paused);const page=h.settle();
  assert.ok(button(page,'采用暂停安排'));
  assert.match(text(page),/本方案不新增割胶任务；采用时按冲突确认处理未开始任务，已完成记录保留/);
  assert.doesNotMatch(text(page),/采用并生成分区任务|采用并生成任务|采用后生成分区任务/);
  assert.deepEqual(h.calls.posts,[],'displaying a pause does not apply it');
  await button(page,'采用暂停安排').props.onClick();
  assert.deepEqual(h.calls.posts,[{path:'/api/park-plan/live-plan/adopt',input:{siteId:'demo-hainan',replace:false}}]);
  const adopted={...paused,adoption:{adoptedAt:at(0),adoptedBy:'manager',tasks:[],skipped:[],replacedTaskIds:['old-task']}};
  const content=text(harness(adopted).settle());
  assert.match(content,/已采用暂停安排/);assert.match(content,/已处理旧策略未开始任务 1 项，已完成记录保留/);
  assert.doesNotMatch(content,/生成 0 项分区割胶任务/);
});


test('opening an empty model-plan page never invokes the paid model until the user requests it',async()=>{
  const h=harness(null);const page=h.settle();
  assert.deepEqual(h.calls.posts,[]);assert.match(text(page),/由大模型提出本周割胶策略/);
  await button(page,'请大模型生成策略').props.onClick();
  assert.equal(h.calls.posts.length,1);assert.equal(h.calls.posts[0].path,'/api/park-plan');
});

test('historical rules plans remain visible but cannot be adopted as model proposals',async()=>{
  const legacy={...plan};delete legacy.modelProposal;
  const h=harness(legacy);const page=h.settle();
  assert.match(text(page),/历史规则方案，需由大模型重新生成/);
  assert.equal(button(page,'采用并生成任务').props.disabled,true);
  await button(page,'采用并生成任务').props.onClick();assert.deepEqual(h.calls.posts,[]);
  assert.doesNotMatch(text(page),/合计.*倾向增加割次/);
});

test('model plans use calculated totals instead of displaying unverified model summary as sales guidance',()=>{
  const uncertain={...plan,salesHint:'错误汇总：全园产出 99999 kg'};
  const content=text(harness(uncertain).settle());
  assert.match(content,/预计产出12 kg/);
  assert.match(content,/全园产量与库存由系统按可执行排程测算/);
  assert.doesNotMatch(content,/错误汇总|99999/);
  const legacy={...uncertain};delete legacy.modelProposal;
  assert.match(text(harness(legacy).settle()),/错误汇总：全园产出 99999 kg/,'historical rule descriptions remain reviewable');
});

test('model generation failure retains the prior snapshot without presenting it as a successful new result',async()=>{
  const h=harness(plan,{site:'hainan'},{error:'模型响应超时'});h.settle();
  await button(h.render(),'请大模型重新生成').props.onClick();
  const page=h.render();
  assert.match(text(page),/本次模型未生成新策略：模型响应超时.*上次方案，并非本次生成结果/);
  assert.match(text(page),/预计 12 kg 干胶/);
  assert.equal(button(page,'采用并生成任务').props.disabled,true);
  await button(page,'采用并生成任务').props.onClick();assert.equal(h.calls.posts.length,1);
});

test('an already occupied day is labelled as an existing task rather than rain',()=>{
 const occupied={...plan.zones[0],dates:[],schedule:[],existingTasks:[{id:'sample-a',date:dates[0],status:'待开始',done:0,count:30}]};
 const cell=harness().zoneCells(plan,occupied)[0];
 assert.equal(cell.label,'已排');assert.equal(cell.tap,false);assert.match(cell.reason,/当天已有割胶任务/);
});

test('an adopted plan with no new tasks opens the actual existing work and preserves its original count',async()=>{
 const opened=[],adopted={...plan,adoption:{adoptedAt:at(0),adoptedBy:'manager',tasks:[],replacedTaskIds:[],
  skipped:[{zone:'A',date:dates[0],reason:'该区当天已有割胶任务',taskIds:['sample-a']}],
  existingTasks:[{id:'sample-a',zone:'A',date:dates[0],status:'执行中',done:12,count:30}]}};
 const h=harness(adopted,{site:'hainan',onTasks:id=>opened.push(id)}),page=h.settle();
 assert.match(text(page),/查看本周已有任务/);assert.match(text(page),/保留各自的原方案、树木范围和进度/);
 assert.match(text(page),/执行中（12\/30）/);
 await button(page,'查看执行与回传').props.onClick();
 await button(h.render(),'打开已有A区任务').props.onClick();
 assert.deepEqual(opened,['sample-a','sample-a']);assert.deepEqual(h.calls.posts,[]);
});

test('background production updates do not replace adopted tasks or edited economic conditions',()=>{
 const adopted={...plan,adoption:{adoptedAt:at(0),tasks:[],existingTasks:[],skipped:[],replacedTaskIds:[]}};
 const next={...plan,id:'background-next',generatedAt:at(1),headline:'后台新的割胶安排'};
 const h=harness(adopted);h.settle();h.setResponse(next);
 let page=h.settle();assert.match(text(page),/后台已有新方案/);assert.doesNotMatch(text(page),/后台新的割胶安排/);
 assert.ok(button(page,'查看后台新方案'));
 button(page,'查看后台新方案').props.onClick();page=h.settle();
 assert.match(text(page),/后台新的割胶安排/);assert.equal(h.calls.posts.length,0);
 const editing=harness(plan);editing.settle();button(editing.render(),'保存经营输入（测试）').props.onClick();editing.setResponse(next);
 const edited=editing.settle();assert.match(text(edited),/后台已有新方案/);assert.doesNotMatch(text(edited),/后台新的割胶安排/);
 assert.ok(button(edited,'查看新方案并重置本页选择'));assert.equal(editing.calls.posts.length,0);
});
