import * as THREE from 'three';
import { SCENE_ZONE_CENTERS } from './sceneTreeLayout.ts';

/** Narrow compacted working strips beside the tree rows. Visual only. */
export function createTerraceWorkPaths(heightAt:(x:number,z:number)=>number){
  const group=new THREE.Group();group.name='Terrace_Working_Strips';
  const material=new THREE.MeshStandardMaterial({color:'#827360',roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  for(const center of SCENE_ZONE_CENTERS)for(let row=-2;row<=2;row++){
    const vertices:number[]=[],indices:number[]=[];
    for(let i=0;i<=128;i++){
      const local=-16+i*.25,x=center.x+local;
      const z=center.z+row*7+Math.sin((local/3+4.5)*.6)*.8+2;
      for(const side of [-.55,.55])vertices.push(x,heightAt(x,z+side)+.025,z+side);
      if(i<128){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;group.add(mesh);
  }
  return group;
}
