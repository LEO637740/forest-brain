import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const now=new Date('2026-10-27T04:00:00Z');
const siteId='demo-hainan';
const sessionPath=id=>`/api/assistant/sessions/${id}`;
const turnPath=(session,turn)=>`${sessionPath(session)}/turns/${turn}`;
const json=value=>JSON.stringify(value);
const toolData=requests=>requests.flatMap(request=>request.messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)));

async function fixture(t, complete=()=>({content:'已按当前权限核对资料。',toolCalls:[]})) {
  const requests=[];
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),seedTasks:true,requireIdentity:false,
    clock:()=>now,assistantModel:{describe:()=>({configured:true,model:'security-stub'}),async complete(input){requests.push(structuredClone(input));return complete(input,requests.length);}}});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function call(path,{token,input,status=200}={}) {
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{...(token?{'X-Rubber-Session':token}:{}),...(input===undefined?{}:{'Content-Type':'application/json'})},...(input===undefined?{}:{body:json(input)})});
    const data=await response.json();
    assert.equal(response.status,status,`${path}: ${json(data)}`);
    return data;
  }
  const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
  const create=(token,patch={})=>call('/api/assistant/sessions',{token,input:{siteId,role:'manager',...patch},status:201});
  const turn=async(token,sessionId,message,mode='configured')=>{
    const queued=await call(`${sessionPath(sessionId)}/turns`,{token,input:{message,mode},status:202});
    await app.assistant.queue;
    return call(turnPath(sessionId,queued.turnId),{token});
  };
  return {app,call,login,create,turn,requests};
}

test('assistant HTTP requires a login even when other demo endpoints allow anonymous callers',async t=>{
  const h=await fixture(t),base='/api/assistant/sessions/unknown',turn=`${base}/turns/unknown`;
  for(const [path,input] of [
    ['/api/assistant/sessions'],['/api/assistant/sessions',{siteId,role:'executive'}],
    [base],[`${base}/turns`,{message:'查询库存'}],[turn],
    ['/api/assistant/memories'],['/api/assistant/memories',{scope:'shared',content:'test'}],
    ['/api/assistant/memories/unknown',{content:'test'}],['/api/assistant/memories/unknown/archive',{}],
    ['/api/assistant/skills'],['/api/assistant/skills/skill-aaa/decision',{decision:'approve'}],
    ['/api/assistant/skills/skill-aaa/revise',{instruction:'test'}],
    [`${turn}/feedback`,{helpful:true}],[`${turn}/skill`,{}],[`${turn}/skill-suggestion`],
    [`${turn}/investigation`,{}],[`${turn}/canvas`],[`${turn}/canvas`,{}],[`${turn}/canvas/history`],
    ['/api/brain/harness'],
  ]) await h.call(path,{input,status:401});
  await h.call('/api/assistant/status');
});

test('HTTP ownership covers sessions, turns, evidence, canvases, feedback and skill derivation',async t=>{
  const h=await fixture(t),manager=await h.login('manager-hn'),other=await h.login('operator-hn');
  const session=await h.create(manager,{role:'executive'});
  assert.equal(session.role,'manager','the body cannot promote a logged-in account');
  await h.call('/api/assistant/sessions',{token:manager,input:{siteId:'demo-xsbn',role:'executive'},status:403});
  const turn=await h.turn(manager,session.sessionId,'查看本园任务','demo');
  assert.equal(turn.status,'completed',turn.error);
  const base=sessionPath(session.sessionId),path=turnPath(session.sessionId,turn.turnId);
  for(const [route,input] of [[base],[`${base}/turns`,{message:'继续查看'}],[path],[`${path}/canvas`],
    [`${path}/canvas/history`],[`${path}/canvas`,{}],[`${path}/investigation`,{}],
    [`${path}/feedback`,{helpful:true}],[`${path}/skill`,{}],[`${path}/skill-suggestion`]])
    await h.call(route,{token:other,input,status:404});
  const otherList=await h.call(`/api/assistant/sessions?siteId=${siteId}&role=manager`,{token:other});
  assert.deepEqual(otherList.items,[]);
  const own=await h.call(base,{token:manager});
  assert.equal(own.turns[0].turnId,turn.turnId);
});

