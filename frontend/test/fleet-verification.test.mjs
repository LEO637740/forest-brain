import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFleetJobWith} from '../src/integration/fleetVerification.ts';

const now=Date.parse('2026-10-17T00:00:00.000Z');
const expiresAt=new Date(now+60000).toISOString();
const source={treeId:'T-0001',strategyId:'angle-one',runId:'run-one',revision:1,angle:30,expiresAt,adoptedAt:new Date(now).toISOString(),mode:'simulation',dataMode:'demo'};
const job={id:'rail-one',planVersion:'harness-1',angle:30,requestedAt:new Date(now).toISOString(),harnessSource:source};
const view=()=>({tree:{treeId:'T-0001',tappingStatus:'active',circumferenceCm:50},strategyStatus:'available',strategy:{strategyId:'surface-one',kind:'surface_action',expiresAt,proposal:{findings:[]}}});
const makeDeps=(options={})=>{
 const calls=[];
 return {calls,deps:{
  refreshWeather:async()=>{calls.push({operation:'refresh'});if(options.refreshError)throw Error(options.refreshError);},
  weatherTiming:()=>options.timing??{},
  treeId:()=>options.treeId===null?undefined:'T-0001',
  dataMode:'mixed_demo',siteId:options.siteId,now:()=>now,
  post:async(path,input)=>{calls.push({operation:'post',path,input});return options.validity??{items:[{treeId:'T-0001',strategyId:'angle-one',valid:true}]};},
  read:async path=>{calls.push({operation:'read',path});return path.includes('/view?')?options.view??view():{items:options.actions??[]};},
 }};
};

test('normal cut verifies weather, source and surface through the production core in order',async()=>{
 const {deps,calls}=makeDeps();
 assert.deepEqual(await verifyFleetJobWith(0,job,deps),{notBefore:undefined,notAfter:undefined,weatherBlock:''});
 assert.deepEqual(calls.map(call=>call.operation),['refresh','post','read']);
 assert.equal(calls[1].path,'/api/simulation/strategy-validity');
 assert.deepEqual(calls[1].input,{strategies:[{...source,siteId:'demo-hainan',dataMode:'demo'}]});
 assert.equal(calls[2].path,'/api/demo/trees/T-0001/view?kind=surface_action&dataMode=demo&siteId=demo-hainan');
 const baseline=makeDeps();
 await verifyFleetJobWith(0,{...job,harnessSource:undefined},baseline.deps);
 assert.deepEqual(baseline.calls.map(call=>call.operation),['refresh','read']);
 assert.match(baseline.calls[1].path,/dataMode=mixed_demo&siteId=demo-hainan$/);
});

test('missing, unavailable, expired and withdrawn surface strategies cannot start cutting',async()=>{
 for(const surface of [
  {...view(),strategy:null},
  {...view(),strategyStatus:'needs_generation'},
  {...view(),strategy:{...view().strategy,expiresAt:new Date(now).toISOString()}},
  {...view(),strategy:{...view().strategy,qualityReview:{status:'withdrawn'}}},
 ])await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:surface}).deps),/树表策略不可用/);
});

test('surface findings require an unexpired allow review for that exact strategy',async()=>{
 const surface={...view(),strategy:{...view().strategy,proposal:{findings:[{treeId:'T-0001'}]}}};
 const allow={kind:'surface_review',treeId:'T-0001',strategyId:'surface-one',disposition:'allow',expiresAt};
 for(const actions of [[],[{...allow,disposition:'skip'}],[{...allow,strategyId:'surface-other'}],[{...allow,expiresAt:new Date(now).toISOString()}]]){
  await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:surface,actions}).deps),/树表异常尚未复核放行/);
 }
 const accepted=makeDeps({view:surface,actions:[allow]});
 await verifyFleetJobWith(0,job,accepted.deps);
 assert.equal(accepted.calls.at(-1).path,'/api/simulation/actions?treeId=T-0001&siteId=demo-hainan');
});

