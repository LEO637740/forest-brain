import { invariant } from './errors.js';
import { normalizeSiteId, parkSite } from './adapters/park-demo.js';
import { digest } from './util.js';
import { collectionPointSamples } from '../../frontend/src/workspace/collectionPointData.ts';
import { collectionSource, collectionIssue, batchActionIssue } from '../../shared/logistics.ts';

function requiredSite(value) {
  invariant(typeof value === 'string' && value.trim(), 'INVALID_LOGISTICS_INPUT', '请选择批次所属园区');
  try { return normalizeSiteId(value); }
  catch { invariant(false, 'INVALID_LOGISTICS_INPUT', '园区标识无效'); }
}

function text(value, label, limit = 1000) {
  invariant(typeof value === 'string' && value.trim() && value.length <= limit,
    'INVALID_LOGISTICS_INPUT', `请填写${label}（最多 ${limit} 字）`);
  return value.trim();
}

function number(value, label, minimum, maximum = 1_000_000) {
  invariant(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum,
    'INVALID_LOGISTICS_INPUT', `${label}须在 ${minimum}–${maximum} 之间`);
  return value;
}

const kg = value => Math.round(value * 1000) / 1000;

function requestId(value) {
  invariant(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value),
    'INVALID_LOGISTICS_INPUT', '需要有效的操作请求编号');
  return value;
}

function place(siteId, id, kind) {
  const result = collectionPointSamples[parkSite(siteId).key].find(point => point.id === id && point.kind === kind);
  invariant(result, 'INVALID_LOGISTICS_INPUT', `请选择当前园区的${kind}`);
  return result;
}

// Local simulated business facts are independent of upstream execution receipts.
export class LogisticsWorkflow {
  constructor(store, clock, simulation) {
    this.store = store; this.clock = clock; this.simulation = simulation;
    store.db.exec(`CREATE TABLE IF NOT EXISTS simulation_logistics_batches (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS logistics_batches_by_site ON simulation_logistics_batches(site_id);
    CREATE TABLE IF NOT EXISTS simulation_logistics_requests (
      request_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES simulation_logistics_batches(id), hash TEXT NOT NULL
    )`);
  }

  list(siteId = null) {
    const scope = siteId === null ? null : requiredSite(siteId);
    return this.store.db.prepare('SELECT body FROM simulation_logistics_batches WHERE (? IS NULL OR site_id=?) ORDER BY rowid DESC')
      .all(scope, scope).map(row => JSON.parse(row.body));
  }

  get(id, siteId) {
    const row = this.store.db.prepare('SELECT body FROM simulation_logistics_batches WHERE id=? AND site_id=?').get(id, siteId);
    invariant(row, 'NOT_FOUND', '当前园区没有该收胶批次', 404);
    return JSON.parse(row.body);
  }

  previousRequest(id, hash, siteId) {
    const old = this.store.db.prepare('SELECT * FROM simulation_logistics_requests WHERE request_id=?').get(id);
    if (!old) return null;
    const batch = this.get(old.batch_id, siteId);
    invariant(old.hash === hash, 'LOGISTICS_REQUEST_CONFLICT', '同一请求编号不能提交不同的业务事实', 409);
    return batch;
  }

  save(batch, id, hash) {
    this.store.db.prepare('UPDATE simulation_logistics_batches SET body=? WHERE id=?').run(JSON.stringify(batch), batch.id);
    this.store.db.prepare('INSERT INTO simulation_logistics_requests VALUES(?,?,?)').run(id, batch.id, hash);
    return batch;
  }

  create(input) {
    const id = requestId(input?.requestId), siteId = requiredSite(input?.siteId);
    const operator = text(input.operator, '经办人', 100), note = text(input.note, '收胶说明');
    const hash = digest({...input,siteId,action:'collect'});
    return this.store.transaction(() => {
      const retry = this.previousRequest(id, hash, siteId);
      if (retry) return retry;
      const task = this.simulation.latestTasks(siteId).find(task => task.id === input.taskId);
      invariant(task, 'NOT_FOUND', '当前园区没有该割胶任务', 404);
      const batches = this.list(siteId);
      invariant(!batches.some(batch => batch.source.taskId === task.id), 'LOGISTICS_ALREADY_COLLECTED',
        '此割胶任务已登记收胶批次，请查看原批次', 409);
      const issue = collectionIssue(task, this.simulation.operationalEvents.list(siteId));
      invariant(!issue, 'LOGISTICS_SOURCE_INVALID', issue, 409);
      const source = collectionSource(task);
      const point = place(siteId, input.collectionPointId, '收胶点');
      const containerCount = number(input.containerCount, '收胶容器数', 1, 10_000);
      invariant(Number.isInteger(containerCount), 'INVALID_LOGISTICS_INPUT', '收胶容器数须为正整数');
      const record = {id:`record-${id}`,at:this.clock().toISOString(),operator,note};
      const batch = {id:`batch-${id}`,siteId,revision:1,stage:'collected',mode:'simulation',source,
        collection:{...record,point:{id:point.id,name:point.name},containerCount},
        inspections:[],history:[{...record,action:'collect',requestId:id}]};
      this.store.db.prepare('INSERT INTO simulation_logistics_batches VALUES(?,?,?,?)')
        .run(batch.id, siteId, task.id, JSON.stringify(batch));
      this.store.db.prepare('INSERT INTO simulation_logistics_requests VALUES(?,?,?)').run(id, batch.id, hash);
      return batch;
    });
  }

