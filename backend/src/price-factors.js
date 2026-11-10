import {normalizeSiteId,parkSite,TREE_IDS} from './adapters/park-demo.js';
import {marketDemandBand,priceTrend} from './market-policy.js';
import {thresholdsFor} from './weather-policy.js';
import {weatherOutlook} from './park-plan.js';
import {calculateMachineryCase} from './economic-scenario.js';
import {EUDR_RULES} from './eudr-readiness.js';
import {ZHEJIANG_RUBBER_LISTINGS} from './commodity-reference.js';
import {taskEvidence} from '../../frontend/src/workspace/taskLifecycleModel.ts';

// "价格因素体检": the short- and long-term price factors from the 2026-10-21
// research notes, each tied to the data the brain actually reads, a written
// rule, and the system action it triggers.  Live public data (SHFE futures and
// warrants, monthly spot report, weather, pest bulletins) is used where cached;
// simulated park series and assumptions are labelled; missing feeds are named
// instead of guessed.  The monitor only recommends — plans still need people.
export const PRICE_FACTOR_POLICY_VERSION = 'price-factor-monitor-v1';
const DAY = 86400000, FIRST_TAPPING_AGE = 7, TAPPING_YEARS = 33, RENEWAL_AGE = FIRST_TAPPING_AGE + TAPPING_YEARS - 5;
const pct = value => Math.round(value * 1000) / 10;
const signed = value => `${value >= 0 ? '+' : ''}${pct(value)}%`;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const thousands = value => Math.round(value).toLocaleString('en-US');
const LEVELS = {alert:'预警', watch:'关注', normal:'正常', unknown:'缺数据'};
const ORDER = {alert:0, watch:1, normal:2, unknown:3};
const SUITABILITY = {
  tropical:{label:'适生：高温高湿热带产区', level:'normal'},
  tropical_highland:{label:'适生：热带高海拔，需防寒害与白粉病', level:'normal'},
  subtropical:{label:'次适生：北缘产区，需防寒防风', level:'watch'},
  temperate_trial:{label:'不适合生产：温带，只作试验与展示', level:'alert'},
};

const ref = (label, mode, at = null, url = null) => ({label, mode, at, url});
const publicSource = (sources, id) => sources.find(item => item.id === id && item.data) ?? null;
const metric = (report, pattern) => report?.data?.metrics?.find(item => pattern.test(item.name)) ?? null;

function hazardFactor({outlook, events, trees, sources}) {
  const tappable = outlook.filter(day => day.tappable).length, maxRain = Math.max(0, ...outlook.map(day => day.rainMm));
  const rain = events.filter(event => event.kind === 'rain'), parkRain = rain.some(event => event.zone === null);
  const watched = trees.filter(tree => ['watch', 'confirmed_issue'].includes(tree.healthStatus)).length, share = trees.length ? watched / trees.length : 0;
  const level = parkRain || tappable <= 2 ? 'alert' : tappable <= 4 || rain.length || share >= 0.15 ? 'watch' : 'normal';
  const pest = publicSource(sources, 'pest_updates') ?? publicSource(sources, 'bulletin');
  return {key:'natural_hazard', horizon:'short', label:'自然灾害与运输', teacher:'洪水、台风、天气、降雨量、病虫害、运输',
    reading:`未来7天可割 ${tappable} 天，最大日雨量 ${maxRain} mm；${rain.length ? `未解除雨情 ${rain.length} 处${parkRain ? '（含全园）' : ''}` : '无未解除雨情'}；健康关注 ${watched} 棵（${pct(share)}%）`,
    rule:'全园雨情未解除或7天可割≤2天为预警；可割≤4天、分区雨情或健康关注≥15%为关注',
    priceEffect:'产区受灾使行业供给减少，现货偏涨；本园同时减产、出货延迟',
    action:level === 'alert' ? '按“台风影响生产运输”情景重算经营方案和全园割胶；受影响分区暂停，不因涨价突破可割条件。'
      : level === 'watch' ? '按可割天数排割次，加密巡查；发车前核对道路与雨情。' : '按全园割胶策略正常安排。',
    scenarioId:level === 'alert' ? 'typhoon' : null, decisions:['park_plan', 'sales_plan'], owner:'农场管理；机器人运营执行暂停与恢复',
    sources:[ref('园区7日天气（第1天园区预报，第2–7天按气候模拟）', 'simulated'), ref('雨情与设备事件', 'system'), ref('树木健康巡查档案', 'simulated'),
      ...(pest ? [ref(pest.data.title, 'measured', pest.data.publishedAt, pest.sourceUrl)] : [])],
    missing:['气象台台风路径与大风预警', '道路通行状态'], level};
}

