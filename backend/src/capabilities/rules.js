import { iso, round } from '../util.js';
import { ResearchPartnerAdapter, FarmerExpertAdapter } from '../adapters/demo-sources.js';
import { invariant } from '../errors.js';
import { INDUSTRY_POLICY } from '../industry-policy.js';
import { calculateAngleCandidate } from '../angle-policy.js';
import { deriveMarketFrequencyPolicy } from '../market-policy.js';
import { assessWeatherWindow, weatherAssessment } from '../weather-policy.js';
import { calculatePestRiskAssessment } from '../pest-policy.js';
const policyRows = [...new ResearchPartnerAdapter().read({ treeIds:[], now:new Date(0) }).rules, ...new FarmerExpertAdapter().read({ treeIds:[], now:new Date(0) }).rules];
const supportedRules = new Map(policyRows.map(r => [r.kind,r]));
supportedRules.set('industry_brief', INDUSTRY_POLICY);

const measurementValue = measurement => measurement && typeof measurement === 'object' ? measurement.value : measurement;
const measurementLabel = (measurement, label) => {
  if (!measurement) return `${label}缺失，需补测`;
  const value = measurementValue(measurement), mode = measurement.provenance?.mode ?? 'unknown';
  if (value === null || value === undefined) return `${label}缺失（来源 ${measurement.provenance?.sourceId ?? 'unknown'}），需补测`;
  return `${label}${value}${measurement.unit ? ` ${measurement.unit}` : ''}（${mode}，来源 ${measurement.provenance?.sourceId ?? 'unknown'}）`;
};
const recentRainfall = observed => (observed?.recentRainfall ?? []).filter(x => x.quality === 'valid' && Number.isFinite(x.rainfallMm));
const recentRainfallTotal = observed => recentRainfall(observed).reduce((sum, x) => sum + x.rainfallMm, 0);

