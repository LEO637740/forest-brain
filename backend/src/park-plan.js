import {invariant} from './errors.js';
import {digest} from './util.js';
import {normalizeSiteId,parkSite,TREE_IDS} from './adapters/park-demo.js';
import {WEEKLY_TAPPINGS,CARE_LIMIT_PER_WEEK} from './market-policy.js';
import {proposeParkPlan,inconsistentZoneGroups} from './park-plan-model.js';
import {ParkEconomicInputStore,assembleParkEconomicInputs} from './park-economic-inputs.js';
import {thresholdsFor,thresholdVersionFor} from './weather-policy.js';
import {economicScenario,economicImpact} from './economic-scenario.js';
import {assessParkReadiness,readinessFingerprint,PREPARABLE_SURFACE_REASONS} from './tree-readiness.js';
export {assessParkReadiness,treeExecutionReadinessIssues} from './tree-readiness.js';

/** Trees held back only because their hourly tree strategy lapsed or was never prepared. */
export const unpreparedTreeCount = readiness => (readiness?.reviewTrees ?? []).filter(tree => tree.reasons.length === 1
  && Object.values(PREPARABLE_SURFACE_REASONS).includes(tree.reasons[0])).length;

// The model proposes operating frequencies from source-labelled data. This
// module only applies physical/safety limits and schedules executable rounds.
// Adoption remains an explicit action that creates simulated tasks.
export const PARK_PLAN_POLICY_VERSION = 'park-tapping-llm-v6-existing-rounds';
const HORIZON_DAYS = 7, DEFAULT_STORAGE_KG = 900;
const STANCES = {
  increase:{label:'增产',frequency:WEEKLY_TAPPINGS.increase,summary:'在养护上限内增加割次'},
  hold:{label:'维持',frequency:WEEKLY_TAPPINGS.hold,summary:'保持基础割次'},
  reduce:{label:'减产',frequency:WEEKLY_TAPPINGS.reduce,summary:'降低割次、养树控产'},
  pause:{label:'暂停割胶',frequency:WEEKLY_TAPPINGS.pause,summary:'本周暂停新增割胶'},
};
const ZONES = ['A','B','C','D'];
const hasZoneSnapshot=proposal=>{
  const zones=proposal?.inputSnapshot?.zones;
  return Array.isArray(zones)&&zones.length===4&&ZONES.every(zone=>zones.some(row=>row.zone===zone
    &&Number.isFinite(row.readyTreeCount)&&Array.isArray(row.excluded)&&typeof row.deviceBlocked==='boolean'
    &&Number.isFinite(row.dryKgPerRound)&&Array.isArray(row.availableDates)));
};
const climateRain = {tropical:34,tropical_highland:42,subtropical:30,temperate_trial:18};
const beijingDate = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const kg = value => Math.round(value * 10) / 10;
const hash = text => { let value = 2166136261; for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619) >>> 0; } return value; };

export function weatherOutlook({siteId, now, context, events, thresholds}) {
  const park = parkSite(siteId), dailyRainMax = thresholds.lightRainMaxMmPerPeriod * 4;
  const steps = context.modules.weather?.forecast?.steps ?? [], observed = context.modules.weather?.observed;
  const parkRain = events.filter(event => event.kind === 'rain' && event.status !== 'closed');
  return Array.from({length:HORIZON_DAYS}, (_, day) => {
    const date = beijingDate(+now + day * 86400000);
    let rainProbabilityPct, rainMm, source;
    if (day === 0 && steps.length) {
      rainProbabilityPct = Math.max(...steps.map(step => step.rainProbabilityPct ?? 0));
      rainMm = Math.round((steps.reduce((sum, step) => sum + (step.rainfallMm ?? 0), 0) + (observed?.rainfallMm ?? 0)) * 10) / 10;
      source = steps[0]?.provenance?.mode === 'simulated' || !steps[0]?.provenance ? 'context_forecast_simulated' : 'context_forecast';
    } else {
      const seed = hash(`${park.key}:${date}`);
      rainProbabilityPct = Math.max(5, Math.min(95, climateRain[park.climate] + (seed % 50) - 22));
      rainMm = rainProbabilityPct >= 60 ? Math.round((2 + seed % 9) * 10) / 10 : rainProbabilityPct >= 40 ? Math.round((seed % 15) / 10 * 10) / 10 : 0;
      source = 'simulated_outlook';
    }
    const reasons = [];
    if (rainProbabilityPct >= thresholds.rainProbabilityDeferPct) reasons.push(`降雨概率 ${rainProbabilityPct}% ≥ ${thresholds.rainProbabilityDeferPct}%`);
    if (rainMm > dailyRainMax) reasons.push(`预计降雨 ${rainMm} mm > ${kg(dailyRainMax)} mm`);
    const eventZones = day === 0 ? parkRain.map(event => event.zone === null ? null : ZONES[event.zone]) : [];
    if (day === 0 && eventZones.includes(null)) reasons.push('全园雨情未解除');
    return {date, rainProbabilityPct, rainMm, source, tappable:!reasons.length, reasons,
      heldZones:day === 0 ? [...new Set(eventZones.filter(Boolean))] : []};
  });
}