test('cut-boundary checks ignore other trees in shared findings and never borrow their reviews',async()=>{
 const other={...view(),strategy:{...view().strategy,proposal:{findings:[{treeId:'T-0004'},{treeId:'T-0006'}]}}};
 const normal=makeDeps({view:other});
 await verifyFleetJobWith(0,job,normal.deps);
 assert.equal(normal.calls.filter(call=>call.path?.includes('/actions?')).length,0);
 const marked={...other,strategy:{...other.strategy,proposal:{findings:[...other.strategy.proposal.findings,{treeId:'T-0001'}]}}};
 const foreignTreeReview={kind:'surface_review',treeId:'T-0006',strategyId:'surface-one',disposition:'allow',expiresAt};
 await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:marked,actions:[foreignTreeReview]}).deps),/树表异常尚未复核放行/);
 await verifyFleetJobWith(0,job,makeDeps({view:marked,actions:[{...foreignTreeReview,treeId:'T-0001'}]}).deps);
});

test('a surface view for the wrong tree cannot authorize a cut',async()=>{
 const wrongTree={...view(),tree:{...view().tree,treeId:'T-0006'}};
 await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:wrongTree}).deps),/树木对象不一致/);
});

test('weather blocks, future windows and refresh failures stop before reading strategies',async()=>{
 for(const [options,message] of [
  [{timing:{weatherBlock:'下雨暂缓'}},/下雨暂缓/],
  [{timing:{notBefore:now+1}},/尚未到已采用的天气窗口/],
  [{timing:{notAfter:now}},/天气窗口已失效/],
  [{timing:{notAfter:NaN}},/天气窗口已失效/],
  [{refreshError:'weather offline'},/weather offline/],
 ]){
  const {deps,calls}=makeDeps(options);
  await assert.rejects(verifyFleetJobWith(0,job,deps),message);
  assert.deepEqual(calls.map(call=>call.operation),['refresh']);
 }
});

test('successful recovery returns fresh weather bounds without changing the original job',async()=>{
 const timing={notBefore:now-1000,notAfter:now+5000};
 const original={...job,weatherBlock:'旧连接错误',notBefore:now+30000,notAfter:now-1};
 const before=structuredClone(original);
 const result=await verifyFleetJobWith(0,original,makeDeps({timing}).deps);
 assert.deepEqual(result,{...timing,weatherBlock:''});
 assert.deepEqual(original,before);
});

for(const expires of ['weather','strategy'])test(`a ${expires} expiry while awaiting service responses cannot authorize recovery`,async()=>{
 let current=now;
 const {deps}=makeDeps({timing:expires==='weather'?{notAfter:now+1000}:{}});
 deps.now=()=>current;
 const read=deps.read;
 deps.read=async path=>{const result=await read(path);current=now+(expires==='weather'?1000:60000);return {...result,strategy:{...result.strategy,expiresAt:new Date(now+120000).toISOString()}};};
 await assert.rejects(verifyFleetJobWith(0,job,deps),expires==='weather'?/天气窗口已失效/:/已采用策略过期/);
});

test('a surface strategy expiring while its allow review is loading cannot authorize recovery',async()=>{
 let current=now;
 const surface={...view(),strategy:{...view().strategy,expiresAt:new Date(now+1000).toISOString(),proposal:{findings:[{treeId:'T-0001'}]}}};
 const {deps}=makeDeps({view:surface,actions:[{kind:'surface_review',treeId:'T-0001',strategyId:'surface-one',disposition:'allow',expiresAt}]});
 deps.now=()=>current;
 const read=deps.read;
 deps.read=async path=>{const result=await read(path);if(path.includes('/actions?'))current+=1000;return result;};
 await assert.rejects(verifyFleetJobWith(0,job,deps),/树表策略不可用/);
});