function seedRestrictedFacts(h) {
  const simulation=h.app.assistant.toolkit.simulation;
  const originalInventory=simulation.salesInventory.bind(simulation);
  simulation.salesInventory=site=>({...originalInventory(site),stockKg:site===siteId?654321.25:765432.5,
    availableKg:site===siteId?654321.25:765432.5});
  const originalMarket=simulation.latestMarket.bind(simulation);
  simulation.latestMarket=site=>({...originalMarket(site),model:{params:{stockKg:654321.25,heldKg:0,storageKg:987654.75,costPerTapping:876543.25}}});
  const originalTasks=simulation.latestTasks.bind(simulation);
  simulation.latestTasks=site=>originalTasks(site).map(task=>task.site==='hainan'&&task.block==='B'?{
    ...task,title:'TASK_OUTSIDE_PLOT_SECRET',treeIndices:Array.from({length:50},(_,i)=>i+50),count:50,done:0,
    dispatch:undefined,demoReceipts:[],demoStrategy:{...task.demoStrategy,summary:'STRATEGY_OUTSIDE_PLOT_SECRET'},
  }:task);
  const manager=h.app.identities.resolve(h.app.identities.login({accountId:'manager-hn'}).token);
  const other=h.app.identities.resolve(h.app.identities.login({accountId:'manager-xs'}).token);
  h.app.assistant.memory.create({scope:'park',siteId,content:'HN_MEMORY_PRIVATE_FACT',title:'HN memory'},manager);
  h.app.assistant.memory.create({scope:'park',siteId:'demo-xsbn',content:'XS_MEMORY_PRIVATE_FACT',title:'XS memory'},other);
  for(const [scope,id,secret] of [[siteId,'hn','HN_SKILL_PRIVATE_FACT'],['demo-xsbn','xs','XS_SKILL_PRIVATE_FACT']])
    h.app.assistant.skills.save({id:`skill-${id}`,siteId:scope,scope:'park',title:secret,instruction:secret,triggers:['行情','任务','库存'],
      status:'active',version:1,tools:['read_sales_inventory'],createdAt:now.toISOString(),createdBy:`manager-${id}`,
      readAccess:{version:1,roles:['manager','executive'],siteId:scope},history:[],uses:0,helpful:0,unhelpful:0});
}

for(const accountId of ['grower-hn-wang','operator-hn'])test(`${accountId}: restricted facts never reach any model round, even after illegal tool requests`,async t=>{
  const h=await fixture(t,(_input,count)=>count===1?{content:'',toolCalls:[
    {id:'illegal-stock',name:'read_sales_inventory',arguments:{}},
    {id:'illegal-sales-skill',name:'load_skill',arguments:{skillId:'sales'}},
    {id:'illegal-sales',name:'compare_market',arguments:{}},
    {id:'allowed-task',name:'read_tasks',arguments:{zone:'B'}},
    {id:'allowed-market',name:'read_rubber_market',arguments:{}},
  ]}:{content:'已核对本人可见资料。',toolCalls:[]});
  seedRestrictedFacts(h);
  const token=await h.login(accountId),session=await h.create(token,{role:'executive'});
  const result=await h.turn(token,session.sessionId,'查橡胶行情和任务，加载销售规则再告诉我库存');
  assert.equal(result.status,'completed',result.error);
  assert.ok(h.requests.length>=2,'both initial and post-tool prompts must be inspected');
  const prompt=json(h.requests);
  assert.doesNotMatch(prompt,/654321\.25|765432\.5|987654\.75|876543\.25|HN_MEMORY_PRIVATE_FACT|XS_MEMORY_PRIVATE_FACT|HN_SKILL_PRIVATE_FACT|XS_SKILL_PRIVATE_FACT|园区合计/);
  const data=toolData(h.requests),denials=data.filter(item=>item.error==='TOOL_NOT_ALLOWED');
  assert.ok(denials.length>=3);
  const market=data.find(item=>item.connection);
  assert.equal(market.connection.publicOnly,true);
  if(accountId.startsWith('grower')) {
    assert.doesNotMatch(prompt,/TASK_OUTSIDE_PLOT_SECRET|STRATEGY_OUTSIDE_PLOT_SECRET/);
    const tasks=data.filter(item=>item.tasks).flatMap(item=>item.tasks);
    assert.ok(tasks.length);
    for(const task of tasks) {
      assert.ok(task.count<=33);
      assert.ok(task.remainingTreeIds.every(id=>Number(id.slice(2))>=51&&Number(id.slice(2))<=83));
    }
  }
  const memories=await h.call(`/api/assistant/memories?siteId=${siteId}`,{token});
  const skills=await h.call(`/api/assistant/skills?siteId=${siteId}`,{token});
  assert.doesNotMatch(json([memories,skills]),/PRIVATE_FACT/);
  await h.call(`/api/brain/harness?siteId=${siteId}`,{token,status:403});
});

