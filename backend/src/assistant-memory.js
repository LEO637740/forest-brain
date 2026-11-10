import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {Identity} from './identity.js';
import {normalizeSiteId} from './adapters/park-demo.js';

export const ASSISTANT_SKILLS = [
  {id:'daily_plan',title:'当日安排',instruction:'读取当前园区、天气与任务。说明先做什么、哪些对象仍需处理，并给出已有任务入口。'},
  {id:'weather_replan',title:'天气重排',instruction:'结合当前天气、影响分区与未完成任务，提出调整顺序；保留已完成部分，说明恢复后的下一步。'},
  {id:'execution_review',title:'执行复盘',instruction:'核对任务、策略采用、逐树回执与收胶批次。区分任务进度、有效完成回执与实际登记重量。'},
];

export function marketParameters(message) {
  const result = {};
  const quantity = '\\s*(?:改为|改成|调整为|调到|是|为|到)?\\s*(\\d+(?:\\.\\d+)?)\\s*(吨|公斤|千克|kg)?';
  const patterns = {stockKg:new RegExp('(?<!冻结)库存'+quantity,'i'),
    storageKg:new RegExp('仓容'+quantity,'i'),
    heldKg:new RegExp('冻结(?:库存|量)?'+quantity,'i'),
    transportKgPerDay:new RegExp('运力'+quantity,'i'),
    careLimit:/每周(?:最多|至多)?\s*([0-3])\s*次/};
  for (const [key,pattern] of Object.entries(patterns)) {
    const match = message.match(pattern);
    if (match) result[key] = Number(match[1])*(match[2]==='吨'?1000:1);
  }
  return result;
}

export const inventoryParameters = parameters => Object.fromEntries(['stockKg','heldKg']
  .filter(key=>parameters?.[key]!==undefined).map(key=>[key,parameters[key]]));

export function latestInventoryRequested(message) {
  if (/(?:取消|退出|不用|不(?:再)?使用).*假设/.test(message)) return true;
  if (/假设|假定/.test(message)||Object.keys(inventoryParameters(marketParameters(message))).length) return false;
  return /(?:最新|当前|实际|现在|账本).*(?:库存|情况|测算|销售)|(?:库存|冻结量).*(?:最新|实际|账本)|(?:复盘|加工|入库|发车|签收).*(?:库存|销售|怎么卖)/.test(message);
}

const marketCondition = (key,value) => ({
  stockKg:`库存${value}公斤`,storageKg:`仓容${value}公斤`,heldKg:`冻结库存${value}公斤`,
  transportKgPerDay:`每天运力${value}公斤`,careLimit:`每周最多${value}次`,
})[key];

/** Only the user's explicit instruction becomes a preference; model prose is not evidence. */
export function explicitPreference(message) {
  if (/(?:不要|不用|别|无需)(?:再)?(?:帮我)?(?:记住|记下|保存)/.test(message)) return null;
  if (/(?:按|根据|照)(?:之前|以前|刚才)?(?:记住|记下)|记住的|记下的/.test(message)
      && !/(?:请|帮我)(?:再)?记住/.test(message)) return null;
  const match = message.match(/(?:请记住|帮我记住|记住|记下|我的偏好是|更新(?:我的)?偏好[：:\s]*|(?:把|将)(?:我的)?偏好(?:改成|改为)|以后(?:请)?(?:默认|优先))\s*[：:,，]?\s*(.+)/);
  if (!match) return null;
  const content = /^以后/.test(match[0]) ? match[0] : match[1];
  const topic = /销售|卖|囤|现金|库存|报价|运力|仓容/.test(content) ? 'sales'
    : /[A-D]\s*区|分区|地块/.test(content) ? 'zone'
    : /雨|天气|湿/.test(content) ? 'weather' : 'planning';
  return {topic,content:content.trim()};
}

export const MEMORY_SCOPES = Object.freeze({
  shared:'公共记忆（全部园区）', park:'园区记忆（本园区共享）', role:'演示角色偏好（未登录）', private:'个人记忆（仅本人）',
});
/** A preference is personal: account-private when signed in, demo-role scoped otherwise. */
export const isPreference = item => item.scope === 'role' || item.scope === 'private';
const HISTORY_LIMIT = 5;
const words = query => query.trim().toLowerCase().split(/[\s，,。；;、]+/).filter(Boolean);
const builtInKnowledge = item => ASSISTANT_SKILLS.find(skill => item.id===`knowledge-${skill.id}`
  && item.scope==='shared' && item.siteId===null && item.role===null && !item.accountId
  && item.topic===skill.id && item.title===skill.title && item.content===skill.instruction
  && JSON.stringify(item.sourceRefs)===JSON.stringify([`workflow:${skill.id}`]));
