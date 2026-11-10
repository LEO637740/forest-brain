import {normalizeSiteId,parkSite,TREE_IDS} from './adapters/park-demo.js';
import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';
import {collectionPointSamples} from '../../frontend/src/workspace/collectionPointData.ts';
import {unpreparedTreeCount} from './park-plan.js';
import {invariant} from './errors.js';
import {scopeTaskForIdentity} from './assistant-access.js';

// "今天需要你决定的事": the brain turns current records into a short list of
// decisions for the signed-in role instead of a wall of charts.  Each item is
// a conclusion with its reason, the records it relies on and one next action.
const LATEX_KG_PER_TAP = 1, PLOT_DRC = '干胶含量 30%';
const open = task => !['已完成','已取消'].includes(task.status);
const treeIndex = treeId => Number(treeId.slice(2)) - 1;

function completedIndices(task) {
  const evidence = taskEvidence(task);
  return new Set([...evidence.receipts.filter(row => row.outcome === 'completed').map(row => row.index),
    ...evidence.demoReceipts.filter(row => row.outcome === 'completed').map(row => row.treeIndex)]);
}

export function plotSummary({identity, siteId, simulation, makeParkContext, now}) {
  siteId = identity.requireSite(siteId);
  const plot = identity.plot;
  invariant(plot && plot.siteId === siteId, 'FORBIDDEN_PLOT', '当前园区没有本人承包地块。', 403);
  const indices = new Set(plot.treeIds.map(treeIndex));
  const context = makeParkContext({siteId, treeIds:plot.treeIds, now});
  const trees = context.modules.trees;
  const care = trees.filter(tree => tree.tappingStatus !== 'available' || tree.healthStatus !== 'normal' || tree.circumferenceCm === null)
    .map(tree => ({treeId:tree.treeId, reasons:[tree.tappingStatus !== 'available' ? {resting:'休割养护',immature:'未开割',blocked:'暂缓作业',unknown:'状态待确认'}[tree.tappingStatus] ?? tree.tappingStatus : null,
      tree.healthStatus !== 'normal' ? {watch:'健康关注',confirmed_issue:'已记录健康问题',unknown:'健康待确认'}[tree.healthStatus] : null,
      tree.circumferenceCm === null ? '树围待补测' : null].filter(Boolean)}));
  const tasks = simulation.latestTasks(siteId).filter(task => identity.seesTask(task));
  let taps = 0;
  for (const task of tasks) for (const index of completedIndices(task)) if (indices.has(index)) taps++;
  const points = (collectionPointSamples[parkSite(siteId).key] ?? []).filter(point => point.kind === '收胶点')
    .slice().sort((a, b) => b.latexPrice - a.latexPrice || a.distanceKm - b.distanceKm);
  const best = points[0] ?? null;
  return {siteId, label:plot.label, zone:plot.zone, treeCount:plot.treeIds.length, treeIds:plot.treeIds, care,
    tasks:tasks.map(task => {const scoped = scopeTaskForIdentity(task,identity);return {id:scoped.id, title:scoped.title, date:scoped.date, status:scoped.status,
      plotTrees:scoped.count};}),
    completedTaps:taps, estimatedLatexKg:taps * LATEX_KG_PER_TAP,
    estimatedIncomeCny:best ? Math.round(taps * LATEX_KG_PER_TAP * best.latexPrice * 100) / 100 : null,
    collectionPoints:points.map(point => ({id:point.id, name:point.name, distanceKm:point.distanceKm, latexPrice:point.latexPrice})),
    basis:`按本地块有效完成回执次数估算：每次约 ${LATEX_KG_PER_TAP} kg 鲜胶乳（${PLOT_DRC}），按报价最高的示例收胶点计价；不是实际称重或结算。`,
    mode:'simulation'};
}

