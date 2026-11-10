import {CARE_LIMIT_PER_WEEK} from '../src/market-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {seedDemoTasks} from '../src/adapters/demo-tasks.js';
import {BusinessAssistantService} from '../src/assistant-service.js';

function setup(model=null,publicDataService=null) {
  const clock = ()=>new Date('2026-10-20T02:00:00Z'),store = new Store();
  const simulation = new SimulationService(store,clock,{contextFactory:makeParkContext});
  seedDemoTasks(simulation,clock());
  const options = {store,simulation,makeParkContext,clock,model,publicDataService},service = new BusinessAssistantService(options);
  const session = service.createSession({siteId:'demo-guangdong-maoming',role:'manager'});
  return {store,simulation,service,session,options,
    async send(message,extra={}) {const turn=service.submitTurn(session.sessionId,{message,mode:'demo',...extra});await service.queue;return service.getTurn(session.sessionId,turn.turnId);},
    async close(){await service.stop();store.close();}};
}

test('trading questions answer document facts and current sellable stock without starting a sales calculation',async()=>{
  const app = setup();
  try {
    const classification = await app.send('浙江交易中心新增了橡胶品种吗？比较天然胶和合成胶的分类。');
    assert.equal(classification.status,'completed',classification.error);
    assert.match(classification.answer.split('\n\n')[0],/原有品种.*合成材料.*未细分胶种和牌号/);
    assert.ok(classification.tools.some(tool=>tool.name==='read_rubber_market'));
    assert.ok(!classification.tools.some(tool=>tool.name==='compare_market'||tool.name==='read_tasks'));
    const quote = await app.send('浙江交易中心橡胶报价是多少？');
    assert.match(quote.answer.split('\n\n')[0],/基差报价.*起拍基差 -150 元\/吨.*缺少上期所行情.*模拟报价.*400 公斤/);
    assert.ok(!quote.tools.some(tool=>tool.name==='compare_market'));
    const connect = await app.send('我们怎么跟大宗交易中心对接？');
    assert.match(connect.answer.split('\n\n')[0],/实际可供数量.*当前产品准入、订货和交收条件.*核对/);
    assert.doesNotMatch(connect.answer.split('\n\n')[0],/202 吨|还差 \d+ 项|最小订货量的/);
    assert.match(connect.answer,/WZX26063.*最小订货 202 吨/);
    assert.match(connect.answer,/202 吨/);
    assert.ok(connect.actions.some(action=>action.type==='commodity_market'));
    assert.equal(app.simulation.latestMarket(app.session.siteId).model,null);
    assert.equal(app.simulation.latestTasks().length,40);
  } finally {await app.close();}
});

test('configured trading dialogue receives material facts upfront and rereads current stock on a relative follow-up',async()=>{
  const seen = [];
  const app = setup({async complete(input) {
    seen.push(structuredClone(input));
    if (seen.length===2) return {toolCalls:[{id:'trade-followup',name:'read_rubber_market',arguments:{}}]};
    const current = [...input.messages].reverse().find(message=>message.role==='tool'&&JSON.parse(message.content).rubber);
    const data = JSON.parse(current.content);
    return {content:`结论：橡胶为${data.rubber.listing}，本园可准备 ${data.connection.availableKg} 公斤干胶。\n下一步：查看橡胶交易对接，核对牌号和交收条件。`,toolCalls:[]};
  }},{status:()=>({sources:[]})});
  try {
    const first = await app.send('浙江交易中心橡胶品种能跟本园对接吗？',{mode:'configured'});
    assert.equal(first.status,'completed',first.error);
    assert.match(first.answer,/原有品种.*400 公斤干胶/);
    assert.ok(seen[0].tools.some(tool=>tool.function.name==='read_rubber_market'));
    assert.match(seen[0].messages[0].content,/材料未细分天然胶、合成胶或具体牌号/);
    assert.ok(first.tools.some(tool=>tool.name==='read_rubber_market'));
    const model = app.simulation.market({siteId:app.session.siteId,transportKgPerDay:20});
    const plan = app.simulation.adoptMarketSales({siteId:app.session.siteId,modelId:model.id,scenarioId:'hold_short'});
    app.simulation.salesShipments.advance(plan.shipments[0].id,{siteId:app.session.siteId});
    const next = await app.send('那现在还有多少可以准备？',{mode:'configured'});
    assert.equal(next.status,'completed',next.error);
    assert.match(next.answer,/380 公斤干胶/);
    assert.ok(next.tools.some(tool=>tool.name==='read_rubber_market'));
    assert.equal(seen.length,3);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.id,model.id);
  } finally {await app.close();}
});