const safeKnowledge = item => {
  const skill=builtInKnowledge(item);
  return skill ? {id:`knowledge-${skill.id}`,siteId:null,role:null,scope:'shared',topic:skill.id,
    title:skill.title,content:skill.instruction,sourceRefs:[`workflow:${skill.id}`],
    updatedAt:item.updatedAt,useCount:Number.isFinite(item.useCount)?item.useCount:0} : item;
};
const privateTreeScope = (identity,siteId) => identity.plot ? [...identity.treeIds(siteId)].sort() : null;
const memoryReadAccess = (scope,siteId,identity=null) => scope==='park'
  ? {version:1,roles:['manager','executive'],siteId:normalizeSiteId(siteId)}
  : scope==='shared' ? {version:1,roles:['grower','operator','manager','executive'],siteId:null}
    : scope==='private' && identity ? {version:1,roles:[identity.role],siteId:normalizeSiteId(siteId),
      accountId:identity.accountId,treeIds:privateTreeScope(identity,siteId)} : undefined;

function memoryIdentity({siteId,role,accountId=null,identity=null}) {
  if (!identity) {
    invariant(!accountId,'LOGIN_REQUIRED','读取个人记忆需要当前登录身份。',401);
    return null;
  }
  invariant(identity instanceof Identity && (!accountId || accountId===identity.accountId)
    && (!role || role===identity.role),'FORBIDDEN_MEMORY','记忆身份与当前账号不一致。',403);
  identity.require('assistant.use');
  identity.requireSite(siteId);
  return identity;
}

