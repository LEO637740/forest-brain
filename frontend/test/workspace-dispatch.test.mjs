import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eventHoldForTask,eventHoldForZone} from '../src/workspace/operationalEvents.ts';
import {advanceDemo} from '../src/workspace/taskFlow.ts';
import {transformWithOxc,parseAst} from 'vite';

// Extract and execute the application's actual callbacks. The controller's own
// tests exercise dispatch races; these tests protect its React wiring.
const source=readFileSync(new URL('../src/workspace/WorkspaceApp.tsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source,'WorkspaceApp.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const component=parseAst(code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
 .find(node=>node?.type==='FunctionDeclaration'&&node.id.name==='WorkspaceApp');
assert.ok(component);
function walk(node,predicate){
 if(!node||typeof node!=='object')return [];
 const found=predicate(node)?[node]:[];
 for(const value of Object.values(node)){
  if(Array.isArray(value))for(const item of value)found.push(...walk(item,predicate));
  else if(value&&typeof value==='object')found.push(...walk(value,predicate));
 }
 return found;
}
const hasIdentifier=(node,name)=>walk(node,item=>item.type==='Identifier'&&item.name===name).length>0;
const methodCalls=(node,name)=>walk(node,item=>item.type==='CallExpression'&&item.callee.type==='MemberExpression'&&item.callee.property.name===name);
const expression=(node,dependencies={})=>new Function(...Object.keys(dependencies),`return (${code.slice(node.start,node.end)});`)(...Object.values(dependencies));
function declaration(name){
 const node=component.body.body.flatMap(node=>node.type==='VariableDeclaration'?node.declarations:[]).find(node=>node.id.name===name);
 assert.ok(node,`${name} remains a workspace dispatch entry`);return node;
}
function controllerRef(node,method){
 const call=methodCalls(node,method)[0];assert.ok(call,`delegates ${method} to the dispatch controller`);
 const object=call.callee.object;assert.equal(object.type,'MemberExpression');assert.equal(object.property.name,'current');
 return object.object.name;
}
const effects=component.body.body.flatMap(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&node.expression.callee.name==='useEffect'?[node.expression]:[]);

for(const [entry,method,input,expected] of [
 ['queueTrees','queueTrees',[0,51],[0,51]],
 ['startRailBatch','startBatch',{id:'batch-current',revision:2},'batch-current'],
 ['retryRailTask','retry',{id:'rail-current',revision:3},'rail-current'],
]){
 test(`${entry} delegates its intent to the current controller`,async()=>{
  const node=declaration(entry),refName=controllerRef(node,method),calls=[];
  const ref={current:{[method]:async value=>{calls.push(value);}}};
  const invoke=expression(node.init,{[refName]:ref});
  await invoke(input);assert.deepEqual(calls,[expected]);
  const replacement=[];ref.current={[method]:async value=>{replacement.push(value);}};
  await invoke(input);assert.deepEqual(replacement,[expected]);
  ref.current=null;await assert.doesNotReject(async()=>invoke(input));
 });
}

test('automatic planning reads the latest saved tasks and fleet on every tick',async()=>{
 const effect=effects.find(node=>hasIdentifier(node.arguments[0],'findDueRailTask'));
 assert.ok(effect,'automatic planning uses the shared due-task selector');
 const oldTask={id:'stale-render'},first={id:'latest-first'},second={id:'latest-second'};
 const savedRef={current:{tasks:[first]}},planned=[],selected=[],cleared=[];
 let snapshot={ready:true,jobs:{},label:'first'},tick;
 const dependencies={
  eventsRef:{current:[]},eventHoldForTask,hydrated:true,fleetEnabled:true,planning:{current:false},saved:{tasks:[oldTask]},savedRef,
  getFleetSnapshot:()=>snapshot,
  findDueRailTask:(tasks,fleet)=>{selected.push({tasks,fleet});return tasks[0];},
  startRailBatch:async task=>{planned.push(task.id);},
  setInterval:callback=>{tick=callback;return 42;},clearInterval:id=>cleared.push(id),
 };
 const direct=methodCalls(effect.arguments[0],'startBatch')[0];
 if(direct)dependencies[controllerRef(effect.arguments[0],'startBatch')]={current:{startBatch:async id=>planned.push(id)}};
 const cleanup=expression(effect.arguments[0],dependencies)();assert.equal(typeof tick,'function');
 await tick();assert.deepEqual(planned,['latest-first']);assert.deepEqual(selected[0].tasks,savedRef.current.tasks);assert.equal(selected[0].fleet,snapshot);
 savedRef.current={tasks:[second]};snapshot={ready:true,jobs:{},label:'second'};
 await tick();assert.deepEqual(planned,['latest-first','latest-second']);assert.deepEqual(selected[1].tasks,savedRef.current.tasks);assert.equal(selected[1].fleet,snapshot);
 cleanup();assert.deepEqual(cleared,[42]);
});

test('automatic planning does not register a timer until the selected fleet and task sync are available',()=>{
 const effect=effects.find(node=>hasIdentifier(node.arguments[0],'findDueRailTask'));assert.ok(effect);
 for(const [hydrated,fleetEnabled] of [[false,true],[true,false],[false,false]]){
  let timers=0;
  const setup=expression(effect.arguments[0],{hydrated,fleetEnabled,setInterval:()=>{timers++;}});
  setup();assert.equal(timers,0);
 }
});

test('the actual task-sync state callback cancels pending dispatches when synchronization becomes unavailable',()=>{
 const constructor=walk(component,node=>node.type==='NewExpression'&&node.callee.name==='TaskSyncController')[0];assert.ok(constructor);
 const callback=constructor.arguments[0].properties.find(property=>property.key.name==='onState').value;
 const refName=controllerRef(callback,'cancelPending'),cancelled=[];
 const hydratedRef={current:true},availability=[];
 let state={phase:'synced',hydrated:true,error:null};
 const update=expression(callback,{
  active:true,[refName]:{current:{cancelPending:()=>cancelled.push(true)}},hydratedRef,
  setSyncState:next=>{state=typeof next==='function'?next(state):next;},setHydrated:value=>availability.push(value),
 });
 update({phase:'synced',hydrated:true,error:null});assert.equal(cancelled.length,0);assert.equal(hydratedRef.current,true);
 update({phase:'error',hydrated:true,error:'服务暂不可用'});assert.equal(cancelled.length,1);assert.equal(hydratedRef.current,false);assert.equal(availability.at(-1),false);
 update({phase:'synced',hydrated:true,error:null});assert.equal(hydratedRef.current,true);assert.equal(cancelled.length,1);
});

test('the reset button cancels pending dispatches before resetting local execution',()=>{
 const property=walk(component,node=>node.type==='Property'&&node.key.name==='onClick'&&hasIdentifier(node.value,'resetFleet'))[0];
 assert.ok(property,'local reset has an executable click handler');
 const callback=property.value,refName=controllerRef(callback,'cancelPending'),events=[],initialTasks=[{id:'initial'}];
 const reset=expression(callback,{
  [refName]:{current:{cancelPending:()=>events.push('cancel')}},
  resetFleet:()=>events.push('fleet'),initialTasks,recoverTasks:tasks=>tasks,
  setSaved:value=>events.push(value),setModal:()=>{},notify:()=>{},
 });
 reset();assert.deepEqual(events.slice(0,2),['cancel','fleet']);
 assert.deepEqual(events[2],{tasks:initialTasks,activities:[],decisions:{}});
});

test('changing parks invalidates pending work synchronously before the React state update',()=>{
 const node=declaration('setSite'),refName=controllerRef(node,'cancelPending'),events=[];
 const siteRef={current:'hainan'};
 const select=expression(node.init,{
  useCallback:callback=>callback,allowedSite:()=>true,siteRef,[refName]:{current:{cancelPending:()=>events.push('cancel')}},
  setSiteState:site=>events.push({site,sharedSite:siteRef.current}),
 });
 select('xsbn');assert.deepEqual(events,['cancel',{site:'xsbn',sharedSite:'xsbn'}]);
 events.length=0;select('xsbn');assert.deepEqual(events,[{site:'xsbn',sharedSite:'xsbn'}]);
 events.length=0;select('hainan');assert.deepEqual(events,['cancel',{site:'hainan',sharedSite:'hainan'}]);
});

function mountDispatch(){
 const effect=effects.find(node=>walk(node.arguments[0],item=>item.type==='NewExpression'&&item.callee.name==='RailDispatchController').length);
 assert.ok(effect,'workspace initializes a dispatch controller');
 const savedRef={current:{tasks:[{id:'original'}],activities:['keep activity'],decisions:{angle:'keep decision'}}};
 const siteRef={current:'hainan'},dispatchEnabledRef={current:true},hydratedRef={current:true},dispatchControllerRef={current:null};
 const renders=[],events=[];let options,listener,snapshot={ready:true,jobs:{}};
 const setSaved=expression(declaration('setSaved').init,{useCallback:callback=>callback,savedRef,setSavedState:next=>renders.push(next)});
 class FakeController{
  constructor(value){options=value;}
  cancelPending(){events.push('cancel');}
  dispose(){events.push('dispose');}
 }
 const dependencies={RailDispatchController:FakeController,savedRef,setSaved,siteRef,dispatchEnabledRef,hydratedRef,dispatchControllerRef,
  getFleetSnapshot:()=>snapshot,verifyDispatch:()=>{},jobForTree:()=>{},dispatchFleetJobs:()=>{},notify:()=>{},
  subscribeFleet:callback=>{listener=callback;return()=>events.push('unsubscribe');},
 };
 const cleanup=expression(effect.arguments[0],dependencies)();
 return {options,savedRef,siteRef,dispatchEnabledRef,hydratedRef,dispatchControllerRef,renders,events,cleanup,
  publish:value=>{snapshot=value;listener();},dependencies};
}

test('controller dependencies read live workspace state and commit tasks to the shared ref before React renders',()=>{
 const mounted=mountDispatch(),{options,savedRef,renders,dependencies}=mounted;
 assert.equal(options.getState(),savedRef.current);
 const tasks=[{id:'fresh-task'}];options.updateTasks(()=>tasks);
 assert.equal(savedRef.current.tasks,tasks);assert.equal(options.getState().tasks,tasks);
 assert.deepEqual(savedRef.current.activities,['keep activity']);assert.deepEqual(savedRef.current.decisions,{angle:'keep decision'});
 assert.equal(renders.at(-1),savedRef.current);
 options.updateTasks(current=>current);assert.equal(renders.length,1,'unchanged task list does not generate another render');
 for(const [actual,dependency] of [['getFleet','getFleetSnapshot'],['verify','verifyDispatch'],['makeJob','jobForTree'],['dispatch','dispatchFleetJobs']])assert.equal(options[actual],dependencies[dependency]);
 assert.equal(options.isEnabled(),true);
 mounted.siteRef.current='xsbn';assert.equal(options.isEnabled(),false);mounted.siteRef.current='hainan';
 mounted.dispatchEnabledRef.current=false;assert.equal(options.isEnabled(),false);mounted.dispatchEnabledRef.current=true;
 mounted.hydratedRef.current=false;assert.equal(options.isEnabled(),false);
 mounted.cleanup();
});

test('fleet detach invalidates pending work and unmount disposes its controller and subscription',()=>{
 const mounted=mountDispatch();assert.ok(mounted.dispatchControllerRef.current);
 mounted.publish({ready:true,jobs:{}});assert.deepEqual(mounted.events,[]);
 mounted.publish({ready:false,jobs:{}});assert.deepEqual(mounted.events,['cancel']);
 mounted.cleanup();assert.deepEqual(mounted.events,['cancel','dispose','unsubscribe']);assert.equal(mounted.dispatchControllerRef.current,null);
});

test('an unreadable sync journal immediately invalidates pending dispatches',()=>{
 const effect=effects.find(node=>walk(node.arguments[0],item=>item.type==='NewExpression'&&item.callee.name==='TaskSyncController').length);assert.ok(effect);
 const initialize=walk(effect.arguments[0],node=>node.type==='VariableDeclarator'&&node.id.name==='initialize')[0];assert.ok(initialize);
 const refName=controllerRef(initialize,'cancelPending'),events=[],hydratedRef={current:true};let state;
 const run=expression(initialize.init,{
  localStorage:{getItem:()=>{throw Error('storage unavailable');}},syncJournalKey:'journal',parseTaskSyncJournal:()=>{},
  [refName]:{current:{cancelPending:()=>events.push('cancel')}},hydratedRef,
  setHydrated:ready=>events.push(ready),setSyncState:next=>{state=next;},initialTaskSyncState:{hydrated:false,phase:'loading'},
 });
 run();assert.ok(events.includes('cancel'));assert.equal(hydratedRef.current,false);assert.equal(state.phase,'error');assert.equal(state.error,'storage unavailable');
});

const eventFixture={id:'rain',siteId:'demo-hainan',kind:'rain',zone:0,status:'active',note:'降雨暂缓',createdAt:'2026-10-19T00:00:00Z',mode:'simulation'};
test('the task read owns event refresh and discards responses predating a mutation or effect cleanup',async()=>{
 const constructor=walk(component,node=>node.type==='NewExpression'&&node.callee.name==='TaskSyncController')[0];
 const callback=constructor.arguments[0].properties.find(property=>property.key.name==='readTasks').value;
 for(const stale of ['none','mutation','disposed']){
  let resolve;const businessWriteVersion={current:0},applied=[];
  const run=expression(callback,{active:stale!=='disposed',businessWriteVersion,read:()=>new Promise(done=>{resolve=done;}),applyOperationalEvents:events=>applied.push(events),applyLogisticsBatches:()=>{}});
  const pending=run();if(stale==='mutation')businessWriteVersion.current++;
  const result={items:[{id:'same-task'}],operationalEvents:[eventFixture],logisticsBatches:[]};resolve(result);
  assert.equal(await pending,result.items);
  assert.deepEqual(applied,stale==='none'?[result.operationalEvents]:[]);
 }
});
test('event mutations apply the returned event immediately without clearing other parks or events',async()=>{
 const eventsRef={current:[{...eventFixture,id:'other',siteId:'demo-xsbn'},eventFixture]},businessWriteVersion={current:0},applied=[];
 const updated={...eventFixture,status:'resolved'};
 const run=expression(declaration('recordOperationalEvent').init,{eventsRef,businessWriteVersion,post:async()=>updated,applyOperationalEvents:value=>applied.push(value)});
 await run('/events/rain/resolve',{note:'雨已停'});
 assert.equal(businessWriteVersion.current,1);assert.deepEqual(applied,[[eventsRef.current[0],updated]]);
});
test('unchanged server events do not rerender but still initialize fleet holds after loading a checkpoint',()=>{
 const eventsRef={current:[]},renders=[],holds=[];
 const apply=expression(declaration('applyOperationalEvents').init,{useCallback:callback=>callback,eventsRef,setOperationalEvents:events=>renders.push(events),setFleetEventHolds:value=>holds.push(value),eventHoldForZone,siteWeatherBlock:()=>undefined});
 apply([]);assert.deepEqual(holds,[['','','','']]);assert.equal(renders.length,0);
 apply([eventFixture]);apply([structuredClone(eventFixture)]);
 assert.equal(renders.length,1);assert.match(holds.at(-1)[0],/降雨暂缓/);assert.equal(holds.at(-1)[1],'');
});
test('legacy demo cannot advance until shared tasks and current events are available',()=>{
 const effect=effects.find(node=>hasIdentifier(node.arguments[0],'advanceDemo'));assert.ok(effect);
 const initial={id:'legacy',site:'hainan',kind:'割胶',treeIndices:[0],count:1,done:0,status:'执行中',dispatch:{phase:'running',history:[],auto:{stage:'work',nextAt:1,startedAt:0}}};
 let state={tasks:[initial]},tick;const hydratedRef={current:false},eventsRef={current:[]};
 expression(effect.arguments[0],{hydratedRef,eventsRef,eventHoldForTask,advanceDemo,executionHold:()=>undefined,Date:{now:()=>100},setSaved:action=>{state=action(state);},window:{setInterval:callback=>{tick=callback;},clearInterval:()=>{}}})();
 tick();assert.equal(state.tasks[0],initial);
 hydratedRef.current=true;eventsRef.current=[eventFixture];tick();assert.equal(state.tasks[0].done,0);assert.equal(state.tasks[0].dispatch.auto.eventHeldAt,100);
 hydratedRef.current=false;eventsRef.current=[];tick();assert.equal(state.tasks[0].dispatch.auto.eventHeldAt,100);
});
test('automatic planning excludes event-held tasks and can select an unaffected zone',async()=>{
 const effect=effects.find(node=>hasIdentifier(node.arguments[0],'findDueRailTask'));let tick;const planned=[];
 const make=zone=>({id:'task-'+zone,site:'hainan',kind:'割胶',status:'待开始',treeIndices:[zone*50]});
 const first=make(0),second=make(1),savedRef={current:{tasks:[first,second]}};
 expression(effect.arguments[0],{hydrated:true,fleetEnabled:true,planning:{current:false},savedRef,eventsRef:{current:[eventFixture]},eventHoldForTask,getFleetSnapshot:()=>({}),findDueRailTask:tasks=>tasks[0],dispatchControllerRef:{current:{startBatch:async id=>planned.push(id)}},setInterval:callback=>{tick=callback;},clearInterval:()=>{}})();
 await tick();assert.deepEqual(planned,[second.id]);
});

test('shared task refresh publishes logistics facts together and does not apply an older batch after a write',async()=>{
 const constructor=walk(component,node=>node.type==='NewExpression'&&node.callee.name==='TaskSyncController')[0];
 const callback=constructor.arguments[0].properties.find(property=>property.key.name==='readTasks').value;
 for(const stale of [false,true]){
  let resolve;const businessWriteVersion={current:2},published=[];
  const run=expression(callback,{active:true,businessWriteVersion,read:()=>new Promise(done=>{resolve=done;}),applyOperationalEvents:value=>published.push(['events',value]),applyLogisticsBatches:value=>published.push(['batches',value])});
  const pending=run();if(stale)businessWriteVersion.current++;
  const reply={items:[],operationalEvents:[eventFixture],logisticsBatches:[{id:'current-batch',revision:3}]};resolve(reply);await pending;
  assert.deepEqual(published,stale?[]:[['events',reply.operationalEvents],['batches',reply.logisticsBatches]]);
 }
});
test('a saved logistics action preserves the displayed revision and immediately updates only its returned batch',async()=>{
 const first={id:'first',siteId:'demo-xsbn',revision:5},second={id:'second',siteId:'demo-hainan',revision:2};
 const batchesRef={current:[first,second]},businessWriteVersion={current:0},requests=[],published=[];
 const updated={...second,revision:3,stage:'weighed'};
 const write=expression(declaration('recordLogisticsBatch').init,{batchesRef,businessWriteVersion,crypto:{randomUUID:()=> 'request-once'},post:async(...args)=>{requests.push(args);return updated;},applyLogisticsBatches:value=>published.push(value)});
 const input={siteId:'demo-hainan',revision:2,operator:'经办甲',note:'称重',grossKg:20,tareKg:2};
 await write('/batch/second/weigh',input);
 assert.deepEqual(requests,[['/batch/second/weigh',{...input,requestId:'request-once'}]]);
 assert.deepEqual(published,[[updated,first]]);assert.equal(businessWriteVersion.current,1);
});
test('a failed logistics submission does not fabricate saved records or invalidate a successful read',async()=>{
 const batchesRef={current:[]},businessWriteVersion={current:1},published=[];
 const write=expression(declaration('recordLogisticsBatch').init,{batchesRef,businessWriteVersion,crypto:{randomUUID:()=> 'request-once'},post:async()=>{throw Error('server rejected');},applyLogisticsBatches:value=>published.push(value)});
 await assert.rejects(write('/collect',{}),/server rejected/);
 assert.deepEqual(published,[]);assert.equal(businessWriteVersion.current,1);
});


test('task refresh cannot clear an active API weather hold on the fleet',()=>{
 const holds=[],eventsRef={current:[]};
 const apply=expression(declaration('applyOperationalEvents').init,{useCallback:callback=>callback,eventsRef,setOperationalEvents:()=>{},setFleetEventHolds:value=>holds.push(value),eventHoldForZone,siteWeatherBlock:()=> '天气暂缓：当前降雨 8 mm'});
 apply([]);apply([]);
 assert.equal(holds.length,2);
 assert.ok(holds.every(zones=>zones.every(reason=>/降雨 8 mm/.test(reason))));
});
test('demo weather only releases the weather hold for simulated dispatch and reads the current switch',()=>{
 const toggle={current:false},fleet={ready:true,zones:[{active:null,queue:[]}]};
 let schedule;
 const hold=expression(declaration('executionHold').init,{demoWeatherRef:toggle,getFleetSnapshot:()=>fleet,taskExecutionBlock:()=>schedule,siteWeatherBlock:()=> '天气暂缓'});
 const simulated={id:'simulation',site:'hainan',kind:'割胶',block:'A',status:'执行中',dispatch:{phase:'review'}};
 assert.equal(hold(simulated),'天气暂缓');
 toggle.current=true;assert.equal(hold(simulated),undefined);
 assert.equal(hold({...simulated,dispatch:undefined}),'天气暂缓');
 assert.equal(hold({...simulated,railJob:{}}),'天气暂缓');
 assert.equal(hold({...simulated,id:'rail-123'}),'天气暂缓');
 assert.equal(hold({...simulated,railResult:{}}),'天气暂缓');
 schedule='任务尚未到开始时间';assert.equal(hold(simulated),schedule);
 schedule=undefined;fleet.zones[0].paused=true;assert.equal(hold(simulated),'本区机器人已暂停');
 fleet.zones[0].paused=false;toggle.current=false;assert.equal(hold(simulated),'天气暂缓');
});
test('ongoing demo weather hold freezes progress and resumes without a catch-up receipt',()=>{
 const effect=effects.find(node=>hasIdentifier(node.arguments[0],'advanceDemo'));
 const initial={id:'weather-demo',site:'xsbn',kind:'割胶',count:2,done:0,status:'执行中',dispatch:{phase:'running',history:[],auto:{stage:'work',nextAt:1,startedAt:0}}};
 let state={tasks:[initial]},tick,blocked=true,now=100;
 expression(effect.arguments[0],{hydratedRef:{current:true},eventsRef:{current:[]},eventHoldForTask,advanceDemo,executionHold:()=>blocked?'天气暂缓':undefined,Date:{now:()=>now},setSaved:action=>{state=action(state);},window:{setInterval:callback=>{tick=callback;},clearInterval:()=>{}}})();
 tick();now=60000;tick();assert.equal(state.tasks[0].done,0);
 blocked=false;tick();assert.equal(state.tasks[0].done,0,'clearing the hold preserves the remaining work timer');
 tick();assert.equal(state.tasks[0].done,1);
});