test('explicit sales calculation alongside trading materials still uses the existing inventory and simulated prices',async()=>{
  const app = setup();
  try {
    const expected = app.simulation.market({siteId:app.session.siteId,transportKgPerDay:20});
    const turn = await app.send('结合浙江交易中心资料，每天运力20公斤，生成销售方案');
    assert.equal(turn.status,'completed',turn.error);
    assert.ok(turn.tools.some(tool=>tool.name==='read_rubber_market'));
    assert.ok(turn.tools.some(tool=>tool.name==='compare_market'));
    assert.match(turn.answer.split('\n\n')[0],/7 天预计卖出 80 公斤干胶/);
    assert.match(turn.answer,/原有品种|模拟干胶报价/);
    assert.deepEqual(app.simulation.latestMarket(app.session.siteId).model.sales,expected.sales);
    assert.equal(app.simulation.salesInventory(app.session.siteId).stockKg,800);
  } finally {await app.close();}
});

test('offline business turns use real tools, inherit B zone, and leave task execution unchanged',async()=>{
  const app = setup();
  try {
    const before = JSON.stringify(app.simulation.latestTasks());
    const first = await app.send('今天B区怎么安排？');
    assert.equal(first.status,'completed',first.error);
    assert.match(first.answer,/规则演示/);
    assert.match(first.answer,/B区/);
    assert.match(first.answer,/12\/36/);
    const lead = first.answer.split('\n\n')[0];
    assert.match(lead,/^结论：.*B区.*12\/36.*\n下一步：/);
    assert.doesNotMatch(lead,/demo-task|canCollect|sourceRefs/);
    assert.ok(first.tools.some(tool=>tool.name==='read_tasks'));
    assert.ok(first.actions.some(action=>action.type==='task'&&action.taskId.endsWith('guangdong-maoming-B')));
    const followup = await app.send('那剩下的呢？');
    assert.equal(followup.zone,'B');
    assert.match(followup.answer,/24 棵未完成/);
    assert.equal(JSON.stringify(app.simulation.latestTasks()),before);
  } finally {await app.close();}
});

test('remembered transport preference reaches subsequent calculation and survives new sessions',async()=>{
  const app = setup();
  try {
    const saved = await app.send('记住，本园每天运力20公斤');
    assert.equal(saved.status,'completed',saved.error);
    assert.ok(saved.tools.some(tool=>tool.name==='remember_preference'));
    const calculation = await app.send('按记住的运力重新比较销售方案');
    assert.equal(calculation.status,'completed',calculation.error);
    assert.match(calculation.answer,/全园经营测算/);
    const [advice,...details] = calculation.answer.split('\n\n');
    assert.match(advice,/暂存 3 天，第 4 天起.*7 天预计卖出 80 公斤干胶/);
    assert.match(advice,/回款会晚一些.*\n下一步：.*查看经营方案/);
    assert.doesNotMatch(advice,/比较值|现金贡献|库存估值/);
    assert.match(details.join('\n\n'),/现金贡献|期末可售库存/);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.transportKgPerDay,20);
    assert.equal(app.service.listMemories(app.session).find(item=>item.scope==='role').content,'本园每天运力20公斤');
    const next = await app.send('库存改为650，继续比较');
    assert.equal(next.status,'completed',next.error);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.transportKgPerDay,20);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.stockKg,650);
    const secondSession = app.service.createSession({siteId:app.session.siteId,role:'manager'});
    const turn = app.service.submitTurn(secondSession.sessionId,{message:'按记住的运力比较市场销售方案',mode:'demo'});
    await app.service.queue;
    assert.equal(app.service.getTurn(secondSession.sessionId,turn.turnId).status,'completed');
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.transportKgPerDay,20);
    assert.equal(app.simulation.latestTasks().length,40);
  } finally {await app.close();}
});