function policyFactor({now, sources}) {
  const next = EUDR_RULES.dates.map(item => ({...item, days:Math.ceil((Date.parse(`${item.date}T00:00:00+08:00`) - +now) / DAY)}))
    .filter(item => item.days >= 0).sort((a, b) => a.days - b.days)[0] ?? null;
  const level = next && next.days <= 60 ? 'alert' : next && next.days <= 180 ? 'watch' : 'normal';
  const zhejiang = publicSource(sources, 'zhejiang_rubber');
  return {key:'policy', horizon:'short', label:'政策因素', teacher:'政策因素',
    reading:`${next ? `EUDR 对${next.role}自 ${next.date} 起适用（剩 ${next.days} 天）` : 'EUDR 各类经营者均已适用'}；${zhejiang ? `浙江大宗橡胶现货仓单业务已落地（${String(zhejiang.data.publishedAt).slice(0, 10)}）` : '浙江大宗资讯未缓存'}；收储/抛储、关税、产区出口政策暂无自动数据源，由各园区登记、中心批准后计入`,
    rule:'EUDR 适用日≤60天为预警、≤180天为关注；中心登记的抛储、放宽进口事件为预警并按“政策释放市场供给”测算，收储、限出口为关注',
    priceEffect:'收储、产区限出口偏涨；抛储、放开进口偏跌；无来源资料的胶在欧盟渠道折价或不能出货',
    action:'欧盟订单只从已整理来源资料的加工批次出货（经营方案 → 欧盟客户资料 → 指定来源批次）；收储、抛储、关税等公告在本页登记，中心批准后生效。',
    scenarioId:null, decisions:['eudr', 'sales_plan'], owner:'杭州数据与云脑中心登记政策；农场管理整理批次资料',
    sources:[ref('EUDR 综合文本与欧委会实施说明', 'measured', EUDR_RULES.checkedAt, EUDR_RULES.sources[0].url),
      ...(zhejiang ? [ref(zhejiang.data.title, 'measured', zhejiang.data.publishedAt, zhejiang.data.sourceUrl ?? zhejiang.sourceUrl)] : [])],
    missing:['国家储备收储/投放公告的自动数据源（目前人工登记）', '进口关税与配额', '泰国、印尼、马来西亚出口政策'], level};
}

function demandFactor({market, sources}) {
  const demand = marketDemandBand(market), warehouse = publicSource(sources, 'warehouse'), report = publicSource(sources, 'monthly_report');
  const imports = metric(report, /进口/), change = warehouse ? warehouse.data.changeTonnes / Math.max(1, warehouse.data.quantityTonnes - warehouse.data.changeTonnes) : null;
  const level = demand.band === 'unknown' ? 'unknown' : demand.band === 'low' ? 'alert' : change !== null && change >= 0.01 ? 'watch' : 'normal';
  return {key:'demand', horizon:'short', label:'需求面变化', teacher:'汽车产量下降、新产品诞生（乳胶枕头）、机器人减震（关节等）',
    reading:`园区需求指数 ${demand.value ?? '缺'}/${demand.baselineValue ?? '缺'}（${{high:'偏强', low:'偏弱', balanced:'平衡', unknown:'缺项'}[demand.band]}，模拟）${warehouse ? `；上期所仓单 ${thousands(warehouse.data.quantityTonnes)} 吨，日变化 ${warehouse.data.changeTonnes >= 0 ? '+' : ''}${thousands(warehouse.data.changeTonnes)} 吨` : ''}${imports ? `；${imports.period} 进口 ${imports.value} ${imports.unit}` : ''}`,
    rule:'需求指数≤基准90%为预警；交易所仓单单日增加≥1%为关注',
    priceEffect:'汽车与轮胎减产偏跌；乳胶制品、机器人关节减震等新用途是增量需求',
    action:level === 'alert' ? '按“下游需求转弱”情景重算，优先落实已确认订单，减少新增割次。' : '按经营方案节奏销售；新用途订单单独登记品级要求。',
    scenarioId:level === 'alert' ? 'demand_weak' : null, decisions:['sales_plan', 'park_plan'], owner:'农场管理（销售）',
    sources:[ref('园区需求指数', market.demand?.provenance?.mode ?? 'simulated'),
      ...(warehouse ? [ref('上期所天然橡胶注册仓单', 'measured', warehouse.data.reportDate, warehouse.sourceUrl)] : []),
      ...(report ? [ref(report.data.title, 'measured', report.data.publishedAt, report.sourceUrl)] : [])],
    missing:['汽车与轮胎月产量', '真实客户订单', '合成胶与原油价格（替代品：合成胶约比天然胶低 1000 元/吨，随油价涨跌）'], level};
}