test('expired, withdrawn or mismatched adopted sources cannot pass validity',async()=>{
 const expired=makeDeps();
 await assert.rejects(verifyFleetJobWith(0,{...job,harnessSource:{...source,expiresAt:new Date(now).toISOString()}},expired.deps),/已采用策略过期/);
 assert.deepEqual(expired.calls.map(call=>call.operation),['refresh']);
 for(const [items,message] of [
  [[{treeId:'T-0001',strategyId:'angle-one',valid:false,reason:'策略已撤回'}],/策略已撤回/],
  [[{treeId:'T-0002',strategyId:'angle-one',valid:true}],/策略无法核验/],
  [[{treeId:'T-0001',strategyId:'angle-other',valid:true}],/策略无法核验/],
 ]){
  const {deps,calls}=makeDeps({validity:{items}});
  await assert.rejects(verifyFleetJobWith(0,job,deps),message);
  assert.deepEqual(calls.map(call=>call.operation),['refresh','post']);
 }
});

test('missing mapping, resting trees and missing circumference remain cut-boundary gates',async()=>{
 await assert.rejects(verifyFleetJobWith(0,job,makeDeps({treeId:null}).deps),/未找到树位映射/);
 for(const patch of [{tappingStatus:'resting'},{circumferenceCm:null}]){
  await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:{...view(),tree:{...view().tree,...patch}}}).deps),/当前树木休割或缺少树围/);
 }
});

test('an adopted source from another site is rejected before any service request',async()=>{
 const {deps,calls}=makeDeps();
 await assert.rejects(verifyFleetJobWith(0,{...job,harnessSource:{...source,siteId:'demo-xsbn'}},deps),/已采用策略不属于当前园区/);
 assert.deepEqual(calls,[]);
});

test('explicit site scope is carried through source validity, surface and review requests',async()=>{
 const siteId='demo-xsbn';
 const surface={...view(),siteId,tree:{...view().tree,siteId},strategy:{...view().strategy,siteId,proposal:{findings:[{treeId:'T-0001'}]}}};
 const {deps,calls}=makeDeps({siteId,view:surface,actions:[{kind:'surface_review',treeId:'T-0001',strategyId:'surface-one',siteId,disposition:'allow',expiresAt}]});
 await verifyFleetJobWith(0,{...job,harnessSource:{...source,siteId}},deps);
 assert.equal(calls[1].input.strategies[0].siteId,siteId);
 assert.ok(calls.filter(call=>call.operation==='read').every(call=>new URL(call.path,'http://test.invalid').searchParams.get('siteId')===siteId));
});

test('surface site, tree site and strategy site must match the selected site when provided',async()=>{
 for(const surface of [
  {...view(),siteId:'demo-xsbn'},
  {...view(),tree:{...view().tree,siteId:'demo-xsbn'}},
  {...view(),strategy:{...view().strategy,siteId:'demo-xsbn'}},
 ])await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:surface}).deps),/树表策略不属于当前园区/);
});

test('a valid response from another site cannot authorize the current adopted source',async()=>{
 const validity={items:[{treeId:'T-0001',strategyId:'angle-one',siteId:'demo-xsbn',valid:true}]};
 const {deps,calls}=makeDeps({validity});
 await assert.rejects(verifyFleetJobWith(0,job,deps),/策略无法核验/);
 assert.deepEqual(calls.map(call=>call.operation),['refresh','post']);
});

test('an allow review from another site cannot release a surface finding',async()=>{
 const surface={...view(),strategy:{...view().strategy,proposal:{findings:[{treeId:'T-0001'}]}}};
 const actions=[{kind:'surface_review',treeId:'T-0001',strategyId:'surface-one',siteId:'demo-xsbn',disposition:'allow',expiresAt}];
 await assert.rejects(verifyFleetJobWith(0,job,makeDeps({view:surface,actions}).deps),/树表异常尚未复核放行/);
});
