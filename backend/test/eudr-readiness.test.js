import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {EudrReadinessService} from '../src/eudr-readiness.js';
import {demoZoneBoundary} from '../../shared/demoSpatial.ts';

function fixture(t) {
  const store=new Store(), clock=()=>new Date('2026-10-21T06:00:00.000Z');
  const simulation=new SimulationService(store,clock), service=new EudrReadinessService({store,simulation,clock});
  t.after(()=>store.close());
  let sequence=0;
  const processed=(id,indices=[0,50])=>{
    const task={id,site:'hainan',title:`${id} 模拟割胶`,date:'2026-10-20',kind:'割胶',block:'A',robot:'R-A',
      start:'08:00',end:'09:00',status:'已完成',count:indices.length,done:indices.length,treeIndices:indices,
      dispatch:{phase:'completed',history:[{time:'2026-10-20T01:00:00.000Z',label:'模拟割胶完成'}]}};
    simulation.tasks({tasks:[task]});
    let batch=simulation.logistics.create({requestId:`collect-${++sequence}`,siteId:'demo-hainan',taskId:id,
      operator:'模拟收胶员',collectionPointId:'hn-collection-a',containerCount:2,note:'对应任务收胶'});
    const act=(action,extra={})=>{batch=simulation.logistics.transition(batch.id,action,{requestId:`step-${++sequence}`,
      siteId:batch.siteId,revision:batch.revision,operator:'模拟经办人',note:`模拟${action}`,...extra});};
    act('weigh',{grossKg:102,tareKg:2});
    act('inspect',{sampleId:`sample-${id}`,dryRubberPercent:34,decision:'pass'});
    act('plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-001',driver:'模拟司机',plannedDepartureAt:'2026-10-21T06:00:00.000Z'});
    act('dispatch');act('receive',{receivedKg:100});act('process');
    return batch;
  };
  return {store,clock,simulation,service,processed};
}

test('empty EUDR view explains the production next step and leaves opening inventory untraced',t=>{
  const {service,simulation}=fixture(t), view=service.read('hainan');
  assert.deepEqual(view.batches,[]);
  assert.equal(view.status,'missing');
  assert.match(view.nextStep,/加工入库/);
  assert.equal(view.inventory.openingStockKg,800);
  assert.equal(view.inventory.sourceAllocation,'unknown');
  assert.match(view.inventory.note,/期初库存.*来源资料待补齐/);
  assert.equal(simulation.logistics.list('hainan').length,0);
});

test('selected processed batch exports only its source zones, kilograms and simulated evidence after preparation',t=>{
  const f=fixture(t), selected=f.processed('source-ab'), other=f.processed('source-c',[100]);
  const before=f.simulation.salesInventory('hainan');
  const missing=f.service.read('hainan').batches.find(batch=>batch.id===selected.id);
  assert.equal(missing.status,'missing');
  assert.deepEqual(missing.sourceZones,['A','B']);
  assert.equal(missing.dryKg,34);
  assert.deepEqual(missing.productionPeriod,{from:'2026-10-20T01:00:00.000Z',to:'2026-10-20T01:00:00.000Z'});
  const prepared=f.service.prepareDemo({siteId:'hainan',batchId:selected.id});
  assert.equal(prepared.status,'demo_prepared');
  assert.deepEqual(prepared.missing,[]);
  assert.equal(prepared.ddsReference,null);
  assert.ok(prepared.evidence.every(item=>item.mode==='simulated'));
  const reloaded=new EudrReadinessService(f);
  const pack=reloaded.exportPack('hainan',selected.id);
  assert.equal(pack.batch.dryKg,34);
  assert.deepEqual(pack.sourceRecord.treeIndices,[0,50]);
  assert.deepEqual(pack.batch.geojson.features.map(feature=>feature.id),['demo-hainan:A','demo-hainan:B']);
  const firstRing=pack.batch.plots[0].geometry.coordinates[0];
  const expected=demoZoneBoundary('hainan','A').map(point=>[Number(point.longitude.toFixed(6)),Number(point.latitude.toFixed(6))]);
  assert.deepEqual(firstRing,[...expected,expected[0]]);
  assert.equal(pack.batch.plots[0].areaHa,0.5376);
  assert.ok(!JSON.stringify(pack).includes(other.id));
  assert.deepEqual(pack.flowChain.map(step=>step.action),['collect','weigh','inspect','plan','dispatch','receive','process']);
  assert.equal(pack.shipmentAllocation.status,'unknown');
  assert.equal(pack.riskReview.status,'not_assessed');
  assert.equal(pack.batch.riskReview.status,'not_assessed');
  assert.match(pack.riskReview.summary,/不构成无风险/);
  assert.match(pack.disclaimer,/模拟.*不代表 EUDR 合规认证/);
  assert.deepEqual(f.simulation.salesInventory('hainan'),before);
  assert.equal(f.service.read('hainan').batches.find(batch=>batch.id===other.id).status,'missing');
  assert.throws(()=>f.service.exportPack('xsbn',selected.id),error=>error.status===404);
});

