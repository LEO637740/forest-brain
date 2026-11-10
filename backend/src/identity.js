import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {normalizeSiteId,parkSite,PARK_SITES,TREE_IDS} from './adapters/park-demo.js';

// Demo identities for the role split requested in the 2026-10-11 meeting:
// a grower who contracts one mu (about 33 trees), a farm/company manager who
// runs the whole park including storage, grading and sales, a robot operator,
// and the center (Hangzhou data / cloud-brain center) that sees every park.
// Authentication is a demo login without passwords; the data scope and the
// permissions below are nevertheless enforced on the server for every request
// that carries a session, so changing the UI cannot widen what an account sees.
const ALL_SITES = Object.keys(PARK_SITES);
const plotTrees = (first, count) => TREE_IDS.slice(first - 1, first - 1 + count);

export const ROLE_LABELS = Object.freeze({grower:'胶农', manager:'农场管理', operator:'机器人运营', executive:'中心管理'});

export const PERMISSIONS = Object.freeze({
  grower: ['plot.read','assistant.use','memory.private.write'],
  manager: ['site.read','assistant.use','memory.private.write','memory.park.write','tasks.write','events.write','logistics.write',
    'sales.write','market.write','strategy.adopt','park_plan.write','cerebellum.propose','cerebellum.approve','field.import','reviews.write','market_events.propose'],
  operator: ['site.read','assistant.use','memory.private.write','tasks.write','events.write','strategy.adopt','reviews.write'],
  executive: ['site.read','assistant.use','memory.private.write','memory.park.write','memory.public.write','cerebellum.propose','cerebellum.approve',
    'market_events.propose','market_events.approve'],
});

export const ACCOUNTS = Object.freeze([
  {accountId:'grower-hn-wang', name:'王师傅', title:'海南海口园区 · 胶农', role:'grower', siteIds:['demo-hainan'],
    plot:{siteId:'demo-hainan', zone:'B', label:'B区承包地 1 亩（33 棵）', areaMu:1, treeIds:plotTrees(51,33)},
    summary:'只看自己承包的 33 棵树：养护、割胶结果、收胶点报价和这亩地卖了多少。'},
  {accountId:'grower-xs-yan', name:'岩罕', title:'云南景洪园区 · 胶农', role:'grower', siteIds:['demo-xsbn'],
    plot:{siteId:'demo-xsbn', zone:'A', label:'A区承包地 1 亩（33 棵）', areaMu:1, treeIds:plotTrees(1,33)},
    summary:'只看自己承包的 33 棵树：养护、割胶结果、收胶点报价和这亩地卖了多少。'},
  {accountId:'manager-hn', name:'海口园区管理', title:'海南海口模拟园区 · 农场管理', role:'manager', siteIds:['demo-hainan'],
    summary:'负责全园 200 棵树：割胶强度、储运分级、库存销售与参数审批。'},
  {accountId:'manager-xs', name:'景洪园区管理', title:'云南景洪模拟园区 · 农场管理', role:'manager', siteIds:['demo-xsbn'],
    summary:'负责全园 200 棵树：割胶强度、储运分级、库存销售与参数审批。'},
  {accountId:'manager-gd', name:'茂名园区管理', title:'广东茂名模拟园区 · 农场管理', role:'manager', siteIds:['demo-guangdong-maoming'],
    summary:'负责全园 200 棵树：割胶强度、储运分级、库存销售与参数审批。'},
  {accountId:'operator-hn', name:'海口机器人运营', title:'海南海口模拟园区 · 机器人运营', role:'operator', siteIds:['demo-hainan'],
    summary:'负责 A–D 区机器人：派发、暂停恢复、天气与设备故障处置；不处理销售。'},
  {accountId:'center-hz', name:'杭州数据与云脑中心', title:'中心管理 · 全部园区', role:'executive', siteIds:ALL_SITES,
    summary:'跨园区比较生产与执行，审批小脑参数和公共经验；不直接操作园区作业。'},
]);