function hotMoneyFactor({market, sources}) {
  const futures = publicSource(sources, 'market'), report = publicSource(sources, 'monthly_report');
  const main = futures?.data?.contracts?.slice().sort((a, b) => b.openInterestLots - a.openInterestLots)[0] ?? null;
  const parkTrend = priceTrend(market.prices);
  if (!main) return {key:'hot_money', horizon:'short', label:'热钱与期货放大', teacher:'热钱作用、期货放大值',
    reading:`未取得上期所行情${parkTrend === null ? '' : `；园区模拟报价近14日 ${signed(parkTrend)}`}`, rule:'需要期货日行情才能判断', priceEffect:'资金推动期货放大涨跌，不改变园区实物供需',
    action:'期货行情恢复前不据价格异动调整割次。', scenarioId:null, decisions:['sales_plan'], owner:'农场管理（销售）',
    sources:[ref('园区模拟报价', 'simulated')], missing:['上期所天然橡胶日行情'], level:'unknown'};
  const settle = main.settlementCnyPerTonne ?? main.closeCnyPerTonne;
  const daily = main.previousSettlementCnyPerTonne ? (settle - main.previousSettlementCnyPerTonne) / main.previousSettlementCnyPerTonne : 0;
  const turnover = main.openInterestLots ? main.volumeLots / main.openInterestLots : 0;
  const spot = metric(report, /海南.*月均价/) ?? metric(report, /月均价/);
  const basis = spot ? (settle - spot.value) / spot.value : null;
  const listing = ZHEJIANG_RUBBER_LISTINGS[0];
  const level = Math.abs(daily) >= 0.03 || turnover >= 4 || (basis !== null && Math.abs(basis) >= 0.2) ? 'alert'
    : Math.abs(daily) >= 0.015 || turnover >= 2.5 || (basis !== null && Math.abs(basis) >= 0.1) ? 'watch' : 'normal';
  return {key:'hot_money', horizon:'short', label:'热钱与期货放大', teacher:'热钱作用、期货放大值',
    reading:`上期所主力 ${main.contract} 结算 ${thousands(settle)} 元/吨（日 ${signed(daily)}），成交/持仓 ${round(turnover, 2)}${basis === null ? '' : `；较${spot.scope}${spot.period}现货均价 ${thousands(spot.value)} 元/吨 ${basis >= 0 ? '高' : '低'} ${pct(Math.abs(basis))}%`}；浙江大宗按期货加基差报价，最近公告起拍基差 ${listing.pricing.startBasisCnyPerTonne} 元/吨，参考约 ${thousands(settle + listing.pricing.startBasisCnyPerTonne)} 元/吨`,
    rule:'主力日涨跌≥3%、成交/持仓≥4或期现价差≥20%为预警；对应 1.5%、2.5、10% 为关注',
    priceEffect:'资金推动期货放大涨跌、拉大期现价差；不改变园区实物供需',
    action:level === 'normal' ? '期货平稳，按经营方案销售。' : '不因期货异动增加割次；现货分批销售，价差大时向浙江大宗或期现渠道核价。',
    scenarioId:null, decisions:['sales_plan'], owner:'农场管理（销售）',
    sources:[ref(`上期所 ${main.contract} 日行情`, 'measured', futures.data.tradeDate, futures.sourceUrl),
      ...(spot ? [ref(report.data.title, 'measured', report.data.publishedAt, report.sourceUrl)] : []),
      ref(`${listing.announcement}（${listing.productCode}）`, 'measured', listing.publishedAt, listing.sourceUrl), ref('园区模拟报价', 'simulated')],
    missing:['园区实际成交价', '期货持仓结构'], level, measures:{contract:main.contract, settleCnyPerTonne:settle, dailyChange:daily, turnover, basis}};
}