// Hermes-style layered memory: public lessons and workflows, park-shared
// experience, and private notes of one account.  Memories are versioned,
// usage-tracked and can be searched, edited and archived through audited
// tools; the model reads them as data, never as instructions.
export class AssistantMemory {
  constructor(store, clock = () => new Date()) {
    this.store = store; this.clock = clock;
    store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_memories (
      id TEXT PRIMARY KEY, site_id TEXT, role TEXT, scope TEXT NOT NULL, topic TEXT NOT NULL,
      body TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    for (const skill of ASSISTANT_SKILLS) {
      const item = {id:`knowledge-${skill.id}`,siteId:null,role:null,scope:'shared',topic:skill.id,
        title:skill.title,content:skill.instruction,sourceRefs:[`workflow:${skill.id}`],updatedAt:clock().toISOString()};
      store.db.prepare('INSERT OR IGNORE INTO assistant_memories VALUES(?,?,?,?,?,?,?)')
        .run(item.id,null,null,item.scope,item.topic,JSON.stringify(item),item.updatedAt);
    }
  }
  list({siteId,role,accountId=null,identity=null,query='',includeArchived=false} = {}) {
    identity=memoryIdentity({siteId,role,accountId,identity});
    if (identity) {siteId=normalizeSiteId(siteId);role=identity.role;accountId=identity.accountId;}
    const items = this.store.db.prepare(`SELECT body FROM assistant_memories
      WHERE scope='shared' OR (site_id=? AND (scope='park' OR (scope='role' AND role=? AND ? IS NULL)))
        OR (scope='private' AND site_id=? AND json_extract(body,'$.accountId')=?)
      ORDER BY updated_at DESC,rowid DESC`)
      .all(siteId ?? null,role ?? null,accountId,siteId ?? null,accountId).map(row=>JSON.parse(row.body))
      .filter(item=>(includeArchived || item.status!=='archived') && this.canRead(item,identity)).map(safeKnowledge);
    const terms = words(query);
    if (!terms.length) return items;
    // Rank by how many query words match, then recency (already ordered).
    return items.map(item=>({item,score:terms.filter(word=>`${item.title} ${item.content} ${item.topic}`.toLowerCase().includes(word)).length}))
      .filter(row=>row.score>0).sort((a,b)=>b.score-a.score).map(row=>row.item);
  }
  /** The center explicitly publishes shared experience for every park.
   * Unclassified legacy records retain their original visibility. */
  canRead(item, identity) {
    if (builtInKnowledge(item)) return true;
    if (!identity) return item.scope!=='private' && !item.accountId
      && (!item.createdBy || item.createdBy==='demo-role');
    const access=item.readAccess;
    if (access?.version!==1 || access.siteId!==item.siteId) return false;
    if (item.scope==='shared') return true;
    if (!access.roles?.includes(identity.role)) return false;
    if (item.scope==='private') return item.accountId===identity.accountId && access.accountId===identity.accountId
      && identity.seesSite(item.siteId) && JSON.stringify(access.treeIds)===JSON.stringify(privateTreeScope(identity,item.siteId));
    if (item.scope==='park') return ['manager','executive'].includes(identity.role) && identity.seesSite(item.siteId);
    return false;
  }
  get(id) {
    const row = this.store.db.prepare('SELECT body FROM assistant_memories WHERE id=?').get(id);
    invariant(row,'MEMORY_NOT_FOUND','记忆不存在或已被删除。',404);
    return JSON.parse(row.body);
  }
  save(item) {
    const next = {...item,updatedAt:this.clock().toISOString()};
    this.store.db.prepare(`INSERT INTO assistant_memories VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`)
      .run(next.id,next.siteId,next.role,next.scope,next.topic,JSON.stringify(next),next.updatedAt);
    return next;
  }
  /** Whether a signed-in identity may write a memory of this scope and park. */
  canWrite(item, identity) {
    if (!identity) return item.scope==='role';
    if (item.scope==='private') return this.canRead(item,identity) && item.accountId===identity.accountId && identity.can('memory.private.write') && identity.seesSite(item.siteId);
    if (item.scope==='park') return this.canRead(item,identity) && identity.can('memory.park.write') && identity.seesSite(item.siteId);
    if (item.scope==='shared') return this.canRead(item,identity) && identity.can('memory.public.write') && item.topic!=='daily_plan' && !item.id.startsWith('knowledge-');
    return false;
  }
  create({scope,topic='note',title,content,siteId,sourceRefs=[]}, identity, turnId=null) {
    invariant(MEMORY_SCOPES[scope] && scope!=='role','INVALID_MEMORY_SCOPE','记忆范围应为个人、园区或公共。');
    invariant(typeof content==='string'&&content.trim()&&content.length<=600,'INVALID_MEMORY','记忆内容需要 1–600 字。');
    const item = {id:`memory-${randomUUID()}`,siteId:scope==='shared'?null:normalizeSiteId(siteId),role:identity?.role??null,scope,topic,
      title:String(title||content).slice(0,40),content:content.trim(),accountId:scope==='private'?identity?.accountId:null,
      createdBy:identity?.accountId??'demo-role',sourceRefs:[...sourceRefs,...(turnId?[`turn:${turnId}`]:[])],useCount:0,history:[],
      readAccess:memoryReadAccess(scope,siteId,identity)};
    invariant(this.canWrite(item,identity),'FORBIDDEN_MEMORY',scope==='shared'?'只有中心可以写入公共记忆。':scope==='park'?'只有园区管理或中心可以写入园区记忆。':'不能写入他人的个人记忆。',403);
    return this.save(item);
  }
  edit(id,{content,title},identity,turnId=null) {
    const item = this.get(id);
    invariant(item.status!=='archived','MEMORY_ARCHIVED','该记忆已归档，不能修改。',409);
    invariant(this.canWrite(item,identity),'FORBIDDEN_MEMORY','当前身份不能修改这条记忆。',403);
    invariant(typeof content==='string'&&content.trim()&&content.length<=600,'INVALID_MEMORY','记忆内容需要 1–600 字。');
    const history = [{content:item.content,updatedAt:item.updatedAt,by:item.updatedBy??item.createdBy??null},...(item.history??[])].slice(0,HISTORY_LIMIT);
    return this.save({...item,content:content.trim(),marketParams:marketParameters(content),...(title?{title:String(title).slice(0,40)}:{}),history,
      updatedBy:identity?.accountId??'demo-role',sourceRefs:[...new Set([...(item.sourceRefs??[]),...(turnId?[`turn:${turnId}`]:[])])]});
  }
  archive(id,identity,reason='') {
    const item = this.get(id);
    invariant(this.canWrite(item,identity),'FORBIDDEN_MEMORY','当前身份不能删除这条记忆。',403);
    return this.save({...item,status:'archived',archivedAt:this.clock().toISOString(),archivedBy:identity?.accountId??'demo-role',archiveReason:String(reason).slice(0,200)});
  }
  touch(ids) {
    const at = this.clock().toISOString();
    for (const id of new Set(ids)) {
      const row = this.store.db.prepare('SELECT body FROM assistant_memories WHERE id=?').get(id);
      if (!row) continue;
      const item = JSON.parse(row.body);
      // Usage stats do not change updated_at, so recency still reflects content changes.
      this.store.db.prepare('UPDATE assistant_memories SET body=? WHERE id=?').run(JSON.stringify({...item,useCount:(item.useCount??0)+1,lastUsedAt:at}),id);
    }
  }
  rememberPreference(session, message, turnId, identity=null) {
    memoryIdentity({...session,identity});
    const preference = explicitPreference(message);
    invariant(preference,'MEMORY_INSTRUCTION_REQUIRED','请明确说“记住……”或“把我的偏好改为……”，再保存偏好。');
    const scope = session.accountId ? 'private' : 'role';
    const previous = this.list({...session,identity}).find(item=>item.scope===scope && item.topic===preference.topic);
    let content = preference.content,parameters,sourceRefs = [`turn:${turnId}`];
    if (preference.topic==='sales') {
      const saved = {...marketParameters(previous?.content??''),...previous?.marketParams};
      const changed = marketParameters(content);
      parameters = {...saved,...changed};
      const retained = Object.entries(saved).filter(([key])=>changed[key]===undefined)
        .map(([key,value])=>marketCondition(key,value));
      content = [...retained,content].join('；');
      if (retained.length) sourceRefs = [...new Set([...previous.sourceRefs,...sourceRefs])];
    }
    const topicName = {sales:'经营',zone:'分区',weather:'天气',planning:'作业'}[preference.topic];
    return this.save({id:previous?.id??`memory-${randomUUID()}`,siteId:session.siteId,role:session.role,
      scope,topic:preference.topic,title:scope==='private'?`个人偏好 · ${topicName}`:`演示角色偏好 · ${topicName}`,
      ...(scope==='private'?{accountId:session.accountId}:{}),
      content,...(parameters?{marketParams:parameters}:{}),sourceRefs,readAccess:memoryReadAccess(scope,session.siteId,identity),
      ...(previous?{history:[{content:previous.content,updatedAt:previous.updatedAt},...(previous.history??[])].slice(0,HISTORY_LIMIT)}:{})});
  }
  rememberExecution(siteId, task) {
    if (!['已完成','已取消'].includes(task.status)) return null;
    const content = `${task.title}（${task.date ?? '日期未记录'}，${task.zone}区）${task.status}；任务记录完成 ${task.done}/${task.count} 棵，已关联完成回执 ${task.completedReceipts} 条，取消回执 ${task.cancelledReceipts} 条。${task.lastEvent ? `最后记录：${task.lastEvent}` : ''}`;
    const id = `execution-${task.taskId}`;
    const previous = this.store.db.prepare('SELECT body FROM assistant_memories WHERE id=?').get(id);
    if (previous && JSON.parse(previous.body).content===content && JSON.parse(previous.body).readAccess?.version===1) return JSON.parse(previous.body);
    return this.save({id,siteId,role:null,scope:'park',topic:'execution',title:`园区执行记录 · ${task.zone}区`,
      content,sourceRefs:[task.taskId,...task.sourceRefs],readAccess:memoryReadAccess('park',siteId)});
  }
  /** Approved small-brain changes become park experience the brain can recall later. */
  rememberCerebellum(proposal, set) {
    return this.save({id:`cerebellum-${proposal.id}`,siteId:proposal.siteId,role:null,scope:'park',topic:'cerebellum',
      title:`小脑参数 v${set.version}`,content:`${proposal.expectedEffect}。依据：${proposal.summary}（${proposal.decidedBy ?? '人工'}批准）`,
      sourceRefs:[proposal.id,set.id],readAccess:memoryReadAccess('park',proposal.siteId)});
  }
}
