import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {EnvironmentLayout} from './environmentLayout';
import {sceneTreeLayout,SCENE_ZONE_CENTERS} from './sceneTreeLayout.ts';

export type EnvironmentAssetKind = 'tall-tree' | 'evergreen-broadleaf' | 'shrub';
export type EnvironmentSite = 'hainan' | 'xsbn' | 'xian';
export type EnvironmentAssetLOD = 'near' | 'mid' | 'far' | 'distant';
export const ENVIRONMENT_SITE_CONFIG = {
  hainan: {id:'hainan',title:'海南主生产园区',camera:{position:[6,72,142],target:[2,1.5,-8]},density:1,production:'production'},
  xsbn: {id:'xsbn',title:'西双版纳环境资产候选',camera:{position:[12,68,148],target:[0,2,-14]},density:.86,production:'simulation'},
  xian: {id:'xian',title:'西安联调站档案',camera:{position:[18,58,132],target:[4,2,-10]},density:.34,production:'integration'},
} satisfies Record<EnvironmentSite,{id:string;title:string;camera:{position:[number,number,number];target:[number,number,number]};density:number;production:string}>;

/** Only locally verified families; Jacaranda is never a business rubber tree. */
export const ENVIRONMENT_ASSET_REGISTRY: Record<EnvironmentSite, {kind:EnvironmentAssetKind;cap:number;assetSite?:EnvironmentSite;source:string}[]> = {
  hainan:[{kind:'tall-tree',cap:220,assetSite:'xsbn',source:'Inherited companion tree, not production rubber'}, {kind:'shrub',cap:420,assetSite:'xsbn',source:'Inherited weed_plant_02 / CC0'}, {kind:'evergreen-broadleaf',cap:140,source:'Poly Haven tree_small_02 / CC0; 2026-10-07 verified local branch'}],
  xsbn:[{kind:'tall-tree',cap:24,source:'Poly Haven jacaranda_tree / CC0; companion tree only'},
    {kind:'shrub',cap:60,source:'Poly Haven weed_plant_02 / CC0'}],
  xian:[],
};
export type EnvironmentRegistryStats = {
  site:EnvironmentSite;attempted:number;loaded:number;instances:number;fallback:boolean;
  kinds:EnvironmentAssetKind[];errors:string[];status:'disabled'|'loading'|'ready'|'partial'|'failed'|'candidate-unavailable';
};
function disposeSources(objects:THREE.Object3D[]) {
  const geometries=new Set<THREE.BufferGeometry>(), materials=new Set<THREE.Material>(), textures=new Set<THREE.Texture>();
  objects.forEach(root=>root.traverse(node=>{if(node instanceof THREE.Mesh){geometries.add(node.geometry);(Array.isArray(node.material)?node.material:[node.material]).forEach(mat=>{materials.add(mat);Object.values(mat).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});});}}));
  geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());
}
export async function mountEnvironmentAssetRegistry(options:{scene:THREE.Scene;loader:GLTFLoader;layout?:EnvironmentLayout;heightAt:(x:number,z:number)=>number;site?:EnvironmentSite;enabled?:boolean;isDisposed?:()=>boolean;onReady?:()=>void}):Promise<EnvironmentRegistryStats> {
  const site=options.site??'hainan';
  const stats:EnvironmentRegistryStats={site,attempted:0,loaded:0,instances:0,fallback:true,kinds:[],errors:[],status:'disabled'};
  const report=()=>{if(!options.isDisposed?.())document.documentElement.dataset.environmentAssets=JSON.stringify(stats);};
  if(!options.enabled||!options.layout){report();return stats;}
  const specs=ENVIRONMENT_ASSET_REGISTRY[site];
  if(!specs.length){stats.status='candidate-unavailable';report();return stats;}
  stats.status='loading';report();
  const root=new THREE.Group();root.name='Environment_AssetRegistry_'+site;
  const sources:THREE.Object3D[]=[];
  for(const spec of specs){
    const loaded:Partial<Record<EnvironmentAssetLOD,THREE.Object3D>>={};
    for(const lod of ['distant','far'] as const){
      if(options.isDisposed?.()){disposeSources(sources);return stats;}
      stats.attempted++;
      try{const gltf=await options.loader.loadAsync('/assets/environment/'+(spec.assetSite??site)+'/'+spec.kind+'/'+lod+'.glb');loaded[lod]=gltf.scene;sources.push(gltf.scene);stats.loaded++;}
      catch{stats.errors.push(spec.kind+'/'+lod);}
    }
    if(options.isDisposed?.()){disposeSources(sources);return stats;}
    const fallback=loaded.far??loaded.distant??loaded.mid??loaded.near;if(!fallback)continue;
    stats.kinds.push(spec.kind);
    // Inter-row plants sit on the uphill side, away from the rail (+1.25m)
    // and working strip (+2m). They are not selectable business trees.
    const understory=sceneTreeLayout().filter((_,i)=>i%2===0).map(p=>({x:p.x+.7,z:p.z-2.4,vigor:.25}));
    // Peripheral shrubs already exist as permanent authored geometry.
    const points=(spec.kind==='shrub'?understory:spec.kind==='tall-tree'?options.layout.rubber.slice(0,220):[...options.layout.smallTrees,...options.layout.rubber.slice(220,280)])
      .slice(0,spec.cap);
    // Alpha-tested foliage avoids transparent leaf layers sorting through one another.
    for(const source of Object.values(loaded))source.traverse(node=>{
      if(node instanceof THREE.Mesh)for(const material of (Array.isArray(node.material)?node.material:[node.material])){
        if(material.transparent){material.transparent=false;material.alphaTest=.12;material.side=THREE.DoubleSide;material.depthWrite=true;material.needsUpdate=true;}
      }
    });
    const safePoints=points.filter(p=>spec.kind!=='shrub'||!SCENE_ZONE_CENTERS.some(c=>Math.abs(p.x-c.x)<18&&Array.from({length:5},(_,i)=>c.z+(i-2)*7+Math.sin(((p.x-c.x)/3+4.5)*.6)*.8+1.5).some(z=>Math.abs(p.z-z)<1.8)));
    const bounds=new THREE.Box3().setFromObject(fallback),size=bounds.getSize(new THREE.Vector3());
    const transforms=safePoints.map((p,index)=>{
      const height=spec.kind==='shrub'?.38+p.vigor*.26:spec.kind==='tall-tree'?13+p.vigor*4:8+p.vigor*3;
      const scale=Math.min(height/Math.max(.01,size.y),spec.kind==='shrub'?1.05/Math.max(size.x,size.z):Infinity);
      const t=new THREE.Object3D();t.position.set(p.x,options.heightAt(p.x,p.z),p.z);
      if(spec.kind==='shrub'){
        const n=new THREE.Vector3(options.heightAt(p.x-.2,p.z)-options.heightAt(p.x+.2,p.z),.4,options.heightAt(p.x,p.z-.2)-options.heightAt(p.x,p.z+.2)).normalize();
        t.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),n);
        t.rotateY(index*2.39996);t.position.y-=.035;
      }else t.rotation.y=index*2.39996;
      t.scale.setScalar(scale);t.translateY(-bounds.min.y*scale);
      if(spec.kind==='shrub'){t.translateX(-(bounds.min.x+bounds.max.x)*.5*scale);t.translateZ(-(bounds.min.z+bounds.max.z)*.5*scale);}
      t.updateMatrix();return t.matrix.clone();
    });
    const batches:{mesh:THREE.InstancedMesh;local:THREE.Matrix4;near:boolean}[]=[];
    for(const near of [false,true]){
      const source=near?(loaded.far??fallback):(loaded.distant??fallback);source.updateMatrixWorld(true);
      source.traverse(node=>{if(node instanceof THREE.Mesh){
        const mesh=new THREE.InstancedMesh(node.geometry,node.material,safePoints.length);
        mesh.name='Batched_'+spec.kind+(near?'_near':'_distant');mesh.count=0;mesh.frustumCulled=false;
        mesh.castShadow=near&&spec.kind!=='shrub';mesh.receiveShadow=true;root.add(mesh);
        batches.push({mesh,local:node.matrixWorld.clone(),near});
      }});
    }
    let last=new THREE.Vector3(Infinity,Infinity,Infinity);
    const orientation=new THREE.Quaternion(),frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),sphere=new THREE.Sphere();
    const update=(camera:THREE.Camera)=>{
      if(last.distanceToSquared(camera.position)<1&&orientation.angleTo(camera.quaternion)<.015)return;
      last.copy(camera.position);orientation.copy(camera.quaternion);
      camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
      const counts=new Map(batches.map(b=>[b,0]));const matrix=new THREE.Matrix4();
      safePoints.forEach((p,i)=>{
        sphere.center.set(p.x,transforms[i].elements[13]+(spec.kind==='shrub'?.5:8),p.z);sphere.radius=spec.kind==='shrub'?2:18;
        if(!frustum.intersectsSphere(sphere))return;
        const d=camera.position.distanceTo(sphere.center);
        if(spec.kind==='shrub'&&d>150)return;
        const near=d<(spec.kind==='shrub'?12:35);
        for(const batch of batches)if(batch.near===near){const index=counts.get(batch)!;matrix.multiplyMatrices(transforms[i],batch.local);batch.mesh.setMatrixAt(index,matrix);counts.set(batch,index+1);}
      });
      for(const batch of batches){batch.mesh.count=counts.get(batch)!;batch.mesh.instanceMatrix.needsUpdate=true;}
    };
    const controller=new THREE.Group();controller.userData.updateVegetation=update;root.add(controller);
    stats.instances+=safePoints.length;

  }
  if(options.isDisposed?.()){disposeSources(sources);return stats;}
  stats.fallback=stats.loaded!==specs.length*2;
  if(stats.instances){
    options.scene.add(root);
    if(!stats.fallback){
      // Missing files must leave the authored tree fallback visible. Shrubs are
      // permanent ground vegetation and remain after a complete replacement.
      options.scene.getObjectByName('Hainan_Natural_Vegetation')?.children.forEach(child=>{
        child.visible=child.name==='Forest_Edge_Crosscard_Shrubs';
      });
      options.onReady?.();
    }
  }
  stats.status=stats.loaded===0?'failed':stats.fallback?'partial':'ready';report();return stats;
}

