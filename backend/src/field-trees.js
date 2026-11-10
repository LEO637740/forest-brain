import {randomUUID} from 'node:crypto';
import {fieldTreeImportSchema} from './contracts.js';
import {validate} from './schema.js';
import {invariant} from './errors.js';
import {normalizeSiteId,TREE_IDS} from './adapters/park-demo.js';
import {digest} from './util.js';
import {isDemoSpatialRecord} from '../../shared/demoSpatial.ts';

const provenance=record=>({sourceClass:'farmer_expert',sourceId:record.recordId,mode:record.provenanceMode});

export class FieldTreeRecords {
 constructor(store,clock=()=>new Date()) {
  this.store=store;this.clock=clock;
  store.db.exec('CREATE TABLE IF NOT EXISTS field_tree_records (record_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, tree_id TEXT NOT NULL, observed_at TEXT NOT NULL, imported_at TEXT NOT NULL, body TEXT NOT NULL)');
  store.db.exec('CREATE INDEX IF NOT EXISTS field_tree_records_by_site ON field_tree_records(site_id,tree_id,observed_at)');
  store.db.exec('CREATE TABLE IF NOT EXISTS field_boundary_records (record_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, observed_at TEXT NOT NULL, imported_at TEXT NOT NULL, body TEXT NOT NULL)');
 }
 records(siteId,asOf=null) {
  const cutoff=asOf===null?Infinity:Date.parse(asOf);
  return this.store.db.prepare('SELECT body FROM field_tree_records WHERE site_id=? ORDER BY rowid DESC').all(normalizeSiteId(siteId))
   .map(row=>JSON.parse(row.body)).filter(record=>Date.parse(record.observedAt)<=cutoff&&Date.parse(record.importedAt)<=cutoff)
   .sort((a,b)=>Number(isDemoSpatialRecord(a))-Number(isDemoSpatialRecord(b))||Date.parse(b.observedAt)-Date.parse(a.observedAt)||Date.parse(b.importedAt)-Date.parse(a.importedAt));
 }
 catalog(siteId='demo-hainan') {
  siteId=normalizeSiteId(siteId);const seen=new Set();
  const items=this.records(siteId).filter(record=>{if(seen.has(record.treeId))return false;seen.add(record.treeId);return true;}).sort((a,b)=>a.treeId.localeCompare(b.treeId));
  const row=this.store.db.prepare('SELECT body FROM field_boundary_records WHERE site_id=? ORDER BY observed_at DESC, rowid DESC LIMIT 1').get(siteId);
  return {siteId,items,importedCount:items.length,...(row?{boundaries:JSON.parse(row.body)}:{})};
 }
 import(input) {
  validate(fieldTreeImportSchema,input);
  let siteId;try{siteId=normalizeSiteId(input.siteId);}catch{invariant(false,'INVALID_SITE','请选择目录中的园区',422);}
  invariant(input.records.length||input.boundaries,'EMPTY_FIELD_IMPORT','至少提供树木资料或园区边界',422);
  invariant(new Set(input.records.map(record=>record.treeId)).size===input.records.length,'DUPLICATE_TREE','同一批资料中树号不能重复',422);
  invariant(input.records.every(record=>TREE_IDS.includes(record.treeId)),'TREE_NOT_FOUND','树号须对应当前园区 T-0001 至 T-0200',422);
  invariant(Date.parse(input.observedAt)<=+this.clock()+300000,'INVALID_OBSERVATION_TIME','观测时间不能晚于当前时间',422);
  for(const record of input.records)invariant((record.latitude==null)===(record.longitude==null),'INCOMPLETE_COORDINATES',`${record.treeId} 的纬度和经度需同时提供或同时留空`,422);
  if(input.boundaries){
   invariant(new Set(input.boundaries.zones.map(zone=>zone.zoneId)).size===4,'INVALID_BOUNDARY_ZONES','边界需包含 A、B、C、D 四个不同分区',422);
   for(const polygon of [input.boundaries.park,...input.boundaries.zones.map(zone=>zone.polygon)]){
    const ring=polygon.coordinates[0],first=ring[0],last=ring.at(-1);
    invariant(first[0]===last[0]&&first[1]===last[1]&&new Set(ring.map(point=>point.join(','))).size>=3,'INVALID_BOUNDARY_RING','Polygon 外环至少需要三个不同顶点，末点须与首点相同',422);
    invariant(ring.every(([longitude,latitude])=>longitude>=-180&&longitude<=180&&latitude>=-90&&latitude<=90),'INVALID_BOUNDARY_COORDINATES','边界经纬度须为有效 WGS84 坐标',422);
   }
  }
  const importedAt=this.clock().toISOString(),{records,boundaries,...source}=input;
  this.store.transaction(()=>{
   const insert=this.store.db.prepare('INSERT INTO field_tree_records VALUES(?,?,?,?,?,?)');
   for(const item of records){
    const record={...source,...item,siteId,recordId:'field-'+randomUUID(),importedAt,elevationDatum:input.elevationDatum??null};
    insert.run(record.recordId,siteId,record.treeId,record.observedAt,importedAt,JSON.stringify(record));
   }
   if(boundaries){
    const {elevationDatum,...boundarySource}=source;
    const record={...boundarySource,...boundaries,siteId,recordId:'boundary-'+randomUUID(),observedAt:new Date(input.observedAt).toISOString(),importedAt};
    this.store.db.prepare('INSERT INTO field_boundary_records VALUES(?,?,?,?,?)').run(record.recordId,siteId,record.observedAt,importedAt,JSON.stringify(record));
   }
  });
  return {...this.catalog(siteId),savedCount:records.length};
 }
 apply(context) {
  const c=structuredClone(context),records=this.records(c.siteId,c.asOf),applied=[];
  for(const tree of c.modules.trees??[]){
   const history=records.filter(record=>record.treeId===tree.treeId),latest=history[0];
   if(!latest)continue;
   const demoSeed=isDemoSpatialRecord(latest);
   if(!demoSeed){tree.variety=latest.variety;tree.circumferenceCm=latest.circumferenceCm;tree.heightM=latest.heightM;tree.measuredAt=latest.observedAt;}
   tree.fieldRecord={...latest,provenance:provenance(latest)};
   if(c.modules.growth&&!demoSeed){
    // Keep one correction per observation instant. Never join measured growth
    // points to the synthetic history that initialized this scene object.
    const seenTimes=new Set();
    const measurements=history.filter(record=>!isDemoSpatialRecord(record)).filter(record=>{const at=Date.parse(record.observedAt);if(seenTimes.has(at))return false;seenTimes.add(at);return true;})
     .filter(record=>record.circumferenceCm!==null&&record.measurementHeightM!==null)
     .map(record=>({observationId:record.recordId+':growth',treeId:tree.treeId,observedAt:record.observedAt,circumferenceCm:record.circumferenceCm,measurementHeightM:record.measurementHeightM,provenance:provenance(record),quality:'valid'}));
    c.modules.growth.measurements=c.modules.growth.measurements.filter(record=>record.treeId!==tree.treeId).concat(measurements);
   }
   applied.push(latest);
  }
  if(applied.length){
   const measured=applied.filter(record=>record.provenanceMode==='measured').length;
   c.dataPolicy??={mode:applied.every(isDemoSpatialRecord)?'demo':'mixed_demo',notices:[],substitutions:[]};
   if(measured)c.dataPolicy.mode='mixed_demo';
   c.dataPolicy.notices=[...c.dataPolicy.notices.filter(note=>!note.startsWith('现场树档案接入：')),`现场树档案接入：本次目标中 ${applied.length} 棵使用导入资料（实测 ${measured} 棵、模拟 ${applied.length-measured} 棵）。品种、树围、树高及位置保留各自导入来源；种植日期、健康、作业状态及其他模块沿用原有来源。`];
   c.dataPolicy.substitutions=c.dataPolicy.substitutions.filter(item=>!['trees','growth'].includes(item.module));
   c.dataPolicy.substitutions.push({module:'trees',sourceId:'field-tree-coverage',reason:`已导入 ${applied.length} 棵的园区资料；内置模拟资料保留原演示尺寸，种植日期、健康、作业状态仍来自原有档案。`},{module:'growth',sourceId:'field-tree-growth-coverage',reason:'现场导入树采用有树围和测量高度的导入历史；内置模拟资料和未导入树保留原演示生长历史。'});
   c.sourceSnapshots=[...new Set([...(c.sourceSnapshots??[]),...applied.map(record=>record.recordId)])];
  }
  c.snapshotId='input-'+digest(c).slice(0,24);
  return c;
 }
}
