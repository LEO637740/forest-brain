// Derived facts and hard boundaries, not a generated strategy. The independent
// validator still checks the model's citations, arithmetic and chosen actions.
import { calculateAngleCandidate } from '../angle-policy.js';
import { deriveMarketFrequencyPolicy } from '../market-policy.js';
import { assessWeatherWindow, weatherAssessment } from '../weather-policy.js';
import { calculatePestRiskAssessment } from '../pest-policy.js';

export function decisionSupport(kind, context, now) {
  const m = context.modules;
  if (kind === 'tapping_angle') {
    const observed = m.weather.observed;
    const panel = m.tapping.panels[0];
    const angleModel = calculateAngleCandidate({ tree: m.trees[0], panel, weather: observed, asOf: context.asOf, constraints: context.constraints });
    const recent = (observed?.recentRainfall ?? []).filter(x => x.quality === 'valid' && Number.isFinite(x.rainfallMm));
    const recentTotal = recent.reduce((sum, x) => sum + x.rainfallMm, 0);
    const measurementFact = measurement => measurement ? {
      value: measurement.value,
      unit: measurement.unit,
      provenanceMode: measurement.provenance?.mode ?? 'unknown',
      evidenceRef: panel.panelId,
    } : null;
    return {tappingFacts: {
    treeId: m.trees[0].treeId,
    variety: m.trees[0].variety,
    plantedAt: m.trees[0].plantedAt,
    plannedCutSlopeDeg: panel.plannedCutSlopeDeg,
    angleReference: 'horizontal',
    observedRelativeHumidityPct: observed.relativeHumidityPct,
    humidityEvidenceRef: observed.observationId,
    panelEvidenceRef: panel.panelId,
    humidityDemoThresholdPct: 80,
    humidityDemoThresholdReached: observed.relativeHumidityPct >= 80,
    humidityComparison: `${observed.relativeHumidityPct}% ${observed.relativeHumidityPct >= 80 ? '>=' : '<'} 80%`,
    humidityRuleApplicability: observed.relativeHumidityPct >= 80
      ? '达到软件演示阈值；仍缺少农艺验证，不能证明调整有效。'
      : '未达到软件演示阈值；本次不能以高湿为调整依据，也不能把假设高湿写成本树当前条件。',
    soilMoisture: observed.soilMoisture ? {
      value: observed.soilMoisture.value,
      unit: observed.soilMoisture.unit,
      provenanceMode: observed.soilMoisture.provenance?.mode ?? 'unknown',
      evidenceRef: observed.observationId,
    } : null,
    recentRainfall: recent.map(x => ({ observationId: x.observationId, observedAt: x.observedAt, rainfallMm: x.rainfallMm, provenanceMode: x.provenance?.mode ?? 'unknown' })),
    recentRainfallTotalMm: recentTotal,
    latexViscosity: measurementFact(panel.latexViscosity),
    dryRubberContent: measurementFact(panel.dryRubberContent),
    angleModelFacts: angleModel,
    latexViscosityAvailable: panel.latexViscosity?.value != null,
    assayFieldsAvailable: panel.latexViscosity?.value != null || panel.dryRubberContent?.value != null,
    limitation: '树干割线坡角候选；当前多因素系数是可解释的演示先验，模拟值不是实测值，且仍缺少农艺实验响应曲线与设备验证，不能证明角度最优、增产或安全效果。',
  }};
  }
  if (kind === 'weather_window') {
    const observed = m.weather.observed;
    const timingAssessment = weatherAssessment(observed, context.siteId);
    const dryRubber = observed.dryRubberContent;
    return {
      observedRainfallMm: observed.rainfallMm,
      observedRainEvidenceRef: observed.observationId,
      soilMoisture: observed.soilMoisture ? {
        value: observed.soilMoisture.value,
        unit: observed.soilMoisture.unit,
        provenanceMode: observed.soilMoisture.provenance?.mode ?? 'unknown',
        evidenceRef: observed.observationId,
      } : null,
      dryRubberContent: dryRubber ? {
        value: dryRubber.value,
        unit: dryRubber.unit,
        provenanceMode: dryRubber.provenance?.mode ?? 'unknown',
        evidenceRef: observed.observationId,
      } : null,
      recentRainfall: (observed.recentRainfall ?? []).map(x => ({ observationId: x.observationId, observedAt: x.observedAt, rainfallMm: x.rainfallMm, provenanceMode: x.provenance?.mode ?? 'unknown' })),
      recentRainfallTotalMm: timingAssessment.recentRainfallTotalMm,
      weatherTimingAssessment: timingAssessment,
      eligibleForecastWindows: m.weather.forecast.steps
        .filter(s => Date.parse(s.validFrom) >= +now && Date.parse(s.validTo) > Date.parse(s.validFrom))
        .map(s => {
          const assessment = assessWeatherWindow({ observed, step: s, siteId: context.siteId });
          return { start: s.validFrom, end: s.validTo, rainfallMm: s.rainfallMm, rainProbabilityPct: s.rainProbabilityPct,
            suitableForbidden: assessment.suitability !== 'suitable', suitability: assessment.suitability, reason: assessment.reason };
        }),
    };
  }
  if (kind === 'surface_action') return {surfaceGeometry:m.inspection.evidence.flatMap(e => e.detections
    .filter(d => d.reviewStatus !== 'rejected')
    .map(d => ({evidenceId:e.evidenceId,detectionId:d.detectionId,treeId:e.treeId,
      affectsCut:!e.geometryRegistered || d.intersectsPlannedLine === null ? 'unknown' : d.intersectsPlannedLine ? 'yes' : 'no'})))};
  if (kind === 'growth_plan') {
    const at = new Date(Date.parse(context.asOf) + 30 * 86400000).toISOString();
    return {growthBaseline:{snapshotAsOf:context.asOf,at,method:'demo-linear-endpoints-v1',
      limitation:'演示端点直线外推，不是经验证的农艺预测；模型负责解释局限与复核建议。',
      calculations:context.targetSnapshot.treeIds.map(treeId => {
        const samples = m.growth.measurements.filter(s => s.treeId === treeId && s.quality === 'valid' && s.circumferenceCm !== null)
          .sort((a,b) => Date.parse(a.observedAt)-Date.parse(b.observedAt));
        const first=samples[0],last=samples.at(-1);
        if (!first || !last || Date.parse(last.observedAt) <= Date.parse(first.observedAt) || new Set(samples.map(s=>s.measurementHeightM)).size !== 1) return {treeId,available:false};
        const elapsedDays=(Date.parse(last.observedAt)-Date.parse(first.observedAt))/86400000;
        const extrapolationDays=(Date.parse(at)-Date.parse(last.observedAt))/86400000;
        const value=Math.round(Math.max(0,last.circumferenceCm+(last.circumferenceCm-first.circumferenceCm)/elapsedDays*extrapolationDays)*100)/100;
        return {treeId,available:true,first,last,elapsedDays,extrapolationDays,value,sourceRefs:[first.observationId,last.observationId]};
      })}};
  }
  if (kind === 'market_scenario') {
    const policy = deriveMarketFrequencyPolicy({ market: m.market, trees: m.trees, weather: m.weather, health: m.health, maxTappingsPerWeek: context.constraints.maxTappingsPerWeek });
    const latestPrice = [...(m.market.prices ?? [])].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    return { marketFacts: {
      latestPrice: latestPrice ? { value: latestPrice.value, observedAt: latestPrice.observedAt, evidenceRef: latestPrice.observationId, provenanceMode: latestPrice.provenance?.mode ?? 'unknown' } : null,
      demand: m.market.demand ? { value: m.market.demand.value, baselineValue: m.market.demand.baselineValue, unit: m.market.demand.unit, observedAt: m.market.demand.observedAt, evidenceRef: m.market.demand.observationId, provenanceMode: m.market.demand.provenance?.mode ?? 'unknown' } : null,
      demandBand: policy.demand.band,
      eligibleTreeIds: policy.eligible.map(tree => tree.treeId),
      eligibleTreeCount: policy.eligible.length,
      excludedTreeCount: context.targetSnapshot.treeIds.length - policy.eligible.length,
      exclusions: policy.exclusions,
      weatherFrequencyCap: policy.weatherCap,
      weatherConstraintReasons: policy.weatherReasons,
      targetFrequencyPerWeek: policy.targetFrequencyPerWeek,
      method: policy.method,
      limitation: policy.limitation,
    }};
  }
  if (kind === 'pest_risk') return {
    horizonBounds:{start:now.toISOString(),end:new Date(+now+7*86400000).toISOString()},
    ...(context?.targetSnapshot?.treeIds && m?.health && m?.weather ? { pestFacts:{policyVersion: 'demo-pest-risk-v1', assessments: context.targetSnapshot.treeIds.map(treeId => calculatePestRiskAssessment({records:m.health.records, humidityPct:m.weather.observed?.relativeHumidityPct, weatherObservationId:m.weather.observed?.observationId, treeId, now}))} } : {}),
  };
  if (kind === 'industry_brief') return {
    horizonBounds:{start:now.toISOString(),end:new Date(+now+7*86400000).toISOString()},
  };
  return undefined;
}
