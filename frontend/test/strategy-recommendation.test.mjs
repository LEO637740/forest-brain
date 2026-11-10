import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {strategyRecommendation} from '../src/integration/recommendationModel.ts';
import {makeParkContext} from '../../backend/src/adapters/park-demo.js';
import {RuleGenerator} from '../../backend/src/capabilities/rules.js';

const now=new Date('2026-10-19T08:00:00Z'),generator=new RuleGenerator();
async function strategy(kind,treeIds=['T-0001']){
 const context=makeParkContext({treeIds,now});
 return {...await generator.generate({kind,context,now}),kind,siteId:context.siteId,executionMode:'simulation',expiresAt:'2099-01-01T00:00:00Z'};
}
const path=new URL('../src/integration/StrategyRecommendation.tsx',import.meta.url);
const {code}=await transformWithOxc(readFileSync(path,'utf8'),path.pathname,{lang:'tsx',jsx:{runtime:'classic'}});
const node=parseAst(code).body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration.id?.name==='StrategyRecommendation').declaration;
const Recommendation=new Function('React','strategyRecommendation',code.slice(node.start,node.end)+';return StrategyRecommendation;')(React,strategyRecommendation);
const viewsPath=new URL('../src/integration/Views.tsx',import.meta.url);
const views=await transformWithOxc(readFileSync(viewsPath,'utf8'),viewsPath.pathname,{lang:'tsx',jsx:{runtime:'classic'}});
const bodyNode=parseAst(views.code).body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration.id?.name==='StrategyBody').declaration;
const Body=new Function('React','useState','useRef','useEffect','useRead','valid','when','StrategyRecommendation',views.code.slice(bodyNode.start,bodyNode.end)+';return StrategyBody;')(React,React.useState,React.useRef,React.useEffect,()=>({data:{items:[]}}),()=>true,value=>value,Recommendation);

test('angle recommendation exposes the actual proposed angle, local tree alias and adoption condition',async()=>{
 const s=await strategy('tapping_angle');s.siteId='demo-xsbn';
 const result=strategyRecommendation(s);
 assert.ok(result.title.includes(`${s.proposal.recommendedCutSlopeDeg}°`));
 assert.equal(result.target,'XS-A-0001');
 assert.equal(result.timing,'下次割胶前确认');
 assert.ok(result.note.includes('复核后采用'));
 const html=renderToStaticMarkup(React.createElement(Recommendation,{strategy:s}));
 assert.match(html,/推荐策略|待复核 · 模拟|下次割胶前确认/);
 assert.doesNotMatch(html,/snapshot|sourceId|modelVersion|输入完整度/);
});

test('a deferred weather result cannot be summarized as an available work window',async()=>{
 const s=await strategy('weather_window');
 s.proposal.windows=s.proposal.windows.map(w=>({...w,suitability:'defer',reason:'降雨暂缓'}));
 assert.equal(strategyRecommendation(s).title,'暂缓割胶，等待合适天气');
 const chosen={...s.proposal.windows[0],start:'2026-10-19T10:00:00Z',end:'2026-10-19T11:00:00Z',suitability:'suitable',reason:'所选候选时段'};
 s.proposal.windows.push(chosen);
 const summary=strategyRecommendation(s);
 assert.equal(summary.title,'先暂缓割胶，待以下时段再安排');
 assert.ok(summary.timing.includes('18:00'));
 assert.equal(summary.reason,'降雨暂缓');
 s.proposal.windows=[chosen];
 assert.equal(strategyRecommendation(s).title,'建议在以下时段安排割胶');
 assert.equal(strategyRecommendation(s).reason,chosen.reason);
});

test('surface capture precedes avoidance and never describes unregistered evidence as permission to continue',async()=>{
 const s=await strategy('surface_action');
 s.proposal.findings=[{treeId:'T-0001',action:'avoid_with_review',reason:'割线相交'},{treeId:'T-0012',action:'capture',reason:'需重新配准'}];
 assert.equal(strategyRecommendation(s).title,'先补拍树表，再重新配准');
 assert.equal(strategyRecommendation(s).reason,'需重新配准');
 s.proposal.findings.shift();s.proposal.findings[0].action='continue_with_review';
 assert.equal(strategyRecommendation(s).title,'清理并确认后正常割胶');
});

test('zero-frequency and no selected market plan retain distinct next actions',async()=>{
 const s=await strategy('market_scenario');
 s.proposal.scenarios=[{scenarioId:'rest',tappingsPerWeek:0,reason:'需休割'}];s.proposal.recommendedScenarioId='rest';
 assert.equal(strategyRecommendation(s).title,'本周暂不新增割胶');
 s.proposal.recommendedScenarioId=null;
 assert.equal(strategyRecommendation(s).title,'先补齐经营条件，再确定生产频次');
});

