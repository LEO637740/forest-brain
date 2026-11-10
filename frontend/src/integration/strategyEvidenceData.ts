import type {ContextSnapshot} from './contracts';
import {recordTime, tappingState} from './treeEvidence.ts';

type Provenance = NonNullable<ContextSnapshot['modules']['trees']>[number]['provenance'];
export type EvidenceRow = {id:string; refs:string[]; title:string; value:string; at?:string|null; provenance:Provenance};
const value = (n:number|null|undefined,unit:string) => n == null ? '未提供' : `${n} ${unit}`;
const health = {normal:'正常',watch:'需关注',confirmed_issue:'已确认异常',unknown:'未确认'};
const detection = {scar:'伤痕',attachment:'附着物',suspected_lesion:'疑似病斑',nodule:'结节',bird_dropping:'鸟粪',mud:'泥巴'};

// Resolve references against the saved run input, so later measurements never
// replace the values that produced this recommendation.
export function strategyEvidenceRows(context:ContextSnapshot):EvidenceRow[] {
  const rows:EvidenceRow[]=[];
  const add=(id:string,title:string,detail:string,provenance:Provenance,at?:string|null,aliases:string[]=[])=>rows.push({id,refs:[id,provenance.sourceId,...aliases],title,value:detail,at,provenance});
  const m=context.modules;
  for(const t of m.trees??[]){
    if(t.fieldRecord){
      const field=t.fieldRecord;
      add(field.recordId,`${t.treeId} 导入测量`,`${field.sourceTreeId?`现场树号 ${field.sourceTreeId}；`:''}${t.variety??'品种未提供'}；树围 ${value(t.circumferenceCm,'cm')}；树高 ${value(t.heightM,'m')}；来源：${field.sourceName}`,field.provenance,field.observedAt,[t.treeId]);
      add(`${t.treeId}:status`,`${t.treeId} 种植与状态`,`${t.plantedAt??'种植日期未提供'}；${tappingState(t.tappingStatus)}；健康：${health[t.healthStatus]}`,t.provenance,undefined,[t.treeId]);
    }else add(t.treeId,`${t.treeId} 树木档案`,`${t.variety??'品种未提供'}；树围 ${value(t.circumferenceCm,'cm')}；树高 ${value(t.heightM,'m')}；${tappingState(t.tappingStatus)}；健康：${health[t.healthStatus]}`,t.provenance,t.measuredAt);
  }
  const o=m.weather?.observed;
  if(o){
    add(o.observationId,'现场天气',`气温 ${value(o.airTemperatureC,'°C')}；相对湿度 ${value(o.relativeHumidityPct,'%')}；降雨 ${value(o.rainfallMm,`mm / ${o.rainfallPeriodMinutes} 分钟`)}`,o.provenance,o.observedAt);
    if(o.soilMoisture)add(o.soilMoisture.provenance.sourceId,'土壤水分',value(o.soilMoisture.value,o.soilMoisture.unit??'%'),o.soilMoisture.provenance,o.observedAt,[o.observationId]);
    if(o.dryRubberContent)add(o.dryRubberContent.provenance.sourceId,'干胶含量',value(o.dryRubberContent.value,o.dryRubberContent.unit??'%'),o.dryRubberContent.provenance,o.observedAt,[o.observationId]);
    for(const rain of o.recentRainfall??[])add(rain.observationId,'历史降雨',value(rain.rainfallMm,`mm / ${rain.rainfallPeriodMinutes} 分钟`),rain.provenance,rain.observedAt);
  }
  const forecast=m.weather?.forecast;
  if(forecast)for(const step of forecast.steps)add(`${forecast.forecastRunId}:${step.validFrom}`,'天气预报时段',`${recordTime(step.validFrom)} — ${recordTime(step.validTo)}；降雨 ${value(step.rainfallMm,'mm')}；降雨概率 ${value(step.rainProbabilityPct,'%')}`,forecast.provenance,forecast.issuedAt,[forecast.forecastRunId]);
  for(const e of m.inspection?.evidence??[])add(e.evidenceId,`${e.treeId} 树表观测`,`${e.geometryRegistered?'已配准割线':'尚未配准割线'}；${e.detections.map(d=>`${detection[d.classCode]}（${d.intersectsPlannedLine===null?'与割线关系未确认':d.intersectsPlannedLine?'与割线相交':'位于割线外'}）`).join('；')||'未发现标记'}`,e.provenance,e.capturedAt,e.detections.map(d=>d.detectionId));
  for(const p of m.tapping?.panels??[]){
    add(p.panelId,`${p.treeId} 割面`, `计划坡角 ${value(p.plannedCutSlopeDeg,'°')}；实际坡角 ${value(p.actualCutSlopeDeg,'°')}`,p.provenance);
    if(p.latexViscosity)add(`${p.panelId}:viscosity`,`${p.treeId} 胶乳黏度`,value(p.latexViscosity.value,p.latexViscosity.unit??'mPa·s'),p.latexViscosity.provenance,undefined,[p.panelId]);
    if(p.dryRubberContent)add(`${p.panelId}:dry-rubber`,`${p.treeId} 干胶含量`,value(p.dryRubberContent.value,p.dryRubberContent.unit??'%'),p.dryRubberContent.provenance,undefined,[p.panelId]);
  }
  for(const g of m.growth?.measurements??[])add(g.observationId,`${g.treeId} 树围测量`,`${value(g.circumferenceCm,'cm')}；测量高度 ${value(g.measurementHeightM,'m')}`,g.provenance,g.observedAt);
  for(const h of m.health?.records??[])add(h.recordId,`${h.treeId} 健康巡查`,`${h.symptomCodes.length?`症状：${h.symptomCodes.join('、')}`:'无症状记录'}；${h.confirmedDiagnosis?`诊断：${h.confirmedDiagnosis.code}`:'未确诊'}`,h.provenance,h.observedAt);
  for(const p of m.market?.prices??[])add(p.observationId,'干胶价格',`${value(p.value,'元/kg 干胶')}；${m.market!.instrument} · ${m.market!.venue}`,p.provenance,p.observedAt);
  const demand=m.market?.demand;
  if(demand)add(demand.observationId,'需求指数',`${demand.value}；基准 ${demand.baselineValue}`,demand.provenance,demand.observedAt);
  const cost=m.market?.costAssumptions;
  if(cost)add(cost.assumptionId,'经营测算假设',`每树每次作业成本 ${value(cost.costPerTreeTappingCny,'元')}；每树每次干胶产量 ${value(cost.dryRubberKgPerTreeTapping,'kg')}`,cost.provenance);
  for(const r of m.knowledge?.rules??[])add(r.ruleId,r.title,`${r.text}（版本 ${r.version}）`,r.provenance);
  for(const r of m.industry?.records??[])add(r.observationId,r.title,`${r.scope} · ${r.period}；${r.content}`,r.provenance,r.retrievedAt);
  return rows;
}

export function evidenceForReferences(rows:EvidenceRow[],refs:string[]):EvidenceRow[]{
  return rows.filter(row=>row.refs.some(ref=>refs.includes(ref)));
}
