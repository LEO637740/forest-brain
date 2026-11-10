import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transformWithOxc,parseAst} from 'vite';
import {eventHoldForZone} from '../src/workspace/operationalEvents.ts';
import {weatherTimingFor,withLiveWeather} from '../src/integration/weatherConstraints.ts';

const source=await readFile(new URL('../src/integration/client.ts',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'client.ts',{lang:'ts'});
const names=new Set(['FLEET_SITE_ID','siteIdOf','liveWeatherBySite','weatherErrorsBySite','siteWeatherBlock','weatherFailure','currentOperationalEvents','requireFleetSite','adoptionKey','verifyDispatch','reviewSurface','weatherTiming','refreshWeather']);
const nodes=parseAst(compiled.code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node).filter(Boolean).filter(node=>node.type==='FunctionDeclaration'?names.has(node.id?.name):node.type==='VariableDeclaration'&&node.declarations.some(item=>names.has(item.id.name)));
const found=nodes.flatMap(node=>node.type==='FunctionDeclaration'?[node.id.name]:node.declarations.map(item=>item.id.name));
for(const name of names)assert.ok(found.includes(name),`Compiled ${name} from the browser client`);
const code=nodes.map(node=>compiled.code.slice(node.start,node.end)).join('\n');
const now=Date.parse('2026-10-17T00:00:00.000Z');
const future=new Date(now+60000).toISOString();
const tree={treeId:'T-0001',siteId:'demo-hainan',tappingStatus:'active',circumferenceCm:50};
const view=kind=>({siteId:'demo-hainan',tree,strategyStatus:'available',strategy:{siteId:'demo-hainan',kind,strategyId:kind,expiresAt:future,proposal:{findings:[]}}});
const runtime=(options={})=>{
 const calls=[],storage=new Map(options.cache?[['harness-weather-v1',JSON.stringify(options.cache)]]:[]);
 const localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
 const read=async path=>{
  calls.push(path);const url=new URL(path,'http://test.invalid');
  if(url.pathname==='/api/simulation/constraints'){
   if(options.weatherError)throw Error('offline');
   return {liveWeather:options.liveWeather,constraints:options.constraints??[],operationalEvents:options.events??[],checkedAt:new Date(now).toISOString()};
  }
  if(url.pathname==='/api/simulation/actions')return {items:options.actions??[]};
  const kind=url.searchParams.get('kind');return options.views?.[kind]??view(kind);
 };
 const api=new Function('binding','read','valid','alias','adoption','DATA_MODE','localStorage','weatherTimingFor','withLiveWeather','eventHoldForZone','Date','currentAccount','post','crypto',code+'\nreturn {verifyDispatch,reviewSurface,weatherTiming,refreshWeather,siteWeatherBlock};')(
  index=>({treeId:`T-${String(index+1).padStart(4,'0')}`}),read,s=>s.qualityReview?.status!=='withdrawn'&&Date.parse(s.expiresAt)>now,id=>id,()=>options.adoption,'demo',localStorage,weatherTimingFor,(timing,weather)=>withLiveWeather(timing,weather,now),eventHoldForZone,{now:()=>now,parse:Date.parse},()=>options.account??null,async(path,input)=>{calls.push({path,input});return input;},{randomUUID:()=>"review-request"}
 );
 return {...api,calls,storage};
};

test('browser dispatch reads explicitly scoped Hainan weather, surfaces, angles and actions',async()=>{
 const app=runtime();
 const views=await app.verifyDispatch([0]);
 assert.equal(views.length,1);
 assert.equal(app.calls.length,4);
 for(const path of app.calls)assert.equal(new URL(path,'http://test.invalid').searchParams.get('siteId'),'demo-hainan');
});

test('browser dispatch rejects foreign surface and angle views before adoption can be cached',async()=>{
 for(const kind of ['surface_action','tapping_angle']){
  const app=runtime({views:{[kind]:{...view(kind),siteId:'demo-xsbn'}}});
  await assert.rejects(app.verifyDispatch([0]),/不属于当前园区/);
  assert.equal(app.storage.has('harness-adoptions-v1'),false);
 }
});

test('browser dispatch cannot use foreign reviews or a mismatched persisted adoption',async()=>{
 const marked={...view('surface_action'),strategy:{...view('surface_action').strategy,proposal:{findings:[{treeId:'T-0001'}]}}};
 const actions=[{kind:'surface_review',strategyId:'surface_action',siteId:'demo-xsbn',disposition:'allow',expiresAt:future}];
 await assert.rejects(runtime({views:{surface_action:marked},actions}).verifyDispatch([0]),/存在树表标记/);
 await assert.rejects(runtime({adoption:{siteId:'demo-xsbn',strategyId:'tapping_angle',expiresAt:future}}).verifyDispatch([0]),/不属于当前园区/);
});

test('a shared surface strategy does not require normal trees to review another tree finding',async()=>{
 const marked={...view('surface_action'),strategy:{...view('surface_action').strategy,proposal:{findings:[{treeId:'T-0004'},{treeId:'T-0006'}]}}};
 const app=runtime({views:{surface_action:marked}});
 assert.equal((await app.verifyDispatch([0])).length,1);
 assert.equal(app.calls.filter(path=>typeof path==='string'&&path.includes('/actions?')).length,1,'only the angle-adoption read is needed');
});

test('the current tree finding still needs its own current strategy review',async()=>{
 const marked={...view('surface_action'),strategy:{...view('surface_action').strategy,proposal:{findings:[{treeId:'T-0006'},{treeId:'T-0001'}]}}};
 const allow={kind:'surface_review',treeId:'T-0001',siteId:'demo-hainan',strategyId:'surface_action',disposition:'allow',expiresAt:future};
 for(const actions of [[],[{...allow,treeId:'T-0006'}],[{...allow,strategyId:'old'}],[{...allow,expiresAt:new Date(now).toISOString()}],[{...allow,disposition:'skip'}]]){
  await assert.rejects(runtime({views:{surface_action:marked},actions}).verifyDispatch([0]),/存在树表标记|已复核跳过/);
 }
 assert.equal((await runtime({views:{surface_action:marked},actions:[allow]}).verifyDispatch([0])).length,1);
});

test('another tree in the requested surface view or an expired surface strategy stays blocked',async()=>{
 await assert.rejects(runtime({views:{surface_action:{...view('surface_action'),tree:{...tree,treeId:'T-0006'}}}}).verifyDispatch([0]),/树木对象不一致/);
 await assert.rejects(runtime({views:{surface_action:{...view('surface_action'),strategy:{...view('surface_action').strategy,expiresAt:new Date(now).toISOString()}}}}).verifyDispatch([0]),/树表建议尚不可用/);
});

test('surface review submissions name the selected tree and reject ambiguous or unrelated targets',async()=>{
 const batch={...view('surface_action').strategy,proposal:{findings:[{treeId:'T-0004'},{treeId:'T-0006'}]}};
 const app=runtime();
 await assert.rejects(app.reviewSurface(batch,'allow'),/请选择要复核的树/);
 await assert.rejects(app.reviewSurface(batch,'allow','T-0001'),/当前树没有/);
 assert.equal(app.calls.length,0);
 const saved=await app.reviewSurface(batch,'skip','T-0006');
 assert.equal(saved.treeId,'T-0006');assert.equal(saved.disposition,'skip');assert.equal(saved.siteId,'demo-hainan');
 assert.equal(app.calls.length,1);
 const single={...batch,proposal:{findings:[{treeId:'T-0006'},{treeId:'T-0006'}]}};
 assert.equal((await app.reviewSurface(single,'allow')).treeId,'T-0006');
 await assert.rejects(app.reviewSurface({...batch,expiresAt:new Date(now).toISOString()},'allow','T-0006'),/建议已失效/);
});

test('browser weather cache reader ignores another site and keeps expired Hainan constraints blocking',()=>{
 const valid={kind:'adopt_weather',siteId:'demo-xsbn',treeIds:['T-0001'],start:new Date(now-60000).toISOString(),end:future,expiresAt:future};
 const app=runtime({cache:[valid,{...valid,siteId:'demo-hainan',end:new Date(now).toISOString()}]});
 assert.match(app.weatherTiming(0).weatherBlock,/过期/);
});

test('browser weather refresh failure remains blocking and malformed cache is not accepted',async()=>{
 const app=runtime({weatherError:true});
 await assert.rejects(app.refreshWeather(),/offline/);
 assert.match(app.weatherTiming(0).weatherBlock,/核验失败/);
 const broken=runtime();broken.storage.set('harness-weather-v1','{');
 assert.match(broken.weatherTiming(0).weatherBlock,/记录不可用/);
});

const operationalEvent = (patch={}) => ({id:'event-rain',siteId:'demo-hainan',kind:'rain',zone:0,status:'active',note:'现场确认降雨',createdAt:new Date(now).toISOString(),mode:'simulation',...patch});
test('current events block baseline dispatch without requiring a weather adoption',async()=>{
 for(const status of ['active','resolved']){
  const app=runtime({events:[operationalEvent({status})]});
  await assert.rejects(app.verifyDispatch([0]),/现场确认降雨/);
  assert.equal(app.calls.length,1,'stop before unrelated strategy reads');
  assert.equal(app.weatherTiming(50).weatherBlock,undefined,'another zone is available');
 }
 const app=runtime({events:[operationalEvent({status:'closed'})]});
 assert.equal((await app.verifyDispatch([0])).length,1);
});
test('recovery retains other events and the previously adopted weather window',async()=>{
 const options={events:[operationalEvent({status:'closed'}),operationalEvent({id:'fault',kind:'device_fault',note:'割胶头维修'})],constraints:[{kind:'adopt_weather',siteId:'demo-hainan',treeIds:['T-0001'],start:new Date(now-60000).toISOString(),end:new Date(now).toISOString(),expiresAt:future}]};
 const app=runtime(options);await app.refreshWeather();assert.match(app.weatherTiming(0).weatherBlock,/割胶头维修/);
 options.events=options.events.map(event=>({...event,status:'closed'}));await app.refreshWeather();
 assert.match(app.weatherTiming(0).weatherBlock,/过期/);
 assert.equal(app.storage.has('operational-events'),false);
});

test('accounts of other parks do not poll the Hainan fleet weather constraints',async()=>{
 const other=runtime({account:{accountId:'manager-xs',siteIds:['demo-xsbn']}});
 await other.refreshWeather();
 assert.deepEqual(other.calls,[]);
 const hainan=runtime({account:{accountId:'manager-hn',siteIds:['demo-hainan']}});
 await hainan.refreshWeather();
 assert.ok(hainan.calls.some(path=>path.startsWith('/api/simulation/constraints?siteId=demo-hainan')));
});


test('live local rain blocks dispatch without a previously adopted weather strategy',async()=>{
 const app=runtime({liveWeather:{enabled:true,allowed:false,reason:'时段降雨 8 mm，暂缓割胶'}});
 await assert.rejects(app.verifyDispatch([0]),/降雨 8 mm/);
 assert.equal(app.calls.length,1);
 assert.match(app.siteWeatherBlock('hainan'),/降雨 8 mm/);
});
test('fresh weather in another park does not authorize an unchecked park',async()=>{
 const app=runtime({liveWeather:{enabled:true,allowed:true,windowEnd:future,validUntil:future}});
 assert.match(app.siteWeatherBlock('xsbn'),/正在核验/);
 await app.refreshWeather('xsbn');
 assert.equal(app.siteWeatherBlock('xsbn'),undefined);
 assert.match(app.siteWeatherBlock('hainan'),/正在核验/);
});
