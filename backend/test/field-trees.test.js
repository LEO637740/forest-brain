import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {FieldTreeRecords} from '../src/field-trees.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {contextSchema} from '../src/contracts.js';
import {validate} from '../src/schema.js';
import {evidenceIndex,checkContext} from '../src/validation.js';
import {calculateAngleCandidate} from '../src/angle-policy.js';
import {ReviewWorkflow} from '../src/review-workflow.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {INTEGRATION_VERSION} from '../src/integration-version.js';
const now=new Date('2026-10-19T02:00:00.000Z');
const record=(treeId='T-0001',patch={})=>({treeId,sourceTreeId:'fixture-field-001',variety:'PR107',circumferenceCm:62,heightM:11,measurementHeightM:1.3,...patch});
// Test-only data; these fixtures never enter the application's persisted database.
const batch=(patch={})=>({siteId:'hainan',sourceName:'隔离测试测量表',observedAt:'2026-10-18T01:00:00.000Z',provenanceMode:'simulated',coordinateSystem:'WGS84',records:[record()],...patch});
const polygon=(longitude=110,latitude=19)=>({type:'Polygon',coordinates:[[[longitude,latitude],[longitude+.001,latitude],[longitude+.001,latitude+.001],[longitude,latitude+.001],[longitude,latitude]]]});
const boundaries=(offset=0)=>({park:polygon(110+offset),zones:[...'ABCD'].map((zoneId,index)=>({zoneId,polygon:polygon(110+offset+index*.0002)}))});