function plantingFactor({trees, now, sources}) {
  const ages = trees.map(tree => (+now - Date.parse(tree.plantedAt)) / (365.25 * DAY)).filter(Number.isFinite);
  const available = trees.filter(tree => tree.tappingStatus === 'available').length, share = trees.length ? available / trees.length : 0;
  const young = ages.filter(age => age < FIRST_TAPPING_AGE).length, renewal = ages.filter(age => age >= RENEWAL_AGE).length;
  const level = share < 0.6 ? 'alert' : share < 0.75 || renewal / Math.max(1, ages.length) >= 0.2 ? 'watch' : 'normal';
  const national = metric(publicSource(sources, 'production_national'), /产量/), hainan = metric(publicSource(sources, 'production_hainan'), /产量/);
  return {key:'planting', horizon:'long', label:'种植情况', teacher:'种植情况',
    reading:`可割 ${available}/${trees.length} 棵（${pct(share)}%）；树龄 ${ages.length ? `${Math.floor(Math.min(...ages))}–${Math.floor(Math.max(...ages))} 年` : '缺'}，未到开割年龄 ${young} 棵，${RENEWAL_AGE} 年以上待更新 ${renewal} 棵${national ? `；全国 ${national.period} 产量 ${national.value} ${national.unit}` : ''}${hainan ? `，海南 ${hainan.value} ${hainan.unit}` : ''}`,
    rule:`可割比例<60%为预警，<75%或${RENEWAL_AGE}年以上树≥20%为关注（开割约${FIRST_TAPPING_AGE}年、割胶期约${TAPPING_YEARS}年）`,
    priceEffect:'种植和开割树龄决定 7–8 年后的供给；割胶期长、调节慢，形成约 20 年的价格周期（老师观点）',
    action:'临近更新树龄的林段列入更新计划；休割、未开割树不进入本周割次。',
    scenarioId:null, decisions:['park_plan'], owner:'农场管理',
    sources:[ref('树木档案（定植日期、割胶状态）', 'simulated'), ...[publicSource(sources, 'production_national'), publicSource(sources, 'production_hainan')].filter(Boolean)
      .map(item => ref(item.data.title, 'measured', item.data.publishedAt, item.sourceUrl))],
    missing:['实测树龄与品系', '区域新植与更新面积'], level};
}

function laborFactor({machinery}) {
  const {manualCnyPerTreeTapping:manual, robotCnyPerTreeTapping:robot} = machinery.assumptions;
  return {key:'labor', horizon:'long', label:'劳动力因素', teacher:'劳动力因素；马来西亚人工贵，约 50 万公顷（750 万亩）弃割',
    reading:`人工 ${manual} 元/棵·次，机器人 ${robot} 元/棵·次（演示假设）；示例林段机器人每年多留 ${thousands(machinery.incrementalAnnualContributionCny)} 元`,
    rule:'人工单价高于机器人 2 倍以上时，优先评估机器人释放弃割产能',
    priceEffect:'人工上涨抬高成本、导致弃割，供给收缩偏涨',
    action:'在 1 片可恢复地块试点，记录真实工时、单产和维护费，替换算例假设。',
    scenarioId:'robot_recovery', decisions:['machinery'], owner:'杭州中心与农场管理',
    sources:[ref('人工与机器人作业费（演示假设）', 'assumption'), ref('老师材料 2026-10-21', 'research')],
    missing:['当地割胶工日工资与工效', '机器人设备报价'], level:manual >= robot * 2 ? 'watch' : 'normal'};
}

function regionFactor({park, observed}) {
  const suit = SUITABILITY[park.climate];
  return {key:'region', horizon:'long', label:'产能与区域转移', teacher:'产能转移、区域转移；首先考虑适应性（高温高湿）',
    reading:`${park.name}：${suit.label}${observed ? `；当前 ${observed.airTemperatureC}℃、湿度 ${observed.relativeHumidityPct}%（${observed.mode === 'forecast' ? '公开天气' : '模拟'}）` : ''}`,
    rule:'按园区气候带判定：热带适生、北缘产区关注、温带不适合生产',
    priceEffect:'人工成本推动种植从马来西亚转向低收入国家、最终转向非洲；机器人普及后产能可能回流',
    action:park.regionId ? '扩种或新园选址先核对温度、湿度、海拔与寒害；高人工成本产区优先评估机器人。' : '本站只作试验展示，不安排生产割胶与销售。',
    scenarioId:null, decisions:['machinery'], owner:'杭州中心',
    sources:[ref('园区气候带与地理位置', 'catalog'), ...(observed ? [ref('园区当前温湿度', observed.mode === 'forecast' ? 'forecast' : 'simulated', observed.at)] : [])],
    missing:['多年气象与寒害记录', '各国人工与土地成本'], level:suit.level};
}

