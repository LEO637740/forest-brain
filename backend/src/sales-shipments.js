import { invariant } from './errors.js';
import { normalizeSiteId, parkSite } from './adapters/park-demo.js';

const money = value => Math.round(value * 100) / 100;
const kg = value => Math.round(value * 1000) / 1000;

// Sales are dry rubber from the adopted forecast, separate from fresh-latex collection.
export class SalesShipments {
  constructor(store, clock) {
    this.store = store;
    this.clock = clock;
    store.db.exec(`CREATE TABLE IF NOT EXISTS simulation_sales_shipments (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, model_id TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sales_shipments_by_site ON simulation_sales_shipments(site_id);
    CREATE INDEX IF NOT EXISTS sales_shipments_by_model ON simulation_sales_shipments(model_id);
    CREATE TABLE IF NOT EXISTS simulation_sales_inventory_openings (
      site_id TEXT PRIMARY KEY, stock_kg REAL NOT NULL, held_kg REAL NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_eudr_allocations (
      shipment_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, body TEXT NOT NULL
    )`);
  }

  inventory(siteId) {
    siteId = normalizeSiteId(siteId);
    let opening = this.store.db.prepare('SELECT * FROM simulation_sales_inventory_openings WHERE site_id=?').get(siteId);
    if (!opening) {
      // Recover the original adopted assumptions once for installations that already have shipments.
      const saved = this.store.db.prepare(`SELECT m.body FROM simulation_market_sales_plans p
        JOIN simulation_models m ON m.id=p.model_id
        WHERE json_extract(p.body,'$.siteId')=?
        ORDER BY json_extract(p.body,'$.adoptedAt'),p.rowid LIMIT 1`).get(siteId);
      const params = saved ? JSON.parse(saved.body).params : {stockKg:800,heldKg:400};
      opening = {site_id:siteId,stock_kg:params.stockKg,held_kg:params.heldKg,created_at:this.clock().toISOString()};
      this.store.db.prepare('INSERT INTO simulation_sales_inventory_openings VALUES(?,?,?,?)')
        .run(siteId,opening.stock_kg,opening.held_kg,opening.created_at);
    }
    const shipments = this.list(siteId);
    const processed = this.store.db.prepare(`SELECT body FROM simulation_logistics_batches
      WHERE site_id=? AND json_extract(body,'$.stage')='processed'`).all(siteId)
      .map(row => JSON.parse(row.body).processing);
    const processedKg = kg(processed.reduce((sum,record) => sum + record.dryKg,0));
    const dispatched = shipments.filter(task => ['in-transit', 'received'].includes(task.status));
    const received = shipments.filter(task => task.status === 'received');
    const dispatchedKg = kg(dispatched.reduce((sum,task) => sum + task.plannedKg,0));
    const stockKg = kg(opening.stock_kg + processedKg - dispatchedKg);
    return {
      siteId,openingStockKg:opening.stock_kg,stockKg,availableKg:kg(stockKg - opening.held_kg),heldKg:opening.held_kg,
      processedKg,processedBatches:processed.length,
      dispatchedKg,inTransitKg:kg(dispatched.filter(task => task.status === 'in-transit').reduce((sum,task) => sum + task.plannedKg,0)),
      soldKg:kg(received.reduce((sum,task) => sum + task.receipt.receivedKg,0)),
      salesRevenueCny:money(received.reduce((sum,task) => sum + task.receipt.revenueCny,0)),
      updatedAt:[...dispatched.map(task=>task.receipt?.at ?? task.departureAt),...processed.map(record=>record.at)]
        .reduce((latest,at) => at > latest ? at : latest,opening.created_at),
      unit:'kg_dry_rubber',mode:'simulation',
    };
  }

