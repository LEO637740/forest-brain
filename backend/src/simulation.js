import { invariant } from './errors.js';
import { digest } from './util.js';
import {calculateMarket} from './simulation-market.js';
import {marketTreeExclusion} from './market-policy.js';
import {normalizeSiteId, parkSite, PARK_SITES} from './adapters/park-demo.js';
import {OperationalEvents, operationalEventReason} from './operational-events.js';
import {LogisticsWorkflow} from './logistics-workflow.js';
import {SalesShipments} from './sales-shipments.js';
import {isBuiltInDemoTask,preparePlannedTask} from './adapters/demo-tasks.js';
import {demoTaskAngle} from '../../shared/demoTaskChain.ts';

const TASK_STATUSES = new Set(['待开始', '执行中', '待处理', '已完成', '已取消']);
const TERMINAL_STATUSES = new Set(['已完成', '已取消']);
const DATA_MODES = new Set(['demo', 'mixed_demo', 'public']);
const taskRevision = task => Number.isInteger(task.revision) && task.revision > 0 ? task.revision : 1;
const taskContent = ({revision, ...task}) => task;
const taskSiteId = task => `demo-${task.site}`;
const strategyContent = ({adoptedAt,adoptedBy,...strategy}) => strategy;
const taskWithoutDemoChain = ({demoStrategy,demoReceipts,revision,...task}) => task;

function demoChainProblem(task, previous) {
  const strategy = task.demoStrategy, receipts = task.demoReceipts ?? [];
  if (!Array.isArray(receipts) || (!strategy && receipts.length))
    return ['INVALID_DEMO_CHAIN','模拟回传需要关联任务方案'];
  if (strategy && (typeof strategy.strategyId !== 'string' || !strategy.strategyId
      || strategy.taskId !== task.id || strategy.siteId !== taskSiteId(task)
      || strategy.mode !== 'simulation' || strategy.generator !== 'demo_rules'
      || !Number.isInteger(strategy.revision) || strategy.revision < 1
      || !Array.isArray(strategy.treeIndices) || !Array.isArray(task.treeIndices)
      || digest(strategy.treeIndices) !== digest(task.treeIndices)
      || !Object.values(strategy.parameters ?? {}).length
      || !['angleDeg','cutDepthMm','speedMmPerSec'].every(key=>Number.isFinite(strategy.parameters[key]))))
    return ['DEMO_STRATEGY_MISMATCH','模拟方案与任务、园区或树木范围不一致'];
  if (previous?.demoStrategy && (!strategy
      || digest(strategyContent(previous.demoStrategy)) !== digest(strategyContent(strategy))
      || previous.demoStrategy.adoptedAt && (previous.demoStrategy.adoptedAt !== strategy.adoptedAt || previous.demoStrategy.adoptedBy !== strategy.adoptedBy)))
    return ['DEMO_STRATEGY_CHANGED','已关联的模拟方案和采用记录不能改写'];
  if (receipts.some(receipt=>!receipt || receipt.taskId !== task.id || receipt.siteId !== taskSiteId(task)
      || receipt.strategyId !== strategy.strategyId || receipt.strategyRevision !== strategy.revision
      || !task.treeIndices.includes(receipt.treeIndex) || receipt.treeId !== `T-${String(receipt.treeIndex+1).padStart(4,'0')}`
      || receipt.receiptId !== `${task.id}:tree:${receipt.treeIndex}` || receipt.mode !== 'simulation'
      || receipt.angleDeg !== demoTaskAngle(strategy,receipt.treeIndex) || !['completed','skipped','cancelled'].includes(receipt.outcome))
      || new Set(receipts.map(receipt=>receipt.treeIndex)).size !== receipts.length)
    return ['DEMO_RECEIPT_MISMATCH','模拟回传与任务方案或树木对象不一致'];
  if ((previous?.demoReceipts ?? []).some(old=>!receipts.some(receipt=>receipt.receiptId === old.receiptId && digest(receipt) === digest(old))))
    return ['RECEIPT_CHANGED','已经收到的模拟作业回传不能删除或改写'];
  return null;
}
function siteScope(value) {
  try { return normalizeSiteId(value); }
  catch { invariant(false, 'INVALID_SITE', '园区标识无效', 400); }
}