// A working slot must fit the complete zone. Short safe gaps do not justify
// inventing a reduced tree count or stretching the task into a rainy hour.
const MINUTES_PER_TREE = 2;
const beijingTime = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(11,16);
function liveWeatherOutlook({siteId,now,weather,events}) {
  const usable = weather?.siteId===siteId && weather.status==='available' && !weather.stale && Date.parse(weather.validUntil)>+now;
  const parkRain=events.filter(event=>event.kind==='rain' && event.status!=='closed');
  return Array.from({length:HORIZON_DAYS},(_,day)=>{
    const date=beijingDate(+now+day*86400000);
    const from=Date.parse(`${date}T06:00:00+08:00`),to=Date.parse(`${date}T12:00:00+08:00`);
    const futureFrom=Math.max(from,Math.ceil((+now+60000)/300000)*300000);
    const rows=usable?(weather.windows??[]).filter(row=>Date.parse(row.end)>Math.max(from,+now) && Date.parse(row.start)<to):[];
    const eventZones=day===0?parkRain.map(event=>event.zone===null?null:ZONES[event.zone]):[];
    const workWindows=[];
    for(const row of rows.slice().sort((a,b)=>a.start.localeCompare(b.start))) {
      if(row.suitability!=='suitable')continue;
      const start=Math.max(Date.parse(row.start),futureFrom),end=Math.min(Date.parse(row.end),to);
      if(end<=start)continue;
      const previous=workWindows.at(-1);
      if(previous && Date.parse(previous.end)===start)previous.end=new Date(end).toISOString();
      else workWindows.push({start:new Date(start).toISOString(),end:new Date(end).toISOString()});
    }
    const reasons=[];
    let blockReason;
    if(!usable){reasons.push(weather?.stale?'天气已过期或不可用，更新后再排程':'尚未取得当前园区天气，更新后再排程');blockReason='missing_weather';}
    else if(!rows.length){reasons.push(to<=+now?'今日作业时段已结束':'本日作业时段缺少预报，待更新');blockReason=to<=+now?'elapsed':'missing_weather';}
    else if(!workWindows.length){
      const review=rows.some(row=>row.suitability==='review');
      reasons.push(review?'雨后条件或天气资料需现场复核，暂不安排割胶':'作业时段降雨风险超过阈值，暂缓割胶');
      blockReason=review?'review':'rain';
    }
    if(eventZones.includes(null)){reasons.push('全园雨情未解除');blockReason='event';}
    const probabilities=rows.map(row=>row.rainProbabilityPct).filter(value=>typeof value==='number');
    return {date,rainProbabilityPct:probabilities.length?Math.max(...probabilities):null,
      rainMm:rows.length&&rows.every(row=>typeof row.rainfallMm==='number')?kg(rows.reduce((sum,row)=>sum+row.rainfallMm,0)):null,
      source:'live_weather',tappable:workWindows.length>0&&!eventZones.includes(null),reasons,blockReason,
      heldZones:[...new Set(eventZones.filter(Boolean))],workWindows};
  });
}
function scheduledWindow(day,treeCount) {
  const duration=Math.max(15,treeCount*MINUTES_PER_TREE)*60000;
  const window=day.workWindows?.find(slot=>Date.parse(slot.end)-Date.parse(slot.start)>=duration);
  if(!window)return null;
  const end=new Date(Date.parse(window.start)+duration).toISOString();
  return {date:day.date,start:beijingTime(window.start),end:beijingTime(end),windowStart:window.start,windowEnd:window.end};
}

/** Pick tapping days spread across tappable days, avoiding consecutive cuts when possible. */
function pickDays(days, frequency) {
  if (frequency <= 0) return [];
  const candidates = days.filter(day => day.ok).map(day => day.index);
  if (candidates.length <= frequency) return candidates;
  const chosen = [];
  const stride = candidates.length / frequency;
  for (let i = 0; i < frequency; i++) chosen.push(candidates[Math.min(candidates.length - 1, Math.round(i * stride))]);
  return [...new Set(chosen)].sort((a, b) => a - b);
}

// A round is counted for the trees it actually covers, once per date. Cancelled
// tasks retain completed cuts, but their unworked remainder does not reserve a round.
function existingTreeIndices(task) {
  const indices=task.treeIndices??Array.from({length:task.count},(_,index)=>ZONES.indexOf(task.block)*50+index);
  if(task.status!=='已取消')return indices.filter(index=>!task.dispatch?.skipped?.includes(index));
  const receipts=task.demoReceipts?.filter(receipt=>receipt.outcome==='completed').map(receipt=>receipt.treeIndex);
  return receipts?.length?receipts:indices.filter(index=>!task.dispatch?.skipped?.includes(index)).slice(0,task.done);
}

