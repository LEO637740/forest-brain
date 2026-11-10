import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

async function fixture(t,clock){
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),clock:()=>clock.now,pauseModelsOnStart:true});
  t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=async(path,{input,token,status=200}={})=>{
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Rubber-Session':token}:{})},body:input===undefined?undefined:JSON.stringify(input)});
    const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);return data;};
  const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
  return {app,call,login};
}
const policy=view=>view.factors.find(item=>item.key==='policy');

test('a reserve release proposed by a park reaches the price check only after the center approves it with a source',async t=>{
  const clock={now:new Date('2026-10-21T02:00:00Z')};
  const {call,login}=await fixture(t,clock);
  const manager=await login('manager-hn'),operator=await login('operator-hn'),grower=await login('grower-hn-wang'),center=await login('center-hz'),otherManager=await login('manager-xs');
  const input={kind:'reserve_release',title:'国家储备天然橡胶投放 5 万吨',siteIds:['demo-hainan'],effectiveFrom:'2026-10-20',effectiveTo:'2026-11-10'};
  await call('/api/market-events',{token:operator,input,status:403});
  await call('/api/market-events',{token:grower,input,status:403});
  await call('/api/market-events',{token:otherManager,input,status:403});
  const event=await call('/api/market-events',{token:manager,input,status:201});
  assert.equal(event.status,'pending');
  assert.equal(event.scenarioId,'policy_supply');
  const before=await call('/api/economics/price-factors?siteId=demo-hainan',{token:manager});
  assert.ok(!policy(before).events);
  await call(`/api/market-events/${event.id}/decision`,{token:manager,input:{decision:'approve'},status:403});
  const missingSource=await call(`/api/market-events/${event.id}/decision`,{token:center,input:{decision:'approve'},status:409});
  assert.equal(missingSource.error.code,'EVENT_SOURCE_REQUIRED');
  const active=await call(`/api/market-events/${event.id}/decision`,{token:center,input:{decision:'approve',note:'国家粮食和物资储备局公告（演示）'}});
  assert.equal(active.status,'active');
  const after=await call('/api/economics/price-factors?siteId=demo-hainan',{token:manager});
  assert.equal(policy(after).level,'alert');
  assert.equal(policy(after).scenarioId,'policy_supply');
  assert.match(policy(after).reading,/中心已登记：国家储备天然橡胶投放 5 万吨/);
  assert.ok(policy(after).sources.some(source=>source.mode==='registered'));
  assert.ok(['policy_supply','typhoon','demand_weak'].includes(after.recommendedScenarioId));
  const xsbn=await call('/api/economics/price-factors?siteId=demo-xsbn',{token:center});
  assert.ok(!policy(xsbn).events,'park-scoped event stays in its park');
  const listed=await call('/api/market-events?siteId=demo-hainan',{token:manager});
  assert.equal(listed.items[0].status,'active');
  assert.ok(listed.kinds.reserve_release);
  clock.now=new Date('2026-11-12T02:00:00Z');
  const expired=await call('/api/economics/price-factors?siteId=demo-hainan',{token:await login('manager-hn')});
  assert.ok(!policy(expired).events,'expired events no longer count');
  assert.equal((await call('/api/market-events?siteId=demo-hainan',{token:await login('manager-hn')})).items[0].status,'expired');
});

test('the center can register national events and withdraw active ones; invalid periods are refused',async t=>{
  const clock={now:new Date('2026-10-21T02:00:00Z')};
  const {app,call,login}=await fixture(t,clock);
  const center=await login('center-hz');
  await call('/api/market-events',{token:center,input:{kind:'demand_drop',title:'汽车产量环比下降',effectiveFrom:'2026-10-01',effectiveTo:'2027-06-01'},status:400});
  const national=await call('/api/market-events',{token:center,input:{kind:'demand_drop',title:'9 月汽车产量同比下降 8%',source:'中汽协月报（演示）'},status:201});
  assert.equal(national.siteIds,'all');
  assert.equal(national.effectiveFrom,'2026-10-21');
  await call(`/api/market-events/${national.id}/decision`,{token:center,input:{decision:'approve'}});
  const view=await call('/api/economics/price-factors?siteId=demo-guangdong-maoming',{token:center});
  const demand=view.factors.find(item=>item.key==='demand');
  assert.equal(demand.level,'alert');
  assert.equal(demand.scenarioId,'demand_weak');
  await call(`/api/market-events/${national.id}/decision`,{token:center,input:{decision:'withdraw',note:'数据更正'}});
  assert.ok(!(await call('/api/economics/price-factors?siteId=demo-guangdong-maoming',{token:center})).factors.find(item=>item.key==='demand').events);
  // The conversation tool only creates a pending item, scoped to the session park.
  const identity=app.identities.resolve(await login('manager-hn'));
  const session=app.assistant.createSession({siteId:'demo-hainan',role:'manager'},identity);
  const result=app.assistant.toolkit.execute('propose_market_event',{kind:'disaster_warning',title:'台风“示例”预计 10 月 24 日登陆海口',scope:'park'},{session,turn:{turnId:'t1',message:'登记台风'},identity});
  assert.equal(result.data.event.status,'pending');
  assert.deepEqual(result.data.event.siteIds,['demo-hainan']);
  const operator=app.identities.resolve(await login('operator-hn'));
  assert.throws(()=>app.assistant.toolkit.execute('propose_market_event',{kind:'disaster_warning',title:'台风示例登陆'},
    {session:{...session,role:'operator'},turn:{turnId:'t2',message:'x'},identity:operator}),error=>error.code==='FORBIDDEN_ASSISTANT_IDENTITY');
  const operatorSession=app.assistant.createSession({siteId:'demo-hainan'},operator);
  const denied=app.assistant.toolkit.execute('propose_market_event',{kind:'disaster_warning',title:'台风示例登陆'},
    {session:operatorSession,turn:{turnId:'t3',message:'x'},identity:operator});
  assert.equal(denied.denied,true);
});
