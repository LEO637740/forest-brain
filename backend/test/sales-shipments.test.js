import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { SimulationService } from '../src/simulation.js';
import { calculateMarket } from '../src/simulation-market.js';

function fixture(t, params = {}) {
  let instant = Date.parse('2026-10-20T02:00:00.000Z');
  const store = new Store(), clock = () => new Date(instant);
  const simulation = new SimulationService(store, clock);
  const model = simulation.market({storageKg:1200,transportKgPerDay:20,...params});
  t.after(() => store.close());
  return {store,clock,simulation,model,tick(){instant += 60_000;},
    adopt(scenarioId){return simulation.adoptMarketSales({siteId:model.siteId,modelId:model.id,scenarioId});},
    advance(id){instant += 60_000;return simulation.salesShipments.advance(id,{siteId:model.siteId});},
  };
}

test('adoption creates the chosen daily dry-rubber shipments and persists execution and buyer receipts', t => {
  const f = fixture(t), plan = f.adopt('hold_short');
  assert.equal(plan.inventory.openingStockKg,800);
  assert.equal(plan.inventory.availableKg,400);
  const sellingDays = plan.scenario.daily.filter(day => day.soldKg > 0);
  assert.equal(plan.shipments.length,4);
  assert.deepEqual(plan.shipments.map(task => task.day),[4,5,6,7]);
  assert.deepEqual(plan.shipments.map(task => [task.plannedDepartureAt,task.plannedKg,task.priceCnyPerKg]),
    sellingDays.map(day => [day.at,day.soldKg,day.priceCnyPerKg]));
  assert.equal(plan.shipments.reduce((sum,task) => sum + task.plannedKg,0),plan.scenario.soldKg);
  assert.ok(plan.shipments.every(task => task.siteId === plan.siteId && task.modelId === plan.modelId
    && task.scenarioId === plan.scenarioId && task.status === 'planned' && task.mode === 'simulation'));
  assert.deepEqual(f.adopt('hold_short'),plan);
  assert.equal(f.simulation.salesShipments.list().length,4);
  assert.deepEqual(f.simulation.salesShipments.list('xsbn'),[]);
  assert.equal(f.simulation.latestTasks().length,0);
  assert.equal(f.simulation.logistics.list().length,0);

  let task = f.advance(plan.shipments[0].id);
  assert.equal(task.status,'in-transit');
  assert.equal(task.receipt,undefined);
  assert.deepEqual(
    Object.fromEntries(['stockKg','availableKg','dispatchedKg','inTransitKg','soldKg'].map(key=>[key,f.simulation.salesInventory()[key]])),
    {stockKg:780,availableKg:380,dispatchedKg:20,inTransitKg:20,soldKg:0});
  assert.equal(f.adopt('hold_short').shipments[0].departureAt,task.departureAt);
  task = f.advance(task.id);
  assert.equal(task.status,'received');
  assert.equal(task.receipt.receivedKg,20);
  assert.equal(task.receipt.revenueCny,Math.round(20 * task.priceCnyPerKg * 100) / 100);
  assert.equal(task.receipt.mode,'simulation');
  assert.ok(task.receipt.at > task.departureAt);
  const signedInventory=f.simulation.salesInventory();
  assert.equal(signedInventory.stockKg,780);
  assert.equal(signedInventory.availableKg,380);
  assert.equal(signedInventory.inTransitKg,0);
  assert.equal(signedInventory.soldKg,20);
  assert.equal(signedInventory.salesRevenueCny,task.receipt.revenueCny);
  assert.deepEqual(f.advance(task.id),task);
  assert.deepEqual(f.simulation.salesInventory(),signedInventory);

  const reloaded = new SimulationService(f.store,f.clock);
  assert.deepEqual(reloaded.marketSalesPlan(plan.modelId,plan.siteId).shipments[0],task);
  assert.deepEqual(reloaded.latestMarket(plan.siteId).salesPlan.shipments[0],task);
  assert.equal(reloaded.salesShipments.list(plan.siteId,plan.modelId).length,4);
  assert.deepEqual(reloaded.salesInventory(),signedInventory);
  assert.deepEqual(reloaded.latestMarket().inventory,signedInventory);
  assert.equal(reloaded.salesInventory('xsbn').stockKg,800);
  assert.equal(reloaded.salesInventory('xsbn').soldKg,0);
});

test('changing the adopted scenario replaces pending shipments but keeps dispatched plans and their results', t => {
  const f = fixture(t), first = f.adopt('sell_phased');
  f.tick();
  const changed = f.adopt('sell_now');
  assert.equal(changed.shipments.length,7);
  assert.ok(changed.shipments.every(task => task.plannedKg === 20 && task.status === 'planned'));
  const replaced = f.simulation.salesShipments.list().filter(task => task.scenarioId === first.scenarioId);
  assert.ok(replaced.every(task => task.status === 'cancelled' && task.cancelledAt === changed.adoptedAt));
  assert.throws(() => f.advance(replaced[0].id),{code:'SHIPMENT_CANCELLED'});
  const dispatched = f.advance(changed.shipments[0].id);
  assert.throws(() => f.adopt('hold_short'),{code:'SALES_ALREADY_DISPATCHED'});
  assert.equal(f.simulation.latestMarket().salesPlan.scenarioId,'sell_now');
  assert.deepEqual(f.simulation.latestMarket().salesPlan.shipments[0],dispatched);
  assert.equal(f.simulation.salesShipments.list().length,14);
});

test('zero transport records a sales choice without manufacturing zero-quantity shipment tasks', t => {
  const f = fixture(t,{transportKgPerDay:0});
  const plan = f.adopt('sell_now');
  assert.equal(plan.scenario.soldKg,0);
  assert.deepEqual(plan.shipments,[]);
  assert.deepEqual(f.simulation.salesShipments.list(),[]);
});

