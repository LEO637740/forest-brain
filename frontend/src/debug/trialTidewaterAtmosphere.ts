import * as THREE from 'three/webgpu';
import { atmosphereWGSL as src } from '../vendor/tidewaterAtmosphere';
import { createTidewaterCloudSnapshot } from './trialTidewaterClouds';

// Bounded bridge: execute the original atmospheric kernels on Three's device,
// read the fixed morning sky once, then give Three ordinary HDR textures.
// No second renderer, perpetual readback, private texture injection or cloud substitute.
const W=2048,H=1024,GAIN=1;
const {GPUBufferUsage,GPUTextureUsage,GPUShaderStage,GPUMapMode}=globalThis as unknown as {
 GPUBufferUsage:Record<string,number>;GPUTextureUsage:Record<string,number>;
 GPUShaderStage:Record<string,number>;GPUMapMode:Record<string,number>;
};
const paramsWGSL=`
const PI: f32 = 3.141592653589793;
struct Params {
 rayleighScale:f32, mieScale:f32, mieG:f32, ozoneScale:f32,
 groundAlbedo:vec3f, viewHeight:f32,
 sunIlluminance:vec3f, pad0:f32, sunDir:vec3f, pad1:f32
};
@group(0) @binding(0) var<uniform> atmosphereParams:Params;
@group(0) @binding(1) var smpLinearClamp:sampler;
`;

