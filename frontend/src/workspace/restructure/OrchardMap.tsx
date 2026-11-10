import {useScenario,indexOf,valid} from '../../integration/client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ArrowLeft, Minus, Plus, RotateCcw, Maximize2 } from 'lucide-react';
import { sites, treeAlias, taskTreeIndices, type Site, type Task } from '../model';
import { getRecentLatex } from '../AnalyticsPage';
import { heightAt, layerInfo, roads, spatialTrees, zoneCenters, type SpatialLayer } from './orchardSpatial';
import { sceneZoneBox } from '../../sceneTreeLayout'
import './orchard-map.css';
import { rainAt, rainBase, rainDomain } from './rainSpatial';
import { frequencyCells, hexRadius } from './spatialAggregation';

type Command={zoom:(factor:number)=>void;reset:()=>void;focus:(x:number,z:number,close?:boolean)=>void};
export function OrchardMap({site,tasks,onBack,onTree}:{site:Site;tasks:Task[];onBack:()=>void;onTree:(index:number)=>void}) {
  const host=useRef<HTMLDivElement>(null), outer=useRef<HTMLDivElement>(null), commands=useRef<Command|null>(null);
  const [layer,setLayer]=useState<SpatialLayer>('base'),[canopy,setCanopy]=useState(true),[boundaries,setBoundaries]=useState(true);
  const [hour,setHour]=useState(6),[top,setTop]=useState(false);
  const [selected,setSelected]=useState<number|null>(null),[zone,setZone]=useState<number|null>(null),[cell,setCell]=useState<number|null>(null);
  const [status,setStatus]=useState('正在加载园区模型…'),[expanded,setExpanded]=useState(false);
  const health=useScenario('park-health',site);
  const healthReady=health.result.data?.status==='succeeded'&&health.result.data.strategy.kind==='pest_risk'&&valid(health.result.data.strategy);
  const riskByIndex:Record<number,number>={}; if(health.result.data?.status==='succeeded'&&valid(health.result.data.strategy)&&health.result.data.strategy.kind==='pest_risk')for(const f of health.result.data.strategy.proposal.findings){const i=indexOf(f.treeId);if(i!==undefined)riskByIndex[i]=f.riskLevel==='review'?2:1;}
  const latest=useRef({layer,canopy,boundaries,hour,top,tasks,selected,cell,riskByIndex,healthReady});
  latest.current={layer,canopy,boundaries,hour,top,tasks,selected,cell,riskByIndex,healthReady};
  const refresh=useRef<(()=>void)|null>(null);
  useEffect(()=>{refresh.current?.();},[layer,canopy,boundaries,hour,top,tasks,selected,cell,health.result.data]);
  useEffect(()=>{
    if(!host.current)return;
    const container=host.current,scene=new THREE.Scene();scene.background=new THREE.Color('#1b2429');
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});}catch{setStatus('当前浏览器无法启用 WebGL，请返回园区地图。');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label',`可旋转的${sites[site]}三维主题图` );
    const camera=new THREE.PerspectiveCamera(38,1,.5,1800);camera.position.set(110,190,225);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);
    controls.enableDamping=true;controls.minDistance=35;controls.maxDistance=600;
    controls.minPolarAngle=.05;controls.maxPolarAngle=Math.PI*.43;
    controls.enablePan=true;controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
    scene.add(new THREE.HemisphereLight('#e3ebef','#5e6351',2.3));
    const sun=new THREE.DirectionalLight('#fff5de',3);sun.position.set(-130,220,-80);scene.add(sun);
    const ground=new THREE.Group(),crowns=new THREE.Group(),overlay=new THREE.Group(),borders=new THREE.Group(),labels=new THREE.Group();
    scene.add(ground,crowns,overlay,borders,labels);
    const geometry=new THREE.PlaneGeometry(300,210,150,105);geometry.rotateX(-Math.PI/2);
    const pos=geometry.attributes.position,colors=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++)pos.setY(i,heightAt(pos.getX(i),pos.getZ(i)));
    geometry.computeVertexNormals();
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const material=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
    const terrain=new THREE.Mesh(geometry,material);ground.add(terrain);
    // A cut-earth plinth makes the map read as a miniature terrain model.
    const rim:number[][]=[];
    for(let x=-150;x<=150;x+=3)rim.push([x,-105]);
    for(let z=-102;z<=105;z+=3)rim.push([150,z]);
    for(let x=147;x>=-150;x-=3)rim.push([x,105]);
    for(let z=102;z>=-105;z-=3)rim.push([-150,z]);
    const sideVertices:number[]=[],sideColors:number[]=[];
    rim.forEach(([x,z],i)=>{const [nx,nz]=rim[(i+1)%rim.length];
      const points=[[x,heightAt(x,z),z],[nx,heightAt(nx,nz),nz],[x,-16,z],[nx,heightAt(nx,nz),nz],[nx,-16,nz],[x,-16,z]];
      points.forEach(p=>{sideVertices.push(...p);sideColors.push(...(p[1]===-16?[.11,.12,.105]:[.29,.27,.21]));});
    });
    const sideGeometry=new THREE.BufferGeometry();sideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(sideVertices,3));sideGeometry.setAttribute('color',new THREE.Float32BufferAttribute(sideColors,3));sideGeometry.computeVertexNormals();
    ground.add(new THREE.Mesh(sideGeometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide})));
    const plinth=new THREE.Mesh(new THREE.BoxGeometry(304,2.8,214),new THREE.MeshStandardMaterial({color:'#293536',roughness:.9}));plinth.position.y=-17.5;ground.add(plinth);
    for(const y of [-6,-10,-14]){const points=rim.map(([x,z])=>new THREE.Vector3(x,y,z));points.push(points[0]);ground.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#6b6b57',transparent:true,opacity:.4})));}
    function line(points:number[][],color:string,parent:THREE.Group,dashed=false,lift=.4) {
      const curve=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,heightAt(x,z)+lift,z)));
      const g=new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
      const m=dashed?new THREE.LineDashedMaterial({color,dashSize:2,gapSize:1.4}):new THREE.LineBasicMaterial({color});
      const l=new THREE.Line(g,m);l.computeLineDistances();parent.add(l);return l;
    }
    roads.forEach(r=>{
      const curve=new THREE.CatmullRomCurve3(r.points.map(([x,z])=>new THREE.Vector3(x,0,z)));
      const pts=curve.getPoints(120),verts:number[]=[],ids:number[]=[];
      pts.forEach((p,i)=>{const d=curve.getTangent(i/120),dx=-d.z*r.width/2,dz=d.x*r.width/2;for(const s of [-1,1]){const x=p.x+dx*s,z=p.z+dz*s;verts.push(x,heightAt(x,z)+.12,z);}if(i<120){const a=i*2;ids.push(a,a+2,a+1,a+1,a+2,a+3);}});
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(ids);g.computeVertexNormals();
      ground.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#ab9f84',roughness:1,side:THREE.DoubleSide})));
    });
    const zonePolygons=zoneCenters.map((_,zone)=>{const b=sceneZoneBox(spatialTrees,zone);return [[b.x-b.w/2,b.z-b.d/2],[b.x+b.w/2,b.z-b.d/2],[b.x+b.w/2,b.z+b.d/2],[b.x-b.w/2,b.z+b.d/2],[b.x-b.w/2,b.z-b.d/2]];});
    zonePolygons.forEach(p=>line(p,'#dee7de',borders,false,.55));
    line([[-123,-66],[-56,-72],[17,-70],[117,-56],[131,2],[114,48],[60,64],[-15,70],[-118,59],[-130,4],[-123,-66]],'#bed7c7',borders,true,.6);
    const pickables:THREE.Object3D[]=[];
    function label(text:string,x:number,z:number,color='#192b25',kind='zone',index=0) {
      const c=document.createElement('canvas');c.width=384;c.height=96;
      const ctx=c.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,384,96);
      ctx.strokeStyle='#a4b9ab';ctx.lineWidth=3;ctx.strokeRect(1,1,382,94);
      ctx.fillStyle='#f0f2ee';ctx.font='500 35px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillText(text,192,61);
      const map=new THREE.CanvasTexture(c),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false,toneMapped:false}));
      sprite.position.set(x,heightAt(x,z)+18,z);sprite.scale.set(33,8.25,1);sprite.userData={kind,index};labels.add(sprite);pickables.push(sprite);return sprite;
    }
    const zoneLabels=zoneCenters.map((c,i)=>label(`${'ABCD'[i]}区 · 50 棵`,c.x,c.z-24,'#192b25','zone',i));

    const selection=new THREE.Box3Helper(new THREE.Box3(),0xe7d1a0);scene.add(selection);selection.visible=false;
    const pins=new THREE.InstancedMesh(new THREE.SphereGeometry(1.1,10,8),new THREE.MeshBasicMaterial({color:'#ffffff'}),200);
    overlay.add(pins);pickables.push(pins);pins.userData.kind='tree';
    const tmp=new THREE.Object3D(),col=new THREE.Color(),workLines=new THREE.Group();overlay.add(workLines);
    const riskLabels=[label('B区 · 8 棵待巡检',-16,-28,'#52332b','zone',1),label('C区 · 4 棵关注',44,30,'#514832','zone',2)];riskLabels.forEach(n=>{n.position.y+=15;n.userData.pixelWidth=126;});
    const hexagons=new THREE.InstancedMesh(new THREE.CylinderGeometry(hexRadius*.92,hexRadius*.92,1,6),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.85,toneMapped:false}),frequencyCells.length);overlay.add(hexagons);pickables.push(hexagons);hexagons.userData.kind='hex';
    const hexSelection=new THREE.LineSegments(new THREE.EdgesGeometry(hexagons.geometry),new THREE.LineBasicMaterial({color:'#f4d29b',toneMapped:false}));hexSelection.matrixAutoUpdate=false;overlay.add(hexSelection);
    const loadedMaterials:THREE.Material[]=[];let disposed=false;
    Promise.all(['A','B','C'].map(async archetype=>{
      const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/assets/trees/mature-family-v1/RT_Mature_${archetype}_LOD2.glb`);
      if(disposed){gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});return;}
      gltf.scene.updateMatrixWorld(true);
      const records=spatialTrees.filter(t=>t.archetype===archetype);
      gltf.scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
        const mats=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{const clone=m.clone();loadedMaterials.push(clone);return clone;});
        const mesh=new THREE.InstancedMesh(o.geometry.clone(),Array.isArray(o.material)?mats:mats[0],records.length);
        records.forEach((t,i)=>{tmp.position.set(t.x,heightAt(t.x,t.z),t.z);tmp.rotation.set(0,t.rotation,0);tmp.scale.setScalar(t.scale);tmp.updateMatrix();mesh.setMatrixAt(i,tmp.matrix.clone().multiply(o.matrixWorld));});
        mesh.userData={kind:'model',indices:records.map(t=>t.index)};crowns.add(mesh);pickables.push(mesh);
      });
    })).then(()=>{if(!disposed){update();setStatus('树冠模型已载入');}}).catch(()=>{if(!disposed)setStatus('部分树冠未载入，树位与图层仍可使用');});
    let lastTop=false;
    function clearGroup(g:THREE.Group){g.traverse(o=>{if(o instanceof THREE.Line||o instanceof THREE.Mesh){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});g.clear();}
    function update(){
      const s=latest.current,info=layerInfo[s.layer];
      crowns.visible=s.canopy&&s.layer!=='density';borders.visible=s.boundaries;
      pins.visible=!s.canopy&&s.layer!=='density';riskLabels.forEach(n=>n.visible=false);
      zoneLabels.forEach((sprite,i)=>{
        sprite.visible=true;
        const c=zoneCenters[i];sprite.position.set(c.x,heightAt(c.x,c.z)+ (s.layer==='density'?32:18),c.z-24);
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d')!;
        const trees=spatialTrees.filter(t=>t.zone===i),siteTotal=getRecentLatex(site,7)??0,sum=spatialTrees.reduce((n,t)=>n+t.yieldWeight,0);
        const zoneTasks=s.tasks.filter(t=>t.site===site&&t.block.startsWith('ABCD'[i])&&t.status!=='已取消');
        const metric=s.layer==='yield'?`${(trees.reduce((n,t)=>n+t.yieldWeight,0)/sum*siteTotal).toFixed(1)} kg / 7 日`:s.layer==='health'?(s.healthReady?`${trees.filter(t=>(s.riskByIndex[t.index]??0)>0).length} 棵关注树`:'健康结果不可用'):s.layer==='density'?`均值 ${(trees.reduce((n,t)=>n+t.frequency,0)/50).toFixed(1)} 次 / 30 日`:s.layer==='weather'?`${(trees.reduce((sum,t)=>sum+rainAt(t.x,t.z,s.hour),0)/trees.length).toFixed(2)} mm · 空间样本`:s.layer==='work'?`${zoneTasks.length} 项任务 / ${zoneTasks.filter(t=>t.status==='已完成').length} 完成`:'50 棵管理树';
        ctx.fillStyle='#17262bee';ctx.fillRect(0,0,512,128);ctx.fillStyle=info.colors[2];ctx.fillRect(0,0,6,128);
        ctx.fillStyle='#eef3ed';ctx.textAlign='center';ctx.font='bold 34px "Microsoft YaHei"';ctx.fillText(`${'ABCD'[i]} 区`,256,49);ctx.font='27px "Microsoft YaHei"';ctx.fillText(metric,256,96);
        sprite.material.map?.dispose();sprite.material.map=new THREE.CanvasTexture(canvas);sprite.userData.pixelWidth=110;sprite.scale.set(36,9,1);sprite.material.needsUpdate=true;
      });
      const states=new Map<number,string>();
      s.tasks.filter(t=>t.site===site&&t.status!=='已取消').forEach(t=>taskTreeIndices(t).forEach(i=>states.set(i,t.status)));
      for(let i=0;i<pos.count;i++){
        const x=pos.getX(i),z=pos.getZ(i),noise=(Math.sin(x*.11)+Math.cos(z*.08))*.003;
        col.setRGB(.15+noise,.19+noise,.12+noise);
        if(s.layer==='slope'){
          const v=Math.max(0,Math.min(1,(heightAt(x,z)+10)/20));
          const a=new THREE.Color(info.colors[v<.5?0:1]),b=new THREE.Color(info.colors[v<.5?1:2]);a.lerp(b,v<.5?v*2:(v-.5)*2);col.copy(a);
        }
        if(s.layer==='weather'){
          const domain=rainDomain(s.hour),v=(rainAt(x,z,s.hour)-domain.min)/(domain.max-domain.min);
          if(domain.base===0)col.set('#8d9c9e');else{const value=Math.max(0,Math.min(1,v)),a=new THREE.Color(info.colors[value<.5?0:1]),b=new THREE.Color(info.colors[value<.5?1:2]);col.copy(a.lerp(b,value<.5?value*2:(value-.5)*2));}
        }
        const normal=geometry.attributes.normal;const shade=.78+.22*Math.max(0,normal.getY(i)*.85-normal.getX(i)*.4-normal.getZ(i)*.3);col.multiplyScalar(shade);colors[i*3]=col.r;colors[i*3+1]=col.g;colors[i*3+2]=col.b;
      }
      geometry.attributes.color.needsUpdate=true;
      function treeColor(index:number){const t=spatialTrees[index],state=states.get(index);
        if(s.layer==='health')return new THREE.Color(s.healthReady?info.colors[s.riskByIndex[t.index]??0]:'#606866');
        if(s.layer==='yield')return new THREE.Color(info.colors[0]).lerp(new THREE.Color(info.colors[2]),t.yieldWeight-.6);
        if(s.layer==='work')return new THREE.Color(state==='已完成'?info.colors[0]:state==='待处理'?info.colors[2]:state?info.colors[1]:'#626f69');
        return new THREE.Color(['density','weather','slope'].includes(s.layer)?'#717b76':'#b1b9a7');
      }
      crowns.traverse(o=>{if(!(o instanceof THREE.InstancedMesh))return;(o.userData.indices as number[]).forEach((index,i)=>o.setColorAt(i,treeColor(index)));if(o.instanceColor)o.instanceColor.needsUpdate=true;});
      spatialTrees.forEach((t,i)=>{tmp.position.set(t.x,heightAt(t.x,t.z)+1.5,t.z);tmp.rotation.set(0,0,0);tmp.scale.setScalar(1);tmp.updateMatrix();pins.setMatrixAt(i,tmp.matrix);pins.setColorAt(i,treeColor(i));});pins.instanceMatrix.needsUpdate=true;if(pins.instanceColor)pins.instanceColor.needsUpdate=true;
      hexagons.visible=s.layer==='density';
      frequencyCells.forEach((c,i)=>{const h=c.mean*4;let floor=heightAt(c.x,c.z);for(let k=0;k<6;k++)floor=Math.max(floor,heightAt(c.x+Math.sin(k*Math.PI/3)*hexRadius,c.z+Math.cos(k*Math.PI/3)*hexRadius));tmp.position.set(c.x,floor+.3+h/2,c.z);tmp.rotation.set(0,0,0);tmp.scale.set(1,h,1);tmp.updateMatrix();hexagons.setMatrixAt(i,tmp.matrix);hexagons.setColorAt(i,new THREE.Color('#a5d2c6').lerp(new THREE.Color('#246b64'),(c.mean-2)/4));});hexagons.instanceMatrix.needsUpdate=true;if(hexagons.instanceColor)hexagons.instanceColor.needsUpdate=true;
      hexSelection.visible=s.layer==='density'&&s.cell!==null;if(s.cell!==null)hexagons.getMatrixAt(s.cell,hexSelection.matrix);

      clearGroup(workLines);
      if(s.layer==='work')s.tasks.filter(t=>t.site===site&&t.status!=='已取消').slice(-14).forEach(t=>{const points=taskTreeIndices(t).map(i=>spatialTrees[i]).filter(Boolean).map(p=>[p.x,p.z]);if(points.length>1){const color=t.status==='已完成'?'#81cba5':t.status==='待处理'?'#cfb379':'#9eabb1';line(points,color,workLines,t.status!=='已完成',2);const a=points[0],b=points[1],dir=new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]).normalize();workLines.add(new THREE.ArrowHelper(dir,new THREE.Vector3(a[0],heightAt(a[0],a[1])+3,a[1]),5,new THREE.Color(color),2,1.5));}});
      if(false)riskLabels.forEach(n=>{const p=n.position;workLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x,heightAt(p.x,p.z)+10,p.z),p]),new THREE.LineBasicMaterial({color:'#d4b294'})));});
      selection.visible=s.selected!==null;if(s.selected!==null){const t=spatialTrees[s.selected],y=heightAt(t.x,t.z);selection.box.set(new THREE.Vector3(t.x-3,y,t.z-3),new THREE.Vector3(t.x+3,y+17,t.z+3));}
      if(lastTop!==s.top){camera.position.copy(controls.target).add(s.top?new THREE.Vector3(0,290,.01):new THREE.Vector3(110,190,225));lastTop=s.top;}
    }
    refresh.current=update;update();
    commands.current={zoom:f=>{camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);camera.position.sub(controls.target).clampLength(35,600).add(controls.target);controls.update();},reset:()=>{controls.target.set(0,0,0);camera.position.set(110,190,225);setTop(false);setSelected(null);setZone(null);setCell(null);},focus:(x,z,close=false)=>{controls.target.set(x,heightAt(x,z),z);camera.position.copy(controls.target).add(new THREE.Vector3(close?20:45,close?48:100,close?45:100));}};
    const ray=new THREE.Raycaster();let down={x:0,y:0};
    const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
    const pointerUp=(e:PointerEvent)=>{
      if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
      const b=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);
      const hit=ray.intersectObjects(pickables.filter(o=>o.visible&&o.parent?.visible),false)[0];if(!hit)return;
      const d=hit.object.userData;
      if(d.kind==='zone'){setZone(d.index);setSelected(null);setCell(null);const c=zoneCenters[d.index];commands.current?.focus(c.x,c.z);}
      else if(d.kind==='hex'){setCell(hit.instanceId??null);setSelected(null);setZone(null);}
      else{const i=d.kind==='tree'?hit.instanceId:d.indices?.[hit.instanceId??0];if(i===undefined)return;setSelected(i);setZone(spatialTrees[i].zone);setCell(null);}
    };
    renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
    const resize=()=>{const w=container.clientWidth,h=container.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const contextLost=(e:Event)=>{e.preventDefault();setStatus('图形上下文已中断，请返回园区地图后重新进入');};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    let frame=0,lastFrame=0;const tick=(now=0)=>{frame=requestAnimationFrame(tick);if(now-lastFrame<32)return;lastFrame=now;controls.update();
      [...zoneLabels,...riskLabels].forEach(sprite=>{const pixels=sprite.userData.pixelWidth??105,unit=2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.position.distanceTo(sprite.position)/Math.max(1,container.clientHeight);const image=sprite.material.map?.image as {width:number;height:number}|undefined;const aspect=image?image.width/image.height:4;sprite.scale.set(pixels*unit,pixels/aspect*unit,1);});renderer.render(scene,camera);};tick();
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();refresh.current=null;commands.current=null;renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      const textures=new Set<THREE.Texture>();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.Sprite){if('geometry'in o)o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v);});m.dispose();});}});textures.forEach(t=>t.dispose());loadedMaterials.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();};
  },[]);
  const info=layerInfo[layer],tree=selected===null?null:spatialTrees[selected];
  const bin=cell===null?null:frequencyCells[cell];
  const rainScale=rainDomain(hour);
  const total=getRecentLatex(site,7)??0,weights=spatialTrees.reduce((s,t)=>s+t.yieldWeight,0);
  return <div className={`orchard ${expanded?'orchard-expanded':''}`} ref={outer}>
    <header className="orchard-header"><button onClick={onBack}><ArrowLeft size={14}/>返回园区地图</button><strong>{sites[site]} / 三维主题图层</strong><span>演示样本</span><button onClick={()=>setExpanded(v=>!v)} aria-label={expanded?'退出地图大图':'展开地图'}><Maximize2 size={15}/></button></header>
    <p className="orchard-notice">场景采用统一模拟地形、道路与树位，不代表当前园区实测；图层数据与来源请查看说明。</p>
    <div className="orchard-layers" role="group" aria-label="园区主题图层">{(Object.keys(layerInfo) as SpatialLayer[]).map(key=><button key={key} aria-pressed={layer===key} onClick={()=>{setLayer(key);setCell(null);}}>{layerInfo[key].title}</button>)}</div>
    <div className="orchard-stage"><div ref={host} className="orchard-webgl"/>
      {status!=='树冠模型已载入'&&<div className="orchard-status" role="status">{status}</div>}
      <div className="orchard-caption"><strong>{info.title}</strong><span>{info.source}</span></div>
      <div className="orchard-view"><button aria-pressed={top} onClick={()=>setTop(v=>!v)}>{top?'切换斜俯视':'切换正俯视'}</button><button aria-label="放大园区" onClick={()=>commands.current?.zoom(.75)}><Plus size={17}/></button><button aria-label="缩小园区" onClick={()=>commands.current?.zoom(1.3)}><Minus size={17}/></button><button aria-label="重置园区视角" onClick={()=>commands.current?.reset()}><RotateCcw size={16}/></button></div>
      <div className="orchard-legend">{layer==='weather'?<div className="orchard-rain-legend"><strong>{rainScale.base===0?'无降雨 · 0.00 mm':'降雨量 · 局部差异放大'}</strong><div style={{background:rainScale.base===0?'#8d9c9e':`linear-gradient(90deg, ${info.colors.join(',')})`}}/>{rainScale.base>0&&<section>{[0,.25,.5,.75,1].map(v=><span key={v}>{(rainScale.min+(rainScale.max-rainScale.min)*v).toFixed(2)}</span>)}</section>}<small>mm · 色阶约 0.05 mm；非传感器精度</small></div>:info.legend.map((name,i)=><span key={name}><i style={{background:info.colors[i]}}/>{name}</span>)}</div>
      <div className="orchard-help">拖动旋转 · 右键平移 · 滚轮缩放 · 点击树冠、六边形或区名</div>
    </div>
    <div className="orchard-options"><label><input type="checkbox" disabled={layer==='density'} checked={canopy&&layer!=='density'} onChange={e=>setCanopy(e.target.checked)}/>树冠</label><label><input type="checkbox" checked={boundaries} onChange={e=>setBoundaries(e.target.checked)}/>边界</label></div>
    {layer==='weather'&&<div className="orchard-time"><span>查看时刻 {String(hour).padStart(2,'0')}:00</span><input aria-label="气象时刻" type="range" min="4" max="14" step="1" value={hour} onChange={e=>setHour(+e.target.value)}/><strong>序列参考 {rainBase(hour).toFixed(2)} mm</strong><span>固定演示序列 + 空间样本，非当前园区天气</span></div>}
    {layer==='density'&&<div className="orchard-time"><span>柱高 = 平均割胶次数 · 近 30 日</span><select aria-label="选择频次聚合单元" value={cell??''} onChange={e=>{const i=Number(e.target.value);setCell(i);setSelected(null);setZone(null);commands.current?.focus(frequencyCells[i].x,frequencyCells[i].z);}}><option value="" disabled>点击六边形查看树数、树次与均值</option>{frequencyCells.map((c,i)=><option key={c.id} value={i}>单元 {i+1} · {c.indices.length} 棵 · {c.mean.toFixed(2)} 次/树</option>)}</select><span>聚合模式 · 树冠暂隐</span></div>}
    <div className="orchard-zonebar">{zoneCenters.map((c,i)=><button key={i} aria-pressed={zone===i} onClick={()=>{setZone(i);setSelected(null);setCell(null);commands.current?.focus(c.x,c.z);}}>{'ABCD'[i]}区 <span>50 棵</span></button>)}</div>
    <div className="orchard-detail">{layer==='health'&&!healthReady&&<p>本轮健康结果暂不可用</p>}<div><small>{bin?'六边形聚合单元':tree?'单树空间档案':zone!==null?'作业区概况':'空间图层说明'}</small><strong>{bin?`平均 ${bin.mean.toFixed(2)} 次 / 树`:tree?treeAlias(tree.index,site):zone!==null?`${'ABCD'[zone]}区 · 50 棵管理树`:info.title}</strong><p>{layer==='weather'?`${String(hour).padStart(2,'0')}:00 · ${tree?treeAlias(tree.index,site)+' 位置样本 '+rainAt(tree.x,tree.z,hour).toFixed(2)+' mm；':''}参考序列 ${rainBase(hour).toFixed(2)} mm，空间差异为统一演示样本。色阶放大显示约 ±0.10 mm 范围内的差异；切换时刻会同步更新数值和图例，不代表测量精度提升。`:bin?`${bin.indices.length} 棵树 · 累计 ${bin.total} 树次 · 近 30 日；柱高表示均值，不代表树高。`:tree?`近 7 日分配样本 ${(total*tree.yieldWeight/weights).toFixed(2)} kg · 近 30 日频次样本 ${tree.frequency} 次 · ${!healthReady?'健康结果不可用':riskByIndex[tree.index]===2?'待巡检':riskByIndex[tree.index]===1?'关注':'未触发本轮规则'}`:info.description}</p></div>{tree&&<div className="orchard-detail-actions"><button onClick={()=>commands.current?.focus(tree.x,tree.z,true)}>聚焦这棵树</button><button onClick={()=>onTree(tree.index)}>打开三维档案 →</button></div>}</div>
    <footer>{status} · 统一模拟地形、道路、树位与分区边界，非当前园区测绘或遥感影像。主题数据来源见图层说明。</footer>
  </div>;
}




