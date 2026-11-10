import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRowTimeline,type RowStation} from './railRowTimeline';
import {railSegments,type RailSegment} from './railSegments';
import type {RailTreeSource} from './railFixture';

// Presentation only: no cutting, production receipts or robot command transport.
export function installHomeRailRow(scene:THREE.Scene,panel:HTMLElement,focus:(p:THREE.Vector3,r:number)=>void,dirty:()=>void,beforeStart:()=>void=()=>{},segment:RailSegment=railSegments[0],matchesSource:(source:RailTreeSource)=>boolean=()=>false){
  const count=segment.indices.length,title=count===3?'三树连续预演':segment.label+'预演';
  const root=new THREE.Group();root.name='HOME_RAIL_ROW_'+segment.id;
  const details=document.createElement('details');
  const summary=document.createElement('summary');summary.style.cssText='cursor:pointer;padding:6px 0;font-weight:600';summary.textContent=title;details.append(summary);details.dataset.segment=segment.id;
  const status=document.createElement('p');status.textContent='正在加载连续轨道';details.append(status);panel.append(details);
  let disposed=false,time=0,running=false,duration=0,robot:THREE.Group|undefined;
  const originalPanelStyle=panel.style.cssText;
  const titleNode=panel.firstChild,originalTitle=titleNode?.nodeType===Node.TEXT_NODE?titleNode.textContent:null;
  details.addEventListener('toggle',()=>{
    if(details.open){for(const other of panel.querySelectorAll('details[data-segment]'))if(other!==details)(other as HTMLDetailsElement).open=false;
      details.style.display='';if(originalTitle!==null)titleNode!.textContent=segment.label;panel.style.top='128px';panel.style.width='320px';panel.style.maxHeight='210px';
      for(const child of panel.children)if(child!==details&&child instanceof HTMLElement&&!child.matches('details[data-segment]')){if(!child.hasAttribute('data-rail-original-display'))child.dataset.railOriginalDisplay=child.style.display;child.style.display='none';}
    }else{if(!panel.querySelector('details[data-segment][open]')){if(originalTitle!==null)titleNode!.textContent=originalTitle;panel.style.cssText=originalPanelStyle;panel.querySelectorAll<HTMLElement>('[data-rail-original-display]').forEach(node=>{node.style.display=node.dataset.railOriginalDisplay!;delete node.dataset.railOriginalDisplay;});}}
  });
  let draw=()=>{};
  let launch=()=>{},ready=false,receiptSent=false;
  const publishReady=()=>window.dispatchEvent(new CustomEvent('rail-row-ready',{detail:{segmentId:segment.id,ready:ready&&!disposed}}));
  const requestStart=(event:Event)=>{if(ready&&!disposed&&segment.indices.includes((event as CustomEvent).detail?.index))launch();};
  window.addEventListener('rail-row-query',publishReady);window.addEventListener('rail-row-start',requestStart);
  const cleanup=(object:THREE.Object3D)=>{const gs=new Set<THREE.BufferGeometry>(),ms=new Set<THREE.Material>();object.traverse(n=>{if(n instanceof THREE.Mesh){gs.add(n.geometry);(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>ms.add(m));}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());};
  const loader=new GLTFLoader();
  void (async()=>{
    const response=await fetch(segment.reportUrl);if(!response.ok)throw new Error('Missing row route');
    const report=await response.json(),route=report.bestStraightRail;
    if(report.runtimeTreeYawRadians!==segment.yaw||report.treeIndices.join(',')!==segment.indices.join(','))throw new Error('Unexpected segment fixture');
    if(segment.indices.length===1&&(!report.treeSource||!matchesSource(report.treeSource)))throw new Error('Tree no longer matches reviewed rail fixture');
    if(report.cuttingApproved!==false||report.executionApproved!==false)throw new Error('Expected noncontact preview report');
    const stations=route.stations as RowStation[];
    const timeline=createRowTimeline(stations);duration=timeline.duration;
    const [r,rail]=await Promise.all([loader.loadAsync('/assets/robot/rail-r4/robot_runtime.glb'),loader.loadAsync('/assets/robot/rail-r4/rail_segment.glb')]);
    if(disposed){cleanup(r.scene);cleanup(rail.scene);return;}
    robot=r.scene;root.position.fromArray(route.rootWorldGltf);root.rotation.y=route.yawRadians;root.add(robot);
    for(const x of route.segmentCentersLocalX){const part=rail.scene.clone(true);part.position.x=x;root.add(part);}
    const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#767c70',roughness:.95});
    for(const foot of route.supports){const pier=new THREE.Mesh(geometry,material),depth=foot.pierDepthM+.04;pier.scale.set(.24,depth,.23);pier.position.set(foot.localX,-depth/2,foot.localZ);root.add(pier);}
    const arm=robot.getObjectByName('ARM_SLIDE'),slider=robot.getObjectByName('VERTICAL_SLIDER'),tool=robot.getObjectByName('TOOL_FEED');
    if(!arm||!slider||!tool)throw new Error('Missing stow axes');
    arm.position.z=0;slider.position.y=.67;tool.position.z=0;
    root.traverse(n=>{if(n instanceof THREE.Mesh){n.castShadow=true;n.receiveShadow=true;}});scene.add(root);
    const progress=document.createElement('progress');progress.max=duration;progress.style.cssText='width:100%;height:5px;accent-color:#89ddba';progress.setAttribute('aria-label',title+'进度');
    status.style.cssText='margin:8px 0;font-size:15px';status.setAttribute('role','status');
    const start=document.createElement('button'),reset=document.createElement('button'),view=document.createElement('button');
    for(const b of [view,start,reset])b.style.cssText='background:#89ddba;color:#10271f;border:0;border-radius:4px;padding:8px 10px;margin:4px 6px 4px 0;cursor:pointer;font:inherit';
    view.textContent='查看轨道';reset.textContent='复位';reset.setAttribute('aria-label','复位'+title);
    view.onclick=()=>focus(root.position.clone().add(new THREE.Vector3(0,1.2,0)),route.yawRadians);
    launch=()=>{details.open=true;panel.scrollTop=0;if(running){view.click();return;}if(time>=duration){time=0;receiptSent=false;}running=true;beforeStart();view.click();draw();};
    start.onclick=()=>{if(running){running=false;draw();}else launch();};
    reset.onclick=()=>{running=false;time=0;receiptSent=false;draw();};
    draw=()=>{
      const pose=timeline.sample(time);
      robot!.position.x=pose.x;arm.position.z=-pose.extension;slider.position.y=.67+pose.slider;tool.position.z=0;robot!.updateMatrixWorld(true);
      const label=time>=duration?`${count}棵预演完成 · ${count===1?'已收回':'已返回'}`:`${pose.station+1}/${count} · ${stations[pose.station].id} · ${pose.phase}`;
      if(status.textContent!==label)status.textContent=label;
      start.textContent=running?'暂停':time>=duration?'重新预演':time>0?'继续':'开始预演';start.setAttribute('aria-label',`${start.textContent}${title}`);
      progress.value=time;
      details.dataset.transit=JSON.stringify({time,duration,phase:pose.phase,station:pose.station,state:running?'running':time>=duration?'complete':time===0?'idle':'paused',x:pose.x,arm:arm.position.z,slider:slider.position.y,tool:0});dirty();
    };
    details.append(progress,start,reset,view);details.dataset.mode='noncontact-preview';draw();ready=true;publishReady();
  })().catch(error=>{if(!disposed){running=false;root.removeFromParent();cleanup(root);status.textContent='三树轨道载入失败';console.error('Rail row',error);}});
  const hide=()=>{if(document.hidden&&running){running=false;draw();}};document.addEventListener('visibilitychange',hide);
  return {pause(){running=false;draw();},update(dt:number){if(running&&!document.hidden){time=Math.min(duration,time+Math.min(Math.max(dt,0),.1));if(time===duration)running=false;draw();if(time===duration&&!receiptSent){receiptSent=true;window.dispatchEvent(new CustomEvent('rail-row-result',{detail:{id:crypto.randomUUID(),segmentId:segment.id,indices:[...segment.indices],duration,completedAt:new Date().toISOString()}}));}}},dispose(){disposed=true;running=false;ready=false;publishReady();window.removeEventListener('rail-row-query',publishReady);window.removeEventListener('rail-row-start',requestStart);document.removeEventListener('visibilitychange',hide);details.remove();root.removeFromParent();cleanup(root);}};
}