test('explicit text changes scope ahead of stale view inputs and whole-park text clears the tree',async()=>{
  const app = setup();
  try {
    const changed = await app.send('改看C区今天的任务',{zone:'B',treeId:'T-0001'});
    assert.equal(changed.zone,'C');
    assert.equal(changed.treeId,null);
    assert.match(changed.answer,/8\/28/);
    const whole = await app.send('查看全园任务',{zone:'C',treeId:'T-0101'});
    assert.equal(whole.zone,null);
    assert.equal(whole.treeId,null);
    assert.match(whole.answer,/52\/126/);
  } finally {await app.close();}
});

test('editing saved transport from 20 to 30 is used in a new session and its persisted sales model',async()=>{
  const app = setup();
  try {
    await app.send('记住每天运力20公斤');
    const memory = app.service.listMemories(app.session).find(item=>item.scope==='role');
    app.service.memory.edit(memory.id,{content:'每天运力30公斤'},null);
    const session = app.service.createSession({siteId:app.session.siteId,role:'manager'});
    const turn = app.service.submitTurn(session.sessionId,{message:'按记住的运力比较市场销售方案',mode:'demo'});
    await app.service.queue;
    const result = app.service.getTurn(session.sessionId,turn.turnId);
    assert.equal(result.status,'completed',result.error);
    assert.equal(result.marketParams.transportKgPerDay,30);
    assert.equal(app.simulation.latestMarket(session.siteId).model.params.transportKgPerDay,30);
    assert.ok(result.actions.some(action=>action.type==='market'));
  } finally {await app.close();}
});

test('model-interpreted relative market changes continue across turns while new sessions use saved preferences',async()=>{
  let calls = 0;
  const app = setup({async complete() {
    calls++;
    if (calls===1) return {toolCalls:[{id:'relative',name:'compare_market',arguments:{transportKgPerDay:30}}]};
    if (calls===3) return {toolCalls:[{id:'continue',name:'compare_market',arguments:{}}]};
    return {content:'已按本轮条件计算。',toolCalls:[]};
  }});
  try {
    await app.send('记住每天运力20公斤');
    await app.send('记住仓容1200公斤');
    const relative = await app.send('这次运力提高一半，比较销售方案',{mode:'configured'});
    assert.equal(relative.status,'completed',relative.error);
    assert.equal(relative.marketParams.transportKgPerDay,30);
    assert.equal(app.service.getSession(app.session.sessionId).marketParams.transportKgPerDay,30);
    const repeated = await app.send('保持刚才条件再算',{mode:'configured'});
    assert.equal(repeated.status,'completed',repeated.error);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.transportKgPerDay,30);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.storageKg,1200);
    const nextSession = app.service.createSession({siteId:app.session.siteId,role:'manager'});
    const next = app.service.submitTurn(nextSession.sessionId,{message:'按记住的条件比较销售方案',mode:'demo'});
    await app.service.queue;
    assert.equal(app.service.getTurn(nextSession.sessionId,next.turnId).status,'completed');
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.transportKgPerDay,20);
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.storageKg,1200);
  } finally {await app.close();}
});

test('an older plan\'s care limit is not carried forward; only a stated limit overrides the shared scale',async()=>{
  const contexts = [];
  let calls = 0;
  const app = setup({async complete({messages}) {
    contexts.push(messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content ?? '')).join('\n'));
    return ++calls===1 ? {toolCalls:[{id:'again',name:'compare_market',arguments:{}}]} : {content:'已按本轮条件计算。',toolCalls:[]};
  }});
  try {
    app.simulation.market({siteId:app.session.siteId,careLimit:2});
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.params.careLimit,2);
    const turn = await app.send('按刚才条件再比较销售方案',{mode:'configured'});
    assert.equal(turn.status,'completed',turn.error);
    const savedPlan = id=>JSON.parse(app.store.db.prepare('SELECT body FROM simulation_models WHERE id=?').get(id).body);
    assert.equal(savedPlan(turn.actions.findLast(action=>action.type==='market').modelId).params.careLimit,CARE_LIMIT_PER_WEEK);
    assert.ok(contexts.length>0&&contexts.every(text=>!/"careLimit":2/.test(text)),'the stale care limit must not reach the model');
    await app.send('记住每周最多2次');
    // A new session reads the remembered limit; the finished session keeps its own conditions.
    const nextSession = app.service.createSession({siteId:app.session.siteId,role:'manager'});
    const next = app.service.submitTurn(nextSession.sessionId,{message:'按记住的条件比较销售方案',mode:'demo'});
    await app.service.queue;
    const stated = app.service.getTurn(nextSession.sessionId,next.turnId);
    assert.equal(stated.status,'completed',stated.error);
    assert.equal(savedPlan(stated.actions.findLast(action=>action.type==='market').modelId).params.careLimit,2);
  } finally {await app.close();}
});

