import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {seedDemoTasks} from '../src/adapters/demo-tasks.js';
import {AssistantMemory} from '../src/assistant-memory.js';
import {AssistantTools} from '../src/assistant-tools.js';

function setup(publicDataService=null,clock=()=>new Date('2026-10-20T02:00:00Z')) {
  const store = new Store();
  const simulation = new SimulationService(store,clock,{contextFactory:makeParkContext});
  seedDemoTasks(simulation,clock());
  const memory = new AssistantMemory(store,clock),tools = new AssistantTools({simulation,makeParkContext,memory,publicDataService,clock});
  const session = {siteId:'demo-guangdong-maoming',role:'manager'};
  const turn = {turnId:'turn-test',message:'分析 B 区',zone:'B',treeId:null,marketParams:{}};
  return {store,simulation,memory,tools,session,turn,call:(name,args={})=>tools.execute(name,args,{session,turn})};
}

test('rubber trading reference combines source facts with current park dry stock without creating a sale',()=>{
  const publicDataService = {status:()=>({sources:[{id:'market',title:'天然橡胶期货日行情',provider:'上海期货交易所',
    status:'available',stale:false,sourceUrl:'https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/',
    retrievedAt:'2026-10-20T01:00:00Z',data:{tradeDate:'2026-10-19',priceType:'futures',priceUnit:'CNY/tonne',
      contracts:[{contract:'RU2701',settlementCnyPerTonne:19000}]},note:'期货不是园区现货成交价'}]})};
  const app = setup(publicDataService);
  try {
    const before = JSON.stringify(app.simulation.latestTasks());
    const first = app.call('read_rubber_market');
    assert.equal(first.data.rubber.name,'橡胶');
    assert.equal(first.data.rubber.category,'合成材料');
    assert.equal(first.data.rubber.categoryCode,'2613');
    assert.equal(first.data.rubber.listing,'原有品种');
    assert.equal(first.data.quote.status,'reference');
    assert.equal(first.data.quote.referenceCnyPerTonne,18850);
    assert.match(first.data.quote.message,/历史基差的计算示例，不是当前可成交报价/);
    assert.equal(first.data.listings[0].minOrderTonnes,202);
    assert.equal(first.data.tradability.ready,null);
    assert.equal(first.data.connection.availableKg,400);
    assert.equal(first.data.connection.stockKg,800);
    assert.deepEqual(first.actions,[{type:'commodity_market',label:'查看橡胶交易对接'}]);
    assert.ok(first.data.documents.length>=2);
    const futures = first.data.marketReferences.find(item=>item.id==='market');
    assert.equal(futures.data.priceType,'futures');
    assert.equal(futures.data.priceUnit,'CNY/tonne');
    assert.equal(futures.data.contracts[0].settlementCnyPerTonne,19000);
    assert.equal(JSON.stringify(app.simulation.latestTasks()),before);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model,null);
    const model = app.simulation.market({siteId:app.session.siteId,transportKgPerDay:20});
    const plan = app.simulation.adoptMarketSales({siteId:app.session.siteId,modelId:model.id,scenarioId:'hold_short'});
    app.simulation.salesShipments.advance(plan.shipments[0].id,{siteId:app.session.siteId});
    const next = app.call('read_rubber_market');
    assert.equal(next.data.connection.availableKg,380);
    assert.equal(next.data.connection.stockKg,780);
    assert.equal(app.simulation.salesInventory(app.session.siteId).soldKg,0);
  } finally {app.store.close();}
});

test('trade references accompany a sale comparison without replacing simulated dry-rubber prices',()=>{
  let futuresPrice = 19000;
  const app = setup({status:()=>({sources:[{id:'market',title:'天然橡胶期货日行情',provider:'上海期货交易所',
    status:'available',stale:false,data:{priceType:'futures',priceUnit:'CNY/tonne',tradeDate:'2026-10-19',
      contracts:[{contract:'RU2701',settlementCnyPerTonne:futuresPrice}]}}]})});
  try {
    app.turn.message = '比较销售方案';
    const first = app.call('compare_market');
    const prices = app.simulation.latestMarket(app.session.siteId).model.prices;
    futuresPrice = 90000;
    const next = app.call('compare_market');
    assert.equal(next.data.commodityReference.marketReferences[0].data.contracts[0].settlementCnyPerTonne,90000);
    assert.deepEqual(next.data.alternatives,first.data.alternatives);
    assert.deepEqual(app.simulation.latestMarket(app.session.siteId).model.prices,prices);
    assert.equal(next.data.commodityReference.connection.availableKg,400);
    assert.equal(app.simulation.salesInventory(app.session.siteId).stockKg,800);
  } finally {app.store.close();}
});

