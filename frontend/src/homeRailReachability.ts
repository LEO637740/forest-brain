import * as THREE from 'three';

/** Point reach only. Never clamps axes or authorizes motion/cutting. */
export function inspectHomeRailTarget(tree:{x:number;z:number;rotation:number;scale:number},treeBaseY:number,rail:{x:number;y:number;z:number;rotation:number},anchor:readonly number[]){
  const treeMatrix=new THREE.Matrix4().compose(new THREE.Vector3(tree.x,treeBaseY,tree.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),tree.rotation),new THREE.Vector3().setScalar(tree.scale));
  const railMatrix=new THREE.Matrix4().compose(new THREE.Vector3(rail.x,rail.y,rail.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rail.rotation),new THREE.Vector3(1,1,1));
  const world=new THREE.Vector3(anchor[0],anchor[1],anchor[2]).applyMatrix4(treeMatrix);
  const surface=world.clone().applyMatrix4(railMatrix.clone().invert());
  const gap=.03;
  const required={travelM:surface.x+.22,extension:-surface.z-gap-.645,sliderOffset:surface.y-1.79,toolFeed:0};
  const ranges={travelM:[-3,3],extension:[0,.54],sliderOffset:[-.4,0],toolFeed:[0,0]} as const;
  const violations=(Object.keys(ranges) as (keyof typeof ranges)[]).flatMap(axis=>{
    const [min,max]=ranges[axis],value=required[axis];
    return value<min-1e-8||value>max+1e-8?[{axis,value,min,max,excessM:Math.max(min-value,value-max)}]:[];
  });
  const r4TCP=new THREE.Vector3(-.1353575959,1.3937904328,-1.1746136964);
  const target=surface.clone().add(new THREE.Vector3(0,0,gap));
  return {world:world.toArray(),railLocalSurface:surface.toArray(),treeBaseY,required,violations,
    axisRangesPassed:violations.length===0,r4TargetErrorM:r4TCP.distanceTo(target),
    executionApproved:false,scope:'Existing Mature B surface sample transformed to actual tree/rail coordinates; not a new mesh collision or path validation.'};
}
