import { CATALOG, contextSchema, candidateSchemas } from './contracts.js';
import { validate } from './schema.js';
import { invariant, AppError } from './errors.js';
import { deepFreeze, round } from './util.js';
import { inventoryClaimErrors } from './industry-inventory.js';
import { industryClaimErrors } from './strategy-claims.js';
import { tappingClaimErrors } from './tapping-claims.js';
import { ANGLE_POLICY_VERSION, calculateAngleCandidate } from './angle-policy.js';
import { deriveMarketFrequencyPolicy } from './market-policy.js';
import { assessWeatherWindow, weatherAssessment, WEATHER_POLICY_VERSION } from './weather-policy.js';
import { calculatePestRiskAssessment } from './pest-policy.js';

export function walk(value, visit, path = '') {
  if (!value || typeof value !== 'object') return;
  visit(value, path);
  for (const [key, child] of Object.entries(value)) walk(child, visit, path ? `${path}.${key}` : key);
}
export function projectContext(context, kind) {
  const projected = structuredClone(context);
  projected.modules = Object.fromEntries(CATALOG.find(c => c.kind === kind).modules.filter(m => context.modules[m]).map(m => [m, structuredClone(context.modules[m])]));
  if (projected.datasets) projected.datasets = projected.datasets.filter(d => Object.hasOwn(projected.modules, d.module));
  if (projected.sourceRequirements) projected.sourceRequirements = projected.sourceRequirements.filter(d => CATALOG.find(c => c.kind === kind).modules.includes(d.module));
  if(projected.dataPolicy)projected.dataPolicy.substitutions=projected.dataPolicy.substitutions.filter(d=>CATALOG.find(c=>c.kind===kind).modules.includes(d.module));
  if (projected.modules.knowledge) projected.modules.knowledge.rules = projected.modules.knowledge.rules.filter(r => r.kind === kind);
  return deepFreeze(projected);
}
export function checkContext(request, context, now) {
  validate(contextSchema, context, 'INVALID_CONTEXT');
  invariant(context.snapshotId === request.inputSnapshot.snapshotId && context.version === request.inputSnapshot.version, 'SNAPSHOT_MISMATCH', '上下文 ID 或版本与请求不一致', 409);
  invariant(context.siteId === request.siteId && context.targetSnapshot.siteId === request.siteId && context.targetSnapshot.targetSnapshotId === request.targetSnapshotId, 'SCOPE_MISMATCH', '园区或目标快照与请求不一致', 409);
  invariant(context.executionMode === request.executionMode, 'MODE_MISMATCH', '上下文与运行环境不一致', 409);
  invariant(context.constraints.minCutSlopeDeg <= context.constraints.maxCutSlopeDeg, 'INVALID_CONSTRAINTS', '角度约束上下界不合法', 422);
  const treeIds = new Set(context.targetSnapshot.treeIds);
  invariant(request.kind === 'industry_brief' || treeIds.size > 0, 'EMPTY_TARGET', '单树/树群分析必须有目标树',422);
  invariant(request.kind !== 'industry_brief' || treeIds.size === 0, 'INVALID_TARGET', '行业研判使用独立区域范围，不绑定模拟树',422);
  walk(context.modules, object => {
    invariant(!object.treeId || treeIds.has(object.treeId), 'SCOPE_MISMATCH', '上下文包含目标快照以外的树', 409);
    invariant(!object.siteId || object.siteId === request.siteId, 'SCOPE_MISMATCH', '上下文包含其他园区的数据', 409);
    if (object.provenance && request.executionMode === 'live') invariant(object.provenance.mode !== 'simulated', 'MODE_MISMATCH', '实机请求不能使用模拟观测', 409);
  });
  const requiredModules = CATALOG.find(x => x.kind === request.kind).modules;
  const missing = (context.sourceRequirements ?? []).filter(x => requiredModules.includes(x.module));
  const add = (module, field, objectId, reason) => missing.push({ module, field, objectId, reason });
  if (Date.parse(context.validUntil) <= +now) add('context', 'validUntil', context.snapshotId, '输入快照已过期，请业务后端生成新快照');
  if (Date.parse(context.asOf) > +now + 300000 || Date.parse(context.validUntil) <= Date.parse(context.asOf)) add('context', 'asOf', context.snapshotId, '快照时间窗口无效');
  const c = projectContext(context, request.kind), m = c.modules;
  for (const module of CATALOG.find(x => x.kind === request.kind).modules) if (!m[module]) add(module, module, context.snapshotId, '本能力需要此数据模块');
  walk(m, (object, path) => {
    const objectId = object.observationId ?? object.evidenceId ?? object.ruleId ?? object.recordId ?? object.treeId ?? context.snapshotId;
    if (object.quality && object.quality !== 'valid') add(path.split('.')[0], 'quality', objectId, '记录缺失或质量可疑，需要有效数据');
    for (const field of ['observedAt', 'capturedAt', 'issuedAt', 'measuredAt', 'receivedAt', 'retrievedAt']) {
      if (object[field] && Date.parse(object[field]) > Date.parse(context.asOf) + 300000) add(path.split('.')[0], field, objectId, '记录发生在快照截止时间之后');
    }
    if (object.ruleId && Date.parse(object.validUntil) <= +now) add('knowledge', 'validUntil', object.ruleId, '规则已过期');
    if (object.observedAt && object.receivedAt && Date.parse(object.receivedAt) < Date.parse(object.observedAt)) add(path.split('.')[0], 'receivedAt', objectId, '接收时间早于采集时间');
      if (object.box && (object.box[0] + object.box[2] > 1 || object.box[1] + object.box[3] > 1)) add('inspection', 'box', object.detectionId, '归一化框超出原图边界');
      if (object.expiresAt && Date.parse(object.expiresAt) <= +now) add(path.split('.')[0], 'expiresAt', objectId, '证据已超过明确有效期');
  });
  if (!m.knowledge?.rules.some(r => r.kind === request.kind)) add('knowledge', 'rules', context.snapshotId, '缺少该能力的有版本规则');
  if (request.kind === 'industry_brief' && !m.industry?.records.length) add('industry', 'records', context.snapshotId, '没有可用的真实公共资料，请先更新数据源');
  if (m.weather) {
    const o = m.weather.observed;
    if (!o) add('weather', 'observed', context.siteId, '缺少现场观测');
    else {
      const required = request.kind === 'weather_window' ? ['rainfallMm'] : ['relativeHumidityPct', 'airTemperatureC'];
      for (const field of required) if (o[field] === null) add('weather', `observed.${field}`, o.observationId, '缺少有效观测，不能按 0 处理');
      if (+now - Date.parse(o.observedAt) > 2 * 3600000) add('weather', 'observed.observedAt', o.observationId, '现场天气超过 2 小时演示时效');
    }
    if (request.kind === 'weather_window') {
      if (!m.weather.forecast) add('weather', 'forecast', context.siteId, '缺少指定预报批次');
      else {
        const f = m.weather.forecast;
        if (+now - Date.parse(f.issuedAt) > 24 * 3600000) add('weather', 'forecast.issuedAt', f.forecastRunId, '预报批次超过 24 小时演示时效');
        const steps = f.steps.filter(s => Date.parse(s.validTo) > +now);
        if (!steps.length) add('weather', 'forecast.steps', f.forecastRunId, '没有有效的未来预报窗口');
        for (const step of steps) if (step.rainfallMm === null || step.rainProbabilityPct === null || Date.parse(step.validFrom) >= Date.parse(step.validTo)) add('weather', 'forecast.steps', f.forecastRunId, '预报数值缺失或时间窗口无效');
        const windows = new Set();
        for (const step of steps) {
          const key = `${Date.parse(step.validFrom)}/${Date.parse(step.validTo)}`;
          if (windows.has(key)) add('weather', 'forecast.steps', f.forecastRunId, '同一预报窗口重复，无法唯一核对天气数值');
          windows.add(key);
        }
      }
    }
  }
  if (request.kind === 'tapping_angle' && treeIds.size !== 1) throw new AppError('SINGLE_TREE_REQUIRED', '割线坡角能力需要单树目标快照', 422);
  for (const treeId of treeIds) {
    if (m.trees) {
      const trees = m.trees.filter(t => t.treeId === treeId);
      if (trees.length !== 1) add('trees', 'treeId', treeId, '目标树档案缺失或重复');
      else if (request.kind === 'tapping_angle') {
        if (trees[0].circumferenceCm === null) add('trees', 'circumferenceCm', treeId, '缺少尺寸记录');
        if (trees[0].tappingStatus !== 'available') add('trees', 'tappingStatus', treeId, '当前开割状态不支持生成坡角方案');
      }
    }
    if (m.tapping && m.tapping.panels.filter(p => p.treeId === treeId).length !== 1) add('tapping', 'panels', treeId, '需要唯一的当前割面记录');
    if (request.kind === 'tapping_angle' && m.tapping?.panels.find(p => p.treeId === treeId)?.plannedCutSlopeDeg === null) add('tapping', 'plannedCutSlopeDeg', treeId, '演示方法需要已采用坡角作为基准');
    if (m.inspection) {
      const evidence = m.inspection.evidence.filter(e => e.treeId === treeId);
      if (!evidence.length) add('inspection', 'evidence', treeId, '缺少树表证据');
      for (const e of evidence) if (+now - Date.parse(e.capturedAt) > 24 * 3600000) add('inspection', 'capturedAt', e.evidenceId, '树表证据超过 24 小时演示时效');
      for (const e of evidence) {
        const seen = new Map();
        for (const d of e.detections.filter(d => d.reviewStatus !== 'rejected')) {
          const key = JSON.stringify([d.classCode,d.box]);
          if (seen.has(key) && seen.get(key) !== d.intersectsPlannedLine) add('inspection', 'conflict', e.evidenceId, '同一图像位置的割线相交判断冲突，需人工复核');
          seen.set(key,d.intersectsPlannedLine);
        }
      }
    }
    if (m.growth) {
      const rows = m.growth.measurements.filter(x => x.treeId === treeId && x.circumferenceCm !== null);
      if (new Set(rows.map(x => x.observedAt)).size < 2) add('growth', 'measurements', treeId, '至少需要两个不同时间的有效尺寸样本');
      if (new Set(rows.map(x => x.measurementHeightM)).size > 1) add('growth', 'measurementHeightM', treeId, '测量部位不一致，不能直接拟合');
      const at = new Map();
      for (const row of rows) {
        const time = Date.parse(row.observedAt);
        if (at.has(time) && at.get(time) !== row.circumferenceCm) add('growth', 'measurements', treeId, '同一时间的尺寸观测存在冲突，需先复核');
        at.set(time, row.circumferenceCm);
      }
    }
    if (m.health && !m.health.records.some(x => x.treeId === treeId && +now - Date.parse(x.observedAt) <= 7 * 86400000)) add('health', 'records', treeId, '缺少 7 天内巡查记录');
  }
  if (m.market) {
    if (!m.market.prices.some(p => +now - Date.parse(p.observedAt) <= 7 * 86400000)) add('market', 'prices', context.siteId, '行情超过 7 天演示时效');
    const at = new Map();
    for (const price of m.market.prices) {
      const time = Date.parse(price.observedAt);
      if (at.has(time) && at.get(time) !== price.value) add('market', 'prices', context.siteId, '同一时点现货价存在冲突，不能任取一条计算经营贡献');
      at.set(time, price.value);
    }
    if (request.kind === 'market_scenario' && !m.market.demand) add('market', 'demand', context.siteId, '缺少市场需求指标，不能按需求联动频次');
  }
  return { context: c, missing: missing.filter((v, i, a) => a.findIndex(x => x.module === v.module && x.field === v.field && x.objectId === v.objectId) === i) };
}

