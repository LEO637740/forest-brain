import * as THREE from 'three';
import type {DemoRobotMotion} from './workspace/demoRobotMotion';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildZoneRoutes,routePoint,createZoneScheduler,attachFleet,publishFleet,detachFleet,workPose,type FleetJob} from './zoneFleet';
export function installZoneFleet(scene:THREE.Scene,host:HTMLElement,trees:{x:number;z:number}[],height:(x:number,z:number)=>number,dirty:()=>void,focus:(point:THREE.Vector3)=>void){
 const routes=buildZoneRoutes(trees,height),group=new THREE.Group();group.name='ZONE_RAIL_FLEET';scene.add(group);
 let disposed=false,ready=false,tick=0;
 const robots:THREE.Group[]=[],axes:{arm:THREE.Object3D;slider:THREE.Object3D;tool:THREE.Object3D}[]=[];
 const result=(index:number,job:FleetJob|undefined,outcome:'completed'|'cancelled')=>window.dispatchEvent(new CustomEvent('zone-fleet-result',{detail:{index,job,outcome,finishedAt:new Date().toISOString()}}));
 const scheduler=createZoneScheduler(routes,(i,j)=>result(i,j,'completed'),(i,j)=>result(i,j,'cancelled'));
 const beams:{a:THREE.Vector3;b:THREE.Vector3;thickness:number;width:number}[]=[],posts:{x:number;y:number;z:number;depth:number}[]=[];
 for(const route of routes){
  const edges=route.points.map((p,i)=>{const a=route.points[Math.max(0,i-1)],b=route.points[Math.min(route.points.length-1,i+1)],n=new THREE.Vector3(-(b.z-a.z),0,b.x-a.x).normalize();
   return [-.26,.26].map(side=>new THREE.Vector3(p.x,p.y+.78,p.z).addScaledVector(n,side));});
  for(let i=1;i<edges.length;i++)for(let side=0;side<2;side++)beams.push({a:edges[i-1][side],b:edges[i][side],thickness:.08,width:.09});
  const length=route.distances.at(-1)!,supports=Array.from({length:Math.floor(length/3.2)+1},(_,i)=>i*3.2);supports.push(length);
  for(const d of supports){const p=routePoint(route,d),a=routePoint(route,d-.3),b=routePoint(route,d+.3),n=new THREE.Vector3(-(b.z-a.z),0,b.x-a.x).normalize();
   const center=new THREE.Vector3(p.x,p.y+.69,p.z);
   beams.push({a:center.clone().addScaledVector(n,-.36),b:center.clone().addScaledVector(n,.36),thickness:.07,width:.06});
   for(const side of [-.26,.26]){const x=p.x+n.x*side,z=p.z+n.z*side,bottom=height(x,z)-.04,top=p.y+.74;posts.push({x,z,y:(top+bottom)/2,depth:top-bottom});}
   if(d===0||d===length){const stop=center.clone().add(new THREE.Vector3(0,.25,0));beams.push({a:stop.clone().addScaledVector(n,-.36),b:stop.clone().addScaledVector(n,.36),thickness:.14,width:.12});}
  }
 }
 const steel=new THREE.MeshStandardMaterial({color:'#596268',metalness:.65,roughness:.48}),footMat=new THREE.MeshStandardMaterial({color:'#767a74',roughness:.9});
 const geo=new THREE.BoxGeometry(1,1,1),rails=new THREE.InstancedMesh(geo,steel,beams.length),piers=new THREE.InstancedMesh(geo,footMat,posts.length),dummy=new THREE.Object3D(),xAxis=new THREE.Vector3(1,0,0);
 beams.forEach((b,i)=>{dummy.position.copy(b.a).add(b.b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(xAxis,b.b.clone().sub(b.a).normalize());dummy.scale.set(b.a.distanceTo(b.b)+.02,b.thickness,b.width);dummy.updateMatrix();rails.setMatrixAt(i,dummy.matrix);});
 posts.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.quaternion.identity();dummy.scale.set(.1,p.depth,.1);dummy.updateMatrix();piers.setMatrixAt(i,dummy.matrix);});
 rails.receiveShadow=true;piers.receiveShadow=true;group.add(rails,piers);
 host.dataset.zoneRailCoverage=JSON.stringify({zones:4,trees:routes.map(r=>Object.keys(r.stations).length),robots:4,connectedWithinZone:true,crossZone:false});
 const follow=(e:Event)=>{const zone=(e as CustomEvent).detail;if(Number.isInteger(zone)&&robots[zone])focus(robots[zone].position.clone().add(new THREE.Vector3(0,1.2,0)));};
 window.addEventListener('zone-fleet-focus',follow);
 const direction=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),side=new THREE.Vector3(),normal=new THREE.Vector3(),basis=new THREE.Matrix4(),orientation=new THREE.Quaternion();
 const previousPoses=new Array<string>(4),settle=new Array<number>(4).fill(0);
 let demoMotions:DemoRobotMotion[]=[];
 const supersededDemo=new Map<number,string>();
 const apply=(dt=1)=>{
  let changed=false;
  scheduler.zones.forEach((s,i)=>{const robot=robots[i];if(!robot||s.paused)return;
   const candidate=demoMotions.find(m=>m.zone===i);
   if(s.active!==null&&candidate)supersededDemo.set(i,candidate.taskId);
   const demo=s.active===null&&!s.queue.length&&candidate&&(!supersededDemo.has(i)||supersededDemo.get(i)!==candidate.taskId||candidate.progress<1&&!candidate.paused)?candidate:undefined;
   const route=routes[i];
   const progress=demo?.progress??0;
   const from=demo?route.stations[demo.previousTree]:s.distance,to=demo?route.stations[demo.treeIndex]:s.distance;
   const distance=demo?(demo.stage==='travel'?from+(to-from)*progress:to):s.distance;
   if(demo)s.distance=distance; // Hand the physical rail position to the next queued operation.
   const phase=demo?(demo.stage==='work'?'working':'moving'):s.phase;
   const elapsed=demo?progress*8:s.elapsed;
   const pose=distance+':'+phase+':'+elapsed;
   if(previousPoses[i]===pose&&settle[i]<=0)return;
   if(previousPoses[i]!==pose){previousPoses[i]=pose;settle[i]=1;}
   settle[i]-=dt;changed=true;
   const p=routePoint(route,distance),a=routePoint(route,Math.max(0,distance-.1)),b=routePoint(route,Math.min(route.distances.at(-1)!,distance+.1));
   robot.position.set(p.x,p.y,p.z);direction.set(b.x-a.x,b.y-a.y,b.z-a.z).normalize();if(direction.x<0)direction.negate();
   side.crossVectors(direction,up).normalize();normal.crossVectors(side,direction).normalize();basis.makeBasis(direction,normal,side);orientation.setFromRotationMatrix(basis);
   robot.quaternion.slerp(orientation,1-Math.exp(-dt*9));
   const poseValue=s.active!==null&&scheduler.jobs[s.active]?.observation?{arm:0,slider:0}:workPose(phase,elapsed,s.retractFrom);
   axes[i].arm.position.z=-poseValue.arm;
   axes[i].slider.position.y=.67-poseValue.slider;
   axes[i].tool.position.z=0;
  });
  return changed;
 };
 void new GLTFLoader().loadAsync('/assets/robot/rail-r4/robot_runtime.glb').then(gltf=>{
  if(disposed){gltf.scene.traverse(n=>{if(n instanceof THREE.Mesh)n.geometry.dispose();});return;}
  for(let i=0;i<4;i++){const robot=gltf.scene.clone(true);robot.name='ZONE_ROBOT_'+ 'ABCD'[i];
   const arm=robot.getObjectByName('ARM_SLIDE'),slider=robot.getObjectByName('VERTICAL_SLIDER'),tool=robot.getObjectByName('TOOL_FEED');
   if(!arm||!slider||!tool)throw Error('Robot animation nodes missing');
   robot.traverse(n=>{
    // Only the root and three animated joints need local matrix recomposition.
    n.updateMatrix();n.matrixAutoUpdate=n===robot||n===arm||n===slider||n===tool;
    if(n instanceof THREE.Mesh){n.castShadow=true;n.receiveShadow=true;}
   });robots.push(robot);axes.push({arm,slider,tool});group.add(robot);
  }
  ready=true;apply();attachFleet(scheduler);dirty();
 }).catch(error=>{if(!disposed){detachFleet('机器人加载失败，请刷新重试');console.error('Zone fleet',error);}});
 return {position(zone:number){return robots[zone]?.position.clone().add(new THREE.Vector3(0,1.2,0));},update(dt:number,motions:DemoRobotMotion[]=[]){
  if(!ready||document.hidden)return;
  demoMotions=motions;
  const step=Math.max(0,Math.min(.1,dt));scheduler.update(step);if(apply(step))dirty();tick+=step;
  if(tick>.2){tick=0;publishFleet(scheduler.zones,true,null,scheduler.jobs);const value=JSON.stringify(scheduler.zones);if(host.dataset.zoneFleet!==value)host.dataset.zoneFleet=value;host.dataset.taskRobotMotion=JSON.stringify(demoMotions.map(m=>({...m,position:robots[m.zone]?.position.toArray(),arm:axes[m.zone]?.arm.position.z,slider:axes[m.zone]?.slider.position.y})));}
 },dispose(){disposed=true;detachFleet();window.removeEventListener('zone-fleet-focus',follow);group.removeFromParent();
  const gs=new Set<THREE.BufferGeometry>(),ms=new Set<THREE.Material>();group.traverse(n=>{if(n instanceof THREE.Mesh){gs.add(n.geometry);(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>ms.add(m));}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());
 }};
}
