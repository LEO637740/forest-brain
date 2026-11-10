const exchange = {
  name: '浙江国际大宗商品交易中心有限公司', shortName: '浙江大宗', website: 'https://www.zme.com.cn/',
};
const rubber = {name:'橡胶',category:'合成材料',categoryCode:'2613',listing:'原有品种',specificGrades:'材料未细分天然胶、合成胶、胶乳及具体牌号'};
const documents = [
  {id:'zhejiang-approval-20260920',title:'浙江省地方金融管理局关于浙江国际大宗商品交易中心有限公司调整并新增备案交易品种事项的批复',
    publishedAt:'2026-09-20',pages:3,url:'/materials/zhejiang-commodity-approval-20260920.pdf',
    summary:'浙金管许〔2026〕106号。第2页将合成材料（2613）列入调整后交易品种；第3页明确现货市场定位、面向产业客户。',
    groupNote:'群聊补充（李蔡，2026-10-20）：听说筹备了 2.5 年，经国家证监会审批同意、授权浙江管理。该说法未见于批复原文，待核实。'},
  {id:'zhejiang-rubber-classification',title:'附件6.交易品种分类表',pages:1,url:'/materials/zhejiang-commodity-classification.pdf',
    summary:'第1页“合成材料（2613）”的原有品种为精对苯二甲酸、聚碳酸酯、橡胶、乙二醇；该行拟新增品种为空。表中未细分橡胶胶种或牌号。'},
  {id:'rubber-economic-study-20261021',title:'橡胶经济模式探索的实践思考要点（2026.10.21）',publishedAt:'2026-10-21',pages:2,url:'/materials/rubber-economic-study-20261021.pdf',
    summary:'短期关注灾害、政策、需求和市场情绪，长期关注种植、劳动力、产能迁移和技术创新。材料用于设计经营情景；周期、份额和价差保留为研究观点，不直接当作实测报价或预测常量。'},
];
const importedEvidence = {
  id:'zhejiang-rubber-news-2154',title:'浙江大宗首笔橡胶现货标准仓单质押融资落地',publishedAt:'2026-10-12',
  url:'https://ftz.zj.gov.cn/ceb-portal/news/queryNewsById?id=2154',
  articleUrl:'https://mp.weixin.qq.com/s/4VQ6EKVk1cKtVtZbq60l6A',
  summary:'浙江自贸报道：10月10日，宁波铜岸以60吨越南3L混合橡胶办理浙江大宗现货标准仓单质押融资。这是已发生的业务案例，未提供橡胶报价或本园区产品准入结论。',
  basis:'2026-10-21核实并导入的官方资讯',
};

// Historical product example from announcement No.125 of 2026. Its ordering
// minimum, brand and delivery terms apply to that product, not park admission.
export const ZHEJIANG_RUBBER_LISTINGS = [{
  id:'zme-2026-125',announcement:'浙江大宗 2026 年第 125 号公告',publishedAt:'2026-06-08',saleDate:'2026-06-09',
  title:'关于物产中大资本管理(浙江)有限公司预售2026年6月交收第三批橡胶产品的公告',
  seller:'物产中大资本管理(浙江)有限公司',channel:'产能预售系统',productName:'中大橡胶2026年6月交收第三批',productCode:'WZX26063',brand:'诗董',
  pricing:{unit:'元/吨',method:'基差报价',referenceContract:'RU2609',startBasisCnyPerTonne:-150,tickCnyPerTonne:10},
  quantityTonnes:404,minOrderTonnes:202,deposit:{issueCnyPerTonne:50,transferPct:20},
  quality:[
    {key:'impurity',label:'杂质',limit:'≤ 0.16%'},{key:'ash',label:'灰分',limit:'≤ 0.8%'},{key:'volatile',label:'挥发物',limit:'≤ 0.8%'},
    {key:'nitrogen',label:'氮含量',limit:'≤ 0.6%'},{key:'p0',label:'塑性初值 P0',limit:'≥ 30'},{key:'pri',label:'塑性保持率 PRI',limit:'≥ 40'}],
  delivery:{method:'自提',warehouses:['青岛中外运','中远','象屿','诚通','青岛港'],lastTradeDate:'2026-06-16',from:'2026-06-17',to:'2026-06-24',
    note:'每日发货 202 吨；202 吨订单实际重量 201.6 吨，按实际重量结算。'},
  transcriptionNote:'原表质量标准写作“氨≤0.6；至性初值≥30”，按天然生胶检验指标理解为氮含量、塑性初值，待与交易中心核对。',
  sourceUrl:'https://finance.sina.com.cn/wm/2026-06-08/doc-iniaswmq7112088.shtml',imageUrl:'/materials/zhejiang-rubber-presale-2026-125.png',
  basis:'2026-10-21 核实：新浪财经转载的交易中心公告及其附表图片',
}];