test('a follow-up plan states how the recommended lead changed, computed rather than inferred',async()=>{
  const app = setup();
  try {
    const session = app.service.getSession(app.session.sessionId);
    const run = transportKgPerDay=>app.service.toolkit.execute('compare_market',{transportKgPerDay,storageKg:1200,stockKg:1000,heldKg:0},
      {session,turn:{message:'比较销售方案',marketParams:{},inventoryAssumptions:{}},identity:null}).data;
    const first = run(20), second = run(30);
    const change = second.changeFromPrevious;
    assert.equal(change.previousModelId,first.modelId);
    assert.deepEqual(change.changedParams.map(item=>[item.key,item.from,item.to]),[['transportKgPerDay',20,30]]);
    const lead = data=>{const chosen=data.alternatives.find(item=>item.id===data.sales.id);
      return chosen.comparisonValueCny-Math.max(...data.alternatives.filter(item=>item.feasible&&item.id!==chosen.id).map(item=>item.comparisonValueCny));};
    assert.equal(change.previousLead.leadCny.toFixed(2),lead(first).toFixed(2));
    assert.equal(change.currentLead.leadCny.toFixed(2),lead(second).toFixed(2));
    const direction = lead(second)>lead(first)?'扩大':lead(second)<lead(first)?'收窄':'保持';
    assert.match(change.summary,new RegExp(direction));
    assert.ok(change.summary.includes(change.currentLead.leadCny.toFixed(2)));
  } finally {await app.close();}
});

test('queued follow-up inherits completed tool parameters without losing its newer scope and explicit edits',async()=>{
  let calls = 0;
  const app = setup({async complete() {
    calls++;
    if (calls===1) return {toolCalls:[
      {id:'relative',name:'compare_market',arguments:{transportKgPerDay:30}},
      {id:'same-round',name:'compare_market',arguments:{}},
    ]};
    if (calls===3) return {toolCalls:[{id:'queued-followup',name:'compare_market',arguments:{}}]};
    return {content:'已生成方案。',toolCalls:[]};
  }});
  try {
    await app.send('记住每天运力20公斤');
    const first = app.service.submitTurn(app.session.sessionId,{message:'B区这次运力提高一半，比较销售方案',mode:'configured'});
    const next = app.service.submitTurn(app.session.sessionId,{message:'改看C区，沿用刚才的运力，仓容改为1600，重新比较',mode:'configured'});
    await app.service.queue;
    const firstTurn = app.service.getTurn(app.session.sessionId,first.turnId);
    assert.equal(firstTurn.status,'completed',firstTurn.error);
    assert.equal(firstTurn.marketParams.transportKgPerDay,30);
    const nextTurn = app.service.getTurn(app.session.sessionId,next.turnId);
    assert.equal(nextTurn.status,'completed',nextTurn.error);
    assert.equal(nextTurn.marketParams.transportKgPerDay,30);
    assert.equal(nextTurn.marketParams.storageKg,1600);
    const session = app.service.getSession(app.session.sessionId);
    assert.equal(session.lastTurnId,next.turnId);
    assert.equal(session.zone,'C');
    assert.equal(session.marketParams.transportKgPerDay,30);
    assert.equal(session.marketParams.storageKg,1600);
  } finally {await app.close();}
});

test('configured mode calls actual tools and feeds their output into the next model iteration',async()=>{
  let calls = 0; const seen = [];
  const app = setup({async complete(input) {
    seen.push(structuredClone(input));calls++;
    if (calls===1) return {content:null,toolCalls:[{id:'model-task-call',name:'read_tasks',arguments:{siteId:'demo-xsbn'}}]};
    const tasks = input.messages.find(message=>message.role==='tool'&&message.tool_call_id==='model-task-call');
    const data = JSON.parse(tasks.content);
    return {content:`B区记录完成 ${data.done}/${data.total} 棵；建议查看剩余任务。`,toolCalls:[]};
  }});
  try {
    const turn = await app.send('B区的任务做了多少？',{mode:'configured'});
    assert.equal(turn.status,'completed',turn.error);
    assert.equal(calls,2);
    assert.match(turn.answer,/12\/36/);
    assert.equal(JSON.parse(seen[1].messages.find(item=>item.tool_call_id==='model-task-call').content).siteId,app.session.siteId);
    assert.ok(turn.tools.some(tool=>tool.name==='read_tasks'));
    assert.ok(seen[0].tools.some(tool=>tool.function.name==='compare_market'));
  } finally {await app.close();}
});

