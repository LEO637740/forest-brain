import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {makeDemoTasks,makeDemoTaskChain,seedDemoTasks} from '../src/adapters/demo-tasks.js';
import {AssistantMemory} from '../src/assistant-memory.js';
import {AssistantTools,scopeTaskForIdentity} from '../src/assistant-tools.js';
import {Identity,ACCOUNTS} from '../src/identity.js';
import {plotSummary} from '../src/workspace-brief.js';
import {scopeOperationalEvent,scopeWeatherConstraint} from '../src/assistant-access.js';

const clock=()=>new Date('2026-10-27T04:00:00Z');
function setup(t,accountId) {
  const store=new Store(':memory:');t.after(()=>store.close());
  const simulation=new SimulationService(store,clock,{contextFactory:makeParkContext});
  seedDemoTasks(simulation,clock());
  const memory=new AssistantMemory(store,clock),identity=new Identity(ACCOUNTS.find(item=>item.accountId===accountId));
  const tools=new AssistantTools({simulation,memory,makeParkContext,clock});
  const session={accountId:identity.accountId,role:identity.role,siteId:identity.siteIds[0]};
  const turn={turnId:'access-check',message:'查询当前资料',zone:null,treeId:null,marketParams:{}};
  return {store,simulation,memory,identity,tools,session,turn,call:(name,args={})=>tools.execute(name,args,{session,turn,identity})};
}

for(const accountId of ['grower-hn-wang','operator-hn'])test(`${accountId}: public market and skills never read inventory`,t=>{
  const app=setup(t,accountId);
  app.simulation.salesInventory=()=>assert.fail('low-privilege market must not read inventory');
  app.simulation.latestMarket=()=>assert.fail('low-privilege skill must not read saved market parameters');
  const result=app.call('read_rubber_market').data;
  assert.equal(result.connection.publicOnly,true);
  assert.ok(result.documents.length>0);
  assert.equal(result.connection.stockKg,undefined);
  assert.equal(result.connection.availableKg,undefined);
  assert.doesNotMatch(JSON.stringify(result),/园区合计/);
  assert.equal(app.call('read_sales_inventory').denied,true);
  assert.equal(app.call('load_skill',{skillId:'sales'}).denied,true);
  assert.equal(app.call('load_skill',{skillId:'inventory'}).denied,true);
  assert.equal(app.call('load_skill',{skillId:'commodity'}).data.skillId,'commodity');
});

test('manager market reads only its park; center aggregation only reads its granted sites',t=>{
  const manager=setup(t,'manager-hn'),seen=[];
  const inventory=manager.simulation.salesInventory.bind(manager.simulation);
  manager.simulation.salesInventory=siteId=>{seen.push(siteId);return inventory(siteId);};
  const result=manager.call('read_rubber_market').data;
  assert.ok(Number.isFinite(result.connection.stockKg));
  assert.deepEqual(seen,['demo-hainan']);
  assert.doesNotMatch(JSON.stringify(result),/园区合计/);
  const center=setup(t,'center-hz'),centerSeen=[];
  center.identity.siteIds=['demo-hainan','demo-xsbn'];
  const centerInventory=center.simulation.salesInventory.bind(center.simulation);
  center.simulation.salesInventory=siteId=>{centerSeen.push(siteId);return centerInventory(siteId);};
  const network=center.call('read_rubber_market').data;
  assert.match(JSON.stringify(network),/2 个模拟园区合计/);
  assert.deepEqual(new Set(centerSeen),new Set(center.identity.siteIds));
});

test('tool boundary rejects missing, mismatched, forged-role and foreign-site identities',t=>{
  const app=setup(t,'grower-hn-wang');
  const execute=(session,identity,turn=app.turn)=>app.tools.execute('read_rubber_market',{}, {session,turn,identity});
  assert.throws(()=>execute(app.session,null),{code:'FORBIDDEN_ASSISTANT_IDENTITY'});
  assert.throws(()=>execute({...app.session,role:'manager'},app.identity),{code:'FORBIDDEN_ASSISTANT_IDENTITY'});
  assert.throws(()=>execute({...app.session,accountId:'manager-hn'},app.identity),{code:'FORBIDDEN_ASSISTANT_IDENTITY'});
  assert.throws(()=>execute({...app.session,siteId:'demo-xsbn'},app.identity),{code:'FORBIDDEN_SITE'});
  assert.throws(()=>execute(app.session,app.identity,{...app.turn,treeId:'T-0001'}),{code:'FORBIDDEN_TREE'});
  assert.throws(()=>execute({siteId:'demo-hainan',role:'manager'},app.identity),{code:'FORBIDDEN_ASSISTANT_IDENTITY'});
});

