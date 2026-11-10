import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {chunkVegetation} from '../src/vegetationChunks.ts';

test('spatial batches retain every plant transform and tint with finite culling bounds',()=>{
 const group=new THREE.Group(),source=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),120);
 source.name='Sample_LowHerb';group.add(source);
 const expected=new Map(),m=new THREE.Matrix4(),color=new THREE.Color();
 for(let i=0;i<120;i++){
  m.makeTranslation(i*3,Math.sin(i),i%7*31);source.setMatrixAt(i,m);
  color.setRGB(i/120,.5,.2);source.setColorAt(i,color);expected.set(m.elements[12],m.elements[13]);
 }
 const count=chunkVegetation(group);assert.ok(count>1);let total=0;
 for(const mesh of group.children){assert.ok(Number.isFinite(mesh.boundingSphere.radius));
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);assert.ok(Math.abs(m.elements[13]-expected.get(m.elements[12]))<1e-6);expected.delete(m.elements[12]);total++;}}
 assert.equal(total,120);assert.equal(expected.size,0);
 const camera=new THREE.PerspectiveCamera();camera.position.set(0,200,300);group.userData.updateVegetation(camera);
 assert.ok(group.children.every(c=>c.visible),'broad-leaf plants must not disappear at overview range');
});

test('leaf litter returns when the camera comes back close',()=>{
 const group=new THREE.Group(),mesh=new THREE.InstancedMesh(new THREE.CircleGeometry(.1),new THREE.MeshBasicMaterial(),1);
 mesh.name='Canopy_Leaf_Litter';mesh.setMatrixAt(0,new THREE.Matrix4());group.add(mesh);chunkVegetation(group);
 const camera=new THREE.PerspectiveCamera();camera.position.set(0,200,0);group.userData.updateVegetation(camera);assert.equal(group.children[0].visible,false);
 camera.position.set(0,2,0);group.userData.updateVegetation(camera);assert.equal(group.children[0].visible,true);
});
