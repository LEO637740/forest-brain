import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {FieldTreeRecords} from '../src/field-trees.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {makeDemoSpatialImport,seedDemoSpatialRecords} from '../src/adapters/demo-spatial.js';
import {demoZoneBoundary,DEMO_SPATIAL_SITES} from '../../shared/demoSpatial.ts';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {parks,productionRegions,productionSites} from '../../shared/parkCatalog.ts';

const now=new Date('2026-10-19T02:00:00.000Z');
const manualImport=(patch={})=>({
  ...makeDemoSpatialImport('hainan',new Date('2026-10-18T01:00:00.000Z')),
  sourceName:'现场记录',provenanceMode:'measured',
  records:[{treeId:'T-0001',variety:'PR107',circumferenceCm:63,heightM:12,measurementHeightM:1.3,latitude:19.9,longitude:110.4}],
  ...patch,
});

test('each production region has three independent parks and Xi’an remains a separate trial site',()=>{
  assert.equal(productionSites.length,9);
  for(const region of productionRegions)assert.equal(productionSites.filter(site=>parks[site].regionId===region).length,3);
  assert.equal(productionSites.includes('xian'),false);
  assert.equal(new Set(Object.values(parks).map(park=>park.siteId)).size,10);
});

test('all ten demo parks have 200 stable tree points inside their four matching zone boundaries',()=>{
  for(const site of Object.keys(DEMO_SPATIAL_SITES)){
    const input=makeDemoSpatialImport(site,now),original=makeParkContext({siteId:site,now});
    assert.deepEqual(input,makeDemoSpatialImport(site,now));
    assert.equal(input.records.length,200);assert.equal(input.provenanceMode,'simulated');
    assert.equal(input.sourceName,'内置园区模拟数据');
    assert.equal(input.records[0].sourceTreeId,`${parks[site].treePrefix}-A-0001`);
    assert.equal(input.records[199].sourceTreeId,`${parks[site].treePrefix}-D-0050`);
    assert.equal(new Set(input.records.map(row=>`${row.longitude},${row.latitude}`)).size,200);
    for(const [index,row] of input.records.entries()){
      const boundary=demoZoneBoundary(site,'ABCD'[Math.floor(index/50)]);
      assert.ok(row.longitude>Math.min(...boundary.map(point=>point.longitude))&&row.longitude<Math.max(...boundary.map(point=>point.longitude)));
      assert.ok(row.latitude>Math.min(...boundary.map(point=>point.latitude))&&row.latitude<Math.max(...boundary.map(point=>point.latitude)));
      assert.equal(row.circumferenceCm,original.modules.trees[index].circumferenceCm);
      assert.equal(row.heightM,original.modules.trees[index].heightM);
      assert.equal(row.variety,original.modules.trees[index].variety);
      assert.ok(Number.isFinite(row.elevationM));
    }
  }
});

test('initialization fills only missing tree records and remains idempotent after reopening',()=>{
  const path=join(tmpdir(),'demo-spatial-'+randomUUID()+'.sqlite');
  let store=new Store(path);
  try{
    let fields=new FieldTreeRecords(store,()=>now);
    const existing=fields.import(manualImport()).items[0];
    assert.equal(seedDemoSpatialRecords(fields,now),1999);
    assert.deepEqual(fields.catalog('hainan').items[0],existing);
    store.close();store=new Store(path);fields=new FieldTreeRecords(store,()=>new Date(+now+86400000));
    assert.equal(seedDemoSpatialRecords(fields,new Date(+now+86400000)),0);
    for(const site of Object.keys(DEMO_SPATIAL_SITES)){
      assert.equal(fields.catalog(site).importedCount,200);assert.equal(fields.records(site).length,200);
    }
  }finally{store.close();}
});

test('built-in spatial records retain demo tree dimensions and four growth checkpoints',()=>{
  const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
  try{
    seedDemoSpatialRecords(fields,now);
    const original=makeParkContext({now}),applied=fields.apply(original);
    assert.equal(applied.dataPolicy.mode,'demo');
    assert.deepEqual(applied.modules.growth,original.modules.growth);
    for(const [index,tree] of applied.modules.trees.entries()){
      const {fieldRecord,...prior}=tree;
      assert.deepEqual(prior,original.modules.trees[index]);
      assert.equal(fieldRecord.provenance.mode,'simulated');assert.ok(Number.isFinite(fieldRecord.longitude));
    }
  }finally{store.close();}
});

test('a user import takes precedence over demo seed even with an earlier observation and does not inherit seed growth',()=>{
  const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
  try{
    seedDemoSpatialRecords(fields,now);fields.import(manualImport());
    const record=fields.catalog('hainan').items[0],applied=fields.apply(makeParkContext({treeIds:['T-0001'],now}));
    assert.equal(record.sourceName,'现场记录');assert.equal(record.longitude,110.4);
    assert.equal(applied.modules.trees[0].circumferenceCm,63);
    assert.equal(applied.modules.growth.measurements.length,1);
    assert.equal(applied.modules.growth.measurements[0].provenance.mode,'measured');
  }finally{store.close();}
});

test('local app startup seeds all parks without creating model runs; remote context mode remains unchanged',async()=>{
  const local=createApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),pauseModelsOnStart:true});
  try{
    assert.equal(local.store.db.prepare('SELECT COUNT(*) n FROM field_tree_records').get().n,2000);
    assert.equal(local.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
  }finally{await local.close();}
  const remote=createApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),contextProvider:{mode:'remote'},pauseModelsOnStart:true});
  try{assert.equal(remote.store.db.prepare('SELECT COUNT(*) n FROM field_tree_records').get().n,0);}
  finally{await remote.close();}
});

test('trees still shown at an older built-in layout move to the current 3 m × 7 m layout; user imports and history stay',()=>{
  const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
  try{
    // An earlier release stored the built-in layout 8 m × 10 m apart.
    const earlier=new Date(+now-7*86400000),old=makeDemoSpatialImport('hainan',earlier);
    old.records=old.records.map((row,index)=>({...row,longitude:row.longitude+0.0002+(index%10)*0.00005,latitude:row.latitude-Math.floor(index%50/10)*0.00003}));
    fields.import(old);fields.import(manualImport());
    const moved=seedDemoSpatialRecords(fields,now);
    assert.equal(moved,199+1800,'199 Hainan trees move, the measured T-0001 stays; nine other parks are seeded');
    const catalog=fields.catalog('hainan').items,current=makeDemoSpatialImport('hainan',now).records;
    assert.equal(catalog[0].sourceName,'现场记录');assert.equal(catalog[0].longitude,110.4);
    for(const [index,row] of catalog.entries())if(index>0){assert.equal(row.longitude,current[index].longitude);assert.equal(row.latitude,current[index].latitude);}
    assert.equal(fields.records('hainan').length,200+1+199,'the older layout remains in the history');
    assert.equal(seedDemoSpatialRecords(fields,new Date(+now+60000)),0,'a current layout is not imported again');
  }finally{store.close();}
});