test('shared tasks expose only contracted-tree counts and receipts, never other-tree strategy text',t=>{
  const app=setup(t,'grower-hn-wang');
  const base=makeDemoTasks(clock()).find(task=>task.site==='hainan'&&task.block==='B');
  const task=makeDemoTaskChain({...base,count:50,done:35,treeIndices:Array.from({length:50},(_,i)=>50+i),
    title:'PRIVATE_OTHER_PLOT',demoStrategy:undefined,demoReceipts:undefined,
    dispatch:{phase:'running',history:[{time:clock().toISOString(),label:'PRIVATE_OTHER_PLOT'}],skipped:[99]}},clock());
  task.demoStrategy.summary='PRIVATE_OTHER_PLOT';
  app.simulation.latestTasks=()=>[task];
  const result=app.call('read_tasks').data;
  assert.equal(result.total,33);assert.equal(result.done,33);
  assert.equal(result.tasks[0].completedReceipts,33);
  assert.equal(result.tasks[0].skippedTrees,0);
  assert.deepEqual(result.tasks[0].remainingTreeIds,[]);
  assert.equal(result.tasks[0].strategy,null);
  assert.equal(result.tasks[0].collection.canCollect,false);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_OTHER_PLOT|T-0084|T-0100/);
  const projected=scopeTaskForIdentity(task,app.identity);
  assert.equal(projected.count,33);assert.equal(projected.done,33);
  assert.ok(projected.plotEvidence.receipts.every(row=>app.identity.plot.treeIds.includes(row.treeId)));
  assert.equal(projected.demoStrategy,undefined);assert.equal(projected.dispatch,undefined);
  const plot=plotSummary({identity:app.identity,siteId:'demo-hainan',simulation:app.simulation,makeParkContext,now:clock()});
  assert.equal(plot.completedTaps,33);
  assert.doesNotMatch(JSON.stringify(plot),/PRIVATE_OTHER_PLOT/);
  assert.throws(()=>plotSummary({identity:app.identity,siteId:'demo-xsbn',simulation:app.simulation,makeParkContext,now:clock()}),{code:'FORBIDDEN_SITE'});
});

test('plot weather removes unrelated zones, free-text notes and out-of-plot constraint records',t=>{
  const app=setup(t,'grower-hn-wang');
  app.simulation.operationalEvents.create({requestId:'b-rain',siteId:'demo-hainan',zone:1,kind:'rain',note:'PRIVATE_OTHER_PLOT'});
  app.simulation.operationalEvents.create({requestId:'a-rain',siteId:'demo-hainan',zone:0,kind:'rain',note:'A_PRIVATE'});
  app.simulation.effectiveConstraints=()=>({constraints:[{requestId:'mixed',kind:'adopt_weather',siteId:'demo-hainan',
    treeId:'T-0100',treeIds:['T-0051','T-0100'],input:{note:'PRIVATE_OTHER_PLOT'},
    validity:{valid:false,status:'expired',treeId:'T-0100',reason:'PRIVATE_OTHER_PLOT'}}]});
  const result=app.call('read_weather').data;
  assert.equal(result.events.length,1);assert.equal(result.events[0].id,'event-b-rain');
  assert.deepEqual(result.constraints[0].treeIds,['T-0051']);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_OTHER_PLOT|A_PRIVATE|T-0100/);
  assert.equal(scopeOperationalEvent({siteId:'demo-hainan',zone:0},app.identity),null);
  assert.equal(scopeOperationalEvent({siteId:'demo-xsbn',zone:1},app.identity),null);
  assert.equal(scopeWeatherConstraint({siteId:'demo-hainan',treeIds:['T-0001']},app.identity),null);
  assert.equal(scopeWeatherConstraint({siteId:'demo-xsbn',treeIds:['T-0051']},app.identity),null);
});