test('legacy batch without source trees remains unknown instead of borrowing all park plots',t=>{
  const f=fixture(t), original=f.processed('known-source');
  const legacy={...original,id:'legacy-unmapped',source:{...original.source,treeIndices:[]}};
  f.store.db.prepare('INSERT INTO simulation_logistics_batches VALUES(?,?,?,?)')
    .run(legacy.id,legacy.siteId,'legacy-task',JSON.stringify(legacy));
  const pack=f.service.exportPack('hainan',legacy.id);
  assert.equal(pack.status,'missing');
  assert.deepEqual(pack.batch.plots,[]);
  assert.deepEqual(pack.batch.geojson.features,[]);
  assert.match(pack.batch.missing.join('、'),/来源树木/);
  assert.throws(()=>f.service.prepareDemo({siteId:'hainan',batchId:legacy.id}),error=>error.code==='EUDR_SOURCE_UNKNOWN');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM simulation_eudr_preparations').get().count,0);
});

test('unprocessed collection is not presented or exported as dry-rubber production',t=>{
  const f=fixture(t), processed=f.processed('inbound-source');
  const waiting={...processed,id:'waiting-processing',stage:'received',processing:undefined};
  f.store.db.prepare('INSERT INTO simulation_logistics_batches VALUES(?,?,?,?)')
    .run(waiting.id,waiting.siteId,'waiting-task',JSON.stringify(waiting));
  assert.ok(!f.service.read('hainan').batches.some(batch=>batch.id===waiting.id));
  assert.throws(()=>f.service.prepareDemo({siteId:'hainan',batchId:waiting.id}),error=>error.code==='EUDR_BATCH_NOT_PROCESSED');
  assert.throws(()=>f.service.exportPack('hainan',waiting.id),error=>error.code==='EUDR_BATCH_NOT_PROCESSED');
});

test('replacing a sales scenario releases its source batch for the new shipment',t=>{
  const f=fixture(t), batch=f.processed('replace-source');
  f.service.prepareDemo({siteId:'hainan',batchId:batch.id});
  const model=f.simulation.market({siteId:'demo-hainan',storageKg:1200,transportKgPerDay:20});
  const adopt=scenarioId=>f.simulation.adoptMarketSales({siteId:model.siteId,modelId:model.id,scenarioId});
  const first=adopt('sell_now');
  f.service.allocate({siteId:model.siteId,shipmentId:first.shipments[0].id,batchIds:[batch.id]});
  assert.equal(f.service.read('hainan').batches[0].remainingKg,14);

  const changed=adopt('hold_short');
  assert.equal(f.simulation.salesShipments.list(model.siteId).find(item=>item.id===first.shipments[0].id).status,'cancelled');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM simulation_eudr_allocations WHERE shipment_id=?').get(first.shipments[0].id).n,0);
  assert.equal(f.service.read('hainan').batches[0].remainingKg,34);
  const allocated=f.service.allocate({siteId:model.siteId,shipmentId:changed.shipments[0].id,batchIds:[batch.id]});
  assert.deepEqual(allocated.allocation.parts.map(part=>part.kg),[20]);
  assert.equal(f.service.read('hainan').batches[0].remainingKg,14);
  assert.deepEqual(f.service.exportPack('hainan',batch.id).shipmentAllocation.shipments.map(item=>item.shipmentId),[changed.shipments[0].id]);
});