/** Assemble facts and arithmetic, without a price score or recommended frequency. */
function planningFacts({siteId,now,context,inventory,storageKg,plannedSalesKg,events,economicScenarioId='baseline',readiness=assessParkReadiness({siteId,context,now}),liveWeather,economicInputs,existingTasks=[]}) {
  const park=parkSite(siteId),thresholds=thresholdsFor(siteId),scenario=economicScenario(economicScenarioId);
  const economic=economicInputs??assembleParkEconomicInputs({siteId,now,context,inventory,storageKg,plannedSalesKg});
  const priceCnyPerKg=economic.priceBasis.cnyPerKg*(1+scenario.priceChangePct/100);
  const costPerTapping=economic.costPerTapping*scenario.costFactor,dryKgPerTapping=economic.dryKgPerTapping;
  const contributionPerTapping=dryKgPerTapping*priceCnyPerKg-costPerTapping;
  const demand=economic.demand.kind==='orders'
    ? {...economic.demand,ordersKg:economic.demand.ordersKg*Math.max(0,1+scenario.demandDelta/100)}
    : {...economic.demand,value:Math.max(0,economic.demand.value+scenario.demandDelta)};
  const live=liveWeather!==undefined;
  const outlook=live?liveWeatherOutlook({siteId,now,weather:liveWeather,events}):weatherOutlook({siteId,now,context,events,thresholds});
  for(let day=1;day<outlook.length&&day<=(scenario.weatherBlockedDays??0);day++)
    outlook[day]={...outlook[day],tappable:false,reasons:[...outlook[day].reasons,`${scenario.label}：假设当天受台风影响`],source:`${outlook[day].source}+scenario`};
  const openFaults=events.filter(event=>event.kind==='device_fault'&&event.status!=='closed');
  const zones=ZONES.map((zone,index)=>{
    const eligible=readiness.readyTrees.filter(tree=>tree.zone===zone);
    const trees=eligible.slice(0,Math.floor(eligible.length*scenario.productionFactor)),excluded={};
    for(const tree of readiness.reviewTrees.filter(tree=>tree.zone===zone))for(const reason of tree.reasons)excluded[reason]=(excluded[reason]??0)+1;
    if(trees.length<eligible.length)excluded['情景可作业容量受限']=eligible.length-trees.length;
    const fault=openFaults.find(event=>event.zone===index);
    const reserved=existingTasks.filter(task=>task.block===zone);
    const existingFrequency=Math.max(0,...trees.map(tree=>new Set(reserved.filter(task=>existingTreeIndices(task).includes(tree.treeIndex)).map(task=>task.date)).size));
    const reservedDates=new Set(reserved.map(task=>task.date));
    const days=outlook.map((day,index)=>{
      const weatherOk=day.tappable&&!day.heldZones.includes(zone)&&(!live||Boolean(scheduledWindow(day,trees.length)));
      return {index,weatherOk,ok:weatherOk&&!reservedDates.has(day.date)};
    });
    const excludedCount=readiness.reviewTrees.filter(tree=>tree.zone===zone).length+eligible.length-trees.length;
    return {zone,trees,excludedCount,excluded:Object.entries(excluded).map(([reason,count])=>({reason,count})),fault,days,reserved,existingFrequency};
  });
  if(live)for(let index=0;index<outlook.length;index++)if(outlook[index].tappable&&zones.some(zone=>zone.trees.length)&&!zones.some(zone=>zone.trees.length&&zone.days[index].weatherOk)){
    outlook[index].tappable=false;outlook[index].blockReason='short_window';outlook[index].reasons.push('连续适宜窗口不足以完成当前分区，暂不安排本日割胶');
  }
  return {park,scenario,economic,priceCnyPerKg,costPerTapping,dryKgPerTapping,contributionPerTapping,demand,live,outlook,zones,readiness};
}

function modelInput({siteId,now,economicScenarioId='baseline',liveWeather},facts) {
  const {park,scenario,economic,priceCnyPerKg,costPerTapping,dryKgPerTapping,contributionPerTapping,demand,outlook,zones}=facts;
  const uniformFrequencyProjections=Array.from({length:CARE_LIMIT_PER_WEEK+1},(_,frequencyPerWeek)=>{
    const treeTaps=zones.reduce((sum,zone)=>sum+(zone.fault?0:zone.trees.length*Math.min(Math.max(0,frequencyPerWeek-zone.existingFrequency),zone.days.filter(day=>day.ok).length)),0);
    const productionKg=kg(treeTaps*dryKgPerTapping),stockBeforeDispatchKg=kg(economic.inventory.stockKg+productionKg);
    return {frequencyPerWeek,productionKg,stockBeforeDispatchKg,remainingStorageKg:kg(economic.storageKg-stockBeforeDispatchKg),estimatedContributionCny:Math.round(treeTaps*contributionPerTapping*100)/100};
  });
  return {siteId,park:park.name,asOf:now.toISOString(),horizon:{start:outlook[0].date,end:outlook.at(-1).date,days:HORIZON_DAYS},
    scenario:{id:economicScenarioId,label:scenario.label,mode:economicScenarioId==='baseline'?'current_inputs':'explicit_simulation',priceChangePct:scenario.priceChangePct,costFactor:scenario.costFactor,demandDelta:scenario.demandDelta,productionFactor:scenario.productionFactor,weatherBlockedDays:scenario.weatherBlockedDays??0},
    economics:{inputs:economic.inputs.map(({thresholdRatio,...row})=>row),priceCnyPerKg,costPerTapping,dryKgPerTapping,contributionPerTapping,
      priceTrend:{changeRatio:economic.priceSignal.changeRatio,period:economic.priceSignal.period,periodLabel:economic.priceSignal.periodLabel,mode:economic.priceSignal.mode},
      demand,inventory:{...economic.inventory,storageKg:economic.storageKg,plannedSalesKg:economic.plannedSalesKg},
      netOrdersKg:demand.kind==='orders'?Math.max(0,demand.ordersKg-economic.inventory.availableKg):null,
      uniformFrequencyProjections,
      basis:'单位均为kg干胶、元/kg干胶、元/树次；贡献仅为参考收入减可变成本，不是已实现利润。公开月均价不是本园成交价，期货价只作为市场信息。'},
    zones:zones.map(zone=>({zone:zone.zone,readyTreeCount:zone.trees.length,excluded:zone.excluded,deviceBlocked:Boolean(zone.fault),existingFrequency:zone.existingFrequency,
      dryKgPerRound:kg(zone.trees.length*dryKgPerTapping),availableDates:zone.days.filter(day=>day.ok).map(day=>outlook[day.index].date),
      existingTasks:zone.reserved.map(task=>({id:task.id,date:task.date,status:task.status,treeCount:task.count,completedTrees:task.done}))})),
    weather:{mode:facts.live?'live':'simulated',provider:liveWeather?.provider??'园区模拟展望',fetchedAt:liveWeather?.fetchedAt??null,days:outlook.map(({date,tappable,reasons,rainProbabilityPct,rainMm})=>({date,tappable,reasons,rainProbabilityPct,rainMm}))},
    hardConstraints:{careLimitPerWeek:CARE_LIMIT_PER_WEEK,freeStorageKg:Math.max(0,economic.storageKg-economic.inventory.stockKg),
      workingHours:'06:00–12:00',minutesPerTree:MINUTES_PER_TREE,frequencyBasis:'模型割次是本期总目标；existingFrequency为可执行树已有安排或已完成割次的最大值，按树和日期去重；新增完整分区轮次需先扣除此次数。分片任务不代表整区已经完成。',storageBasis:'尚未出库的计划出货不提前释放仓容；产量算术表仅计算新增完整分区轮次。'},
  };
}

