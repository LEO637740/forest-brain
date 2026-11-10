import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAst,transformWithOxc} from 'vite';
import * as THREE from 'three';
import {createZoneScheduler,buildZoneRoutes,routePoint,workPose} from '../src/zoneFleet.ts';
import {verifyFleetJobWith} from '../src/integration/fleetVerification.ts';
import {finishRailTask} from '../src/workspace/railTaskState.ts';

const epoch=Date.parse('2026-10-26T03:00:00.000Z');
const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
const observation={reviewId:'review-camera',captureId:'capture-camera',treeId:'T-0001',siteId:'demo-hainan'};
const cameraJob={id:observation.captureId,observation,angle:0,planVersion:'camera-demo-v1',requestedAt:new Date(epoch).toISOString()};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function source(path){
  const {code}=await transformWithOxc(readFileSync(new URL(path,import.meta.url),'utf8'),path,{lang:'ts'});
  return parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
}
const observationCode=await source('../src/observation/robotObservation.ts');
const sceneCode=await source('../src/zoneFleetScene.ts');
const cameraCode=await source('../src/observation/observationCamera.ts');
function windowHarness(){
  const listeners=new Map(),events=[];
  return {events,addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},
    dispatchEvent(event){events.push(event);},emit(name,detail){return listeners.get(name)?.({detail});}};
}
function observationHarness({post=async()=>({observation:{captureId:'capture-camera',status:'dispatched'}}),fleet={ready:true,jobs:{}},dispatch=()=>true}={}){
  const calls=[],notifications=[],entries=[],window=windowHarness();
  const bindings={window,Event,useRef:value=>({current:value}),useEffect:fn=>fn(),setTimeout:fn=>{fn();return 0;},
    api:async(path,input)=>{calls.push({path,input});return post(path,input,calls.length);},getFleetSnapshot:()=>fleet,
    dispatchTree:(index,job)=>{entries.push({index,job});return dispatch(index,job);}};
  const api=new Function(...Object.keys(bindings),`${observationCode};return {attachObservationCamera,dispatchObservation,useRobotObservation};`)(...Object.values(bindings));
  api.useRobotObservation(message=>notifications.push(message));
  return {...api,calls,notifications,entries,window,fleet};
}

test('camera work emits an observation receipt without adding completed cuts or completing an unrelated cutting task',()=>{
  const receipts=[],scheduler=createZoneScheduler(routes,(index,job)=>receipts.push({index,job,outcome:'completed',finishedAt:new Date(epoch).toISOString()}));
  scheduler.enqueue(0,cameraJob);scheduler.update(1);scheduler.update(2);
  assert.equal(receipts.length,1);assert.deepEqual(receipts[0].job.observation,observation);
  assert.equal(scheduler.zones[0].completed,0);
  const cutJob={id:'real-cut',angle:28,planVersion:'adopted',requestedAt:new Date(epoch).toISOString()};
  const task={id:'cut-task',site:'hainan',kind:'割胶',status:'执行中',count:1,done:0,treeIndices:[0],railJob:cutJob};
  assert.equal(finishRailTask(task,receipts[0]).done,0);
  scheduler.enqueue(0,cutJob);scheduler.update(1);scheduler.update(8);
  assert.equal(scheduler.zones[0].completed,1);assert.equal(receipts.length,2);
});

test('observation verification calls its own capture gate and cannot borrow another park or tree',async()=>{
  const calls=[],deps={siteId:'demo-hainan',treeId:()=> 'T-0001',dataMode:'demo',now:()=>epoch,
    refreshWeather:async()=>assert.fail('a camera is not a cutting strategy'),weatherTiming:()=>({}),read:async()=>assert.fail('camera must not consume a cut strategy'),
    post:async(path,input)=>{calls.push({path,input});return {siteId:'demo-hainan',treeId:'T-0001'};}};
  assert.deepEqual(await verifyFleetJobWith(0,cameraJob,deps),{weatherBlock:''});
  assert.deepEqual(calls,[{path:'/api/simulation/reviews/review-camera/photo/verify',input:{siteId:'demo-hainan',captureId:'capture-camera'}}]);
  await assert.rejects(verifyFleetJobWith(0,cameraJob,{...deps,siteId:'demo-xsbn'}),/园区或树位不一致/);
  await assert.rejects(verifyFleetJobWith(0,cameraJob,{...deps,treeId:()=> 'T-0002'}),/园区或树位不一致/);
  await assert.rejects(verifyFleetJobWith(0,cameraJob,{...deps,post:async()=>({siteId:'demo-xsbn',treeId:'T-0001'})}),/任务对象不一致/);
});