function referenceQuote(sources, listing) {
  const futures = sources.find(source => source.id === 'market' && source.data?.contracts?.length);
  const report = sources.find(source => source.id === 'monthly_report' && source.data);
  const main = futures?.data.contracts.slice().sort((a, b) => (b.openInterestLots ?? 0) - (a.openInterestLots ?? 0))[0];
  if (!main) return {status:'listing_only',listingId:listing.id,
    message:`${listing.publishedAt} 历史商品案例采用基差报价（起拍基差 ${listing.pricing.startBasisCnyPerTonne} 元/吨）；当前缺少上期所行情，无法演示计算。本园区销售仍用模拟报价。`};
  const settle = main.settlementCnyPerTonne ?? main.closeCnyPerTonne;
  const referenceCnyPerTonne = settle + listing.pricing.startBasisCnyPerTonne;
  const spot = report?.data?.metrics?.find(metric => /海南.*月均价/.test(metric.name));
  return {status:'reference',listingId:listing.id,method:listing.pricing.method,contract:main.contract,tradeDate:futures.data.tradeDate,
    futuresCnyPerTonne:settle,basisCnyPerTonne:listing.pricing.startBasisCnyPerTonne,referenceCnyPerTonne,
    hainanSpot:spot ? {cnyPerTonne:spot.value,period:spot.period,gapCnyPerTonne:referenceCnyPerTonne - spot.value} : null,
    message:`历史案例的报价方式演示：上期所 ${main.contract} 结算 ${settle.toLocaleString('en-US')} 元/吨，加 ${listing.publishedAt} 公告起拍基差 ${listing.pricing.startBasisCnyPerTonne} 元/吨，计算值约 ${referenceCnyPerTonne.toLocaleString('en-US')} 元/吨${spot ? `，与海南 ${spot.period} 产区折干月均价相差 ${(referenceCnyPerTonne - spot.value).toLocaleString('en-US')} 元/吨（商品、地区和时点口径不同）` : ''}。这是沿用历史基差的计算示例，不是当前可成交报价；原公告参考合约为 ${listing.pricing.referenceContract}。本园区销售仍用模拟报价。`};
}

function tradability({listing, inventory, network}) {
  if (!inventory) return {listingId:listing.id,ready:null,checks:[],
    conclusion:'当前仅提供公开橡胶品种、历史公告及行情参考。',
    nextStep:'园区可供数量、挂牌准备和经营测算请由有权限的园区管理人员核对。'};
  const checks = [
    {key:'quantity',label:'可供数量与订货条件',ok:null,
      detail:`本园可用 ${inventory.availableKg} 公斤${network ? `；${network.parks} 个模拟园区合计 ${network.availableKg} 公斤` : ''}。以实际可供数量询价，当前订货条件待对方确认。`},
    {key:'quality',label:'胶种与质检项目',ok:null,detail:'整理本园胶种、牌号及已有干胶含量检测结果，向交易中心核对本产品所需的质检项目。'},
    {key:'brand',label:'品牌与加工厂资料',ok:null,detail:'提供本园加工厂和产品资料，核对适用品种与品牌要求。历史公告的品牌只对应当时商品。'},
    {key:'delivery',label:'交收地点与运输',ok:null,detail:'核对本次交易可用交收地点、运费和时间，再比较销售渠道。历史公告的青岛交收库只对应当时商品。'},
    {key:'member',label:'参与方式',ok:null,detail:'向交易中心确认本园自行参与或通过会员单位对接的条件。'},
  ];
  return {listingId:listing.id,ready:null,checks,
    conclusion:'可按本园实际可供数量准备询价；当前产品准入、订货和交收条件仍需向交易中心核对。',
    nextStep:inventory.availableKg>0
      ? '整理可供数量、胶种牌号和已有质检资料，向交易中心核对当前交易条件并取得报价，再比较销售渠道。'
      : '先完成加工入库，再按可用干胶数量准备胶种、质检和交货资料。'};
}

