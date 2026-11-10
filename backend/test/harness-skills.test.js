import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {seedDemoTasks} from '../src/adapters/demo-tasks.js';
import {BusinessAssistantService} from '../src/assistant-service.js';
import {SkillLibrary,initialSkills,suggestTriggers} from '../src/assistant-skills.js';
import {traceNumbers} from '../src/answer-check.js';
import {harnessLedger} from '../src/harness-ledger.js';

const NOW = new Date('2026-10-21T02:00:00Z');
function setup(model) {
  const clock = ()=>NOW,store = new Store();
  const simulation = new SimulationService(store,clock,{contextFactory:makeParkContext});
  seedDemoTasks(simulation,clock());
  const skills = new SkillLibrary({store,clock});
  const service = new BusinessAssistantService({store,simulation,makeParkContext,clock,model,skills});
  const session = service.createSession({siteId:'demo-hainan',role:'manager'});
  return {store,service,skills,session,
    async send(message,mode='configured') {const turn=service.submitTurn(session.sessionId,{message,mode});await service.queue;return service.getTurn(session.sessionId,turn.turnId);},
    async close(){await service.stop();store.close();}};
}
const answer = text => ({content:text,toolCalls:[],usage:{promptTokens:1200,completionTokens:80,cacheHitTokens:600}});

test('questions load only matching skills, and tool use brings that business rule in before the answer',async()=>{
  assert.deepEqual([...initialSkills('浙江大宗能挂牌吗')],['commodity']);
  assert.ok(initialSkills('库存还有多少',['read_sales_inventory']).has('inventory'));
  const systems = [];
  const app = setup({async complete(input) {
    systems.push(input.messages[0].content);
    if (systems.length===1) return {toolCalls:[{id:'c1',name:'read_rubber_market',arguments:{}}],usage:{promptTokens:900,completionTokens:20,cacheHitTokens:0}};
    if (systems.length===2) return {toolCalls:[{id:'c2',name:'load_skill',arguments:{skillId:'park_plan'}}]};
    return answer('结论：查到了。\n下一步：查看橡胶交易对接。');
  }});
  try {
    const turn = await app.send('今天的整体情况怎样？');
    assert.equal(turn.status,'completed',turn.error);
    assert.doesNotMatch(systems[0],/材料未细分天然胶、合成胶或具体牌号/);
    assert.match(systems[0],/尚未加载的技能：.*commodity：浙江大宗橡胶交易/);
    assert.match(systems[1],/材料未细分天然胶、合成胶或具体牌号/,'tool use loads the commodity rule for the next round');
    assert.match(systems[2],/全园割胶强度（增产\/维持\/减产\/暂停/);
    assert.deepEqual(turn.skills.filter(item=>item.how!=='question').map(item=>[item.id,item.how]),[['commodity','tool'],['park_plan','requested']]);
    assert.equal(turn.usage.modelCalls,3);
    assert.equal(turn.usage.promptTokens,2100);
    assert.equal(turn.usage.cacheHitTokens,600);
    assert.ok(turn.usage.promptChars[0]<turn.usage.fullPromptChars*0.6,'the first prompt carries well under the full rule set');
    assert.ok(turn.usage.promptChars[2]>turn.usage.promptChars[0]);
  } finally {await app.close();}
});

test('a handled conversation becomes a pending skill, is injected after approval and paused after unhelpful feedback',async()=>{
  const systems = [];
  const app = setup({async complete(input) { systems.push(input.messages[0].content); return answer('结论：台风天先减产，运力减半时分两批出货。\n下一步：查看经营方案。'); }});
  try {
    const base = await app.send('台风来了运力不够，怎么卖库存？','demo');
    assert.equal(base.status,'completed');
    assert.deepEqual(suggestTriggers(base.message),['台风','运力','库存','卖']);
    const draft = app.service.draftSkill(app.session.sessionId,base.turnId,{title:'台风天销售',triggers:['台风','运力']});
    assert.equal(draft.status,'pending');
    assert.ok(draft.tools.length>=1);
    assert.match(draft.instruction,/遇到类似“台风来了运力不够/);
    await app.send('台风要来了怎么办？');
    assert.doesNotMatch(systems.at(-1),/园区经验技能/,'pending skills are not used');
    app.skills.decide(draft.id,{decision:'approve'});
    const used = await app.send('台风要来了，运力怎么排？');
    assert.match(systems.at(-1),/园区经验技能（已审批的历史做法/);
    assert.ok(used.skills.some(item=>item.id===draft.id&&item.version===1&&item.how==='learned'));
    assert.equal(app.skills.get(draft.id).uses,1);
    app.service.feedback(app.session.sessionId,used.turnId,{helpful:false});
    const second = await app.send('台风天运力还是不够？');
    app.service.feedback(app.session.sessionId,second.turnId,{helpful:false});
    assert.equal(app.skills.get(draft.id).status,'needs_review');
    await app.send('台风天运力安排？');
    assert.doesNotMatch(systems.at(-1),/园区经验技能/,'a skill under review is no longer injected');
    const revised = app.skills.revise(draft.id,{instruction:'台风预警时先按台风情景重算，运力减半，优先出已确认订单。'});
    assert.equal(revised.version,2);
    assert.equal(revised.status,'pending');
    assert.equal(revised.history[0].unhelpful,2);
    const greeting=await app.send('你好','demo');
    assert.throws(()=>app.service.draftSkill(app.session.sessionId,greeting.turnId,{}),/没有用到业务工具|触发词/);
  } finally {await app.close();}
});