test('completed conversation and role preferences survive service reconstruction',async()=>{
  const app = setup();
  try {
    await app.send('记住：以后优先查看B区');
    await app.send('今天怎么安排？');
    await app.service.stop();
    const restored = new BusinessAssistantService(app.options);
    const session = restored.getSession(app.session.sessionId);
    assert.equal(session.turns.length,2);
    assert.equal(session.zone,'B');
    assert.ok(restored.listMemories(app.session).some(item=>item.scope==='role'&&item.content.includes('B区')));
    const newSession = restored.createSession({siteId:app.session.siteId,role:'manager'});
    const next = restored.submitTurn(newSession.sessionId,{message:'今天怎么安排？',mode:'demo'});
    await restored.stop();
    assert.equal(restored.getTurn(newSession.sessionId,next.turnId).zone,'B');
  } finally {app.store.close();}
});

test('configured follow-up includes prior user, tool and assistant messages',async()=>{
  let calls = 0;
  const app = setup({async complete({messages}) {
    calls++;
    if (calls===1) return {content:'先查看B区任务。',toolCalls:[]};
    assert.ok(messages.some(item=>item.role==='user'&&item.content==='B区今天怎么安排？'));
    assert.ok(messages.some(item=>item.role==='assistant'&&item.content==='先查看B区任务。'));
    assert.ok(messages.filter(item=>item.role==='tool').length>=2);
    assert.match(messages[0].content,/B区/);
    return {content:'继续围绕B区安排。',toolCalls:[]};
  }});
  try {
    await app.send('B区今天怎么安排？',{mode:'configured'});
    const second = await app.send('继续说',{mode:'configured'});
    assert.equal(second.status,'completed',second.error);
    assert.equal(calls,2);
  } finally {await app.close();}
});

test('configured loop finishes after six rounds with obtained results rather than hanging',async()=>{
  let calls = 0;
  const app = setup({async complete() {return {content:null,toolCalls:[{id:`call-${++calls}`,name:'read_tasks',arguments:{}}]};}});
  try {
    const turn = await app.send('B区情况',{mode:'configured'});
    assert.equal(turn.status,'completed',turn.error);
    assert.equal(calls,6);
    assert.match(turn.answer,/记录完成 12\/36/);
  } finally {await app.close();}
});

test('model receives six prior turns, keeping tool results only for the latest one, while all records remain readable',async()=>{
  let lastMessages;
  const app = setup({async complete({messages}) {lastMessages=messages;return {content:'已读取当前偏好。',toolCalls:[]};}});
  try {
    for (let index=0;index<8;index++) await app.send(`第${index}轮：回忆偏好`,{mode:'configured'});
    const users = lastMessages.filter(item=>item.role==='user');
    assert.equal(users.length,7);
    assert.equal(users[0].content,'第1轮：回忆偏好');
    assert.equal(users.at(-1).content,'第7轮：回忆偏好');
    const calls = lastMessages.filter(item=>item.tool_calls).flatMap(item=>item.tool_calls);
    const responses = lastMessages.filter(item=>item.role==='tool');
    // Older turns are compressed to question + answer; the latest prior turn and this turn keep their tool results.
    assert.equal(calls.length,4);
    assert.equal(responses.length,4);
    assert.deepEqual(calls.map(item=>item.id),responses.map(item=>item.tool_call_id));
    assert.equal(lastMessages.filter(item=>item.role==='assistant'&&!item.tool_calls&&item.content==='已读取当前偏好。').length,6);
    assert.equal(app.service.getSession(app.session.sessionId).turns.length,8);
  } finally {await app.close();}
});