function technologyFactor({tasks, now, machinery, treeCount}) {
  const completed = new Set();
  for (const task of tasks.filter(task => task.kind === '割胶')) {
    const evidence = taskEvidence(task);
    for (const receipt of [...evidence.receipts, ...evidence.demoReceipts]) {
      const finishedAt = Date.parse(receipt.finishedAt);
      if (receipt.outcome === 'completed' && finishedAt >= +now - 30 * DAY && finishedAt <= +now)
        completed.add(receipt.index ?? receipt.treeIndex);
    }
  }
  const covered = completed.size, share = treeCount ? covered / treeCount : 0;
  return {key:'technology', horizon:'long', label:'技术创新', teacher:'技术创新；割胶机器人可能让产能回归马来西亚',
    reading:`近30天机器人割胶覆盖 ${covered}/${treeCount} 棵（${pct(share)}%）；示例林段${machinery.paybackYears === null ? '按当前假设不回本' : `约 ${machinery.paybackYears} 年回本`}`,
    rule:'覆盖按近30天有效完成回执逐树去重；回本期≤6年的林段列为扩大机器人覆盖的优先对象；不回本时维持试点',
    priceEffect:'机器人降低单次成本，低价期仍能保持正贡献，使弃割产能恢复、长期偏抑价',
    action:machinery.paybackYears !== null && machinery.paybackYears <= 6 ? '回本期合格：在弃割或低效林段扩大机器人覆盖，并按实测更新回本期。' : '维持试点，先用实测数据确认回本期。',
    scenarioId:'robot_recovery', decisions:['machinery', 'park_plan'], owner:'杭州中心；机器人运营',
    sources:[ref('机器人割胶任务与回执', 'system'), ref('人工与机器人回本算例', 'assumption')],
    missing:['设备实测故障率与寿命'], level:machinery.paybackYears === null ? 'watch' : 'normal'};
}

const LEVEL_RANK = {unknown:0, normal:1, watch:2, alert:3};
/** Center-approved events override a factor upward and name the scenario they imply. */
function withEvents(factor, events) {
  const own = events.filter(event => event.factor === factor.key);
  if (!own.length) return factor;
  const top = own.find(event => event.scenarioId) ?? own[0];
  const level = own.some(event => event.scenarioId) ? 'alert' : 'watch';
  return {...factor, level:LEVEL_RANK[level] > LEVEL_RANK[factor.level] ? level : factor.level,
    scenarioId:top.scenarioId ?? factor.scenarioId,
    reading:`${factor.reading}；中心已登记：${own.map(event => `${event.title}（${event.kindLabel}，${event.effectiveFrom}～${event.effectiveTo}）`).join('；')}`,
    action:top.scenarioId ? `已登记“${top.title}”：按对应情景重算经营方案和全园割胶，${factor.action}` : factor.action,
    sources:[...factor.sources, ...own.map(event => ref(`中心登记：${event.title}${event.source ? `（${event.source}）` : ''}`, 'registered', event.decidedAt))],
    events:own.map(event => ({id:event.id, title:event.title, kindLabel:event.kindLabel, direction:event.direction, effectiveFrom:event.effectiveFrom, effectiveTo:event.effectiveTo}))};
}

function interactions(byKey) {
  const active = key => ['alert', 'watch'].includes(byKey[key].level);
  return [
    {key:'hazard_care', title:'灾害涨价 × 树体养护', active:active('natural_hazard'),
      text:'短期灾害可能推高胶价，但不突破可割条件多割——保护树体就是保护今后 30 多年的产能。'},
    {key:'futures_cycle', title:'期货放大 × 长期周期', active:active('hot_money'),
      text:'期货放大的是短期波动；全园割次只看实物需求、库存与天气，期货只作销售定价参考。'},
    {key:'robot_cycle', title:'机器人 × 价格周期', active:true,
      text:'机器人降低单次成本后，低价周期仍有正贡献、可以少减产；也让人工贵的弃割胶园重新可割，长期增加供给。'},
    {key:'policy_trace', title:'政策 × 来源追溯', active:active('policy'),
      text:'EUDR 让“能证明来源”变成价格的一部分：可追溯批次进入欧盟渠道，来源不明的期初库存只走国内渠道。'},
  ];
}

