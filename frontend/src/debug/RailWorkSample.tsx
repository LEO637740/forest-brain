import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {addHomeTidewaterLighting} from '../homeTidewaterLighting';
import {prepareTreeMaterial} from '../treeVisuals';
import {railDuration,railFrame,railStages,inspectionTime} from './railR4Sequence';
import './railWorkSample.css';
import {railTreeAnchors} from './railTreeAnchors';
import {planRailApproach,type RailLimits} from './railApproachPlan';

type Playback='idle'|'running'|'paused'|'done';
export default function RailWorkSample(){
  const host=useRef<HTMLDivElement>(null);
  const playback=useRef<Playback>('idle'),elapsed=useRef(0);
  const [state,setState]=useState<Playback>('idle'),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [step,setStep]=useState(0),[progress,setProgress]=useState(0);
  const view=useRef<(mode:'near'|'wide'|'side'|'panel')=>void>(()=>{});
  const change=(next:Playback)=>{playback.current=next;setState(next);};
  useEffect(()=>{
    const element=host.current!,scene=new THREE.Scene();
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    element.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(42,1,.05,180);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=35;controls.maxPolarAngle=Math.PI*.49;
    view.current=(mode)=>{
      const poses={near:[4.5,3.1,6.3],wide:[16,11,22],side:[4,2,-.65],panel:[-1.5,2.1,1.4]} as const;
      const [x,y,z]=poses[mode];camera.position.set(x,y,z);controls.target.set(-.22,mode==='wide'?6:1.5,mode==='wide'?-.5:-.85);controls.update();
    };view.current('near');
    const resources:THREE.Object3D[]=[];
    const box=(w:number,h:number,d:number,color:string,x:number,y:number,z:number,parent:THREE.Object3D=scene)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));
      mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    box(24,.1,24,'#656d51',0,-.07,0);
    const carriage=new THREE.Group();scene.add(carriage);
    let treeRoot:THREE.Object3D|undefined;
    let loadedLimits:RailLimits|undefined;
    let parkedTravelM=.0846424041;
    let driver:{nodes:{TOOL_TCP:THREE.Object3D};setPathPose:(segment:number,t:number)=>THREE.Object3D}|undefined;
    const lighting=addHomeTidewaterLighting(scene,renderer);
    let disposed=false,raf=0,last=0,report=0;
    const frameTimes:number[]=[];
    const sampleDebug={pickTree:(x:number,y:number)=>{
      if(!treeRoot)return null;
      const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/element.clientWidth*2-1,1-y/element.clientHeight*2),camera);
      const hit=ray.intersectObject(treeRoot,true)[0];
      return hit?{local:treeRoot.worldToLocal(hit.point.clone()).toArray(),world:hit.point.toArray(),mesh:hit.object.name}:null;
    },getMetrics:()=>{
      const sorted=[...frameTimes].sort((a,b)=>a-b);
      const tcp=driver?.nodes.TOOL_TCP.getWorldPosition(new THREE.Vector3());
      const hits=tcp&&treeRoot?new THREE.Raycaster(tcp,new THREE.Vector3(0,0,-1),0,2).intersectObject(treeRoot,true):[];
      const approachHits=tcp&&treeRoot?new THREE.Raycaster(tcp.clone().add(new THREE.Vector3(0,0,2)),new THREE.Vector3(0,0,-1),0,4).intersectObject(treeRoot,true):[];
      return {renderer:'WebGL2',width:renderer.domElement.width,height:renderer.domElement.height,
        fps:frameTimes.length?1000/(frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length):null,
        frameP95Ms:sorted[Math.floor(sorted.length*.95)]??null,samples:sorted.length,
        calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
        elapsed:elapsed.current,state:playback.current,tcp:tcp?.toArray(),revision:'R4-transit',parkedTravelM,travelM:carriage.position.x,
        approachPlan:treeRoot&&loadedLimits?planRailApproach(treeRoot.localToWorld(new THREE.Vector3(...railTreeAnchors[0].local)).toArray(),loadedLimits):null,
        anchors:treeRoot?railTreeAnchors.map(a=>{const world=treeRoot!.localToWorld(new THREE.Vector3(...a.local));return {id:a.id,world:world.toArray(),withinVerticalRange:loadedLimits?world.y>=1.79+loadedLimits.sliderOffset[0]&&world.y<=1.79+loadedLimits.sliderOffset[1]:null};}):[],
        forwardTreeSurfaceM:hits[0]?.distance??null,frontSurfaceSignedGapM:approachHits.length?approachHits[0].distance-2:null};
    }};
    const debugWindow=window as unknown as {__railSample?:typeof sampleDebug};debugWindow.__railSample=sampleDebug;
    const disposeObject=(root:THREE.Object3D)=>{
      const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
      root.traverse(node=>{if(node instanceof THREE.Mesh){geometries.add(node.geometry);(Array.isArray(node.material)?node.material:[node.material]).forEach(m=>{materials.add(m);Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v);});});}});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    };
    const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const driverUrl='/assets/robot/rail-r4/robot-driver.mjs';
    void Promise.all([loader.loadAsync('/assets/trees/mature-family-v1/RT_Mature_B_LOD0.glb').then(gltf=>{
      if(disposed){disposeObject(gltf.scene);return;}
      const tree=gltf.scene;tree.position.set(-.22,0,-1.39);
      tree.traverse(n=>{if(n instanceof THREE.Mesh){n.castShadow=true;n.receiveShadow=true;
        const originals=Array.isArray(n.material)?n.material:[n.material];
        const prepared=originals.map(m=>prepareTreeMaterial(m,{lod:0}));
        n.material=Array.isArray(n.material)?prepared:prepared[0];originals.forEach(m=>m.dispose());
      }});
      scene.add(tree);resources.push(tree);
      treeRoot=tree;
      // Align only this isolated fixture: true mesh surface, not a nominal cylinder.
      tree.updateMatrixWorld(true);
      for(const anchor of railTreeAnchors){
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),new THREE.MeshBasicMaterial({color:anchor.color}));
        const [x,y,z]=anchor.local;marker.position.set(x,y,z);marker.name=anchor.id;marker.layers.set(1);tree.add(marker);
      }
      camera.layers.enable(1);
      const surface=new THREE.Raycaster(new THREE.Vector3(-.22,1.67,1),new THREE.Vector3(0,0,-1),0,4).intersectObject(tree,true)[0];
      if(!surface)throw new Error('无法定位树干作业高度的真实表面');
      tree.position.z+=(-1.13-.03)-surface.point.z;
      tree.updateMatrixWorld(true);
    }),Promise.all([
      loader.loadAsync('/assets/robot/rail-r4/robot_runtime.glb'),
      loader.loadAsync('/assets/robot/rail-r4/rail_segment.glb'),
      import(/* @vite-ignore */ driverUrl),
    ]).then(([robot,rail,module])=>{
      if(disposed){disposeObject(robot.scene);disposeObject(rail.scene);return;}
      for(const root of [robot.scene,rail.scene])root.traverse(n=>{if(n instanceof THREE.Mesh){n.castShadow=true;n.receiveShadow=true;}});
      carriage.add(robot.scene);driver=module.bindRobot(robot.scene);loadedLimits=module.CONTRACT.nominal_geometry_ranges;
      parkedTravelM=module.PARKED_TRAVEL_M;carriage.position.x=-3;
      for(const x of [-3.2,0,3.2]){const segment=rail.scene.clone(true);segment.position.x=x;scene.add(segment);}
    }),lighting.ready]).then(()=>{if(!disposed){
      if(!treeRoot||treeRoot.position.distanceTo(new THREE.Vector3(-.22,0,-1.4638956627))>1e-6)throw new Error('树位不匹配 R4 验证样区');
      setReady(true);
    }}).catch(e=>{if(!disposed)setError('样区资产加载失败，请刷新重试：'+String(e));});
    const resize=()=>{renderer.setSize(element.clientWidth,element.clientHeight);camera.aspect=element.clientWidth/element.clientHeight;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(element);resize();
    const hidden=()=>{last=0;if(document.hidden && playback.current==='running'){playback.current='paused';setState('paused');}};
    document.addEventListener('visibilitychange',hidden);
    const animate=(now:number)=>{
      if(last&&now-last<250){frameTimes.push(now-last);if(frameTimes.length>600)frameTimes.shift();}
      const dt=last?Math.min((now-last)/1000,.1):0;last=now;
      if(playback.current==='running')elapsed.current=Math.min(railDuration,elapsed.current+dt);
      const frame=railFrame(elapsed.current,parkedTravelM);
      carriage.position.x=frame.travelM;driver?.setPathPose(frame.segment,frame.pathProgress);
      if(frame.done && playback.current==='running'){playback.current='done';setState('done');}
      if(now-report>100){setStep(frame.index);setProgress(frame.progress);report=now;}
      controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(animate);
    };raf=requestAnimationFrame(animate);
    return ()=>{disposed=true;if(debugWindow.__railSample===sampleDebug)delete debugWindow.__railSample;cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener('visibilitychange',hidden);controls.dispose();lighting.dispose();disposeObject(scene);resources.length=0;renderer.dispose();renderer.domElement.remove();view.current=()=>{};};
  },[]);
  return <main className="rail-sample">
    <div className="rail-sample__scene" ref={host}/>
    <header className="rail-sample__header"><div><span>橡胶大脑运营中心 / 独立样区</span><h1>轨道作业 · 单树联调</h1></div><a href="/?homeTidewater=1#home">返回首页 ↗</a></header>
    <aside className="rail-sample__note"><strong>R4 机器人 × Mature B</strong><p>收拢进站 → 停靠对准 → 收回离站。黄点：割面采样点；蓝点：胶杯口。对准时保留 30 毫米，不执行切割。</p><div><button onClick={()=>view.current('near')}>作业近景</button><button onClick={()=>view.current('wide')}>观察全树</button></div><div style={{marginTop:10}}><button onClick={()=>view.current('side')}>机构侧面</button><button onClick={()=>view.current('panel')}>割面视角</button></div></aside>
    <section className="rail-sample__transport" aria-label="作业演练控制">
      <div className="rail-sample__title"><strong aria-live="polite">{error?'加载失败':!ready?'正在载入样区':state==='idle'?'准备就绪':state==='done'?'演练完成':`${railStages[step].label}${state==='paused'?' · 已暂停':''}`}</strong><span>流程预演 · 不执行割胶、不写入作业记录</span></div>
      {error&&<p role="alert">{error}</p>}
      <ol>{railStages.map((s,i)=><li key={s.label} className={state!=='idle'&&i===step?'active':i<step?'complete':''}>{i+1} <span>{s.label}</span></li>)}</ol>
      <progress value={progress} max={1} aria-label="演练进度"/>
      <div className="rail-sample__actions"><button className="primary" disabled={!ready||!!error} onClick={()=>{if(state==='running')change('paused');else{if(state==='done')elapsed.current=0;change('running');}}}>{state==='running'?'暂停':state==='paused'?'继续':state==='done'?'再演练一次':'开始演练'}</button><button disabled={!ready||!!error} onClick={()=>{elapsed.current=inspectionTime;setStep(3);setProgress(elapsed.current/railDuration);change('paused');}}>检查作业点</button><button disabled={!ready} onClick={()=>{elapsed.current=0;setProgress(0);setStep(0);change('idle');}}>重置</button></div>
    </section>
  </main>;
}