function taskProblem(task, previous) {
  if (!task || typeof task.id !== 'string' || !task.id.length || task.id.length > 150
      || !Object.hasOwn(PARK_SITES, `demo-${task.site}`) || !TASK_STATUSES.has(task.status))
    return ['INVALID_TASK', '任务编号、园区或状态无效'];
  if (task.siteId !== undefined) {
    try { if (normalizeSiteId(task.siteId) !== taskSiteId(task)) return ['TASK_SITE_MISMATCH', '任务园区标识不一致']; }
    catch { return ['TASK_SITE_MISMATCH', '任务园区标识无效']; }
  }
  const sources = [task.railJob, task.railResult?.job, ...Object.values(task.railBatch?.jobs ?? {}), ...Object.values(task.railBatch?.results ?? {}).map(r => r?.job)].map(job => job?.harnessSource).filter(Boolean);
  if (sources.some(source => (source.siteId ?? 'demo-hainan') !== taskSiteId(task)))
    return ['TASK_SITE_MISMATCH', '任务引用了其他园区的策略'];
  if (!Number.isInteger(task.count) || task.count < 1 || task.count > 1000
      || !Number.isInteger(task.done) || task.done < 0 || task.done > task.count)
    return ['INVALID_PROGRESS', '任务总数和完成数必须有效，完成数不能超过总数'];
  if (task.treeIndices && (!Array.isArray(task.treeIndices) || task.treeIndices.length !== task.count
      || new Set(task.treeIndices).size !== task.treeIndices.length
      || task.treeIndices.some(index => !Number.isInteger(index) || index < 0 || index >= 200)))
    return ['INVALID_TASK_TARGETS', '任务树木范围与总数不一致'];
  const skipped = task.dispatch?.skipped ?? [];
  if (!Array.isArray(skipped) || new Set(skipped).size !== skipped.length
      || skipped.some(index => !Number.isInteger(index) || index < 0 || index >= 200
        || task.treeIndices && !task.treeIndices.includes(index)) || task.done + skipped.length > task.count)
    return ['INVALID_PROGRESS', '跳过对象与任务范围或完成数量不一致'];
  if (task.status === '已完成' && task.done + skipped.length !== task.count)
    return ['INVALID_TRANSITION', '只有全部对象完成或明确跳过后，任务才能结束'];
  if (task.railResult && !TERMINAL_STATUSES.has(task.status))
    return ['INVALID_TRANSITION', '已有最终回执的任务不能回到待执行状态'];
  if (task.dispatch?.phase === 'completed' && task.status !== '已完成'
      || task.dispatch?.phase === 'cancelled' && task.status !== '已取消')
    return ['INVALID_TRANSITION', '任务状态与最终执行回执不一致'];
  const chainProblem = demoChainProblem(task,previous);
  if (chainProblem) return chainProblem;
  if (!previous) return null;
  if (TERMINAL_STATUSES.has(previous.status)) return ['TASK_TERMINAL', '任务已结束，不能覆盖最终状态或回执'];
  if (task.site !== previous.site || task.count !== previous.count || task.kind !== previous.kind
      || previous.treeIndices && digest(task.treeIndices ?? null) !== digest(previous.treeIndices))
    return ['TASK_TARGET_CHANGED', '已有任务的园区、类型、总数和树木范围不能变更'];
  if (task.done < previous.done || (previous.dispatch?.skipped ?? []).some(index => !skipped.includes(index)))
    return ['PROGRESS_REGRESSION', '已完成或已跳过的进度不能回退'];
  if (previous.railResult && digest(task.railResult ?? null) !== digest(previous.railResult)
      || Object.entries(previous.railBatch?.results ?? {}).some(([index, result]) => digest(task.railBatch?.results?.[index] ?? null) !== digest(result)))
    return ['RECEIPT_CHANGED', '已经收到的作业回执不能删除或改写'];
  return null;
}