const base = (kind, context, summary, refs, proposal) => {
  const rule = context.modules.knowledge.rules.find(r => r.kind === kind);
  const evidenceRefs = [...new Set([...refs, rule.ruleId])];
    const mixed=['demo','mixed_demo'].includes(context.dataPolicy?.mode);
  return { summary:mixed?`【含模拟数据的演示】${summary}`:summary, reasons: [{ text: rule.text, sourceRefs: [rule.ruleId] }, { text: kind==='industry_brief'?'按本次冻结资料整理来源、范围、统计期和复核事项；生成器为演示规则，输入中真实与模拟资料各自保留来源标记。':mixed?'按固定快照进行演示推算；真实与模拟来源分别标注，本结果不代表实际园区情况。':'按本次固定快照中的相关数据形成候选；所有数字均为模拟数据或演示假设。', sourceRefs: refs }], evidenceRefs, proposal };
};
export const handlers = {
  industry_brief(context, now) {
    const records=context.modules.industry.records;
    const priorityTopics=new Set(['production_sales','processing','inventory','transport','commodity_reference','zhejiang_rubber']);
    const selected=[...records.filter(record=>priorityTopics.has(record.topic)),...records.filter(record=>!priorityTopics.has(record.topic))].slice(0,12);
    const findings=selected.map(record=>({topic:record.topic,
      assessment:`已纳入本主题的资料：范围为${record.scope}；资料期为${record.period}。历史统计和旧报告不能转换成当前园区预测。`,
      sourceRefs:[record.observationId],
      limitation:record.provenance.mode==='simulated'?'模拟记录仅支持接口和经营情景演示，不是实际企业事实。':'公开资料有其地区、统计期和发布口径，不能代替园区现场或企业记录。'}));
    const reviewActions={weather:'核实园区位置并补齐现场观测',market:'核对交易日、期货合约及实际现货成交口径',
      warehouse:'核对交易所仓单口径，另行补齐企业批次库存',
      production_national:'按年度统计期复核全国供给资料',production_hainan:'按年度统计期复核海南产量资料',
      monthly_report:'按报告月份复核价格、供给和进口口径',bulletin:'核对公告日期和病虫害指导的适用条件',pest_updates:'核对指导日期、适用条件与园区真实巡查记录',
      production_sales:'核对产销计量单位、订单数量及实际现货销售记录',
      processing:'先复核加工批次质检结论，再确认交接条件',inventory:'核对企业批次的可用、预留和质检冻结库存',
      transport:'核对运输延期、预计到达与订单交期',
      commodity_reference:'核对本园干胶的胶种牌号、质检报告及交收材料，再准备询价',
      zhejiang_rubber:'参考橡胶现货仓单案例，向交易中心了解交收与询价流程'};
    const reviewReasons={
      commodity_reference:'材料将橡胶列为原有品种，未细分胶种和牌号；需核实本园产品与交收要求后再对接。',
      zhejiang_rubber:'已保存案例为橡胶现货仓单融资业务；融资额度不是橡胶价格，案例品种不代表本园干胶已可挂牌。',
    };
    const recommendations=selected.map(record=>({priority:'medium',
      action:reviewActions[record.topic]??'按来源与资料期复核本主题记录',
      reason:record.provenance.mode==='simulated'?'本项引用模拟记录，应补齐真实业务资料后再形成实际经营安排。':reviewReasons[record.topic]??'本项只依据已保存公开资料，不作确定的生产、库存、运输或收益安排。',
      sourceRefs:[record.observationId]}));
    return base('industry_brief',context,'已按来源、范围和资料期整理行业与经营资料；这是规则演示，需人工复核',records.map(record=>record.observationId),{
      horizon:{start:iso(now),end:iso(now,86400000)},findings,recommendations,
      missingData:[...context.modules.industry.gaps],
      uncertainty:'规则演示仅整理已有资料与复核事项，不是大模型研判、当前趋势预测或经验证的经营方案。',reviewRequired:true});
  },
  weather_window(context, now) {
    const { observed: o, forecast: f } = context.modules.weather;
    const windows = f.steps.filter(s => Date.parse(s.validFrom) >= +now).map(step => {
      const assessment = assessWeatherWindow({ observed: o, step, siteId: context.siteId });
      return { start: step.validFrom, end: step.validTo, suitability: assessment.suitability, reason: assessment.reason };
    });
    const available = windows.filter(w => w.suitability === 'suitable').length;
    const assessment = weatherAssessment(o, context.siteId);
    return base('weather_window', context, available ? `找到 ${available} 个可供复核采用的作业窗口` : '当前没有可直接推荐的作业窗口', [o.observationId, f.forecastRunId, ...recentRainfall(o).map(x => x.observationId)], { forecastRunId: f.forecastRunId, windows, timingAssessment: assessment, scheduleChanges: [], excludedTreeIds: [] });
  },
  tapping_angle(context) {
    const m = context.modules, tree = m.trees[0], panel = m.tapping.panels[0];
    const angleModel = calculateAngleCandidate({ tree, panel, weather: m.weather.observed, asOf: context.asOf, constraints: context.constraints });
    const recommended = angleModel.recommendedCutSlopeDeg;
    const soil = m.weather.observed.soilMoisture;
    const historyTotal = recentRainfallTotal(m.weather.observed);
    const assayRefs = [panel.latexViscosity, panel.dryRubberContent].filter(Boolean).map(x => x.provenance?.sourceId).filter(Boolean);
    const changedFactors = angleModel.factors.filter(item => item.deltaDeg !== 0).map(item => `${item.label}${item.deltaDeg > 0 ? '+' : ''}${item.deltaDeg}°`);
    return base('tapping_angle', context, `${tree.treeId} 候选割线坡角 ${recommended}°；按树种、树龄、环境和胶乳字段形成可追溯候选，仍需农艺与设备侧确认`, [panel.panelId, m.weather.observed.observationId, ...recentRainfall(m.weather.observed).map(x => x.observationId)], {
      treeId: tree.treeId, panelId: panel.panelId, recommendedCutSlopeDeg: recommended, previousPlannedCutSlopeDeg: panel.plannedCutSlopeDeg,
      angleReference: 'horizontal', cutDirection: panel.cutDirection, proposedPathRef: null,
      conditions: ['仅适用于当前目标树和割面', '需要农艺人员确认演示参数', `本次实际参与计算的因素：${changedFactors.length ? changedFactors.join('、') : '无，保留基准角'}`, measurementLabel(soil, '土壤湿度'), `近 7 日降雨历史累计 ${round(historyTotal)} mm`, measurementLabel(panel.latexViscosity, '胶乳黏度'), measurementLabel(panel.dryRubberContent, '干胶含量'), assayRefs.length ? `assay 来源已标记：${assayRefs.join('、')}` : '胶乳 assay 字段缺失，需补测', `输入完整度 ${angleModel.dataCompletenessPct}%；当前为 ${angleModel.optimizationStatus}，不能称为最优角度`, ...angleModel.experimentPlan, '实际参数仅能由设备回执填写；本演示未证明角度调整带来农艺效果'], method: angleModel.version, angleModel,
    });
  },
  surface_action(context) {
    const evidence = context.modules.inspection.evidence, findings = [], followupSuggestions = [];
    for (const e of evidence) {
      for (const d of e.detections.filter(d => d.reviewStatus !== 'rejected')) {
        const affectsCut = !e.geometryRegistered || d.intersectsPlannedLine === null ? 'unknown' : d.intersectsPlannedLine ? 'yes' : 'no';
        // Structural findings that intersect the planned line produce an
        // explicit avoid/skip candidate; temporary surface attachments away
        // from the line produce an explicit continue candidate.  The
        // geometry gate is intentional: a nodule outside the planned line
        // does not justify changing the cut, while mud on the line cannot be
        // silently treated as harmless.
        const structural = ['scar', 'suspected_lesion', 'nodule'].includes(d.classCode);
        const removable = ['attachment', 'bird_dropping', 'mud'].includes(d.classCode);
        const action = affectsCut === 'unknown' ? 'capture'
          : structural && affectsCut === 'yes' ? 'avoid_with_review'
          : removable && affectsCut === 'no' ? 'continue_with_review'
          : 'manual_assessment';
        const classLabel = { scar: '伤痕', attachment: '附着物', suspected_lesion: '疑似病斑', nodule: '结节', bird_dropping: '鸟粪', mud: '泥巴' }[d.classCode] ?? d.classCode;
        const reason = affectsCut === 'unknown' ? `${classLabel}图像与计划割线尚未配准，先补拍或复核`
          : action === 'avoid_with_review' ? `发现${classLabel}与计划割线相交，形成跳刀/避让候选，复核后再规划执行`
          : action === 'continue_with_review' ? `当前标记为割线外${classLabel}，清理或确认后正常继续割胶，不误触发跳刀`
          : `发现${classLabel}或割线冲突，先进行人工评估`;
        findings.push({ evidenceId: e.evidenceId, detectionId: d.detectionId, treeId: e.treeId, affectsCut, action, reason });
        if (action !== 'continue_with_review' && !followupSuggestions.some(s => s.treeId === e.treeId)) followupSuggestions.push({ treeId: e.treeId, taskType: action === 'capture' ? 'capture' : 'inspect', reason });
      }
    }
    return base('surface_action', context, followupSuggestions.length ? `${followupSuggestions.length} 棵树建议补拍或人工巡查` : '已整理树表发现，未生成设备处理命令', evidence.map(e => e.evidenceId), { findings, followupSuggestions });
  },
  growth_plan(context) {
    const predictions = context.targetSnapshot.treeIds.map(treeId => {
      const rows = context.modules.growth.measurements.filter(x => x.treeId === treeId && x.circumferenceCm !== null).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
      const first = rows[0], last = rows.at(-1), days = (Date.parse(last.observedAt) - Date.parse(first.observedAt)) / 86400000;
      // An explicit toy baseline, not a trained biological model or confidence interval.
      const targetAt = iso(context.asOf, 30 * 86400000);
      const horizonDays = (Date.parse(targetAt) - Date.parse(last.observedAt)) / 86400000;
      return { treeId, metric: 'circumference_cm', at: targetAt, value: round(Math.max(0, last.circumferenceCm + (last.circumferenceCm - first.circumferenceCm) / days * horizonDays)), interval: null, method: 'demo-linear-endpoints-v1', sourceRefs: rows.map(r => r.observationId) };
    });
    const futurePanelPlan = context.modules.tapping.panels.map(p => ({ treeId: p.treeId, panelId: p.panelId, action: 'review_before_rotation', reason: '缺少耗皮和恢复记录，轮换前先复核；不推算真实轮换日期' }));
    return base('growth_plan', context, `已生成 ${predictions.length} 棵树的 30 天尺寸趋势示例`, predictions.flatMap(p => p.sourceRefs), { predictions, futurePanelPlan });
  },
  market_scenario(context) {
    const market = context.modules.market, cost = market.costAssumptions;
    const price = [...market.prices].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    const hasCost = cost?.dryRubberKgPerTreeTapping != null;
    const policy = deriveMarketFrequencyPolicy({ market, trees: context.modules.trees, weather: context.modules.weather, health: context.modules.health, maxTappingsPerWeek: context.constraints.maxTappingsPerWeek });
    const count = policy.eligible.length;
    const scenarios = Array.from({ length: context.constraints.maxTappingsPerWeek + 1 }, (_, frequency) => {
      const kg = hasCost ? round(cost.dryRubberKgPerTreeTapping * count * frequency) : null;
      return { scenarioId: `scenario-${frequency}`, tappingsPerWeek: frequency, eligibleTreeCount: count, expectedDryRubberKg: kg, estimatedContributionCny: hasCost ? round(kg * price.value - cost.costPerTreeTappingCny * count * frequency) : null, reason: hasCost ? `需求信号${policy.demand.band}；${policy.reasons.join('；')}。按${count}棵满足养护条件的树计算，未计固定成本、生物反馈和未售库存，不是利润预测` : `需求信号${policy.demand.band}；${policy.reasons.join('；')}。缺少完整成本或单次产量假设，仅比较频次，不估计经营贡献` };
    });
    const best = hasCost ? scenarios.find(s => s.tappingsPerWeek === policy.targetFrequencyPerWeek) : null;
    const refs = [...market.prices.map(p => p.observationId), ...(market.demand ? [market.demand.observationId] : []), ...(cost ? [cost.assumptionId] : []), ...(context.modules.weather?.observed ? [context.modules.weather.observed.observationId] : [])];
    const result = base('market_scenario', context, hasCost ? `结合价格、需求、天气与树体状态完成一周动态频次比较：目标每周 ${policy.targetFrequencyPerWeek} 次` : '已列出行情驱动的频次情景，补齐经营假设后再计算贡献', refs, {
      instrument: market.instrument, currency: market.currency, priceUnit: market.priceUnit,
      assumptions: ['期间：未来一周；干胶计量；报价、需求和单次产量均需保留来源与 simulated/measured 状态', `目标树数 ${context.targetSnapshot.treeIds.length}；符合当前作业、树围和健康条件 ${count} 棵；养护上限每周 ${context.constraints.maxTappingsPerWeek} 次`, ...policy.reasons, policy.limitation, '不声称增产效果；未计入人工之外的固定成本、价格波动、订单履约和树体长期反馈', ...(hasCost ? [] : ['成本或单次产量缺失，贡献和推荐情景均留空'])],
      demandSignal: { band: policy.demand.band, value: policy.demand.value, baselineValue: policy.demand.baselineValue, unit: 'index_0_100', sourceId: market.demand?.observationId ?? null, provenanceMode: market.demand?.provenance?.mode ?? 'unknown' },
      eligibleTreeCount: count, excludedTreeCount: context.targetSnapshot.treeIds.length - count, exclusions: policy.exclusions,
      targetFrequencyPerWeek: policy.targetFrequencyPerWeek,
      scenarios, recommendedScenarioId: best && best.estimatedContributionCny >= 0 ? best.scenarioId : null,
    });
    result.reasons[1].text = `本轮干胶报价 ${price.value} 元/kg；需求指数 ${market.demand?.value ?? '缺失'} / 基准 ${market.demand?.baselineValue ?? '缺失'}。${policy.reasons.join('；')}。目标 ${context.targetSnapshot.treeIds.length} 棵中，${count} 棵符合当前作业、树围和健康条件；每周养护上限 ${context.constraints.maxTappingsPerWeek} 次。各项输入值与模拟/实测来源见关联数据。`;
    return result;
  },
  pest_risk(context, now) {
    const m = context.modules, o = m.weather.observed;
    const riskAssessments = context.targetSnapshot.treeIds.map(treeId => calculatePestRiskAssessment({ records: m.health.records, humidityPct: o.relativeHumidityPct, weatherObservationId: o.observationId, treeId, now }));
    const findings = context.targetSnapshot.treeIds.flatMap(treeId => {
      const records = m.health.records.filter(r => r.treeId === treeId && +now - Date.parse(r.observedAt) <= 7 * 86400000);
      const symptoms = [...new Set(records.flatMap(r => r.symptomCodes))];
      if (!symptoms.length && o.relativeHumidityPct < 80) return [];
      return [{ treeId, riskLevel: symptoms.length ? 'review' : 'watch', symptomCodes: symptoms, reason: symptoms.length ? '近期症状记录需要现场复核；此结果不构成诊断' : '高湿演示规则提示关注，可安排常规巡查', sourceRefs: [...records.map(r => r.recordId), o.observationId] }];
    });
    return base('pest_risk', context, `已按近 30 日健康记录生成 ${riskAssessments.filter(a => a.riskLevel !== 'low').length} 棵树的风险排序，尚未进行病害确诊`, [o.observationId, ...m.health.records.map(r => r.recordId)], { horizon: { start: iso(now), end: iso(now, 3 * 86400000) }, findings, inspectionTargets: findings.map(f => f.treeId), diagnosis: 'not_diagnosed', riskAssessments });
  },
};
export class RuleGenerator {
  mode = 'demo_rules';
  modelVersion = null;
  async generate({ kind, context, now }) {
    const expected = supportedRules.get(kind), actual = context.modules.knowledge.rules.filter(r => r.kind === kind);
    invariant(expected && actual.length === 1 && actual[0].version === expected.version && actual[0].text === expected.text && context.constraints.ruleSetId === expected.version, 'UNSUPPORTED_RULE_VERSION', '演示生成器不支持当前规则内容或版本；请使用匹配的规则或 LLM 引擎',422);
    return handlers[kind](context, now);
  }
}