  list(siteId = null, modelId = null) {
    const scope = siteId === null ? null : normalizeSiteId(siteId);
    return this.store.db.prepare(`SELECT body FROM simulation_sales_shipments
      WHERE (? IS NULL OR site_id=?) AND (? IS NULL OR model_id=?)
      ORDER BY rowid DESC`).all(scope, scope, modelId, modelId)
      .map(row => JSON.parse(row.body))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.day - b.day);
  }

  forPlan(plan) {
    return this.list(plan.siteId, plan.modelId).filter(task => task.scenarioId === plan.scenarioId);
  }

  save(shipment) {
    this.store.db.prepare('INSERT OR REPLACE INTO simulation_sales_shipments VALUES(?,?,?,?)')
      .run(shipment.id, shipment.siteId, shipment.modelId, JSON.stringify(shipment));
    return shipment;
  }

  adopt(model, scenario, adoptedAt) {
    const existing = this.list(model.siteId, model.id);
    const other = existing.filter(task => task.scenarioId !== scenario.id);
    invariant(!other.some(task => ['in-transit', 'received'].includes(task.status)),
      'SALES_ALREADY_DISPATCHED', '原销售方案已有出货，请先完成原方案；新的销售安排请重新测算', 409);
    // A newly adopted plan replaces every undeparted shipment of the park, including
    // those of earlier models; departed and signed shipments stay as they happened.
    const superseded = this.list(model.siteId).filter(task => task.modelId !== model.id);
    for (const task of [...other, ...superseded].filter(task => task.status === 'planned')) {
      this.save({...task, status: 'cancelled', cancelledAt: adoptedAt});
      this.store.db.prepare('DELETE FROM simulation_eudr_allocations WHERE shipment_id=?').run(task.id);
    }
    const park = parkSite(model.siteId);
    return scenario.daily.filter(day => day.soldKg > 0).map(day => {
      const old = existing.find(task => task.scenarioId === scenario.id && task.day === day.day);
      if (old && old.status !== 'cancelled') return old;
      // Re-selecting a previously cancelled plan must not revive its old source reservation.
      if (old) this.store.db.prepare('DELETE FROM simulation_eudr_allocations WHERE shipment_id=?').run(old.id);
      return this.save({
        id: `shipment-${model.id}-${scenario.id}-${day.day}`,
        siteId: model.siteId, modelId: model.id, scenarioId: scenario.id, scenarioName: scenario.name,
        day: day.day, plannedDepartureAt: day.at, plannedKg: day.soldKg,
        priceCnyPerKg: day.priceCnyPerKg, plannedRevenueCny: money(day.revenueCny),
        buyer: {id: `buyer-${park.key}`, name: `${park.name}示例采购商`},
        status: 'planned', createdAt: adoptedAt, mode: 'simulation',
      });
    });
  }

  advance(id, input) {
    const siteId = normalizeSiteId(input.siteId);
    return this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT body FROM simulation_sales_shipments WHERE id=? AND site_id=?').get(id, siteId);
      invariant(row, 'NOT_FOUND', '当前园区没有该销售出货任务', 404);
      const task = JSON.parse(row.body), at = this.clock().toISOString();
      invariant(task.status !== 'cancelled', 'SHIPMENT_CANCELLED', '此出货安排已由新的销售方案替换', 409);
      if (task.status === 'received') return task;
      if (task.status === 'planned') {
        // Departures follow the plan's day order; demos may run ahead of the calendar, not out of sequence.
        const earlier = this.list(siteId, task.modelId).filter(other => other.scenarioId === task.scenarioId
          && other.day < task.day && other.status === 'planned').sort((a, b) => a.day - b.day)[0];
        invariant(!earlier, 'SHIPMENT_OUT_OF_ORDER', `请先发出第 ${earlier?.day} 天的出货单，再发第 ${task.day} 天。`, 409);
        const inventory = this.inventory(siteId);
        invariant(kg(task.plannedKg) <= inventory.availableKg, 'INSUFFICIENT_SALES_STOCK',
          `当前可用干胶 ${inventory.availableKg} kg，本批计划出货 ${kg(task.plannedKg)} kg。请调整销售安排或补充库存后再发车。`, 409);
        return this.save({...task, status: 'in-transit', departureAt: at});
      }
      return this.save({...task, status: 'received', receipt: {
        at, receivedKg: task.plannedKg, priceCnyPerKg: task.priceCnyPerKg,
        revenueCny: money(task.plannedKg * task.priceCnyPerKg),
        note: '模拟采购商已按计划数量签收干胶，按本批模拟报价回传销售金额。',
        mode: 'simulation',
      }});
    });
  }
}
