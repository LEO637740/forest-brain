import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {normalizeSiteId,parkSite} from './adapters/park-demo.js';

// Market and policy events the price-factor check cannot fetch on its own
// (state reserve releases, export limits, tariffs, typhoon warnings...).
// Anyone running a park may propose one, by form or in conversation; only the
// center approves it, and only approved, unexpired events reach the brain.
export const MARKET_EVENT_KINDS = Object.freeze({
  reserve_release:{label:'国家储备投放（抛储）', factor:'policy', direction:'bearish', scenarioId:'policy_supply'},
  reserve_purchase:{label:'国家收储', factor:'policy', direction:'bullish', scenarioId:null},
  export_restriction:{label:'主产国限制出口', factor:'policy', direction:'bullish', scenarioId:null},
  import_easing:{label:'放宽进口或下调关税', factor:'policy', direction:'bearish', scenarioId:'policy_supply'},
  demand_drop:{label:'下游需求下滑（汽车、轮胎减产）', factor:'demand', direction:'bearish', scenarioId:'demand_weak'},
  disaster_warning:{label:'台风、洪水等灾害预警', factor:'natural_hazard', direction:'bullish', scenarioId:'typhoon'},
});
const DAY = 86400000;
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');

export class MarketEventService {
  constructor({store, clock = () => new Date()}) {
    Object.assign(this, {store, clock});
    store.db.exec(`CREATE TABLE IF NOT EXISTS market_events (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
  }
  get(id) {
    const row = this.store.db.prepare('SELECT body FROM market_events WHERE id=?').get(id);
    invariant(row, 'EVENT_NOT_FOUND', '事件不存在。', 404);
    return JSON.parse(row.body);
  }
  save(event) {
    this.store.db.prepare(`INSERT INTO market_events VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body`)
      .run(event.id, event.status, JSON.stringify(event), event.createdAt);
    return event;
  }
  today() { return new Date(+this.clock() + 8 * 3600000).toISOString().slice(0, 10); }
  /** Events visible to a park: national ones plus those naming the park. */
  list(siteId = null, {includeClosed = true} = {}) {
    const scope = siteId ? normalizeSiteId(siteId) : null, today = this.today();
    return this.store.db.prepare('SELECT body FROM market_events ORDER BY created_at DESC,rowid DESC').all().map(row => JSON.parse(row.body))
      .map(event => event.status === 'active' && event.effectiveTo < today ? {...event, status:'expired'} : event)
      .filter(event => !scope || event.siteIds === 'all' || event.siteIds.includes(scope))
      .filter(event => includeClosed || ['pending', 'active'].includes(event.status));
  }
  /** Approved events in force today; the only ones the price-factor check reads. */
  active(siteId) {
    const today = this.today();
    return this.list(siteId).filter(event => event.status === 'active' && event.effectiveFrom <= today && event.effectiveTo >= today);
  }
  propose({kind, title, siteIds = 'all', effectiveFrom, effectiveTo, source = '', note = ''}, identity = null) {
    identity?.require('market_events.propose', '只有园区管理或中心可以登记市场与政策事件。');
    const spec = MARKET_EVENT_KINDS[kind];
    invariant(spec, 'INVALID_EVENT', '请选择事件类型。');
    invariant(typeof title === 'string' && title.trim().length >= 4 && title.length <= 80, 'INVALID_EVENT', '事件标题需要 4–80 字。');
    const from = dateOnly(effectiveFrom) ? effectiveFrom : this.today();
    const to = dateOnly(effectiveTo) ? effectiveTo : new Date(Date.parse(`${from}T00:00:00Z`) + 30 * DAY).toISOString().slice(0, 10);
    invariant(to >= from && Date.parse(to) - Date.parse(from) <= 180 * DAY, 'INVALID_EVENT', '生效期需在 180 天以内，且结束不早于开始。');
    const parks = siteIds === 'all' ? 'all' : [...new Set((Array.isArray(siteIds) ? siteIds : [siteIds]).map(normalizeSiteId))];
    invariant(parks === 'all' || parks.length, 'INVALID_EVENT', '请选择适用园区。');
    if (identity && parks !== 'all') parks.forEach(siteId => identity.requireSite(siteId));
    invariant(!identity || parks !== 'all' || identity.role === 'executive' || identity.role === 'manager', 'FORBIDDEN', '当前身份不能登记全国事件。', 403);
    const now = this.clock().toISOString();
    return this.save({id:`mevent-${randomUUID()}`, kind, kindLabel:spec.label, factor:spec.factor, direction:spec.direction, scenarioId:spec.scenarioId,
      title:title.trim(), siteIds:parks, effectiveFrom:from, effectiveTo:to, source:String(source).trim().slice(0, 300), note:String(note).trim().slice(0, 300),
      status:'pending', proposedBy:identity?.accountId ?? 'local-tool', createdAt:now,
      parkNames:parks === 'all' ? '全部园区' : parks.map(siteId => parkSite(siteId).name).join('、')});
  }
  decide(id, {decision, note = ''}, identity = null) {
    identity?.require('market_events.approve', '只有中心可以审批市场与政策事件。');
    invariant(['approve', 'reject', 'withdraw'].includes(decision), 'INVALID_DECISION', '请选择批准、驳回或撤销。');
    const event = this.get(id);
    if (decision === 'withdraw') invariant(event.status === 'active', 'EVENT_DECIDED', '只有生效中的事件可以撤销。', 409);
    else invariant(event.status === 'pending', 'EVENT_DECIDED', '该事件已处理，请刷新后查看。', 409);
    if (decision === 'approve') invariant(event.source || String(note).trim(), 'EVENT_SOURCE_REQUIRED', '批准前需要信息来源（公告链接或文号），可在审批说明中补充。', 409);
    const now = this.clock().toISOString();
    return this.save({...event, status:{approve:'active', reject:'rejected', withdraw:'withdrawn'}[decision], decidedAt:now,
      decidedBy:identity?.accountId ?? 'local-tool', decisionNote:String(note).trim().slice(0, 300)});
  }
}