// Local simulated business actions, persisted separately from immutable strategies.
export class SimulationService {
  constructor(store, clock, {contextFactory} = {}) {
    this.store = store; this.clock = clock; this.contextFactory = contextFactory;
    this.operationalEvents = new OperationalEvents(store, clock);
    store.db.exec(`CREATE TABLE IF NOT EXISTS simulation_actions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL,
      tree_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    store.db.exec('CREATE INDEX IF NOT EXISTS simulation_actions_by_kind ON simulation_actions(kind,sequence)');
    store.db.exec('CREATE TABLE IF NOT EXISTS simulation_task_receipts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, received_at TEXT NOT NULL)');
    store.db.exec('CREATE TABLE IF NOT EXISTS simulation_models (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)');
    store.db.exec('CREATE TABLE IF NOT EXISTS simulation_market_plans (model_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    store.db.exec('CREATE TABLE IF NOT EXISTS simulation_market_sales_plans (model_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    this.logistics = new LogisticsWorkflow(store, clock, this);
    this.salesShipments = new SalesShipments(store, clock);
  }
  salesInventory(siteId='demo-hainan'){return this.salesShipments.inventory(siteScope(siteId));}
  market(input={}) {
    const inventory=this.salesInventory(input.siteId??'demo-hainan');
    const result=calculateMarket({stockKg:inventory.stockKg,heldKg:inventory.heldKg,...input},this.clock(),this.contextFactory);
    this.store.db.prepare('INSERT OR IGNORE INTO simulation_models VALUES(?,?,?)').run(result.id,JSON.stringify(result),result.generatedAt);
    return result;
  }
  latestTasks(siteId=null){return this.tasks(undefined,siteId).map(receipt => receipt.task);}
  latestMarket(siteId='demo-hainan'){
    siteId=siteScope(siteId);
    const row=this.store.db.prepare("SELECT body FROM simulation_models WHERE COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(siteId);
    const inventory=this.salesInventory(siteId);
    if(!row)return {model:null,plan:null,inventory};
    const model=JSON.parse(row.body),saved=this.store.db.prepare('SELECT body FROM simulation_market_plans WHERE model_id=?').get(model.id);
    const tasks=this.latestTasks(siteId).filter(t=>t.sourceScenarioId===model.id);
    return {model,plan:saved?JSON.parse(saved.body):tasks.length?{tasks,alreadyCreated:true,exclusions:tasks[0].planExclusions||[]}:null,salesPlan:this.marketSalesPlan(model.id,siteId),inventory};
  }
  marketSalesPlan(modelId,siteId){
    const row=this.store.db.prepare('SELECT body FROM simulation_market_sales_plans WHERE model_id=?').get(modelId);
    if(!row)return null;
    const plan=JSON.parse(row.body);
    invariant(normalizeSiteId(plan.siteId)===siteScope(siteId),'NOT_FOUND','当前园区没有该销售方案',404);
    return {...plan,shipments:this.salesShipments.forPlan(plan),inventory:this.salesInventory(siteId)};
  }
  adoptMarketSales(input){
    const row=this.store.db.prepare('SELECT body FROM simulation_models WHERE id=?').get(input.modelId);
    invariant(row,'NOT_FOUND','经营情景不存在，请先计算并保存',404);
    const model=JSON.parse(row.body),siteId=normalizeSiteId(model.siteId??'demo-hainan');
    invariant(input.siteId===undefined||siteScope(input.siteId)===siteId,'SITE_MISMATCH','情景不属于当前园区',409);
    invariant(+this.clock()-Date.parse(model.generatedAt)<86400000,'EXPIRED','情景已过期，请重新计算',409);
    const scenario=model.sales?.scenarios.find(item=>item.id===input.scenarioId);
    invariant(scenario,'INVALID_SCENARIO','请选择本次计算中的销售方案',400);
    invariant(scenario.feasible,'INFEASIBLE_SCENARIO','该方案超过仓容约束，请调整后重新计算',409);
    return this.store.transaction(()=>{
      const inventory=this.salesInventory(siteId);
      const saved=this.store.db.prepare('SELECT body FROM simulation_market_sales_plans WHERE model_id=?').get(model.id);
      const previous=saved?JSON.parse(saved.body):null;
      const adoptedAt=previous?.scenarioId===scenario.id?previous.adoptedAt:this.clock().toISOString();
      const result={modelId:model.id,siteId,scenarioId:scenario.id,adoptedAt,mode:'simulation',scenario,basis:model.sales.basis,recommendationReason:model.sales.recommendationReason,productionFrequencyPerWeek:model.sales.productionFrequencyPerWeek};
      const shipments=this.salesShipments.adopt({...model,siteId},scenario,adoptedAt);
      this.store.db.prepare('INSERT OR REPLACE INTO simulation_market_sales_plans VALUES(?,?)').run(model.id,JSON.stringify(result));
      return {...result,shipments,inventory};
    });
  }
  createMarketTasks(input){
    const result=this.calculateMarketTasks(input);
    this.store.db.prepare('INSERT OR REPLACE INTO simulation_market_plans VALUES(?,?)').run(input.modelId,JSON.stringify(result));
    return result;
  }
  calculateMarketTasks(input){
    invariant(typeof input.modelId==='string','INVALID_MODEL','请选择已保存情景',400);
    const row=this.store.db.prepare('SELECT body FROM simulation_models WHERE id=?').get(input.modelId);invariant(row,'NOT_FOUND','情景不存在',404);
    const dataMode=input.dataMode??'demo';invariant(['demo','mixed_demo'].includes(dataMode),'INVALID_DATA_MODE','数据模式无效',400);
    const model=JSON.parse(row.body),siteId=normalizeSiteId(model.siteId??'demo-hainan'),siteKey=parkSite(siteId).key;invariant(+this.clock()-Date.parse(model.generatedAt)<86400000,'EXPIRED','情景已过期，请重新计算',409);
    invariant(input.siteId===undefined||siteScope(input.siteId)===siteId,'SITE_MISMATCH','情景不属于当前园区',409);
    const siteTasks=this.latestTasks(siteId);
    const existing=siteTasks.filter(t=>t.sourceScenarioId===model.id);if(existing.length){const eligibleTrees=new Set(existing.flatMap(t=>t.treeIndices||[])).size;return {tasks:existing,alreadyCreated:true,eligibleTrees,excludedTrees:model.params.treeCount-eligibleTrees,exclusions:existing[0].planExclusions||[]};}
    const frequency=model.recommendedFrequency;invariant(frequency!==null,'NO_PLAN','没有满足约束的情景',409);if(frequency===0)return {tasks:[],reason:'本情景建议暂不新增割胶任务'};
    const today=new Date(+this.clock()+8*3600000).toISOString().slice(0,10);
    const reserved=new Set(siteTasks.filter(t=>t.sourceScenarioId&&t.status!=='已取消'&&Math.abs(Date.parse(t.date)-Date.parse(today))<7*86400000).flatMap(t=>t.treeIndices||[]));
    const indices=[],reasons={};const exclude=reason=>{reasons[reason]=(reasons[reason]||0)+1;};
    for(let index=0;index<model.params.treeCount;index++){
      if(reserved.has(index)){exclude('已在近期计划中');continue;}
      const treeId='T-'+String(index+1).padStart(4,'0'),b=this.store.getTreeViewBinding(treeId,'surface_action',dataMode,siteId);
      if(model.eligibleTreeIds&&!model.eligibleTreeIds.includes(treeId)){exclude(model.excludedTrees?.find(tree=>tree.treeId===treeId)?.reason??'未纳入本次经营测算');continue;}
      const context=b&&this.store.getContext(b.contextSnapshotId,1),run=b&&this.store.getRun(b.runId),s=run?.result?.strategy;
      const tree=context?.modules.trees?.find(t=>t.treeId===treeId);
      const eligibilityReason=marketTreeExclusion(tree);
      if(eligibilityReason){exclude(eligibilityReason);continue;}
      if(!s||s.qualityReview.status==='withdrawn'||Date.parse(s.expiresAt)<=+this.clock()){exclude('策略未就绪或已失效');continue;}
      if(s.proposal.findings.length){const review=this.list(treeId,siteId).find(a=>a.kind==='surface_review'&&a.strategyId===s.strategyId);if(review?.disposition!=='allow'){exclude(review?.disposition==='skip'?'已选择跳过':'树表异常待复核');continue;}}
      indices.push(index);
    }
    const exclusions=Object.entries(reasons).map(([reason,count])=>({reason,count}));
    if(!indices.length)return {tasks:[],eligibleTrees:0,excludedTrees:model.params.treeCount,exclusions,reason:'本次未新增任务，请查看未安排原因'};
    const tasks=[];for(let round=0;round<frequency;round++)for(let zone=0;zone<4;zone++){
      const trees=indices.filter(i=>Math.floor(i/50)===zone);if(!trees.length)continue;
      const date=new Date(+this.clock()+round*3*86400000+8*3600000).toISOString().slice(0,10);
      tasks.push(this.preparePlannedTask({id: model.id+'-'+round+'-'+zone,sourceScenarioId:model.id,dataMode,date,site:siteKey,siteId,block:'ABCD'[zone],robot:'R-'+'ABCD'[zone],title:'市场联动 · '+siteKey+' · '+'ABCD'[zone]+'区第'+(round+1)+'轮',start:round===0?new Date(+this.clock()+8*3600000).toISOString().slice(11,16):'08:00',end:'—',count:trees.length,done:0,status:'待开始',kind:'割胶',treeIndices:trees,autoPlanned:true}));
    }
    for(const task of tasks)task.planExclusions=exclusions;
    const saved = this.tasks({tasks});
    return {tasks:saved.tasks.filter(task => task.sourceScenarioId === model.id),eligibleTrees:indices.length,excludedTrees:model.params.treeCount-indices.length,exclusions};
  }
  preparePlannedTask(task) {
    const adoptedAngles = task.site === 'hainan' ? [] : task.treeIndices.flatMap(treeIndex => {
      const treeId = `T-${String(treeIndex+1).padStart(4,'0')}`;
      const adopted = this.list(treeId,task.siteId).find(action => action.kind === 'adopt_angle');
      if (!adopted || !this.strategyValidity(adopted).valid) return [];
      const {strategyId,runId,revision,adoptedAt} = adopted;
      return [{treeIndex,treeId,angleDeg:adopted.angle,strategyId,runId,revision,adoptedAt}];
    });
    return preparePlannedTask(task,this.clock(),adoptedAngles);
  }
  appendTaskReceipt(task, row) {
    const previous = row && JSON.parse(row.body);
    const next = {...taskContent(task),revision:(previous?taskRevision(previous):0)+1};
    this.store.db.prepare('INSERT INTO simulation_task_receipts VALUES(?,?,?,?)')
      .run(digest({task:next,previous:row?.id ?? null}),next.id,JSON.stringify(next),this.clock().toISOString());
    return next;
  }
  // A one-time enrichment for saved built-in examples, including completed ones.
  // Ordinary task writes continue to enforce terminal-state immutability.
  enrichDemoTaskChains(tasks) {
    let enriched = 0;
    this.store.transaction(()=>{
      for (const task of tasks) {
        const row = this.store.db.prepare('SELECT id,body FROM simulation_task_receipts WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(task.id);
        const previous = row && JSON.parse(row.body);
        invariant(previous && isBuiltInDemoTask(previous)
          && digest(taskWithoutDemoChain(task)) === digest(taskWithoutDemoChain(previous)),
          'INVALID_DEMO_ENRICHMENT','仅能为原有模拟样例补充方案与回传',409);
        if (digest(taskContent(previous)) === digest(taskContent(task))) continue;
        const problem = demoChainProblem(task,previous);
        invariant(!problem,problem?.[0],problem?.[1],409);
        this.appendTaskReceipt(task,row);
        enriched++;
      }
    });
    return enriched;
  }
  tasks(input, siteId = null) {
    const scope=siteId===null?null:siteScope(siteId);
    // This endpoint supplies current state. Audit history stays in the table and
    // must not displace current tasks when more than 200 updates are recorded.
    if (!input) return this.store.db.prepare("SELECT body,received_at FROM simulation_task_receipts WHERE rowid IN (SELECT MAX(rowid) FROM simulation_task_receipts GROUP BY task_id) AND (? IS NULL OR json_extract(body,'$.site')=?) ORDER BY rowid DESC").all(scope,scope===null?null:parkSite(scope).key).map(r => {
      const task = JSON.parse(r.body);
      return {task:{...task, revision:taskRevision(task)},receivedAt:r.received_at};
    });
    invariant(Array.isArray(input.tasks) && input.tasks.length <= 1000, 'INVALID_TASKS', '任务列表无效', 400);
    invariant(new Set(input.tasks.map(task => task?.id)).size === input.tasks.length, 'INVALID_TASKS', '同一次请求不能重复提交同一任务', 400);
    const conflicts = []; let accepted = 0;
    this.store.transaction(() => {
      for (const task of input.tasks) {
        const row = typeof task?.id === 'string' ? this.store.db.prepare('SELECT id,body,received_at FROM simulation_task_receipts WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(task.id) : null;
        const old = row && JSON.parse(row.body);
        const previous = old && {...old, revision:taskRevision(old)};
        // Retrying an identical write is safe even if its response was lost.
        if (previous && digest(taskContent(previous)) === digest(taskContent(task))) { accepted++; continue; }
        let problem = previous && task.revision !== previous.revision
          ? ['TASK_REVISION_CONFLICT', '任务已有更新，请采用服务器最新状态后重试']
          : !previous && task?.revision !== undefined && task.revision !== 0
            ? ['TASK_REVISION_CONFLICT', '新任务须以版本 0 提交'] : taskProblem(task, previous);
        if (problem) {
          conflicts.push({taskId:task?.id ?? null,code:problem[0],message:problem[1],revision:previous?.revision ?? 0,task:previous ?? null});
          continue;
        }
        this.appendTaskReceipt(task,row);
        accepted++;
      }
    });
    return {accepted,tasks:this.latestTasks(),conflicts,mode:'simulation'};
  }
  list(treeId, siteId = null) {
    const scope=siteId===null?null:siteScope(siteId);
    return this.store.db.prepare("SELECT body FROM simulation_actions WHERE (? IS NULL OR tree_id=?) AND (? IS NULL OR COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=?) ORDER BY sequence DESC LIMIT 200").all(treeId,treeId,scope,scope).map(r=>JSON.parse(r.body));
  }
  strategyContext(strategy) {
    const run = this.store.getRun(strategy.runId);
    const input = run?.request.inputSnapshot;
    return this.store.getRunContext(strategy.runId) ?? (input ? this.store.getContext(input.snapshotId, input.version) : null);
  }
  strategyMode(strategy) {
    // The context is the authoritative input actually used for this run. Do not
    // bind a mixed-data strategy against the independently prepared demo view.
    const mode = this.strategyContext(strategy)?.dataPolicy?.mode ?? strategy.dataPolicy?.mode ?? 'demo';
    return DATA_MODES.has(mode) ? mode : 'demo';
  }
  strategyValidity(reference) {
    const result = (valid, status, reason, extra = {}) => ({...reference,valid,status,reason,...extra});
    const strategy = this.store.getStrategy(reference.strategyId);
    if (!strategy) return result(false, 'missing', '原策略不存在，请重新获取建议');
    const dataMode = this.strategyMode(strategy), siteId=strategy.siteId??'demo-hainan', extra = {dataMode,siteId,expiresAt:strategy.expiresAt};
    if (reference.siteId !== undefined && siteScope(reference.siteId) !== siteId)
      return result(false, 'site_mismatch', '策略不属于当前园区，请重新确认', extra);
    if (reference.dataMode !== undefined && reference.dataMode !== dataMode)
      return result(false, 'mode_mismatch', '策略数据模式已变化，请重新确认', extra);
    if (reference.runId !== undefined && reference.runId !== strategy.runId
        || reference.revision !== undefined && reference.revision !== strategy.revision)
      return result(false, 'superseded', '策略运行或版本不匹配，请重新确认', extra);
    const context = this.strategyContext(strategy);
    if (!context?.targetSnapshot.treeIds.includes(reference.treeId))
      return result(false, 'tree_mismatch', '策略不适用于该树', extra);
    if (strategy.qualityReview.status === 'withdrawn')
      return result(false, 'withdrawn', '原策略已撤回，请重新确认', extra);
    if (!Number.isFinite(Date.parse(strategy.expiresAt)) || Date.parse(strategy.expiresAt) <= +this.clock())
      return result(false, 'expired', '原策略已过期，请重新确认', extra);
    // Weather scenarios coexist until explicitly replaced by a new adoption.
    if (strategy.kind !== 'weather_window') {
      const binding = this.store.getTreeViewBinding(reference.treeId, strategy.kind, dataMode, strategy.siteId ?? 'demo-hainan');
      if (binding?.runId !== strategy.runId)
        return result(false, 'superseded', '该树策略已有新版本，请重新确认', extra);
    }
    return result(true, 'available', null, extra);
  }
  validateStrategies(input) {
    invariant(input && Array.isArray(input.strategies) && input.strategies.length <= 1000, 'INVALID_STRATEGIES', '待核验策略列表无效', 400);
    for (const item of input.strategies) invariant(item && /^T-\d{4}$/.test(item.treeId)
      && typeof item.strategyId === 'string' && typeof item.runId === 'string'
      && Number.isInteger(item.revision) && item.revision >= 1
      && (item.dataMode === undefined || DATA_MODES.has(item.dataMode)), 'INVALID_STRATEGY_REFERENCE', '待核验策略必须包含树编号、策略编号、运行编号和版本', 400);
    const items = input.strategies.map(item => {
      const validity = this.strategyValidity(item);
      if (!validity.valid) return validity;
      const events = this.operationalEvents.blockingForTree(validity.siteId, item.treeId);
      return events.length ? {...validity,valid:false,status:'operational_hold',reason:events.map(operationalEventReason).join('；'),operationalEventIds:events.map(event=>event.id)} : validity;
    });
    return {items,checkedAt:this.clock().toISOString()};
  }
  effectiveConstraints(siteId = 'demo-hainan') {
    siteId=siteScope(siteId);
    // The latest adoption for each tree remains authoritative even when invalid.
    // Returning invalidity blocks waiting jobs instead of silently removing their
    // weather hold, or resurrecting an older but still unexpired adoption.
    const rows = this.store.db.prepare("SELECT body FROM simulation_actions WHERE kind='adopt_weather' AND COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? ORDER BY sequence DESC").all(siteId);
    const seen = new Set(), constraints = [];
    for (const row of rows) {
      const action = JSON.parse(row.body);
      const treeIds = (action.treeIds ?? [action.treeId]).filter(treeId => !seen.has(treeId));
      if (!treeIds.length) continue;
      for (const treeId of treeIds) seen.add(treeId);
      let validity = this.strategyValidity({siteId,treeId:treeIds[0],strategyId:action.strategyId,runId:action.runId,revision:action.revision,dataMode:action.dataMode});
      if (validity.valid && (!Number.isFinite(Date.parse(action.end)) || Date.parse(action.end) <= +this.clock()))
        validity = {...validity,valid:false,status:'expired',reason:'采用的天气窗口已结束，请重新确认'};
      constraints.push({...action,siteId,treeIds,dataMode:validity.dataMode,validity});
    }
    return {siteId,constraints,operationalEvents:this.operationalEvents.list(siteId),checkedAt:this.clock().toISOString()};
  }
  record(input) {
    invariant(input && typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId), 'INVALID_ACTION', '需要有效的请求编号', 400);
    const previous = this.store.db.prepare('SELECT body FROM simulation_actions WHERE request_id=?').get(input.requestId);
    if (previous) {
      const row = JSON.parse(previous.body);
      invariant(JSON.stringify(row.input) === JSON.stringify(input), 'ACTION_CONFLICT', '同一请求编号不能提交不同内容', 409);
      return row;
    }
    invariant(['adopt_angle', 'surface_review', 'adopt_weather'].includes(input.kind), 'INVALID_ACTION', '未知模拟操作', 400);
    const strategy = this.store.getStrategy(input.strategyId);
    invariant(strategy && strategy.qualityReview.status !== 'withdrawn' && Date.parse(strategy.expiresAt) > +this.clock(), 'STRATEGY_UNAVAILABLE', '建议已失效，请刷新', 409);
    invariant(strategy.targetSnapshotId && /^T-\d{4}$/.test(input.treeId), 'INVALID_TREE', '树编号无效', 400);
    invariant(input.dataMode === undefined || DATA_MODES.has(input.dataMode), 'INVALID_DATA_MODE', '数据模式无效', 400);
    const validity = this.strategyValidity({siteId:input.siteId,treeId:input.treeId,strategyId:strategy.strategyId,runId:input.runId ?? strategy.runId,revision:input.revision ?? strategy.revision,dataMode:input.dataMode});
    invariant(validity.valid, 'STRATEGY_CHANGED', validity.reason, 409, validity);
    let weather={};
    if(input.kind==='adopt_weather') {
      invariant(strategy.kind==='weather_window','INVALID_ACTION','需要天气策略',400);
      const window=strategy.proposal.windows.find(w=>w.start===input.start&&w.suitability==='suitable'&&Date.parse(w.end)>+this.clock());
      const context=this.store.getRunContext(strategy.runId);
      invariant(window&&context?.targetSnapshot.treeIds.includes(input.treeId),'INVALID_WINDOW','窗口已过期或不适用于该树',409);
      weather={start:window.start,end:window.end,treeIds:context.targetSnapshot.treeIds};
    }
    if (input.kind === 'adopt_angle') invariant(strategy.kind === 'tapping_angle' && strategy.proposal.treeId === input.treeId, 'INVALID_ACTION', '角度建议与树不匹配', 400);
    else if(input.kind==='surface_review')invariant(strategy.kind === 'surface_action' && ['allow', 'skip'].includes(input.disposition), 'INVALID_ACTION', '请选择复核放行或跳过', 400);
    const result = { input, requestId: input.requestId, treeId: input.treeId, siteId: strategy.siteId ?? 'demo-hainan', kind: input.kind, strategyId: strategy.strategyId, runId: strategy.runId, revision: strategy.revision, dataMode:validity.dataMode, expiresAt: strategy.expiresAt, adoptedAt: this.clock().toISOString(), mode: 'simulation', ...weather,...(input.kind === 'adopt_angle' ? { angle: strategy.proposal.recommendedCutSlopeDeg } : input.kind==='surface_review'?{ disposition: input.disposition }:{}) };
    this.store.db.prepare('INSERT INTO simulation_actions(request_id,tree_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(input.requestId, input.treeId, input.kind, JSON.stringify(result), result.adoptedAt);
    return result;
  }
}