test('dispatch requires an attached camera and free tree and creates an angle-zero observation job',async()=>{
  const h=observationHarness(),job={id:'review-camera',treeId:'T-0001',siteId:'demo-hainan'};
  await assert.rejects(h.dispatchObservation(job),/等待机器人加载/);assert.equal(h.calls.length,0);
  h.attachObservationCamera(()=>({image:'frame',width:640,height:480,position:[0,1,0]}));
  await assert.rejects(h.dispatchObservation({...job,siteId:'demo-xsbn'}),/海南海口/);
  h.fleet.jobs[0]={id:'other'};await assert.rejects(h.dispatchObservation(job),/已有排队任务/);
  delete h.fleet.jobs[0];await h.dispatchObservation(job,'request-camera');
  assert.equal(h.entries[0].index,0);assert.equal(h.entries[0].job.angle,0);
  assert.deepEqual(h.entries[0].job.observation,observation);
  assert.equal(h.calls[0].input.siteId,'demo-hainan');
  assert.equal(h.entries[0].job.harnessSource,undefined);
});

test('queue admission failure marks that capture failed instead of leaving a dispatched request',async()=>{
  const h=observationHarness({dispatch:()=>false});h.attachObservationCamera(()=>({}));
  await assert.rejects(h.dispatchObservation({id:'review-camera',treeId:'T-0001',siteId:'demo-hainan'}),/未能加入设备队列/);
  assert.equal(h.calls.length,2);assert.match(h.calls[1].path,/photo\/fail$/);
  assert.equal(h.calls[1].input.captureId,'capture-camera');
});

test('completion captures once and retries the same image and capture ID; cancellation never captures a frame',async()=>{
  let attempts=0,pictures=0;
  const h=observationHarness({post:async path=>{if(path.endsWith('/collect')&&++attempts===1)throw Error('临时断连');return {};}});
  h.attachObservationCamera(()=>{pictures++;return {image:'data:image/jpeg;base64,/9j/2Q==',width:640,height:480,position:[1,1.35,2]};});
  const promise=h.window.emit('zone-fleet-result',{index:0,job:cameraJob,outcome:'completed'});
  assert.equal(pictures,0,'render capture waits for the final scene transform');
  await promise;
  assert.equal(pictures,1);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);
  assert.equal(h.calls[0].input.captureId,observation.captureId);assert.match(h.notifications.at(-1),/回传目标画面/);
  await h.window.emit('zone-fleet-result',{index:0,job:cameraJob,outcome:'cancelled'});
  assert.equal(pictures,1);assert.match(h.calls.at(-1).path,/photo\/fail$/);
});

test('the scene keeps both cutting joints retracted throughout camera work, while a normal cut still extends them',async()=>{
  const window=windowHarness(),document={hidden:false},scene=new THREE.Scene();let scheduler;
  class Loader{async loadAsync(){const root=new THREE.Group();for(const name of ['ARM_SLIDE','VERTICAL_SLIDER','TOOL_FEED']){const node=new THREE.Group();node.name=name;root.add(node);}return {scene:root};}}
  const bindings={THREE,GLTFLoader:Loader,window,document,console,buildZoneRoutes,routePoint,workPose,
    createZoneScheduler:(...args)=>(scheduler=createZoneScheduler(...args)),attachFleet:()=>{},publishFleet:()=>{},detachFleet:()=>{}};
  const install=new Function(...Object.keys(bindings),`${sceneCode};return installZoneFleet;`)(...Object.values(bindings));
  const trees=Array.from({length:200},(_,i)=>({x:Math.floor(i/50)*80+i%10*5,z:Math.floor((i%50)/10)*6}));
  const installed=install(scene,{dataset:{}},trees,()=>0,()=>{},()=>{});await settle();
  const robot=scene.getObjectByName('ZONE_ROBOT_A'),arm=robot.getObjectByName('ARM_SLIDE'),slider=robot.getObjectByName('VERTICAL_SLIDER');
  scheduler.enqueue(0,cameraJob);
  for(let i=0;i<24;i++){installed.update(.1);assert.equal(Math.abs(arm.position.z),0);assert.equal(slider.position.y,.67);}
  assert.equal(scheduler.zones[0].completed,0);
  scheduler.enqueue(0,{id:'cut',angle:28,planVersion:'cut',requestedAt:new Date(epoch).toISOString()});
  for(let i=0;i<12;i++)installed.update(.1);
  assert.ok(arm.position.z<0);installed.dispose();
});