  transition(batchId, action, input) {
    const id = requestId(input?.requestId), siteId = requiredSite(input?.siteId);
    const operator = text(input.operator, '经办人', 100), note = text(input.note, '操作说明');
    const hash = digest({...input,siteId,action,batchId});
    return this.store.transaction(() => {
      const batch = this.get(batchId, siteId);
      const retry = this.previousRequest(id, hash, siteId);
      if (retry) return retry;
      invariant(Number.isInteger(input.revision) && input.revision === batch.revision,
        'LOGISTICS_REVISION_CONFLICT', '批次已有更新，请查看服务器最新记录后再操作', 409);
      invariant(['weigh','inspect','hold','plan','dispatch','receive','start-processing','process','pause','resume','cancel'].includes(action),
        'INVALID_LOGISTICS_INPUT', '业务操作无效');
      const issue = batchActionIssue(batch, action, this.simulation.operationalEvents.list(siteId));
      invariant(!issue, 'LOGISTICS_STATE_CONFLICT', issue, 409);
      const record = {id:`record-${id}`,at:this.clock().toISOString(),operator,note};
      const next = {...batch,revision:batch.revision + 1,
        history:[...batch.history,{...record,action,requestId:id}]};
      if (action === 'weigh') {
        const grossKg = kg(number(input.grossKg, '毛重（kg 鲜胶乳）', 0));
        const tareKg = kg(number(input.tareKg, '皮重（kg）', 0));
        invariant(grossKg > tareKg, 'INVALID_LOGISTICS_INPUT', '毛重须大于皮重，净重须大于 0');
        next.weighing = {...record,grossKg,tareKg,netKg:kg(grossKg - tareKg)};
        next.stage = 'weighed';
      } else if (action === 'inspect') {
        const sampleId = text(input.sampleId, '样品编号', 100);
        const dryRubberPercent = number(input.dryRubberPercent, '干胶含量（%）', 0, 100);
        invariant(dryRubberPercent > 0 && ['pass','hold'].includes(input.decision),
          'INVALID_LOGISTICS_INPUT', '干胶含量须大于 0，且须明确人工质检判定');
        invariant(input.grade === undefined || ['A','B'].includes(input.grade), 'INVALID_LOGISTICS_INPUT', '演示品级须为 A 或 B');
        next.inspections = [...batch.inspections,{...record,sampleId,dryRubberPercent,decision:input.decision,
          ...(input.decision === 'pass' && input.grade ? {grade:input.grade} : {})}];
        next.stage = input.decision === 'pass' ? batch.qualityHold?.resumeStage ?? 'ready' : 'quality-held';
        if (input.decision === 'pass') delete next.qualityHold;
      } else if (action === 'hold') {
        next.qualityHold = {...record,resumeStage:batch.stage};
        next.stage = 'quality-held';
      } else if (action === 'plan') {
        const destination = place(siteId, input.destinationId, '加工厂');
        const vehicleCode = text(input.vehicleCode, '车辆编号', 100), driver = text(input.driver, '驾驶员', 100);
        invariant(typeof input.plannedDepartureAt === 'string' && Number.isFinite(Date.parse(input.plannedDepartureAt)),
          'INVALID_LOGISTICS_INPUT', '请填写有效的计划发车时间');
        next.transport = {...record,destination:{id:destination.id,name:destination.name},vehicleCode,driver,
          plannedDepartureAt:new Date(input.plannedDepartureAt).toISOString(),plannedKg:batch.weighing.netKg};
        next.stage = 'planned';
      } else if (action === 'dispatch') {
        next.transport = {...batch.transport,departure:record};
        next.stage = 'in-transit';
      } else if (action === 'receive') {
        const receivedKg = kg(number(input.receivedKg, '实收重量（kg 鲜胶乳）', 0));
        next.transport = {...batch.transport,receipt:{...record,receivedKg,differenceKg:kg(receivedKg - batch.weighing.netKg)}};
        next.stage = 'received';
      } else if (action === 'start-processing') {
        next.processingStarted = record;
        next.stage = 'processing';
      } else if (action === 'process') {
        const inspection = batch.inspections.filter(item => item.decision === 'pass').at(-1);
        const latexKg = batch.transport.receipt.receivedKg;
        const theoreticalDryKg = kg(latexKg * inspection.dryRubberPercent / 100);
        const processLossKg = kg(number(input.processLossKg ?? 0, '加工损耗（kg 干胶）', 0, theoreticalDryKg));
        next.processing = {...record,latexKg,dryRubberPercent:inspection.dryRubberPercent,
          theoreticalDryKg,processLossKg,dryKg:kg(theoreticalDryKg - processLossKg),inspectionId:inspection.id,
          ...(inspection.grade ? {grade:inspection.grade} : {})};
        next.stage = 'processed';
      } else if (action === 'pause') next.manualHold = record;
      else if (action === 'resume') delete next.manualHold;
      else if (action === 'cancel') next.stage = 'cancelled';
      return this.save(next, id, hash);
    });
  }
}