/** Apply physical/safety limits to an actual model proposal. No economic voting. */
export function calculateParkPlan(input) {
  const {siteId,now,liveWeather,economicScenarioId='baseline',modelProposal}=input;
  invariant(modelProposal?.mode==='llm','PLAN_MODEL_REQUIRED','本次未取得大模型经营建议，不能以规则方案替代。',503);
  const facts=planningFacts(input);
  const {park,scenario,economic,priceCnyPerKg,costPerTapping,dryKgPerTapping,contributionPerTapping,demand,live,outlook,readiness}=facts;
  const {inventory,storageKg,plannedSalesKg}=economic;
  const constraintAdjustments=[];
  const adjust=(zone,kind,requestedFrequency,finalFrequency,reason)=>constraintAdjustments.push({zone,kind,requestedFrequency,finalFrequency,reason});
  const zones=facts.zones.map(zone=>{
    const proposal=modelProposal.zones.find(row=>row.zone===zone.zone),requestedFrequency=proposal.frequencyPerWeek;
    let frequency=Math.min(requestedFrequency,CARE_LIMIT_PER_WEEK),hold=null;
    if(frequency<requestedFrequency)adjust(zone.zone,'care',requestedFrequency,frequency,`养护上限为每周 ${CARE_LIMIT_PER_WEEK} 次。`);
    if(zone.existingFrequency){
      const target=frequency;frequency=Math.max(0,target-zone.existingFrequency);
      adjust(zone.zone,'schedule',target,frequency,`本区部分树在本期已有最多 ${zone.existingFrequency} 次安排或已完成作业，按树和日期去重；为守住本周目标和养护上限，此次新增完整分区轮次最多 ${frequency} 次，已有任务保留原范围与进度。`);
    }
    if(zone.excluded.length)adjust(zone.zone,'health',frequency,zone.trees.length?frequency:0,`已从作业范围排除 ${zone.excludedCount} 棵未就绪或受情景限制的树，剩余 ${zone.trees.length} 棵可安排；具体原因见执行前预检。`);
    if(!zone.trees.length){frequency=0;hold='没有可割树木';}
    if(zone.fault){adjust(zone.zone,'device',frequency,0,`设备故障未恢复（${zone.fault.note}），本区暂停。`);frequency=0;hold=`设备故障未恢复（${zone.fault.note}）`;}
    const availableDays=zone.days.filter(day=>day.ok).length;
    if(frequency>availableDays){
      const occupied=zone.days.some(day=>day.weatherOk&&!day.ok);
      const reason=occupied?`扣除已有任务占用日期后，可用作业日期只允许新增 ${availableDays} 次。`:`天气及连续作业窗口只允许 ${availableDays} 次。`;
      adjust(zone.zone,occupied?'schedule':'weather',frequency,availableDays,reason);frequency=availableDays;hold=occupied?'已有任务占用部分日期，已减少新增安排次数':'天气或连续适宜窗口不足，已减少安排次数';
    }
    const picked=pickDays(zone.days,frequency);
    return {zone:zone.zone,robot:`R-${zone.zone}`,eligibleTrees:zone.trees.length,treeIndices:zone.trees.map(tree=>tree.treeIndex),excluded:zone.excluded,
      requestedFrequency,frequency,existingFrequency:zone.existingFrequency,totalFrequency:zone.existingFrequency+frequency,dates:picked.map(index=>outlook[index].date),expectedDryKg:kg(zone.trees.length*dryKgPerTapping*frequency),hold,
      existingTasks:zone.reserved.map(task=>({id:task.id,date:task.date,status:task.status,done:task.done,count:task.count})),
      ...(live?{schedule:picked.map(index=>scheduledWindow(outlook[index],zone.trees.length))}:{})};
  });
  const capacityKg=Math.max(0,storageKg-inventory.stockKg);
  let capacityFrequency=Math.max(...zones.map(zone=>zone.frequency));
  const productionAt=limit=>zones.reduce((sum,zone)=>sum+zone.eligibleTrees*dryKgPerTapping*Math.min(zone.frequency,limit),0);
  while(capacityFrequency>0&&productionAt(capacityFrequency)>capacityKg+1e-8)capacityFrequency--;
  for(const zone of zones)if(zone.frequency>capacityFrequency){
    const reason=`当前剩余仓容 ${kg(capacityKg)} kg，完整分区轮次统一限至每区最多 ${capacityFrequency} 次；计划出货完成后再重算。`;
    adjust(zone.zone,'capacity',zone.frequency,capacityFrequency,reason);
    zone.frequency=capacityFrequency;zone.dates=zone.dates.slice(0,capacityFrequency);
    zone.totalFrequency=zone.existingFrequency+zone.frequency;
    if(zone.schedule)zone.schedule=zone.schedule.slice(0,capacityFrequency);
    zone.expectedDryKg=kg(zone.eligibleTrees*dryKgPerTapping*zone.frequency);zone.hold=reason;
  }
  const actualMaximum=Math.max(...zones.map(zone=>zone.totalFrequency)),actualMinimum=Math.min(...zones.map(zone=>zone.totalFrequency));
  const stanceKey=actualMaximum===0?'pause':actualMaximum===1?'reduce':actualMaximum===2?'hold':'increase';
  const stance=STANCES[stanceKey],marketTargetFrequency=Math.max(...modelProposal.zones.map(zone=>zone.frequencyPerWeek));
  const expectedDryKg=kg(zones.reduce((sum,zone)=>sum+zone.expectedDryKg,0));
  const baselineDryKg=kg(facts.zones.reduce((sum,zone)=>sum+(zone.fault?0:zone.trees.length*dryKgPerTapping*Math.min(Math.max(0,2-zone.existingFrequency),zone.days.filter(day=>day.ok).length)),0));
  const projectedEndKg=kg(Math.max(inventory.heldKg,inventory.stockKg+expectedDryKg-plannedSalesKg));
  // Scenario changes describe input perturbations; there is no second model call
  // or rule-generated counterfactual production masquerading as a model result.
  const impact=economicImpact(scenario,{demandIndex:demand.kind==='index'?economic.demand.value:undefined,priceCnyPerKg:economic.priceBasis.cnyPerKg,costPerTapping:economic.costPerTapping},
    {demandIndex:demand.kind==='index'?demand.value:undefined,priceCnyPerKg,costPerTapping,productionKg:expectedDryKg});
  impact.changes=impact.changes.map(row=>row.key==='priceCnyPerKg'?{...row,label:'测算用干胶价'}:row);
  if(economicScenarioId==='baseline'){
    impact.summary='大模型基于本方案的行情、成本、需求和库存提出经营安排；本次不叠加情景假设。';
    impact.drivers=[{factor:'模型经营分析',horizon:'short',assumption:'使用逐项列明的原始来源。',impact:'经营割次由模型提出，固定规则只核验硬约束。',action:'查看模型引用依据与硬约束调整。'}];
  }
  const decisionReasons=[...modelProposal.zones.map(zone=>`${zone.zone}区建议 ${zone.frequencyPerWeek} 次：${zone.reason}`),...constraintAdjustments.map(row=>`${row.zone}区：${row.reason}`)];
  const economics={inputs:economic.inputs,decisionReasons,baselineFrequency:2,marketTargetFrequency,finalFrequency:actualMaximum,
    priceCnyPerKg,costPerTapping,dryKgPerTapping,contributionPerTapping:Math.round(contributionPerTapping*100)/100,
    expectedContributionCny:Math.round(zones.reduce((sum,zone)=>sum+zone.eligibleTrees*zone.frequency,0)*contributionPerTapping*100)/100,
    demandBasis:demand.kind==='orders'?`${demand.mode==='operator_confirmed'?'填报':'假设'}订单及可售库存交由模型分析`:'模拟需求指数交由模型分析，无固定需求评分',fingerprint:economic.fingerprint};
  const signals=constraintAdjustments.map((row,index)=>({key:`constraint-${index}`,label:`${row.zone}区硬约束`,value:`${row.requestedFrequency} → ${row.finalFrequency} 次`,score:0,detail:row.reason,source:row.kind}));
  const result={siteId,economicScenarioId,economicImpact:impact,park:park.name,generatedAt:now.toISOString(),validUntil:new Date(+now+86400000).toISOString(),
    horizon:{start:outlook[0].date,end:outlook.at(-1).date,days:HORIZON_DAYS},policyVersion:PARK_PLAN_POLICY_VERSION,
    decisionMode:'llm',modelProposal,constraintAdjustments,stance:stanceKey,stanceLabel:stance.label,frequencyPerWeek:actualMaximum,marketTargetFrequency,baselineFrequency:2,
    headline:`本周全园${stance.label}：核验后各区单树最多 ${actualMinimum}–${actualMaximum} 次，此次新增预计产出 ${expectedDryKg} 公斤干胶。`,
    score:null,signals,outlook,zones,readiness,economics,
    production:{expectedDryKg,baselineDryKg,deltaKg:kg(expectedDryKg-baselineDryKg),unit:'kg 干胶',dryKgPerTapping},
    inventory:{stockKg:kg(inventory.stockKg),availableKg:kg(inventory.availableKg),storageKg,utilization:Math.round(inventory.stockKg/storageKg*100)/100,plannedSalesKg:kg(plannedSalesKg),projectedEndKg,overflowKg:kg(Math.max(0,projectedEndKg-storageKg))},
    cerebellumVersion:thresholdVersionFor(siteId),salesHint:constraintAdjustments.some(row=>row.kind!=='health')?'模型建议已按天气、设备、养护或仓容限制调整，具体变化见硬约束检查。':'全园产量与库存由系统按可执行排程测算；经营取舍和分区依据见模型理由。',
    analogy:'由大模型综合经营数据提出各区割次，再检查物理与作业约束。',
    ...(live?{weather:{mode:'live',provider:liveWeather?.provider??'Open-Meteo',fetchedAt:liveWeather?.fetchedAt??null,validUntil:liveWeather?.validUntil??null,
      decisionFingerprint:liveWeather?.decisionFingerprint??null,status:liveWeather?.status??'unavailable',summary:liveWeather?.summary??'天气待更新',workingHours:'06:00–12:00',minutesPerTree:MINUTES_PER_TREE}}:{}),
    limitations:[live?'天气来自当前园区坐标的在线区域预报；只在06:00–12:00连续适宜窗口内排程。':'当前天气为模拟展望，非现场作业授权。',
      '经营割次由大模型提出，未使用价格/需求评分、利润阈值或订单量规则替代模型决策；仍需管理人员确认采用。',
      '真实公开、园区填报、模拟及人工假设逐项标注；区域月均价不等于本园成交价，预计贡献不是已实现利润。',
      '未出库的计划出货不提前释放仓容；每区只安排健康且就绪的树，养护上限每周3次。',
      '采用后生成模拟任务；排程按每树2分钟、每任务至少15分钟，开割前继续检查天气与设备。'],mode:'simulation'};
  return {id:`park-plan-${digest(result).slice(0,20)}`,...result};
}