export function evidenceIndex(context) {
  const map = new Map();
  walk(context.modules, object => {
    for (const key of ['observationId', 'evidenceId', 'detectionId', 'ruleId', 'recordId', 'forecastRunId', 'panelId', 'assumptionId']) if (object[key]) {
      invariant(!map.has(object[key]), 'DUPLICATE_EVIDENCE_ID', '证据标识重复，无法唯一追溯', 422);
      map.set(object[key], object);
    }
  });
  return map;
}
export function checkCandidate(kind, candidate, context, now = new Date(context.asOf)) {
  validate(candidateSchemas[kind], candidate, 'INVALID_CANDIDATE');
  const index = evidenceIndex(context), errors = [];
  const fail = message => errors.push(message);
  const trees = new Set(context.targetSnapshot.treeIds);
  const references = [...candidate.evidenceRefs, ...candidate.reasons.flatMap(r => r.sourceRefs)];
  walk(candidate.proposal, object => { if (object.sourceRefs) references.push(...object.sourceRefs); });
  if (!references.length || candidate.reasons.some(r => !r.sourceRefs.length)) fail('每条理由必须引用快照中的证据');
  for (const ref of references) if (!index.has(ref)) fail(`引用不存在的证据：${ref}`);
  walk(candidate.proposal, object => { if (object.treeId && !trees.has(object.treeId)) fail('输出包含目标以外的树'); });
  const p = candidate.proposal, m = context.modules;
  if(['demo','mixed_demo'].includes(context.dataPolicy?.mode)&&!candidate.summary.includes('模拟'))fail('演示输入的摘要必须标明“模拟”，不能伪装成真实决策');
  if (kind === 'industry_brief') {
    inventoryClaimErrors(candidate, m.industry.records).forEach(fail);
    industryClaimErrors(candidate, m.industry.records, now).forEach(fail);
    const sourceIds = new Set(m.industry.records.map(x => x.observationId));
    for (const item of [...p.findings,...p.recommendations]) if (!item.sourceRefs.length || item.sourceRefs.some(ref => !sourceIds.has(ref))) fail('每项行业判断和建议须引用本次行业资料记录，不能只引用规则');
    const simulatedIds=new Set(m.industry.records.filter(r=>r.provenance.mode==='simulated').map(r=>r.observationId));
    for(const item of p.findings)if(item.sourceRefs.some(r=>simulatedIds.has(r))&&!item.limitation.includes('模拟'))fail('使用模拟行业证据时，判断的 limitation 必须标明“模拟”');
    for(const item of p.recommendations)if(item.sourceRefs.some(r=>simulatedIds.has(r))&&!item.reason.includes('模拟'))fail('使用模拟行业证据时，建议的 reason 必须标明“模拟”');
    if (m.industry.gaps.some(gap => !p.missingData.includes(gap))) fail('行业研判遗漏已知数据缺项，必须原样保留缺项清单');
    if (Date.parse(p.horizon.start) >= Date.parse(p.horizon.end) || Date.parse(p.horizon.start) < +now - 300000 || Date.parse(p.horizon.end) <= +now || Date.parse(p.horizon.end) > +now + 7 * 86400000) fail('研判时段必须按先后顺序位于当前时间至未来七天内');
  }
  if (kind === 'weather_window') {
    if (p.forecastRunId !== m.weather.forecast.forecastRunId) fail('预报批次不一致');
    if (p.scheduleChanges.length) fail('当前上下文未提供任务版本，不允许生成具体重排');
    if (p.excludedTreeIds.some(id => !trees.has(id))) fail('排除对象超出目标');
    if (new Set(p.windows.map(w => `${w.start}/${w.end}`)).size !== p.windows.length) fail('天气窗口不能重复');
    const expectedAssessment = weatherAssessment(m.weather.observed, context.siteId);
    const assessment = p.timingAssessment;
    if (!assessment || assessment.policyVersion !== WEATHER_POLICY_VERSION) fail(`天气策略必须携带 ${WEATHER_POLICY_VERSION} 的天气与干胶联动评估`);
    if (assessment) {
      const fields = ['currentRainfallMm', 'recentRainfallTotalMm', 'recentRainfallPeakMm', 'soilMoisturePct', 'dryRubberContentPct', 'dryRubberStatus', 'wetSpell', 'soilWet', 'thresholds'];
      for (const field of fields) if (JSON.stringify(assessment[field]) !== JSON.stringify(expectedAssessment[field])) fail(`天气联动评估字段 ${field} 与输入快照不一致`);
      if (assessment.lightRainAllowed !== expectedAssessment.lightRainAllowed) fail('天气联动评估的 lightRainAllowed 必须由后端计算器生成');
    }
    for (const w of p.windows) {
      if (Date.parse(w.end) <= +now || Date.parse(w.start) < +now) fail('候选天气窗口已开始或已过期，须选择尚未开始的完整时段');
      const step = m.weather.forecast.steps.find(s => s.validFrom === w.start && s.validTo === w.end);
      if (!step || Date.parse(w.start) >= Date.parse(w.end)) fail('每个作业窗口必须完整对应 forecast.steps 中的单独一段：原样复制 validFrom/start 和 validTo/end；不得合并相邻时段或改动边界');
      const expected = assessWeatherWindow({ observed: m.weather.observed, step, siteId: context.siteId });
      if (w.suitability !== expected.suitability) fail(`天气窗口 ${w.start} 的适作结论与 ${expected.policyVersion} 计算不一致`);
      if (w.suitability === 'suitable' && !w.reason.includes('现场')) fail('适作窗口必须提示现场复核，不得包装成自动放行');
    }
  }
  if (kind === 'tapping_angle') {
    tappingClaimErrors(candidate, context).forEach(fail);
    const panel = m.tapping.panels.find(x => x.treeId === p.treeId);
    if (!panel || panel.panelId !== p.panelId || panel.plannedCutSlopeDeg !== p.previousPlannedCutSlopeDeg || panel.cutDirection !== p.cutDirection) fail('割面、基准坡角或方向与输入不一致');
    if (p.recommendedCutSlopeDeg < context.constraints.minCutSlopeDeg || p.recommendedCutSlopeDeg > context.constraints.maxCutSlopeDeg) fail('坡角超出业务参数约束');
    if (p.proposedPathRef !== null) fail('当前快照没有规划器轨迹，不得构造路径引用');
    const model = p.angleModel;
    const expectedFactorKeys = ['variety_prior', 'tree_age', 'humidity', 'soil_moisture', 'recent_rainfall', 'latex_viscosity', 'dry_rubber_content'];
    if (!model || model.version !== ANGLE_POLICY_VERSION) fail(`角度候选必须携带 ${ANGLE_POLICY_VERSION} 的逐因素计算记录`);
    if (model) {
      if (model.baselineDeg !== p.previousPlannedCutSlopeDeg) fail('角度计算基准必须复制本次输入的原计划坡角');
      if (model.recommendedCutSlopeDeg !== p.recommendedCutSlopeDeg) fail('角度计算记录中的候选角必须与策略候选角一致');
      const keys = model.factors.map(item => item.key);
      if (keys.length !== expectedFactorKeys.length || new Set(keys).size !== keys.length || expectedFactorKeys.some(key => !keys.includes(key))) fail('角度计算必须逐项记录树种、树龄、湿度、土壤、降雨、黏度和干胶因素');
      const adjustment = round(model.factors.reduce((sum, item) => sum + item.deltaDeg, 0));
      if (adjustment !== model.adjustmentDeg) fail('角度因素贡献之和与总调整量不一致');
      if (model.optimizationStatus === 'validated' || model.validity === 'validated') fail('当前快照没有配对试验和设备验证，不能把角度候选标记为已验证');
      const expected = calculateAngleCandidate({ tree: m.trees.find(item => item.treeId === p.treeId), panel, weather: m.weather.observed, asOf: context.asOf, constraints: context.constraints });
      const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
      if (model.adjustmentDeg !== expected.adjustmentDeg || model.unclampedCandidateDeg !== expected.unclampedCandidateDeg || model.clamped !== expected.clamped || model.dataCompletenessPct !== expected.dataCompletenessPct || model.confidence !== expected.confidence || model.optimizationStatus !== expected.optimizationStatus || model.validity !== expected.validity || !same(model.experimentPlan, expected.experimentPlan)) fail('角度因素记录必须与后端可复核的演示计算一致');
      for (const expectedFactor of expected.factors) {
        const actualFactor = model.factors.find(item => item.key === expectedFactor.key);
        if (!actualFactor || !same(actualFactor.inputValue, expectedFactor.inputValue) || actualFactor.unit !== expectedFactor.unit || actualFactor.deltaDeg !== expectedFactor.deltaDeg || actualFactor.sourceId !== expectedFactor.sourceId || actualFactor.provenanceMode !== expectedFactor.provenanceMode) fail(`角度因素 ${expectedFactor.key} 与输入快照不一致`);
      }
    }
  }
  if (kind === 'surface_action') {
    const expected = m.inspection.evidence.flatMap(e => e.detections.filter(d => d.reviewStatus !== 'rejected').map(d => `${e.evidenceId}:${d.detectionId}`));
    const actual = p.findings.map(f => `${f.evidenceId}:${f.detectionId}`);
    if (actual.length !== expected.length || new Set(actual).size !== actual.length || expected.some(x => !actual.includes(x))) fail('检测发现不能遗漏或重复');
    for (const f of p.findings) {
      const e = m.inspection.evidence.find(e => e.evidenceId === f.evidenceId && e.treeId === f.treeId), d = e?.detections.find(d => d.detectionId === f.detectionId);
      if (!d) { fail('检测结果与图像或树号不匹配'); continue; }
      const affects = !e.geometryRegistered || d.intersectsPlannedLine === null ? 'unknown' : d.intersectsPlannedLine ? 'yes' : 'no';
      if (f.affectsCut !== affects) fail(`检测 ${d.detectionId} 的 affectsCut 必须是 ${affects}（geometryRegistered=${e.geometryRegistered}, intersectsPlannedLine=${d.intersectsPlannedLine}）；这是几何关系，人工评估损伤的 action 不能改写该事实`);
      const structural = ['scar', 'suspected_lesion', 'nodule'].includes(d.classCode);
      const removable = ['attachment', 'bird_dropping', 'mud'].includes(d.classCode);
      if (structural && affects === 'yes' && f.action !== 'avoid_with_review') fail('结节、伤痕或疑似病斑与计划割线相交时必须形成跳刀/避让候选');
      if (removable && affects === 'no' && f.action !== 'continue_with_review') fail('割线外的鸟粪、泥巴或附着物应形成正常继续候选');
      if (f.action === 'avoid_with_review' && (affects !== 'yes' || !structural)) fail('跳刀/避让候选只能用于与割线相交的结构性异常');
      if (f.action === 'continue_with_review' && (affects !== 'no' || !removable)) fail('正常继续候选只能用于割线外的临时附着物');
    }
  }
  if (kind === 'growth_plan') {
    if (p.predictions.length !== trees.size || new Set(p.predictions.map(x => x.treeId)).size !== trees.size) fail('每棵目标树需要且仅需要一条尺寸预测');
    for (const prediction of p.predictions) {
      if (prediction.sourceRefs.length < 2 || prediction.sourceRefs.some(ref => !m.growth.measurements.some(x => x.observationId === ref && x.treeId === prediction.treeId))) fail('生长预测至少引用两个本树尺寸样本');
      if (prediction.interval && (prediction.interval.lower > prediction.value || prediction.interval.upper < prediction.value)) fail('预测区间必须包含预测值');
      if (prediction.interval !== null) fail('当前契约没有经验证的统计区间模型，不能编造预测区间');
      if (Date.parse(prediction.at) <= Date.parse(context.asOf)) fail('预测时间必须晚于快照');
      const samples = m.growth.measurements.filter(r => prediction.sourceRefs.includes(r.observationId) && r.treeId === prediction.treeId && r.circumferenceCm !== null && r.quality === 'valid').sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
      if (new Set(samples.map(r => Date.parse(r.observedAt))).size < 2 || new Set(samples.map(r => r.measurementHeightM)).size !== 1) fail('生长预测必须引用至少两个不同时间、同测量高度的有效非空观测');
      if (prediction.method !== 'demo-linear-endpoints-v1') fail('当前只支持可独立验算的 demo-linear-endpoints-v1 外推；其他方法需先接入可复核计算器');
      if (Date.parse(prediction.at) !== Date.parse(context.asOf) + 30 * 86400000) fail('当前生长演示基线仅提供快照之后 30 天的尺寸外推');
      if (samples.length >= 2 && Date.parse(samples.at(-1).observedAt) > Date.parse(samples[0].observedAt)) {
        const first = samples[0], last = samples.at(-1);
        const value = Math.round(Math.max(0, last.circumferenceCm + (last.circumferenceCm - first.circumferenceCm) / (Date.parse(last.observedAt) - Date.parse(first.observedAt)) * (Date.parse(prediction.at) - Date.parse(last.observedAt))) * 100) / 100;
        if (Math.abs(prediction.value - value) > 0.005) fail('生长外推值与所引用观测的端点直线算式不一致');
      }
    }
    for (const plan of p.futurePanelPlan) if (!m.tapping.panels.some(x => x.panelId === plan.panelId && x.treeId === plan.treeId)) fail('未来割面安排引用了不存在的割面');
  }
  if (kind === 'market_scenario') {
    if (p.instrument !== m.market.instrument || p.priceUnit !== m.market.priceUnit) fail('行情品种或单位不一致');
    if (p.scenarios.some(s => s.tappingsPerWeek > context.constraints.maxTappingsPerWeek)) fail('情景超过养护频次上限');
    if (new Set(p.scenarios.map(s => s.scenarioId)).size !== p.scenarios.length) fail('情景编号重复');
    if (p.recommendedScenarioId && !p.scenarios.some(s => s.scenarioId === p.recommendedScenarioId)) fail('推荐情景不存在');
    const policy = deriveMarketFrequencyPolicy({ market: m.market, trees: m.trees, weather: m.weather, health: m.health, maxTappingsPerWeek: context.constraints.maxTappingsPerWeek });
    if (p.eligibleTreeCount !== policy.eligible.length || p.excludedTreeCount !== trees.size - policy.eligible.length) fail('行情情景的可作业树数量必须按本次树况重新计算');
    if (p.targetFrequencyPerWeek !== policy.targetFrequencyPerWeek) fail('目标频次必须同时满足需求信号、天气约束与养护上限');
    if (!p.demandSignal || p.demandSignal.band !== policy.demand.band || p.demandSignal.value !== policy.demand.value || p.demandSignal.baselineValue !== policy.demand.baselineValue || p.demandSignal.sourceId !== (m.market.demand?.observationId ?? null) || p.demandSignal.provenanceMode !== (m.market.demand?.provenance?.mode ?? 'unknown')) fail('需求信号必须逐字段复制行情快照，不得自行改写或隐去来源');
    const normalizeExclusions = rows => JSON.stringify((rows ?? []).map(row => ({ reason: row.reason, count: row.count })).sort((a, b) => a.reason.localeCompare(b.reason)));
    if (normalizeExclusions(p.exclusions) !== normalizeExclusions(policy.exclusions)) fail('未纳入频次安排的树必须逐类说明养护、状态或数据原因');
    const expectedFrequencies = new Set(p.scenarios.map(s => s.tappingsPerWeek));
    if (!expectedFrequencies.has(0) || !expectedFrequencies.has(policy.targetFrequencyPerWeek)) fail('情景必须包含暂不新增割胶的 0 次方案和目标频次方案');
    for (const scenario of p.scenarios) if (scenario.eligibleTreeCount !== policy.eligible.length) fail('每个频次情景必须使用同一批满足作业条件的树，不能把休割或异常树计入产量');
    if ((!m.market.costAssumptions || m.market.costAssumptions.dryRubberKgPerTreeTapping === null) && p.scenarios.some(s => s.estimatedContributionCny !== null || s.expectedDryRubberKg !== null)) fail('没有成本与产量假设时不能给出精确收益和产量');
    const cost = m.market.costAssumptions;
    if (!cost || cost.dryRubberKgPerTreeTapping === null) { if (p.recommendedScenarioId !== null) fail('经营假设缺失时不得推荐收益情景'); }
    else {
      const latest = [...m.market.prices].sort((a,b) => Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
      for (const scenario of p.scenarios) {
        const kg = Math.round(cost.dryRubberKgPerTreeTapping * policy.eligible.length * scenario.tappingsPerWeek * 100) / 100;
        const contribution = Math.round((kg * latest.value - cost.costPerTreeTappingCny * policy.eligible.length * scenario.tappingsPerWeek) * 100) / 100;
        if (scenario.expectedDryRubberKg !== null && Math.abs(scenario.expectedDryRubberKg-kg) > 1e-6 || scenario.estimatedContributionCny !== null && Math.abs(scenario.estimatedContributionCny-contribution) > 1e-6) fail('经营情景数值与本次产量、价格和成本假设算式不一致');
      }
    }
  }
  if (kind === 'pest_risk') {
    if (p.inspectionTargets.some(id => !trees.has(id))) fail('巡查对象超出目标');
    if (Date.parse(p.horizon.start) >= Date.parse(p.horizon.end) || Date.parse(p.horizon.start) < +now - 300000 || Date.parse(p.horizon.end) <= +now || Date.parse(p.horizon.end) > +now + 7 * 86400000) fail('风险时段必须按先后顺序位于当前时间至未来七天内');
    const recent = m.health.records.filter(r => +now - Date.parse(r.observedAt) <= 7 * 86400000 && Date.parse(r.observedAt) <= +now + 300000 && r.quality === 'valid');
    if (new Set(p.findings.map(f => f.treeId)).size !== p.findings.length) fail('健康发现不能重复同一棵树');
    if (p.inspectionTargets.length !== p.findings.length || p.findings.some(f => !p.inspectionTargets.includes(f.treeId))) fail('巡查对象必须与健康发现逐树对应');
    if ([...trees].some(id => recent.some(r => r.treeId === id && r.symptomCodes.length) && !p.findings.some(f => f.treeId === id))) fail('不能遗漏已有近期症状记录的目标树');
    for (const f of p.findings) {
      if (f.sourceRefs.some(ref => index.get(ref)?.treeId && index.get(ref).treeId !== f.treeId)) fail('健康发现引用了其他树的记录');
      const own = recent.filter(r => r.treeId === f.treeId && f.sourceRefs.includes(r.recordId));
      const symptoms = new Set(own.flatMap(r => r.symptomCodes));
      if (!own.length || !f.sourceRefs.length) fail('健康发现至少引用一条本树近七天的有效巡查记录');
      if (f.symptomCodes.some(code => !symptoms.has(code))) fail('健康发现不能捏造未观测到的症状');
      if (new Set(f.symptomCodes).size !== f.symptomCodes.length) fail('健康发现不能重复症状');
      if (recent.filter(r => r.treeId === f.treeId).some(r => r.symptomCodes.some(code => !f.symptomCodes.includes(code)))) fail('健康发现不能遗漏该树近期已记录的症状');
    }
    if (!Array.isArray(p.riskAssessments) || p.riskAssessments.length !== context.targetSnapshot.treeIds.length || p.riskAssessments.some(a => !trees.has(a.treeId))) fail('病虫害风险评估必须覆盖全部目标树');
    for (const a of p.riskAssessments ?? []) {
      const rows = m.health.records.filter(r => r.treeId === a.treeId && Date.parse(r.observedAt) <= +now && +now - Date.parse(r.observedAt) <= 30 * 86400000 && r.quality === 'valid');
      if (a.monitoringWindowDays !== 30) fail('风险评估监测窗口必须为 30 日');
      if (a.riskIndex < 0 || a.riskIndex > 100) fail('风险指数必须在 0 至 100');
      if (a.basisSourceRefs.some(ref => index.get(ref)?.treeId && index.get(ref).treeId !== a.treeId)) fail('风险评估不能引用其他树的健康记录');
      if (!a.basisSourceRefs.length || !a.preventiveActions?.length) fail('风险评估必须有依据记录和预防性维护建议');
      if (rows.length < 2 && a.trend !== 'insufficient_history') fail('历史不足两条时必须标记为历史不足');
      const expected = calculatePestRiskAssessment({ records: m.health.records, humidityPct: m.weather.observed?.relativeHumidityPct, weatherObservationId: m.weather.observed?.observationId, treeId: a.treeId, now });
      if (a.policyVersion !== expected.policyVersion) fail(`树 ${a.treeId} 的病虫害风险评估策略版本与后端不一致`);
      for (const field of ['riskIndex', 'riskLevel', 'trend', 'monitoringWindowDays', 'observedDays', 'basisSourceRefs', 'preventiveActions', 'limitation']) {
        if (JSON.stringify(a[field]) !== JSON.stringify(expected[field])) fail(`树 ${a.treeId} 的病虫害风险评估字段 ${field} 与后端演示计算不一致`);
      }
    }
  }
  if (errors.length) throw new AppError('CANDIDATE_REJECTED', '候选建议未通过独立校验', 422, [...new Set(errors)]);
  return [
    { code: 'SCHEMA', status: 'pass', message: '类型与必需字段符合能力契约' },
    { code: 'SCOPE_AND_EVIDENCE', status: 'pass', message: '目标、证据引用及输入事实检查通过' },
    { code: 'DOMAIN_CONSTRAINTS', status: 'pass', message: '通过当前版本的业务约束检查' },
    { code: 'NATURAL_LANGUAGE_REVIEW', status: 'not_checked', message: '已拦截已知文字断言错误；自由文本全部语义、推断及未结构化数字仍需人工核对' },
    { code: 'AGRONOMIC_VALIDATION', status: 'not_checked', message: '农艺效果与预测准确性未经田间试验或专家验收，不代表真实作业适用性已验证' },
    { code: 'BUSINESS_ADOPTION', status: 'not_checked', message: '采用、授权与设备能力由业务后端另行检查' },
  ];
}