test('recommended first shipment preserves the saved daily quantity and Beijing date across UTC midnight',()=>{
  const app = setup(null,()=>new Date('2026-10-20T17:30:00Z'));
  try {
    const result = app.call('compare_market',{transportKgPerDay:20});
    const model = app.simulation.latestMarket(app.session.siteId).model;
    const chosen = model.sales.scenarios.find(item=>item.id===model.sales.recommendedScenarioId);
    const first = chosen.daily.find(row=>row.soldKg>0);
    assert.equal(chosen.id,'hold_short');
    assert.deepEqual(result.data.firstShipment,{at:'2026-10-24T01:30:00.000+08:00',kg:20});
    assert.equal(Date.parse(result.data.firstShipment.at),Date.parse(first.at));
    assert.equal(result.data.firstShipment.kg,first.soldKg);
  } finally {app.store.close();}
});

test('tools bind all park reads to the session while retaining B-zone scope',()=>{
  const app = setup();
  try {
    const facts = app.call('read_park',{siteId:'demo-xsbn'});
    assert.equal(facts.data.siteId,app.session.siteId);
    assert.equal(facts.data.totalTrees,50);
    const tasks = app.call('read_tasks',{siteId:'demo-hainan'});
    assert.equal(tasks.data.tasks.length,1);
    assert.match(tasks.data.tasks[0].taskId,/guangdong-maoming-B$/);
    assert.equal(tasks.data.done,12);
    assert.equal(tasks.data.tasks[0].completedReceipts,12);
    assert.equal(tasks.data.tasks[0].remainingCount,24);
    assert.ok(tasks.data.tasks[0].remainingTreeIds.every(id=>Number(id.slice(2))>=63&&Number(id.slice(2))<=86));
    assert.equal(app.simulation.latestTasks().length,40);
  } finally {app.store.close();}
});

test('whole-park market calculation keeps explicit stock assumptions without creating tasks or changing the ledger',()=>{
  const app = setup();
  try {
    app.turn.marketParams = {transportKgPerDay:20,stockKg:720};
    app.turn.message = '假设库存650公斤，比较销售方案';
    const first = app.call('compare_market',{siteId:'demo-hainan'});
    assert.equal(first.data.siteId,app.session.siteId);
    assert.equal(first.data.params.transportKgPerDay,20);
    assert.equal(first.data.params.stockKg,650);
    assert.match(first.data.scopeLabel,/全园经营测算/);
    assert.equal(first.data.params.treeCount,200);
    assert.equal(first.data.horizonDays,7);
    assert.deepEqual(first.data.initialInventory,{stockKg:650,availableKg:250,heldKg:400,unit:'kg 干胶'});
    assert.match(first.data.inventoryBasis,/假设测算/);
    assert.equal(first.data.currentInventory.stockKg,800);
    const immediate = first.data.alternatives.find(scenario=>scenario.id==='sell_now');
    assert.equal(immediate.soldKg,140);
    assert.equal(immediate.endingAvailableKg,immediate.endingStockKg-400);
    assert.ok(immediate.endingAvailableKg>0,'the seven-day sale leaves available inventory');
    const savedScenarios = app.simulation.latestMarket(app.session.siteId).model.sales.scenarios;
    for (const alternative of first.data.alternatives) {
      const saved = savedScenarios.find(scenario=>scenario.id===alternative.id);
      for (const key of ['revenueCny','productionCostCny','transportCostCny','holdingCostCny',
        'cashContributionCny','endingInventoryValueCny','comparisonValueCny']) {
        assert.equal(typeof alternative[key],'number',`${alternative.id}.${key} is provided to the model`);
        assert.equal(alternative[key],saved[key],`${alternative.id}.${key} matches the saved page scenario`);
      }
    }
    app.turn.message = '运力改成30公斤，继续比较';
    app.turn.inventoryAssumptions = first.data.inventoryAssumptions;
    const next = app.call('compare_market',{transportKgPerDay:30,stockKg:650});
    assert.equal(next.data.params.transportKgPerDay,30);
    assert.equal(next.data.params.stockKg,650);
    assert.match(next.data.inventoryBasis,/假设测算/);
    app.turn.message = '假设冻结库存450公斤，重新比较';
    const heldOnly = app.call('compare_market');
    assert.equal(heldOnly.data.params.stockKg,650);
    assert.equal(heldOnly.data.params.heldKg,450);
    assert.equal(app.simulation.salesInventory(app.session.siteId).heldKg,400);
    assert.equal(app.simulation.latestTasks().length,40);
    assert.equal(app.simulation.latestMarket(app.session.siteId).plan,null);
  } finally {app.store.close();}
});