test('answer figures are traced with explicit unit conversions; dates are skipped; others are flagged',()=>{
  const data=[{inventory:{stockKg:774,availableKg:374},quote:{referenceCnyPerTonne:19485,message:'结算 19,635 元/吨'},premiumRatio:0.145}];
  const result=traceNumbers('结论：10月24日首批20公斤。库存 774 公斤，可用 374 公斤，参考价 19,485 元/吨（约 19.485 元/公斤），比现货高 14.5%，预计 66 公斤。',data);
  assert.deepEqual(result.untraced,['20','66']);
  assert.equal(result.total,7);
  assert.match(result.summary,/7 个数字，5 个与本轮工具数值对应；20、66 未找到对应数值/);
  const withHistory=traceNumbers('结论：首批20公斤，预计 66 公斤。',data,[{firstShipment:{kg:20}}]);
  assert.deepEqual(withHistory.earlier,['20']);
  assert.match(withHistory.summary,/20 与前几轮工具数值对应；66 未找到对应数值/);
  assert.equal(traceNumbers('结论：一切正常。',data).total,0);
});

test('number lookup does not inflate values, drop signs or confuse known units',()=>{
  const data=[{stockKg:774,netIncomeCny:-500,priceChangePct:8}];
  assert.deepEqual(traceNumbers('库存 77400 公斤，净收益 500 元。',data).untraced,['77400','500']);
  assert.deepEqual(traceNumbers('库存 778 公斤，价格涨幅 800%。',data).untraced,['778','800']);
  assert.deepEqual(traceNumbers('库存 0.774 吨，净收益 -500 元，涨幅 8%。',data).untraced,[]);
  assert.deepEqual(traceNumbers('库存 0.774 公斤。',data).untraced,['0.774']);
  assert.deepEqual(traceNumbers('库存 774 公斤，收入 774 元。',data).untraced,['774']);
  assert.deepEqual(traceNumbers('库存 774.4 公斤。',[{stockKg:774.36}]).untraced,[],'round to the displayed precision');
  assert.deepEqual(traceNumbers('预计 12.5 公斤。',[{label:'干胶 0.0125 吨'}]).untraced,[],'units in tool text can also be converted');
  assert.deepEqual(traceNumbers('预计 12500 公斤。',[{value:12.5}]).untraced,['12500'],'unlabelled numbers do not imply a unit conversion');
  assert.match(traceNumbers('库存 774 公斤。',data).summary,/仅对照数字来源，不核验业务含义/);
});