test('old cancelled allocations neither reserve stock nor reappear when their scenario is selected again',t=>{
  const f=fixture(t), batch=f.processed('legacy-cancel-source');
  f.service.prepareDemo({siteId:'hainan',batchId:batch.id});
  const model=f.simulation.market({siteId:'demo-hainan',storageKg:1200,transportKgPerDay:20});
  const adopt=scenarioId=>f.simulation.adoptMarketSales({siteId:model.siteId,modelId:model.id,scenarioId});
  const first=adopt('sell_phased');
  f.service.allocate({siteId:model.siteId,shipmentId:first.shipments[0].id,batchIds:[batch.id]});
  const legacy=f.store.db.prepare('SELECT * FROM simulation_eudr_allocations WHERE shipment_id=?').get(first.shipments[0].id);
  const changed=adopt('sell_now');
  // Recreate the stale row left by earlier versions, without running the current cancellation path.
  f.store.db.prepare('INSERT INTO simulation_eudr_allocations VALUES(?,?,?)').run(legacy.shipment_id,legacy.site_id,legacy.body);
  assert.equal(f.service.read('hainan').batches[0].remainingKg,34);
  assert.deepEqual(f.service.exportPack('hainan',batch.id).shipmentAllocation.shipments,[]);
  f.service.allocate({siteId:model.siteId,shipmentId:changed.shipments[0].id,batchIds:[batch.id]});
  assert.equal(f.service.read('hainan').batches[0].remainingKg,14);

  const selectedAgain=adopt('sell_phased');
  assert.equal(selectedAgain.shipments[0].id,first.shipments[0].id);
  assert.equal(f.service.read('hainan').shipments.find(item=>item.id===first.shipments[0].id).traceStatus,'unallocated');
  assert.equal(f.service.read('hainan').batches[0].remainingKg,34);
});

test('two prepared 34 kg batches cover a 40 kg shipment and keep the remaining 28 kg available',t=>{
  const f=fixture(t), first=f.processed('combine-a',[0]),second=f.processed('combine-b',[50]);
  for(const batch of [first,second]) f.service.prepareDemo({siteId:'hainan',batchId:batch.id});
  const model=f.simulation.market({siteId:'demo-hainan',storageKg:1200,transportKgPerDay:40});
  const plan=f.simulation.adoptMarketSales({siteId:model.siteId,modelId:model.id,scenarioId:'sell_now'});
  const shipment=f.service.allocate({siteId:model.siteId,shipmentId:plan.shipments[0].id,batchIds:[first.id,second.id]});
  assert.equal(shipment.plannedKg,40);
  assert.deepEqual(shipment.allocation.parts.map(part=>[part.batchId,part.kg]),[[first.id,34],[second.id,6]]);
  assert.deepEqual(shipment.allocation.sourceZones,['A','B']);
  const view=f.service.read('hainan');
  assert.equal(view.batches.reduce((sum,batch)=>sum+batch.remainingKg,0),28);
  assert.equal(view.batches.find(batch=>batch.id===second.id).remainingKg,28);
  const pack=f.service.exportShipmentPack('hainan',shipment.id);
  assert.equal(pack.product.netKg,40);
  assert.deepEqual(pack.batches.map(batch=>batch.kg),[34,6]);
  assert.deepEqual(pack.plots.map(plot=>plot.zone),['A','B']);
});
