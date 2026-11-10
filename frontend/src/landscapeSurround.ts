import * as THREE from 'three';
export function surroundHeight(x:number,z:number,field:(x:number,z:number)=>{height:number}){
 const bx=Math.max(-230,Math.min(230,x)),bz=Math.max(-210,Math.min(210,z));
 const distance=Math.hypot(x-bx,z-bz);if(!distance)return field(x,z).height;
 const blend=THREE.MathUtils.smoothstep(distance,0,240);
 const far=12+Math.sin(x*.009+z*.003)*9+Math.cos(z*.012-x*.004)*7;
 // Continue the same height field. Extruding the boundary's micro-normal
 // amplifies centimetre-scale soil noise into long artificial ridges.
 return THREE.MathUtils.lerp(field(x,z).height,far,blend);
}

/** Extend the visual landscape beyond the operational plot; no business objects. */
export function landscapeSurround(_heightAt:(x:number,z:number)=>number, material:THREE.Material, field:(x:number,z:number)=>{height:number;litter:number;roadMask:number;wet:number;contact:number}){
 // Two-metre sampling around the join preserves the foreground's small relief
 // and surface masks; coarse vertices are reserved for the distant horizon.
 const axis:number[]=[];
 for(let v=-900;v< -330;v+=30)axis.push(v);
 for(let v=-330;v<=330;v+=2)axis.push(v);
 for(let v=360;v<=900;v+=30)axis.push(v);
 const geometry=new THREE.PlaneGeometry(1800,1800,axis.length-1,axis.length-1);geometry.rotateX(-Math.PI/2);
 const vertices=geometry.attributes.position;
 for(let row=0;row<axis.length;row++)for(let col=0;col<axis.length;col++)vertices.setXYZ(row*axis.length+col,axis[col],0,axis[row]);
 const p=geometry.attributes.position;const layers:number[]=[];
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i),bx=Math.max(-230,Math.min(230,x)),bz=Math.max(-210,Math.min(210,z));
  const distance=Math.hypot(x-bx,z-bz),blend=THREE.MathUtils.smoothstep(distance,0,240);
  const far=12+Math.sin(x*.009+z*.003)*9+Math.cos(z*.012-x*.004)*7;
  p.setY(i,surroundHeight(x,z,field));
  geometry.attributes.uv.setXY(i,x/2.2,z/2.2);
  const f=field(x,z);layers.push(f.litter,f.roadMask,f.wet,f.contact);
 }
 const old=geometry.index!,indices:number[]=[];
 for(let i=0;i<old.count;i+=3){const a=old.getX(i),b=old.getX(i+1),c=old.getX(i+2);const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
  if(Math.abs(x)<230&&Math.abs(z)<210)continue;indices.push(a,b,c);
 }
 geometry.setIndex(indices);geometry.computeVertexNormals();
 const normals=geometry.attributes.normal;
 for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);
  if(Math.abs(x)<230&&Math.abs(z)<210)continue;
  const n=new THREE.Vector3(surroundHeight(x-.5,z,field)-surroundHeight(x+.5,z,field),1,surroundHeight(x,z-.5,field)-surroundHeight(x,z+.5,field)).normalize();normals.setXYZ(i,n.x,n.y,n.z);
 }
 // World-space sampling uses the exact same textures, scale and shader as the foreground.
 geometry.setAttribute('gsSurface',new THREE.Float32BufferAttribute(layers,4));
 geometry.setAttribute('gsCover',new THREE.Float32BufferAttribute(new Float32Array(p.count),1));
 const mesh=new THREE.Mesh(geometry,material);mesh.name='Distant_Landscape';mesh.receiveShadow=true;return mesh;
}
