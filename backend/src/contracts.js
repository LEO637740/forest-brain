import { s, id, timestamp } from './schema.js';

export const KINDS = ['weather_window', 'tapping_angle', 'surface_action', 'growth_plan', 'market_scenario', 'pest_risk', 'industry_brief'];
export const CATALOG = [
  { kind: 'weather_window', name: '天气作业窗口', description: '结合现场观测与预报批次，比较可用时段', modules: ['weather', 'knowledge'] },
  { kind: 'tapping_angle', name: '单树割线方案', description: '在约定参数范围内形成候选坡角', modules: ['trees', 'weather', 'tapping', 'knowledge'] },
  { kind: 'surface_action', name: '树表异常处理', description: '区分检测发现、割线影响与后续复核', modules: ['inspection', 'knowledge'] },
  { kind: 'growth_plan', name: '生长与割面规划', description: '从尺寸序列形成趋势外推和养护建议', modules: ['trees', 'growth', 'tapping', 'knowledge'] },
  { kind: 'market_scenario', name: '经营情景比较', description: '结合行情、需求、天气与树体状态，在养护上限内比较作业频次与成本假设', modules: ['trees', 'weather', 'tapping', 'health', 'market', 'knowledge'] },
  { kind: 'pest_risk', name: '健康巡查建议', description: '关联症状与天气，提出需要复核的树群', modules: ['health', 'weather', 'knowledge'] },
  { kind: 'industry_brief', name: '行业与经营研判', description: 'LLM 综合真实天气、价格、产量、贸易及病虫害资料，提出管理建议并列出现场缺项', modules: ['industry', 'knowledge'] },
];
const nullableNumber = (extra = {}) => s.nullable(s.num(extra));
const refs = s.arr(id, { uniqueItems: true });
export const provenanceSchema = s.obj({ sourceId: id, sourceClass: s.enum('sensor_device', 'web_service', 'research_partner', 'farmer_expert'), mode: s.enum('measured', 'estimated', 'forecast', 'simulated'), modelVersion: id }, ['modelVersion']);
const meta = { provenance: provenanceSchema, quality: s.enum('valid', 'suspect', 'missing') };
// Optional measurements are objects instead of bare numbers so a real or demo
// value cannot lose its unit and provenance while it moves through the
// context snapshot.  They remain optional for older upstream contexts.
const provenanceMeasurement = (extra = {}) => s.obj({ value: nullableNumber(extra), unit: s.str(), ...meta }, ['value', 'unit']);
const rainfallHistory = s.obj({ observationId: id, observedAt: timestamp, rainfallMm: nullableNumber({ minimum: 0 }), rainfallPeriodMinutes: s.int({ minimum: 1 }), ...meta });
const dataPolicySchema = s.obj({mode:s.enum('demo','mixed_demo'),notices:s.arr(s.str(),{minItems:1}),substitutions:s.arr(s.obj({module:id,reason:s.str(),sourceId:id}))});
export const fieldTreeInputSchema = s.obj({treeId:id,sourceTreeId:s.str(),variety:s.nullable(s.str()),circumferenceCm:nullableNumber({minimum:0}),heightM:nullableNumber({minimum:0}),measurementHeightM:nullableNumber({minimum:0}),latitude:nullableNumber({minimum:-90,maximum:90}),longitude:nullableNumber({minimum:-180,maximum:180}),elevationM:nullableNumber()},['sourceTreeId','latitude','longitude','elevationM']);
const fieldSource = {siteId:s.str(),sourceName:s.str(),observedAt:timestamp,provenanceMode:s.enum('measured','simulated'),coordinateSystem:s.enum('WGS84')};
const fieldPolygonSchema = s.obj({type:s.enum('Polygon'),coordinates:s.arr(s.arr(s.arr(s.num(),{minItems:2,maxItems:2}),{minItems:4,maxItems:1000}),{minItems:1,maxItems:1})});
const fieldBoundariesSchema = s.obj({park:fieldPolygonSchema,zones:s.arr(s.obj({zoneId:s.enum('A','B','C','D'),polygon:fieldPolygonSchema}),{minItems:4,maxItems:4})});
export const fieldBoundaryRecordSchema = s.obj({...fieldBoundariesSchema.properties,...fieldSource,recordId:id,importedAt:timestamp});
export const fieldTreeImportSchema = s.obj({...fieldSource,elevationDatum:s.str(),records:s.arr(fieldTreeInputSchema,{maxItems:200}),boundaries:fieldBoundariesSchema},['elevationDatum','boundaries']);
export const fieldTreeRecordSchema = s.obj({...fieldTreeInputSchema.properties,...fieldSource,recordId:id,importedAt:timestamp,elevationDatum:s.nullable(s.str())},['sourceTreeId','latitude','longitude','elevationM']);
const fieldRecord = s.obj({...fieldTreeRecordSchema.properties,provenance:provenanceSchema},['sourceTreeId','latitude','longitude','elevationM']);
const tree = s.obj({ treeId: id, siteId: id, blockId: id, rowId: s.nullable(id), variety: s.nullable(s.str()), plantedAt: s.nullable(s.str()), heightM: nullableNumber({ minimum: 0 }), circumferenceCm: nullableNumber({ minimum: 0 }), measuredAt: s.nullable(timestamp), tappingStatus: s.enum('immature', 'available', 'resting', 'blocked', 'unknown'), healthStatus: s.enum('normal', 'watch', 'confirmed_issue', 'unknown'), fieldRecord, ...meta }, ['rowId','fieldRecord']);
const observed = s.obj({ observationId: id, observedAt: timestamp, receivedAt: timestamp, airTemperatureC: nullableNumber(), relativeHumidityPct: nullableNumber({ minimum: 0, maximum: 100 }), rainfallMm: nullableNumber({ minimum: 0 }), rainfallPeriodMinutes: s.int({ minimum: 1 }), soilMoisture: s.nullable(provenanceMeasurement({ minimum: 0, maximum: 100 })), dryRubberContent: s.nullable(provenanceMeasurement({ minimum: 0, maximum: 100 })), recentRainfall: s.arr(rainfallHistory, { maxItems: 168 }), ...meta }, ['soilMoisture', 'dryRubberContent', 'recentRainfall']);
const forecast = s.obj({ forecastRunId: id, issuedAt: timestamp, issuedAtBasis: s.enum('provider', 'retrieved'), timezone: s.str(), steps: s.arr(s.obj({ validFrom: timestamp, validTo: timestamp, rainfallMm: nullableNumber({ minimum: 0 }), rainProbabilityPct: nullableNumber({ minimum: 0, maximum: 100 }) }), { minItems: 1, maxItems: 168 }), ...meta }, ['issuedAtBasis']);
const evidence = s.obj({ evidenceId: id, treeId: id, capturedAt: timestamp, imageUrl: s.nullable(s.str()), imageWidthPx: s.int({ minimum: 1 }), imageHeightPx: s.int({ minimum: 1 }), expiresAt: s.nullable(timestamp), geometryRegistered: s.bool(), detections: s.arr(s.obj({ detectionId: id, classCode: s.enum('scar', 'attachment', 'suspected_lesion', 'nodule', 'bird_dropping', 'mud'), intersectsPlannedLine: s.nullable(s.bool()), reviewStatus: s.enum('unreviewed', 'confirmed', 'rejected'), score: nullableNumber({ minimum: 0, maximum: 1 }), box: s.arr(s.num({ minimum: 0, maximum: 1 }), { minItems: 4, maxItems: 4 }), coordinateConvention: s.enum('normalized_top_left_xywh') })), ...meta });
const panel = s.obj({ panelId: id, treeId: id, plannedCutSlopeDeg: nullableNumber({ minimum: 0, maximum: 90 }), actualCutSlopeDeg: nullableNumber({ minimum: 0, maximum: 90 }), angleReference: s.enum('horizontal'), cutDirection: s.enum('left_to_right', 'right_to_left'), latexViscosity: s.nullable(provenanceMeasurement({ minimum: 0 })), dryRubberContent: s.nullable(provenanceMeasurement({ minimum: 0, maximum: 100 })), ...meta }, ['latexViscosity', 'dryRubberContent']);
const measurement = s.obj({ observationId: id, treeId: id, observedAt: timestamp, circumferenceCm: nullableNumber({ minimum: 0 }), measurementHeightM: s.num({ minimum: 0 }), ...meta });
const healthRecord = s.obj({ recordId: id, treeId: id, observedAt: timestamp, symptomCodes: s.arr(id), confirmedDiagnosis: s.nullable(s.obj({ code: id, actorId: id, confirmedAt: timestamp })), ...meta });
export const modulesSchema = s.obj({
  industry: s.obj({ records: s.arr(s.obj({ observationId: id, topic: id, title: s.str(), scope: s.str(), period: s.str(), retrievedAt: timestamp, expiresAt: timestamp, sourceUrl: s.str(), content: s.str({ maxLength: 16000 }), ...meta }), { maxItems: 20 }), gaps: s.arr(s.str()) }),
  trees: s.arr(tree, { maxItems: 200 }),
  weather: s.obj({ siteId: id, observed: s.nullable(observed), forecast: s.nullable(forecast) }),
  inspection: s.obj({ evidence: s.arr(evidence) }),
  tapping: s.obj({ panels: s.arr(panel) }),
  growth: s.obj({ measurements: s.arr(measurement) }),
  health: s.obj({ records: s.arr(healthRecord) }),
  market: s.obj({ instrument: s.str(), venue: s.str(), currency: s.enum('CNY'), priceUnit: s.enum('CNY/kg_dry_rubber'), prices: s.arr(s.obj({ observationId: id, observedAt: timestamp, value: s.num({ minimum: 0 }), ...meta }), { minItems: 1 }), demand: s.nullable(s.obj({ observationId: id, observedAt: timestamp, value: s.num({ minimum: 0, maximum: 200 }), baselineValue: s.num({ minimum: 0.01, maximum: 200 }), unit: s.enum('index_0_100'), ...meta })), costAssumptions: s.nullable(s.obj({ assumptionId: id, costPerTreeTappingCny: s.num({ minimum: 0 }), dryRubberKgPerTreeTapping: nullableNumber({ minimum: 0 }), ...meta })) }),
  knowledge: s.obj({ rules: s.arr(s.obj({ ruleId: id, kind: s.enum(...KINDS), title: s.str(), text: s.str(), version: id, validUntil: timestamp, ...meta }), { minItems: 1 }) }),
}, ['trees', 'weather', 'inspection', 'tapping', 'growth', 'health', 'market', 'knowledge', 'industry']);
export const requestSchema = s.obj({
  requestId: id, kind: s.enum(...KINDS), siteId: id, targetSnapshotId: id,
  inputSnapshot: s.obj({ snapshotId: id, version: s.int({ minimum: 1 }) }),
  executionMode: s.enum('simulation', 'live'), trigger: s.obj({ type: s.enum('user', 'event', 'scheduled'), eventId: id }),
  generatorMode: s.enum('configured','demo_rules'),
}, ['trigger','generatorMode']);
export const contextSchema = s.obj({
  snapshotId: id, version: s.int({ minimum: 1 }), siteId: id, asOf: timestamp, validUntil: timestamp,
  executionMode: s.enum('simulation', 'live'),
  targetSnapshot: s.obj({ targetSnapshotId: id, siteId: id, treeIds: s.arr(id, { minItems: 0, maxItems: 200, uniqueItems: true }) }),
  constraints: s.obj({ minCutSlopeDeg: s.num({ minimum: 0, maximum: 90 }), maxCutSlopeDeg: s.num({ minimum: 0, maximum: 90 }), maxTappingsPerWeek: s.int({ minimum: 1, maximum: 7 }), ruleSetId: id }),
  modules: modulesSchema,
  dataPolicy: dataPolicySchema,
  sourceSnapshots: s.arr(id),
  sourceRequirements: s.arr(s.obj({ module: id, field: s.str(), objectId: id, reason: s.str() })),
  datasets: s.arr(s.obj({ module: s.enum('trees', 'inspection', 'tapping', 'growth', 'health', 'knowledge'), datasetRef: id, version: s.int({ minimum: 1 }) }), { maxItems: 6 }),
}, ['datasets', 'sourceSnapshots', 'sourceRequirements','dataPolicy']);
export const datasetFields = { trees: null, inspection: 'evidence', tapping: 'panels', growth: 'measurements', health: 'records', knowledge: 'rules' };
export const datasetPageSchemas = Object.fromEntries(Object.entries(datasetFields).map(([module, field]) => [module, s.obj({
  datasetRef: id, version: s.int({ minimum: 1 }), module: s.enum(module),
  items: { ...(field ? modulesSchema.properties[module].properties[field] : modulesSchema.properties[module]), minItems: 0 },
  nextCursor: s.nullable(s.str({ maxLength: 1024 })),
})]));
const window = s.obj({ start: timestamp, end: timestamp });
const reason = s.obj({ text: s.str(), sourceRefs: refs });
const angleFactor = s.obj({
  key: id, label: s.str(), inputValue: { anyOf: [s.num(), s.str(), { type: 'null' }] }, unit: s.str(),
  deltaDeg: s.num({ minimum: -10, maximum: 10 }), sourceId: s.nullable(id),
  provenanceMode: s.enum('measured', 'estimated', 'forecast', 'simulated', 'unknown'), note: s.str(),
});
const angleModel = s.obj({
  version: id, baselineDeg: nullableNumber({ minimum: 0, maximum: 90 }),
  unclampedCandidateDeg: nullableNumber({ minimum: 0, maximum: 90 }), adjustmentDeg: s.num({ minimum: -10, maximum: 10 }),
  recommendedCutSlopeDeg: nullableNumber({ minimum: 0, maximum: 90 }), clamped: s.bool(),
  factors: s.arr(angleFactor, { minItems: 7, maxItems: 7 }), dataCompletenessPct: s.num({ minimum: 0, maximum: 100 }),
  confidence: s.enum('low', 'medium', 'high'), optimizationStatus: s.enum('demo_heuristic', 'evidence_insufficient', 'validated'),
  validity: s.enum('evidence_insufficient', 'validated'), experimentPlan: s.arr(s.str(), { minItems: 1, maxItems: 6 }),
});
const weatherTimingAssessment = s.obj({
  policyVersion: id,
  currentRainfallMm: nullableNumber({ minimum: 0 }),
  recentRainfallTotalMm: nullableNumber({ minimum: 0 }),
  recentRainfallPeakMm: nullableNumber({ minimum: 0 }),
  soilMoisturePct: nullableNumber({ minimum: 0, maximum: 100 }),
  dryRubberContentPct: nullableNumber({ minimum: 0, maximum: 100 }),
  dryRubberStatus: s.enum('available_good', 'available_low', 'missing'),
  wetSpell: s.bool(),
  soilWet: s.bool(),
  lightRainAllowed: s.bool(),
  thresholds: s.obj({
    lightRainMaxMmPerPeriod: s.num({ minimum: 0 }),
    rainProbabilityDeferPct: s.num({ minimum: 0, maximum: 100 }),
    recentWetSpellMm: s.num({ minimum: 0 }),
    soilWetPct: s.num({ minimum: 0, maximum: 100 }),
    dryRubberLowPct: s.num({ minimum: 0, maximum: 100 }),
  }),
  sourceRefs: refs,
});
export const proposalSchemas = {
  industry_brief: s.obj({ horizon: window, findings: s.arr(s.obj({ topic: id, assessment: s.str(), sourceRefs: refs, limitation: s.str() }), { minItems: 1, maxItems: 12 }), recommendations: s.arr(s.obj({ priority: s.enum('high','medium','low'), action: s.str(), reason: s.str(), sourceRefs: refs }), { minItems: 1, maxItems: 12 }), missingData: s.arr(s.str()), uncertainty: s.str(), reviewRequired: s.enum(true) }),
  weather_window: s.obj({ forecastRunId: id, windows: s.arr(s.obj({ ...window.properties, suitability: s.enum('suitable', 'defer', 'review'), reason: s.str() }), { minItems: 1 }), timingAssessment: weatherTimingAssessment, scheduleChanges: s.arr(s.obj({ taskId: id, expectedVersion: s.int({ minimum: 1 }), previousWindow: window, proposedWindow: window })), excludedTreeIds: refs }),
  tapping_angle: s.obj({ treeId: id, panelId: id, recommendedCutSlopeDeg: s.num({ minimum: 0, maximum: 90 }), previousPlannedCutSlopeDeg: nullableNumber({ minimum: 0, maximum: 90 }), angleReference: s.enum('horizontal'), cutDirection: s.enum('left_to_right', 'right_to_left'), conditions: s.arr(s.str(), { minItems: 1 }), proposedPathRef: s.nullable(id), method: s.str(), angleModel }),
  surface_action: s.obj({ findings: s.arr(s.obj({ evidenceId: id, detectionId: id, treeId: id, affectsCut: s.enum('yes', 'no', 'unknown'), action: s.enum('review', 'capture', 'manual_assessment', 'avoid_with_review', 'continue_with_review'), reason: s.str() })), followupSuggestions: s.arr(s.obj({ treeId: id, taskType: s.enum('inspect', 'capture'), reason: s.str() })) }),
  growth_plan: s.obj({ predictions: s.arr(s.obj({ treeId: id, metric: s.enum('circumference_cm'), at: timestamp, value: s.num({ minimum: 0 }), interval: s.nullable(s.obj({ lower: s.num(), upper: s.num() })), method: s.str(), sourceRefs: s.arr(id, { minItems: 2, uniqueItems: true }) }), { minItems: 1 }), futurePanelPlan: s.arr(s.obj({ treeId: id, panelId: id, action: s.enum('review_before_rotation'), reason: s.str() })) }),
  market_scenario: s.obj({ instrument: s.str(), currency: s.enum('CNY'), priceUnit: s.enum('CNY/kg_dry_rubber'), assumptions: s.arr(s.str(), { minItems: 1 }), demandSignal: s.obj({ band: s.enum('low', 'balanced', 'high', 'unknown'), value: nullableNumber({ minimum: 0, maximum: 200 }), baselineValue: nullableNumber({ minimum: 0.01, maximum: 200 }), unit: s.enum('index_0_100'), sourceId: s.nullable(id), provenanceMode: s.enum('measured', 'estimated', 'forecast', 'simulated', 'unknown') }), eligibleTreeCount: s.int({ maximum: 200 }), excludedTreeCount: s.int({ maximum: 200 }), exclusions: s.arr(s.obj({ reason: s.str(), count: s.int({ minimum: 1, maximum: 200 }) }), { maxItems: 12 }), targetFrequencyPerWeek: s.int({ minimum: 0, maximum: 7 }), scenarios: s.arr(s.obj({ scenarioId: id, tappingsPerWeek: s.int({ minimum: 0, maximum: 7 }), eligibleTreeCount: s.int({ maximum: 200 }), expectedDryRubberKg: nullableNumber({ minimum: 0 }), estimatedContributionCny: nullableNumber(), reason: s.str() }), { minItems: 1 }), recommendedScenarioId: s.nullable(id) }),
  pest_risk: s.obj({ horizon: window, findings: s.arr(s.obj({ treeId: id, riskLevel: s.enum('watch', 'review'), symptomCodes: s.arr(id), reason: s.str(), sourceRefs: refs })), inspectionTargets: refs, diagnosis: s.enum('not_diagnosed'), riskAssessments: s.arr(s.obj({ policyVersion: id, treeId: id, riskIndex: s.num({ minimum: 0, maximum: 100 }), riskLevel: s.enum('low', 'watch', 'review'), trend: s.enum('stable', 'increasing', 'insufficient_history'), monitoringWindowDays: s.num({ minimum: 0 }), observedDays: s.num({ minimum: 0 }), basisSourceRefs: refs, preventiveActions: s.arr(s.str(), { minItems: 1 }), limitation: s.str() })) }),
};
export const candidateSchemas = Object.fromEntries(KINDS.map(kind => [kind, s.obj({ summary: s.str(), reasons: s.arr(reason, { minItems: 1 }), evidenceRefs: refs, proposal: proposalSchemas[kind] })]));
export const missingDataSchema = s.obj({ module: id, field: s.str(), objectId: id, reason: s.str() });
export const checkSchema = s.obj({ code: id, status: s.enum('pass', 'fail', 'not_checked'), message: s.str() });
export const qualityReviewSchema = s.obj({status:s.enum('pending','withdrawn'),reviewRequired:s.enum(true),reviewedAt:s.nullable(timestamp),notes:s.arr(s.str())});
export const fallbackSchema = s.obj({
  reasonCode: id,
  message: s.str(),
  details: s.arr(s.str()),
  generator: s.enum('demo_rules'),
  reviewRequired: s.enum(true),
});
export const strategySchemas = Object.fromEntries(KINDS.map(kind => [kind, s.obj({
  strategyId: id, revision: s.int({ minimum: 1 }), runId: id, kind: s.enum(kind), siteId: id,
  targetSnapshotId: id, inputSnapshot: requestSchema.properties.inputSnapshot,
  generatedAt: timestamp, expiresAt: timestamp, executionMode: s.enum('simulation', 'live'),
  provenance: provenanceSchema, ruleVersion: id, modelVersion: s.nullable(id),
  schemaVersion: s.str(),
  qualityReview: qualityReviewSchema,
  dataPolicy: dataPolicySchema,
  ruleBindings: s.arr(s.obj({ruleId:id,version:id,contentHash:id})),
  generationMetadata: s.obj({ provider: s.str(), model: s.str(), promptVersion: id, responseId: s.nullable(s.str()), promptHash: id, inputTokens: s.nullable(s.int()), outputTokens: s.nullable(s.int()), attempts: s.int({ minimum: 1, maximum: 2 }) }),
  fallback: fallbackSchema,
  constraintsChecked: s.arr(checkSchema, { minItems: 1 }), ...candidateSchemas[kind].properties,
}, ['schemaVersion','generationMetadata','fallback','ruleBindings','dataPolicy','qualityReview'])]));
export const resultSchema = { anyOf: [
  ...KINDS.map(kind => s.obj({ runId: id, requestId: id, status: s.enum('succeeded'), updatedAt: timestamp, strategy: strategySchemas[kind] })),
  s.obj({ runId: id, requestId: id, status: s.enum('needs_data'), updatedAt: timestamp, missingData: s.arr(missingDataSchema, { minItems: 1 }) }),
  s.obj({ runId: id, requestId: id, status: s.enum('failed'), updatedAt: timestamp, error: s.obj({ code: id, message: s.str(), retryable: s.bool(), details: s.arr(s.str()) }, ['details']) }),
] };
export const schemaBundle = { schemaVersion: '2.1.0-draft', request: requestSchema, context: contextSchema, datasetPages: datasetPageSchemas, candidates: candidateSchemas, result: resultSchema };