test('boundary-only imports persist, replace the current map boundary and remain isolated by park',()=>{
 const path=join(tmpdir(),'field-boundary-test-'+randomUUID()+'.sqlite');
 let store=new Store(path),fields=new FieldTreeRecords(store,()=>now);
 try{
  const original=fields.import(batch({records:[],boundaries:boundaries(),provenanceMode:'measured'}));
  assert.equal(original.savedCount,0);assert.equal(original.importedCount,0);
  assert.equal(original.boundaries.provenanceMode,'measured');assert.equal(original.boundaries.sourceName,'隔离测试测量表');
  fields.import(batch({siteId:'xsbn',records:[],boundaries:boundaries(-9)}));
  fields.import(batch({records:[],boundaries:boundaries(.1),observedAt:'2026-10-19T01:00:00Z'}));
  fields.import(batch({records:[],boundaries:boundaries(.2),observedAt:'2026-10-17T01:00:00Z'}));
  store.close();store=new Store(path);fields=new FieldTreeRecords(store,()=>now);
  assert.deepEqual(fields.catalog('hainan').boundaries.park,boundaries(.1).park);
  assert.deepEqual(fields.catalog('xsbn').boundaries.park,boundaries(-9).park);
  assert.equal(fields.catalog('xian').boundaries,undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM field_boundary_records').get().n,4);
  fields.import(batch({records:[record()]}));
  assert.deepEqual(fields.catalog('hainan').boundaries.park,boundaries(.1).park,'tree-only imports preserve existing boundaries');
  assert.equal(fields.catalog('hainan').items[0].boundaries,undefined,'boundary payload does not leak into per-tree context contracts');
 }finally{store.close();}
});

test('boundary validation prevents incomplete geometry from replacing saved field data',()=>{
 const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
 try{
  const input=batch({boundaries:boundaries()});
  input.boundaries.park.coordinates[0].pop();
  assert.throws(()=>fields.import(input),error=>error.code==='INVALID_BOUNDARY_RING');
  assert.equal(fields.catalog().importedCount,0);
  const duplicate=boundaries();duplicate.zones[3].zoneId='A';
  assert.throws(()=>fields.import(batch({boundaries:duplicate})),error=>error.code==='INVALID_BOUNDARY_ZONES');
  assert.throws(()=>fields.import(batch({records:[]})),error=>error.code==='EMPTY_FIELD_IMPORT');
 }finally{store.close();}
});

test('field records survive reopening and latest observation wins over later imports of older history',()=>{
 const path=join(tmpdir(),'field-tree-test-'+randomUUID()+'.sqlite');
 let store=new Store(path);
 try{
  let fields=new FieldTreeRecords(store,()=>now);
  assert.deepEqual(fields.catalog('hainan'),{siteId:'demo-hainan',items:[],importedCount:0});
  const current=fields.import(batch({records:[record('T-0001',{latitude:19,longitude:110,elevationM:20})],elevationDatum:'测试高程基准'}));
  assert.equal(current.savedCount,1);assert.equal(current.importedCount,1);
  fields.import(batch({observedAt:'2026-10-10T01:00:00.000Z',records:[record('T-0001',{circumferenceCm:60})]}));
  fields.import(batch({siteId:'xsbn',records:[record('T-0001',{circumferenceCm:70})]}));
  store.close();store=new Store(path);fields=new FieldTreeRecords(store,()=>now);
  assert.equal(fields.catalog('hainan').items[0].circumferenceCm,62);
  assert.equal(fields.catalog('xsbn').items[0].circumferenceCm,70);
  assert.equal(fields.catalog('hainan').items[0].elevationDatum,'测试高程基准');
  assert.equal(fields.records('hainan').length,2);
  fields.import(batch({records:[record('T-0001',{circumferenceCm:63})]}));
  assert.equal(fields.catalog('hainan').items[0].circumferenceCm,63);
 }finally{store.close();}
});

test('projection preserves field provenance and uses only imported measurements for imported trees',()=>{
 const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
 try{
  fields.import(batch({observedAt:'2026-09-18T01:00:00.000Z',provenanceMode:'measured',records:[record('T-0001',{circumferenceCm:61})]}));
  fields.import(batch({provenanceMode:'measured'}));
  const original=makeParkContext({treeIds:['T-0001','T-0002'],now}),before=JSON.stringify(original);
  const context=fields.apply(original),tree=context.modules.trees[0];
  assert.equal(JSON.stringify(original),before);assert.notEqual(context.snapshotId,original.snapshotId);
  assert.equal(tree.circumferenceCm,62);assert.equal(tree.variety,'PR107');assert.equal(tree.fieldRecord.sourceTreeId,'fixture-field-001');
  assert.equal(tree.provenance.mode,'simulated');assert.equal(tree.fieldRecord.provenance.mode,'measured');
  assert.equal(tree.plantedAt,original.modules.trees[0].plantedAt);assert.equal(tree.healthStatus,original.modules.trees[0].healthStatus);
  const history=context.modules.growth.measurements.filter(row=>row.treeId==='T-0001');
  assert.equal(history.length,2);assert.ok(history.every(row=>row.provenance.mode==='measured'));
  assert.equal(context.modules.growth.measurements.filter(row=>row.treeId==='T-0002').length,4);
  assert.doesNotThrow(()=>validate(contextSchema,context));assert.doesNotThrow(()=>evidenceIndex(context));
  const angle=calculateAngleCandidate({tree,panel:context.modules.tapping.panels[0],weather:context.modules.weather.observed,asOf:context.asOf,constraints:context.constraints});
  assert.equal(angle.factors.find(row=>row.key==='variety_prior').provenanceMode,'measured');
  assert.equal(angle.factors.find(row=>row.key==='tree_age').provenanceMode,'simulated');
  assert.equal(context.dataPolicy.mode,'mixed_demo');
 }finally{store.close();}
});

test('missing imported measurements stay missing and single observation does not inherit synthetic growth history',()=>{
 const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
 try{
  fields.import(batch({records:[record('T-0001',{variety:null,heightM:null,measurementHeightM:null})]}));
  const context=fields.apply(makeParkContext({treeIds:['T-0001'],now}));
  assert.equal(context.modules.trees[0].variety,null);assert.equal(context.modules.trees[0].heightM,null);
  assert.equal(context.modules.growth.measurements.length,0);
  const check=checkContext({kind:'growth_plan',siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'},context,now);
  assert.ok(check.missing.some(item=>item.module==='growth'));
 }finally{store.close();}
});

test('field projection follows simulated review edits so imported values keep their source',()=>{
 const store=new Store(),fields=new FieldTreeRecords(store,()=>now),reviews=new ReviewWorkflow(store,()=>now,null,null,fields);
 try{
  fields.import(batch({provenanceMode:'measured',records:[record('T-0042',{circumferenceCm:68})]}));
  reviews.save({id:'review-field-fixture',siteId:'demo-hainan',treeId:'T-0042',kind:'measure',status:'completed',completedAt:'2026-10-19T01:00:00.000Z',expiresAt:'2026-10-20T01:00:00.000Z',evidence:{circumferenceCm:51}},'test');
  const context=reviews.apply(makeParkContext({treeIds:['T-0042'],now}));
  assert.equal(context.modules.trees[0].circumferenceCm,68);
  assert.equal(context.modules.trees[0].fieldRecord.provenance.mode,'measured');
  assert.equal(context.modules.growth.measurements.length,1);
  assert.ok(context.modules.growth.measurements[0].observationId.startsWith('field-'));
 }finally{store.close();}
});

test('invalid row prevents the whole import and catalog keeps coordinate nulls',()=>{
 const store=new Store(),fields=new FieldTreeRecords(store,()=>now);
 try{
  assert.throws(()=>fields.import(batch({records:[record(),record('T-0201')]})),error=>error.code==='TREE_NOT_FOUND');
  assert.equal(fields.catalog().importedCount,0);
  assert.throws(()=>fields.import(batch({records:[record('T-0001',{latitude:19})]})),error=>error.code==='INCOMPLETE_COORDINATES');
  const saved=fields.import(batch({records:[record('T-0001',{latitude:null,longitude:null,elevationM:null})]}));
  assert.equal(saved.items[0].latitude,null);assert.equal(saved.items[0].elevationDatum,null);
 }finally{store.close();}
});

test('HTTP import updates current profiles, new strategy inputs and market calculation while keeping frozen strategies',async t=>{
 let instant=+now;const clock=()=>new Date(instant);
 const app=createApp({dbPath:':memory:',clock,generator:new RuleGenerator(),publicDataService:{status:()=>({location:{confirmed:false},sources:[]})}});
 t.after(()=>app.close());
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,input,expected=200)=>{const response=await fetch(base+path,{method:input?'POST':'GET',headers:{'Content-Type':'application/json'},body:input?JSON.stringify(input):undefined});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;};
 const health=await call('/health');assert.equal(health.version,INTEGRATION_VERSION);assert.ok(health.capabilities.includes('field-tree-import'));
 const meta=await call('/api/meta');assert.equal(meta.version,INTEGRATION_VERSION);assert.ok(meta.integrationCapabilities.includes('field-tree-import'));
 const spatial=await call('/api/field/trees',batch({siteId:'xsbn',records:[],boundaries:boundaries(-9),provenanceMode:'measured'}),201);
 assert.deepEqual((await call('/api/field/trees?siteId=xsbn')).boundaries,spatial.boundaries);
 assert.equal((await call('/api/field/trees?siteId=hainan')).boundaries,undefined);
 const prepare=async preparationId=>{const result=await call('/api/demo/trees/prepare',{preparationId,treeIds:['T-0001'],kind:'tapping_angle',dataMode:'mixed_demo',generatorMode:'demo_rules'},202);await app.runtime.idle();return result.items[0].runId;};
 const oldRun=await prepare('field-old');
 const oldInput=await call(`/internal/harness/runs/${oldRun}/context`);
 const beforeMarket=await call('/api/simulation/market',{});
 const runCount=app.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n;
 const imported=await call('/api/field/trees',batch({provenanceMode:'measured',records:[record(),record('T-0042')]}),201);
 assert.equal(imported.savedCount,2);assert.equal(imported.importedCount,200);
 assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,runCount,'import alone does not invoke a model');
 const park=await call('/api/demo/park');assert.equal(park.trees[0].circumferenceCm,62);
 const firstView=await call('/api/demo/trees/T-0042/view?kind=tapping_angle');assert.equal(firstView.tree.circumferenceCm,62);
 const afterMarket=await call('/api/simulation/market',{});assert.equal(afterMarket.eligibleTreeCount,beforeMarket.eligibleTreeCount+1);assert.ok(afterMarket.eligibleTreeIds.includes('T-0042'));
 const newRun=await prepare('field-new'),newInput=await call(`/internal/harness/runs/${newRun}/context`);
 assert.equal(newInput.modules.trees[0].circumferenceCm,62);assert.equal(newInput.modules.trees[0].fieldRecord.sourceName,'隔离测试测量表');
 assert.equal((await call(`/internal/harness/runs/${newRun}`)).status,'succeeded');
 assert.deepEqual(await call(`/internal/harness/runs/${oldRun}/context`),oldInput);
 instant+=3600000;
 await call('/api/field/trees',batch({observedAt:clock().toISOString(),records:[record('T-0001',{circumferenceCm:64})]}),201);
 assert.equal((await call('/api/demo/park')).trees[0].circumferenceCm,64);
 assert.equal((await call(`/internal/harness/runs/${newRun}/context`)).modules.trees[0].circumferenceCm,62);
 assert.equal((await call('/api/field/trees?siteId=xsbn')).importedCount,200);
});