test('feedback follows the skill version used by a turn and changing a rating replaces its count',async()=>{
  const app = setup({async complete() {return answer('结论：先核对库存。\n下一步：查看经营方案。');}});
  try {
    const base = await app.send('库存多少？','demo');
    const draft = app.service.draftSkill(app.session.sessionId,base.turnId,{title:'核对库存',triggers:['库存']});
    app.skills.decide(draft.id,{decision:'approve'});
    const first = await app.send('库存还有多少？');
    const second = await app.send('再查一下库存。');
    assert.equal(first.skills.find(item=>item.id===draft.id).version,1);
    app.skills.revise(draft.id,{instruction:'查询最新库存后区分可售、在途和已签收。'});
    app.skills.decide(draft.id,{decision:'approve'});

    app.service.feedback(app.session.sessionId,first.turnId,{helpful:false});
    app.service.feedback(app.session.sessionId,second.turnId,{helpful:false});
    let skill = app.skills.get(draft.id);
    assert.equal(skill.version,2);
    assert.equal(skill.status,'active','old answers cannot pause the newly approved version');
    assert.equal(skill.unhelpful,0);
    assert.equal(skill.history[0].unhelpful,2);
    app.service.feedback(app.session.sessionId,first.turnId,{helpful:true});
    skill = app.skills.get(draft.id);
    assert.equal(skill.history[0].helpful,1);
    assert.equal(skill.history[0].unhelpful,1);

    const current = await app.send('再核对库存。');
    assert.equal(current.skills.find(item=>item.id===draft.id).version,2);
    app.service.feedback(app.session.sessionId,current.turnId,{helpful:false});
    app.service.feedback(app.session.sessionId,current.turnId,{helpful:false});
    assert.equal(app.skills.get(draft.id).unhelpful,1,'repeated feedback only counts once');
    app.service.feedback(app.session.sessionId,current.turnId,{helpful:true});
    skill = app.skills.get(draft.id);
    assert.equal(skill.helpful,1);
    assert.equal(skill.unhelpful,0,'changing feedback removes the earlier score');
    app.service.feedback(app.session.sessionId,current.turnId,{helpful:false});
    const next = await app.send('现在库存如何？');
    app.service.feedback(app.session.sessionId,next.turnId,{helpful:false});
    skill = app.skills.get(draft.id);
    assert.equal(skill.helpful,0);
    assert.equal(skill.unhelpful,2);
    assert.equal(skill.status,'needs_review','current-version negative feedback still pauses the skill');
  } finally {await app.close();}
});

test('legacy turns without a recorded skill version do not score the current revision',async()=>{
  const app = setup({async complete() {return answer('结论：请查看库存。\n下一步：查看经营方案。');}});
  try {
    const base = await app.send('库存多少？','demo');
    const draft = app.service.draftSkill(app.session.sessionId,base.turnId,{title:'核对库存',triggers:['库存']});
    app.skills.decide(draft.id,{decision:'approve'});
    const legacy = await app.send('再查一下库存。');
    delete legacy.skills.find(item=>item.id===draft.id).version;
    const row = app.store.db.prepare('SELECT messages FROM assistant_turns WHERE id=?').get(legacy.turnId);
    app.service.saveTurn(legacy,JSON.parse(row.messages));
    app.service.feedback(app.session.sessionId,legacy.turnId,{helpful:false});
    assert.equal(app.skills.get(draft.id).unhelpful,0);
    assert.equal(app.service.getTurn(app.session.sessionId,legacy.turnId).feedback.helpful,false);
  } finally {await app.close();}
});

test('conversation search finds the earlier turn of the same person and the ledger summarises the runs',async()=>{
  const app = setup({async complete(input) {
    const user=[...input.messages].reverse().find(message=>message.role==='user');
    const searched=input.messages.some(message=>message.role==='assistant'&&message.tool_calls?.some(call=>call.function.name==='search_conversations'));
    if (/上次/.test(user.content)&&!searched) return {toolCalls:[{id:'s1',name:'search_conversations',arguments:{query:'台风 运力 方案'}}]};
    return answer('结论：库存 774 公斤。\n下一步：查看经营方案。');
  }});
  try {
    await app.send('台风天运力减半时的销售方案怎么定？','demo');
    const followup = await app.send('上次台风运力方案是怎么定的？');
    const search = followup.tools.find(tool=>tool.name==='search_conversations');
    assert.match(search.summary,/找到 1 段相关对话/);
    const other = app.service.createSession({siteId:'demo-xsbn',role:'manager'});
    assert.deepEqual(app.service.searchConversations(other,'台风运力'),[],'other parks stay separate');
    app.service.feedback(app.session.sessionId,followup.turnId,{helpful:true});
    const ledger = harnessLedger({store:app.store,skills:app.skills,siteId:'demo-hainan',now:NOW});
    assert.equal(ledger.turns.completed,2);
    assert.equal(ledger.turns.model,1);
    assert.equal(ledger.model.calls,2);
    assert.ok(ledger.model.promptCharsSaved>30);
    assert.ok(ledger.tools.some(item=>item.key==='search_conversations'));
    assert.equal(ledger.feedback.helpful,1);
    assert.ok(ledger.verification.answers>=1);
  } finally {await app.close();}
});
