import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {BufferGeometry,Int16BufferAttribute,Matrix4,Quaternion,Vector3} from 'three';
import {bakeWorldGeometry,circumferenceRadius,cutPoint,predictionDelta,trunkSection} from '../src/integration/growthGeometry.ts';

test('growth comparison uses centimetres to metres without magnifying forecast deltas',()=>{
 const r=circumferenceRadius(66),f=circumferenceRadius(66.4);
 assert.ok(Math.abs(r*2*Math.PI-.66)<1e-12);
 assert.ok(Math.abs(f/r-66.4/66)<1e-12);
 assert.ok(Math.abs(predictionDelta(66,66.4).cm-.4)<1e-10);
 for(const n of [0,-1,NaN,Infinity])assert.throws(()=>circumferenceRadius(n));
});
test('illustrated cut lies on the registered cylinder and slope is relative to horizontal',()=>{
 const r=circumferenceRadius(66),angle=30,start=cutPoint(r,angle,0),end=cutPoint(r,angle,1);
 assert.ok(Math.abs((start.y-end.y)/(Math.PI*r)-Math.tan(Math.PI/6))<1e-12);
 for(const yaw of [0,Math.PI/2,Math.PI])for(const t of [0,.25,.5,.75,1]){
  const p=cutPoint(r,angle,t,yaw);assert.ok(Math.abs(Math.hypot(p.x,p.z)-r)<1e-12);
 }
});
test('cross-section registration rejects missing geometry and removes off-centre asset coordinates',()=>{
 assert.throws(()=>trunkSection([]));
 const section=trunkSection([{x:1.2,y:1.3,z:2},{x:.8,y:1.3,z:2},{x:1,y:1.3,z:2.2},{x:1,y:1.3,z:1.8},{x:90,y:7,z:0}]);
 assert.equal(section.x,1);assert.equal(section.z,2);assert.ok(Math.abs(section.radius-.2)<1e-10);
});
test('the reused mature-tree GLB actually contains a usable bark cross-section at inspection height',async()=>{
 const bytes=readFileSync(new URL('../public/assets/trees/mature-family-v1/RT_Mature_A_LOD1.glb',import.meta.url)),jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binary=bytes.subarray(28+jsonLength);
 const node=gltf.nodes.find(n=>/Body/.test(n.name)),primitive=gltf.meshes[node.mesh].primitives[0],accessor=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[accessor.bufferView],ext=view.extensions.EXT_meshopt_compression;
 await MeshoptDecoder.ready;
 const decoded=new Uint8Array(ext.count*ext.byteStride);MeshoptDecoder.decodeGltfBuffer(decoded,ext.count,ext.byteStride,binary.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode,ext.filter);
 assert.equal(accessor.componentType,5122);assert.equal(accessor.normalized,true);
 const data=new DataView(decoded.buffer),values=new Int16Array(accessor.count*3);
 for(let i=0;i<accessor.count;i++)for(let axis=0;axis<3;axis++)values[i*3+axis]=data.getInt16(i*ext.byteStride+axis*2+(accessor.byteOffset??0),true);
 const original=new BufferGeometry().setAttribute('position',new Int16BufferAttribute(values,3,true));
 const matrix=new Matrix4().compose(new Vector3(...node.translation),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...node.scale));
 const baked=bakeWorldGeometry(original,matrix),position=baked.getAttribute('position'),points=[];
 assert.ok(position.array instanceof Float32Array);assert.equal(original.getAttribute('position').normalized,true);
 for(let i=0;i<position.count;i++)points.push(new Vector3().fromBufferAttribute(position,i));
 const section=trunkSection(points);assert.ok(section.radius>.01&&section.radius<1);
 const scaled=circumferenceRadius(66)/section.radius;assert.ok(Number.isFinite(scaled)&&scaled>0);
});
