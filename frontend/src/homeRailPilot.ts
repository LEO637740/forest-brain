import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectHomeRailTarget} from './homeRailReachability';
import {railTreeAnchors} from './debug/railTreeAnchors';
import {mountHomeRailRehearsal} from './homeRailRehearsal';
import {installHomeRailRow} from './homeRailRow';
import {railSegments} from './railSegments';
import {matchesRailTree} from './railFixture';

type Tree={x:number;z:number;rotation:number;scale:number;archetype:string};
type Road={points:THREE.Vector2[];width:number;shoulderWidth:number};
export function planHomeRailPilot(trees:Tree[],roads:Road[],height:(x:number,z:number)=>number){
  const candidates=trees.flatMap((tree,index)=>{
    if(tree.archetype!=='B'||Math.abs(tree.scale-1)>.025)return [];
    const c=Math.cos(tree.rotation),s=Math.sin(tree.rotation);
    // Offset from the unchanged tree, facing its authored +Z panel side.
    const ox=.22*tree.scale,oz=1.4638956627*tree.scale;
    const root={x:tree.x+c*ox+s*oz,z:tree.z-s*ox+c*oz};
    const point=(x:number,z:number)=>({x:root.x+c*x+s*z,z:root.z-s*x+c*z});
    const samples=Array.from({length:49},(_,i)=>point(-4.8+i*.2,0));
    const heights=samples.map(p=>height(p.x,p.z));
    const rise=Math.max(...heights)-Math.min(...heights);
    if(rise>.45)return [];
    let clearance=Infinity;
    for(const p of samples){
      for(const [j,t] of trees.entries())if(j!==index)clearance=Math.min(clearance,Math.hypot(p.x-t.x,p.z-t.z)-.65);
      for(const road of roads)for(let k=1;k<road.points.length;k++){
        const a=road.points[k-1],b=road.points[k],dx=b.x-a.x,dz=b.y-a.y;
        const u=THREE.MathUtils.clamp(((p.x-a.x)*dx+(p.z-a.y)*dz)/(dx*dx+dz*dz),0,1);
        clearance=Math.min(clearance,Math.hypot(p.x-a.x-u*dx,p.z-a.y-u*dz)-road.width/2-road.shoulderWidth);
      }
    }
    if(clearance<1.2)return [];
    // Feet rest on individual piers; the rails stay straight and level.
    const feet=[-3.2,0,3.2].flatMap(segment=>[-1.18,1.18].flatMap(x=>[-.26,.26].map(z=>({x:segment+x,z}))));
    const footHeights=feet.map(p=>{const w=point(p.x,p.z);return height(w.x,w.z);});
    const y=Math.max(...heights,...footHeights)+.035;
    return [{index,tree,root:{...root,y},rotation:tree.rotation,rise,clearance,feet:feet.map((p,i)=>({...p,depth:y-footHeights[i]})),
      score:rise*8+Math.abs(tree.scale-1)*15+Math.hypot(tree.x-42,tree.z-28)*.008}];
  });
  return candidates.sort((a,b)=>a.score-b.score)[0]??null;
}