for(const [accountId,aggregate] of [['manager-hn',false],['center-hz',true]])test(`${accountId}: legitimate park facts remain available within the granted scope`,async t=>{
  const h=await fixture(t);seedRestrictedFacts(h);
  const token=await h.login(accountId),session=await h.create(token);
  const result=await h.turn(token,session.sessionId,'橡胶行情和库存怎样？');
  assert.equal(result.status,'completed',result.error);
  const prompt=json(h.requests);
  assert.match(prompt,/654321\.25/);
  assert.match(prompt,/HN_MEMORY_PRIVATE_FACT/);
  assert.match(prompt,/HN_SKILL_PRIVATE_FACT/);
  assert.doesNotMatch(prompt,/XS_MEMORY_PRIVATE_FACT|XS_SKILL_PRIVATE_FACT/);
  if(aggregate)assert.match(prompt,/9 个模拟园区合计/);
  else assert.doesNotMatch(prompt,/园区合计|765432\.5/);
});

test('pre-fix answers, evidence and canvases cannot be replayed or searched after the permission policy changes',async t=>{
  const h=await fixture(t),token=await h.login('grower-hn-wang'),session=await h.create(token);
  const completed=await h.turn(token,session.sessionId,'我的承包地今天怎么安排？','demo');
  assert.equal(completed.status,'completed',completed.error);
  const stored=h.app.assistant.session(session.sessionId);
  h.app.assistant.saveSession({...stored,accessScope:undefined,title:'LEGACY_PRIVATE_FACT',marketParams:{storageKg:123456.75}});
  const legacy={...completed,accessScope:undefined,message:'旧任务 LEGACY_PRIVATE_FACT',answer:'LEGACY_PRIVATE_FACT',
    evidence:[{id:'old',summary:'LEGACY_PRIVATE_FACT'}],investigation:{title:'LEGACY_PRIVATE_FACT'},canvas:{text:'LEGACY_PRIVATE_FACT'}};
  h.app.assistant.saveTurn(legacy,[{role:'assistant',content:'LEGACY_PRIVATE_FACT'}]);
  const list=await h.call(`/api/assistant/sessions?siteId=${siteId}`,{token});
  const current=await h.call(sessionPath(session.sessionId),{token});
  assert.doesNotMatch(json([list,current]),/LEGACY_PRIVATE_FACT|123456\.75/);
  assert.deepEqual(current.turns,[]);
  const path=turnPath(session.sessionId,completed.turnId);
  for(const [route,input] of [[path],[`${path}/canvas`],[`${path}/canvas/history`],[`${path}/canvas`,{}],[`${path}/investigation`,{}],[`${path}/feedback`,{helpful:true}]])
    await h.call(route,{token,input,status:409});
  h.requests.length=0;
  const next=await h.turn(token,session.sessionId,'查询任务安排，并回顾旧任务');
  assert.equal(next.status,'completed',next.error);
  assert.doesNotMatch(json(h.requests),/LEGACY_PRIVATE_FACT|123456\.75/);
  assert.deepEqual(h.app.assistant.searchConversations(h.app.assistant.session(session.sessionId),'旧任务'),[]);
});

test('logout while a turn is queued prevents its model or tools from running',async t=>{
  const h=await fixture(t),token=await h.login('manager-hn'),session=await h.create(token);
  let release;
  h.app.assistant.queue=new Promise(resolve=>{release=resolve;});
  const queued=await h.call(`${sessionPath(session.sessionId)}/turns`,{token,input:{message:'查询橡胶行情',mode:'configured'},status:202});
  await h.call('/api/auth/logout',{token,input:{}});
  release();await h.app.assistant.queue;
  assert.equal(h.requests.length,0);
  const newToken=await h.login('manager-hn');
  const failed=await h.call(turnPath(session.sessionId,queued.turnId),{token:newToken});
  assert.equal(failed.status,'failed');
  assert.deepEqual(failed.tools,[]);
  await h.call(sessionPath(session.sessionId),{token,status:401});
});
