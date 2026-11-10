import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import type {ContextSnapshot} from './contracts';
import {alias,useRead} from './client';
import {recordTime,recordSource} from './treeEvidence';
import {growthComparisonInput,type GrowthStrategy} from './growthComparisonModel';
import {bakeWorldGeometry,circumferenceRadius,cutPoint,predictionDelta,trunkSection} from './growthGeometry';
import './growthComparison.css';

function disposeObjects(objects:THREE.Object3D[]){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 objects.forEach(object=>object.traverse(item=>{
  if(!(item instanceof THREE.Mesh||item instanceof THREE.Line))return;
  geometries.add(item.geometry);
  (Array.isArray(item.material)?item.material:[item.material]).forEach(material=>materials.add(material));
 }));
 materials.forEach(material=>Object.values(material).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value)}));
 geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());textures.forEach(texture=>texture.dispose());
}

function Trunks({current,future,angle,rotation,showPanel,reset}:{current:number;future:number;angle:number|null;rotation:number;showPanel:boolean;reset:number}){
 const host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const update=useRef<((future:number,rotation:number,show:boolean)=>void)|null>(null),resetView=useRef<(()=>void)|null>(null);
 useEffect(()=>{update.current?.(future,rotation,showPanel)},[future,rotation,showPanel,ready]);
 useEffect(()=>{resetView.current?.()},[reset]);
 useEffect(()=>{
  const element=host.current!;let disposed=false,frame=0,source:THREE.Object3D|undefined;setReady(false);setError('');
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true})}catch{setError('三维视图暂不可用，树围数值和输入依据仍可查看。');return}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#101e28');renderer.outputColorSpace=THREE.SRGBColorSpace;element.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.01,60),controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.enablePan=false;controls.minDistance=.5;controls.maxDistance=5;controls.maxPolarAngle=Math.PI*.8;
  resetView.current=()=>{camera.position.set(0,1.55,2.7);controls.target.set(0,1.28,0);controls.update()};resetView.current();
  scene.add(new THREE.HemisphereLight('#e8f5fa','#35413c',2.3));const light=new THREE.DirectionalLight('#ffedce',3);light.position.set(2,4,3);scene.add(light);
  const roots=[new THREE.Group(),new THREE.Group()];roots[0].position.x=-.48;roots[1].position.x=.48;roots.forEach(root=>scene.add(root));
  const overlay=(root:THREE.Group,radius:number,color:string,show:boolean)=>{
   const ring=new THREE.Mesh(new THREE.TorusGeometry(radius*1.06,.002,8,128),new THREE.MeshBasicMaterial({color}));ring.rotation.x=Math.PI/2;ring.position.y=1.3;root.add(ring);
   if(angle!==null){const points=Array.from({length:97},(_,index)=>{const point=cutPoint(radius*1.06,angle,index/96);return new THREE.Vector3(point.x,point.y,point.z)});root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),96,.0025,8,false),new THREE.MeshBasicMaterial({color})));}
   if(show){const panel=new THREE.Mesh(new THREE.CylinderGeometry(radius*1.045,radius*1.045,.36,96,1,true,-Math.PI/2,Math.PI),new THREE.MeshStandardMaterial({color,transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false}));panel.position.y=1.2;root.add(panel)}
  };
  void new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/assets/trees/mature-family-v1/RT_Mature_A_LOD1.glb').then(gltf=>{
   if(disposed){disposeObjects([gltf.scene]);return}
   source=gltf.scene;source.updateMatrixWorld(true);
   const bark=new THREE.Group();
   source.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(materials.some(material=>/leaf|foliage|card/i.test(material.name)))return;
    bark.add(new THREE.Mesh(bakeWorldGeometry(object.geometry,object.matrixWorld),Array.isArray(object.material)?materials.map(material=>material.clone()):object.material.clone()));
   });
   roots[0].add(bark);
   const points:THREE.Vector3[]=[];
   bark.traverse(object=>{if(object instanceof THREE.Mesh){const position=object.geometry.getAttribute('position');for(let index=0;index<position.count;index++){const point=new THREE.Vector3().fromBufferAttribute(position,index);if(Math.abs(point.y-1.3)<.2)points.push(point)}}});
   const section=trunkSection(points);
   bark.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.translate(-section.x,0,-section.z)});
   const models=[bark,bark.clone(true)];roots[1].add(models[1]);
   const overlays=roots.map(root=>{const group=new THREE.Group();root.add(group);return group});
   update.current=(next,yaw,show)=>[current,next].forEach((cm,index)=>{
    const radius=circumferenceRadius(cm);models[index].scale.set(radius/section.radius,1,radius/section.radius);roots[index].rotation.y=yaw*Math.PI/180;
    disposeObjects(overlays[index].children);overlays[index].clear();overlay(overlays[index],radius,index?'#edbe70':'#79d9cf',show);
   });
   update.current(future,rotation,showPanel);setReady(true);
  }).catch(error=>{if(!disposed)setError('树干对照加载失败：'+error.message)});
  const resize=()=>{const width=element.clientWidth,height=element.clientHeight;if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix()};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const tick=()=>{if(disposed)return;if(element.offsetParent!==null&&!document.hidden){controls.update();renderer.render(scene,camera)}frame=requestAnimationFrame(tick)};tick();
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();disposeObjects(source?[scene,source]:[scene]);renderer.dispose();renderer.domElement.remove();update.current=null;resetView.current=null};
 },[current,angle]);
 return <div className="gc-canvas" ref={host} role="img" aria-label="同尺度的当前和预测树干，可拖动旋转、滚轮缩放">{!ready&&!error&&<span className="gc-loading">正在载入树干对照…</span>}{error&&<p role="status" className="gc-loading">{error}</p>}</div>;
}