export function workspaceBrief({identity, siteId, simulation, makeParkContext, parkPlans, cerebellum, priceFactors = null, evolution = null, strategyRefresh = null, now}) {
  siteId = normalizeSiteId(siteId);
  identity.requireSite(siteId);
  const park = parkSite(siteId), role = identity.role, items = [];
  const add = item => items.push({priority:'medium', sourceRefs:[], ...item});
  const tasks = simulation.latestTasks(siteId).filter(task => identity.seesTask(task));
  const events = simulation.operationalEvents.list(siteId).filter(event => event.status !== 'closed');
  if (role === 'grower') {
    const plot = plotSummary({identity, siteId, simulation, makeParkContext, now});
    const today = tasks.filter(task => open(task)).map(task => scopeTaskForIdentity(task,identity));
    if (events.some(event => event.kind === 'rain' && (event.zone === null || 'ABCD'[event.zone] === plot.zone)))
      add({id:'plot-rain', priority:'high', title:'今天先不割', conclusion:`${plot.zone}区有未解除的雨情，承包地今天暂缓割胶。`,
        reason:'雨中割胶容易冲走胶乳、伤树皮；等园区确认恢复后再割。', sourceRefs:events.map(event => event.id), action:{type:'assistant', label:'问问什么时候恢复', message:'我的承包地什么时候可以恢复割胶？'}});
    add({id:'plot-care', priority:plot.care.length ? 'high' : 'info', title:'我的 33 棵树',
      conclusion:plot.care.length ? `${plot.care.length} 棵需要照看：${plot.care.slice(0,3).map(item => `${item.treeId} ${item.reasons.join('、')}`).join('；')}${plot.care.length > 3 ? '…' : ''}` : '33 棵树状态正常，按计划割胶即可。',
      reason:'来自本地块树木档案与巡查记录（模拟）。', sourceRefs:plot.care.map(item => item.treeId),
      action:plot.care.length ? {type:'plot_tree', treeId:plot.care[0].treeId, label:`查看 ${plot.care[0].treeId} 养护建议`} : {type:'plot', label:'查看我的树'}});
    add({id:'plot-tasks', title:'近期割胶', conclusion:today.length ? `有 ${today.length} 项作业涉及你的地块，最近一项：${today[0].title}（${today[0].date ?? '日期待核'}）。` : '近期没有安排到你地块的割胶作业。',
      reason:'由园区统一安排机器人作业，你可以看到本地块涉及的部分。', sourceRefs:today.map(task => task.id),
      action:today.length ? {type:'task', taskId:today[0].id, label:'查看作业'} : {type:'assistant', label:'问问下一次什么时候割', message:'我的承包地下一次什么时候割胶？'}});
    add({id:'plot-income', title:'这亩地卖了多少', conclusion:plot.estimatedIncomeCny === null ? '当前园区没有收胶点报价。'
      : `已完成 ${plot.completedTaps} 次割胶，约 ${plot.estimatedLatexKg} 公斤鲜胶乳，按最高示例报价约 ${plot.estimatedIncomeCny} 元。`,
      reason:plot.basis, action:{type:'collection', label:'比较收胶点报价'}});
    return {siteId, park:park.name, role, generatedAt:now.toISOString(), plot, items, mode:'simulation'};
  }
  if (events.length) add({id:'events', priority:'high', title:'天气与设备异常',
    conclusion:events.map(event => `${event.zone === null ? '全园' : `${'ABCD'[event.zone]}区`}${event.kind === 'rain' ? '雨情' : '设备故障'}${event.status === 'resolved' ? '（已解除待确认恢复）' : ''}`).join('；'),
    reason:'异常会暂缓相关割胶、收胶和发车；确认恢复后才继续。', sourceRefs:events.map(event => event.id), action:{type:'events', label:'处理异常'}});
  const pending = tasks.filter(task => task.status === '待处理');
  if (pending.length) add({id:'pending-tasks', priority:'high', title:`${pending.length} 项作业需要处理`,
    conclusion:pending.slice(0,2).map(task => task.title).join('；'), reason:'树表异常、核验失败或执行中断后需要人工确认。',
    sourceRefs:pending.map(task => task.id), action:{type:'task', taskId:pending[0].id, label:'打开第一项'}});
  if (role === 'manager' || role === 'executive') {
    if (park.regionId) {
      const plan = parkPlans.latest(siteId, {baselineOnly:true});
      const usable = plan?.modelProposal?.mode==='llm' && !plan.weatherCheck?.needsRecompute && !plan.economicCheck?.needsRecompute && +now - Date.parse(plan.generatedAt) < 86400000;
      // A read-only workbench never generates or saves a paid model proposal.
      const currentContext=makeParkContext({siteId,now});
      const readiness=parkPlans.readiness(siteId,currentContext,now);
      const unprepared=unpreparedTreeCount(readiness);
      const background=strategyRefresh?.enabled,refreshItem=strategyRefresh?.items?.find(item=>item.kind==='park_plan');
      const refreshState=strategyRefresh?.status;
      const refreshLabel=refreshState==='running'?'后台正在更新':refreshState==='paused'?'后台更新已暂停'
        :['failed','partial'].includes(refreshState)?'后台更新未完成':'等待后台更新';
      if(!usable||unprepared) add({id:'park-plan',priority:'high',title:`本周全园割胶：${background?refreshLabel:'需由大模型生成'}`,
        conclusion:background?`${unprepared?`${unprepared} 棵树的树表策略已过期或尚未生成；`:''}尚无当前可采用的模型方案。后台每 ${strategyRefresh.intervalMinutes} 分钟更新，也可到策略中心手动生成；采用和派单仍需人工确认。`
          :unprepared?`${unprepared} 棵树的树表策略已过期或尚未生成。请在策略中心重新生成，先更新树表，再由大模型结合经营数据提出割次。`:'尚无当前可采用的模型方案，请在策略中心明确生成。',
        reason:plan?`最近方案：${plan.headline} ${plan.economicCheck?.reason??plan.weatherCheck?.reason??''}`
          :background?refreshItem?.error?.message??strategyRefresh.lastError?.message??'当前园区尚无已保存的全园模型方案；后台结果完成后会更新。':'尚未调用模型生成本周经营策略。',
        sourceRefs:plan?[plan.id]:[],action:{type:'park_plan',label:background?'查看更新或手动生成':'请大模型生成策略'}});
      else add({id:'park-plan',priority:plan.adoption?'info':plan.stance==='hold'?'medium':'high',title:`本周全园割胶：${plan.stanceLabel}`,
        conclusion:plan.headline,reason:'查看模型对各区割次的理由、使用的数据和硬约束核验结果。',
        sourceRefs:[plan.id],action:{type:'park_plan',planId:plan.id,label:plan.adoption?'查看已采用的策略':role==='manager'?'确认并采用':'查看策略'}});
      const factors = priceFactors?.read(siteId);
      if (factors) {
        const flagged = factors.factors.filter(item => item.level === 'alert' || item.level === 'watch');
        add({id:'price-factors', priority:factors.counts.alert ? 'high' : flagged.length ? 'medium' : 'info', title:'价格因素体检',
          conclusion:`${factors.headline}${factors.recommendation}`,
          reason:flagged.slice(0, 3).map(item => `${item.label}（${item.levelLabel}）：${item.action}`).join('；') || '短期与长期因素均平稳。',
          sourceRefs:flagged.map(item => item.key), action:{type:'price_factors', scenarioId:factors.recommendedScenarioId, label:'查看因素与对应动作'}});
      }
    }
    // Cached replay only: the decision list never waits on the weather archive.
    const learned = evolution?.snapshot(siteId);
    if (learned?.review.status === 'reviewed' && learned.review.verdict === 'rollback_suggested')
      add({id:'brain-review', priority:'high', title:'小脑参数上线复盘：建议回退', conclusion:learned.review.summary,
        reason:'大脑用上线后的真实早晨对比新旧参数，新参数更差。', action:{type:'cerebellum', label:'查看复盘并回退'}});
    else if (learned?.recommendation && !learned.pendingProposal)
      add({id:'brain-learn', priority:'medium', title:'大脑发现小脑规则可以改进', conclusion:learned.headline,
        reason:`${learned.experience.source === 'measured' ? '真实' : '模拟'}天气回放，按护栏只调一步，人工批准后才生效。`, action:{type:'cerebellum', label:'查看回放并生成提案'}});
    const routing = evolution?.routingEvolution?.digest(siteId);
    if (routing?.revokeSuggested.length)
      add({id:'routing-revoke', priority:'high', title:'分流下沉抽检：建议收回给大脑', conclusion:routing.revokeSuggested[0].summary,
        reason:`“${routing.revokeSuggested[0].label}”下沉后，大脑抽检与小脑结论不一致偏多。`, sourceRefs:[routing.revokeSuggested[0].id], action:{type:'cerebellum', label:'查看抽检并收回'}});
    else if (routing?.pending.length)
      add({id:'routing-pending', priority:'high', title:'分流下沉待审批', conclusion:`“${routing.pending[0].label}”拟改由小脑直接处理。`,
        reason:'大脑与小脑对照的证据附在提案里，批准后才生效，可随时收回。', sourceRefs:[routing.pending[0].id], action:{type:'cerebellum', label:'审批分流下沉'}});
    else if (routing?.candidates.length)
      add({id:'routing-learn', priority:'medium', title:'大脑发现有些情况可以交给小脑', conclusion:routing.headline,
        reason:'按历史大脑运行与小脑规则的影子对照得出；下沉后每 5 次仍抽 1 次交大脑复核。', action:{type:'cerebellum', label:'查看对照并提议下沉'}});
    const proposals = cerebellum.proposals(siteId).filter(item => item.status === 'pending');
    if (proposals.length) add({id:'cerebellum', priority:'high', title:'小脑参数调整待审批', conclusion:proposals[0].expectedEffect,
      reason:proposals[0].summary, sourceRefs:[proposals[0].id], action:{type:'cerebellum', label:'审批参数调整'}});
    if (role === 'manager') {
      const inventory = simulation.salesInventory(siteId);
      const storage = simulation.latestMarket(siteId).model?.params?.storageKg ?? 900;
      if (inventory.stockKg / storage >= 0.85) add({id:'inventory', priority:'high', title:'仓容紧张',
        conclusion:`在库 ${inventory.stockKg} 公斤干胶，占仓容 ${Math.round(inventory.stockKg / storage * 100)}%。`,
        reason:'库存过高会挤占新入库空间，建议先安排销售出货。', action:{type:'assistant', label:'让大脑比较销售方案', message:'仓容紧张，比较一下销售方案，先卖多少？'}});
    }
  }
  if (role === 'operator') {
    const running = tasks.filter(task => task.status === '执行中' || task.status === '待开始');
    add({id:'fleet', priority:running.length ? 'medium' : 'info', title:'机器人作业队列', conclusion:running.length ? `${running.length} 项待执行或执行中，最近：${running[0].title}。` : '当前没有待执行的割胶作业。',
      reason:'派发前会再次核验策略、天气和设备状态。', sourceRefs:running.map(task => task.id), action:{type:'robots', label:'查看机器人'}});
  }
  if (!items.length) add({id:'clear', priority:'info', title:'当前没有待决事项', conclusion:'作业、异常和审批都已处理。', reason:'可以直接问大脑下一步安排。', action:{type:'assistant', label:'问今天怎么安排', message:'今天怎么安排？'}});
  const order = {high:0, medium:1, info:2};
  items.sort((a, b) => order[a.priority] - order[b.priority]);
  return {siteId, park:park.name, role, generatedAt:now.toISOString(), items, mode:'simulation'};
}
