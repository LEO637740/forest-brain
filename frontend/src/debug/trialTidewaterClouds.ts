import { cloudWGSL as cloud } from '../vendor/tidewaterClouds';
import { atmosphereWGSL as atmo } from '../vendor/tidewaterAtmosphere';

type Input={name:string;texture:GPUTexture};
const {GPUBufferUsage:B,GPUTextureUsage:T,GPUShaderStage:S,GPUMapMode:M}=globalThis as unknown as {
 GPUBufferUsage:Record<string,number>;GPUTextureUsage:Record<string,number>;GPUShaderStage:Record<string,number>;GPUMapMode:Record<string,number>;
};
const f=(v:number)=>Number.isInteger(v)?v+'.0':String(v);
const v3=(v:number[])=>'vec3f('+v.map(f).join(',')+')';

/** Fixed cumulus snapshot, not a moving cloud renderer. Original detailed view
 * march is sampled into an equirectangular sky; four deterministic samples replace
 * temporal accumulation. Cirrus, ground cloud shadows and wind animation excluded. */
export async function createTidewaterCloudSnapshot(device:GPUDevice,uniform:GPUBuffer,paramsWGSL:string,
 trans:GPUTexture,sky:GPUTexture,sunDir:number[],sunRGB:number[],skyIrradiance:number[],width:number,height:number) {
 const started=performance.now(),textures:GPUTexture[]=[],buffers:GPUBuffer[]=[];
 const make=(w:number,h:number,d=1)=>{const t=device.createTexture({size:[w,h,d],dimension:d>1?'3d':'2d',format:'rgba8unorm',usage:T.TEXTURE_BINDING|T.STORAGE_BINDING});textures.push(t);return t;};
 const shape=make(128,128,128),detail=make(64,64,64),weather=make(512,512),sdfA=make(256,256,16),sdfB=make(256,256,16),sdf=make(256,256,16);
 const clamp=device.createSampler({magFilter:'linear',minFilter:'linear'});
 const repeat=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
 const tile=device.createBuffer({size:16,usage:B.UNIFORM|B.COPY_DST});buffers.push(tile);
 const fixed=`
fn sat(x:f32)->f32{return clamp(x,0.0,1.0);}
fn pow2(x:f32)->f32{return x*x;}
struct CloudConfig {coverage:f32,densityScale:f32,bottom:f32,top:f32,camY:f32,horizonY:f32,
 nOrigin:vec2f,wOrigin:vec2f,camXZ:vec2f,windN:vec2f,camTan:vec2f,displayH:f32,sdfCoverage:f32};
const cloudsParams=CloudConfig(.58,.07,750.0,2400.0,2.0,-.001,vec2f(0.0),vec2f(0.0),vec2f(0.0),vec2f(1.0,0.0),vec2f(1.0,1.57079632679),${f(height)},.58);
struct Frame {time:f32,sunDir:vec3f,sunColor:vec3f,skyIrradiance:vec3f};
const frame=Frame(0.0,${v3(sunDir)},${v3(sunRGB)},${v3(skyIrradiance)});
`;
 async function dispatch(code:string,inputs:Input[],output:GPUTexture|GPUBuffer,size:number[],wg=[8,8,1]) {
  let header=paramsWGSL+`@group(0) @binding(2) var smpLinearRepeat:sampler;
struct Tile {offset:vec3u,pad:u32}; @group(0) @binding(3) var<uniform> tile:Tile;\n`+fixed;
  const entries:GPUBindGroupLayoutEntry[]=[
   {binding:0,visibility:S.COMPUTE,buffer:{type:'uniform'}},{binding:1,visibility:S.COMPUTE,sampler:{type:'filtering'}},
   {binding:2,visibility:S.COMPUTE,sampler:{type:'filtering'}},{binding:3,visibility:S.COMPUTE,buffer:{type:'uniform'}}
  ];
  const resources:GPUBindGroupEntry[]=[{binding:0,resource:{buffer:uniform}},{binding:1,resource:clamp},{binding:2,resource:repeat},{binding:3,resource:{buffer:tile}}];
  inputs.forEach((t,i)=>{const dimension=t.texture.dimension==='3d'?'3d':'2d';header+=`@group(0) @binding(${i+4}) var ${t.name}:texture_${dimension}<f32>;\n`;entries.push({binding:i+4,visibility:S.COMPUTE,texture:{sampleType:'float',viewDimension:dimension}});resources.push({binding:i+4,resource:t.texture.createView()});});
  const index=inputs.length+4,isBuffer='mapAsync' in output;
  if(isBuffer){header+=`@group(0) @binding(${index}) var<storage,read_write> result:array<vec4f>;\n`;entries.push({binding:index,visibility:S.COMPUTE,buffer:{type:'storage'}});resources.push({binding:index,resource:{buffer:output as GPUBuffer}});}
  else {const t=output as GPUTexture;header+=`@group(0) @binding(${index}) var outTex:texture_storage_${t.dimension}<rgba8unorm,write>;\n`;entries.push({binding:index,visibility:S.COMPUTE,storageTexture:{access:'write-only',format:'rgba8unorm',viewDimension:t.dimension as GPUTextureViewDimension}});resources.push({binding:index,resource:t.createView()});}
  code=code.replaceAll('WG_X',String(wg[0])).replaceAll('WG_Y',String(wg[1])).replaceAll('WG_Z',String(wg[2]));
  code=code.replace(/fn main\(\s*@builtin\(\s*global_invocation_id\s*\)\s*gid:\s*vec3u\s*\)\s*\{/,'fn main(@builtin(global_invocation_id) rawGid:vec3u) { let gid=rawGid+tile.offset;');
  const module=device.createShaderModule({label:'Tidewater cumulus snapshot',code:header+code});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
  const layout=device.createBindGroupLayout({entries}),group=device.createBindGroup({layout,entries:resources});
  const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'main'}});
  // Small sequential tiles avoid a long single GPU task / driver watchdog.
  const depth=size[2]??1,axis=depth>1?2:1,stride=depth>1?4:16;
  for(let start=0;start<size[axis];start+=stride){
   const offset=new Uint32Array(4);offset[axis]=start;device.queue.writeBuffer(tile,0,offset);
   const extent=[size[0],size[1],depth];extent[axis]=Math.min(stride,size[axis]-start);
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);
   pass.dispatchWorkgroups(Math.ceil(extent[0]/wg[0]),Math.ceil(extent[1]/wg[1]),Math.ceil(extent[2]/wg[2]));pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
  }
 }
 try {
  await dispatch(cloud.noise+cloud.shape,[],shape,[128,128,128],[4,4,4]);
  await dispatch(cloud.noise+cloud.detail,[],detail,[64,64,64],[4,4,4]);
  await dispatch(cloud.noise+cloud.weather,[],weather,[512,512]);
  await dispatch(cloud.helpers+cloud.occ,[{name:'weatherTex',texture:weather}],sdfA,[256,256,16]);
  await dispatch(cloud.sdfX,[{name:'src',texture:sdfA}],sdfB,[256,256,16]);
  await dispatch(cloud.sdfY,[{name:'src',texture:sdfB}],sdfA,[256,256,16]);
  await dispatch(cloud.sdfZ,[{name:'src',texture:sdfA}],sdf,[256,256,16]);
  const noiseReadyMs=performance.now()-started,bytes=width*height*16;
  const output=device.createBuffer({size:bytes,usage:B.STORAGE|B.COPY_SRC});buffers.push(output);
  const readback=device.createBuffer({size:bytes,usage:B.MAP_READ|B.COPY_DST});buffers.push(readback);
  const pano=`
fn pixelHash(px:vec2f)->f32{
 var p3=fract(vec3f(px.x,px.y,px.x)*vec3f(.1031,.1030,.0973));
 p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);
}
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=${width}u || gid.y>=${height}u){return;}
 let uv=(vec2f(gid.xy)+.5)/vec2f(${f(width)},${f(height)});
 let az=(uv.x-.5)*2.0*PI;let el=(.5-uv.y)*PI;
 let rd=vec3f(cos(el)*cos(az),sin(el),cos(el)*sin(az));
 var sum=vec4f(0.0,0.0,0.0,1.0);
 if(rd.y>-.001){
  sum=vec4f(0.0);let jitter=pixelHash(vec2f(gid.xy));
  for(var j=0;j<4;j++){let m=cloudsMarchView(rd,fract(jitter+f32(j)*.61803398875));sum+=vec4f(m.L,m.T)*.25;}
 }
 result[gid.y*${width}u+gid.x]=sum;
}`;
  await dispatch(atmo.core+atmo.transSample+atmo.skySample+cloud.helpers+cloud.core+pano,
   [{name:'atmosphereTransmittanceLUT',texture:trans},{name:'atmosphereSkyViewLUT',texture:sky},{name:'cloudsWeatherTex',texture:weather},
    {name:'cloudsShapeTex',texture:shape},{name:'cloudsDetailTex',texture:detail},{name:'cloudsSdfTex',texture:sdf}],output,[width,height]);
  const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(output,0,readback,0,bytes);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(M.READ);const data=new Float32Array(readback.getMappedRange()).slice();readback.unmap();
  if(!data.every(Number.isFinite))throw new Error('Cloud snapshot contains non-finite values');
  let cloudy=0;for(let i=3;i<width*height*2;i+=4)if(data[i]<.95)cloudy++;
  return {data,metadata:{kind:'original detailed cumulus volume march baked once; not animated',coverage:.58,samplesPerPixel:4,noiseReadyMs,buildMs:performance.now()-started,upperPixelsCloudyFraction:cloudy/(width*height/2),cirrus:false,cloudShadows:false}};
 } finally {textures.forEach(t=>t.destroy());buffers.forEach(b=>b.destroy());}
}