test('growth and health results lead with the saved plan and precise inspection scope',async()=>{
 const growth=await strategy('growth_plan');
 assert.equal(strategyRecommendation(growth).title,'换面前先复核割面');
 assert.equal(strategyRecommendation(growth).reason,growth.proposal.futurePanelPlan[0].reason);
 const health=await strategy('pest_risk',['T-0001','T-0012']);
 health.proposal.inspectionTargets=['T-0012'];
 assert.equal(strategyRecommendation(health).title,'优先巡查 1 棵重点树');
 assert.equal(strategyRecommendation(health).target,'HN-A-0012');
 health.proposal.inspectionTargets=[];health.proposal.findings=[];health.proposal.riskAssessments=[];
 assert.equal(strategyRecommendation(health).title,'保持日常巡查');
});

test('expired and withdrawn saved recommendations remain visibly unavailable',async()=>{
 const s=await strategy('tapping_angle');s.expiresAt='2020-01-01T00:00:00Z';
 let html=renderToStaticMarkup(React.createElement(Recommendation,{strategy:s}));
 assert.match(html,/已过期/);
 s.qualityReview={status:'withdrawn'};
 html=renderToStaticMarkup(React.createElement(Recommendation,{strategy:s}));
 assert.match(html,/已撤回/);
});

test('the strategy renderer places the real decision and adoption before closed provenance and factor details',async()=>{
 const s=await strategy('tapping_angle');
 s.generatedAt=now.toISOString();s.reasons=[];s.strategyId='strategy-evidence-hidden';
 s.generationMetadata={provider:'test-provider',model:'model-hidden'};
 const html=renderToStaticMarkup(React.createElement(Body,{s}));
 assert.ok(html.indexOf('推荐策略')<html.indexOf('采用此角度'));
 assert.ok(html.indexOf('采用此角度')<html.indexOf('model-hidden'));
 assert.match(html,/<details class="hb-angle-model"><summary>多因素计算明细/);
 assert.match(html,/<details><summary>为什么这样建议 · 依据与记录/);
 assert.doesNotMatch(html,/<details[^>]*open/);
 assert.match(html,/strategy-evidence-hidden|生成来源：大模型/);
});

function actionHarness(initial,{records=[],readResult={data:{items:records}},save=async()=>{},allowActions=true,treeId}={}){
 const slots=[],calls=[],reads=[];let cursor=0,current=initial,reading=readResult,currentTreeId=treeId;
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];};
 const useRef=initial=>{const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];};
 const invoke=(kind,s,value,treeId)=>{calls.push({kind,strategyId:s.strategyId,value,treeId});return save(kind,s,value,treeId);};
 const bindings={React,useState,useRef,useEffect(){},useRead:path=>{reads.push(path);return reading;},valid:s=>s.qualityReview?.status!=='withdrawn'&&Date.parse(s.expiresAt)>Date.now(),when:value=>value,StrategyRecommendation:()=>null,StrategyEvidence:()=>null,
  adopt:s=>invoke('angle',s),reviewSurface:(s,value,treeId)=>invoke('surface',s,value,treeId),adoptWeather:(s,value)=>invoke('weather',s,value),alias:value=>value,surfaceActionLabels:{review:'待复核'}};
 const Component=new Function(...Object.keys(bindings),views.code.slice(bodyNode.start,bodyNode.end)+';return StrategyBody;')(...Object.values(bindings));
 return {calls,reads,setStrategy(next){current=next;},setTreeId(next){currentTreeId=next;},setReadResult(next){reading=next;},render(){cursor=0;return Component({s:current,allowActions,treeId:currentTreeId});}};
}
function actionElements(node,predicate){return React.isValidElement(node)?[...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>actionElements(child,predicate))]:[];}
const actionText=node=>typeof node==='string'||typeof node==='number'?String(node):React.isValidElement(node)?React.Children.toArray(node.props.children).map(actionText).join(''):'';
const actionButton=(tree,label)=>actionElements(tree,node=>node.type==='button'&&actionText(node)===label)[0];
const actionBase={siteId:'demo-xsbn',strategyId:'action-test',generatedAt:'2026-10-23T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',reasons:[],revision:1};
const angleAction={...actionBase,kind:'tapping_angle',proposal:{treeId:'T-0001',conditions:[]}};
const surfaceAction={...actionBase,kind:'surface_action',proposal:{findings:[{treeId:'T-0012',detectionId:'surface',action:'review',reason:'割线待复核'}]}};
const weatherAction={...actionBase,kind:'weather_window',proposal:{windows:[{start:'2099-01-01T01:00:00Z',end:'2099-01-01T02:00:00Z',suitability:'suitable',reason:'候选时段'},{start:'2099-01-01T03:00:00Z',end:'2099-01-01T04:00:00Z',suitability:'suitable',reason:'另一时段'}]}};

