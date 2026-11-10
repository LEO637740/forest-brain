import {DEMO_EXCEPTION_CASES,TREE_IDS,normalizeSiteId} from './adapters/park-demo.js';
import {marketTreeExclusion} from './market-policy.js';
import {digest} from './util.js';
import {invariant} from './errors.js';

const KIND_PRIORITY = ['rest','measure','capture','inspect','refresh'];
// Hour-long tree strategies that the next explicit preparation (plan POST or the
// launcher's 45-minute refresh) supplies by itself; no person has to act.
export const PREPARABLE_SURFACE_REASONS = Object.freeze({missing:'树表策略尚未生成，请刷新建议', expired:'树表策略已过期，请刷新建议'});
const DETECTION_LABELS = {scar:'伤痕',suspected_lesion:'疑似病斑',nodule:'结节',bird_dropping:'鸟粪附着',mud:'泥巴附着',attachment:'附着物'};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const evidenceFor = (context,treeId) => (context.modules.inspection?.evidence ?? []).filter(item=>item.treeId===treeId);
const activeDetections = evidence => evidence.flatMap(item=>(item.detections ?? []).filter(detection=>detection.reviewStatus!=='rejected'));
const addIssue = (issues,reason,reviewKind) => {if(!issues.some(item=>item.reason===reason))issues.push({reason,reviewKind});};
const storedContext = (store,simulation,strategy) => {
  if(simulation)return simulation.strategyContext(strategy);
  const run=store.getRun(strategy.runId),input=run?.request?.inputSnapshot;
  return store.getRunContext(strategy.runId) ?? (input ? store.getContext(input.snapshotId,input.version) : null);
};
function actionsFor(store,simulation,treeId,siteId) {
  if(simulation)return simulation.list(treeId,siteId);
  if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='simulation_actions'").get())return [];
  return store.db.prepare("SELECT body FROM simulation_actions WHERE tree_id=? AND COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? ORDER BY sequence DESC")
    .all(treeId,siteId).map(row=>JSON.parse(row.body));
}

