import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPriceFactors} from '../src/price-factors.js';
import {makeParkContext,TREE_IDS} from '../src/adapters/park-demo.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {makeDemoTasks} from '../src/adapters/demo-tasks.js';

const NOW=new Date('2026-10-21T06:00:00Z');
const context=(siteId='demo-hainan')=>makeParkContext({siteId,treeIds:TREE_IDS,now:NOW});
const futures=(settle,previous,volume=1000,openInterest=1000)=>({id:'market',sourceUrl:'https://www.shfe.com.cn/',data:{tradeDate:'2026-10-21',
 contracts:[{contract:'RU2701',settlementCnyPerTonne:settle,closeCnyPerTonne:settle,previousSettlementCnyPerTonne:previous,volumeLots:volume,openInterestLots:openInterest},
  {contract:'RU2611',settlementCnyPerTonne:settle,closeCnyPerTonne:settle,previousSettlementCnyPerTonne:previous,volumeLots:10,openInterestLots:10}]}});
const spot={id:'monthly_report',sourceUrl:'https://example.invalid/report',data:{title:'2026年9月天然橡胶市场动态',publishedAt:'2026-10-15T10:50:00+08:00',
 metrics:[{name:'海南鲜胶乳折干胶月均价',value:17000,unit:'CNY/tonne_dry_rubber',scope:'海南产区监测点',period:'2026-09'}]}};
const factor=(result,key)=>result.factors.find(item=>item.key===key);

test('every teacher factor names its reading, rule, action, owner and data mode',()=>{
 const result=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),sources:[futures(17200,17150),spot]});
 assert.deepEqual(result.factors.map(item=>item.key),['natural_hazard','policy','demand','hot_money','planting','labor','region','technology']);
 assert.deepEqual(result.factors.map(item=>item.horizon),['short','short','short','short','long','long','long','long']);
 for(const item of result.factors){
  assert.ok(item.reading&&item.rule&&item.action&&item.owner&&item.priceEffect,item.key);
  assert.ok(item.sources.length&&item.sources.every(source=>source.mode),item.key);
  assert.ok(['alert','watch','normal','unknown'].includes(item.level));
 }
 assert.equal(result.interactions.length,4);
 assert.match(factor(result,'policy').reading,/2026-12-30.*剩 70 天/);
 assert.equal(factor(result,'policy').level,'watch');
});

test('futures moves, turnover and basis drive the hot-money level from cached exchange data',()=>{
 const calm=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),sources:[futures(17200,17150),spot]});
 assert.equal(factor(calm,'hot_money').level,'normal');
 assert.match(factor(calm,'hot_money').reading,/RU2701 结算 17,200 元\/吨/);
 const jump=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),sources:[futures(18000,17400),spot]});
 assert.equal(factor(jump,'hot_money').level,'alert');
 assert.ok(factor(jump,'hot_money').measures.dailyChange>0.03);
 const basis=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),sources:[futures(19300,19300),spot]});
 assert.equal(factor(basis,'hot_money').level,'watch');
 const missing=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),sources:[]});
 assert.equal(factor(missing,'hot_money').level,'unknown');
 assert.ok(factor(missing,'hot_money').missing.includes('上期所天然橡胶日行情'));
});

test('a park-wide rain event raises a hazard alert and recommends the typhoon scenario before weak demand',()=>{
 const weak=context();
 weak.modules.market={...weak.modules.market,demand:{...weak.modules.market.demand,value:70}};
 const demandOnly=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:weak,sources:[]});
 assert.equal(factor(demandOnly,'demand').level,'alert');
 assert.equal(demandOnly.recommendedScenarioId,'demand_weak');
 const storm=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:weak,sources:[],events:[{id:'rain-1',kind:'rain',zone:null,status:'open'}]});
 assert.equal(factor(storm,'natural_hazard').level,'alert');
 assert.equal(storm.recommendedScenarioId,'typhoon');
 assert.match(storm.recommendation,/自然灾害与运输预警/);
 assert.ok(storm.interactions.find(item=>item.key==='hazard_care').active);
});

test('region suitability flags the temperate trial station and keeps it out of production',()=>{
 const xian=assessPriceFactors({siteId:'demo-xian',now:NOW,context:context('demo-xian'),sources:[]});
 assert.equal(factor(xian,'region').level,'alert');
 assert.match(factor(xian,'region').action,/不安排生产割胶/);
 const hainan=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),sources:[]});
 assert.equal(factor(hainan,'region').level,'normal');
});

