import { iso } from '../util.js';

// These four adapters contain simulated records only. No fabricated record is marked measured.
const meta = (sourceClass, sourceId) => ({ provenance: { sourceClass, sourceId, mode: 'simulated' }, quality: 'valid' });
export const SOURCE_CATALOG = [
  { id: 'sensor_device', name: '传感器与设备', mode: 'simulated', supplies: ['现场天气', '尺寸序列', '树表检测', '割面记录', '巡查记录'] },
  { id: 'web_service', name: '天气与行情服务', mode: 'simulated', supplies: ['天气预报批次', '干胶报价序列'] },
  { id: 'research_partner', name: '科研合作资料', mode: 'simulated', supplies: ['参数示例规则', '生长外推说明'] },
  { id: 'farmer_expert', name: '胶农与专家', mode: 'simulated', supplies: ['单树档案', '养护规则', '经营假设'] },
];
export function makeTree(index, now) {
  return {
    treeId: `T-${String(index).padStart(4, '0')}`, siteId: 'demo-hainan', blockId: ['A', 'B', 'C', 'D'][Math.floor((index - 1) / 50)],
    variety: '热研 7-33-97（模拟）', plantedAt: null,
    heightM: 10 + (index % 5) * 0.2, circumferenceCm: 52 + index % 12,
    measuredAt: iso(now, -3600000), tappingStatus: index % 31 === 0 ? 'resting' : 'available',
    healthStatus: index === 12 ? 'watch' : 'normal', ...meta('farmer_expert', 'demo-tree-register'),
  };
}
export class SensorDeviceAdapter {
  read({ treeIds, now }) {
    const registry = new Map(Array.from({ length: 200 }, (_, i) => { const tree = makeTree(i + 1, now); return [tree.treeId, tree]; }));
    return {
      observed: { observationId: 'obs-weather-001', observedAt: iso(now, -300000), receivedAt: iso(now, -290000), airTemperatureC: 26.4, relativeHumidityPct: 84, rainfallMm: 0, rainfallPeriodMinutes: 60, ...meta('sensor_device', 'demo-station-hn') },
      inspection: { evidence: treeIds.map((treeId, i) => ({
        evidenceId: `evidence-${treeId}`, treeId, capturedAt: iso(now, -600000), imageUrl: null, imageWidthPx: 1920, imageHeightPx: 1080, expiresAt: null,
        geometryRegistered: true,
        detections: [{ detectionId: `detection-${treeId}`, classCode: treeId === 'T-0012' ? 'scar' : 'attachment', intersectsPlannedLine: treeId === 'T-0012', reviewStatus: 'unreviewed', score: null, box: [0.32, 0.4, 0.18, 0.2], coordinateConvention: 'normalized_top_left_xywh' }],
        ...meta('sensor_device', 'demo-camera-hn'),
      })) },
      tapping: { panels: treeIds.map(treeId => ({ panelId: `panel-${treeId}`, treeId, plannedCutSlopeDeg: 30, actualCutSlopeDeg: null, angleReference: 'horizontal', cutDirection: 'left_to_right', ...meta('sensor_device', 'demo-panel-register') })) },
      growth: { measurements: treeIds.flatMap(treeId => [90, 60, 30, 0].map((days, n) => ({ observationId: `growth-${treeId}-${n}`, treeId, observedAt: iso(now, -days * 86400000), circumferenceCm: Math.round((registry.get(treeId).circumferenceCm - 1.2 + n * 0.4) * 100) / 100, measurementHeightM: 1.3, ...meta('sensor_device', 'demo-measurements') }))) },
      health: { records: treeIds.map(treeId => ({ recordId: `health-${treeId}`, treeId, observedAt: iso(now, -1800000), symptomCodes: treeId === 'T-0012' ? ['leaf_spot'] : [], confirmedDiagnosis: null, ...meta('sensor_device', 'demo-inspection') })) },
    };
  }
}
export class WebServiceAdapter {
  read({ now }) {
    return {
      forecast: { forecastRunId: 'forecast-hn-001', issuedAt: iso(now, -1800000), timezone: 'Asia/Shanghai', steps: [0, 1, 2, 3].map(i => ({ validFrom: iso(now, i * 3600000), validTo: iso(now, (i + 1) * 3600000), rainfallMm: [0, 0, 1.2, 3.1][i], rainProbabilityPct: [10, 20, 70, 85][i] })), ...meta('web_service', 'demo-weather-service') },
      market: { instrument: '天然橡胶干胶（模拟现货）', venue: '演示行情源', currency: 'CNY', priceUnit: 'CNY/kg_dry_rubber', prices: [14.2, 14.4, 14.1, 14.5, 14.6].map((value, i) => ({ observationId: `market-${i}`, observedAt: iso(now, -(4 - i) * 86400000), value, ...meta('web_service', 'demo-market-service') })), demand: { observationId: 'demand-0', observedAt: iso(now, -3600000), value: 105, baselineValue: 100, unit: 'index_0_100', ...meta('web_service', 'demo-demand-service') } },
    };
  }
}
const rule = (kind, title, text, sourceClass, now) => ({ ruleId: `rule-${kind}`, kind, title, text, version: 'demo-rules-2', validUntil: iso(now, 86400000), ...meta(sourceClass, `demo-${sourceClass}`) });
export class ResearchPartnerAdapter {
  read({ now }) {
    return { rules: [
      rule('tapping_angle', '演示多因素坡角候选', '本软件样例按树种先验、树龄、相对湿度、土壤水分、近7日降雨、胶乳黏度和干胶含量形成可追溯的候选坡角；80%仅是其中的高湿演示阈值，所有系数均未经农艺效果、配对试验和设备验证，不代表最优割线坡角。', 'research_partner', now),
      rule('growth_plan', '尺寸序列演示外推', '使用同一测量部位的首末样本线性外推 30 天；无概率区间，不等同生长模型。', 'research_partner', now),
    ] };
  }
}
export class FarmerExpertAdapter {
  read({ treeIds, now }) {
    const registry = new Map(Array.from({ length: 200 }, (_, i) => { const tree = makeTree(i + 1, now); return [tree.treeId, tree]; }));
    return {
      trees: treeIds.map(treeId => registry.get(treeId)),
      costAssumptions: { assumptionId: 'cost-demo-001', costPerTreeTappingCny: 1.2, dryRubberKgPerTreeTapping: 0.12, ...meta('farmer_expert', 'demo-operator-assumptions') },
      rules: [
        rule('weather_window', '演示作业窗口规则', '天气窗口逐时段判断：默认降雨超过 0.5 mm/时段或降雨概率不低于 60% 时暂缓对应时段；其余晴天或小雨时段可进入候选安排，并提示现场检查。近 7 日累计雨量仅作为巡查提示，不单独停割，也不因干胶含量缺失而单独停割。土壤达到偏湿阈值时需现场复核；干胶含量低于 30% 且雨史或土壤偏湿时暂缓。实际采用当前园区参数，阈值仅供演示。', 'farmer_expert', now),
        rule('surface_action', '树表复核规则', '几何已配准且结节、伤痕或疑似病斑与计划割线相交时形成跳刀/避让候选，需人工复核后再规划；鸟粪、泥巴或其他临时附着物位于割线外时清理或确认后正常继续，不误触发跳刀；几何缺失、割线冲突或证据含糊时先补拍或人工评估。', 'farmer_expert', now),
        rule('market_scenario', '养护频次示例约束', '演示最多每周 3 次（减产 1、维持 2、增产 3，与全园策略同一割次表）；缺成本或单次产量假设时不计算贡献。', 'farmer_expert', now),
        rule('pest_risk', '巡查建议示例', '症状与高湿用于提示复核，不作确诊，不输出概率。', 'farmer_expert', now),
      ],
    };
  }
}
