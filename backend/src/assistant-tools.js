import {ledgerSeries} from './assistant-ledger-series.js';
import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';
import {withoutCareLimit} from './market-policy.js';
import {parkSite,TREE_IDS,PARK_SITES} from './adapters/park-demo.js';
import {Identity} from './identity.js';
import {summarizeScopedTask,scopeOperationalEvent,scopeWeatherConstraint} from './assistant-access.js';
export {scopeTaskForIdentity,summarizeScopedTask} from './assistant-access.js';
import {collectionIssue} from '../../shared/logistics.ts';
import {invariant} from './errors.js';
import {marketParameters,inventoryParameters,latestInventoryRequested} from './assistant-memory.js';
import {rubberMarketContext,networkInventory} from './commodity-reference.js';
import {MARKET_EVENT_KINDS} from './market-events.js';
import {BUSINESS_SKILLS,builtInSkill} from './assistant-skills.js';
import {plotSummary} from './workspace-brief.js';
import {ECONOMIC_SCENARIOS,economicScenario,calculateMachineryCase} from './economic-scenario.js';
import {PARAMETER_SPECS} from './cerebellum.js';
import {unpreparedTreeCount} from './park-plan.js';
import {investigationTool,modelInvestigation,turnEvidence} from './investigation-canvas.js';

const tool = (name,description,properties={}) => ({type:'function',function:{name,description,
  parameters:{type:'object',properties,additionalProperties:false}}});
const zoneProperty = {zone:{type:'string',enum:['A','B','C','D'],description:'省略时沿用会话选中的分区；数据始终属于会话当前园区。'}};
export const ASSISTANT_TOOLS = [
  investigationTool,
  tool('prepare_operation','用户明确要求执行时准备待确认操作，不立即执行。kind：recompute_plan重算全园计划；adopt_plan采用已生成的计划并排程（targetId必须来自read_production_plan或plan_park_tapping）；capture_tree补拍明确树号；batch_step处理已查到的收胶批次。payloadJson只填用户明确提供的业务参数，缺少称重/检验/加工数据先询问，禁止编造。',{
    kind:{type:'string',enum:['recompute_plan','adopt_plan','capture_tree','batch_step']},targetId:{type:'string'},step:{type:'string',enum:['weigh','inspect','plan','dispatch','receive','process','pause','resume','cancel','hold','start-processing']},payloadJson:{type:'string',description:'JSON字段必须使用业务接口名称。所有步骤需要note。weigh:grossKg,tareKg；inspect:sampleId,dryRubberPercent(百分数如30),decision(pass或hold),可选grade(A或B)；plan:destinationId,vehicleCode,driver,plannedDepartureAt(ISO时间)；receive:receivedKg；process:可选processLossKg(干胶损耗kg，默认0)。adopt_plan:replace布尔。不要填写revision/operator，服务端自动绑定。'}},['kind']),
  tool('read_production_series','按日期查询整园已登记的鲜胶乳称重与干胶加工序列并生成可查看依据的图表。与库存共用批次账本。空白是无记录而非零产量，不推算单树分摊或因果。默认近7天，最多90天。',{startDate:{type:'string'},endDate:{type:'string'}}),
  tool('read_production_plan','读取已生成的生产计划和采用状态；准备排程时读取原计划，不重新计算。',{planId:{type:'string'}}),
  tool('read_logistics_batches','读取当前园区收胶批次的完整状态、版本、称重质检和运输加工记录。准备batch_step前先调用；没有实测数据先询问，不推测重量、检验结果或运输人员。',{batchId:{type:'string'}}),
  tool('read_tree_observations','查询当前园区某棵树已有的树表标记、健康记录和缺测项，并提供单树策略及补拍/复测入口。记录来自已有业务资料，不是本轮图像识别。',{treeId:{type:'string',description:'如 T-0001；省略则使用本轮选中的树。'}}),
  tool('read_park','查询当前园区或分区的树木档案与作业状态。',zoneProperty),
  tool('read_weather','读取当前园区天气和当前范围内的天气、设备事件。',zoneProperty),
  tool('read_tasks','读取当前范围的任务、已完成数量、未完成树木与关联方案。',zoneProperty),
  tool('read_execution_history','读取当前范围的有效完成回执、采用记录、收胶与加工入库批次，并保留来源任务和业务单据。鲜胶乳称重、到厂签收不等于干胶入库，只有完成加工记录计为实际干胶产出。',zoneProperty),
  tool('read_sales_inventory','读取当前整个园区最新干胶库存、加工入库、待加工鲜胶乳、在途、已签收销量与待出货安排。仅完成加工才增加干胶库存，发车扣库存，签收计已售；预计产量和未加工鲜胶乳不计入干胶库存。'),
  tool('read_rubber_market','读取浙江国际大宗商品交易中心的橡胶品种资料、批复及已缓存的公开行情参考，并结合当前园区可售干胶说明对接建议。资料未细分天然胶、合成胶或牌号；品种备案不表示本园区已挂牌，公开期货与区域月均价不替代园区现货成交价。只读取资料，不报价、挂牌或下单。'),
  tool('read_eudr_readiness','读取当前园区已加工批次及销售出货的欧盟客户资料、来源地块、缺项和下一步。期初库存来源待补，销售出货逐单读取来源分配状态。演示资料齐备不是合规认证。只读，不生成或提交正式DDS。'),
  tool('read_economic_factors','读取价格因素体检（老师提出的4个短期与4个长期因素：每项的当前读数、数据来源、判断规则、预警等级和对应动作）及可计算模拟情景。短期情景通过compare_market指定economicScenarioId测算；机器人回本是长期独立算例，不能冒充本周新增产量。'),
  tool('compare_market','计算并保存当前整个园区的生产与销售比较。库存和冻结量默认读取最新账本；用户明确给出的假设在当前会话继续沿用，按最新实际库存复盘时用 useCurrentInventory 清除假设。只传用户本轮调整的项，数量统一为公斤，1吨=1000公斤，不要把未提供的参数填为0。其余省略项沿用会话、偏好或已有方案。仅作方案，不采用、派发任务或修改库存。',{
    stockKg:{type:'number'},storageKg:{type:'number'},heldKg:{type:'number'},transportKgPerDay:{type:'number'},
    useCurrentInventory:{type:'boolean',description:'用户要求按最新实际库存或退出库存假设时为 true，库存和冻结量重新读取账本。'},
    careLimit:{type:'integer'},costPerTapping:{type:'number'},dryKgPerTapping:{type:'number'},
    demandIndex:{type:'number'},demandBaseline:{type:'number'},
    economicScenarioId:{type:'string',enum:ECONOMIC_SCENARIOS.map(item=>item.id)},
  }),
  tool('recall_memory','读取通用流程、当前园区执行经验及当前演示角色偏好。',{query:{type:'string'}}),
  tool('remember_preference','仅在用户本轮明确要求记住或更新偏好时保存其原话，自动按主题更新。'),
  tool('read_my_plot','胶农专用：读取本人承包地块的树木养护、涉及本地块的作业、已完成割胶次数和附近收胶点报价。'),
  tool('plan_park_tapping','调用独立大模型分析本园行情、成本、需求和库存，直接提出各区每周割次；随后由固定规则核验天气、健康、设备、养护上限和仓容，形成日历。modelProposal保留模型原始建议、理由、引用输入与来源快照，constraintAdjustments说明硬约束修改。禁止把旧规则结果说成模型新策略；模型失败则没有新方案。只形成方案，不采用、不创建任务。',{economicScenarioId:{type:'string',enum:ECONOMIC_SCENARIOS.map(item=>item.id)}}),
  tool('search_memory','按关键词检索公共、园区与个人记忆，返回最相关的条目及编号。',{query:{type:'string'}}),
  tool('save_memory','把用户明确要求记下的事实或经验保存为记忆。scope=private 为个人记忆；park 为园区共享经验（需园区管理或中心）；shared 为公共经验（仅中心）。',{
    scope:{type:'string',enum:['private','park','shared']},title:{type:'string'},content:{type:'string'},topic:{type:'string'}}),
  tool('edit_memory','修改一条已有记忆的内容，保留历史版本。只能修改有权写入的记忆。',{memoryId:{type:'string'},content:{type:'string'}}),
  tool('forget_memory','归档（不再使用）一条记忆，保留审计记录。只能处理有权写入的记忆。',{memoryId:{type:'string'},reason:{type:'string'}}),
  tool('propose_market_event','把用户告知的市场或政策事件（国家抛储/收储、主产国限出口、放宽进口、下游需求下滑、台风预警）登记为待审批事件。只有中心批准且在生效期内，事件才进入价格因素体检。用户没有提供的日期和来源不要编造。',{
    kind:{type:'string',enum:Object.keys(MARKET_EVENT_KINDS)},title:{type:'string'},scope:{type:'string',enum:['park','all']},
    effectiveFrom:{type:'string',description:'YYYY-MM-DD，用户未说明则不填'},effectiveTo:{type:'string',description:'YYYY-MM-DD，用户未说明则不填'},source:{type:'string',description:'公告链接或文号，用户未提供则不填'}}),
  tool('load_skill','读取一项业务技能的完整规则（技能目录见系统提示）。需要某类业务口径但还没调用相应工具时使用。只读。',{skillId:{type:'string',enum:BUSINESS_SKILLS.map(item=>item.id)}}),
  tool('search_conversations','按关键词检索本园区以前的对话（本人或同一演示角色的会话），返回日期、当时的问题和回答结论，用于“上次我们怎么定的”这类追问。只读。',{query:{type:'string'}}),
  tool('read_brain_evolution','读取大脑自我改进闭环：今天单树请求在小脑、大脑、暂停之间的分流，过去约60个早晨真实天气对小脑规则的回放（误停、漏停、多余复核），护栏内的改进建议，上线版本复盘和各代参数记录；routing.evolution 是分流自我改进：历史大脑运行与小脑规则的影子对照、可下沉给小脑的情况、已下沉情况的抽检复盘。只读。'),
  tool('propose_cerebellum_tuning','提出小脑天气阈值的调整提案。提案只进入待审批，须由园区管理或中心批准后才生效；超出护栏的调整会被拒绝。不传 changes 时由大脑按气候与执行反馈自动反思。',{
    rationale:{type:'string'},changes:{type:'array',items:{type:'object',properties:{key:{type:'string',enum:Object.keys(PARAMETER_SPECS)},to:{type:'number'},reason:{type:'string'}},required:['key','to'],additionalProperties:false}}}),
];