test('robot coverage counts completed tree receipts rather than all trees in started tasks',()=>{
 const tasks=makeDemoTasks(NOW).filter(task=>task.site==='hainan');
 const result=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),tasks});
 assert.match(factor(result,'technology').reading,/覆盖 52\/200 棵（26%）/);
});

test('robot coverage deduplicates actual and demo completions using receipt time, excluding skipped, cancelled and unfinished trees',()=>{
 const tasks=makeDemoTasks(NOW).filter(task=>task.site==='hainan');
 const completed=tasks.find(task=>task.block==='D');
 completed.date='2026-08-01'; // A long-running task can still finish trees in the last 30 days.
 completed.demoReceipts[0].finishedAt='2026-09-20T06:00:00Z';
 completed.demoReceipts[1].finishedAt='2026-10-22T06:00:00Z';
 const running=tasks.find(task=>task.block==='B');
 running.demoReceipts[0].outcome='skipped';
 running.demoReceipts[1].outcome='cancelled';
 running.done=10;
 running.status='已取消';
 running.dispatch={...running.dispatch,phase:'cancelled',skipped:[50]};
 const job=index=>({id:`rail-${index}`,planVersion:'v1',angle:26.1,requestedAt:'2026-10-20T01:00:00Z',
  harnessSource:{siteId:'demo-hainan',treeId:`T-${String(index+1).padStart(4,'0')}`,strategyId:`strategy-${index}`,runId:`run-${index}`,
   revision:1,angle:26.1,mode:'simulation',dataMode:'demo',adoptedAt:'2026-10-20T00:00:00Z',expiresAt:'2026-10-22T00:00:00Z'}});
 const jobs=Object.fromEntries([0,1,2,3,152].map(index=>[index,job(index)]));
 const receipt=(index,outcome='completed')=>({index,job:jobs[index],outcome,finishedAt:'2026-10-20T02:00:00Z'});
 tasks.push({id:'recent-rail',site:'hainan',kind:'割胶',date:'2026-08-01',count:5,done:3,status:'执行中',treeIndices:[0,1,2,3,152],
  railBatch:{jobs,results:{0:receipt(0),1:receipt(1,'cancelled'),2:{...receipt(2),job:{...jobs[2],angle:31}},152:receipt(152)}}});
 // 52 seeded completions - 2 outside the period - 2 skipped/cancelled + 1 new valid tree.
 // Tree 152 is completed in both sources; tree 2 has a mismatched receipt and tree 3 is unfinished.
 const result=assessPriceFactors({siteId:'demo-hainan',now:NOW,context:context(),tasks});
 assert.match(factor(result,'technology').reading,/覆盖 49\/200 棵（24.5%）/);
});

test('price factor HTTP is closed to growers and appears in the manager decision list',async t=>{
 const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),clock:()=>NOW,pauseModelsOnStart:true});
 t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,{input,token,status=200}={})=>{
  const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Rubber-Session':token}:{})},body:input===undefined?undefined:JSON.stringify(input)});
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return data;
 };
 const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
 const manager=await login('manager-hn'),grower=await login('grower-hn-wang');
 const result=await call('/api/economics/price-factors?siteId=demo-hainan',{token:manager});
 assert.equal(result.factors.length,8);
 await call('/api/economics/price-factors?siteId=demo-hainan',{token:grower,status:403});
 const brief=await call('/api/workspace/brief?siteId=demo-hainan',{token:manager});
 const item=brief.items.find(entry=>entry.id==='price-factors');
 assert.ok(item);
 assert.equal(item.action.type,'price_factors');
 const session=app.assistant.createSession({siteId:'demo-hainan',role:'manager'});
 const accepted=app.assistant.submitTurn(session.sessionId,{message:'做一次价格因素体检',mode:'demo'});
 await app.assistant.queue;
 const turn=app.assistant.getTurn(session.sessionId,accepted.turnId);
 assert.equal(turn.status,'completed',turn.error);
 assert.ok(turn.tools.some(tool=>tool.name==='read_economic_factors'));
 assert.match(turn.answer,/价格因素体检/);
});