test('continuous dialogue refreshes actual sales inventory when the user returns from hypothetical comparisons',async()=>{
  const seen = [];
  const app = setup({async complete({messages}) {
    seen.push(messages);
    const current = [...messages].reverse().find(item=>item.role==='tool'&&JSON.parse(item.content).inventory);
    const {inventory} = JSON.parse(current.content);
    return {content:`结论：在库 ${inventory.stockKg} 公斤，在途 ${inventory.inTransitKg} 公斤，已销售 ${inventory.soldKg} 公斤。\n下一步：查看销售出货。`,toolCalls:[]};
  }});
  try {
    await app.send('记住：库存800公斤，冻结库存400公斤，每天运力20公斤');
    const model = app.simulation.market({siteId:app.session.siteId,storageKg:1200,transportKgPerDay:20});
    const plan = app.simulation.adoptMarketSales({siteId:app.session.siteId,modelId:model.id,scenarioId:'hold_short'});
    const shipment = plan.shipments[0];
    app.simulation.salesShipments.advance(shipment.id,{siteId:app.session.siteId});
    const transit = await app.send('现在库存、在途和已经销售了多少？',{mode:'configured'});
    assert.equal(transit.status,'completed',transit.error);
    assert.match(transit.answer,/在库 780 公斤，在途 20 公斤，已销售 0 公斤/);
    assert.equal(transit.marketParams.stockKg,780);
    assert.match(seen[0][0].content,/旧会话、旧方案与记忆中的库存不能覆盖当前账本/);
    app.simulation.salesShipments.advance(shipment.id,{siteId:app.session.siteId});
    const received = await app.send('现在库存、在途和已经销售了多少？',{mode:'configured'});
    assert.equal(received.status,'completed',received.error);
    assert.match(received.answer,/在库 780 公斤，在途 0 公斤，已销售 20 公斤/);
    const demo = await app.send('当前库存、已售和待出货各是多少？');
    assert.equal(demo.status,'completed',demo.error);
    assert.match(demo.answer.split('\n\n')[0],/在库 780 公斤.*已签收销售 20 公斤.*待出货 3 批、60 公斤/);
    assert.ok(!demo.tools.some(tool=>tool.name==='compare_market'));
    assert.equal(app.simulation.latestMarket(app.session.siteId).model.id,model.id);
    const hypothetical = await app.send('假设库存650公斤，重新比较销售方案');
    assert.equal(hypothetical.status,'completed',hypothetical.error);
    assert.equal(hypothetical.marketParams.stockKg,650);
    assert.equal(app.simulation.salesInventory(app.session.siteId).stockKg,780);
    const continued = await app.send('其他条件不变，继续比较销售方案');
    assert.equal(continued.status,'completed',continued.error);
    assert.equal(continued.marketParams.stockKg,650);
    const next = await app.send('按最新实际库存继续比较销售方案');
    assert.equal(next.status,'completed',next.error);
    assert.equal(next.marketParams.stockKg,780);
    assert.equal(next.marketParams.heldKg,400);
    assert.equal(next.marketParams.transportKgPerDay,20);
  } finally {await app.close();}
});

