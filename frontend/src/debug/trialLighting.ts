import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { createTidewaterAtmosphere } from './trialTidewaterAtmosphere';

export type TrialLightMode = 'baseline' | 'sky' | 'matched' | 'tidewater' | 'clouds';

/** A photographic lighting reference, NOT volumetric clouds or a solar ephemeris.
 * Background and IBL share orientation. The measured HDR solar hotspot drives
 * the direct-light direction; only the IBL copy has the hotspot capped, avoiding
 * a second unshadowed sun. Source asset remains untouched. */
export async function createTrialLighting(scene: THREE.Scene, renderer: THREE.WebGPURenderer,
  sun: THREE.DirectionalLight, fill: THREE.HemisphereLight) {
  const sky = await new HDRLoader().loadAsync('/assets/environment/webgpu-light/rustig_koppie_puresky_2k.hdr');
  const { width, height } = sky.image;
  const data = sky.image.data as Uint16Array;
  const read = (i:number) => THREE.DataUtils.fromHalfFloat(data[i]);
  const luminance = (i:number) => read(i)*.2126 + read(i+1)*.7152 + read(i+2)*.0722;
  let peak=0, peakPixel=0;
  const samples:number[]=[];
  for(let y=0;y<height/2;y++)for(let x=0;x<width;x++) {
    const i=(y*width+x)*4,l=luminance(i);
    if(l>peak){peak=l;peakPixel=y*width+x;}
    if(x%16===0&&y%8===0)samples.push(l);
  }
  samples.sort((a,b)=>a-b);
  const median=samples[Math.floor(samples.length*.5)];
  const gain=.48/Math.max(.01,median);
  // HDRLoader flipY=true: row zero is the zenith, not the nadir.
  const px=peakPixel%width,py=Math.floor(peakPixel/width);
  let sx=0,sy=0,sz=0,total=0;
  for(let y=Math.max(0,py-5);y<=Math.min(height/2-1,py+5);y++)for(let dx=-5;dx<=5;dx++){
    const x=(px+dx+width)%width,l=luminance((y*width+x)*4);
    if(l<peak*.25)continue;
    const az=((x+.5)/width-.5)*Math.PI*2,el=(.5-(y+.5)/height)*Math.PI;
    sx+=Math.cos(el)*Math.cos(az)*l;sy+=Math.sin(el)*l;sz+=Math.cos(el)*Math.sin(az)*l;total+=l;
  }
  if(!total){sky.dispose();throw new Error('HDR solar hotspot not found');}
  const sourceSun=new THREE.Vector3(sx/total,sy/total,sz/total).normalize();
  const yaw=Math.atan2(sourceSun.z,sourceSun.x)-Math.atan2(-.45,.89);
  const direction=sourceSun.clone().applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
  const ambientData=new Uint16Array(data.length);
  for(let i=0;i<data.length;i+=4){
    const rgb=[read(i)*gain,read(i+1)*gain,read(i+2)*gain];
    const lum=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    const cap=Math.min(1,2.5/Math.max(lum,.0001));
    // A pure-sky panorama has synthetic sky below the horizon. Do not let that
    // light the underside of the entire forest blue: replace only the IBL's
    // lower hemisphere with a subdued soil bounce, not the visible sky image.
    const row=Math.floor(i/4/width)/height;
    const groundWeight=THREE.MathUtils.smoothstep(row,.5,.62);
    const groundBounce=[.085,.073,.05];
    for(let c=0;c<3;c++){
      data[i+c]=THREE.DataUtils.toHalfFloat(Math.min(60000,rgb[c]));
      ambientData[i+c]=THREE.DataUtils.toHalfFloat(THREE.MathUtils.lerp(rgb[c]*cap,groundBounce[c],groundWeight));
    }
    ambientData[i+3]=data[i+3];
  }
  sky.mapping=THREE.EquirectangularReflectionMapping;sky.needsUpdate=true;
  const ambient=new THREE.DataTexture(ambientData,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
  ambient.colorSpace=THREE.LinearSRGBColorSpace;ambient.flipY=true;
  ambient.mapping=THREE.EquirectangularReflectionMapping;ambient.needsUpdate=true;
  const generator=new THREE.PMREMGenerator(renderer);
  const environment=generator.fromEquirectangular(ambient);
  generator.dispose();
  const nativeGPU=!!(renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend;
  let tidewater:Awaited<ReturnType<typeof createTidewaterAtmosphere>>|null=null;
  try {tidewater=nativeGPU?await createTidewaterAtmosphere(renderer,direction):null;}
  catch(error){environment.dispose();ambient.dispose();sky.dispose();throw error;}
  const metadata={source:'Poly Haven / Rustig Koppie Pure Sky / CC0 / 2K',kind:'static photographic HDR + hotspot-capped PMREM + matched direct sun',
    sunElevationDegrees:THREE.MathUtils.radToDeg(Math.asin(direction.y)),sunDirection:direction.toArray(),rotationRadians:yaw,radianceGain:gain,
    geometryChanged:false,volumetricClouds:false,tidewater:tidewater?.metadata??null};
  let softUnderstory=true;
  let fogProfile:'original'|'light'|'off'='light';
  let scaleAware=true;
  const updateShadow=()=>{
    const span=sun.shadow.camera.right-sun.shadow.camera.left;
    sun.shadow.radius=(softUnderstory?2:1)*(scaleAware?116/span:1);
    sun.shadow.needsUpdate=true;
  };
  const updateFog=()=>{
    if(fogProfile==='off'){scene.fog=null;return;}
    const color=tidewater&&(currentMode==='tidewater'||currentMode==='clouds')
      ?new THREE.Color().setRGB(...tidewater.horizonRGB as [number,number,number]):new THREE.Color('#b9cfdf');
    scene.fog=new THREE.Fog(color,fogProfile==='light'?220:140,fogProfile==='light'?650:330);
  };
  let currentMode:TrialLightMode='matched';
  const apply=(mode:TrialLightMode)=>{
    currentMode=mode;
    // Keep the five-tap PCF footprint small: larger radii expose stippling.
    updateShadow();
    sun.shadow.normalBias=.08;
    fill.color.set(softUnderstory?'#d7e3e8':'#dbeafb');
    fill.groundColor.set(softUnderstory?'#a18d69':'#776f5e');
    if((mode==='tidewater'||mode==='clouds')&&tidewater){
      const clouds=mode==='clouds';
      scene.background=clouds?tidewater.cloudy.background:tidewater.background;scene.environment=clouds?tidewater.cloudy.environment:tidewater.environment;
      scene.backgroundRotation.set(0,0,0);scene.environmentRotation.set(0,0,0);
      scene.backgroundIntensity=1;scene.backgroundBlurriness=0;scene.environmentIntensity=1;
      renderer.toneMappingExposure=1.03;fill.intensity=softUnderstory?.32:.08;
      const peak=Math.max(...tidewater.sunRGB);
      sun.color.setRGB(tidewater.sunRGB[0]/peak,tidewater.sunRGB[1]/peak,tidewater.sunRGB[2]/peak);sun.intensity=peak*(clouds?tidewater.cloudy.solarT:1);
      sun.position.copy(direction.clone().multiplyScalar(90));sun.shadow.needsUpdate=true;
      scene.fog=new THREE.Fog(new THREE.Color().setRGB(...tidewater.horizonRGB as [number,number,number]),140,330);
      updateFog();
      return;
    }
    const matched=mode==='matched';
    scene.background=mode==='baseline'?new THREE.Color('#bdd6e4'):sky;
    scene.backgroundRotation.set(0,yaw,0);scene.environmentRotation.set(0,yaw,0);
    scene.backgroundIntensity=.55;scene.backgroundBlurriness=0;
    scene.environment=matched?environment.texture:null;scene.environmentIntensity=.35;
    renderer.toneMappingExposure=1.03;
    scene.fog=new THREE.Fog(matched?'#b9cfdf':'#bdd6e4',matched?140:110,matched?330:260);
    fill.intensity=matched?.12:1.05;
    sun.intensity=matched?2.6:2.3;sun.color.set(matched?'#fff2da':'#fff7e9');
    sun.position.copy(matched?direction.clone().multiplyScalar(90):new THREE.Vector3(45,65,35));
    sun.shadow.needsUpdate=true;
    updateFog();
  };
  const describe=(mode:TrialLightMode)=>(mode==='tidewater'||mode==='clouds')&&tidewater
    ?{...metadata,source:'Tidewater / MIT / pinned atmospheric WGSL',kind:tidewater.metadata.adapter,rotationRadians:0,radianceGain:tidewater.metadata.radianceGain,volumetricClouds:mode==='clouds',cloudSnapshot:tidewater.cloudy.metadata,mode}
    :{...metadata,mode};
  const understory=(enabled:boolean)=>{softUnderstory=enabled;apply(currentMode);};
  const distanceSettings=(fog:typeof fogProfile,scaled:boolean)=>{fogProfile=fog;scaleAware=scaled;updateFog();updateShadow();};
  return {apply,understory,updateShadow,distanceSettings,metadata,describe,dispose:()=>{scene.environment=null;scene.background=null;tidewater?.dispose();environment.dispose();ambient.dispose();sky.dispose();}};
}
