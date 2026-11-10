import test from 'node:test';
import assert from 'node:assert/strict';
import {terracedTerrainHeight as height} from '../src/terracedTerrain.ts';
import {sceneTreeLayout, SCENE_ZONE_CENTERS} from '../src/sceneTreeLayout.ts';
import {createTerraceWorkPaths} from '../src/terraceWorkPaths.ts';

test('all 200 production trees and adjacent rails share a working bench',()=>{
 const trees=sceneTreeLayout();assert.equal(trees.length,200);
 for(const t of trees){assert.ok(Number.isFinite(height(t.x,t.z)));assert.ok(Math.abs(height(t.x,t.z+1.25)-height(t.x,t.z))<.15);}
});
test('terrace transitions have no elevation jumps at row boundaries',()=>{
 for(const c of SCENE_ZONE_CENTERS)for(let x=c.x-18;x<=c.x+18;x+=2){
  let previous=height(x,c.z-22);
  for(let z=c.z-21.99;z<c.z+22;z+=.01){const next=height(x,z);assert.ok(Math.abs(next-previous)<.04,`${x},${z}`);previous=next;}
 }
});
test('five walk strips per zone remain grounded without changing business coordinates',()=>{
 const paths=createTerraceWorkPaths(height);assert.equal(paths.children.length,20);
 for(const mesh of paths.children){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-height(p.getX(i),p.getZ(i))-.025)<.0001);}
});
