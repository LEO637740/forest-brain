import { makeParkContext, parkSite } from './park-demo.js';
import { CARE_LIMIT_PER_WEEK } from '../market-policy.js';
import { digest } from '../util.js';
import { validate } from '../schema.js';
import { contextSchema } from '../contracts.js';
import { SOURCE_REQUIREMENTS } from '../source-coverage.js';
import { makeBusinessDemo, publicSimulationRecord } from './business-demo.js';
import { INDUSTRY_POLICY } from '../industry-policy.js';
import { rubberDocumentRecord } from '../commodity-reference.js';

// Recheck deadlines at the snapshot's own time. A cached status flag may have
// been produced before a refresh or just before the source expires.
const usableSource=(source,now)=>Boolean(source?.data&&!source.stale&&Date.parse(source.validUntil)>+now&&Date.parse(source.retrievedAt)<=+now+300000);
const futureWeatherSteps=(weather,now)=>(weather?.data?.forecast??[]).filter(s=>Date.parse(s.validFrom)>=+now).map(({validFrom,validTo,rainfallMm,rainProbabilityPct})=>({validFrom,validTo,rainfallMm,rainProbabilityPct}));
const validWeatherStep=s=>Date.parse(s.validTo)>Date.parse(s.validFrom)&&Number.isFinite(s.rainfallMm)&&s.rainfallMm>=0&&Number.isFinite(s.rainProbabilityPct)&&s.rainProbabilityPct>=0&&s.rainProbabilityPct<=100;

// Real public sources and synthetic tree fixtures are kept distinguishable.
// Never substitute regional estimates for an on-site sensor, or futures for a farm sale.
export function makePublicContext({ treeIds, service, now = new Date(), siteId = 'demo-hainan', site = null }) {
  const context = makeParkContext({ treeIds, now, siteId, site });
  const siteKey = parkSite(context.siteId).key;
  const status = service.status(), w = status.sources.find(x => x.id === 'weather');
  const gaps = [], snapshots = [];
  const gap = (module, field, reason) => gaps.push({ module, field, objectId: context.siteId, reason });
  context.modules.weather.observed = null;
  context.modules.weather.forecast = null;
  gap('weather','observed','尚未接入现场传感器；公开天气服务的模型估计不能冒充实测雨量、温湿度。');
  if (!status.location.confirmed || status.location.siteId !== context.siteId) gap('weather','location','园区坐标尚未确认；当前公开天气仅供参考地点展示，不可用来给本园区作业结论。');
  if (usableSource(w,now)) {
    const steps = futureWeatherSteps(w,now);
    if (steps.length) context.modules.weather.forecast = {
      forecastRunId: w.snapshotId, issuedAt: w.retrievedAt, issuedAtBasis: 'retrieved', timezone: 'Asia/Shanghai', steps,
      provenance: { sourceId: w.snapshotId, sourceClass: 'web_service', mode: 'forecast' }, quality: 'valid',
    };
    if(steps.length)snapshots.push(w.snapshotId);
  } else gap('weather','forecast',w?.lastError ? '公开天气获取失败，未回退到模拟天气；历史快照仅供查看。' : '公开天气尚未获取或已过期，请刷新数据源。');
  delete context.modules.market;
  gap('market','spotPrice','已采集上期所天然橡胶期货行情作为宏观参考，但缺少对应品级的实际现货销售价，不能自动代入经营收益。');
  gap('market','costAssumptions','尚无园区真实成本和单次干胶产量假设，未使用演示数值计算经营收益。');
  context.sourceSnapshots = snapshots; context.sourceRequirements = gaps;
  context.snapshotId = `input-${digest(context).slice(0,24)}`;
  return validate(contextSchema,context);
}