test('model quantity parameters are honored for tonne and natural-language inventory assumptions',()=>{
  const app = setup();
  try {
    for (const message of ['假设库存1吨，冻结库存0公斤，比较销售方案','假设当前库存1吨，冻结库存0公斤，比较销售方案','假设有一吨可售干胶，库存都能出售，比较销售方案']) {
      app.turn.message = message;
      const compared = app.call('compare_market',{stockKg:1000,heldKg:0,transportKgPerDay:20,storageKg:1200});
      assert.equal(compared.data.params.stockKg,1000);
      assert.equal(compared.data.params.heldKg,0);
      assert.deepEqual(compared.data.inventoryAssumptions,{stockKg:1000,heldKg:0});
      assert.match(compared.data.inventoryBasis,/假设测算/);
    }
    assert.equal(app.simulation.salesInventory(app.session.siteId).stockKg,800);
    app.turn.message = '退出假设，重新比较';
    const actual = app.call('compare_market',{stockKg:1000,heldKg:0});
    assert.equal(actual.data.params.stockKg,800);
    assert.equal(actual.data.params.heldKg,400);
    assert.deepEqual(actual.data.inventoryAssumptions,{});
  } finally {app.store.close();}
});

test('sales inventory tool follows dispatch and receipt, and market comparison cannot reuse stale stock',()=>{
  const app = setup();
  try {
    const model = app.simulation.market({siteId:app.session.siteId,storageKg:1200,transportKgPerDay:20});
    const plan = app.simulation.adoptMarketSales({siteId:app.session.siteId,modelId:model.id,scenarioId:'hold_short'});
    app.turn.message = '库存、在途、已售和待出货各有多少？';
    const before = app.call('read_sales_inventory');
    assert.equal(before.data.inventory.stockKg,800);
    assert.equal(before.data.pendingKg,80);
    assert.equal(before.data.pendingCount,4);
    assert.deepEqual(before.actions,[{type:'sales_shipments',label:'查看销售出货'}]);
    app.simulation.salesShipments.advance(plan.shipments[0].id,{siteId:app.session.siteId});
    const transit = app.call('read_sales_inventory').data;
    assert.equal(transit.inventory.stockKg,780);
    assert.equal(transit.inventory.availableKg,380);
    assert.equal(transit.inventory.inTransitKg,20);
    assert.equal(transit.inventory.soldKg,0);
    assert.equal(transit.pendingKg,60);
    assert.equal(transit.pendingCount,3);
    app.simulation.salesShipments.advance(plan.shipments[0].id,{siteId:app.session.siteId});
    const received = app.call('read_sales_inventory').data;
    assert.equal(received.inventory.stockKg,780);
    assert.equal(received.inventory.inTransitKg,0);
    assert.equal(received.inventory.soldKg,20);
    app.turn.marketParams = {stockKg:800,heldKg:500,transportKgPerDay:20};
    app.turn.inventoryAssumptions = {stockKg:1000,heldKg:0};
    app.turn.message = '按最新情况重新比较销售方案';
    const compared = app.call('compare_market',{stockKg:800,heldKg:500});
    assert.equal(compared.data.params.stockKg,780);
    assert.equal(compared.data.params.heldKg,400);
    assert.deepEqual(compared.data.inventoryAssumptions,{});
    app.turn.message = '使用账本重算';
    const reset = app.call('compare_market',{useCurrentInventory:true,stockKg:1000,heldKg:0});
    assert.equal(reset.data.params.stockKg,780);
    assert.equal(reset.data.params.heldKg,400);
    assert.equal(compared.data.currentInventory.soldKg,20);
    assert.ok(received.shipments.every(task=>task.modelId===model.id));
    assert.equal(app.simulation.salesInventory('demo-xsbn').soldKg,0);
  } finally {app.store.close();}
});