export function GrowthComparison({strategy,treeId}:{strategy:GrowthStrategy;treeId?:string}){
 const snapshot=useRead<ContextSnapshot>('/internal/harness/runs/'+encodeURIComponent(strategy.runId)+'/context');
 const targets=[...new Set(strategy.proposal.predictions.map(prediction=>prediction.treeId))];
 const [selectedTree,setSelectedTree]=useState(treeId??targets[0]??''),[date,setDate]=useState(''),[rotation,setRotation]=useState(0),[showPanel,setShowPanel]=useState(true),[reset,setReset]=useState(0);
 const target=treeId??(targets.includes(selectedTree)?selectedTree:targets[0]??'');
 const input=growthComparisonInput(strategy,snapshot.data,target),prediction=input?.predictions.find(item=>item.at===date)??input?.predictions[0];
 const current=input?.tree.circumferenceCm,available=current!=null&&Number.isFinite(current)&&current>0&&!!prediction;
 const delta=available?predictionDelta(current!,prediction!.value):null;
 return <section className="gc-comparison" aria-label="当前与预测割面对照">
  <header><h3>{alias(target,strategy.siteId)} · 生长与割面对照</h3><span>预测演示</span></header>
  {!treeId&&targets.length>1&&<label className="gc-tree">对照对象<select aria-label="选择割面对照树木" value={target} onChange={event=>{setSelectedTree(event.target.value);setDate('')}}>{targets.map(id=><option key={id} value={id}>{alias(id,strategy.siteId)}</option>)}</select></label>}
  {snapshot.error?<p role="status">{snapshot.error} <button onClick={snapshot.reload}>重新读取依据</button></p>:!snapshot.data?<p>正在读取本轮保存的输入…</p>:!input?<p role="status">本轮输入与园区、树木或策略版本不匹配，暂不能形成对照。</p>:available?<>
   <div className="gc-labels"><div><b>当前输入 · {current!.toFixed(2)} cm</b><small>{recordTime(input.tree.measuredAt)}</small></div><div><b>预测 · {prediction!.value.toFixed(2)} cm</b><small>{recordTime(prediction!.at)} · {delta!.cm>=0?'+':''}{delta!.cm.toFixed(2)} cm</small></div></div>
   <Trunks current={current!} future={prediction!.value} angle={input.angle} rotation={rotation} showPanel={showPanel} reset={reset}/>
   <div className="gc-controls"><label>预测日期<select aria-label="选择割面对照预测日期" value={prediction!.at} onChange={event=>setDate(event.target.value)}>{input.predictions.map(item=><option value={item.at} key={item.at}>{recordTime(item.at)}</option>)}</select></label><label>同步旋转<input aria-label="同步旋转当前与预测割面" type="range" min="-180" max="180" value={rotation} onChange={event=>setRotation(+event.target.value)}/>{rotation}°</label><label><input type="checkbox" checked={showPanel} onChange={event=>setShowPanel(event.target.checked)}/>显示割面区域</label><button onClick={()=>{setRotation(0);setReset(value=>value+1)}}>复位视角</button></div>
   <p>两棵树按相同尺度展示，青色为当前输入，琥珀色为预测。三维树形复用示意资产，环线位于离地 1.3 m；预测增量未放大。</p>
   <p>{input.angle===null?'输入未提供割线角度。':`两侧均沿用当前割线倾角 ${input.angle}°。`}未来割角、耗皮量及真实割面几何尚未预测，此图用于复核演示。</p>
   {input.plan&&<p>割面安排：{input.plan.reason}</p>}
   <details><summary>本次对照的输入与预测依据</summary><p>园区：{strategy.siteId} · 树木：{target}</p><p>输入快照：{snapshot.data.snapshotId} · v{snapshot.data.version} · {recordTime(snapshot.data.asOf)}</p><p>树围来源：{recordSource(input.tree.provenance)} · {input.tree.provenance.sourceId}</p><p>预测方法：{prediction!.method} · {prediction!.sourceRefs.join('、')}</p><p>预测区间：{prediction!.interval?`${prediction!.interval.lower}—${prediction!.interval.upper} cm`:'未提供'}</p><p>割面记录：{input.panel?.panelId??'未提供'}。后续复测不会改写本轮保存的输入。</p></details>
  </>:<p>本轮缺少有效树围或预测，请补测后更新建议。</p>}
 </section>;
}