// Risk control for the Harness: every tool has a risk class and the roles that
// may call it.  read/compute run directly, memory_write is limited to scopes the
// identity may write, proposal only creates pending items for human approval.
// No tool can adopt a strategy, dispatch a robot or move inventory.
const ALL_ROLES = ['grower','manager','operator','executive'];
export const TOOL_POLICY = Object.freeze({
  investigation_graph:{risk:'read',roles:ALL_ROLES},
  read_production_series:{risk:'read',roles:['manager','executive']},
  read_production_plan:{risk:'read',roles:['manager','executive']},
  read_logistics_batches:{risk:'read',roles:['manager','operator','executive']},
  prepare_operation:{risk:'proposal',roles:['manager','operator']},
  read_tree_observations:{risk:'read',roles:ALL_ROLES},
  read_park:{risk:'read',roles:['manager','operator','executive']},
  read_weather:{risk:'read',roles:ALL_ROLES},
  read_tasks:{risk:'read',roles:ALL_ROLES},
  read_execution_history:{risk:'read',roles:['manager','operator','executive']},
  read_sales_inventory:{risk:'read',roles:['manager','executive']},
  read_rubber_market:{risk:'read',roles:ALL_ROLES},
  read_eudr_readiness:{risk:'read',roles:['manager','executive']},
  read_economic_factors:{risk:'read',roles:['manager','executive']},
  compare_market:{risk:'compute',roles:['manager']},
  recall_memory:{risk:'read',roles:ALL_ROLES},
  search_memory:{risk:'read',roles:ALL_ROLES},
  remember_preference:{risk:'memory_write',roles:ALL_ROLES},
  save_memory:{risk:'memory_write',roles:ALL_ROLES},
  edit_memory:{risk:'memory_write',roles:ALL_ROLES},
  forget_memory:{risk:'memory_write',roles:ALL_ROLES},
  read_my_plot:{risk:'read',roles:['grower']},
  plan_park_tapping:{risk:'compute',roles:['manager','executive']},
  propose_cerebellum_tuning:{risk:'proposal',roles:['manager','executive']},
  read_brain_evolution:{risk:'read',roles:['manager','operator','executive']},
  propose_market_event:{risk:'proposal',roles:['manager','executive']},
  load_skill:{risk:'read',roles:ALL_ROLES},
  search_conversations:{risk:'read',roles:ALL_ROLES},
});
export const canUseAssistantTool = (session,name) => Boolean(TOOL_POLICY[name] && (!session?.accountId || TOOL_POLICY[name].roles.includes(session.role)));
export const canLoadAssistantSkill = (session,skill) => Boolean(skill && skill.tools.some(name => canUseAssistantTool(session,name)));
export const RISK_LABELS = Object.freeze({read:'只读',compute:'测算',memory_write:'写记忆',proposal:'待审批提案'});
const LEGACY_TOOLS = new Set(['investigation_graph','read_tree_observations','read_park','read_weather','read_tasks','read_execution_history','read_sales_inventory','read_rubber_market','read_eudr_readiness','read_economic_factors','compare_market','recall_memory','remember_preference','load_skill','search_conversations']);
/** Tools offered to the model for one conversation. Signed-in sessions get the role allowlist. */
export function toolsFor(session) {
  return ASSISTANT_TOOLS.filter(item=>{
    const name = item.function.name;
    return session?.accountId ? TOOL_POLICY[name].roles.includes(session.role) : LEGACY_TOOLS.has(name);
  });
}

