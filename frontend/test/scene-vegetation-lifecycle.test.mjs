import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {chunkVegetation} from '../src/vegetationChunks.ts';
import {mountEnvironmentAssetRegistry} from '../src/environmentAssetRegistry.ts';

const source=readFileSync(new URL('../src/DigitalTwinScene.tsx',import.meta.url),'utf8');

test('the actual visible-frame camera update restores nearby litter and grass detail without a reset',()=>{
 // Execute the camera/vegetation statements from the production animation loop,
 // so a working helper that is disconnected from normal frames cannot pass.
 const frame=source.slice(source.indexOf('const animate = (now: number) => {'));
 const update=frame.match(/controls\.update\(\);[\s\S]*?(?=if\(batchRef\.current)/)?.[0];
 assert.ok(update,'the visible frame must update its camera before drawing selections');
 const step=new Function('controls','camera','sampleCover','scene',update);
 const group=new THREE.Group(),material=new THREE.MeshBasicMaterial();
 const leaves=new THREE.InstancedMesh(new THREE.CircleGeometry(.1),material,1);
 leaves.name='Canopy_Leaf_Litter';leaves.setMatrixAt(0,new THREE.Matrix4());group.add(leaves);
 const grass=new THREE.InstancedMesh(new THREE.SphereGeometry(1,16,12),material,1);
 grass.name='Sample_ShortGrass';grass.setMatrixAt(0,new THREE.Matrix4());group.add(grass);
 chunkVegetation(group);
 const litter=group.children.find(m=>m.name.startsWith('Canopy_Leaf_Litter'));
 const tuft=group.children.find(m=>m.name.startsWith('Sample_ShortGrass'));
 const fullGeometry=tuft.geometry;
 const camera=new THREE.PerspectiveCamera(),scene=new THREE.Scene(),registry=new THREE.Group(),controller=new THREE.Group();
 let registryFrames=0;
 registry.name='Environment_AssetRegistry_hainan';controller.userData.updateVegetation=()=>{registryFrames++;};registry.add(controller);scene.add(registry);
 const sampleCover={group};
 step({update:()=>camera.position.set(0,200,0)},camera,sampleCover,scene);
 assert.equal(litter.visible,false,'the far frame must use the ground texture for litter');
 assert.notEqual(tuft.geometry,fullGeometry,'the far frame must select reduced grass geometry');
 step({update:()=>camera.position.set(0,2,0)},camera,sampleCover,scene);
 assert.equal(litter.visible,true,'walking back to a tree must restore its litter');
 assert.equal(tuft.geometry,fullGeometry,'walking back must restore detailed grass');
 assert.equal(registryFrames,2,'external tree LOD must continue updating too');
 group.userData.disposeChunks();material.dispose();
});

function fixture(){
 const scene=new THREE.Scene(),fallback=new THREE.Group();fallback.name='Hainan_Natural_Vegetation';
 for(const name of ['Natural_Small_Tree_Trunks','Natural_Small_Tree_Crowns_A','Distant_Forest_Canopy_Proxies','Forest_Edge_Crosscard_Shrubs']){
  const child=new THREE.Object3D();child.name=name;fallback.add(child);
 }
 scene.add(fallback);
 const point=i=>({x:500+i%20*20,z:-100-Math.floor(i/20)*20,vigor:.5});
 const layout={rubber:Array.from({length:360},(_,i)=>point(i)),smallTrees:Array.from({length:80},(_,i)=>point(i)),shrubs:[]};
 return {scene,fallback,layout};
}
const asset=()=>{const scene=new THREE.Group();scene.add(new THREE.Mesh(new THREE.BoxGeometry(2,10,2),new THREE.MeshStandardMaterial()));return {scene};};
const withDocument=async fn=>{
 const previous=globalThis.document;globalThis.document={documentElement:{dataset:{}}};
 try{return await fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
};

test('scene startup and a pending registry load retain authored trees until replacements are ready',()=>withDocument(async()=>{
 const {scene,fallback,layout}=fixture();
 // Include the real startup statements between vegetation creation and asset
 // loading; this catches an early hide in DigitalTwinScene as well as the loader.
 const startup=source.match(/const naturalEnvironmentStats = addNaturalEnvironment\([\s\S]*?environmentLayout\);([\s\S]*?)const forestRoot/)?.[1];
 assert.ok(startup,'the scene must create authored vegetation before loading replacements');
 new Function('scene','naturalRelease','environmentSite',startup)(scene,true,'hainan');
 assert.ok(fallback.children.every(c=>c.visible),'startup cannot hide trees before a load succeeds');
 let release;
 const pending=new Promise(resolve=>{release=resolve;});let first=true;
 const loader={loadAsync:async()=>{if(first){first=false;await pending;}return asset();}};
 const mounted=mountEnvironmentAssetRegistry({scene,layout,loader,heightAt:()=>0,enabled:true});
 assert.ok(fallback.children.every(c=>c.visible),'slow loading must keep the original backdrop');
 release();const stats=await mounted;
 assert.equal(stats.status,'ready');
 assert.ok(fallback.children.filter(c=>c.name!=='Forest_Edge_Crosscard_Shrubs').every(c=>!c.visible));
 assert.equal(fallback.getObjectByName('Forest_Edge_Crosscard_Shrubs').visible,true,'authored shrubs are permanent');
}));

for(const scenario of [
 {name:'all files fail',fails:()=>true,status:'failed'},
 {name:'one complete family fails',fails:url=>url.includes('/tall-tree/'),status:'partial'},
 {name:'one LOD fails',fails:url=>url.endsWith('/tall-tree/distant.glb'),status:'partial'},
])test(`asset fallback survives when ${scenario.name}`,()=>withDocument(async()=>{
 const {scene,fallback,layout}=fixture();let ready=0;
 const loader={loadAsync:async url=>{if(scenario.fails(url))throw Error('fixture asset unavailable');return asset();}};
 const stats=await mountEnvironmentAssetRegistry({scene,layout,loader,heightAt:()=>0,enabled:true,onReady:()=>{ready++;}});
 assert.equal(stats.status,scenario.status);assert.equal(stats.fallback,true);
 assert.ok(fallback.children.every(c=>c.visible),'incomplete replacements must keep the fallback');
 assert.equal(ready,0,'incomplete replacement cannot report ready');
 assert.ok(stats.errors.length>0);
}));