export function installHomeRailPilot(scene:THREE.Scene,host:HTMLElement,trees:Tree[],roads:Road[],height:(x:number,z:number)=>number,onFocus:(p:THREE.Vector3,r:number,detail?:boolean,wide?:boolean)=>void,onLoaded:()=>void,treeBaseHeight=height){
  const plan=planHomeRailPilot(trees,roads,height),root=new THREE.Group();root.name='HOME_RAIL_PILOT_STATIC';
  const panel=document.createElement('aside');panel.setAttribute('aria-label','轨道试点');
  panel.style.cssText='position:absolute;top:280px;right:clamp(16px,22vw,440px);z-index:8;background:#10271ff2;color:#eef7f0;padding:16px;border:1px solid #648174;border-radius:8px;font:14px Microsoft YaHei;width:260px;max-width:calc(100% - 32px);max-height:max(160px,calc(100% - 540px));overflow:auto;box-sizing:border-box';
  panel.textContent=plan?'轨道试点 · 正在载入':'未找到满足道路和坡度条件的试点';host.append(panel);
  let disposed=false;
  let rehearsal:ReturnType<typeof mountHomeRailRehearsal>|undefined;
  const rows:ReturnType<typeof installHomeRailRow>[]=[];
  const publishReady=()=>window.dispatchEvent(new CustomEvent('home-rail-preview-status',{detail:!!rehearsal&&!disposed}));
  const startPreview=(event:Event)=>{if((event as CustomEvent).detail===44&&plan?.index===44)rehearsal?.start();};
  window.addEventListener('home-rail-preview-query',publishReady);
  window.addEventListener('home-rail-preview-start',startPreview);
  const cleanup=(group:THREE.Object3D)=>{const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();group.traverse(n=>{if(n instanceof THREE.Mesh){geometries.add(n.geometry);(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>materials.add(m));}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());};
  if(plan){
    root.position.set(plan.root.x,plan.root.y,plan.root.z);root.rotation.y=plan.rotation;
    const loader=new GLTFLoader();
    void Promise.all([loader.loadAsync('/assets/robot/rail-r4/robot_runtime.glb'),loader.loadAsync('/assets/robot/rail-r4/rail_segment.glb')]).then(([robot,rail])=>{
      if(disposed){cleanup(robot.scene);cleanup(rail.scene);return;}
      robot.scene.position.x=.0846424041;root.add(robot.scene);
      for(const x of [-3.2,0,3.2]){const segment=rail.scene.clone(true);segment.position.x=x;root.add(segment);}
      const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#767c70',roughness:.95});
      for(const foot of plan.feet){const pier=new THREE.Mesh(geometry,material);pier.scale.set(.24,foot.depth+.04,.23);pier.position.set(foot.x,-(foot.depth+.04)/2,foot.z);root.add(pier);}
      root.traverse(n=>{if(n instanceof THREE.Mesh){n.castShadow=true;n.receiveShadow=true;}});scene.add(root);
      const id=`HN-${'ABCD'[Math.floor(plan.index/50)]}-${String(plan.index%50+1).padStart(4,'0')}`;
      panel.textContent=`轨道试点 · ${id}`;
      const debug=document.createElement('details'),summary=document.createElement('summary');summary.textContent='调试信息';summary.style.cssText='cursor:pointer;padding:10px 0';debug.append(summary);
      debug.addEventListener('toggle',()=>{if(!debug.open){markers.visible=false;legend.hidden=true;inspect.textContent='检查候选接近点';}});
      const note=document.createElement('div');note.textContent=`3 段直轨 / 9.6 米 · 地面高差 ${plan.rise.toFixed(2)} 米`;note.style.margin='8px 0';debug.append(note);
      const button=document.createElement('button');button.textContent='查看停靠近景';button.style.cssText='background:#89ddba;color:#10271f;border:0;border-radius:4px;padding:8px 12px;cursor:pointer;font:inherit';
      button.onclick=()=>onFocus(new THREE.Vector3(plan.root.x,plan.root.y+1.4,plan.root.z),plan.rotation);debug.append(button);
      panel.dataset.treeIndex=String(plan.index);panel.dataset.status='static-ready';panel.dataset.collisionApproval='not-validated';
      panel.dataset.plan=JSON.stringify({index:plan.index,root:plan.root,rotation:plan.rotation,treeScale:plan.tree.scale,rise:plan.rise,coarseClearance:plan.clearance,executionApproved:false});
      const reach=inspectHomeRailTarget(plan.tree,treeBaseHeight(plan.tree.x,plan.tree.z),{...plan.root,rotation:plan.rotation},railTreeAnchors[0].local);
      panel.dataset.reachability=JSON.stringify(reach);
      const result=document.createElement('div');result.style.cssText='margin-top:8px;font-size:13px;line-height:1.5';
      result.textContent=reach.axisRangesPassed?'原点在名义行程内':`原点不可达 · ${reach.violations.map(v=>`${v.axis==='sliderOffset'?'竖向行程':v.axis}差 ${(v.excessM*1000).toFixed(0)} 毫米`).join('；')}`;
      debug.append(result);
      // Review overlay only: no tree edits, picking targets or robot motion.
      const candidate=inspectHomeRailTarget(plan.tree,treeBaseHeight(plan.tree.x,plan.tree.z),{...plan.root,rotation:plan.rotation},[.0936395297793764,1.654399189035007,.24764717068563352]);
      panel.dataset.candidate=JSON.stringify(candidate);
      const markers=new THREE.Group();markers.name='HOME_RAIL_POINT_REVIEW';markers.visible=false;root.add(markers);
      const markerGeometry=new THREE.SphereGeometry(.022,12,8);
      [reach,candidate].forEach((point,i)=>{
        const marker=new THREE.Mesh(markerGeometry,new THREE.MeshBasicMaterial({color:i?'#39efff':'#ffbd59'}));
        marker.position.fromArray(point.railLocalSurface);marker.position.z+=.008;
        marker.raycast=()=>{};markers.add(marker);
      });
      const inspect=document.createElement('button');inspect.textContent='检查候选接近点';inspect.style.cssText=button.style.cssText+';margin:8px 0 0';
      const legend=document.createElement('div');legend.hidden=true;legend.style.cssText='margin-top:8px;line-height:1.5';
      legend.textContent='青色：较高候选点 · 橙色：原点\n仅检查位置，不执行割胶';legend.style.whiteSpace='pre-line';
      inspect.onclick=()=>{markers.visible=!markers.visible;legend.hidden=!markers.visible;inspect.textContent=markers.visible?'隐藏点位标记':'检查候选接近点';if(markers.visible)onFocus(new THREE.Vector3().fromArray(candidate.world),plan.rotation,true);};
      debug.append(inspect,legend);
      // Fail closed when placement changes: sampled review applies to this fixture only.
      const expected=[44,-80.39244198894549,-1.9158591362384896,-13.883642384512047,4.840850878812679,.9850355299562216,-2.0631169048429263];
      const actual=[plan.index,plan.root.x,plan.root.y,plan.root.z,plan.rotation,plan.tree.scale,reach.treeBaseY];
      const reviewed=actual.every((v,i)=>Math.abs(v-expected[i])<1e-7)&&candidate.axisRangesPassed;
      panel.dataset.previewFixture=reviewed?'matched':'changed';
      if(reviewed)rehearsal=mountHomeRailRehearsal(robot.scene,panel,onLoaded,()=>{
        rows.forEach(row=>row.pause());
        markers.visible=debug.open;legend.hidden=!debug.open;inspect.textContent=debug.open?'隐藏点位标记':'检查候选接近点';
        onFocus(new THREE.Vector3().fromArray(candidate.world),plan.rotation,true);
      });
      panel.append(debug);
      if(new URLSearchParams(location.search).get('jointRow')!=='0')for(const segment of railSegments){
        const row=installHomeRailRow(scene,panel,(p,r)=>onFocus(p,r,false,true),onLoaded,()=>{rehearsal?.pause();rows.forEach(other=>{if(other!==row)other.pause();});},segment,source=>matchesRailTree(source,trees,treeBaseHeight));
        rows.push(row);
      }
      publishReady();
      onLoaded();
    }).catch(e=>{if(!disposed){panel.textContent='轨道试点加载失败';panel.dataset.status='error';console.error('Home rail pilot',e);}});
  }
  return {plan,update:(dt:number)=>{rehearsal?.update(dt);rows.forEach(row=>row.update(dt));},dispose:()=>{disposed=true;publishReady();window.removeEventListener('home-rail-preview-query',publishReady);window.removeEventListener('home-rail-preview-start',startPreview);rehearsal?.dispose();rows.forEach(row=>row.dispose());panel.remove();root.removeFromParent();cleanup(root);}};
}