test('temporary tonne stock assumptions survive a relative follow-up while new sessions and actual reviews use the ledger',async()=>{
  let calls = 0;
  const app = setup({async complete() {
    calls++;
    if (calls===1) return {toolCalls:[{id:'relative-capacity',name:'compare_market',arguments:{transportKgPerDay:30}}]};
    if (calls===3) return {toolCalls:[{id:'actual-review',name:'compare_market',arguments:{stockKg:1000,heldKg:0}}]};
    return {content:'已按本轮条件计算。',toolCalls:[]};
  }});
  try {
    await app.send('记住每天运力20公斤');
    const originalMemory = app.service.listMemories(app.session).find(item=>item.scope==='role');
    const first = await app.send('假设库存1吨、冻结库存0公斤，仓容1200公斤，每天运力20公斤，比较销售方案');
    assert.equal(first.status,'completed',first.error);
    assert.deepEqual([first.marketParams.stockKg,first.marketParams.heldKg,first.marketParams.transportKgPerDay],[1000,0,20]);
    const changed = await app.send('运力提高一半，其他条件不变，继续比较',{mode:'configured'});
    assert.equal(changed.status,'completed',changed.error);
    assert.deepEqual([changed.marketParams.stockKg,changed.marketParams.heldKg,changed.marketParams.transportKgPerDay],[1000,0,30]);
    const repeated = await app.send('保持刚才条件重新比较销售方案');
    assert.deepEqual([repeated.marketParams.stockKg,repeated.marketParams.heldKg,repeated.marketParams.transportKgPerDay],[1000,0,30]);
    const hypothetical = app.simulation.latestMarket(app.session.siteId).model;
    assert.equal(hypothetical.params.stockKg,1000);
    assert.ok(repeated.actions.some(action=>action.type==='market'&&action.modelId===hypothetical.id));
    assert.equal(app.service.listMemories(app.session).find(item=>item.scope==='role').content,originalMemory.content);
    assert.deepEqual(app.service.listMemories(app.session).find(item=>item.scope==='role').marketParams,{transportKgPerDay:20});
    const actualModel = app.simulation.market({siteId:app.session.siteId,transportKgPerDay:20});
    const plan = app.simulation.adoptMarketSales({siteId:app.session.siteId,modelId:actualModel.id,scenarioId:'hold_short'});
    app.simulation.salesShipments.advance(plan.shipments[0].id,{siteId:app.session.siteId});
    const nextSession = app.service.createSession({siteId:app.session.siteId,role:'manager'});
    const next = app.service.submitTurn(nextSession.sessionId,{message:'按记住的运力比较销售方案',mode:'demo'});
    await app.service.queue;
    const fresh = app.service.getTurn(nextSession.sessionId,next.turnId);
    assert.deepEqual([fresh.marketParams.stockKg,fresh.marketParams.heldKg,fresh.marketParams.transportKgPerDay],[780,400,20]);
    const actual = await app.send('按最新实际库存复盘，重新比较销售方案',{mode:'configured'});
    assert.equal(actual.status,'completed',actual.error);
    assert.deepEqual([actual.marketParams.stockKg,actual.marketParams.heldKg,actual.marketParams.transportKgPerDay],[780,400,30]);
    assert.deepEqual(app.service.getSession(app.session.sessionId).inventoryAssumptions,{});
    assert.equal(hypothetical.params.stockKg,1000,'actual refresh does not rewrite the historical forecast');
    assert.equal(app.simulation.salesInventory(app.session.siteId).stockKg,780);
  } finally {await app.close();}
});

test('saved conversation retains explicit inventory assumptions after assistant reconstruction',async()=>{
  const app = setup();
  try {
    await app.send('假设库存1吨，冻结库存0公斤，仓容1200公斤，每天运力20公斤，比较销售方案');
    await app.service.stop();
    const restored = new BusinessAssistantService(app.options);
    const turn = restored.submitTurn(app.session.sessionId,{message:'运力改为30公斤，其他条件不变，继续比较',mode:'demo'});
    await restored.queue;
    const continued = restored.getTurn(app.session.sessionId,turn.turnId);
    assert.equal(continued.status,'completed',continued.error);
    assert.deepEqual([continued.marketParams.stockKg,continued.marketParams.heldKg,continued.marketParams.transportKgPerDay],[1000,0,30]);
    assert.deepEqual(restored.getSession(app.session.sessionId).inventoryAssumptions,{stockKg:1000,heldKg:0});
    assert.equal(restored.listMemories(app.session).filter(item=>item.scope==='role').length,0);
    await restored.stop();
  } finally {app.store.close();}
});

test('saving a stock memory alone does not activate a hypothetical inventory for later actual calculations',async()=>{
  const app = setup();
  try {
    await app.send('记住库存650公斤，冻结库存0公斤，每天运力20公斤');
    assert.deepEqual(app.service.getSession(app.session.sessionId).inventoryAssumptions,{});
    const model = app.simulation.market({siteId:app.session.siteId,transportKgPerDay:20});
    const plan = app.simulation.adoptMarketSales({siteId:app.session.siteId,modelId:model.id,scenarioId:'hold_short'});
    app.simulation.salesShipments.advance(plan.shipments[0].id,{siteId:app.session.siteId});
    const turn = await app.send('按记住的运力比较销售方案');
    assert.equal(turn.status,'completed',turn.error);
    assert.deepEqual([turn.marketParams.stockKg,turn.marketParams.heldKg,turn.marketParams.transportKgPerDay],[780,400,20]);
    assert.equal(app.service.listMemories(app.session).find(item=>item.scope==='role').marketParams.stockKg,650);
  } finally {await app.close();}
});