test('processing facts count dry rubber only after processing and retain task, receipt, and inspection evidence',()=>{
  const app = setup();
  try {
    const {siteId} = app.session,workflow = app.simulation.logistics;
    const task = app.simulation.latestTasks(siteId).find(item=>item.block==='D');
    let batch = workflow.create({requestId:'assistant-collect',siteId,taskId:task.id,
      operator:'模拟收胶员',collectionPointId:'guangdong-maoming-collection-1',containerCount:2,note:'收胶'});
    let sequence = 0;
    const act = (action,extra={}) => batch = workflow.transition(batch.id,action,{requestId:`assistant-action-${++sequence}`,
      siteId,revision:batch.revision,operator:'模拟经办人',note:action,...extra});
    app.turn.message = '查看加工入库与待加工数量';
    act('weigh',{grossKg:102,tareKg:2});
    act('inspect',{sampleId:'assistant-sample',dryRubberPercent:30,decision:'pass'});
    app.simulation.market({siteId,storageKg:1200,transportKgPerDay:20});
    let facts = app.call('read_sales_inventory').data;
    assert.equal(facts.inventory.stockKg,800);
    assert.equal(facts.production.processedKg,0);
    assert.equal(facts.production.pendingProcessingKg,0);
    act('plan',{destinationId:'guangdong-maoming-processing-3',vehicleCode:'SIM-001',driver:'模拟驾驶员',
      plannedDepartureAt:'2026-10-20T03:00:00Z'});
    act('dispatch');
    act('receive',{receivedKg:99});
    const received = app.call('read_sales_inventory');
    facts = received.data;
    assert.equal(facts.inventory.stockKg,800);
    assert.equal(facts.production.processedKg,0);
    assert.equal(facts.production.pendingProcessingKg,99);
    assert.equal(facts.production.pendingProcessingBatches,1);
    assert.equal(facts.production.pendingBatches[0].taskId,task.id);
    assert.equal(facts.production.pendingBatches[0].processing,null);
    assert.deepEqual(received.actions,[{type:'logistics',batchId:batch.id,label:'查看加工入库'}]);
    act('process');
    app.turn.message = '刚才加工入库多少？';
    const result = app.call('read_sales_inventory');
    facts = result.data;
    assert.equal(facts.inventory.stockKg,829.7);
    assert.equal(facts.inventory.processedKg,29.7);
    assert.equal(facts.production.processedKg,29.7);
    assert.equal(facts.production.processedBatches,1);
    assert.equal(facts.production.pendingProcessingKg,0);
    assert.equal(facts.production.latestProcessed.processing.latexKg,99);
    assert.equal(facts.production.latestProcessed.processing.dryRubberPercent,30);
    for (const id of [task.id,batch.id,batch.processing.id,batch.processing.inspectionId,batch.transport.receipt.id])
      assert.ok(result.sourceRefs.includes(id),`${id} retained as source evidence`);
    const history = app.call('read_execution_history',{zone:'D'}).data;
    assert.equal(history.production.processedKg,29.7);
    assert.equal(history.batches[0].unit,'kg 鲜胶乳');
    assert.equal(history.batches[0].processing.dryUnit,'kg 干胶');
    assert.equal(app.call('read_execution_history',{zone:'B'}).data.production.processedKg,0);
    assert.equal(app.simulation.salesInventory('demo-hainan').processedKg,0);
    app.turn.message = '用最新库存比较销售方案';
    assert.equal(app.call('compare_market').data.params.stockKg,829.7);
  } finally {app.store.close();}
});

