/** Geometry reports authorize a visual rehearsal only, never a machine command. */
export type RailTreeSource={index:number;family:string;scale:number;yawRadians:number;worldGltf:number[]};
export type RuntimeRailTree={x:number;z:number;scale:number;rotation:number;archetype:string};
export function matchesRailTree(source:RailTreeSource,trees:RuntimeRailTree[],height:(x:number,z:number)=>number){
  const tree=trees[source.index];
  if(!tree||tree.archetype!==source.family||source.worldGltf?.length!==3)return false;
  const actual=[tree.x,height(tree.x,tree.z),tree.z,tree.scale,tree.rotation];
  const expected=[...source.worldGltf,source.scale,source.yawRadians];
  return expected.every((v,i)=>Number.isFinite(v)&&Math.abs(actual[i]-v)<1e-6);
}
