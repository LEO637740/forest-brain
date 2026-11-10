import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

function fixture(t){
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),clock:()=>new Date('2026-10-27T02:00:00Z')});
  t.after(()=>app.close());
  const identity=app.identities.resolve(app.identities.login({accountId:'manager-hn'}).token);
  const session=app.assistant.createSession({siteId:'demo-hainan'},identity);
  const actions=app.assistant.toolkit.actions;
  const prepare=(kind,targetId,step,payload={})=>actions.prepare({kind,targetId,step,payloadJson:JSON.stringify(payload)},
    {identity,session,turn:{turnId:'test-turn'}}).data;
  const confirm=operation=>actions.confirm(operation.id,session,identity,()=>identity);
  return {app,identity,session,actions,prepare,confirm};
}
test('capture prepares without dispatch, confirmation dispatches once and is owner-bound',async t=>{
  const f=fixture(t);
  const prepared=f.prepare('capture_tree','HN-B-0024');
  assert.equal(f.actions.reviews.jobs('demo-hainan').length,0);
  const [a,b]=await Promise.all([f.confirm(prepared),f.confirm(prepared)]);
  assert.equal(a.result.id,b.result.id);
  assert.equal(a.result.treeId,'T-0074');
  assert.equal(a.result.observation.status,'dispatched');
  assert.equal(f.actions.reviews.jobs('demo-hainan').length,1);
  assert.deepEqual(await f.confirm(prepared),a);
  const other=f.app.assistant.createSession({siteId:'demo-hainan'},f.identity);
  assert.throws(()=>f.actions.get(prepared.id,other,f.identity),/不属于当前会话/);
  const grower=f.app.identities.resolve(f.app.identities.login({accountId:'grower-hn-wang'}).token);
  const session=f.app.assistant.createSession({siteId:'demo-hainan'},grower);
  assert.throws(()=>f.actions.prepare({kind:'capture_tree',targetId:'HN-B-0024'},{session,identity:grower,turn:{turnId:'g'}}));
});
test('batch confirmation uses one ledger through freeze, reinspection, processing and sales',async t=>{
  const f=fixture(t),simulation=f.actions.simulation;
  const task={id:'fusion-task',site:'hainan',title:'融合验收割胶',kind:'割胶',block:'A',robot:'R-A',
    start:'08:00',end:'09:00',status:'已完成',count:2,done:2,treeIndices:[0,1],
    dispatch:{phase:'completed',history:[{time:'2026-10-27T01:00:00Z',label:'模拟割胶完成'}]}};
  simulation.tasks({tasks:[task]});
  let batch=simulation.logistics.create({requestId:'fusion-collect',siteId:'demo-hainan',taskId:task.id,operator:'验收员',collectionPointId:'hn-collection-a',containerCount:2,note:'模拟收胶'});
  const act=async(step,payload={})=>{
    const operation=f.prepare('batch_step',batch.id,step,{revision:batch.revision,operator:'验收员',note:`模拟${step}`,...payload});
    const before=simulation.logistics.get(batch.id,batch.siteId);
    assert.equal(before.revision,batch.revision);
    const receipt=await f.confirm(operation);batch=receipt.result;
    assert.equal((await f.confirm(operation)).result.revision,batch.revision);
    return batch;
  };
  await act('weigh',{grossKg:12.3,tareKg:2});
  await act('inspect',{sampleId:'held',dryRubberPercent:25,decision:'hold'});
  assert.equal(batch.stage,'quality-held');
  await act('inspect',{sampleId:'pass',dryRubberPercent:30,decision:'pass'});
  await act('plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-FUSION',driver:'模拟驾驶员',plannedDepartureAt:'2026-10-27T03:00:00Z'});
  await act('dispatch');await act('receive',{receivedKg:10.1});await act('process');
  assert.equal(batch.stage,'processed');assert.equal(batch.processing.dryKg,3.03);
  assert.equal(simulation.salesInventory('demo-hainan').stockKg,803.03);
  const model=simulation.market({siteId:'demo-hainan'});
  assert.equal(model.params.stockKg,803.03);
  const plan=simulation.adoptMarketSales({siteId:'demo-hainan',modelId:model.id,scenarioId:model.sales.recommendedScenarioId});
  const shipment=plan.shipments[0];
  assert.ok(shipment);
  simulation.salesShipments.advance(shipment.id,{siteId:'demo-hainan'});
  const after=simulation.salesInventory('demo-hainan');
  assert.equal(after.stockKg,Math.round((803.03-shipment.plannedKg)*1000)/1000);
  assert.equal(simulation.salesInventory('demo-xsbn').stockKg,800);
});

test('operation cards reject missing batch fields and stale state before any write',async t=>{
  const f=fixture(t);
  assert.throws(()=>f.prepare('batch_step','missing','inspect',{sampleId:'s',drcPct:30,decision:'pass',note:'检验'}),/dryRubberPercent/);
  const op=f.prepare('capture_tree','HN-A-0001');
  f.actions.reviews.create({siteId:'demo-hainan',treeIds:['T-0001'],kind:'capture',assignee:'robot',captureRequest:true});
  await assert.rejects(f.confirm(op),/对象状态已变化/);
  assert.equal(f.actions.reviews.jobs('demo-hainan').length,1);
  assert.equal(f.actions.get(op.id,f.session,f.identity).state,'prepared');
});

test('nested business transactions roll back together if receipt persistence fails',t=>{
  const f=fixture(t),db=f.app.store?.db??f.actions.store.db;
  db.exec('CREATE TABLE fusion_rollback_probe(id INTEGER)');
  assert.throws(()=>f.actions.store.transaction(()=>{
    db.exec('INSERT INTO fusion_rollback_probe VALUES(1)');
    f.actions.store.transaction(()=>db.exec('INSERT INTO fusion_rollback_probe VALUES(2)'));
    throw Error('receipt failure');
  }),/receipt failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fusion_rollback_probe').get().n,0);
});
