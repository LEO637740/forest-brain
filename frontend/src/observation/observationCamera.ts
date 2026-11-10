import * as THREE from 'three';
import {attachObservationCamera} from './robotObservation';

export function installObservationCamera(renderer:THREE.WebGLRenderer,scene:THREE.Scene,trees:{x:number;z:number}[],height:(x:number,z:number)=>number,robotPosition:(zone:number)=>THREE.Vector3|undefined,prepare:(index:number|null)=>void){
 return attachObservationCamera(index=>{
  const tree=trees[index],position=robotPosition(Math.floor(index/50));
  if(!tree||!position)throw Error('目标树或机器人未加载');
  if(Math.hypot(position.x-tree.x,position.z-tree.z)>2)throw Error('机器人尚未到达目标树，不能生成回执');
  const camera=new THREE.PerspectiveCamera(58,4/3,.05,1500);
  camera.position.copy(position);camera.lookAt(tree.x,height(tree.x,tree.z)+1.35,tree.z);camera.updateMatrixWorld();
  const target=new THREE.WebGLRenderTarget(640,480);target.texture.colorSpace=THREE.SRGBColorSpace;
  const previous=renderer.getRenderTarget(),pixels=new Uint8Array(640*480*4);
  const hidden:THREE.Object3D[]=[];
  try{
   prepare(index);
   // Do not photograph UI labels or the camera's own robot housing.
   scene.traverse(o=>{if(o.visible&&(o instanceof THREE.Sprite||o.name==='ZONE_ROBOT_'+'ABCD'[Math.floor(index/50)])){hidden.push(o);o.visible=false;}});
   renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,640,480,pixels);
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建相机图像');
   const image=ctx.createImageData(640,480);
   for(let y=0;y<480;y++)image.data.set(pixels.subarray((479-y)*2560,(480-y)*2560),y*2560);
   ctx.putImageData(image,0,0);
   return {image:canvas.toDataURL('image/jpeg',.85),width:640,height:480,position:camera.position.toArray()};
  }finally{hidden.forEach(o=>o.visible=true);renderer.setRenderTarget(previous);target.dispose();prepare(null);}
 });
}
