import * as THREE from 'three';
import { addSampleLighting } from './sampleLighting';

/** Prebaked Tidewater HDR. The homepage no longer initializes WebGPU. */
export function addHomeTidewaterLighting(scene:THREE.Scene,renderer:THREE.WebGLRenderer){
  let disposed=false, fallback:ReturnType<typeof addSampleLighting>|undefined;
  let background:THREE.DataTexture|undefined,ambient:THREE.DataTexture|undefined,environment:THREE.WebGLRenderTarget|undefined;
  let sun:THREE.DirectionalLight|undefined,fill:THREE.HemisphereLight|undefined;
  const abort=new AbortController(),started=performance.now(),canvas=renderer.domElement;
  const report=(v:object)=>{document.documentElement.dataset.homeTidewater=JSON.stringify(v);};
  canvas.style.opacity='0';
  const loading=document.createElement('div');loading.textContent='正在载入胶园…';loading.setAttribute('role','status');
  Object.assign(loading.style,{position:'absolute',inset:'0',display:'grid',placeItems:'center',background:'#aebfc6',color:'#18392f',pointerEvents:'none'});
  canvas.parentElement?.appendChild(loading);
  const reveal=()=>{if(!disposed){canvas.style.opacity='1';loading.remove();}};
  report({status:'loading',sceneBackend:'WebGL2',skyBackend:'prebaked HDR'});
  const read=async(name:string)=>{
    const r=await fetch('/assets/environment/tidewater-morning/'+name+'.bin',{signal:abort.signal});
    if(!r.ok||!r.body)throw new Error('Sky asset HTTP '+r.status);
    const b=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(b.byteLength!==2048*1024*8)throw new Error('Invalid sky texture size');
    return new Uint16Array(b);
  };
  const make=(data:Uint16Array)=>{
    const t=new THREE.DataTexture(data,2048,1024,THREE.RGBAFormat,THREE.HalfFloatType);
    t.colorSpace=THREE.LinearSRGBColorSpace;t.mapping=THREE.EquirectangularReflectionMapping;
    t.flipY=true;t.magFilter=t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
  };
  const ready=(async()=>{
    try{
      const [bg,env]=await Promise.all([read('background'),read('ambient')]);if(disposed)return;
      background=make(bg);ambient=make(env);
      const generator=new THREE.PMREMGenerator(renderer);
      try{environment=generator.fromEquirectangular(ambient);}finally{generator.dispose();}
      scene.background=background;scene.environment=environment.texture;
      scene.backgroundRotation.set(0,0,0);scene.environmentRotation.set(0,0,0);
      scene.backgroundIntensity=1;scene.environmentIntensity=1.3;scene.backgroundBlurriness=0;
      scene.fog=new THREE.Fog('#b7c8cb',380,1300);renderer.toneMappingExposure=1.03;
      fill=new THREE.HemisphereLight('#e0e7e8','#8c8068',.58);
      const rgb=[9.689453125,8.185546875,6.2412109375],peak=Math.max(...rgb);
      // Keep the baked sun direction/color; soften direct illumination for the plantation materials.
      sun=new THREE.DirectionalLight(new THREE.Color().setRGB(rgb[0]/peak,rgb[1]/peak,rgb[2]/peak),peak*.62);
      sun.target.position.set(0,0,-2);
      sun.position.copy(sun.target.position).addScaledVector(new THREE.Vector3(.7858739156,.4738286536,-.3973519798).normalize(),240);
      sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
      Object.assign(sun.shadow.camera,{left:-150,right:150,top:125,bottom:-125,near:1,far:550});
      sun.shadow.bias=-.00006;sun.shadow.normalBias=.055;sun.shadow.radius=2*116/300*2;
      scene.add(fill,sun,sun.target);renderer.shadowMap.needsUpdate=true;
      report({status:'ready',sceneBackend:'WebGL2',skyBackend:'prebaked HDR',runtimeWebGPU:false,readyMs:performance.now()-started});
      reveal();
    }catch(error){if(!disposed){fallback=addSampleLighting(scene,renderer,true,true);report({status:'fallback',reason:String(error)});console.warn('Homepage sky fallback:',error);reveal();}}
  })();
  return {ready,dispose:()=>{
    disposed=true;abort.abort();loading.remove();canvas.style.opacity='';fallback?.dispose();
    if(sun){scene.remove(sun,sun.target);sun.shadow.map?.dispose();}if(fill)scene.remove(fill);
    if(scene.background===background)scene.background=null;if(scene.environment===environment?.texture)scene.environment=null;
    environment?.dispose();background?.dispose();ambient?.dispose();delete document.documentElement.dataset.homeTidewater;
  }};
}