export class ParkPlanService {
  constructor({store, simulation, makeParkContext, clock = () => new Date(),dispatchDataMode='mixed_demo',weather=null,publicDataService=null,model=null,modelInfo=null}) {
    invariant(['demo','mixed_demo'].includes(dispatchDataMode),'INVALID_DATA_MODE','全园执行数据模式无效。',400);
    Object.assign(this, {store, simulation, makeParkContext, clock,dispatchDataMode,weather,publicDataService,model,modelInfo});
    this.economicInputs=new ParkEconomicInputStore(store,clock);
    store.db.exec(`CREATE TABLE IF NOT EXISTS park_tapping_plans (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
  }
  async compute(siteId, {economicScenarioId='baseline', persist=true,authorize=()=>{}}={}) {
    siteId = normalizeSiteId(siteId);
    invariant(parkSite(siteId).regionId, 'NOT_PRODUCTION_PARK', '试验站不安排生产割胶策略。', 409);
    const now = this.clock();
    const context = this.makeParkContext({siteId, treeIds:TREE_IDS, now});
    const readiness = this.readiness(siteId,context,now);
    const economicInputs=this.resolveEconomicInputs(siteId,context,now);
    const {inventory,storageKg,plannedSalesKg}=economicInputs;
    const horizon={start:beijingDate(+now),end:beijingDate(+now+(HORIZON_DAYS-1)*86400000)};
    const replaceable=new Set(this.replaceableTasks(siteId,horizon).map(task=>task.id));
    const existingTasks=this.simulation.latestTasks(siteId).filter(task=>task.kind==='割胶'&&(task.status!=='已取消'||task.done>0)
      &&task.date>=horizon.start&&task.date<=horizon.end&&!replaceable.has(task.id));
    const input={siteId,now,context,inventory,storageKg,plannedSalesKg,economicInputs,economicScenarioId,readiness,
      existingTasks,events:this.simulation.operationalEvents.list(siteId),...(this.weather?{liveWeather:this.weather.peek(siteId)??null}:{})};
    const authorizeModel=()=>{authorize();invariant(!this.store.getModelControl().paused,'MODEL_PAUSED','模型调用已暂停，恢复后才能生成全园经营策略。',409);};
    const proposal=await proposeParkPlan({model:this.model,modelInfo:this.modelInfo,input:modelInput(input,planningFacts(input)),now,authorize:authorizeModel});
    authorize();
    invariant(!this.store.getModelControl().paused,'MODEL_PAUSED','模型调用已暂停，本次结果未保存。',409);
    const plan=calculateParkPlan({...input,modelProposal:proposal});
    return persist?this.save(plan):this.withAdoption(plan);
  }

  resolveEconomicInputs(siteId,context,now=this.clock()) {
    context??=this.makeParkContext({siteId,treeIds:TREE_IDS,now});
    const plannedSalesKg=this.simulation.salesShipments.list(siteId)
      .filter(task=>task.status==='planned'&&Date.parse(task.plannedDepartureAt)>=+now&&Date.parse(task.plannedDepartureAt)<=+now+HORIZON_DAYS*86400000)
      .reduce((sum,task)=>sum+task.plannedKg,0);
    return assembleParkEconomicInputs({siteId,now,context,inventory:this.simulation.salesInventory(siteId),
      storageKg:this.simulation.latestMarket(siteId).model?.params?.storageKg??DEFAULT_STORAGE_KG,plannedSalesKg,
      sources:this.publicDataService?.status().sources??[],settings:this.economicInputs.read(siteId).inputs});
  }
  economicCheck(plan) {
    const current=this.resolveEconomicInputs(plan.siteId);
    const legacy=plan.modelProposal?.mode!=='llm';
    const oldFrequencyBasis=!legacy&&plan.policyVersion!==PARK_PLAN_POLICY_VERSION;
    const missingSnapshot=!legacy&&!hasZoneSnapshot(plan.modelProposal);
    const conflicts=!legacy&&!missingSnapshot?inconsistentZoneGroups(plan.modelProposal.inputSnapshot,plan.modelProposal):[];
    const changed=plan.economics?.fingerprint!==current.fingerprint;
    return {needsRecompute:legacy||oldFrequencyBasis||missingSnapshot||conflicts.length>0||changed,reason:legacy?'这是历史规则方案，请由大模型重新生成经营策略。':oldFrequencyBasis?'原方案尚未按已有任务合计本周割次，请重新测算后采用。':missingSnapshot?'原方案缺少完整分区数据快照，无法核验分区建议，请重新生成。':conflicts.length?`原方案对条件相同的 ${conflicts.map(group=>group.join('、')+' 区').join('；')} 给出不同割次，缺少分区依据，请重新生成。`:changed?'行情、成本、订单或库存依据已变化，请重新测算后采用。':null};
  }
  save(plan) {
    this.store.db.prepare('INSERT OR IGNORE INTO park_tapping_plans VALUES(?,?,?,?)').run(plan.id, plan.siteId, JSON.stringify(plan), plan.generatedAt);
    return this.withAdoption(this.get(plan.id));
  }
  readiness(siteId,context,now=this.clock()) {
    return assessParkReadiness({siteId,context,now,store:this.store,simulation:this.simulation,dispatchDataMode:this.dispatchDataMode});
  }
  get(id) {
    const row = this.store.db.prepare('SELECT body FROM park_tapping_plans WHERE id=?').get(id);
    invariant(row, 'PLAN_NOT_FOUND', '割胶策略不存在，请重新生成。', 404);
    return JSON.parse(row.body);
  }
  /** Latest plan; `baselineOnly` skips what-if scenario plans (the decision list uses only real conditions). */
  latest(siteId, {baselineOnly = false} = {}) {
    siteId = normalizeSiteId(siteId);
    const row = this.store.db.prepare(`SELECT body FROM park_tapping_plans WHERE site_id=?
      AND (? = 0 OR COALESCE(json_extract(body,'$.economicScenarioId'),'baseline')='baseline') ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(siteId, baselineOnly ? 1 : 0);
    return row ? this.withAdoption(JSON.parse(row.body)) : null;
  }
  adopted(siteId) {
    return this.store.db.prepare(`SELECT body FROM park_tapping_plans WHERE site_id=? AND json_extract(body,'$.adoption') IS NOT NULL ORDER BY created_at DESC`)
      .all(siteId).map(row => JSON.parse(row.body));
  }
  replaceableTasks(siteId,horizon,siteTasks=this.simulation.latestTasks(siteId)) {
    const overlapping=this.adopted(siteId).filter(other=>other.horizon.end>=horizon.start&&other.horizon.start<=horizon.end);
    return siteTasks.filter(task=>overlapping.some(other=>other.id===task.sourceParkPlanId)&&task.status==='待开始'&&task.done===0);
  }
  weatherCheck(plan) {
    if(!this.weather)return null;
    const current=this.weather.peek(plan.siteId),now=+this.clock();
    const missing=!current || current.status!=='available' || current.stale || !(Date.parse(current.validUntil)>now);
    const changed=!plan.weather || plan.weather.decisionFingerprint!==current?.decisionFingerprint;
    const past=plan.horizon.start!==beijingDate(now) || plan.zones.some(zone=>(zone.schedule??[]).some(slot=>Date.parse(`${slot.date}T${slot.start}:00+08:00`)<now));
    const reason=missing?'在线天气不可用或已过期，请更新天气后重新测算。':changed?'天气条件已更新，需重新测算割胶安排。':past?'原排程包含已过去的作业时段，请重新测算。':null;
    return {needsRecompute:Boolean(reason),reason,currentFetchedAt:current?.fetchedAt??null};
  }
  withAdoption(plan) {
    const weatherCheck=this.weatherCheck(plan);
    if(weatherCheck)plan={...plan,weatherCheck};
    if (!plan.adoption) return {...plan,economicCheck:this.economicCheck(plan)};
    const siteTasks=this.simulation.latestTasks(plan.siteId),tasks=siteTasks.filter(task=>task.sourceParkPlanId===plan.id);
    const summary=task=>({id:task.id,zone:task.block,date:task.date,status:task.status,done:task.done,count:task.count});
    const includedIds=new Set(plan.zones.flatMap(zone=>(zone.existingTasks??[]).map(task=>task.id)));
    const existingTasks=siteTasks.filter(task=>task.kind==='割胶'&&task.sourceParkPlanId!==plan.id&&(includedIds.has(task.id)||plan.adoption.skipped.some(skip=>
      skip.taskIds?skip.taskIds.includes(task.id):task.status!=='已取消'&&task.block===skip.zone&&task.date===skip.date)));
    return {...plan, adoption:{...plan.adoption,tasks:tasks.map(summary),existingTasks:existingTasks.map(summary)}};
  }
  adopt({planId, siteId, replace = false}, identity = null) {
    const plan = this.get(planId);
    invariant(siteId === undefined || normalizeSiteId(siteId) === plan.siteId, 'SITE_MISMATCH', '策略不属于当前园区。', 409);
    identity?.require('park_plan.write', '只有农场管理可以采用全园割胶策略。');
    identity?.requireSite(plan.siteId);
    if (plan.adoption) return this.withAdoption(plan);
    invariant(plan.modelProposal?.mode==='llm','PLAN_MODEL_REQUIRED','历史规则方案不能直接采用，请由大模型重新生成。',409);
    invariant(hasZoneSnapshot(plan.modelProposal),'PARK_MODEL_INPUT_REQUIRED','原方案缺少完整分区数据快照，无法核验分区建议，请重新生成。',409);
    const conflicts=inconsistentZoneGroups(plan.modelProposal.inputSnapshot,plan.modelProposal);
    invariant(!conflicts.length,'PARK_MODEL_INCONSISTENT_ZONES',`原方案对条件相同的 ${conflicts.map(group=>group.join('、')+' 区').join('；')} 给出不同割次，缺少分区依据，请重新生成。`,409);
    const weatherCheck=this.weatherCheck(plan);
    invariant(!weatherCheck?.needsRecompute,'PLAN_WEATHER_CHANGED',weatherCheck?.reason??'天气条件已更新，请重新测算。',409,{weatherCheck});
    invariant(plan.readiness,'PLAN_READINESS_REQUIRED','旧方案未记录逐树预检，请重新测算后采用。',409);
    invariant(+this.clock() - Date.parse(plan.generatedAt) < 86400000, 'PLAN_EXPIRED', '策略已超过 24 小时，请重新生成。', 409);
    const economicCheck=this.economicCheck(plan);
    invariant(!economicCheck.needsRecompute,'PLAN_ECONOMICS_CHANGED',economicCheck.reason,409,{economicCheck});
    const checkedAt=this.clock(),context=this.makeParkContext({siteId:plan.siteId,treeIds:TREE_IDS,now:checkedAt});
    const currentReadiness=this.readiness(plan.siteId,context,checkedAt);
    invariant(readinessFingerprint(currentReadiness)===readinessFingerprint(plan.readiness),'PLAN_READINESS_CHANGED',
      '树木可执行范围或待核查原因已变化，请重新测算后采用。',409,{readiness:currentReadiness});
    const siteTasks = this.simulation.latestTasks(plan.siteId);
    const replaceable = this.replaceableTasks(plan.siteId,plan.horizon,siteTasks);
    invariant(!replaceable.length || replace, 'PLAN_CONFLICT', `本周已有采用中的全园策略（${replaceable.length} 项待开始任务）；确认替换后，旧策略未开始的任务会取消。`, 409,
      {taskIds:replaceable.map(task => task.id)});
    const now = this.clock().toISOString(), adoptedBy = identity?.accountId ?? 'local-tool';
    const cancelReason = `由全园割胶策略 ${plan.stanceLabel}（${plan.id}）替换`;
    const cancelled = replaceable.length ? this.simulation.tasks({tasks:replaceable.map(task => ({...task, status:'已取消',cancelReason,
      ...(task.dispatch?{dispatch:{...task.dispatch,phase:'cancelled',auto:undefined,
        history:[...task.dispatch.history,{time:now,label:cancelReason}]}}:{})}))}) : null;
    invariant(!cancelled?.conflicts.length, 'PLAN_CONFLICT', '旧策略任务已有更新，请刷新后重试。', 409, cancelled?.conflicts);
    const busy = siteTasks.filter(task => task.kind === '割胶' && task.status !== '已取消' && !replaceable.includes(task));
    const site = parkSite(plan.siteId).key, tasks = [], skipped = [];
    for (const zone of plan.zones) zone.dates.forEach((date, round) => {
      const occupied=busy.filter(task=>task.block===zone.zone&&task.date===date);
      if (occupied.length) { skipped.push({zone:zone.zone,date,reason:'该区当天已有割胶任务',taskIds:occupied.map(task=>task.id)}); return; }
      tasks.push(this.simulation.preparePlannedTask({id:`${plan.id}-${zone.zone}-${round}`, sourceParkPlanId:plan.id, dataMode:'demo', date, site, siteId:plan.siteId,
        block:zone.zone, robot:zone.robot, title:`全园策略 · ${plan.stanceLabel} · ${zone.zone}区第${round + 1}轮`,
        start:zone.schedule?.[round]?.start??'06:30', end:zone.schedule?.[round]?.end??'—', count:zone.treeIndices.length, done:0, status:'待开始', kind:'割胶', treeIndices:zone.treeIndices, autoPlanned:true}));
    });
    const saved = tasks.length ? this.simulation.tasks({tasks}) : {conflicts:[]};
    invariant(!saved.conflicts.length, 'PLAN_TASKS_REJECTED', '部分任务未能创建，请刷新后重试。', 409, saved.conflicts);
    const adopted = {...plan, adoption:{adoptedAt:now, adoptedBy, taskIds:tasks.map(task => task.id), skipped,reviewTrees:structuredClone(plan.readiness.reviewTrees),
      replacedTaskIds:replaceable.map(task => task.id)}};
    this.store.db.prepare('UPDATE park_tapping_plans SET body=? WHERE id=?').run(JSON.stringify(adopted), plan.id);
    return this.withAdoption(adopted);
  }
}
