import {invariant} from './errors.js';

// These are explicit demo assumptions, not estimates inferred from the research PDF.
export const ECONOMIC_SCENARIOS = [
 {id:'baseline',label:'当前经营条件',summary:'沿用当前产量、运力、需求和模拟报价。',productionFactor:1,transportFactor:1,demandDelta:0,priceChangePct:0,costFactor:1,drivers:[
  {factor:'天气与物流',horizon:'short',assumption:'新增扰动为 0；继续使用园区天气和运力。',impact:'维持当前产量与出货能力',action:'按现有天气窗口和销售计划执行。'},
  {factor:'需求、政策与期货情绪',horizon:'short',assumption:'本次均不追加变动。',impact:'维持模拟报价和需求指数',action:'拿到订单、政策或现货报价后重算。'},
 ]},
 {id:'typhoon',label:'台风影响生产运输',summary:'假设未来 3 天受台风影响不能割胶，可采产量减少 40%、运力减半、成本增加 15%；供给收缩与情绪使模拟报价上涨 8%，但灾害期间不因涨价增产。',productionFactor:0.6,transportFactor:0.5,demandDelta:0,priceChangePct:8,costFactor:1.15,
  // A disaster closes tapping days and forbids raising output on the price spike.
  weatherBlockedDays:3,disaster:true,drivers:[
  {factor:'自然灾害与运输',horizon:'short',assumption:'明天起 3 天不可割，可采产量 ×0.6，日运力 ×0.5，单次割胶成本 ×1.15。',impact:'可割天数减少、减产、延迟出货，库存消化变慢',action:'台风前后暂停受影响分区，检查雨情与通行，按减半运力重排出货。'},
  {factor:'供给收缩与期货情绪',horizon:'short',assumption:'模拟干胶报价 +8%；只影响销售收入比较，不作为增加割次的理由。',impact:'价格上涨可能无法抵消减产和物流损失',action:'比较可交付数量与现金回款，不因涨价突破可割条件或增产。'},
 ]},
 {id:'demand_weak',label:'下游需求转弱',summary:'假设需求指数降低 25 点、模拟报价下降 10%，并减少每日可消化数量。',productionFactor:1,transportFactor:1,demandDelta:-25,priceChangePct:-10,costFactor:1,drivers:[
  {factor:'汽车、轮胎及新产品需求',horizon:'short',assumption:'需求指数 -25 点；可消化量按相对原需求同比下降。',impact:'订单减少，减产或分批销售更有必要',action:'优先落实已确认订单，降低新增产量。'},
  {factor:'期货与市场情绪',horizon:'short',assumption:'模拟报价 -10%；并非从期货价格直接换算。',impact:'影响销售收入和期末库存估值',action:'按新报价重算，不把模拟涨跌当真实预测。'},
 ]},
 {id:'policy_supply',label:'政策释放市场供给',summary:'假设市场供给增加压低模拟报价 6%，需求指数下降 10 点，园区物理产能不变。',productionFactor:1,transportFactor:1,demandDelta:-10,priceChangePct:-6,costFactor:1,drivers:[
  {factor:'政策与市场供给',horizon:'short',assumption:'外部可售供给增加；园区需求指数 -10 点、模拟报价 -6%。',impact:'卖方竞争加剧，影响销售与控产选择',action:'确认订单和交货渠道，再决定割次与分批出货。'},
 ]},
 {id:'robot_recovery',label:'机器人降低作业成本',summary:'假设现有作业单次成本降低 20%；恢复弃割产能另作长期投资算例。',productionFactor:1,transportFactor:1,demandDelta:0,priceChangePct:0,costFactor:0.8,drivers:[
  {factor:'劳动力与技术创新',horizon:'long',assumption:'现有单次割胶成本 ×0.8；现有可割树数和天气约束不变。',impact:'改善经营贡献，是否增产仍取决于需求和可割条件',action:'先用一片可作业地块试点，记录实际工时、产量和维护费。'},
  {factor:'弃割产能恢复与区域转移',horizon:'long',assumption:'以明示的人工、机器人覆盖树数测算恢复产量和投资回收。',impact:'新增产量和机器费用共同决定投资是否划算',action:'核实适生条件、树龄、道路与劳动力，再替换算例参数。'},
 ]},
];
export function economicScenario(id='baseline') {
 const scenario=ECONOMIC_SCENARIOS.find(item=>item.id===id);
 invariant(scenario,'INVALID_ECONOMIC_SCENARIO','经济情景不存在',400);
 return scenario;
}
const money=value=>Math.round(value*100)/100;
export function calculateMachineryCase(input={}) {
 const assumptions={recoverableTrees:1000,manualCoveredTrees:400,robotCoveredTrees:800,tappingsPerYear:60,dryKgPerTreeTapping:0.05,priceCnyPerKg:14.5,processingCnyPerKg:3,manualCnyPerTreeTapping:0.3,robotCnyPerTreeTapping:0.1,robotAnnualMaintenanceCny:6000,robotInvestmentCny:60000,...input};
 const row=(coveredTrees,costPerTapping,maintenance)=>{
  const trees=Math.min(assumptions.recoverableTrees,coveredTrees),tappings=trees*assumptions.tappingsPerYear;
  const productionKg=tappings*assumptions.dryKgPerTreeTapping,revenueCny=productionKg*assumptions.priceCnyPerKg;
  const operatingCostCny=tappings*costPerTapping+productionKg*assumptions.processingCnyPerKg+maintenance;
  return {coveredTrees:trees,productionKg:money(productionKg),revenueCny:money(revenueCny),operatingCostCny:money(operatingCostCny),annualNetContributionCny:money(revenueCny-operatingCostCny)};
 };
 const manual=row(assumptions.manualCoveredTrees,assumptions.manualCnyPerTreeTapping,0);
 const robot=row(assumptions.robotCoveredTrees,assumptions.robotCnyPerTreeTapping,assumptions.robotAnnualMaintenanceCny);
 const incrementalProductionKg=money(robot.productionKg-manual.productionKg);
 const incrementalAnnualContributionCny=money(robot.annualNetContributionCny-manual.annualNetContributionCny);
 return {mode:'simulation',title:'恢复弃割产能：人工与机器人算例',assumptions,manual,robot,incrementalProductionKg,incrementalAnnualContributionCny,
  paybackYears:incrementalAnnualContributionCny>0?money(assumptions.robotInvestmentCny/incrementalAnnualContributionCny):null,
  basis:'两方案比较同一片 1000 棵适合恢复作业的示例胶林；人工和机器人覆盖不同树数，按年产量、作业费、加工费与机器维护费计算增量贡献；未计土地、税费与融资成本，不包含在本周园区产量中。',
  nextStep:'选定可恢复地块，填入实测单产、人工成本和设备报价后，再决定是否投入。'};
}
export function economicImpact(scenario,base,effective) {
 const metricLabels={demandIndex:'需求指数',productionKg:'本周预计产量',transportKgPerDay:'每日运力',salesCapacityKgPerDay:'每日可消化量',priceCnyPerKg:'模拟报价',costPerTapping:'单次割胶成本'};
 const units={demandIndex:'点',productionKg:'kg 干胶',transportKgPerDay:'kg/日',salesCapacityKgPerDay:'kg/日',priceCnyPerKg:'元/kg 干胶',costPerTapping:'元/棵·次'};
 return {scenarioId:scenario.id,label:scenario.label,mode:'simulation',summary:scenario.summary,drivers:scenario.drivers,base,effective,
  changes:Object.keys(metricLabels).filter(key=>base[key]!==undefined&&effective[key]!==undefined).map(key=>({key,label:metricLabels[key],unit:units[key],before:money(base[key]),after:money(effective[key]),delta:money(effective[key]-base[key])})),
  machinery:calculateMachineryCase({priceCnyPerKg:effective.priceCnyPerKg??14.5}),
  basis:'情景参数均为可解释的模拟假设，用于比较经营选择；不是老师材料给出的预测系数，也不是真实价格预测。'};
}