test('adoption blocks rapid repeat clicks and old handlers after success, and resets for another strategy',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const h=actionHarness(angleAction,{save:()=>pending}),button=actionButton(h.render(),'采用此角度');
 const first=button.props.onClick();await button.props.onClick();
 assert.equal(h.calls.length,1);
 assert.equal(actionButton(h.render(),'正在保存…').props.disabled,true);
 finish();await first;
 assert.equal(actionButton(h.render(),'已采用此角度').props.disabled,true);
 await button.props.onClick();assert.equal(h.calls.length,1);
 h.setStrategy({...angleAction,strategyId:'next-angle'});
 assert.equal(actionButton(h.render(),'采用此角度').props.disabled,false);
 assert.doesNotMatch(actionText(h.render()),/已采用，用于该树后续模拟作业/);
});

test('failed surface saves can retry and switching the saved disposition remains available',async()=>{
 let attempts=0;
 const h=actionHarness(surfaceAction,{save:async()=>{if(attempts++===0)throw Error('网络暂时不可用');}});
 await actionButton(h.render(),'保存放行结果').props.onClick();
 assert.match(actionText(h.render()),/网络暂时不可用/);
 assert.equal(actionButton(h.render(),'保存放行结果').props.disabled,false);
 await actionButton(h.render(),'保存放行结果').props.onClick();
 assert.equal(actionButton(h.render(),'已保存放行结果').props.disabled,true);
 assert.equal(actionButton(h.render(),'保存跳过结果').props.disabled,false);
 await actionButton(h.render(),'保存跳过结果').props.onClick();
 assert.equal(actionButton(h.render(),'已保存跳过结果').props.disabled,true);
 assert.equal(actionButton(h.render(),'保存放行结果').props.disabled,false);
 assert.deepEqual(h.calls.map(call=>call.value),['allow','allow','skip']);
 assert.doesNotMatch(actionText(h.render()),/并正常作业|正常作业分支继续/);
});

test('a single-tree surface view only displays and reviews that tree from a shared strategy',async()=>{
 const batch={...surfaceAction,proposal:{findings:[{treeId:'T-0004',detectionId:'other',action:'review',reason:'另一棵树的标记'},...surfaceAction.proposal.findings]}};
 const normal=actionHarness(batch,{treeId:'T-0001'});
 assert.equal(actionButton(normal.render(),'保存放行结果'),undefined);
 assert.match(actionText(normal.render()),/树表处理明细 · 0 项/);
 assert.doesNotMatch(actionText(normal.render()),/另一棵树的标记|割线待复核/);
 const marked=actionHarness(batch,{treeId:'T-0012'});
 assert.match(actionText(marked.render()),/树表处理明细 · 1 项/);
 assert.doesNotMatch(actionText(marked.render()),/另一棵树的标记/);
 await actionButton(marked.render(),'保存放行结果').props.onClick();
 assert.equal(marked.calls[0].treeId,'T-0012');
 assert.equal(marked.reads[0],'/api/simulation/actions?siteId=demo-xsbn&treeId=T-0012');
});

test('batch surface reviews require a selected tree and keep saved states separate per tree',async()=>{
 const batch={...surfaceAction,proposal:{findings:[...surfaceAction.proposal.findings,{treeId:'T-0006',detectionId:'second',action:'review',reason:'本树待复核'}]}};
 const h=actionHarness(batch);
 assert.equal(actionButton(h.render(),'保存放行结果'),undefined);
 const selector=()=>actionElements(h.render(),node=>node.type==='select'&&node.props['aria-label']==='树表复核对象')[0];
 selector().props.onChange({target:{value:'T-0012'}});
 await actionButton(h.render(),'保存放行结果').props.onClick();
 assert.equal(actionButton(h.render(),'已保存放行结果').props.disabled,true);
 selector().props.onChange({target:{value:'T-0006'}});
 assert.equal(actionButton(h.render(),'保存放行结果').props.disabled,false);
 await actionButton(h.render(),'保存放行结果').props.onClick();
 assert.deepEqual(h.calls.map(call=>call.treeId),['T-0012','T-0006']);
});

