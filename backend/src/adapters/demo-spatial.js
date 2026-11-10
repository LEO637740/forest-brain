import {DEMO_SPATIAL_SOURCE, demoTreePosition, isDemoSpatialRecord} from '../../../shared/demoSpatial.ts';
import {makeParkContext, parkSite, PARK_SITES} from './park-demo.js';

export function makeDemoSpatialImport(siteId, now = new Date()) {
  const site = parkSite(siteId);
  const trees = makeParkContext({siteId:site.siteId, now}).modules.trees;
  return {
    siteId:site.siteId,
    sourceName:DEMO_SPATIAL_SOURCE,
    observedAt:now.toISOString(),
    provenanceMode:'simulated',
    coordinateSystem:'WGS84',
    elevationDatum:'演示高程基准（模拟）',
    records:trees.map((tree, index)=>({
      treeId:tree.treeId,
      sourceTreeId:`${site.treePrefix}-${'ABCD'[Math.floor(index / 50)]}-${String(index % 50 + 1).padStart(4,'0')}`,
      variety:tree.variety,
      circumferenceCm:tree.circumferenceCm,
      heightM:tree.heightM,
      measurementHeightM:1.3,
      ...demoTreePosition(site.key,index),
    })),
  };
}

export function seedDemoSpatialRecords(fields, now = new Date()) {
  let savedCount=0;
  for(const siteId of Object.keys(PARK_SITES)) {
    const current=new Map(fields.catalog(siteId).items.map(record=>[record.treeId,record]));
    const input=makeDemoSpatialImport(siteId,now);
    // Fill missing trees, and give trees still shown at an older built-in layout the
    // current one. Measured or user-imported records win and are never replaced;
    // earlier records stay in the history.
    input.records=input.records.filter(record=>{
      const shown=current.get(record.treeId);
      return !shown || isDemoSpatialRecord(shown) && (shown.longitude!==record.longitude || shown.latitude!==record.latitude);
    });
    if(input.records.length)savedCount+=fields.import(input).savedCount;
  }
  return savedCount;
}