/** Evidence identity/time changes alone do not change what the robot would encounter. */
function surfaceSignature(context,treeId) {
  return digest(evidenceFor(context,treeId).map(item=>({geometryRegistered:item.geometryRegistered===true,
    detections:(item.detections ?? []).filter(detection=>detection.reviewStatus!=='rejected')
      .map(detection=>({classCode:detection.classCode,intersectsPlannedLine:detection.intersectsPlannedLine ?? null}))
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

// ReviewWorkflow.apply projects a completed inspect/clear onto both the image
// evidence and a new, empty health observation with the same review identity.
// A capture-only clear does not manufacture a healthy tree assessment.
function healthClearedByOverlay(context,treeId) {
  const evidence=evidenceFor(context,treeId);
  return (context.modules.health?.records ?? []).some(record=>record.treeId===treeId
    && record.quality==='valid' && record.symptomCodes.length===0
    && record.provenance?.sourceId===record.recordId
    && evidence.some(item=>item.evidenceId===record.recordId && item.geometryRegistered===true
      && !(item.detections ?? []).some(detection=>detection.reviewStatus!=='rejected')));
}

function matchingSurfaceReview({treeId,siteId,context,now,store,simulation,dispatchDataMode,requiredStrategyId}) {
  if(!store)return null;
  for(const action of actionsFor(store,simulation,treeId,siteId)) {
    if(action.kind!=='surface_review' || action.treeId!==treeId || (action.siteId ?? 'demo-hainan')!==siteId
      || requiredStrategyId && action.strategyId!==requiredStrategyId
      || dispatchDataMode && action.dataMode!==undefined && action.dataMode!==dispatchDataMode
      || !(Date.parse(action.expiresAt)>+now))continue;
    const strategy=store.getStrategy(action.strategyId);
    if(strategy?.kind!=='surface_action' || !strategy.proposal.findings.some(finding=>finding.treeId===treeId))continue;
    const input=storedContext(store,simulation,strategy);
    if(dispatchDataMode && (action.dataMode ?? input?.dataPolicy?.mode ?? 'demo')!==dispatchDataMode)continue;
    if(simulation ? !simulation.strategyValidity(action).valid
      : strategy.qualityReview?.status==='withdrawn' || !(Date.parse(strategy.expiresAt)>+now)
        || !(input?.targetSnapshot?.treeIds ?? []).includes(treeId)
        || (strategy.siteId ?? 'demo-hainan')!==siteId
        || store.getTreeViewBinding(treeId,'surface_action',action.dataMode ?? input?.dataPolicy?.mode ?? 'demo',siteId)?.runId!==strategy.runId)continue;
    if(!input || surfaceSignature(input,treeId)!==surfaceSignature(context,treeId))continue;
    return action; // The newest valid skip must not resurrect an older allow.
  }
  return null;
}

/** Known checks used by the live Hainan rail path; no generation or mutation. */
export function treeExecutionReadinessIssues({treeId,siteId,context,now=new Date(),store,simulation,dispatchDataMode='mixed_demo',surfaceTasks}) {
  siteId=normalizeSiteId(siteId);
  if(siteId!=='demo-hainan' || !store)return [];
  const issues=[];
  const treeIndex=Number(treeId.slice(2))-1;
  if((surfaceTasks ?? simulation?.latestTasks(siteId) ?? []).some(task=>task.site==='hainan' && task.story==='surface'
    && !['已完成','已取消'].includes(task.status) && task.treeIndices?.includes(treeIndex)))
    addIssue(issues,'已有树表处理任务待回传','inspect');
  for(const [kind,label] of [['surface_action','树表'],['tapping_angle','角度']]) {
    const bound=store.getTreeViewBinding(treeId,kind,dispatchDataMode,siteId);
    if(!bound)continue;
    const sourceRun=store.getRun(bound.runId);
    const input=sourceRun && store.getContext(bound.contextSnapshotId,sourceRun.request?.inputSnapshot?.version ?? 1);
    const tree=input?.modules?.trees?.find(item=>item.treeId===treeId);
    if(!sourceRun || !input || !tree)addIssue(issues,`${label}策略视图缺少当前树的运行或输入档案，请刷新建议`,'refresh');
    else if((input.siteId ?? 'demo-hainan')!==siteId || tree.siteId!==undefined && tree.siteId!==siteId)
      addIssue(issues,`${label}策略视图的树木园区不一致，请刷新建议`,'refresh');
    else if(tree.tappingStatus==='resting')addIssue(issues,`${label}策略引用的树档案仍为休割，请刷新建议`,'refresh');
    else if(tree.circumferenceCm===null)addIssue(issues,`${label}策略引用的树档案缺少树围，请刷新建议`,'refresh');
  }
  const binding=store.getTreeViewBinding(treeId,'surface_action',dispatchDataMode,siteId);
  const run=binding && store.getRun(binding.runId),strategy=run?.result?.strategy;
  if(!binding)addIssue(issues,PREPARABLE_SURFACE_REASONS.missing,'refresh');
  else if(!strategy || run.status!=='succeeded')addIssue(issues,run?.status==='queued'||run?.status==='running'
    ? '树表策略仍在生成，请完成后重新测算' : '树表策略尚不可用，请刷新建议','refresh');
  else if(strategy.kind!=='surface_action' || (strategy.siteId ?? 'demo-hainan')!==siteId)
    addIssue(issues,'树表策略的类型或园区不一致，请刷新建议','refresh');
  else if(strategy.qualityReview?.status==='withdrawn')addIssue(issues,'树表策略已撤回，请刷新建议','refresh');
  else if(!(Date.parse(strategy.expiresAt)>+now))addIssue(issues,PREPARABLE_SURFACE_REASONS.expired,'refresh');
  else {
    const input=storedContext(store,simulation,strategy);
    if(!input || surfaceSignature(input,treeId)!==surfaceSignature(context,treeId))
      addIssue(issues,'树表策略与当前证据不符，请刷新建议','refresh');
    else {
      const findings=strategy.proposal.findings.filter(finding=>finding.treeId===treeId);
      if(findings.length) {
        const review=matchingSurfaceReview({treeId,siteId,context,now,store,simulation,dispatchDataMode,requiredStrategyId:strategy.strategyId});
        if(review?.disposition!=='allow')addIssue(issues,review?.disposition==='skip'
          ? '此前选择跳过本次割胶，需重新核查后再判断' : '本树树表策略中的异常尚未复核放行',
          findings.some(finding=>finding.action==='capture')?'capture':'inspect');
      }
    }
  }
  const adoptedAngle=simulation?.list(treeId,siteId).find(action=>action.kind==='adopt_angle' && action.treeId===treeId
    && (action.siteId ?? 'demo-hainan')===siteId);
  if(adoptedAngle) {
    const validity=simulation.strategyValidity(adoptedAngle);
    const current=store.getTreeViewBinding(treeId,'tapping_angle',dispatchDataMode,siteId);
    const currentStrategy=current && store.getRun(current.runId)?.result?.strategy;
    if(!validity.valid || currentStrategy?.strategyId!==adoptedAngle.strategyId)
      addIssue(issues,`已采用割胶角度失效或已有新版本（${validity.reason ?? '当前执行模式的角度策略已变化'}），请重新采用角度`,'refresh');
  }
  return issues;
}

/** Complete per-tree preflight. Omitting store/simulation inspects only current evidence. */
export function assessParkReadiness({siteId,context,now=new Date(),store,simulation,dispatchDataMode='mixed_demo'}) {
  siteId=normalizeSiteId(siteId);
  invariant(context.siteId===undefined || normalizeSiteId(context.siteId)===siteId,
    'READINESS_SITE_MISMATCH','预检资料不属于当前园区。',409);
  const trees=new Map((context.modules.trees ?? []).map(tree=>[tree.treeId,tree]));
  const readyTrees=[],reviewTrees=[];
  const surfaceTasks=simulation?.latestTasks(siteId) ?? [];
  for(const [treeIndex,treeId] of TREE_IDS.entries()) {
    const tree=trees.get(treeId),zone='ABCD'[Math.floor(treeIndex/50)],issues=[];
    if(tree?.siteId!==undefined && tree.siteId!==siteId)addIssue(issues,'树木档案不属于当前园区，请刷新资料','refresh');
    const evidence=evidenceFor(context,treeId);
    const review=matchingSurfaceReview({treeId,siteId,context,now,store,simulation,
      dispatchDataMode:siteId==='demo-hainan'?dispatchDataMode:undefined});
    const surfaceAllowed=review?.disposition==='allow';
    const assessed=tree && tree.healthStatus==='watch' && (surfaceAllowed || healthClearedByOverlay(context,treeId))
      ? {...tree,healthStatus:'normal'} : tree;
    const primary=marketTreeExclusion(assessed);
    if(primary)addIssue(issues,primary,!tree?'refresh':tree.tappingStatus==='resting'?'rest'
      :!finite(tree.circumferenceCm)?'measure':'inspect');
    if(tree) {
      // marketTreeExclusion returns only its first failure; keep all independent reasons.
      if(!finite(tree.circumferenceCm))addIssue(issues,'缺少树围测量','measure');
      if(assessed.healthStatus==='watch' || assessed.healthStatus==='confirmed_issue')addIssue(issues,'健康状态需复核','inspect');
      if(assessed.healthStatus==='unknown')addIssue(issues,'健康状态未知','inspect');
    }
    if(!evidence.length)addIssue(issues,'缺少树表影像，需要补拍','capture');
    else {
      if(evidence.some(item=>item.geometryRegistered!==true))addIssue(issues,'树表与割线未配准，需要补拍','capture');
      if(!surfaceAllowed)for(const detection of activeDetections(evidence))
        addIssue(issues,`树表存在${DETECTION_LABELS[detection.classCode] ?? detection.classCode}，需要现场评估`,'inspect');
    }
    for(const issue of treeExecutionReadinessIssues({treeId,siteId,context,now,store,simulation,dispatchDataMode,surfaceTasks}))
      addIssue(issues,issue.reason,issue.reviewKind);
    if(issues.length)reviewTrees.push({treeId,treeIndex,zone,reasons:issues.map(item=>item.reason),
      reviewKind:KIND_PRIORITY.find(kind=>issues.some(issue=>issue.reviewKind===kind)) ?? 'refresh'});
    else readyTrees.push({treeId,treeIndex,zone});
  }
  return {checkedAt:now.toISOString(),readyCount:readyTrees.length,reviewCount:reviewTrees.length,totalCount:TREE_IDS.length,
    readyTrees,reviewTrees,exceptionCases:DEMO_EXCEPTION_CASES.map(item=>({...item}))};
}

/** Time and display-only metadata must not make an unchanged preflight stale. */
export function readinessFingerprint(readiness) {
  return digest({readyTrees:readiness.readyTrees,reviewTrees:readiness.reviewTrees});
}
