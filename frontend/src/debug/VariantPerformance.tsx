import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Isolated load test: synthetic instances, never business TreeRecords. */
export function VariantPerformance() {
  const host=useRef<HTMLDivElement>(null), status=useRef<HTMLPreElement>(null);
  useEffect(()=>{
    const element=host.current!, start=performance.now();
    const params=new URLSearchParams(location.search);
    const count=[50,100,200].includes(Number(params.get("count")))?Number(params.get("count")):50;
    const fixed=params.has("fixedLOD")?Math.min(2,Math.max(0,Number(params.get("fixedLOD"))||0)):null;
    const tour=params.has("tour");
    const scene=new THREE.Scene();scene.background=new THREE.Color("#b9cac8");
    const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
    renderer.setPixelRatio(1);renderer.setSize(element.clientWidth,element.clientHeight);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;element.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(45,element.clientWidth/element.clientHeight,.1,800);
    camera.position.set(65,40,100);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,6,0);controls.update();
    scene.add(new THREE.HemisphereLight("#edf5ff","#697352",2));
    const sun=new THREE.DirectionalLight("#fff1d9",2.5);sun.position.set(-35,60,20);scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(230,260),new THREE.MeshStandardMaterial({color:"#74775d",roughness:1}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.03;scene.add(ground);
    type Part={mesh:THREE.InstancedMesh;variant:number;lod:number};
    const parts:Part[]=[];const resources:THREE.Object3D[]=[];
    const trees=Array.from({length:count},(_,i)=>({variant:i%3,lod:-1,position:new THREE.Vector3((i%10-4.5)*10,0,(Math.floor(i/10)-(Math.ceil(count/10)-1)/2)*10),yaw:(i*2.399963)%6.28318}));
    let disposed=false,ready=false,raf=0,firstFrame:number|null=null,allReady=0,previous=0,frames:number[]=[];
    const loader=new GLTFLoader();
    const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);
    const lodCounts=[0,0,0];
    let dirty=true;controls.addEventListener("change",()=>{dirty=true;});
    void Promise.all(["V20","V21","V25"].flatMap((id,variant)=>[0,1,2].map(async lod=>{
      const gltf=await loader.loadAsync("/assets/trees/variant-pilot-v4/"+id+"_LOD"+lod+".glb");
      resources.push(gltf.scene);
      if(disposed){gltf.scene.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose());}});return;}
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(node=>{
        if(!(node instanceof THREE.Mesh))return;
        const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld);
        const material=(Array.isArray(node.material)?node.material[0]:node.material).clone() as THREE.MeshStandardMaterial;
        material.side=THREE.DoubleSide;material.forceSinglePass=true;
        const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.count=0;mesh.frustumCulled=false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);parts.push({mesh,variant,lod});
      });
    }))).then(()=>{if(!disposed){ready=true;allReady=performance.now()-start;dirty=true;}}).catch(e=>{console.error(e);if(status.current)status.current.textContent=String(e);});
    const update=()=>{
      lodCounts.fill(0);parts.forEach(p=>p.mesh.count=0);
      trees.forEach(tree=>{
        const distance=camera.position.distanceTo(tree.position);
        let lod=tree.lod;
        if(fixed!==null)lod=fixed;
        else if(lod<0)lod=distance<40?0:distance<75?1:2;
        else {while(lod<2&&distance>[46,83][lod])lod++;while(lod>0&&distance<[34,67][lod-1])lod--;}
        tree.lod=lod;lodCounts[lod]++;
        rotation.setFromAxisAngle(axis,tree.yaw);matrix.compose(tree.position,rotation,new THREE.Vector3(1,1,1));
        parts.forEach(p=>{if(p.variant===tree.variant&&p.lod===lod)p.mesh.setMatrixAt(p.mesh.count++,matrix);});
      });
      parts.forEach(p=>{p.mesh.instanceMatrix.needsUpdate=true;});dirty=false;
    };
    const resize=()=>{camera.aspect=element.clientWidth/element.clientHeight;camera.updateProjectionMatrix();renderer.setSize(element.clientWidth,element.clientHeight);};
    const observer=new ResizeObserver(resize);observer.observe(element);
    let lastReport=0;
    const animate=(now:number)=>{
      if(ready&&tour){const t=(now-start)/1000,r=90+35*Math.sin(t*.2);camera.position.set(Math.sin(t*.12)*r,28,Math.cos(t*.12)*r);camera.lookAt(0,6,0);dirty=true;}
      if(ready&&dirty)update();
      renderer.render(scene,camera);
      if(ready){
        if(firstFrame===null)firstFrame=performance.now()-start;
        if(previous&&now-start>allReady+2000&&document.visibilityState==="visible"){frames.push(now-previous);if(frames.length>1800)frames.shift();}
        previous=now;
        if(now-lastReport>1000){
          const sorted=[...frames].sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)]??0;
          const data={count,lods:[...lodCounts],fps:frames.length?1000/(frames.reduce((a,b)=>a+b,0)/frames.length):0,frameP95:p95,samples:frames.length,
            calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,firstFrameMs:firstFrame,allReadyMs:allReady,width:renderer.domElement.width,height:renderer.domElement.height,
            scope:"synthetic-grid-no-dashboard-no-shadows",gpuTiming:"not measured",previewMaterials:true,tour};
          element.dataset.metrics=JSON.stringify(data);
          if(status.current)status.current.textContent=JSON.stringify(data,null,2);
          lastReport=now;
        }
      }
      raf=requestAnimationFrame(animate);
    };raf=requestAnimationFrame(animate);
    return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();
      parts.forEach(p=>{p.mesh.geometry.dispose();(p.mesh.material as THREE.Material).dispose();});
      resources.forEach(root=>root.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose());}}));
      ground.geometry.dispose();ground.material.dispose();renderer.dispose();element.removeChild(renderer.domElement);
    };
  },[]);
  return <><div ref={host} id="variant-performance" style={{width:"100vw",height:"100vh"}}/><pre ref={status} style={{position:"fixed",top:12,left:12,color:"white",background:"#102025dd",padding:14,fontSize:13,pointerEvents:"none"}}>Loading offline variants…</pre></>;
}
