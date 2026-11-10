import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneTreeLayout,sceneZoneBox,treeScale,SCENE_PLANTED_MU,TREE_MODEL_DIMENSIONS} from '../src/sceneTreeLayout.ts';
import {spatialTrees,zoneCenters} from '../src/workspace/restructure/orchardSpatial.ts';
import {trialBusinessLayout} from '../src/debug/trialBusinessLayout.ts';
import {bubbleSize,domesticProduction,producerMarkers,provinceAreas,wanTonnes,worldShare,CHINA_M49} from '../src/workspace/spatial/worldMapModel.ts';
import {RUBBER_PRODUCERS,RUBBER_PRODUCTION_SOURCE,productionTier} from '../../shared/rubberProducers.ts';
import {PROVINCE_OUTLINES} from '../../shared/chinaRubberProvinces.ts';
import {demoTreePosition,demoZoneBoundary,PLANT_SPACING_M,ROW_SPACING_M} from '../../shared/demoSpatial.ts';

// The previous seeded draw, kept here only to prove families, sizes and yaw did not move.
function previousDraws(){
  let state=20260918;const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  return Array.from({length:200},()=>{random();random();const pick=random();return {archetype:pick<.3?'A':pick<.8?'B':'C',scale:.9+random()*.16,rotation:random()*Math.PI*2};});
}

test('scene trees stand 3 m apart in the row and 7 m between rows, keeping each tree\'s family and yaw',()=>{
  const trees=sceneTreeLayout();
  assert.equal(trees.length,200);
  previousDraws().forEach((draw,index)=>{
    assert.equal(trees[index].archetype,draw.archetype);assert.equal(trees[index].scale,draw.scale);assert.equal(trees[index].rotation,draw.rotation);
  });
  const gaps=[],rows=[];
  for(const tree of trees){
    const next=trees[tree.index+1];
    if(next&&next.zone===tree.zone&&Math.floor((next.index%50)/10)===Math.floor((tree.index%50)/10))gaps.push(next.x-tree.x);
    const below=trees[tree.index+10];
    if(below&&below.zone===tree.zone)rows.push(below.z-tree.z);
  }
  const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
  assert.ok(Math.abs(mean(gaps)-3)<0.05&&Math.min(...gaps)>2.3&&Math.max(...gaps)<3.7,'about 3 m within a row');
  assert.ok(Math.abs(mean(rows)-7)<0.25&&Math.min(...rows)>5.5,'about 7 m between rows');
  assert.equal(SCENE_PLANTED_MU.toFixed(1),'6.3');
  // The 2D orchard layers and the diagnostic snapshot draw the very same trees.
  assert.deepEqual(spatialTrees.map(({x,z,archetype})=>[x,z,archetype]),trees.map(({x,z,archetype})=>[x,z,archetype]));
  assert.deepEqual(trialBusinessLayout().map(({x,z,family})=>[x,z,family]),trees.map(({x,z,archetype})=>[x,z,archetype]));
  for(const zone of [0,1,2,3]){
    const box=sceneZoneBox(trees,zone);
    assert.ok(trees.filter(tree=>tree.zone===zone).every(tree=>Math.abs(tree.x-box.x)<box.w/2&&Math.abs(tree.z-box.z)<box.d/2));
    assert.ok(Math.hypot(box.x-zoneCenters[zone].x,box.z-zoneCenters[zone].z)<3);
  }
});

test('each tree takes its recorded height and breast-height girth; missing records keep the seeded size',()=>{
  const b=TREE_MODEL_DIMENSIONS.B;
  assert.deepEqual(treeScale({heightM:b.heightM,circumferenceCm:b.girthCm},'B',0.95),{x:1,y:1});
  const small=treeScale({heightM:9.6,circumferenceCm:53.6},'B',1);
  assert.equal(small.y.toFixed(3),(9.6/b.heightM).toFixed(3));assert.equal(small.x.toFixed(3),(53.6/b.girthCm).toFixed(3));
  assert.deepEqual(treeScale(undefined,'A',0.97),{x:0.97,y:0.97});
  assert.deepEqual(treeScale({heightM:null,circumferenceCm:null},'C',0.93),{x:0.93,y:0.93});
  // An implausible pair is bounded instead of producing a pole or a bush.
  const bounded=treeScale({heightM:13.6,circumferenceCm:5},'B',1);
  assert.ok(bounded.x>=bounded.y*0.75-1e-9);
});

