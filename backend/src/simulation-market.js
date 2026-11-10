import {invariant} from './errors.js';
import {makeParkContext,TREE_IDS,normalizeSiteId} from './adapters/park-demo.js';
import {digest} from './util.js';
import {CARE_LIMIT_PER_WEEK,deriveMarketFrequencyPolicy,marketTreeExclusion} from './market-policy.js';
import {economicScenario,economicImpact} from './economic-scenario.js';
const money=value=>Math.round(value*100)/100;

// Compare the same dry-rubber stock and production under three sale schedules.
// Unsold stock is valued separately so it is never reported as cash revenue.
function salesComparison({params,forecast,produced,frequency,eligibleTreeCount}) {
 const assumptions={transportCostCnyPerKg:0.35,holdingCostCnyPerKgDay:0.02,holdDays:3,firstStageTransportRatio:0.5};
 const definitions=[
  {id:'sell_now',name:'立即销售',schedule:'每天按可用运力销售可售库存',capacity:()=>params.transportKgPerDay},
  {id:'hold_short',name:'短期囤货',schedule:'暂存 3 天，第 4 天起按可用运力销售',capacity:day=>day<3?0:params.transportKgPerDay},
  {id:'sell_phased',name:'分批销售',schedule:'前 3 天使用一半运力，第 4 天起使用全部运力',capacity:day=>params.transportKgPerDay*(day<3?0.5:1)},
 ];
 const scenarios=definitions.map(definition=>{
  let stock=params.stockKg,overflow=0;
  const daily=Array.from({length:7},(_,day)=>{
   const incoming=produced/7,saleCapacity=definition.capacity(day);
   const sold=Math.min(Math.max(0,stock+incoming-params.heldKg),saleCapacity);
   stock+=incoming-sold;overflow=Math.max(overflow,stock-params.storageKg);
   return {day:day+1,at:forecast[day].at,incomingKg:incoming,soldKg:sold,stockKg:stock,availableKg:Math.max(0,stock-params.heldKg),priceCnyPerKg:forecast[day].value,revenueCny:sold*forecast[day].value,transportCostCny:sold*assumptions.transportCostCnyPerKg,holdingCostCny:stock*assumptions.holdingCostCnyPerKgDay};
  });
  const sum=key=>daily.reduce((total,row)=>total+row[key],0);
  const productionCostCny=eligibleTreeCount*frequency*params.costPerTapping;
  const revenueCny=sum('revenueCny'),transportCostCny=sum('transportCostCny'),holdingCostCny=sum('holdingCostCny');
  const cashContributionCny=revenueCny-productionCostCny-transportCostCny-holdingCostCny;
  const endingAvailableKg=Math.max(0,stock-params.heldKg),endingInventoryValueCny=endingAvailableKg*forecast[6].value;
  return {id:definition.id,name:definition.name,schedule:definition.schedule,producedKg:produced,soldKg:sum('soldKg'),endingStockKg:stock,endingAvailableKg,revenueCny:money(revenueCny),productionCostCny:money(productionCostCny),transportCostCny:money(transportCostCny),holdingCostCny:money(holdingCostCny),cashContributionCny:money(cashContributionCny),endingInventoryValueCny:money(endingInventoryValueCny),comparisonValueCny:money(cashContributionCny+endingInventoryValueCny),overflowKg:Math.max(0,overflow),feasible:overflow<=1e-6,daily};
 });
 const recommended=[...scenarios].filter(row=>row.feasible).sort((a,b)=>b.comparisonValueCny-a.comparisonValueCny||b.cashContributionCny-a.cashContributionCny)[0];
 return {horizonDays:7,productionFrequencyPerWeek:frequency,assumptions,scenarios,recommendedScenarioId:recommended?.id??null,
  recommendationReason:recommended?`在仓容和每日运力内，${recommended.name}的“现金贡献＋期末可售库存估值”为 ${recommended.comparisonValueCny.toFixed(2)} 元，在本组模拟方案中最高；现金贡献 ${recommended.cashContributionCny.toFixed(2)} 元、期末可售库存 ${recommended.endingAvailableKg.toFixed(1)} kg，供人工比较。`:'当前仓容下没有可采用的销售方案，请调整仓容、运力或生产安排。',
  basis:['全部数量为 kg 干胶，价格为元/kg 干胶；未来 7 日报价为模拟历史线性外推。','按推荐割次的产量均摊到 7 天；每日新增产量入库后销售，再核算仓容。','质检冻结库存全程不可售；假设可售部分已有买方接货，未接入真实订单。',`模拟运输费 ${assumptions.transportCostCnyPerKg} 元/kg、持有费 ${assumptions.holdingCostCnyPerKgDay} 元/(kg·日)，持有费按日末总库存计算。`,'现金贡献＝销售收入－本期生产、运输和持有成本；期初库存历史成本未提供，此值不是利润。','期末可售库存按第 7 日模拟价格单独估值；比较值不是现金收入，真实价格或订单变化后应重新计算。']};
}
export function calculateMarket(input={},now=new Date(),contextFactory=makeParkContext) {
 const siteId=normalizeSiteId(input.siteId??'demo-hainan');
 const {siteId: _ignoredSiteId,economicScenarioId='baseline', ...numericInput}=input;
 const economy=economicScenario(economicScenarioId);
 const defaults={storageKg:900,stockKg:800,heldKg:400,transportKgPerDay:40,treeCount:200,dryKgPerTapping:0.3,costPerTapping:2,careLimit:CARE_LIMIT_PER_WEEK,demandIndex:105,demandBaseline:100};
 const limits={storageKg:100000,stockKg:100000,heldKg:100000,transportKgPerDay:100000,treeCount:200,dryKgPerTapping:10,costPerTapping:100,careLimit:CARE_LIMIT_PER_WEEK,demandIndex:200,demandBaseline:200};
 const params={...defaults,...numericInput};
 invariant(Object.keys(params).every(k=>k in limits&&Number.isFinite(params[k])&&params[k]>=0&&params[k]<=limits[k]),'INVALID_PARAMETERS','情景参数超出范围',400);
 invariant(params.heldKg<=params.stockKg&&params.stockKg<=params.storageKg&&Number.isInteger(params.treeCount)&&Number.isInteger(params.careLimit),'INVALID_PARAMETERS','冻结量不可大于库存，库存不可大于仓容，树数与割次必须为整数',400);
 const context=contextFactory({treeIds:TREE_IDS,now,siteId});
 const effectiveDemand=Math.max(0,params.demandIndex+economy.demandDelta);
 const demandCapacityFactor=params.demandIndex>0?Math.min(1,effectiveDemand/params.demandIndex):1;
 const effectiveParams={...params,demandIndex:effectiveDemand,transportKgPerDay:params.transportKgPerDay*economy.transportFactor,costPerTapping:params.costPerTapping*economy.costFactor};
 const salesCapacityKgPerDay=effectiveParams.transportKgPerDay*demandCapacityFactor;
 context.modules.market.demand.value=effectiveDemand;
 context.modules.market.demand.baselineValue=params.demandBaseline;
 const requestedTrees=context.modules.trees.slice(0,params.treeCount);
 const policy=deriveMarketFrequencyPolicy({market:context.modules.market,trees:requestedTrees,weather:context.modules.weather,health:context.modules.health,maxTappingsPerWeek:params.careLimit});
 const eligibleTreeIds=policy.eligible.map(tree=>tree.treeId),eligibleTreeCount=eligibleTreeIds.length;
 const excludedTrees=requestedTrees.filter(tree=>!eligibleTreeIds.includes(tree.treeId)).map(tree=>({treeId:tree.treeId,reason:marketTreeExclusion(tree)}));
 const prices=context.modules.market.prices.map(p=>({at:p.observedAt,value:p.value}));
 const n=prices.length,meanX=(n-1)/2,mean=prices.reduce((s,p)=>s+p.value,0)/n;
 const slope=prices.reduce((s,p,i)=>s+(i-meanX)*(p.value-mean),0)/prices.reduce((s,_,i)=>s+(i-meanX)**2,0);
 const last=prices.at(-1).value;
 const forecast=Array.from({length:8},(_,i)=>({at:new Date(+now+i*86400000).toISOString(),value:Math.max(0,+((last+slope*i)*(1+economy.priceChangePct/100)).toFixed(3))}));
 const scenarios=Array.from({length:params.careLimit+1},(_,frequency)=>{
  const produced=eligibleTreeCount*params.dryKgPerTapping*frequency*economy.productionFactor;
  let stock=params.stockKg,overflow=0,delivered=0;
  const daily=Array.from({length:7},(_,day)=>{const incoming=produced/7;const available=stock+incoming;const shipped=Math.min(Math.max(0,available-params.heldKg),salesCapacityKgPerDay);stock=available-shipped;overflow=Math.max(overflow,stock-params.storageKg);delivered+=shipped;return {day:day+1,incoming,shipped,stock};});
  const contribution=produced*forecast.at(-1).value-eligibleTreeCount*frequency*effectiveParams.costPerTapping;
  return {frequency,produced,delivered,endingStock:stock,contribution:+contribution.toFixed(2),feasible:frequency<=params.careLimit&&overflow<=0,overflow:Math.max(0,overflow),daily};
 });
 const candidates=scenarios.filter(s=>s.feasible);
 const target=candidates.find(s=>s.frequency===policy.targetFrequencyPerWeek) ?? candidates.sort((a,b)=>b.contribution-a.contribution||a.frequency-b.frequency)[0];
 const sales=target?salesComparison({params:{...effectiveParams,transportKgPerDay:salesCapacityKgPerDay},forecast,produced:target.produced,frequency:target.frequency,eligibleTreeCount}):null;
 const baseModel=economicScenarioId==='baseline'?null:calculateMarket({...input,economicScenarioId:'baseline'},now,contextFactory);
 const impact=economicImpact(economy,{demandIndex:params.demandIndex,productionKg:baseModel?.economicImpact.effective.productionKg??target?.produced??0,transportKgPerDay:params.transportKgPerDay,salesCapacityKgPerDay:params.transportKgPerDay,priceCnyPerKg:last,costPerTapping:params.costPerTapping},{demandIndex:effectiveDemand,productionKg:target?.produced??0,transportKgPerDay:effectiveParams.transportKgPerDay,salesCapacityKgPerDay,priceCnyPerKg:forecast[0].value,costPerTapping:effectiveParams.costPerTapping});
 if(sales&&economicScenarioId!=='baseline')sales.basis.push(`经济情景：${economy.label}。${economy.summary} 本次每日可消化量上限 ${salesCapacityKgPerDay.toFixed(1)} kg；情景假设未写入实际库存。`);
 const result={siteId,economicScenarioId,economicImpact:impact,generatedAt:now.toISOString(),method:'linear-price-stock-balance-v3-sales',source:'synthetic_prices_demand_and_business_assumptions',unit:'CNY/kg dry rubber',params,prices,forecast,scenarios,sales,recommendedFrequency:target?.frequency??null,demand:{value:effectiveDemand,baselineValue:params.demandBaseline,unit:'index_0_100',band:policy.demand.band,provenanceMode:context.modules.market.demand.provenance.mode},eligibleTreeIds,excludedTrees,eligibleTreeCount,excludedTreeCount:params.treeCount-eligibleTreeCount,exclusions:policy.exclusions,policyReasons:policy.reasons,limitation:policy.limitation};
 return {id:'market-'+digest(result).slice(0,24),...result};
}
