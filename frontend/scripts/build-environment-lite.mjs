import fs from 'node:fs/promises';
import {MeshoptSimplifier,MeshoptDecoder} from 'meshoptimizer';
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
for(const family of ['xsbn/tall-tree','xsbn/shrub','hainan/evergreen-broadleaf']){
 const path=new URL('../public/assets/environment/'+family+'/',import.meta.url);
 const data=await fs.readFile(new URL('far.glb',path));
 const len=data.readUInt32LE(12),j=JSON.parse(data.subarray(20,20+len));
 const bin=data.subarray(28+len);const chunks=[];let offset=0;
 const oldViews=j.bufferViews,oldAccessors=j.accessors;
 const viewBytes=oldViews.map(v=>{const e=v.extensions?.EXT_meshopt_compression;if(!e)return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);const out=new Uint8Array(e.count*e.byteStride);MeshoptDecoder.decodeGltfBuffer(out,e.count,e.byteStride,bin.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);return Buffer.from(out);});
 j.extensionsUsed=j.extensionsUsed?.filter(x=>x!=='EXT_meshopt_compression');j.extensionsRequired=j.extensionsRequired?.filter(x=>x!=='EXT_meshopt_compression');
 j.bufferViews=[];j.accessors=[];
 const append=(bytes)=>{const id=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});chunks.push(bytes);const padding=Buffer.alloc((4-bytes.length%4)%4);chunks.push(padding);offset+=bytes.length+padding.length;return id;};
 const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
 const read=(id)=>{const a=oldAccessors[id],v=oldViews[a.bufferView],size=sizes[a.componentType]*widths[a.type],out=Buffer.alloc(a.count*size);for(let i=0;i<a.count;i++)viewBytes[a.bufferView].copy(out,i*size,(a.byteOffset??0)+i*(v.byteStride??size),(a.byteOffset??0)+i*(v.byteStride??size)+size);return {a,bytes:out,size};};
 let before=0,after=0;
 for(const mesh of j.meshes)for(const p of mesh.primitives){
  const pos=read(p.attributes.POSITION),ind=read(p.indices);
  const indices=Uint32Array.from({length:ind.a.count},(_,i)=>ind.a.componentType===5125?ind.bytes.readUInt32LE(i*4):ind.bytes.readUInt16LE(i*2));
  const vertices=Float32Array.from({length:pos.a.count*3},(_,i)=>pos.a.componentType===5126?pos.bytes.readFloatLE(i*4):pos.bytes.readInt16LE(i*2)/32767);
  const ratio=family==='hainan/evergreen-broadleaf'?.055:.12;
  const error=.035;
  const target=Math.max(36,Math.floor(indices.length*ratio/3)*3);
  const [result]=family==='hainan/evergreen-broadleaf'
   ? MeshoptSimplifier.simplifySloppy(indices,vertices,3,null,target,.03)
   : MeshoptSimplifier.simplify(indices,vertices,3,target,error,['Permissive']);
  before+=indices.length/3;after+=result.length/3;
  const unique=[...new Set(result)],remap=new Map(unique.map((v,i)=>[v,i]));
  for(const [name,id] of Object.entries(p.attributes)){
   const {a,bytes,size}=read(id),out=Buffer.alloc(unique.length*size);unique.forEach((old,i)=>bytes.copy(out,i*size,old*size,(old+1)*size));
   const next={...a,bufferView:append(out),byteOffset:0,count:unique.length};delete next.min;delete next.max;
   if(name==='POSITION'){next.min=[Infinity,Infinity,Infinity];next.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<unique.length;i++)for(let c=0;c<3;c++){const v=a.componentType===5126?out.readFloatLE(i*12+c*4):out.readInt16LE(i*6+c*2);next.min[c]=Math.min(next.min[c],v);next.max[c]=Math.max(next.max[c],v);}}
   p.attributes[name]=j.accessors.length;j.accessors.push(next);
  }
  const out=Buffer.alloc(result.length*4);result.forEach((v,i)=>out.writeUInt32LE(remap.get(v),i*4));p.indices=j.accessors.length;j.accessors.push({bufferView:append(out),componentType:5125,count:result.length,type:'SCALAR'});
 }
 for(const img of j.images??[])if(img.bufferView!==undefined)img.bufferView=append(viewBytes[img.bufferView]);
 j.buffers=[{byteLength:offset}];const json=Buffer.from(JSON.stringify(j));const jp=Buffer.alloc((4-json.length%4)%4,32);const jb=Buffer.concat([json,jp]);const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jb.length+offset,8);header.writeUInt32LE(jb.length,12);header.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(offset);bh.writeUInt32LE(0x004e4942,4);
 await fs.writeFile(new URL('distant.glb',path),Buffer.concat([header,jb,bh,...chunks]));console.log(family,{before,after,bytes:offset});
}