test('camera refuses a distant robot and restores scene visibility and render target after capturing',()=>{
  let capture,position=new THREE.Vector3(0,1.35,1),target={name:'original'},prepared=[];
  const scene=new THREE.Scene(),label=new THREE.Sprite(),robot=new THREE.Group();robot.name='ZONE_ROBOT_A';scene.add(label,robot);
  const renderer={getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},render:()=>{assert.equal(label.visible,false);assert.equal(robot.visible,false);},readRenderTargetPixels:(_target,_x,_y,_w,_h,pixels)=>pixels.fill(100)};
  const canvas={getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(640*480*4)}),putImageData:()=>{}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/2Q=='};
  const bindings={THREE,document:{createElement:()=>canvas},attachObservationCamera:fn=>{capture=fn;return ()=>{};}};
  const install=new Function(...Object.keys(bindings),`${cameraCode};return installObservationCamera;`)(...Object.values(bindings));
  install(renderer,scene,[{x:0,z:0}],()=>0,()=>position,index=>prepared.push(index));
  const image=capture(0);assert.equal(image.width,640);assert.equal(image.height,480);
  assert.deepEqual(image.position,[0,1.35,1]);assert.equal(target.name,'original');
  assert.equal(label.visible,true);assert.equal(robot.visible,true);assert.deepEqual(prepared,[0,null]);
  position=new THREE.Vector3(10,1.35,1);assert.throws(()=>capture(0),/尚未到达目标树/);
});

test('a photo trip starts at the displayed completed-cut position and never snaps back before capture',async()=>{
 const window=windowHarness(),document={hidden:false},scene=new THREE.Scene();let scheduler;
 class Loader{async loadAsync(){const root=new THREE.Group();for(const name of ['ARM_SLIDE','VERTICAL_SLIDER','TOOL_FEED']){const node=new THREE.Group();node.name=name;root.add(node);}return {scene:root};}}
 const bindings={THREE,GLTFLoader:Loader,window,document,console,buildZoneRoutes,routePoint,workPose,createZoneScheduler:(...args)=>(scheduler=createZoneScheduler(...args)),attachFleet:()=>{},publishFleet:()=>{},detachFleet:()=>{}};
 const install=new Function(...Object.keys(bindings),`${sceneCode};return installZoneFleet;`)(...Object.values(bindings));
 const trees=Array.from({length:200},(_,i)=>({x:Math.floor(i/50)*80+i%10*5,z:Math.floor((i%50)/10)*6}));
 const installed=install(scene,{dataset:{}},trees,()=>0,()=>{},()=>{});await settle();
 const robot=scene.getObjectByName('ZONE_ROBOT_A');
 const completed=[{taskId:'cut-demo',zone:0,treeIndex:29,previousTree:28,stage:'work',progress:1,paused:false,done:30}];
 installed.update(.1,completed);const before=robot.position.clone();
 scheduler.enqueue(5,{...cameraJob,observation:{...observation,treeId:'T-0006'}});
 installed.update(.1,completed);assert.ok(robot.position.distanceTo(before)<=.901,'travel must start at the visible robot');assert.ok(robot.position.distanceTo(before)>0);
 let previous=robot.position.clone();
 for(let i=0;i<800&&scheduler.zones[0].active!==null;i++){installed.update(.1,completed);assert.ok(robot.position.distanceTo(previous)<=.901,'every frame moves continuously along the rail');previous.copy(robot.position);}
 assert.equal(scheduler.zones[0].active,null);assert.ok(Math.hypot(robot.position.x-trees[5].x,robot.position.z-trees[5].z)<2);
 installed.update(.1,completed);assert.ok(robot.position.distanceTo(previous)<.001,'completed cut pose cannot reclaim the robot after capture');installed.dispose();
});