export async function createTidewaterAtmosphere(renderer:THREE.WebGPURenderer, direction:THREE.Vector3) {
 const availableDevice=(renderer.backend as unknown as {device?:GPUDevice}).device;
 if(!availableDevice)throw new Error('Tidewater WGSL 适配仅支持 WebGPU；WebGL 对照保留 HDR');
 const device:GPUDevice=availableDevice;
 const start=performance.now(),buffers:GPUBuffer[]=[],gpuTextures:GPUTexture[]=[];
 const uniform=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(uniform);
 device.queue.writeBuffer(uniform,0,new Float32Array([1,1,.8,1,.06,.08,.1,6360.002,11,11,11,0,...direction.toArray(),0]));
 const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
 const lut=(width:number,height:number)=>{const t=device.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});gpuTextures.push(t);return t;};
 const trans=lut(256,64),multi=lut(32,32),sky=lut(192,108);
 async function dispatch(code:string,inputs:{name:string;texture:GPUTexture}[],output:GPUTexture|GPUBuffer,w:number,h:number) {
   let header=paramsWGSL;
   const entries:GPUBindGroupLayoutEntry[]=[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,sampler:{type:'filtering'}}
   ];
   const resources:GPUBindGroupEntry[]=[{binding:0,resource:{buffer:uniform}},{binding:1,resource:sampler}];
   inputs.forEach((t,i)=>{header+=`@group(0) @binding(${i+2}) var ${t.name}:texture_2d<f32>;\n`;entries.push({binding:i+2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float'}});resources.push({binding:i+2,resource:t.texture.createView()});});
   const index=inputs.length+2,isBuffer='mapAsync' in output;
   header+=isBuffer?`@group(0) @binding(${index}) var<storage,read_write> result:array<vec4f>;\n`:`@group(0) @binding(${index}) var outLUT:texture_storage_2d<rgba16float,write>;\n`;
   entries.push(isBuffer?{binding:index,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}:{binding:index,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba16float'}});
   resources.push({binding:index,resource:isBuffer?{buffer:output as GPUBuffer}:(output as GPUTexture).createView()});
   const module=device.createShaderModule({label:'Tidewater atmosphere adaptation',code:header+code.replaceAll('WG_X','8').replaceAll('WG_Y','8').replaceAll('WG_Z','1')});
   const diagnostics=await module.getCompilationInfo();
   const errors=diagnostics.messages.filter(m=>m.type==='error');
   if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
   const layout=device.createBindGroupLayout({entries});
   const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'main'}});
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
   pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout,entries:resources}));pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();device.queue.submit([encoder.finish()]);
 }
 let background:THREE.DataTexture|undefined,ambient:THREE.DataTexture|undefined,environment:THREE.RenderTarget|undefined;
 let cloudBackground:THREE.DataTexture|undefined,cloudAmbient:THREE.DataTexture|undefined,cloudEnvironment:THREE.RenderTarget|undefined;
 try {
  await dispatch(src.core+src.trans,[],trans,256,64);
  await dispatch(src.core+src.transSample+src.multi,[{name:'atmosphereTransmittanceLUT',texture:trans}],multi,32,32);
  await dispatch(src.core+src.transSample+src.multiSample+src.sky,[{name:'atmosphereTransmittanceLUT',texture:trans},{name:'atmosphereMultiScatLUT',texture:multi}],sky,192,108);
  const bytes=(W*H*2+2)*16;
  const output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});buffers.push(output);
  const readback=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});buffers.push(readback);
  // Sky.js sun-disk limb darkening + disk-free environment composition.
  // Adapter's equirectangular output / fixed soil lower hemisphere are NOT upstream code.
  const pano=`
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=${W}u || gid.y>=${H}u){return;}
 let uv=(vec2f(gid.xy)+.5)/vec2f(${W}.0,${H}.0);
 let az=(uv.x-.5)*2.0*PI; let el=(.5-uv.y)*PI;
 let dir=vec3f(cos(el)*cos(az),sin(el),cos(el)*sin(az));
 // Upstream has a full island occluding the lower hemisphere. This bounded
 // test patch does not: extend horizon radiance below it rather than a black void.
 let skyDir=normalize(vec3f(dir.x,max(dir.y,.003),dir.z));
 let base=atmosphereSkyLuminance(skyDir);
 let ang=acos(clamp(dot(dir,atmosphereParams.sunDir),-1.0,1.0));
 let r=ang/0.00537625;
 let mask=1.0-smoothstep(.9,1.0,r);
 let mu=sqrt(max(1.0-r*r,0.0));
 let limb=1.0-.6*(1.0-mu);
 let disk=atmosphereTransmittanceToSpace(dir)*mask*limb*2500.0*smoothstep(-.02,0.0,dir.y);
 let i=gid.y*${W}u+gid.x;
 result[i]=vec4f((base+disk),1.0);
 let groundMix=1.0-smoothstep(-.22,0.0,dir.y);
 result[i+${W*H}u]=vec4f(mix(base,vec3f(.06,.05,.035),groundMix),1.0);
 if(i==0u) {
  result[${W*H*2}u]=vec4f(atmosphereSampleTransmittance(6360.001,atmosphereParams.sunDir.y)*11.0,1.0);
  result[${W*H*2+1}u]=vec4f(atmosphereSkyLuminance(normalize(vec3f(-atmosphereParams.sunDir.x,.03,-atmosphereParams.sunDir.z))),1.0);
 }
}
`;
  await dispatch(src.core+src.transSample+src.skySample+pano,[{name:'atmosphereTransmittanceLUT',texture:trans},{name:'atmosphereSkyViewLUT',texture:sky}],output,W,H);
  const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(output,0,readback,0,bytes);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);const values=new Float32Array(readback.getMappedRange()).slice();readback.unmap();
  if(!values.every(Number.isFinite))throw new Error('Atmosphere output contains non-finite values');
  const make=(offset:number,source=values)=>{const data=new Uint16Array(W*H*4);for(let i=0;i<data.length;i++)data[i]=THREE.DataUtils.toHalfFloat(Math.max(0,Math.min(60000,source[offset+i])));const t=new THREE.DataTexture(data,W,H,THREE.RGBAFormat,THREE.HalfFloatType);t.colorSpace=THREE.LinearSRGBColorSpace;t.mapping=THREE.EquirectangularReflectionMapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearFilter;t.flipY=true;t.needsUpdate=true;return t;};
  background=make(0);ambient=make(W*H*4);
  const generator=new THREE.PMREMGenerator(renderer);
  try {environment=generator.fromEquirectangular(ambient);} finally {generator.dispose();}
  const sunRGB=Array.from(values.slice(W*H*8,W*H*8+3));
  const horizonRGB=Array.from(values.slice(W*H*8+4,W*H*8+7));
  const clearBuildMs=performance.now()-start;
  // Cosine-weighted sky integral (radiance-equivalent E / PI), matching the
  // original irradiance readback's definition, using this fixed panorama.
  const irradiance=[0,0,0];let weight=0;
  for(let y=0;y<H/2;y++){const el=(.5-(y+.5)/H)*Math.PI,w=Math.sin(el)*Math.cos(el);for(let x=0;x<W;x++){const i=(y*W+x)*4+W*H*4;for(let c=0;c<3;c++)irradiance[c]+=values[i+c]*w;weight+=w;}}
  irradiance.forEach((_,i)=>irradiance[i]/=weight);
  const clouds=await createTidewaterCloudSnapshot(device,uniform,paramsWGSL,trans,sky,direction.toArray(),sunRGB,irradiance,W,H);
  const mixed=values.slice();
  for(let i=0;i<W*H*4;i+=4){
   const T=THREE.MathUtils.clamp(clouds.data[i+3],0,1),sunT=T*THREE.MathUtils.smoothstep(T,.004,.04);
   for(let c=0;c<3;c++){
    const base=values[W*H*4+i+c],disk=Math.max(0,values[i+c]-base);
    // Lower hemisphere is unchanged; the finite test patch has no world shell.
    if(i<W*H*2){mixed[i+c]=base*T+disk*sunT+clouds.data[i+c];mixed[W*H*4+i+c]=base*T+clouds.data[i+c];}
   }
  }
  cloudBackground=make(0,mixed);cloudAmbient=make(W*H*4,mixed);
  const cloudGenerator=new THREE.PMREMGenerator(renderer);
  try{cloudEnvironment=cloudGenerator.fromEquirectangular(cloudAmbient);}finally{cloudGenerator.dispose();}
  const sunX=Math.min(W-1,Math.floor((Math.atan2(direction.z,direction.x)/(Math.PI*2)+.5)*W));
  const sunY=Math.min(H-1,Math.floor((.5-Math.asin(direction.y)/Math.PI)*H));
  const solarT=THREE.MathUtils.clamp(clouds.data[(sunY*W+sunX)*4+3],0,1);
  return {background,environment:environment.texture,sunRGB,horizonRGB,
   cloudy:{background:cloudBackground,ambient:cloudAmbient,environment:cloudEnvironment.texture,solarT,metadata:{...clouds.metadata,solarT,skyIrradiance:irradiance}},
   metadata:{source:'dgreenheck/tidewater',commit:'4811ba48d795197de5621985f404e765c0b7c0ef',ported:'Atmosphere.js: LUTs; Sky.js: solar disk; Clouds.js: cumulus density, erosion and detailed march',adapter:'fixed morning panorama + Three PMREM; no per-frame sky compute',clouds:true,postProcessing:false,panorama:[W,H],radianceGain:GAIN,sunRGB,clearBuildMs,buildMs:performance.now()-start},
   dispose:()=>{background?.dispose();ambient?.dispose();environment?.dispose();cloudBackground?.dispose();cloudAmbient?.dispose();cloudEnvironment?.dispose();}};
 } catch(error){background?.dispose();ambient?.dispose();environment?.dispose();cloudBackground?.dispose();cloudAmbient?.dispose();cloudEnvironment?.dispose();throw error;}
 finally {gpuTextures.forEach(t=>t.destroy());buffers.forEach(b=>b.destroy());}
}