export function makeMixedContext({treeIds,service,now=new Date(),siteId='demo-hainan',site=null}) {
  const context=makeParkContext({treeIds,now,siteId,site});
  const siteKey = parkSite(context.siteId).key;
  const status=service.status(), weather=status.sources.find(s=>s.id==='weather');
  const substitutions=[
    {module:'trees',sourceId:'demo-tree-register',reason:'没有真实树木档案；使用既有 200 棵合成树。'},
    {module:'weather',sourceId:`demo-station-${siteKey}`,reason:'没有现场传感器接口；现场观测使用模拟值。'},
    {module:'inspection',sourceId:`demo-camera-${siteKey}`,reason:'没有真实图像检测；使用模拟检测标记，不生成假照片。'},
    {module:'growth',sourceId:'demo-measurements',reason:'没有真实生长序列；使用模拟历史。'},
    {module:'health',sourceId:'demo-inspection',reason:'没有真实巡查记录；使用模拟症状。'},
    {module:'tapping',sourceId:`demo-panel-register-${siteKey}`,reason:'没有真实割面记录；使用模拟计划。'},
    {module:'market',sourceId:'demo-operator-assumptions',reason:'没有园区现货、成本与产量记录；使用模拟报价和假设，未把期货当现货。'},
    {module:'knowledge',sourceId:'demo-research_partner',reason:'没有合作方专有模型和专家记录；使用已标注的演示约束。'},
  ];
  const futureSteps=futureWeatherSteps(weather,now),steps=futureSteps.filter(validWeatherStep);
  const usable=status.location.confirmed && status.location.siteId===context.siteId && usableSource(weather,now) && steps.length;
  const notices=['本次包含模拟数据，仅用于演示；替代项逐条列出，不能解释为真实园区决策。','真实公开资料继续保留在来源页与行业研判中；树级分析只使用范围匹配的证据。'];
  context.sourceSnapshots=[];
  if(usable) {
    context.modules.weather.forecast={forecastRunId:weather.snapshotId,issuedAt:weather.retrievedAt,issuedAtBasis:'retrieved',timezone:'Asia/Shanghai',steps,provenance:{sourceId:weather.snapshotId,sourceClass:'web_service',mode:'forecast'},quality:'valid'};
    context.sourceSnapshots.push(weather.snapshotId);
    if(steps.length<futureSteps.length)notices.push(`真实预报有 ${futureSteps.length-steps.length} 个未来时段缺少有效数值，已排除这些时段；仅对剩余 ${steps.length} 个真实时段分析，未用模拟值填补真实批次。`);
    if(weather.lastError)notices.push('天气最近更新失败，本次仍使用尚未过期的真实快照；获取时间与原始数值保持不变。');
  } else substitutions.push({module:'weather',sourceId:'demo-weather-service',reason:!status.location.confirmed||status.location.siteId!==context.siteId?'园区位置未确认或不匹配，参考点实况不能代替园区；本次作业演示使用模拟预报。':'公开天气不可用、过期或有关键空值，使用模拟预报演示。'});
  context.dataPolicy={mode:'mixed_demo',notices,substitutions};
  context.snapshotId=`input-${digest(context).slice(0,24)}`;
  return validate(contextSchema,context);
}

