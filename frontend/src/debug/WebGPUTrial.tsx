import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGroundVisuals } from '../groundVisuals';
import { installGroundSample } from '../groundSample';
import { prepareTreeMaterial } from '../treeVisuals';
import { trialGroundMaterial } from './trialGround';
import { createTrialLighting, type TrialLightMode } from './trialLighting';
import { calibrateCanopy } from './trialCanopy';
import { trialLeafCards } from './trialLeafCards';
import { trialAutoLOD } from './trialAutoLOD';
import { trialMipCoverage } from './trialMipCoverage';
import { trialBusinessLayout, businessHeight } from './trialBusinessLayout';

type Report = Record<string, unknown>;
const percentile = (xs: number[], q: number) => xs.length ? [...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*q))] : null;
const bounds = {minX:-32,maxX:32,minZ:-32,maxZ:38};
const heightAt = (x:number,z:number) => Math.sin(x*.055)*.65+Math.cos(z*.06)*.45;

export default function WebGPUTrial() {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef({reset:()=>{},close:()=>{},skyView:()=>{},benchmark:()=>{},lighting:(_mode:TrialLightMode)=>{},canopy:(_enabled:boolean)=>{},single:(_lod:number)=>{},cards:(_stage:number)=>{},angle:(_back:boolean)=>{},auto:(_single:boolean)=>{},sweep:()=>{},stop:()=>{}});
  const [cardStage,setCardStage]=useState(2);
  const businessAction=useRef(()=>{});
  const cloudViewAction=useRef(()=>{});
  const understoryAction=useRef((_enabled:boolean)=>{});
  const [understoryEnabled,setUnderstoryEnabled]=useState(true);
  const distanceSettingsAction=useRef((_fog:'original'|'light'|'off',_matched:boolean)=>{});
  const [fogProfile,setFogProfile]=useState<'original'|'light'|'off'>('light');
  const [distanceMatched,setDistanceMatched]=useState(true);
  const [matchedMips,setMatchedMips]=useState(false);
  const mipAction=useRef((_enabled:boolean)=>{});
  const distanceAction=useRef((_distance:number)=>{});
  const [canopyEnabled,setCanopyEnabled] = useState(true);
  const requestedLight=new URLSearchParams(location.search).get('light');
  const initialLight:TrialLightMode = requestedLight==='baseline'?'baseline':(requestedLight==='tidewater'||requestedLight==='clouds')&&new URLSearchParams(location.search).get('backend')!=='webgl'?requestedLight:'matched';
  const [lightMode,setLightMode] = useState<TrialLightMode>(initialLight);
  const [status,setStatus] = useState('初始化渲染器…');
  const [report,setReport] = useState<Report>({});
  const [selection,setSelection] = useState('点击树木检查选择；拖动旋转，滚轮缩放');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl';
  useEffect(()=> {
    let disposed=false, controls:OrbitControls|undefined, observer:ResizeObserver|undefined;
    let renderer:THREE.WebGPURenderer|undefined;
    const scene=new THREE.Scene();
    const geometries=new Set<THREE.BufferGeometry>(), materials=new Set<THREE.Material>(), textures=new Set<THREE.Texture>();
    const disposers:(()=>void)[]=[];
    const element=host.current!;
    const started=performance.now();
    const rememberMaterial=(m:THREE.Material)=>{materials.add(m);Object.values(m).forEach(v=>{if(v?.isTexture)textures.add(v);});};
    const publish=(value:Report)=>{if(disposed)return;setReport(value);(window as unknown as {webgpuTrialReport:Report}).webgpuTrialReport=value;};
    const fail=(error:unknown)=>{if(!disposed){setStatus(`验证未通过：${String(error)}`);console.error(error);}};
    async function run() {
      renderer=new THREE.WebGPURenderer({antialias:true,forceWebGL,trackTimestamp:true});
      renderer.setPixelRatio(1);renderer.setSize(element.clientWidth,element.clientHeight);
      renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
      await renderer.init();
      if(disposed)return;
      const actualBackend=(renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL2';
      if(!forceWebGL && actualBackend!=='WebGPU')throw new Error('当前浏览器未提供 WebGPU，已停止；不将自动回退算作通过。');
      const backend=renderer.backend as unknown as {device?:GPUDevice;trackTimestamp?:boolean};
      const adapter=backend.device?.adapterInfo;
      const base:Report={backend:actualBackend,adapter:adapter?{vendor:adapter.vendor,architecture:adapter.architecture,device:adapter.device,description:adapter.description}:null,
        timestampSupported:!!backend.trackTimestamp,viewport:[element.clientWidth,element.clientHeight],dpr:1,treeCount:24,lodDistribution:[6,6,6,6],businessDataChanged:false,
        ground:'existing relief + masks + PBR sources; bounded TSL blend, not full homepage shader',shadows:'2048 PCF; static'};
      element.appendChild(renderer.domElement);
      scene.background=new THREE.Color('#bdd6e4');scene.fog=new THREE.Fog('#bdd6e4',110,260);
      const camera=new THREE.PerspectiveCamera(48,element.clientWidth/element.clientHeight,.1,350);
      camera.position.set(40,30,68);
      controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,5,0);controls.enableDamping=true;controls.update();
      actions.current.reset=()=>{camera.position.set(40,30,68);controls!.target.set(0,5,0);controls!.update();};
      actions.current.close=()=>{camera.position.set(6,7,28);controls!.target.set(-7,5,1);controls!.update();};
      actions.current.skyView=()=>{camera.position.set(34,5,42);controls!.target.set(-3,10,-5);controls!.update();};
      cloudViewAction.current=()=>{camera.position.set(34,5,42);controls!.target.set(-3,28,-5);controls!.update();};
      actions.current.angle=(back)=>{camera.position.set(back?-24:92,back?12:34,back?-30:120);controls!.target.set(0,7,0);controls!.update();};
      distanceAction.current=(d)=>{if(!Number.isFinite(d))return;d=Math.max(24,Math.min(240,d));const y=sample.field(0,0).height+6.8;camera.position.set(.6*d,y+.15*d,Math.sqrt(1-.36-.0225)*d);controls!.target.set(0,y,0);controls!.update();};
      const fill=new THREE.HemisphereLight('#dbeafb','#776f5e',1.05);scene.add(fill);
      const sun=new THREE.DirectionalLight('#fff7e9',2.3);sun.position.set(45,65,35);sun.castShadow=true;
      Object.assign(sun.shadow.camera,{left:-58,right:58,top:58,bottom:-58,near:1,far:180});sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.08;sun.shadow.bias=-.0001;
      scene.add(sun);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
      setStatus('加载天空与环境光照…');
      const lighting=await createTrialLighting(scene,renderer,sun,fill);disposers.push(lighting.dispose);
      if(disposed)return;
      lighting.apply(initialLight);base.lighting=lighting.describe(initialLight);
      const roads=[{points:[[-30,26],[0,5],[30,-21]] as [number,number][],width:4}, {points:[[-30,-11],[0,5],[26,30]] as [number,number][],width:3}];
      // Read-only diagnostic placements, not business tree records or IDs.
      const trees=Array.from({length:24},(_,i)=>({x:-23+(i%6)*9,z:-23+Math.floor(i/6)*15, lod:Math.floor(i/6),family:['A','B','C'][i%3]}));
      const manager=new THREE.LoadingManager();
      const ground=createGroundVisuals({heightAt,roads,ditches:[],manager});disposers.push(ground.dispose);
      const placeholder=new THREE.Mesh(new THREE.PlaneGeometry(64,70,2,2).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial());
      geometries.add(placeholder.geometry);materials.add(placeholder.material);
      const sample=installGroundSample({terrain:placeholder,ground,roads,heightAt,trees,manager,bounds,step:.4,clay:true,surfaceTrial:true,
        ditches:[{points:[[-29,21],[-3,0],[26,-26]],width:.8}]});
      disposers.push(sample.dispose);materials.add(sample.mesh.material);
      const pbr=await trialGroundMaterial();pbr.textures.forEach(t=>textures.add(t));materials.add(pbr.material);
      if(disposed)return;
      (sample.mesh as THREE.Mesh<THREE.BufferGeometry,THREE.Material>).material=pbr.material;scene.add(sample.mesh);
      const setUnderstory=(enabled:boolean)=>{
        lighting.understory(enabled);pbr.setUnderstory(enabled);setUnderstoryEnabled(enabled);
        base.understory={enabled,shadowRadius:enabled?2:1,normalBias:.08,
          contact:'existing root mask; indirect AO approximation, not GI',extraShadowPasses:0};
        publish({...base});
      };
      understoryAction.current=setUnderstory;
      setUnderstory(new URLSearchParams(location.search).get('understory')!=='0');
      const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const batches:THREE.InstancedMesh[]=[];
      const calibrations:ReturnType<typeof calibrateCanopy>[]=[];
      const cardControls:((stage:number)=>void)[]=[];
      const mipControls:{material:THREE.MeshStandardNodeMaterial;original:THREE.Texture;matched:ReturnType<typeof trialMipCoverage>}[]=[];
      const boundsReport:Report[]=[];
      const materialReport:Report[]=[];
      for(const family of ['A','B','C'])for(const lod of [0,1,2,3] as const) {
        const gltf=await loader.loadAsync(`/assets/trees/mature-family-v1/RT_Mature_${family}_LOD${lod}.glb`);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(o=>{if((o as THREE.Mesh).isMesh){const m=o as THREE.Mesh;geometries.add(m.geometry);(Array.isArray(m.material)?m.material:[m.material]).forEach(rememberMaterial);}});
        if(disposed)return;
        const size=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());boundsReport.push({family,lod,size:size.toArray()});
        const group=trees.filter(t=>t.family===family&&t.lod===lod);
        gltf.scene.traverse(o=>{
          if(!(o as THREE.Mesh).isMesh)return;
          const mesh=o as THREE.Mesh;
          const source=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
          const prepared=prepareTreeMaterial(source,{lod}) as THREE.MeshStandardMaterial;rememberMaterial(prepared);
          const mat=new THREE.MeshStandardNodeMaterial();
          // Standard properties are copied; GLSL hooks are explicitly discarded.
          mat.copy(prepared as unknown as THREE.MeshStandardNodeMaterial);
          mat.onBeforeCompile=THREE.Material.prototype.onBeforeCompile;
          if(lod===3&&/leaf|foliage/i.test(mat.name)&&mat.map){
            const matched=trialMipCoverage(mat.map);textures.add(matched.texture);mipControls.push({material:mat,original:mat.map,matched});
            const configure=trialLeafCards(mat);configure(2);cardControls.push(configure);
          }
          rememberMaterial(mat);
          if(/leaf|foliage/i.test(mat.name)) {
            const calibration=calibrateCanopy(mat,lod);calibration.apply(true);calibrations.push(calibration);
          }
          // Decode normalized integer attributes before baking the full hierarchy.
          // Keeps tiny quantization scales out of instanced lighting transforms.
          const geometry=mesh.geometry.clone();
          for(const name of ['position','normal','tangent']){
            const a=geometry.getAttribute(name);if(!a)continue;
            const values=new Float32Array(a.count*a.itemSize);
            for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)values[i*a.itemSize+j]=a.getComponent(i,j);
            geometry.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
          }
          geometry.applyMatrix4(mesh.matrixWorld);geometries.add(geometry);
          if(family==='B'&&/leaf|foliage/i.test(mat.name)){
            const normal=geometry.getAttribute('normal');let absY=0;
            for(let i=0;i<normal.count;i++)absY+=Math.abs(normal.getY(i));
            materialReport.push({diagnostic:'B foliage at load',lod,alphaTest:mat.alphaTest,alphaToCoverage:mat.alphaToCoverage,metalness:mat.metalness,roughness:mat.roughness,normalMap:!!mat.normalMap,normalAbsY:absY/normal.count});
          }
          const batch=new THREE.InstancedMesh(geometry,mat,200);batch.count=group.length;batch.castShadow=true;batch.receiveShadow=true;
          batch.userData.family=family;batch.userData.lod=lod;batch.userData.fixedTrees=group;
          group.forEach((tree,i)=>{const matrix=new THREE.Matrix4().makeTranslation(tree.x,sample.field(tree.x,tree.z).height,tree.z);
            // Preserve FULL glTF world transform, including quantization decode.
            batch.setMatrixAt(i,matrix);});
          batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();batch.userData.trees=group;
          batch.userData.originalMatrices=batch.instanceMatrix.array.slice();
          scene.add(batch);batches.push(batch);
        });
      }
      base.bounds=boundsReport;base.materialsAtLoad=materialReport;base.assetsReadyMs=performance.now()-started;
      distanceSettingsAction.current=(fog,matched)=>{
        lighting.distanceSettings(fog,matched);calibrations.forEach(c=>c.distanceMatch(matched));
        setFogProfile(fog);setDistanceMatched(matched);
        base.distanceCalibration={fog,scaleAwareShadow:matched,lod3LinearGain:matched?1.12:1,shadowRadius:sun.shadow.radius};
        delete base.performance;publish({...base});
      };
      distanceSettingsAction.current('light',true);
      base.mipCoverage={enabled:false,materials:mipControls.map(c=>({name:c.material.name,target:c.matched.target,levels:c.matched.stats}))};
      mipAction.current=(enabled)=>{if(enabled)actions.current.cards(3);mipControls.forEach(c=>{c.material.map=enabled?c.matched.texture:c.original;});sun.shadow.needsUpdate=true;setMatchedMips(enabled);base.mipCoverage={enabled,materials:mipControls.map(c=>({name:c.material.name,target:c.matched.target,levels:c.matched.stats}))};publish({...base});};
      const autoLOD=trialAutoLOD(batches,trees,(x,z)=>sample.field(x,z).height,camera,sun);
      const businessTrees=trialBusinessLayout();let businessMode=false;
      const stressGeometry=new THREE.PlaneGeometry(270,160,80,48).rotateX(-Math.PI/2);
      const stressPositions=stressGeometry.getAttribute('position');for(let i=0;i<stressPositions.count;i++)stressPositions.setY(i,businessHeight(stressPositions.getX(i),stressPositions.getZ(i)));stressGeometry.computeVertexNormals();geometries.add(stressGeometry);
      const stressMaterial=new THREE.MeshStandardMaterial({color:'#555044',roughness:1});materials.add(stressMaterial);
      const stressGround=new THREE.Mesh(stressGeometry,stressMaterial);stressGround.receiveShadow=true;stressGround.visible=false;scene.add(stressGround);
      let autoEnabled=false,autoSingle=true,sweepStart=0,lastAutoPublish=0;
      const stopSweep=()=>{sweepStart=0;controls!.enabled=true;};
      actions.current.stop=stopSweep;
      const setGround=(stress:boolean)=>{businessMode=stress;base.treeCount=stress?200:24;if(!stress)delete base.businessTest;sample.mesh.visible=!stress;stressGround.visible=stress;Object.assign(sun.shadow.camera,stress?{left:-165,right:165,top:165,bottom:-165,near:.1,far:450}:{left:-58,right:58,top:58,bottom:-58,near:1,far:180});sun.shadow.camera.updateProjectionMatrix();lighting.updateShadow();base.ground=stress?'simplified stress-test ground; no PBR or root AO':'sample PBR ground';base.shadowRadius=sun.shadow.radius;};
      actions.current.auto=(single)=>{stopSweep();until=0;setGround(false);delete base.performance;autoEnabled=true;autoSingle=single;autoLOD.start(single);autoLOD.update();base.autoLOD=autoLOD.report();publish({...base});setSelection(single?'Mature B · 自动 LOD':'24 棵 · 自动 LOD');};
      businessAction.current=()=>{actions.current.auto(false);setGround(true);autoLOD.start(false,businessTrees);autoLOD.update();base.autoLOD=autoLOD.report();base.businessTest={count:200,seed:20260918,layoutOnly:true,simplifiedGround:true};publish({...base});setSelection('200 棵只读布局 · 简化地面 · 非完整首页');};
      base.leafCards={stage:2,cutoff:.34,normalBlend:.25};
      actions.current.cards=(stage)=>{if(stage<3)mipAction.current(false);cardControls.forEach(apply=>apply(stage));sun.shadow.needsUpdate=true;setCardStage(stage);base.leafCards={stage,cutoff:stage>=3?.48:.34,normalBlend:stage>=2?.25:0};publish({...base});};
      base.canopy={enabled:true,materials:calibrations.map(c=>c.diagnostics)};
      actions.current.canopy=(enabled)=>{calibrations.forEach(c=>c.apply(enabled));base.canopy={enabled,materials:calibrations.map(c=>c.diagnostics)};setCanopyEnabled(enabled);publish({...base});};
      actions.current.single=(lod)=>{
        stopSweep();until=0;autoEnabled=false;autoLOD.stop();base.autoLOD=autoLOD.report();base.lodDistribution=lod<0?[6,6,6,6]:[0,1,2,3].map(n=>Number(n===lod));
        setGround(false);
        batches.forEach(batch=>{
          batch.userData.trees=batch.userData.fixedTrees;
          const tree=batch.userData.fixedTrees[0];
          batch.visible=lod<0 || (tree.family==='B' && tree.lod===lod);
          batch.count=lod<0?batch.userData.trees.length:1;
          if(lod<0)batch.instanceMatrix.array.set(batch.userData.originalMatrices);
          else batch.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,sample.field(0,0).height,0));
          batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();
        });
        sun.shadow.needsUpdate=true;
        if(lod>=0){camera.position.set(24,12,30);controls!.target.set(0,7,0);controls!.update();}
        else actions.current.reset();
        base.view=lod<0?'24 trees':`Mature B LOD${lod}`;
        base.visibleTreeCount=lod<0?24:1;publish({...base});
        setSelection(lod<0?'24 棵固定 LOD 验证树':`Mature B · LOD${lod} · 同位置 / 同机位`);
      };
      await renderer.compileAsync(scene,camera);if(disposed)return;
      renderer.render(scene,camera);base.firstCompleteFrameSubmittedMs=performance.now()-started;
      sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=false;
      const raycaster=new THREE.Raycaster();let down={x:0,y:0};
      const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
      const pointerUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
        const r=renderer!.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
        const hit=raycaster.intersectObjects(batches.filter(batch=>batch.visible))[0];
        if(hit&&hit.instanceId!==undefined){const t=hit.object.userData.trees[hit.instanceId];setSelection(`验证树 ${t.family} / LOD${t.lod} · x ${t.x}m，z ${t.z}m`);}else setSelection('未选中树木');};
      renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
      disposers.push(()=>{renderer?.domElement.removeEventListener('pointerdown',pointerDown);renderer?.domElement.removeEventListener('pointerup',pointerUp);});
      observer=new ResizeObserver(()=>{camera.aspect=element.clientWidth/element.clientHeight;camera.updateProjectionMatrix();renderer!.setSize(element.clientWidth,element.clientHeight);});observer.observe(element);
      let frames:number[]=[],gpu:number[]=[],until=0,begin=0,last=0,pending=false,peakDrawCalls=0,peakTriangles=0;
      actions.current.stop=()=>{stopSweep();until=0;setStatus('往返已停止 · 可手动移动镜头');};
      actions.current.lighting=(mode)=>{until=0;lighting.apply(mode);base.lighting=lighting.describe(mode);publish({...base,camera:camera.position.toArray()});setLightMode(mode);setStatus('光照已切换 · 保持当前机位');};
      actions.current.benchmark=()=>{delete base.performance;frames=[];gpu=[];peakDrawCalls=0;peakTriangles=0;begin=performance.now()+2000;until=begin+10000;last=0;publish({...base,camera:camera.position.toArray(),target:controls!.target.toArray()});setStatus('预热 2 秒，然后采样 10 秒…');};
      actions.current.sweep=()=>{if(!autoEnabled)actions.current.auto(true);autoLOD.start(autoSingle,businessMode?businessTrees:undefined);actions.current.benchmark();sweepStart=begin;until=begin+24000;controls!.enabled=false;setStatus('自动往返 24 秒 · 同步采样性能');};
      renderer.setAnimationLoop(()=>{
        if(disposed)return;
        const now=performance.now();
        if(sweepStart){const t=Math.max(0,Math.min(1,(now-sweepStart)/24000));const d=24+176*(1-Math.cos(t*Math.PI*2))/2;
          const y=sample.field(0,0).height+6.8;controls!.target.set(0,y,0);camera.position.set(.6*d,y+.15*d,Math.sqrt(1-.36-.0225)*d);controls!.update();if(t===1)stopSweep();
        }else controls!.update();
        if(autoEnabled){autoLOD.update();base.autoLOD=autoLOD.report();base.lodDistribution=(base.autoLOD as ReturnType<typeof autoLOD.report>).distribution;
          base.centerDistance=camera.position.distanceTo(new THREE.Vector3(0,sample.field(0,0).height+6.8,0));
          if(now-lastAutoPublish>250){lastAutoPublish=now;publish({...base});}
        }
        renderer!.render(scene,camera);
        const collecting=until>0&&now>=begin&&now<until;
        if(collecting){peakDrawCalls=Math.max(peakDrawCalls,renderer!.info.render.drawCalls);peakTriangles=Math.max(peakTriangles,renderer!.info.render.triangles);}
        if(collecting&&last>0)frames.push(now-last);last=now;
        if(backend.trackTimestamp&&!pending){pending=true;void renderer!.resolveTimestampsAsync().then(()=>{
          const ms=renderer!.info.render.timestamp;if(collecting&&ms>0)gpu.push(ms);
        }).catch(fail).finally(()=>{pending=false;});}
        if(until&&now>=until){until=0;const info=renderer!.info.render;
          base.performance={frames:frames.length,fps:frames.length?1000/(frames.reduce((a,b)=>a+b,0)/frames.length):null,frameP95Ms:percentile(frames,.95),frameMaxMs:frames.length?Math.max(...frames):null,gpuMedianMs:percentile(gpu,.5),gpuP95Ms:percentile(gpu,.95),drawCalls:info.drawCalls,triangles:info.triangles,peakDrawCalls,peakTriangles,autoLOD:autoLOD.report()};
          publish({...base,camera:camera.position.toArray(),target:controls!.target.toArray(),viewport:[element.clientWidth,element.clientHeight],frames:frames.length,fps:frames.length?1000/(frames.reduce((a,b)=>a+b,0)/frames.length):null,
            frameMedianMs:percentile(frames,.5),frameP95Ms:percentile(frames,.95),gpuSamples:gpu.length,gpuMedianMs:percentile(gpu,.5),gpuP95Ms:percentile(gpu,.95),drawCalls:info.drawCalls,triangles:info.triangles});setStatus('采样完成');}
      });
      publish(base);setStatus(`${actualBackend} 已就绪 · 24 棵验证树 · 每排 LOD0 / 1 / 2 / 3`);
    }
    void run().catch(fail).finally(()=>{if(disposed)release();});
    function release(){disposers.splice(0).forEach(fn=>fn());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());geometries.clear();materials.clear();textures.clear();renderer?.dispose();}
    return()=>{disposed=true;renderer?.setAnimationLoop(null);observer?.disconnect();controls?.dispose();renderer?.domElement.remove();release();};
  },[forceWebGL]);
  const buttonStyle={padding:'8px 12px',color:'#eaf6ee',background:'#294b40',border:'1px solid #628674',borderRadius:6,cursor:'pointer'};
  return <main style={{position:'fixed',inset:0,background:'#bdd6e4'}}>
    <div ref={host} style={{width:'100%',height:'100%'}} />
    <section style={{position:'absolute',top:16,left:16,maxWidth:570,padding:16,background:'#10251ee8',color:'#eaf6ee',borderRadius:10,fontSize:14}}>
      <strong style={{fontSize:20}}>渲染后端验证 · {forceWebGL?'WebGL2 对照':'WebGPU'}</strong>
      <p>{status}</p><p>{selection}</p>
      {Boolean((report.autoLOD as {enabled?:boolean}|undefined)?.enabled)&&<p>当前 LOD0 / 1 / 2 / 3：{(report.autoLOD as {distribution:number[]}).distribution.join(' / ')}</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button style={buttonStyle} onClick={()=>actions.current.reset()}>全景归位</button>
        <button style={buttonStyle} onClick={()=>actions.current.close()}>林下近景</button>
        <button style={buttonStyle} onClick={()=>actions.current.skyView()}>天空与林冠</button>
        <button style={buttonStyle} onClick={()=>cloudViewAction.current()}>云层观察</button>
        <button style={buttonStyle} onClick={()=>actions.current.benchmark()}>采样性能</button>
        <a style={buttonStyle} href={forceWebGL?'?webgpuTrial=1':'?webgpuTrial=1&backend=webgl'}>切换后端</a>
        <a style={buttonStyle} href='/'>返回首页</a>
      </div>
      <div style={{display:'flex',gap:8,marginTop:10}}>
        {([['baseline','原版光照'],['sky','仅换天空'],['matched','天空 + 环境光']] as const).map(([mode,label])=><button key={mode} aria-pressed={lightMode===mode} style={{...buttonStyle,background:lightMode===mode?'#4c8268':'#223d33'}} onClick={()=>actions.current.lighting(mode)}>{label}</button>)}
      </div>
      {!forceWebGL&&<button style={{...buttonStyle,marginTop:8,background:lightMode==='tidewater'?'#4c8268':'#223d33'}} aria-pressed={lightMode==='tidewater'} onClick={()=>actions.current.lighting('tidewater')}>Tidewater 大气移植 · 无云</button>}
      {!forceWebGL&&<button style={{...buttonStyle,marginTop:8,marginLeft:8,background:lightMode==='clouds'?'#4c8268':'#223d33'}} aria-pressed={lightMode==='clouds'} onClick={()=>actions.current.lighting('clouds')}>Tidewater 体积云 · 固定时刻</button>}
      <button style={{...buttonStyle,marginTop:8,marginLeft:8}} aria-pressed={understoryEnabled} onClick={()=>understoryAction.current(!understoryEnabled)}>{understoryEnabled?'对照：原阴影与林下':'启用柔和阴影与林下校准'}</button>
      <details style={{marginTop:12}}><summary>指标与验证范围</summary><pre style={{maxHeight:260,overflow:'auto',fontSize:12}}>{JSON.stringify(report,null,2)}</pre></details>
      <div style={{display:'flex',gap:6,marginTop:10}}>
        {([['original','原距离雾'],['light','轻空气透视'],['off','关闭雾对照']] as const).map(([mode,label])=><button key={mode} style={buttonStyle} aria-pressed={fogProfile===mode} onClick={()=>distanceSettingsAction.current(mode,distanceMatched)}>{label}</button>)}
        <button style={buttonStyle} onClick={()=>distanceSettingsAction.current(fogProfile,!distanceMatched)}>{distanceMatched?'恢复旧远景校准':'启用远景校准'}</button>
      </div>
      <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
        <button style={buttonStyle} onClick={()=>actions.current.auto(true)}>单树自动 LOD</button>
        <button style={buttonStyle} onClick={()=>actions.current.auto(false)}>24 棵自动 LOD</button>
        <button style={buttonStyle} onClick={()=>businessAction.current()}>200 棵布局压力测试</button>
        <button style={buttonStyle} onClick={()=>actions.current.sweep()}>自动往返测试</button>
        <button style={buttonStyle} onClick={()=>actions.current.stop()}>停止往返</button>
        <button style={buttonStyle} onClick={()=>mipAction.current(!matchedMips)}>{matchedMips?'切换旧 mipmap':'切换匹配 mipmap'}</button>
        <label>对照距离 m <input aria-label="对照距离" type="number" min="24" max="240" defaultValue="172" style={{width:64}} onChange={e=>distanceAction.current(Number(e.target.value))}/></label>
      </div>
      <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
        {['上轮基线','仅修阴影','远距校准 0.34','近距对照 0.48'].map((label,stage)=><button key={stage} aria-pressed={cardStage===stage} style={{...buttonStyle,background:cardStage===stage?'#4c8268':'#223d33'}} onClick={()=>actions.current.cards(stage)}>{label}</button>)}
      </div>
      <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
        <button style={buttonStyle} onClick={()=>actions.current.canopy(!canopyEnabled)}>{canopyEnabled?'切换原叶色':'切换统一叶色'}</button>
        {[0,1,2,3].map(lod=><button key={lod} style={buttonStyle} onClick={()=>actions.current.single(lod)}>B / LOD{lod}</button>)}
        <button style={buttonStyle} onClick={()=>actions.current.single(-1)}>恢复 24 棵</button>
        <button style={buttonStyle} onClick={()=>actions.current.angle(false)}>单树远距</button>
        <button style={buttonStyle} onClick={()=>actions.current.angle(true)}>单树背面</button>
      </div>
    </section>
  </main>;
}