test('world producers come from one FAOSTAT year; bubbles grow with output and China leads into the provinces',()=>{
  assert.equal(RUBBER_PRODUCTION_SOURCE.year,2024);assert.equal(RUBBER_PRODUCERS.length,25);
  assert.ok(RUBBER_PRODUCERS.every((item,index)=>index===0||RUBBER_PRODUCERS[index-1].tonnes>=item.tonnes));
  assert.ok(RUBBER_PRODUCERS.every(item=>item.tonnes>=10000));
  const total=RUBBER_PRODUCERS.reduce((sum,item)=>sum+item.tonnes,0);
  assert.ok(worldShare(total)>0.99&&worldShare(total)<=1);
  assert.equal(RUBBER_PRODUCERS[0].name,'泰国');assert.equal(wanTonnes(RUBBER_PRODUCERS[0].tonnes),'478.9');
  assert.equal(wanTonnes(15246),'1.52');
  assert.deepEqual(RUBBER_PRODUCERS.filter(item=>productionTier(item.tonnes)==='major').map(item=>item.name),['泰国','印度尼西亚','科特迪瓦','越南']);
  const markers=producerMarkers('360');
  assert.ok(markers.every((marker,index)=>index===0||markers[index-1].size>=marker.size));
  assert.equal(markers[0].size,bubbleSize(RUBBER_PRODUCERS[0].tonnes));assert.equal(markers[0].size,56);
  assert.equal(markers.find(marker=>marker.id==='producer:360').selected,true);
  assert.match(markers.find(marker=>marker.id===`producer:${CHINA_M49}`).detail,/云南、海南、广东/);
});

test('China shows official totals and only derives Yunnan plus Guangdong for the same year',()=>{
  const source=(id,name,value,period)=>({id,status:'available',url:`https://example.invalid/${id}`,data:{publisher:'测试',metrics:[{name,value,unit:'万吨',scope:'',period}]}});
  const same=domesticProduction([source('production_national','天然橡胶产量',97.3,'2025'),source('production_hainan','橡胶产量',34.95,'2025')]);
  assert.equal(same.national.value,97.3);assert.equal(same.hainan.value,34.95);assert.equal(same.rest,62.35);
  assert.equal(domesticProduction([source('production_national','天然橡胶产量',97.3,'2025'),source('production_hainan','橡胶产量',36.88,'2024')]).rest,null);
  assert.deepEqual(domesticProduction(undefined),{national:null,hainan:null,rest:null});
  const areas=provinceAreas(null,same,()=>3);
  assert.deepEqual(areas.map(area=>area.label),['云南 · 3 个园区','海南 · 34.95 万吨','广东 · 3 个园区']);
  for(const [region,points] of Object.entries(PROVINCE_OUTLINES)){
    assert.ok(points.length>=40,region);
    assert.ok(points.every(([longitude,latitude])=>longitude>97&&longitude<118&&latitude>18&&latitude<30),region);
  }
});

test('2D demo plots use the same 3 m × 7 m spacing, about 32 trees per mu',()=>{
  assert.equal(PLANT_SPACING_M,3);assert.equal(ROW_SPACING_M,7);
  const metres=(a,b)=>[(b.longitude-a.longitude)*Math.PI/180*6371000*Math.cos(a.latitude*Math.PI/180),(b.latitude-a.latitude)*Math.PI/180*6371000];
  const first=demoTreePosition('hainan',0),next=demoTreePosition('hainan',1),row=demoTreePosition('hainan',10);
  assert.ok(Math.abs(metres(first,next)[0]-3)<0.5);assert.ok(Math.abs(Math.abs(metres(first,row)[1])-7)<0.5);
  const box=demoZoneBoundary('hainan','A'),[w,h]=metres(box[0],box[2]);
  const perMu=50/(Math.abs(w*h)/666.67);
  assert.ok(perMu>30&&perMu<34,`${perMu.toFixed(1)} trees per mu`);
});
