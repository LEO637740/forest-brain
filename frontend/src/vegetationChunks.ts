import * as THREE from 'three';

/** Static spatial batches retain every planting location but cull independently. */
export function chunkVegetation(group:THREE.Group,cellSize=64) {
  const chunks:{mesh:THREE.InstancedMesh;full:THREE.BufferGeometry;lite:THREE.BufferGeometry;center:THREE.Vector3;leaves:boolean}[]=[];
  for(const original of [...group.children]) {
    if(!(original instanceof THREE.InstancedMesh))continue;
    const cells=new Map<string,number[]>(),matrix=new THREE.Matrix4(),position=new THREE.Vector3();
    for(let i=0;i<original.count;i++) {
      original.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
      const key=`${Math.floor(position.x/cellSize)},${Math.floor(position.z/cellSize)}`;
      const ids=cells.get(key)??[];ids.push(i);cells.set(key,ids);
    }
    const full=original.geometry;
    const lite=original.name==='Sample_ShortGrass'?full.clone():full;
    if(lite!==full&&full.index)lite.setIndex(Array.from(full.index.array).slice(0,5*42));
    for(const [key,ids] of cells) {
      const mesh=new THREE.InstancedMesh(full,original.material,ids.length);
      mesh.name=original.name+'_'+key;mesh.receiveShadow=original.receiveShadow;mesh.castShadow=false;
      const color=new THREE.Color();
      ids.forEach((id,i)=>{original.getMatrixAt(id,matrix);mesh.setMatrixAt(i,matrix);
        if(original.instanceColor){original.getColorAt(id,color);mesh.setColorAt(i,color);}});
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.frustumCulled=true;
      mesh.userData={role:'visual-only',selectable:false};group.add(mesh);
      chunks.push({mesh,full,lite,center:mesh.boundingSphere!.center.clone(),leaves:original.name==='Canopy_Leaf_Litter'});
    }
    group.remove(original);original.dispose();
  }
  const last=new THREE.Vector3(Infinity,Infinity,Infinity);
  group.userData.updateVegetation=(camera:THREE.Camera)=>{
    if(last.distanceToSquared(camera.position)<4)return;last.copy(camera.position);
    for(const chunk of chunks){
      const distance=camera.position.distanceTo(chunk.center);
      // Leaf litter remains in the ground material beyond readable geometry range.
      chunk.mesh.visible=!chunk.leaves||distance<95;
      chunk.mesh.geometry=distance>85?chunk.lite:chunk.full;
    }
  };
  group.userData.disposeChunks=()=>new Set(chunks.flatMap(c=>[c.full,c.lite])).forEach(g=>g.dispose());
  return chunks.length;
}