test('a review record for another tree or site does not make the current surface appear released',()=>{
 for(const patch of [{treeId:'T-0004',siteId:'demo-xsbn'},{treeId:'T-0012',siteId:'demo-hainan'}]){
  const h=actionHarness(surfaceAction,{records:[{kind:'surface_review',strategyId:surfaceAction.strategyId,disposition:'allow',...patch}]});
  assert.equal(actionButton(h.render(),'保存放行结果').props.disabled,false);
  assert.equal(actionButton(h.render(),'已保存放行结果'),undefined);
 }
});

test('matching saved actions restore adopted states and read-only weather hides every adoption control',async()=>{
 const firstWindow=weatherAction.proposal.windows[0].start;
 for(const [s,record,label] of [[angleAction,{kind:'adopt_angle'},'已采用此角度'],[surfaceAction,{kind:'surface_review',treeId:'T-0012',siteId:'demo-xsbn',disposition:'allow'},'已保存放行结果'],[weatherAction,{kind:'adopt_weather',start:firstWindow},'已用于后续作业']]){
  const h=actionHarness(s,{records:[{...record,strategyId:'another-strategy'},{...record,strategyId:s.strategyId}]});
  assert.equal(actionButton(h.render(),label).props.disabled,true);
  assert.deepEqual(h.reads,[s.kind==='tapping_angle'?'/api/simulation/actions?siteId=demo-xsbn&treeId=T-0001':s.kind==='surface_action'?'/api/simulation/actions?siteId=demo-xsbn&treeId=T-0012':'/api/simulation/actions?siteId=demo-xsbn']);
  await actionButton(h.render(),label).props.onClick();assert.equal(h.calls.length,0);
 }
 const viewer=actionHarness(weatherAction,{allowActions:false});
 assert.equal(actionElements(viewer.render(),node=>node.type==='button').length,0);
 for(const patch of [{expiresAt:'2000-01-01T00:00:00Z'},{qualityReview:{status:'withdrawn'}}]){
  assert.equal(actionElements(actionHarness({...angleAction,...patch}).render(),node=>node.type==='button').length,0);
 }
});

test('weather primary and detail buttons share a save lock while another suitable window can replace it',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const h=actionHarness(weatherAction,{save:()=>pending}),tree=h.render();
 const first=actionButton(tree,'用于后续作业').props.onClick();
 await actionButton(tree,'采用此时段').props.onClick();
 assert.equal(h.calls.length,1);
 assert.ok(actionElements(h.render(),node=>node.type==='button').every(button=>button.props.disabled));
 finish();await first;
 const applied=actionElements(h.render(),node=>node.type==='button'&&actionText(node)==='已用于后续作业');
 assert.equal(applied.length,2);assert.ok(applied.every(button=>button.props.disabled));
 await actionButton(h.render(),'采用此时段').props.onClick();
 assert.deepEqual(h.calls.map(call=>call.value),weatherAction.proposal.windows.map(item=>item.start));
 assert.equal(actionButton(h.render(),'用于后续作业').props.disabled,false);
});


test('initial action reads disable every adoption button until records arrive, while read failures allow saving',async()=>{
 for(const [s,record,ready,saved] of [[angleAction,{kind:'adopt_angle'},'采用此角度','已采用此角度'],[surfaceAction,{kind:'surface_review',treeId:'T-0012',siteId:'demo-xsbn',disposition:'allow'},'保存放行结果','已保存放行结果'],[weatherAction,{kind:'adopt_weather',start:weatherAction.proposal.windows[0].start},'用于后续作业','已用于后续作业']]){
  const h=actionHarness(s,{readResult:{}});
  const buttons=actionElements(h.render(),node=>node.type==='button');
  assert.ok(buttons.length>0);
  for(const button of buttons){assert.equal(actionText(button),'正在读取…');assert.equal(button.props.disabled,true);await button.props.onClick();}
  assert.equal(h.calls.length,0);
  h.setReadResult({data:{items:[{...record,strategyId:s.strategyId}]}});
  assert.equal(actionButton(h.render(),saved).props.disabled,true);
  await actionButton(h.render(),saved).props.onClick();assert.equal(h.calls.length,0);
  const failed=actionHarness(s,{readResult:{error:'读取失败 (503)'}});
  assert.equal(actionButton(failed.render(),ready).props.disabled,false);
  await actionButton(failed.render(),ready).props.onClick();assert.equal(failed.calls.length,1);
  assert.equal(actionButton(failed.render(),saved).props.disabled,true);
 }
});