export function assessPriceFactors({siteId, now, context, events = [], sources = [], tasks = [], marketEvents = []}) {
  siteId = normalizeSiteId(siteId);
  const park = parkSite(siteId), market = context.modules.market, trees = context.modules.trees;
  const outlook = weatherOutlook({siteId, now, context, events, thresholds:thresholdsFor(siteId)});
  const lastPrice = market.prices.at(-1)?.value;
  const machinery = calculateMachineryCase(Number.isFinite(lastPrice) ? {priceCnyPerKg:lastPrice} : {});
  const weather = publicSource(sources, 'weather'), live = weather?.data?.location?.siteId === siteId ? weather.data.currentEstimate : null;
  const observed = live ? {airTemperatureC:live.airTemperatureC, relativeHumidityPct:live.relativeHumidityPct, at:live.at, mode:'forecast'}
    : context.modules.weather?.observed ? {...context.modules.weather.observed, at:context.modules.weather.observed.observedAt, mode:'simulated'} : null;
  const factors = [
    hazardFactor({outlook, events:events.filter(event => event.status !== 'closed'), trees, sources}),
    policyFactor({now, sources}), demandFactor({market, sources}), hotMoneyFactor({market, sources}),
    plantingFactor({trees, now, sources}), laborFactor({machinery}), regionFactor({park, observed}),
    technologyFactor({tasks, now, machinery, treeCount:trees.length}),
  ].map(factor => withEvents(factor, marketEvents)).map(factor => ({...factor, levelLabel:LEVELS[factor.level]}));
  const byKey = Object.fromEntries(factors.map(factor => [factor.key, factor]));
  const short = factors.filter(factor => factor.horizon === 'short');
  const recommended = short.filter(factor => factor.scenarioId).sort((a, b) => ORDER[a.level] - ORDER[b.level])[0] ?? null;
  const count = level => factors.filter(factor => factor.level === level).length;
  const top = factors.filter(factor => factor.level === 'alert' || factor.level === 'watch').sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return {siteId, park:park.name, generatedAt:now.toISOString(), policyVersion:PRICE_FACTOR_POLICY_VERSION, mode:'mixed',
    headline:`价格因素体检：${count('alert')} 项预警、${count('watch')} 项关注${top.length ? `，先看${top.slice(0, 2).map(item => item.label).join('、')}` : '，各项平稳'}。`,
    counts:{alert:count('alert'), watch:count('watch'), normal:count('normal'), unknown:count('unknown')},
    recommendedScenarioId:recommended?.scenarioId ?? 'baseline',
    recommendation:recommended ? `${recommended.label}${recommended.levelLabel}：建议按对应情景重算经营方案与全园割胶。` : '短期因素未触发情景：按当前经营条件测算。',
    factors, interactions:interactions(byKey),
    study:{document:'/materials/rubber-economic-study-20261021.pdf', views:['全球胶价联动，区域套利难','约 20 年一个周期：2003–2013 上行，2014–2024 下行，2025 年为转折（老师观点）','天然胶约占 45%、合成胶 55%；重载与飞机轮胎离不开天然胶']},
    basis:'公开数据按缓存时间引用；园区价格、需求、树木和天气第2–7天为模拟；阈值是透明演示先验，需用真实成交与产量回测后调整。'};
}

export class PriceFactorService {
  constructor({simulation, makeParkContext, publicDataService = null, marketEvents = null, clock = () => new Date()}) {
    Object.assign(this, {simulation, makeParkContext, publicDataService, marketEvents, clock});
  }
  read(siteId) {
    siteId = normalizeSiteId(siteId);
    const now = this.clock();
    return assessPriceFactors({siteId, now, context:this.makeParkContext({siteId, treeIds:TREE_IDS, now}),
      events:this.simulation.operationalEvents.list(siteId), sources:this.publicDataService?.status().sources ?? [], tasks:this.simulation.latestTasks(siteId),
      marketEvents:this.marketEvents?.active(siteId) ?? []});
  }
}
