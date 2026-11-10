import * as THREE from 'three/webgpu';
import { chooseTreeLOD, DEFAULT_TREE_LOD_POLICY, type TreeLODLevel } from '../treeVisuals';

type Tree = {x:number;z:number;family:string;y?:number;scale?:number;rotation?:number};
export function trialAutoLOD(batches:THREE.InstancedMesh[],trees:Tree[],height:(x:number,z:number)=>number,camera:THREE.Camera,sun:THREE.DirectionalLight){
  let active:Tree[]=[], previous:(TreeLODLevel|undefined)[]=[], signature='', started=0;
  const events:{ms:number;index:number;from:number;to:number;distance:number}[]=[];
  let distribution=[0,0,0,0], revisions=0;
  const point=new THREE.Vector3(), matrix=new THREE.Matrix4();
  const dummy=new THREE.Object3D();
  let probe:TreeLODLevel=2;
  const stabilityCheck=[159,161,159,171.9,172.1,160,148.1,147.9].map(distance=>({distance,lod:probe=chooseTreeLOD(distance,probe)}));
  return {
    start(single:boolean,layout?:Tree[]){active=single?[{x:0,z:0,family:'B'}]:(layout??trees);previous=[];signature='';events.length=0;started=performance.now();revisions=0;},
    stop(){active=[];},
    update(){
      if(!active.length)return false;
      const next=active.map((t,i)=>{
        const d=camera.position.distanceTo(point.set(t.x,(t.y??height(t.x,t.z))+6.8,t.z));
        const lod=chooseTreeLOD(d,previous[i]);
        if(previous[i]!==undefined&&previous[i]!==lod){events.push({ms:performance.now()-started,index:i,from:previous[i]!,to:lod,distance:d});if(events.length>500)events.shift();}
        return lod;
      });
      const key=next.join(',');previous=next;
      if(key===signature)return false;
      signature=key;distribution=[0,0,0,0];next.forEach(l=>distribution[l]++);
      for(const batch of batches){
        const group=active.filter((t,i)=>t.family===batch.userData.family&&next[i]===batch.userData.lod);
        batch.count=group.length;batch.visible=group.length>0;batch.userData.trees=group.map(t=>({...t,lod:batch.userData.lod}));
        group.forEach((t,i)=>{dummy.position.set(t.x,t.y??height(t.x,t.z),t.z);dummy.rotation.set(0,t.rotation??0,0);dummy.scale.setScalar(t.scale??1);dummy.updateMatrix();matrix.copy(dummy.matrix);batch.setMatrixAt(i,matrix);});
        batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();
      }
      sun.shadow.needsUpdate=true;revisions++;return true;
    },
    report(){return {enabled:active.length>0,count:active.length,policy:DEFAULT_TREE_LOD_POLICY,stabilityCheck,distribution:[...distribution],shadowRefreshes:revisions,events:[...events]};},
  };
}