const treeId = index => `T-${String(index+1).padStart(4,'0')}`;
const beijingTime = value => new Date(new Date(value).getTime()+8*60*60*1000).toISOString().replace('Z','+08:00');
const kg = value => Math.round(value*1000)/1000;
const processingQuestion = message => /加工|入库|产出|产成品/.test(message);
function batchFacts(batch) {
  return {batchId:batch.id,taskId:batch.source.taskId,taskTitle:batch.source.taskTitle,stage:batch.stage,
    netKg:batch.weighing?.netKg??null,receivedKg:batch.transport?.receipt?.receivedKg??null,unit:'kg 鲜胶乳',
    receiptId:batch.transport?.receipt?.id??null,
    processing:batch.stage==='processed'?{...batch.processing,latexUnit:'kg 鲜胶乳',dryUnit:'kg 干胶'}:null};
}
function productionFacts(batches) {
  const completedBatches = batches.filter(batch=>batch.stage==='processed').map(batchFacts)
    .sort((a,b)=>b.processing.at.localeCompare(a.processing.at));
  const pendingBatches = batches.filter(batch=>['received','processing'].includes(batch.stage)).map(batchFacts);
  const heldBatches = batches.filter(batch=>batch.stage==='quality-held'&&batch.transport?.receipt).map(batchFacts);
  return {processedKg:kg(completedBatches.reduce((sum,batch)=>sum+batch.processing.dryKg,0)),
    processedBatches:completedBatches.length,completedBatches,latestProcessed:completedBatches[0]??null,
    pendingProcessingKg:kg(pendingBatches.reduce((sum,batch)=>sum+batch.receivedKg,0)),
    pendingProcessingBatches:pendingBatches.length,pendingBatches,
    heldBatches,heldLatexKg:kg(heldBatches.reduce((sum,batch)=>sum+batch.receivedKg,0))};
}
function processingAction(production,message) {
  const target = /待加工|还有.*加工|哪些.*加工/.test(message)
    ? production.pendingBatches[0] : production.latestProcessed??production.pendingBatches[0];
  return {type:'logistics',...(target?{batchId:target.batchId}:{}),label:'查看加工入库'};
}
export const summarizeTask = summarizeScopedTask;

const PARAMETER_LABELS = {stockKg:'库存',heldKg:'冻结',storageKg:'仓容',transportKgPerDay:'每天运力',careLimit:'每周养护上限',costPerTapping:'单次成本',dryKgPerTapping:'单次干胶',demandIndex:'需求指数',demandBaseline:'需求基准'};
function changeFromPrevious(previousModel,model,lead) {
  if (!previousModel?.sales) return null;
  const changed = Object.keys(PARAMETER_LABELS).filter(key=>previousModel.params?.[key]!==model.params[key])
    .map(key=>({key,label:PARAMETER_LABELS[key],from:previousModel.params?.[key]??null,to:model.params[key]}));
  const before = lead(previousModel.sales), after = lead(model.sales);
  let summary;
  if (!before||!after) summary = '上一版或本版没有可比较的推荐方案。';
  else if (before.recommended!==after.recommended||before.runnerUp!==after.runnerUp)
    summary = `推荐由“${before.recommended}”（领先“${before.runnerUp}” ${before.leadCny.toFixed(2)} 元）变为“${after.recommended}”（领先“${after.runnerUp}” ${after.leadCny.toFixed(2)} 元）。`;
  else {
    const delta = Math.round((after.leadCny-before.leadCny)*100)/100;
    const direction = Math.abs(delta)<0.005 ? '不变' : delta>0 ? '扩大' : '收窄';
    summary = `“${after.recommended}”相对“${after.runnerUp}”的领先${direction==='不变'?`保持 ${after.leadCny.toFixed(2)} 元`:`由 ${before.leadCny.toFixed(2)} 元${direction}到 ${after.leadCny.toFixed(2)} 元`}。`;
  }
  return {previousModelId:previousModel.id,changedParams:changed,previousLead:before,currentLead:after,summary};
}