/** Industry-wide public context: shared by every park, owned by none. */
export const INDUSTRY_SITE_ID='public-rubber-industry';
export function makeIndustryContext({service,now=new Date(),supplementSimulated=false,dataMode}) {
  const mode=dataMode??(supplementSimulated?'mixed_demo':'public');
  supplementSimulated=mode!=='public';
  const status=mode==='demo'?{location:{confirmed:false},sources:[]}:service.status(), records=[], gaps=SOURCE_REQUIREMENTS.filter(x=>!x.sources.length).map(x=>`${x.requirement}：${x.boundary}`);
  const substitutions=[];
  for(const requirement of SOURCE_REQUIREMENTS.filter(x=>x.sources.length))if(!requirement.sources.some(id=>status.sources.some(source=>source.id===id)))gaps.push(`${requirement.requirement}：没有可用公开资料缓存，未补造真实资料。`);
  if(!status.location.confirmed) gaps.push('园区位置尚未确认，天气仅为参考地点，不能用于园区作业结论。');
  for(const s of status.sources) {
    if(!usableSource(s,now)) {
      const replacement=supplementSimulated?publicSimulationRecord(s,now):null;
      gaps.push(`${s.title}：真实来源不可用或过期${replacement?'，本次使用标注为 simulated 的演示样例。':'，未补造。'}`);
      if(replacement){records.push(replacement);substitutions.push({module:'industry',sourceId:replacement.provenance.sourceId,reason:`${s.title}缺少可用真实值，使用模拟替代。`});}
      continue;
    }
    if(s.lastError) gaps.push(`${s.title}：最近更新失败，本次引用上次成功获取且仍在有效期的快照。`);
    const d=s.data;
    const forecast=s.id==='weather'?d.forecast.filter(x=>Date.parse(x.validFrom)>=+now).slice(0,24):null;
    const missingWeatherHours=forecast?.filter(x=>!validWeatherStep(x))??[];
    if(missingWeatherHours.length)gaps.push(`${s.title}：所列未来 ${forecast.length} 个时段中 ${missingWeatherHours.length} 个时段缺少有效降雨量或概率，空值不是零，不能据此判断无雨或计算完整时段降雨总量。`);
    const content=s.id==='weather'?{location:d.location,referenceOnly:!status.location.confirmed,basis:d.basis,currentEstimate:d.currentEstimate,forecast,forecastCoverage:{timezone:'Asia/Shanghai',start:forecast[0]?.validFrom??null,end:forecast.at(-1)?.validTo??null,returnedHours:forecast.length,completeHours:forecast.length-missingWeatherHours.length,missingHours:missingWeatherHours.map(x=>({start:x.validFrom,end:x.validTo}))},limitation:d.limitation}:d;
    records.push({observationId:s.snapshotId,topic:s.id,title:s.title,scope:d.scope??(s.id==='weather'?d.location.name:s.id==='market'?'上海期货交易所期货合约':s.id==='warehouse'?'上期所注册仓单':'全国橡胶产区'),period:d.period??d.tradeDate??d.reportDate??d.fetchedAt??'2026 年度',retrievedAt:s.retrievedAt,expiresAt:s.validUntil,sourceUrl:s.sourceUrl,content:JSON.stringify(content),provenance:{sourceId:s.snapshotId,sourceClass:'web_service',mode:s.id==='weather'?'forecast':s.id.includes('pest')||s.id==='bulletin'?'estimated':'measured'},quality:'valid'});
  }
  if(supplementSimulated) {
    const business=makeBusinessDemo(now);records.push(...business);
    substitutions.push(...business.map(r=>({module:'industry',sourceId:r.provenance.sourceId,reason:`${r.title}：没有真实业务接口或记录，使用关联的模拟企业场景。`}))); 
    gaps.push('订单、加工、企业库存、运输已用模拟记录支持演示，但真实业务接口与事实仍缺失；相关建议必须标明为模拟情景。');
  }
  if(mode!=='demo') records.push(rubberDocumentRecord(now));
  const siteId=INDUSTRY_SITE_ID;
  const context={snapshotId:'pending',version:1,siteId,asOf:now.toISOString(),validUntil:new Date(+now+3600000).toISOString(),executionMode:'simulation',targetSnapshot:{targetSnapshotId:'target-public-rubber-industry-v1',siteId,treeIds:[]},constraints:{minCutSlopeDeg:20,maxCutSlopeDeg:40,maxTappingsPerWeek:CARE_LIMIT_PER_WEEK,ruleSetId:INDUSTRY_POLICY.version},modules:{industry:{records,gaps},knowledge:{rules:[{...INDUSTRY_POLICY,validUntil:new Date(+now+86400000).toISOString(),provenance:{sourceId:'harness-product-policy',sourceClass:'research_partner',mode:'estimated'},quality:'valid'}]}},sourceSnapshots:records.map(x=>x.observationId)};
  if(supplementSimulated)context.dataPolicy={mode,notices:[mode==='demo'?'本次使用明确标注的模拟企业资料；公开来源没有参与此演示快照。':'真实公开资料优先保留；企业数据及不可用来源用明确标注的模拟记录补齐。','模拟数据只支持演示情景，不是实际经营记录，建议需人工复核。'],substitutions};
  context.snapshotId=`input-${digest(context).slice(0,24)}`;
  return validate(contextSchema,context);
}