test('different models spend the same stock, while hypothetical inputs and projected production never credit the ledger', t => {
  const f=fixture(t), first=f.adopt('sell_now');
  f.advance(first.shipments[0].id);f.advance(first.shipments[0].id);
  const current=f.simulation.market();
  assert.equal(current.params.stockKg,780);
  assert.equal(current.params.heldKg,400);

  const hypothetical=f.simulation.market({stockKg:1000,heldKg:100,storageKg:1200,transportKgPerDay:100});
  assert.equal(hypothetical.params.stockKg,1000);
  assert.equal(f.simulation.salesInventory().stockKg,780);
  const second=f.simulation.adoptMarketSales({modelId:hypothetical.id,scenarioId:'sell_now'});
  assert.equal(second.inventory.stockKg,780);
  f.advance(second.shipments[0].id);
  const inventory=f.simulation.salesInventory();
  assert.equal(inventory.stockKg,680);
  assert.equal(inventory.availableKg,280);
  assert.equal(inventory.heldKg,400);
  assert.equal(inventory.dispatchedKg,120);
  assert.equal(inventory.inTransitKg,100);
  assert.equal(inventory.soldKg,20);
  assert.equal(f.simulation.market().params.stockKg,680);

  const oversized=f.simulation.market({stockKg:1000,heldKg:0,storageKg:1200,transportKgPerDay:300});
  const pending=f.simulation.adoptMarketSales({modelId:oversized.id,scenarioId:'sell_now'});
  assert.throws(()=>f.advance(pending.shipments[0].id),{code:'INSUFFICIENT_SALES_STOCK'});
  assert.deepEqual(f.simulation.salesInventory(),inventory);
  assert.equal(f.simulation.marketSalesPlan(oversized.id,oversized.siteId).shipments[0].status,'planned');
});

test('existing signed shipments recover the earliest adopted opening once, including nondefault inventory assumptions', t => {
  const store=new Store(),clock=()=>new Date('2026-10-20T02:00:00.000Z'),simulation=new SimulationService(store,clock);
  t.after(()=>store.close());
  const older=calculateMarket({stockKg:920,heldKg:300,storageKg:1200},new Date('2026-10-18T02:00:00.000Z'));
  const newer=calculateMarket({stockKg:500,heldKg:200,storageKg:1200},new Date('2026-10-19T02:00:00.000Z'));
  for(const model of [older,newer]){
    store.db.prepare('INSERT INTO simulation_models VALUES(?,?,?)').run(model.id,JSON.stringify(model),model.generatedAt);
    store.db.prepare('INSERT INTO simulation_market_sales_plans VALUES(?,?)').run(model.id,JSON.stringify({
      modelId:model.id,siteId:model.siteId,scenarioId:'sell_now',adoptedAt:model.generatedAt,mode:'simulation',
    }));
  }
  simulation.salesShipments.save({
    id:'existing-received',siteId:older.siteId,modelId:older.id,scenarioId:'sell_now',day:1,
    plannedKg:20,status:'received',createdAt:older.generatedAt,departureAt:older.generatedAt,
    receipt:{at:newer.generatedAt,receivedKg:20,revenueCny:300,mode:'simulation'},mode:'simulation',
  });
  const inventory=simulation.salesInventory();
  assert.equal(inventory.openingStockKg,920);
  assert.equal(inventory.stockKg,900);
  assert.equal(inventory.availableKg,600);
  assert.equal(inventory.heldKg,300);
  assert.equal(inventory.soldKg,20);
  assert.equal(inventory.salesRevenueCny,300);
  assert.equal(simulation.market().params.stockKg,900);
  assert.deepEqual(new SimulationService(store,clock).salesInventory(),inventory);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM simulation_sales_inventory_openings').get().count,1);
});

test('adopting a new model cancels the earlier model\'s undeparted shipments and keeps what already left', t => {
  const f = fixture(t), first = f.adopt('sell_now');
  const departed = f.advance(first.shipments[0].id);
  f.tick();
  const newer = f.simulation.market({storageKg:1200,transportKgPerDay:20});
  const second = f.simulation.adoptMarketSales({siteId:newer.siteId,modelId:newer.id,scenarioId:'sell_now'});
  const old = f.simulation.salesShipments.list(first.siteId,first.modelId);
  assert.deepEqual(old.find(task => task.id === departed.id),departed);
  assert.ok(old.filter(task => task.id !== departed.id).every(task => task.status === 'cancelled' && task.cancelledAt === second.adoptedAt));
  assert.throws(() => f.advance(old.find(task => task.day === 2).id),{code:'SHIPMENT_CANCELLED'});
  const planned = f.simulation.salesShipments.list(first.siteId).filter(task => task.status === 'planned');
  assert.ok(planned.length > 0 && planned.every(task => task.modelId === newer.id),'only the newest plan can still ship');
});

test('shipments of one plan depart in day order, while running ahead of the calendar stays allowed for demos', t => {
  const f = fixture(t), plan = f.adopt('sell_now');
  assert.throws(() => f.advance(plan.shipments[1].id),{code:'SHIPMENT_OUT_OF_ORDER',message:/第 1 天/});
  assert.equal(f.simulation.salesInventory().dispatchedKg,0);
  assert.equal(f.advance(plan.shipments[0].id).status,'in-transit');
  assert.equal(f.advance(plan.shipments[1].id).status,'in-transit','day 2 may leave before its calendar day once day 1 has');
  assert.throws(() => f.advance(plan.shipments[3].id),{code:'SHIPMENT_OUT_OF_ORDER',message:/第 3 天/});
});