export class AssistantTools {
  constructor({actions=null,simulation,makeParkContext,memory,publicDataService=null,parkPlans=null,cerebellum=null,eudr=null,priceFactors=null,evolution=null,marketEvents=null,searchConversations=null,clock=()=>new Date()}) {
    Object.assign(this,{actions,simulation,makeParkContext,memory,publicDataService,parkPlans,cerebellum,eudr,priceFactors,evolution,marketEvents,searchConversations,clock});
    this.definitions = toolsFor(null);
  }
  definitionsFor(session) { return toolsFor(session); }
  rubberMarket(siteId,parkName,identity=null) {
    const canReadInventory = !identity || ['manager','executive'].includes(identity.role);
    const networkSites = identity ? Object.fromEntries(Object.entries(PARK_SITES).filter(([id])=>identity.seesSite(id))) : PARK_SITES;
    return rubberMarketContext({publicDataService:this.publicDataService,
      inventory:canReadInventory?this.simulation.salesInventory(siteId):null,parkName,now:this.clock(),
      network:!identity||identity.role==='executive'?networkInventory(this.simulation,networkSites):null});
  }
  tasks(session,zone,selectedTree,identity=null) {
    const index = selectedTree ? Number(selectedTree.slice(2))-1 : null;
    return this.simulation.latestTasks(session.siteId)
      .filter(task=>(!zone||task.block===zone)&&(index===null||task.treeIndices?.includes(index))&&(!identity||identity.seesTask(task)));
  }
  refreshMemories(session) {
    for (const task of this.simulation.latestTasks(session.siteId))
      this.memory.rememberExecution(session.siteId,summarizeTask(task));
  }
  /** Runs one tool. A tool outside the role allowlist is refused and reported back, not thrown. */
  execute(name,args={}, {session,turn,identity=null,authorize=()=>{}}) {
    const policy = TOOL_POLICY[name];
    invariant(policy,'UNKNOWN_ASSISTANT_TOOL',`没有可调用的工具：${name}`);
    if (session.accountId || identity) {
      invariant(identity instanceof Identity && session.accountId===identity.accountId && session.role===identity.role,
        'FORBIDDEN_ASSISTANT_IDENTITY','会话身份不匹配，请重新登录。',403);
      identity.require('assistant.use');
      identity.requireSite(session.siteId);
      if (turn.treeId) identity.requireTree(session.siteId,turn.treeId);
    }
    if (!canUseAssistantTool(session,name) || name==='load_skill' && !canLoadAssistantSkill(session,builtInSkill(args.skillId)))
      return {denied:true,risk:policy.risk,data:{error:'TOOL_NOT_ALLOWED',message:`${name} 不在当前身份可用的工具范围内。`},label:'工具调用被拒绝',
        summary:`当前身份不能使用 ${name}（${RISK_LABELS[policy.risk]}）。`,sourceRefs:[]};
    if(turn.needsTreeClarification&&!['recall_memory','load_skill','search_memory'].includes(name))return {denied:true,risk:policy.risk,data:{error:'TREE_CLARIFICATION_REQUIRED',message:'尚不明确用户指哪棵树。请先问树号或让用户选择树，不查询全园猜测。'},label:'等待明确对象',summary:'需要先明确树号',sourceRefs:[]};
    if(args.treeId) {
      const tree=resolveTreeIdentity(session.siteId,args.treeId);
      invariant(tree,'INVALID_TREE_REFERENCE','树号不属于当前园区，请核对园区和编号。');
      identity?.requireTree(session.siteId,tree.treeId);
      args={...args,treeId:tree.treeId};
    }
    const result = this.run(name,args,{session,turn,identity,authorize});
    return result instanceof Promise?result.then(value=>({risk:policy.risk,...value})):{risk:policy.risk,...result};
  }
  run(name,args,{session,turn,identity,authorize}) {
    const siteId = session.siteId, park = parkSite(siteId);
    if(name==='read_production_series'){
      const chart=ledgerSeries(this.simulation.logistics.list(siteId),{...args,now:this.clock()});
      turn.productionCharts=[chart];
      return {data:{siteId,...chart},label:'查询生产序列',summary:`${chart.startDate}至${chart.endDate}，${chart.sourceRefs.length}个来源批次`,sourceRefs:chart.sourceRefs,actions:chart.sourceRefs.slice(0,3).map(batchId=>({type:'logistics',batchId,label:'查看来源批次'}))};
    }
    if(name==='read_production_plan'){
      const plan=args.planId?this.parkPlans.withAdoption(this.parkPlans.get(args.planId)):this.parkPlans.latest(siteId);
      invariant(!plan||plan.siteId===siteId,'SITE_MISMATCH','计划不属于当前园区。',409);
      return {data:{siteId,plan},label:'读取生产计划',summary:plan?`计划 ${plan.id}`:'尚无生产计划',sourceRefs:plan?[plan.id]:[],actions:plan?[{type:'park_plan',planId:plan.id,label:'查看生产计划'}]:[]};
    }
    if(name==='read_logistics_batches'){
      const batches=args.batchId?[this.simulation.logistics.get(args.batchId,siteId)]:this.simulation.logistics.list(siteId);
      return {data:{siteId,batches},label:'读取收胶批次',summary:`${batches.length} 个批次`,sourceRefs:batches.map(batch=>batch.id),actions:[{type:'operations',label:'查看收运加工'}]};
    }
    if(name==='prepare_operation'){
      invariant(this.actions,'ACTION_UNAVAILABLE','操作服务暂不可用。',503);
      return this.actions.prepare(args,{session,identity,turn});
    }
    if (name==='investigation_graph') {
      const evidence=turnEvidence(turn);
      turn.investigation=modelInvestigation(args,evidence,this.clock());
      return {data:{saved:true,title:turn.investigation.title,nodeCount:turn.investigation.nodes.length},label:'整理调查图',summary:turn.investigation.title,
        sourceRefs:[...new Set(turn.investigation.nodes.flatMap(node=>node.evidenceIds).flatMap(id=>evidence.find(item=>item.id===id).sourceRefs))]};
    }
    if (name==='read_tree_observations') {
      const id=args.treeId??turn.treeId;
      invariant(TREE_IDS.includes(id),'INVALID_TREE','请指定要查看的树，例如 T-0001。');
      identity?.requireTree(siteId,id);
      const context=this.makeParkContext({siteId,treeIds:[id],now:this.clock()}),modules=context.modules;
      const tree=modules.trees.find(item=>item.treeId===id);
      const observations=modules.inspection.evidence.filter(item=>item.treeId===id),health=modules.health.records.filter(item=>item.treeId===id);
      const missingSize=tree.circumferenceCm===null,kind=missingSize?'measure':siteId==='demo-hainan'?'capture':'inspect';
      return {data:{siteId,treeId:id,treeLabel:resolveTreeIdentity(siteId,id)?.label,zone:resolveTreeIdentity(siteId,id)?.zone,tree,observations,health,asOf:context.asOf,note:'已有档案与观察记录；三维补拍为模拟画面，尚未接现场相机或新图像识别。'},
        label:'读取单树观察',summary:`${park.name} ${id}：${observations.length} 条树表观察，${health.length} 条健康记录${missingSize?'，树围待复测':''}。`,
        sourceRefs:[context.snapshotId,...observations.map(item=>item.evidenceId)],actions:[
          {type:'tree_strategy',treeId:id,kind:'surface_action',label:'查看这棵树的策略'},
          {type:'review',treeId:id,kind,label:missingSize?'打开单树复测':kind==='capture'?'打开单树补拍':'打开单树核查'},
        ]};
    }
    const plot = identity?.plot?.siteId===siteId ? identity.plot : null;
    const zone = plot ? plot.zone : args.zone ?? turn.zone, selectedTree = turn.treeId;
    invariant(!zone || /^[A-D]$/.test(zone),'INVALID_ZONE','请选择 A–D 分区。');
    const ids = selectedTree ? [selectedTree] : plot ? plot.treeIds : zone ? TREE_IDS.slice('ABCD'.indexOf(zone)*50,('ABCD'.indexOf(zone)+1)*50) : TREE_IDS;
    const scopeLabel = `${park.name} · ${selectedTree ?? (zone ? `${zone}区` : '全园')}`;
    if (name==='read_park') {
      const context = this.makeParkContext({siteId,treeIds:ids,now:this.clock()});
      const trees = context.modules.trees;
      const available = trees.filter(tree=>tree.tappingStatus==='available').length;
      const selected = selectedTree ? trees : trees.filter(tree=>tree.tappingStatus!=='available'||tree.healthStatus!=='normal').slice(0,12);
      const data = {siteId,scopeLabel,asOf:context.asOf,totalTrees:trees.length,availableTrees:available,
        trees:selected.map(tree=>({treeId:tree.treeId,treeLabel:resolveTreeIdentity(siteId,tree.treeId)?.label,zone:resolveTreeIdentity(siteId,tree.treeId)?.zone,tappingStatus:tree.tappingStatus,healthStatus:tree.healthStatus,
          circumferenceCm:tree.circumferenceCm,heightM:tree.heightM})),mode:'simulation'};
      return {data,label:'读取园区档案',summary:`${scopeLabel}：${trees.length} 棵档案，${available} 棵标记可进入作业评估。`,
        sourceRefs:[context.snapshotId],actions:selectedTree?[{type:'tree_strategy',treeId:selectedTree,kind:'tapping_angle',label:'查看单树策略'}]:[]};
    }
    if (name==='read_weather') {
      const context = this.makeParkContext({siteId,treeIds:ids,now:this.clock()});
      const events = this.simulation.operationalEvents.list(siteId)
        .filter(event=>event.status!=='closed'&&(!zone||event.zone===null||'ABCD'[event.zone]===zone))
        .map(event=>scopeOperationalEvent(event,identity)).filter(Boolean);
      const rawWeather = context.modules.weather;
      const weather = {...rawWeather,timeLabel:'北京时间（UTC+8）',
        observed:{...rawWeather.observed,
          observedAt:beijingTime(rawWeather.observed.observedAt),receivedAt:beijingTime(rawWeather.observed.receivedAt),
          recentRainfall:rawWeather.observed.recentRainfall.map(item=>({...item,observedAt:beijingTime(item.observedAt)}))},
        forecast:{...rawWeather.forecast,issuedAt:beijingTime(rawWeather.forecast.issuedAt),
          steps:rawWeather.forecast.steps.map(step=>({...step,validFrom:beijingTime(step.validFrom),validTo:beijingTime(step.validTo)}))}};
      const constraints = this.simulation.effectiveConstraints(siteId).constraints
        .filter(item=>item.treeIds.some(id=>ids.includes(id)))
        .map(item=>scopeWeatherConstraint(item,identity)).filter(Boolean);
      return {data:{siteId,scopeLabel,...weather,events,constraints},
        label:'读取天气与作业条件',
        summary:`${scopeLabel}：模拟观测降雨 ${weather.observed?.rainfallMm ?? '待补充'} mm，${events.length} 项天气/设备事件待处理。`,
        sourceRefs:[weather.observed?.observationId,weather.forecast?.forecastRunId,...events.map(event=>event.id)].filter(Boolean)};
    }
    if (name==='read_tasks' || name==='read_execution_history') {
      const events = this.simulation.operationalEvents.list(siteId),parkBatches = this.simulation.logistics.list(siteId);
      const tasks = this.tasks(session,zone,selectedTree,identity).map(task=>{
        const reason = identity?.plot ? '收胶登记由园区管理确认。' : collectionIssue(task,events,parkBatches);
        return {...summarizeScopedTask(task,identity),collection:{canCollect:!reason,reason}};
      });
      const total = tasks.reduce((n,task)=>n+task.count,0),done = tasks.reduce((n,task)=>n+task.done,0);
      const sourceRefs = tasks.flatMap(task=>[task.taskId,...task.sourceRefs]);
      const actions = tasks.filter(task=>!['已完成','已取消'].includes(task.status)||task.collection.canCollect).slice(0,3)
        .map(task=>({type:'task',taskId:task.taskId,
          label:`查看 ${task.date?`${Number(task.date.slice(5,7))}月${Number(task.date.slice(8,10))}日`:'日期待核'} ${task.zone}区作业`}));
      actions.push({type:'operations',label:'查看任务与储运'});
      if (name==='read_tasks') return {data:{siteId,scopeLabel,tasks,total,done},label:'读取任务安排',
        summary:`${scopeLabel}：${tasks.length} 项任务，记录完成 ${done}/${total} 棵。`,sourceRefs,actions};
      this.refreshMemories(session);
      const taskIds = new Set(tasks.map(task=>task.taskId));
      const scopeBatches = parkBatches.filter(batch=>taskIds.has(batch.source.taskId));
      const batches = scopeBatches.map(batchFacts),production = productionFacts(scopeBatches);
      if (processingQuestion(turn.message)) actions.push(processingAction(production,turn.message));
      const completedReceipts = tasks.reduce((n,task)=>n+task.completedReceipts,0);
      const adopted = this.simulation.list(selectedTree,siteId).filter(action=>!zone||ids.includes(action.treeId));
      return {data:{siteId,scopeLabel,tasks,completedReceipts,batches,production,adopted},label:'核对执行回传',
        summary:`${scopeLabel}：${completedReceipts} 条完成回执，${batches.length} 个收胶批次；已加工入库 ${production.processedKg} 公斤干胶，到厂未入库 ${production.pendingProcessingKg} 公斤鲜胶乳（含加工中）。`,
        sourceRefs:[...sourceRefs,...batches.flatMap(batch=>[batch.batchId,batch.receiptId,batch.processing?.id,batch.processing?.inspectionId]).filter(Boolean),...adopted.map(action=>action.requestId)],actions};
    }
    if (name==='read_sales_inventory') {
      const inventory = this.simulation.salesInventory(siteId);
      const shipments = this.simulation.salesShipments.list(siteId);
      const production = productionFacts(this.simulation.logistics.list(siteId));
      const pending = shipments.filter(task=>task.status==='planned');
      const pendingKg = Math.round(pending.reduce((sum,task)=>sum+task.plannedKg,0)*100)/100;
      return {data:{siteId,scopeLabel:`${park.name} · 全园销售与库存`,inventory,production,pendingKg,pendingCount:pending.length,
        shipments:shipments.map(task=>({id:task.id,modelId:task.modelId,scenarioName:task.scenarioName,
          plannedDepartureAt:task.plannedDepartureAt,plannedKg:task.plannedKg,status:task.status,
          departureAt:task.departureAt,receipt:task.receipt})),unit:'kg 干胶'},
        label:'核对库存与销售回传',
        summary:`${park.name}：在库 ${inventory.stockKg} 公斤干胶，可售 ${inventory.availableKg} 公斤，累计加工入库 ${production.processedKg} 公斤；在途 ${inventory.inTransitKg} 公斤，已签收销售 ${inventory.soldKg} 公斤。`,
        sourceRefs:[...shipments.map(task=>task.id),...[...production.completedBatches,...production.pendingBatches]
          .flatMap(batch=>[batch.batchId,batch.taskId,batch.receiptId,batch.processing?.id,batch.processing?.inspectionId]).filter(Boolean)],
        actions:[...(processingQuestion(turn.message)?[processingAction(production,turn.message)]:[]),
          ...(/库存|销售|已售|卖|出货|发货|签收|在途|囤/.test(turn.message)?[{type:'sales_shipments',label:'查看销售出货'}]:[])]};
    }
    if (name==='read_rubber_market') {
      const data = this.rubberMarket(siteId,park.name,identity);
      return {data,label:'核对橡胶交易资料',summary:data.connection.summary,
        sourceRefs:[...data.documents,...data.publicEvidence,...data.marketReferences].map(item=>item.id),
        actions:[{type:'commodity_market',label:'查看橡胶交易对接'}]};
    }
    if (name==='read_eudr_readiness') {
      const data=this.eudr.read(siteId);
      return {data,label:'核对欧盟客户资料',summary:`${data.summary}${data.nextStep}`,
        sourceRefs:data.batches.map(batch=>batch.id),actions:[{type:'eudr_readiness',label:'查看欧盟客户资料'}]};
    }
    if (name==='read_economic_factors') {
      const monitor = this.priceFactors?.read(siteId) ?? null;
      return {data:{mode:'simulation',monitor,scenarios:ECONOMIC_SCENARIOS,machinery:calculateMachineryCase(),document:'/materials/rubber-economic-study-20261021.pdf',
        note:'体检中的期货、仓单、月度现货和公开天气是缓存的真实数据，园区价格与需求为模拟；情景系数是可核对的演示假设，老师材料中的周期、份额和价差仅作研究观点。'},
        label:'读取价格因素体检',summary:monitor?.headline ?? '将天气、需求、政策、期货情绪和劳动力变化对应到可计算情景与行动。',
        sourceRefs:['rubber-economic-study-20261021'],actions:[{type:'commodity_market',label:'查看经济研究资料'}]};
    }
    if (name==='compare_market') {
      // How far the recommended schedule leads the best feasible alternative. The model is given
      // the computed change between two plans so it never has to infer its direction.
      const lead = sales=>{
        const chosen = sales?.scenarios.find(item=>item.id===sales.recommendedScenarioId);
        const runnerUp = sales?.scenarios.filter(item=>item.feasible&&item.id!==chosen?.id).sort((a,b)=>b.comparisonValueCny-a.comparisonValueCny)[0];
        return chosen&&runnerUp ? {recommended:chosen.name,runnerUp:runnerUp.name,leadCny:Math.round((chosen.comparisonValueCny-runnerUp.comparisonValueCny)*100)/100} : null;
      };
      const keys = ['stockKg','storageKg','heldKg','transportKgPerDay','careLimit','costPerTapping','dryKgPerTapping','demandIndex','demandBaseline'];
      const previousModel = this.simulation.latestMarket(siteId).model;
      const previous = previousModel?.params ?? {};
      const inventory = this.simulation.salesInventory(siteId);
      const assumptions = args.useCurrentInventory===true||latestInventoryRequested(turn.message) ? {}
        : {...turn.inventoryAssumptions,...inventoryParameters(marketParameters(turn.message)),...inventoryParameters(args)};
      const inputs = {...turn.marketParams,...args,
        stockKg:assumptions.stockKg??inventory.stockKg,heldKg:assumptions.heldKg??inventory.heldKg};
      // The care limit is the system's shared weekly tapping scale. A stale value in an older
      // plan must not carry forward; only this turn or a remembered preference may set it.
      const inherited = key=>key==='careLimit' ? undefined : previous[key];
      const params = Object.fromEntries(keys.filter(key=>inputs[key]!==undefined||inherited(key)!==undefined)
        .map(key=>[key,inputs[key]??inherited(key)]));
      const scenarioId = args.economicScenarioId ?? turn.marketParams?.economicScenarioId ?? previousModel?.economicScenarioId ?? 'baseline';
      economicScenario(scenarioId);
      const model = this.simulation.market({...params,siteId,economicScenarioId:scenarioId});
      const sales = model.sales, choice = sales?.scenarios.find(item=>item.id===sales.recommendedScenarioId);
      const firstShipment = choice?.daily.find(row=>row.soldKg>0);
      const data = {siteId,scopeLabel:`${park.name} · 全园经营测算（不按分区分摊）`,modelId:model.id,
        params:model.params,economicScenarioId:model.economicScenarioId,economicImpact:model.economicImpact,
        recommendedFrequency:model.recommendedFrequency,eligibleTreeCount:model.eligibleTreeCount,
        excludedTreeCount:model.excludedTreeCount,sales:choice ?? null,recommendationReason:sales?.recommendationReason,
        horizonDays:sales?.horizonDays,firstShipment:firstShipment?{at:beijingTime(firstShipment.at),kg:firstShipment.soldKg}:null,
        initialInventory:{stockKg:model.params.stockKg,
          availableKg:model.params.stockKg-model.params.heldKg,heldKg:model.params.heldKg,unit:'kg 干胶'},
        inventoryAssumptions:assumptions,
        inventoryBasis:Object.keys(assumptions).length?'会话假设测算，未修改库存账本':'最新库存账本',
        currentInventory:inventory,commodityReference:this.rubberMarket(siteId,park.name,identity),
        alternatives:sales?.scenarios.map(({daily,...scenario})=>scenario),
        changeFromPrevious:changeFromPrevious(previousModel,model,lead),
        basis:sales?.basis,mode:'simulation',executionNotice:'本工具是独立的模拟销售情景，推荐割次不代表当前全园执行策略。回答本周实际割几次时使用 plan_park_tapping，以其中的经营输入、天气和就绪核验为准。'};
      return {data,label:'比较全园生产与销售',
        summary:`${park.name}销售模拟：按每周 ${model.recommendedFrequency ?? '待定'} 次比较；${choice?.name ?? '需调整经营条件'}。实际割次请查看全园割胶策略。`,
        sourceRefs:[model.id],actions:[{type:'market',modelId:model.id,label:'查看经营方案'}]};
    }
    if (name==='recall_memory' || name==='search_memory') {
      this.refreshMemories(session);
      const items = this.memory.list({...session,identity,query:args.query ?? ''}).slice(0,name==='search_memory'?8:40);
      this.memory.touch(items.map(item=>item.id));
      const personal = items.filter(item=>item.scope==='role'||item.scope==='private').length;
      return {data:{siteId,role:session.role,items:items.map(({history,...item})=>item),
        scopeNote:session.accountId?'个人记忆仅本人可见；园区记忆在本园区共享；公共记忆适用于全部园区。':'演示角色偏好、园区经验和通用流程分类，不代表真实账号权限。'},
        label:name==='search_memory'?'检索记忆':'读取已有记忆',summary:`读取 ${personal} 条${session.accountId?'个人':'角色'}偏好、${items.filter(item=>item.scope==='park').length} 条园区经验和 ${items.filter(item=>item.scope==='shared').length} 条通用流程。`,
        sourceRefs:items.flatMap(item=>item.sourceRefs),memoriesUsed:items.map(({id,title,scope})=>({id,title,scope}))};
    }
    if (name==='save_memory') {
      const item = this.memory.create({scope:args.scope??'private',topic:args.topic??'note',title:args.title,content:args.content,siteId},identity,turn.turnId);
      return {data:{item},label:'保存记忆',summary:`已保存${{private:'个人',park:'园区',shared:'公共'}[item.scope]}记忆：${item.title}`,
        sourceRefs:item.sourceRefs,memoriesUsed:[{id:item.id,title:item.title,scope:item.scope}]};
    }
    if (name==='edit_memory') {
      const item = this.memory.edit(args.memoryId,{content:args.content},identity,turn.turnId);
      return {data:{item},label:'修改记忆',summary:`已更新：${item.title}（保留 ${item.history.length} 个历史版本）`,
        sourceRefs:item.sourceRefs,memoriesUsed:[{id:item.id,title:item.title,scope:item.scope}]};
    }
    if (name==='forget_memory') {
      const item = this.memory.archive(args.memoryId,identity,args.reason??'');
      return {data:{item:{id:item.id,title:item.title,status:item.status}},label:'归档记忆',summary:`已归档：${item.title}`,sourceRefs:[item.id]};
    }
    if (name==='read_my_plot') {
      invariant(identity?.plot,'PLOT_NOT_FOUND','当前身份没有承包地块。',409);
      const data = plotSummary({identity,siteId,simulation:this.simulation,makeParkContext:this.makeParkContext,now:this.clock()});
      return {data,label:'读取我的承包地',
        summary:`${data.label}：${data.care.length} 棵需照看，已完成 ${data.completedTaps} 次割胶，估算 ${data.estimatedIncomeCny ?? '—'} 元。`,
        sourceRefs:[...data.tasks.map(task=>task.id),...data.care.map(item=>item.treeId)],
        actions:[...(data.care[0]?[{type:'tree_strategy',treeId:data.care[0].treeId,kind:'growth_plan',label:`查看 ${data.care[0].treeId} 养护`}]:[]),{type:'collection',label:'比较收胶点报价'}]};
    }
    if (name==='plan_park_tapping') {
      invariant(this.parkPlans,'PARK_PLAN_UNAVAILABLE','全园割胶策略服务未启用。',503);
      return this.parkPlans.compute(siteId,{economicScenarioId:args.economicScenarioId??turn.marketParams?.economicScenarioId??'baseline',authorize}).then(plan=>{
      const unprepared = unpreparedTreeCount(plan.readiness);
      const strategyNotice = unprepared ? `${unprepared} 棵树的树表策略已过期或尚未生成，本次把它们算作不可割，割次和产量偏低；请先在策略中心重新生成再采用。` : null;
      return {data:{planId:plan.id,headline:plan.headline,...(strategyNotice?{strategyNotice}:{}),stance:plan.stanceLabel,frequencyPerWeek:plan.frequencyPerWeek,signals:plan.signals,
        zones:plan.zones.map(({treeIndices,...zone})=>zone),production:plan.production,inventory:plan.inventory,salesHint:plan.salesHint,
        outlook:plan.outlook,weather:plan.weather,weatherCheck:plan.weatherCheck,marketTargetFrequency:plan.marketTargetFrequency,economicScenarioId:plan.economicScenarioId,economicImpact:plan.economicImpact,economics:plan.economics,economicCheck:plan.economicCheck,modelProposal:plan.modelProposal,constraintAdjustments:plan.constraintAdjustments,adopted:Boolean(plan.adoption),limitations:plan.limitations},
        label:'生成全园割胶策略',summary:strategyNotice?`${plan.headline}${strategyNotice}`:plan.headline,sourceRefs:[plan.id],actions:[{type:'park_plan',planId:plan.id,label:'查看全园割胶策略'}]};
      });
    }
    if (name==='load_skill') {
      const skill = builtInSkill(args.skillId);
      invariant(skill,'SKILL_NOT_FOUND','没有这项技能。',404);
      const marketParams = canUseAssistantTool(session,'read_sales_inventory')
        ? {...withoutCareLimit(this.simulation.latestMarket(siteId).model?.params),...turn.marketParams} : {};
      const instruction = skill.instruction({marketParams:JSON.stringify(marketParams)});
      return {data:{skillId:skill.id,title:skill.title,tools:skill.tools,instruction},label:'读取业务技能',summary:`已读取：${skill.title}`,sourceRefs:[`skill:${skill.id}`],actions:[]};
    }
    if (name==='search_conversations') {
      const hits = this.searchConversations?.(session,String(args.query??turn.message)) ?? [];
      return {data:{query:args.query??'',hits},label:'检索历史对话',summary:hits.length?`找到 ${hits.length} 段相关对话，最近一次 ${hits[0].date}。`:'没有找到相关的历史对话。',
        sourceRefs:hits.map(hit=>`turn:${hit.turnId}`),actions:[]};
    }
    if (name==='propose_market_event') {
      invariant(this.marketEvents,'EVENTS_UNAVAILABLE','事件登记服务未启用。',503);
      const event = this.marketEvents.propose({kind:args.kind,title:args.title,siteIds:args.scope==='all'?'all':[siteId],
        effectiveFrom:args.effectiveFrom,effectiveTo:args.effectiveTo,source:args.source??''},identity);
      return {data:{event,note:'待中心审批；批准且在生效期内才进入价格因素体检。'},label:'登记市场与政策事件',summary:`待审批：${event.title}（${event.kindLabel}）`,
        sourceRefs:[event.id],actions:[{type:'commodity_market',label:'查看价格因素与事件'}]};
    }
    if (name==='read_brain_evolution') {
      invariant(this.evolution,'EVOLUTION_UNAVAILABLE','大脑自我改进服务未启用。',503);
      const data = this.evolution.snapshot(siteId);
      if (!data) return {data:{available:false,routing:this.evolution.routing(siteId)},label:'读取大脑自我改进',summary:'尚未取得历史天气，先在“大脑学习与参数”页打开一次以拉取回放数据。',sourceRefs:[],actions:[{type:'cerebellum',label:'打开大脑学习与参数'}]};
      return {data,label:'读取大脑自我改进',summary:data.headline,sourceRefs:data.generations.map(item=>`v${item.version}`),actions:[{type:'cerebellum',label:'打开大脑学习与参数'}]};
    }
    if (name==='propose_cerebellum_tuning') {
      invariant(this.cerebellum,'CEREBELLUM_UNAVAILABLE','小脑参数服务未启用。',503);
      const createdBy = `assistant:${session.accountId ?? session.role}`;
      if (args.changes?.length) {
        const proposal = this.cerebellum.proposeFromModel(siteId,{changes:args.changes,rationale:args.rationale},createdBy);
        return {data:{proposal},label:'提出小脑参数提案',summary:`待审批：${proposal.expectedEffect}`,sourceRefs:[proposal.id],actions:[{type:'cerebellum',label:'审批参数调整'}]};
      }
      let fromReplay = null;
      try { fromReplay = this.evolution?.proposeFromCache(siteId,createdBy) ?? null; }
      catch (error) { if (error.code !== 'NO_IMPROVEMENT') throw error; return {data:{proposal:null,reason:error.message},label:'大脑回放小脑参数',summary:error.message,sourceRefs:[],actions:[]}; }
      if (fromReplay) return {data:{proposal:fromReplay.proposal,reason:null},label:'大脑回放小脑参数',summary:`待审批：${fromReplay.proposal.expectedEffect}`,
        sourceRefs:[fromReplay.proposal.id],actions:[{type:'cerebellum',label:'审批参数调整'}]};
      const result = this.cerebellum.reflect(siteId,{createdBy,origin:'assistant_reflection'});
      return {data:{proposal:result.proposal,feedback:result.feedback,reason:result.reason??null},label:'大脑反思小脑参数',
        summary:result.proposal?`待审批：${result.proposal.expectedEffect}`:result.reason,sourceRefs:result.proposal?[result.proposal.id]:[],
        actions:result.proposal?[{type:'cerebellum',label:'审批参数调整'}]:[]};
    }
    if (name==='remember_preference') {
      const item = this.memory.rememberPreference(session,turn.message,turn.turnId,identity);
      return {data:{item},label:'更新角色偏好',summary:`已记录：${item.content}`,
        sourceRefs:item.sourceRefs,memoriesUsed:[{id:item.id,title:item.title,scope:item.scope}]};
    }
    invariant(false,'UNKNOWN_ASSISTANT_TOOL',`没有可调用的工具：${name}`);
  }
}
