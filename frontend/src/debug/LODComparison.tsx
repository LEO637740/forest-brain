import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { prepareTreeGeometry, prepareTreeMaterial, type TreeLODLevel } from "../treeVisuals";
import { addMorningLighting } from "../morningLighting";

export function LODComparison() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a5c8c1");
    const renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(1);
    renderer.setSize(element.clientWidth,element.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    element.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38,element.clientWidth/element.clientHeight,.1,240);
    camera.position.set(0,19,65);
    const controls = new OrbitControls(camera,renderer.domElement);
    controls.target.set(0,6,0); controls.update();
    addMorningLighting(scene, renderer, true);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(130,90),new THREE.MeshStandardMaterial({color:"#777b67",roughness:.9}));
    ground.rotation.x = -Math.PI/2; ground.position.y = -.02; ground.receiveShadow = true; scene.add(ground);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    let disposed = false;
    const roots: THREE.Group[] = [];
    const baseline = new URLSearchParams(location.search).has("baseline");
    void Promise.all([0,1,2,3].map(async lod => {
      const gltf = await loader.loadAsync(`/assets/trees/mature-family-v1/RT_Mature_B_LOD${lod}.glb`);
      const root = gltf.scene;
      roots.push(root);
      if (disposed) return;
      root.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true; node.receiveShadow = true;
        const source = Array.isArray(node.material) ? node.material[0] : node.material;
        if (!baseline) node.geometry = prepareTreeGeometry(node.geometry, lod as TreeLODLevel, source);
        node.material = baseline ? source.clone() : prepareTreeMaterial(source, { lod: lod as TreeLODLevel });
        if (baseline) {
          const m = node.material as THREE.MeshStandardMaterial;
          if (/leaf/i.test(m.name)) { m.color.set(/cluster/i.test(m.name)?"#718c58":"#78975d"); m.roughness=.78; m.emissive.set("#24452a");m.emissiveIntensity=.08; }
          else {m.color.set("#c2ad92");m.roughness=.88;m.metalness=0;}
          m.forceSinglePass = true;
        }
      });
      root.position.x = (lod-1.5)*14;
      scene.add(root); root.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      document.documentElement.setAttribute(`data-lod${lod}`,JSON.stringify(size.toArray()));
      const canvas = document.createElement("canvas"); canvas.width=512;canvas.height=96;
      const ctx=canvas.getContext("2d")!;ctx.fillStyle="#eff6ed";ctx.font="36px sans-serif";ctx.textAlign="center";
      ctx.fillText(`LOD ${lod} · ${size.y.toFixed(2)} m`,256,54);
      const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));
      label.position.set(root.position.x,-.3,5);label.scale.set(11,2.06,1);scene.add(label);
      renderer.shadowMap.needsUpdate=true;
    })).then(()=>{if(!disposed)document.documentElement.dataset.lodComparison="ready";}).catch(console.error);
    let frame=0;
    const resize = () => {
      camera.aspect=element.clientWidth/element.clientHeight;camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth,element.clientHeight);
    };
    const observer = new ResizeObserver(resize);observer.observe(element);
    const animate=()=>{renderer.render(scene,camera);frame=requestAnimationFrame(animate);};animate();
    return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.dispose();
      roots.forEach(root=>root.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();const ms=Array.isArray(n.material)?n.material:[n.material];ms.forEach(m=>{Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)v.dispose();});m.dispose();});}}));
      element.removeChild(renderer.domElement);
    };
  },[]);
  return <div ref={host} style={{width:"100vw",height:"100vh"}} aria-label="Mature B 四级LOD同光照对照" />;
}
