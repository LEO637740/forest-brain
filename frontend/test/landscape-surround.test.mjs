import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {landscapeSurround,surroundHeight} from '../src/landscapeSurround.ts';

test('soil microrelief is not extruded into ridges outside the boundary',()=>{
 const base=(x,z)=>({height:12});
 const soil=(x,z)=>({height:12+Math.sin(x*1.7+z*1.3)*.15});
 for(let x=-260;x<260;x+=3)for(let z=-310;z< -210;z+=3){
  assert.ok(Math.abs(surroundHeight(x,z,soil)-surroundHeight(x,z,base))<=.151);
 }
});

test('landscape shares foreground PBR material and world texture scale with no boundary height gap',()=>{
 const height=(x,z)=>Math.sin(x*.02)+Math.cos(z*.02);
 const field=(x,z)=>({height:height(x,z),litter:.6,roadMask:0,wet:.1,contact:0});
 const material=new THREE.MeshStandardMaterial();
 const mesh=landscapeSurround(height,material,field);
 assert.equal(mesh.material,material);
 const p=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv;
 let boundary=0;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i);
  assert.ok(Number.isFinite(p.getY(i)));
  assert.ok(Math.abs(uv.getX(i)-x/2.2)<.0001);
  if((Math.abs(x)===230&&Math.abs(z)<=210)||(Math.abs(z)===210&&Math.abs(x)<=230)){
   boundary++;assert.ok(Math.abs(p.getY(i)-height(x,z))<.000001);
  }
 }
 assert.ok(boundary>100);
 const ix=mesh.geometry.index;
 for(let i=0;i<ix.count;i+=3){
  const ids=[ix.getX(i),ix.getX(i+1),ix.getX(i+2)];
  const x=ids.reduce((v,j)=>v+p.getX(j),0)/3,z=ids.reduce((v,j)=>v+p.getZ(j),0)/3;
  assert.ok(Math.abs(x)>=230||Math.abs(z)>=210,'far terrain must not overlap operational plot');
 }
 mesh.geometry.dispose();material.dispose();
});