test('processing dialogue distinguishes received latex from dry inventory and follows through to current-stock sales advice',async()=>{
  const seen = [];
  const app = setup({async complete({messages}) {
    seen.push(messages);
    const current = [...messages].reverse().find(item=>item.role==='tool'&&JSON.parse(item.content).inventory);
    const {inventory,production} = JSON.parse(current.content);
    return {content:`结论：已加工 ${production.processedKg} 公斤干胶，在库 ${inventory.stockKg} 公斤，已售 ${inventory.soldKg} 公斤。\n下一步：查看加工入库。`,toolCalls:[]};
  }});
  try {
    const {siteId} = app.session,workflow = app.simulation.logistics;
    const task = app.simulation.latestTasks(siteId).find(item=>item.block==='D');
    let batch = workflow.create({requestId:'dialogue-collect',siteId,taskId:task.id,
      operator:'模拟收胶员',collectionPointId:'guangdong-maoming-collection-1',containerCount:2,note:'收胶'});
    let sequence = 0;
    const act = (action,extra={}) => batch = workflow.transition(batch.id,action,{requestId:`dialogue-action-${++sequence}`,
      siteId,revision:batch.revision,operator:'模拟经办人',note:action,...extra});
    act('weigh',{grossKg:102,tareKg:2});
    act('inspect',{sampleId:'dialogue-sample',dryRubberPercent:30,decision:'pass'});
    act('plan',{destinationId:'guangdong-maoming-processing-3',vehicleCode:'SIM-001',driver:'模拟驾驶员',
      plannedDepartureAt:'2026-10-20T03:00:00Z'});
    act('dispatch');
    act('receive',{receivedKg:100});
    const pending = await app.send('目前有多少待加工，库存多少？');
    assert.equal(pending.status,'completed',pending.error);
    assert.match(pending.answer.split('\n\n')[0],/待加工 1 批、100 公斤鲜胶乳.*尚未计入干胶库存.*在库 800 公斤干胶/);
    assert.ok(!pending.tools.some(tool=>tool.name==='compare_market'));
    assert.ok(pending.actions.some(action=>action.type==='logistics'&&action.batchId===batch.id));
    const before = await app.send('刚才加工完成了吗？',{mode:'configured'});
    assert.match(before.answer,/已加工 0 公斤干胶，在库 800 公斤/);
    act('process');
    const after = await app.send('刚才加工多少，最新库存和已售多少？',{mode:'configured'});
    assert.equal(after.status,'completed',after.error);
    assert.match(after.answer,/已加工 30 公斤干胶，在库 830 公斤，已售 0 公斤/);
    assert.match(seen.at(-1)[0].content,/已签收待加工的 receivedKg 不能当成干胶入库/);
    const demo = await app.send('刚才加工多少，最新库存和已售多少？');
    assert.equal(demo.status,'completed',demo.error);
    assert.match(demo.answer.split('\n\n')[0],/最近一批已加工入库 30 公斤干胶.*在库 830 公斤干胶.*已签收销售 0 公斤/);
    assert.ok(!demo.tools.some(tool=>tool.name==='compare_market'));
    const next = await app.send('刚才加工多少，下一步销售怎么安排？');
    assert.equal(next.status,'completed',next.error);
    assert.match(next.answer.split('\n\n')[0],/已加工入库 30 公斤干胶.*在库 830 公斤干胶.*建议/);
    assert.match(next.answer.split('\n\n')[0],/下一步：.*查看经营方案/);
    assert.equal(next.marketParams.stockKg,830);
    assert.equal(app.simulation.salesInventory(siteId).stockKg,830);
  } finally {await app.close();}
});

test('failed model turn is recorded and a later demo turn still completes',async()=>{
  const app = setup({async complete(){throw Error('provider unavailable');}});
  try {
    const first = await app.send('B区任务',{mode:'configured'});
    assert.equal(first.status,'failed');
    const next = await app.send('继续用规则演示');
    assert.equal(next.status,'completed',next.error);
    assert.equal(next.zone,'B');
  } finally {await app.close();}
});

test('startup marks interrupted turns failed without leaving perpetual running state',async()=>{
  const app = setup();
  try {
    const session = app.session;
    app.store.db.prepare('INSERT INTO assistant_turns VALUES(?,?,?,?)').run('interrupted',session.sessionId,
      JSON.stringify({turnId:'interrupted',message:'测试',status:'running',mode:'demo',tools:[],actions:[],memoriesUsed:[],createdAt:app.options.clock().toISOString()}),'[]');
    const restored = new BusinessAssistantService(app.options);
    assert.equal(restored.getTurn(session.sessionId,'interrupted').status,'failed');
    await restored.stop();
  } finally {await app.close();}
});
