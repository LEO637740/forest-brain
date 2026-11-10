import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=(family,file)=>{const b=readFileSync(new URL('../public/assets/environment/'+family+'/'+file,import.meta.url));const length=b.readUInt32LE(12);return {j:JSON.parse(b.subarray(20,20+length)),bin:b.subarray(28+length)};};
for(const family of ['xsbn/tall-tree','xsbn/shrub','hainan/evergreen-broadleaf'])test(family+' distant LOD reduces triangles and preserves valid textured primitives',()=>{
 const source=load(family,'far.glb'),lite=load(family,'distant.glb');
 const count=j=>j.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+j.accessors[p.indices].count/3,0);
 assert.ok(count(lite.j)<count(source.j)*.45);
 assert.equal(lite.j.materials.length,source.j.materials.length);
 for(const mesh of lite.j.meshes)for(const p of mesh.primitives){
  assert.ok(p.attributes.TEXCOORD_0!==undefined);
  const a=lite.j.accessors[p.indices],v=lite.j.bufferViews[a.bufferView];
  const positions=lite.j.accessors[p.attributes.POSITION];
  for(let i=0;i<a.count;i++)assert.ok(lite.bin.readUInt32LE(v.byteOffset+i*4)<positions.count);
 }
});