test('weather tool expresses every observation and forecast time in Beijing time without changing the underlying instant',()=>{
  const app = setup();
  try {
    const context = makeParkContext({siteId:app.session.siteId,now:new Date('2026-10-20T08:00:00Z')});
    const original = structuredClone(context.modules.weather);
    app.tools.makeParkContext = ()=>context;
    const weather = app.call('read_weather').data;
    assert.equal(weather.timeLabel,'北京时间（UTC+8）');
    assert.equal(weather.observed.observedAt,'2026-10-20T15:55:00.000+08:00');
    assert.equal(weather.observed.receivedAt,'2026-10-20T15:55:10.000+08:00');
    assert.equal(weather.forecast.issuedAt,'2026-10-20T15:30:00.000+08:00');
    assert.equal(weather.forecast.steps[0].validFrom,'2026-10-20T16:00:00.000+08:00');
    assert.equal(weather.forecast.steps.at(-1).validTo,'2026-10-20T20:00:00.000+08:00');
    const timestamps = [
      [weather.observed.observedAt,original.observed.observedAt],
      [weather.observed.receivedAt,original.observed.receivedAt],
      [weather.forecast.issuedAt,original.forecast.issuedAt],
      ...weather.observed.recentRainfall.map((item,index)=>[item.observedAt,original.observed.recentRainfall[index].observedAt]),
      ...weather.forecast.steps.flatMap((step,index)=>[
        [step.validFrom,original.forecast.steps[index].validFrom],[step.validTo,original.forecast.steps[index].validTo],
      ]),
    ];
    for (const [converted,source] of timestamps) {
      assert.match(converted,/\+08:00$/);
      assert.equal(Date.parse(converted),Date.parse(source));
    }
    assert.deepEqual(context.modules.weather,original);
  } finally {app.store.close();}
});

test('task and execution queries expose the existing collection conditions for ongoing and completed work',()=>{
  const app = setup();
  try {
    const active = app.call('read_tasks').data.tasks[0];
    assert.equal(active.zone,'B');
    assert.equal(active.collection.canCollect,false);
    assert.match(active.collection.reason,/需先结束割胶任务/);
    const completedResult = app.call('read_execution_history',{zone:'D'});
    const completed = completedResult.data.tasks[0];
    assert.equal(completed.status,'已完成');
    assert.equal(completed.collection.canCollect,true);
    assert.equal(completed.collection.reason,null);
    assert.deepEqual(completedResult.actions.find(action=>action.type==='task'),{
      type:'task',taskId:completed.taskId,label:'查看 10月20日 D区作业',
    });
    assert.equal(app.call('read_tasks').actions[0].label,'查看 10月20日 B区作业');
  } finally {app.store.close();}
});

test('execution tools count actual receipts without inventing kilograms and preserve cancelled work',()=>{
  const app = setup();
  try {
    const before = app.call('read_execution_history');
    assert.equal(before.data.completedReceipts,12);
    assert.deepEqual(before.data.batches,[]);
    const current = app.simulation.latestTasks(app.session.siteId).find(task=>task.block==='B');
    const cancelled = {...current,status:'已取消',dispatch:{...current.dispatch,phase:'cancelled'}};
    const saved = app.simulation.tasks({tasks:[cancelled]});
    assert.equal(saved.conflicts.length,0);
    const history = app.call('read_execution_history');
    assert.equal(history.data.completedReceipts,12);
    assert.equal(history.data.tasks[0].remainingCount,24);
    const memories = app.memory.list(app.session);
    assert.ok(memories.some(item=>item.scope==='park'&&item.content.includes('已取消')&&item.content.includes('12/36')));
  } finally {app.store.close();}
});

test('memory writing uses the explicit user text rather than model-supplied facts',()=>{
  const app = setup();
  try {
    app.turn.message = '记住：以后优先查看B区';
    const saved = app.call('remember_preference',{content:'园区已经执行完成'});
    assert.equal(saved.data.item.content,'以后优先查看B区');
    assert.ok(!saved.data.item.content.includes('执行完成'));
  } finally {app.store.close();}
});
