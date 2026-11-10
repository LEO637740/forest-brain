import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSpatialTrees,spatialZones,spatialSitePosition} from '../src/workspace/spatial/spatialCatalog.ts';

const tree=treeId=>({treeId});
const record=(treeId,values={})=>({treeId,recordId:`record-${treeId}`,siteId:'demo-hainan',sourceName:'定位测试资料',observedAt:'2026-10-19T00:00:00Z',importedAt:'2026-10-19T01:00:00Z',variety:null,circumferenceCm:null,heightM:null,measurementHeightM:null,coordinateSystem:'WGS84',provenanceMode:'measured',elevationDatum:null,...values});
const task=(site,block,robot,status='待开始')=>({site,block,robot,status});

test('tree drill-down retains unlocated trees and derives zones from the business tree IDs',()=>{
  const measured=record('T-0001',{longitude:110.3,latitude:19.8,sourceTreeId:'现场-001'});
  const entries=buildSpatialTrees([tree('T-0051'),tree('T-0001'),tree('T-0050')],[measured,record('T-0101',{longitude:110.31,latitude:19.81,provenanceMode:'simulated'})]);
  assert.deepEqual(entries.map(entry=>[entry.treeId,entry.index,entry.zone]),[['T-0001',0,'A'],['T-0050',49,'A'],['T-0051',50,'B'],['T-0101',100,'C']]);
  assert.deepEqual(entries[0].position,{longitude:110.3,latitude:19.8});
  assert.equal(entries[0].record,measured);
  assert.equal(entries[1].position,null);
  assert.equal(entries[2].position,null);
  assert.equal(entries[3].record.provenanceMode,'simulated');
  assert.equal(entries[3].tree,undefined);
});

test('a refreshed field catalog overrides an older park record without deriving coordinates from dimensions',()=>{
  const previous=record('T-0001',{longitude:110.3,latitude:19.8});
  const current=record('T-0001',{circumferenceCm:65,heightM:14});
  assert.deepEqual(buildSpatialTrees([{treeId:'T-0001',fieldRecord:previous}],[])[0].position,{longitude:110.3,latitude:19.8});
  const entry=buildSpatialTrees([{treeId:'T-0001',fieldRecord:previous}],[current])[0];
  assert.equal(entry.record,current);
  assert.equal(entry.position,null);
});

test('zone coverage counts measured positions separately from simulated and missing positions',()=>{
  const entries=buildSpatialTrees(['T-0001','T-0002','T-0003','T-0051'].map(tree),[
    record('T-0001',{longitude:110.3,latitude:19.8}),
    record('T-0002',{longitude:110.32,latitude:19.82,provenanceMode:'simulated'}),
    record('T-0003',{heightM:12}),
  ]);
  const zones=spatialZones(entries,[],'hainan');
  assert.deepEqual(zones.map(zone=>[zone.id,zone.treeCount,zone.locatedCount,zone.measuredCount]),[['A',3,2,1],['B',1,0,0],['C',0,0,0],['D',0,0,0]]);
  assert.equal(zones[0].robotLabel,'R-A（模拟）');
  assert.ok(Math.abs(zones[0].position.longitude-110.31)<1e-9);
  assert.ok(Math.abs(zones[0].position.latitude-19.81)<1e-9);
  assert.equal(zones[1].position,null);
});

test('other sites show only devices or people assigned to the selected zone in ongoing tasks',()=>{
  const tasks=[task('xsbn','A','巡检员 周'),task('xsbn','A','Robot 03'),task('xsbn','A','Robot 03'),task('hainan','A','海南设备'),task('xsbn','B','B区设备'),task('xsbn','A','旧设备','已完成'),task('xsbn','A','已取消设备','已取消')];
  const zones=spatialZones([],tasks,'xsbn');
  assert.equal(zones[0].robotLabel,'巡检员 周、Robot 03');
  assert.equal(zones[1].robotLabel,'B区设备');
  assert.equal(zones[2].robotLabel,'暂无设备安排');
});

test('site focus uses supplied coordinate pairs and remains absent without positions',()=>{
  assert.equal(spatialSitePosition([]),null);
  assert.equal(spatialSitePosition([record('T-0001',{heightM:18}),record('T-0002',{longitude:110.3})]),null);
  const position=spatialSitePosition([record('T-0001',{longitude:110.3,latitude:19.8}),record('T-0002',{longitude:110.32,latitude:19.82,provenanceMode:'simulated'}),record('T-0003')]);
  assert.ok(Math.abs(position.longitude-110.31)<1e-9);
  assert.ok(Math.abs(position.latitude-19.81)<1e-9);
  assert.deepEqual(Object.keys(position).sort(),['latitude','longitude']);
});