export function networkInventory(simulation, parkSites) {
  const parks = Object.values(parkSites).filter(park => park.regionId);
  const availableKg = parks.reduce((sum, park) => sum + Math.max(0, simulation.salesInventory(park.siteId).availableKg), 0);
  return {parks:parks.length, availableKg:Math.round(availableKg * 1000) / 1000};
}

export function rubberMarketContext({publicDataService=null,inventory=null,parkName,now=new Date(),network=null}) {
  const sources = publicDataService?.status().sources ?? [];
  const news = sources.find(source=>source.id==='zhejiang_rubber');
  const publicEvidence = news?.data ? [{id:news.snapshotId,title:news.data.title,publishedAt:news.data.publishedAt,
    url:news.sourceUrl,articleUrl:news.data.articleUrl,summary:news.data.summary,retrievedAt:news.retrievedAt,
    basis:'官方资讯缓存',status:news.status}] : [{...importedEvidence}];
  const marketReferences = sources.filter(source=>['market','monthly_report','warehouse'].includes(source.id))
    .map(source=>({id:source.id,title:source.title,provider:source.provider,sourceUrl:source.sourceUrl??source.url,
      publishedAt:source.data?.publishedAt??source.data?.tradeDate??source.data?.reportDate,
      retrievedAt:source.retrievedAt,stale:source.stale,status:source.status,data:source.data??null,note:source.note}));
  const listing = ZHEJIANG_RUBBER_LISTINGS[0];
  return {asOf:now.toISOString(),exchange:{...exchange},rubber:{...rubber},documents:documents.map(row=>({...row})),publicEvidence,
    listings:ZHEJIANG_RUBBER_LISTINGS.map(row=>structuredClone(row)),quote:referenceQuote(sources,listing),
    tradability:tradability({listing,inventory,network}),marketReferences,
    connection:inventory?{product:'园区天然干胶（模拟产品，牌号待对接）',stockKg:inventory.stockKg,availableKg:inventory.availableKg,
      processedKg:inventory.processedKg,priceBasis:'园区模拟干胶报价，非交易中心报价',
      summary:`${parkName}当前可用 ${inventory.availableKg} 公斤干胶，可据此准备询价资料。`,
      nextStep:inventory.availableKg>0
        ? '按实际可供数量准备胶种牌号和已有质检资料，向交易中心核对当前交易条件并取得报价。'
        : '先完成加工入库，再按可用干胶数量准备品级、质检与交货资料。'}
      : {publicOnly:true,summary:'公开橡胶品种与行情参考；园区库存和经营数据不在当前身份可查范围内。',
        nextStep:'可继续查询公开行情；园区经营事项请联系园区管理。'}};
}

export function rubberDocumentRecord(now=new Date()) {
  return {observationId:'zhejiang-rubber-documents-20260920',topic:'commodity_reference',title:'浙江大宗橡胶品种与交易对接资料',
    scope:'浙江国际大宗商品交易中心备案品种资料',period:'2026-09-20批复及随附分类表',
    retrievedAt:now.toISOString(),expiresAt:new Date(+now+86400000).toISOString(),sourceUrl:documents[0].url,
    content:JSON.stringify({exchange,rubber,documents,listings:ZHEJIANG_RUBBER_LISTINGS,application:'按本园实际可供数量准备品级、质检、交货及询价资料。2026 年 6 月历史商品案例中的最小订货 202 吨、六项化验、品牌和交收库只适用于该案例，不是园区挂牌的通用门槛；本园当前产品准入和交易条件需单独核对。'}),
    provenance:{sourceId:'zhejiang-rubber-documents-20260920',sourceClass:'research_partner',mode:'measured'},quality:'valid'};
}
