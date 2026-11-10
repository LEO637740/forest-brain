import { invariant } from './errors.js';
import { normalizeSiteId } from './adapters/park-demo.js';
import { digest } from './util.js';

function requiredSite(value) {
  invariant(typeof value === 'string' && value.trim(), 'INVALID_SITE', '请选择事件所属园区');
  try { return normalizeSiteId(value); }
  catch { invariant(false, 'INVALID_SITE', '园区标识无效'); }
}

function noteText(value) {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= 1000,
    'INVALID_EVENT_NOTE', '请填写 1–1000 字的情况说明');
  return value.trim();
}

/** Explicit operational facts, separate from forecasts and adopted strategies. */
export class OperationalEvents {
  constructor(store, clock) {
    this.store = store;
    this.clock = clock;
    store.db.exec(`CREATE TABLE IF NOT EXISTS simulation_operational_events (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, body TEXT NOT NULL
    )`);
    store.db.exec('CREATE INDEX IF NOT EXISTS operational_events_by_site ON simulation_operational_events(site_id)');
  }

  list(siteId = null) {
    const scope = siteId === null ? null : requiredSite(siteId);
    return this.store.db.prepare('SELECT body FROM simulation_operational_events WHERE (? IS NULL OR site_id=?) ORDER BY rowid DESC')
      .all(scope, scope).map(row => JSON.parse(row.body));
  }

  create(input) {
    invariant(input && typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId),
      'INVALID_EVENT', '需要有效的事件请求编号');
    const siteId = requiredSite(input.siteId);
    invariant(['rain', 'device_fault'].includes(input.kind), 'INVALID_EVENT', '请选择降雨或设备故障');
    const zone = input.zone ?? null;
    invariant(zone === null && input.kind === 'rain' || Number.isInteger(zone) && zone >= 0 && zone <= 3,
      'INVALID_EVENT_ZONE', '设备故障须指定 A–D 区；降雨可选择全园');
    const facts = {siteId, kind: input.kind, zone, note: noteText(input.note)};
    const id = `event-${input.requestId}`;
    const old = this.store.db.prepare('SELECT body FROM simulation_operational_events WHERE id=?').get(id);
    if (old) {
      const event = JSON.parse(old.body);
      const previous = {siteId:event.siteId,kind:event.kind,zone:event.zone,note:event.note};
      invariant(digest(previous) === digest(facts), 'EVENT_CONFLICT', '同一请求编号不能登记不同事件', 409);
      return event;
    }
    const event = {id, ...facts, status:'active', createdAt:this.clock().toISOString(), mode:'simulation'};
    this.store.db.prepare('INSERT INTO simulation_operational_events VALUES(?,?,?)').run(id, siteId, JSON.stringify(event));
    return event;
  }

  transition(id, action, input) {
    const siteId = requiredSite(input?.siteId), note = noteText(input?.note);
    const row = this.store.db.prepare('SELECT body FROM simulation_operational_events WHERE id=? AND site_id=?').get(id, siteId);
    invariant(row, 'NOT_FOUND', '当前园区没有该事件', 404);
    const event = JSON.parse(row.body);
    const resolving = action === 'resolve';
    const noteKey = resolving ? 'resolutionNote' : 'resumeNote';
    // A retry returns the current record, including a later closed state; it
    // never reopens an event or changes the original transition evidence.
    if (event[noteKey] !== undefined) {
      invariant(event[noteKey] === note, 'EVENT_ACTION_CONFLICT', '该操作已记录，不能改写原说明', 409);
      return event;
    }
    invariant(resolving ? event.status === 'active' : event.status === 'resolved', 'EVENT_STATE_CONFLICT',
      resolving ? '只能解除仍在生效的异常' : '请先登记异常解除，再确认恢复条件', 409);
    const next = {...event, status:resolving ? 'resolved' : 'closed', [noteKey]:note,
      [resolving ? 'resolvedAt' : 'closedAt']:this.clock().toISOString()};
    this.store.db.prepare('UPDATE simulation_operational_events SET body=? WHERE id=?').run(JSON.stringify(next), id);
    return next;
  }

  blockingForTree(siteId, treeId) {
    const zone = Math.floor((Number(treeId.slice(2)) - 1) / 50);
    return this.list(siteId).filter(event => event.status !== 'closed' && (event.zone === null || event.zone === zone));
  }
}

export function operationalEventReason(event) {
  const scope = event.zone === null ? '全园' : `${'ABCD'[event.zone]}区`;
  const kind = event.kind === 'rain' ? '降雨' : '设备故障';
  return `${scope}${kind}：${event.note}${event.status === 'resolved' ? '；异常已解除，等待人工确认恢复条件' : '；作业暂缓'}`;
}