const SESSION_HOURS = 12;
const publicAccount = account => {
  const {plot,...rest} = account;
  return {...rest, roleLabel:ROLE_LABELS[account.role], permissions:PERMISSIONS[account.role],
    ...(plot?{plot:{...plot,treeCount:plot.treeIds.length}}:{})};
};

export class IdentityService {
  constructor(store, clock = () => new Date()) {
    this.store = store; this.clock = clock;
    store.db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`);
  }
  accounts() { return ACCOUNTS.map(publicAccount); }
  account(accountId) {
    const account = ACCOUNTS.find(item => item.accountId === accountId);
    invariant(account, 'ACCOUNT_NOT_FOUND', '演示身份不存在，请重新选择。', 404);
    return account;
  }
  login({accountId}) {
    const account = this.account(accountId);
    const now = this.clock(), token = `rs-${randomUUID()}`;
    const expiresAt = new Date(+now + SESSION_HOURS * 3600000).toISOString();
    this.store.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(token, account.accountId, now.toISOString(), expiresAt);
    return {token, expiresAt, account:publicAccount(account), authentication:'demo_identity_without_password'};
  }
  logout(token) { if (token) this.store.db.prepare('DELETE FROM auth_sessions WHERE token=?').run(token); return {loggedOut:true}; }
  /** Returns null when no session header was sent; throws when one was sent but is not valid. */
  resolve(token) {
    if (!token) return null;
    const row = this.store.db.prepare('SELECT account_id,expires_at FROM auth_sessions WHERE token=?').get(token);
    invariant(row && Date.parse(row.expires_at) > +this.clock(), 'SESSION_EXPIRED', '登录身份已失效，请重新选择身份。', 401);
    return new Identity(this.account(row.account_id), token);
  }
}

export class Identity {
  constructor(account, token = null) {
    this.account = account; this.token = token;
    this.accountId = account.accountId; this.role = account.role;
    this.siteIds = account.siteIds.map(site => normalizeSiteId(site));
    this.plot = account.plot ? {...account.plot, siteId:normalizeSiteId(account.plot.siteId)} : null;
  }
  get publicAccount() { return publicAccount(this.account); }
  can(permission) { return PERMISSIONS[this.role].includes(permission); }
  require(permission, message) {
    invariant(this.can(permission), 'FORBIDDEN', message ?? `${ROLE_LABELS[this.role]}身份无权执行此操作。`, 403);
    return this;
  }
  seesSite(siteId) {
    try { return this.siteIds.includes(normalizeSiteId(siteId)); } catch { return false; }
  }
  requireSite(siteId) {
    invariant(this.seesSite(siteId), 'FORBIDDEN_SITE', `当前身份不能查看${(() => { try { return parkSite(siteId).name; } catch { return '该园区'; } })()}的数据。`, 403);
    return normalizeSiteId(siteId);
  }
  /** Trees this identity may see in one park: the contracted plot for growers, the whole park otherwise. */
  treeIds(siteId) {
    const site = this.requireSite(siteId);
    if (this.plot) return this.plot.siteId === site ? this.plot.treeIds : [];
    return TREE_IDS;
  }
  seesTree(siteId, treeId) { return this.seesSite(siteId) && this.treeIds(siteId).includes(treeId); }
  requireTree(siteId, treeId) {
    invariant(this.seesTree(siteId, treeId), 'FORBIDDEN_TREE', '这棵树不在你的承包范围内。', 403);
    return treeId;
  }
  /** Task/batch visibility. A grower sees park tasks only when they touch the contracted plot. */
  seesTask(task) {
    const siteId = task.siteId ?? (task.site ? `demo-${task.site}` : null);
    if (!siteId || !this.seesSite(siteId)) return false;
    if (!this.plot) return true;
    const indices = new Set(this.plot.treeIds.map(id => Number(id.slice(2)) - 1));
    return (task.treeIndices ?? []).some(index => indices.has(index));
  }
}
