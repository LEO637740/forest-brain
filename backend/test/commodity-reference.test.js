import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rubberMarketContext,networkInventory,rubberDocumentRecord} from '../src/commodity-reference.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const now = new Date('2026-10-21T04:00:00Z');
const inventory = {stockKg:774,availableKg:374,processedKg:34};

test('teacher documents preserve the original rubber category and have usable packaged PDFs',()=>{
  const result=rubberMarketContext({inventory,parkName:'海南模拟园区',now});
  assert.equal(result.rubber.listing,'原有品种');
  assert.equal(result.rubber.categoryCode,'2613');
  assert.match(result.rubber.specificGrades,/未细分/);
  assert.equal(result.documents[0].publishedAt,'2026-09-20');
  assert.equal(result.quote.status,'listing_only');
  assert.match(result.quote.message,/缺少上期所行情/);
  assert.equal(result.connection.availableKg,374);
  const listing=result.listings[0];
  assert.equal(listing.productCode,'WZX26063');
  assert.equal(listing.pricing.startBasisCnyPerTonne,-150);
  assert.deepEqual(listing.quality.map(item=>item.key),['impurity','ash','volatile','nitrogen','p0','pri']);
  assert.equal(readFileSync(new URL(`../../frontend/public${listing.imageUrl}`,import.meta.url)).subarray(1,4).toString(),'PNG');
  assert.match(result.documents[0].groupNote,/待核实/);
  assert.equal(result.tradability.ready,null);
  assert.equal(result.tradability.checks.find(check=>check.key==='quantity').ok,null);
  assert.match(result.tradability.checks.find(check=>check.key==='quantity').detail,/本园可用 374 公斤/);
  assert.match(result.publicEvidence[0].summary,/60吨越南3L混合橡胶/);
  for(const document of result.documents){
    const path=new URL(`../../frontend/public${document.url}`,import.meta.url);
    assert.equal(readFileSync(path).subarray(0,4).toString(),'%PDF');
  }
});

test('public news and historical price references retain source dates and units',()=>{
  const publicDataService={status:()=>({sources:[
    {id:'zhejiang_rubber',snapshotId:'zhejiang-fixture',sourceUrl:'https://ftz.zj.gov.cn/ceb-portal/news/queryNewsById?id=2154',
      retrievedAt:now.toISOString(),status:'available',data:{title:'浙江橡胶业务资讯',publishedAt:'2026-10-12T00:00:00+08:00',summary:'仓单融资案例',articleUrl:'https://example.com/article'}},
    {id:'market',title:'期货',status:'stale',stale:true,provider:'上期所',sourceUrl:'https://example.com/futures',
      data:{tradeDate:'2026-09-30',priceUnit:'CNY/tonne',contracts:[{contract:'RU2701',settlementCnyPerTonne:19000}]},note:'期货参考'}]})};
  const result=rubberMarketContext({publicDataService,inventory,parkName:'海南模拟园区',now});
  assert.equal(result.publicEvidence[0].id,'zhejiang-fixture');
  assert.equal(result.publicEvidence[0].publishedAt,'2026-10-12T00:00:00+08:00');
  assert.equal(result.marketReferences[0].data.priceUnit,'CNY/tonne');
  assert.equal(result.marketReferences[0].publishedAt,'2026-09-30');
  assert.equal(result.marketReferences[0].stale,true);
  assert.equal(result.quote.status,'reference');
  assert.equal(result.quote.contract,'RU2701');
  assert.equal(result.quote.referenceCnyPerTonne,18850);
  assert.equal(result.quote.hainanSpot,null);
  assert.match(result.quote.message,/历史基差的计算示例，不是当前可成交报价/);
  assert.match(result.connection.priceBasis,/模拟/);
});

test('commodity HTTP combines the selected park inventory and configured public cache',async t=>{
  const publicDataService={status:()=>({sources:[{id:'market',title:'期货缓存',data:{tradeDate:'2026-10-20',priceUnit:'CNY/tonne'},status:'available',stale:false}]})};
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),publicDataService,clock:()=>now});
  t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const siteId of ['demo-hainan','demo-xsbn']){
    const response=await fetch(`${base}/api/commodity/rubber?siteId=${siteId}`);
    assert.equal(response.status,200);
    const result=await response.json();
    const {inventory:current}=await (await fetch(`${base}/api/simulation/sales-inventory?siteId=${siteId}`)).json();
    assert.equal(result.connection.availableKg,current.availableKg);
    assert.equal(result.marketReferences[0].title,'期货缓存');
    assert.match(result.documents[0].summary,/106/);
  }
  assert.equal(app.assistant.toolkit.publicDataService,publicDataService);
});

test('reference quote follows the announced basis method and compares with the regional spot report, and the network total counts production parks',()=>{
  const publicDataService={status:()=>({sources:[
    {id:'market',status:'available',data:{tradeDate:'2026-10-21',contracts:[{contract:'RU2611',settlementCnyPerTonne:18990,openInterestLots:2281},{contract:'RU2701',settlementCnyPerTonne:19635,openInterestLots:144726}]}},
    {id:'monthly_report',status:'available',data:{title:'2026年9月天然橡胶市场动态',metrics:[{name:'海南鲜胶乳折干胶月均价',value:17143,period:'2026-09'}]}}]})};
  const result=rubberMarketContext({publicDataService,inventory,parkName:'海南模拟园区',now,network:{parks:9,availableKg:3366}});
  assert.equal(result.quote.contract,'RU2701');
  assert.equal(result.quote.referenceCnyPerTonne,19485);
  assert.equal(result.quote.hainanSpot.gapCnyPerTonne,2342);
  assert.match(result.quote.message,/口径不同/);
  assert.match(result.tradability.checks[0].detail,/9 个模拟园区合计 3366 公斤/);
  const parks={a:{siteId:'a',regionId:'hainan'},b:{siteId:'b',regionId:'yunnan'},trial:{siteId:'trial',regionId:null}};
  const simulation={salesInventory:siteId=>({a:{availableKg:300},b:{availableKg:-20},trial:{availableKg:999}})[siteId]};
  assert.deepEqual(networkInventory(simulation,parks),{parks:2,availableKg:300});
});

test('a historical product ordering minimum does not qualify or disqualify the park for listing',()=>{
  for(const availableKg of [374,202000,250000]) {
    const result=rubberMarketContext({inventory:{...inventory,stockKg:availableKg,availableKg},parkName:'海南模拟园区',now});
    assert.equal(result.listings[0].minOrderTonnes,202,'preserve the source announcement');
    assert.equal(result.tradability.ready,null,'current admission is unverified regardless of stock');
    assert.equal(result.tradability.checks.find(check=>check.key==='quantity').ok,null);
    const advice=[result.tradability.conclusion,result.tradability.nextStep,result.connection.nextStep,...result.tradability.checks.map(check=>check.detail)].join('\n');
    assert.match(advice,/实际可供数量/);
    assert.match(advice,/当前.*条件.*核对/);
    assert.doesNotMatch(advice,/202 吨|202吨|还差 \d+ 项|最小订货量的|须进入.*青岛/);
  }
  const material=JSON.parse(rubberDocumentRecord(now).content);
  assert.match(material.application,/只适用于该案例，不是园区挂牌的通用门槛/);
  const empty=rubberMarketContext({inventory:{...inventory,stockKg:0,availableKg:0},parkName:'海南模拟园区',now});
  assert.match(empty.tradability.nextStep,/先完成加工入库/);
});
