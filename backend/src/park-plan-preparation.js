import {randomUUID} from 'node:crypto';
import {normalizeSiteId} from './adapters/park-demo.js';
import {marketTreeExclusion} from './market-policy.js';
import {digest} from './util.js';

const readyTree = (tree, context) => {
  const evidence = context.modules.inspection?.evidence?.filter(item => item.treeId === tree.treeId) ?? [];
  return (tree.siteId ?? context.siteId) === context.siteId && !marketTreeExclusion(tree) && evidence.length > 0 && evidence.every(item =>
    item.geometryRegistered === true && Array.isArray(item.detections) && item.detections.every(detection => detection.reviewStatus === 'rejected'));
};
const bindingKey = binding => binding ? JSON.stringify([binding.runId, binding.contextSnapshotId, binding.preparationId, binding.requestId]) : null;
const errorDetail = error => ({code:error?.code ?? 'SURFACE_PREPARATION_FAILED', message:error?.message ?? '树表建议准备失败'});

/** Explicit plan POST preparation only. Read-only views and startup must not call this. */
export async function prepareParkPlanSurface({siteId, dataMode = 'mixed_demo', store, runtime, makeParkContext, clock = () => new Date()}) {
  const result = {siteId, dataMode, preparedTreeIds:[], preparedAngleTreeIds:[], preserved:[], skipped:[], failures:[]};
  try {
    siteId = normalizeSiteId(siteId);
    result.siteId = siteId;
    if (siteId !== 'demo-hainan') { result.reason = 'not_rail_site'; return result; }
    if (!['demo', 'mixed_demo'].includes(dataMode)) { result.failures.push({treeIds:[], code:'INVALID_DATA_MODE', message:'树表准备数据模式无效'}); return result; }
    const now = new Date(clock());
    const context = makeParkContext({siteId, now});
    if (context.siteId !== siteId || context.targetSnapshot?.siteId !== siteId) throw Error('树表准备输入不属于当前园区');
    const hasActions = Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='simulation_actions'").get());
    const getBinding = (treeId, kind = 'surface_action') => store.getTreeViewBinding(treeId, kind, dataMode, siteId);
    const adoptedAngle = treeId => hasActions && store.db.prepare("SELECT 1 FROM simulation_actions WHERE tree_id=? AND kind='adopt_angle' AND COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? LIMIT 1").get(treeId, siteId);
    const protectedReason = (treeId, binding, at, kind = 'surface_action') => {
      if (kind === 'tapping_angle' && adoptedAngle(treeId)) return 'angle_adopted';
      const run = binding && store.getRun(binding.runId);
      if (run?.result?.strategy?.qualityReview?.status === 'withdrawn') return 'withdrawn';
      if (kind === 'surface_action' && hasActions) {
        const row = store.db.prepare("SELECT body FROM simulation_actions WHERE tree_id=? AND kind='surface_review' AND COALESCE(json_extract(body,'$.siteId'),'demo-hainan')=? ORDER BY sequence DESC LIMIT 1").get(treeId, siteId);
        const action = row && JSON.parse(row.body);
        if (action?.disposition === 'skip' && Date.parse(action.expiresAt) > +at) return 'review_skip';
      }
      return null;
    };
    const needsPreparation = (treeId, binding, freshTree) => {
      if (!binding || binding.treeId !== treeId || binding.siteId !== siteId) return true;
      const run = store.getRun(binding.runId), strategy = run?.result?.strategy;
      const input = run && store.getContext(binding.contextSnapshotId, run.request.inputSnapshot.version);
      const oldTree = input?.modules.trees?.find(tree => tree.treeId === treeId);
      return run?.status !== 'succeeded' || strategy?.kind !== 'surface_action' || strategy.siteId !== siteId
        || !(Date.parse(strategy.expiresAt) > +now) || input?.siteId !== siteId || !input?.targetSnapshot?.treeIds?.includes(treeId)
        || !oldTree || !readyTree(oldTree, input) || oldTree.tappingStatus !== freshTree.tappingStatus || oldTree.circumferenceCm !== freshTree.circumferenceCm
        || (input.dataPolicy?.mode ?? 'demo') !== dataMode
        || strategy.proposal.findings.some(finding => finding.treeId === treeId);
    };
    const candidates = [], angleCandidates = [];
    for (const tree of context.modules.trees) {
      if (!readyTree(tree, context)) { result.skipped.push({treeId:tree.treeId, reason:'current_evidence_not_ready'}); continue; }
      const binding = getBinding(tree.treeId), protection = protectedReason(tree.treeId, binding, now);
      if (protection) { result.skipped.push({treeId:tree.treeId, reason:protection}); continue; }
      // A legacy angle view also supplies its frozen tree profile to dispatch.
      // Refresh that profile only when stale and never replace any adopted angle.
      const angleBinding = getBinding(tree.treeId, 'tapping_angle');
      if (angleBinding && !adoptedAngle(tree.treeId)) {
        const run = store.getRun(angleBinding.runId);
        const oldInput = run && store.getContext(angleBinding.contextSnapshotId, run.request.inputSnapshot.version);
        const oldTree = oldInput?.modules.trees?.find(item => item.treeId === tree.treeId);
        if (!oldTree || oldTree.tappingStatus !== tree.tappingStatus || oldTree.circumferenceCm !== tree.circumferenceCm) {
          const protection = protectedReason(tree.treeId, angleBinding, now, 'tapping_angle');
          if (protection) result.skipped.push({treeId:tree.treeId, kind:'tapping_angle', reason:protection});
          else angleCandidates.push({treeId:tree.treeId, binding:bindingKey(angleBinding)});
        }
      }
      if (!needsPreparation(tree.treeId, binding, tree)) { result.preserved.push({treeId:tree.treeId, reason:'current_surface_available'}); continue; }
      candidates.push({treeId:tree.treeId, binding:bindingKey(binding)});
    }
    const batches = [];
    for (let offset = 0; offset < candidates.length; offset += 50) batches.push({kind:'surface_action', chunk:candidates.slice(offset, offset + 50)});
    for (const candidate of angleCandidates) batches.push({kind:'tapping_angle', chunk:[candidate]});
    for (const {kind, chunk} of batches) {
      const treeIds = chunk.map(item => item.treeId);
      let runId;
      try {
        const input = structuredClone(makeParkContext({siteId, treeIds, now:new Date(clock())}));
        if (input.siteId !== siteId || input.targetSnapshot?.siteId !== siteId
          || input.targetSnapshot.treeIds.length !== treeIds.length || !treeIds.every(id => input.targetSnapshot.treeIds.includes(id))
          || !treeIds.every(id => input.modules.trees.some(tree => tree.treeId === id && readyTree(tree, input)))) {
          throw Error('树表准备对象或当前证据已变化，请重新核对');
        }
        input.dataPolicy = {...input.dataPolicy, mode:dataMode,
          notices:[...(input.dataPolicy?.notices ?? []), '全园方案采用前明确准备的模拟树表规则；未调用设备，未自动确认异常。'],
          substitutions:input.dataPolicy?.substitutions ?? []};
        input.snapshotId = `input-${digest(input).slice(0,24)}`;
        store.saveContext(input);
        const requestId = `park-prepare-${randomUUID()}`;
        const accepted = runtime.submit({requestId, kind, siteId,
          targetSnapshotId:input.targetSnapshot.targetSnapshotId, inputSnapshot:{snapshotId:input.snapshotId, version:input.version},
          executionMode:'simulation', generatorMode:'demo_rules', trigger:{type:'user', eventId:requestId}});
        runId = accepted.runId;
        // Claim this bounded transparent rule run before the general model queue.
        // Store.start() in execute prevents the scheduler from executing it twice.
        await runtime.execute(runId);
        const run = store.getRun(runId), strategy = run?.result?.strategy, checkedAt = new Date(clock());
        if (run?.status !== 'succeeded' || strategy?.kind !== kind || !(Date.parse(strategy.expiresAt) > +checkedAt)
          || strategy.qualityReview?.status === 'withdrawn' || kind === 'surface_action' && strategy.proposal.findings.some(finding => treeIds.includes(finding.treeId))) {
          result.failures.push({treeIds, kind, runId, code:'SURFACE_NOT_READY', message:run?.result?.error?.message ?? '本轮规则尚未形成有效的正常结果'});
          continue;
        }
        store.transaction(() => {
          for (const item of chunk) {
            const current = getBinding(item.treeId, kind), protection = protectedReason(item.treeId, current, checkedAt, kind);
            if (protection || bindingKey(current) !== item.binding) {
              result.skipped.push({treeId:item.treeId, kind, reason:protection ?? 'binding_changed'}); continue;
            }
            const saved = store.bindTreeView({treeId:item.treeId, siteId, kind, dataMode,
              preparationId:requestId, requestId, runId, contextSnapshotId:input.snapshotId, asOf:input.asOf});
            if (saved.runId === runId) (kind === 'surface_action' ? result.preparedTreeIds : result.preparedAngleTreeIds).push(item.treeId);
            else result.skipped.push({treeId:item.treeId, kind, reason:'binding_changed'});
          }
        });
      } catch (error) { result.failures.push({treeIds, kind, ...(runId ? {runId} : {}), ...errorDetail(error)}); }
    }
  } catch (error) { result.failures.push({treeIds:[], ...errorDetail(error)}); }
  return result;
}
