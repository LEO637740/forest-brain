import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { INTEGRATION_VERSION } from '../src/integration-version.js';

const sourceTask = (id,site='hainan') => ({id,site,title:'模拟收胶来源',kind:'割胶',block:'A',robot:'R-A',start:'08:00',end:'09:00',
  status:'已完成',count:1,done:1,treeIndices:[0],dispatch:{phase:'completed',history:[{time:'2026-10-19T01:00:00Z',label:'模拟完成'}]}});

async function fixture(t) {
  const app=createApp({dbPath:':memory:',clock:()=>new Date('2026-10-19T02:00:00Z'),generator:new RuleGenerator(),pauseModelsOnStart:true});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  return async(path,input,expected=200)=>{
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:input===undefined?{}:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  };
}

test('HTTP workflow persists simulated business stages and synchronizes batches with existing task reads', async t => {
  const call=await fixture(t), path='/api/simulation/logistics-batches';
  const health=await call('/health');assert.equal(health.version,INTEGRATION_VERSION);assert.ok(health.capabilities.includes('logistics-workflow'));
  assert.ok((await call('/api/meta')).integrationCapabilities.includes('logistics-workflow'));
  await call('/api/simulation/task-receipts',{tasks:[sourceTask('hainan-closed'),sourceTask('xs-closed','xsbn')]});
  let batch=await call(path,{requestId:'http-collect',siteId:'hainan',taskId:'hainan-closed',operator:'收胶员',collectionPointId:'hn-collection-a',containerCount:1,note:'模拟收胶确认'});
  assert.deepEqual((await call('/api/simulation/tasks?siteId=hainan')).logisticsBatches,[batch]);
  assert.deepEqual((await call('/api/simulation/tasks?siteId=xsbn')).logisticsBatches,[]);
  assert.equal((await call(path+'?siteId=hainan')).siteId,'demo-hainan');
  let sequence=0;
  const action=async(kind,extra={})=>{batch=await call(`${path}/${batch.id}/${kind}`,{requestId:`http-action-${++sequence}`,siteId:batch.siteId,
    revision:batch.revision,operator:'业务经办人',note:`模拟${kind}记录`,...extra});return batch;};
  await action('weigh',{grossKg:12,tareKg:2});
  await action('inspect',{sampleId:'HTTP-001',dryRubberPercent:30,decision:'pass'});
  await action('plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-HTTP',driver:'模拟驾驶员',plannedDepartureAt:'2026-10-19T03:00:00Z'});
  await action('dispatch');await action('receive',{receivedKg:9.8,note:'实收差额 0.2 kg，模拟登记待核实'});
  assert.equal(batch.stage,'received');assert.equal(batch.transport.receipt.differenceKg,-0.2);
  assert.deepEqual((await call(path)).items,[batch]);
  assert.deepEqual((await call('/api/simulation/tasks')).logisticsBatches,[batch]);
  assert.equal((await call('/api/simulation/tasks?siteId=hainan')).items[0].status,'已完成');
  assert.equal((await call('/api/simulation/sales-inventory?siteId=hainan')).inventory.processedKg,0);
  await action('hold',{note:'到厂复检前冻结'});
  assert.equal(batch.stage,'quality-held');
  await action('inspect',{sampleId:'HTTP-RETEST',dryRubberPercent:30,decision:'pass',grade:'A'});
  assert.equal(batch.stage,'received');
  await action('start-processing');
  assert.equal(batch.stage,'processing');
  assert.equal((await call('/api/simulation/sales-inventory?siteId=hainan')).inventory.processedKg,0);
  await action('process',{note:'按到厂实收及质检含胶量模拟加工入库'});
  assert.equal(batch.stage,'processed');
  assert.equal(batch.processing.latexKg,9.8);
  assert.equal(batch.processing.dryKg,2.94);
  assert.equal(batch.processing.grade,'A');
  const inventory=(await call('/api/simulation/sales-inventory?siteId=hainan')).inventory;
  assert.equal(inventory.processedKg,2.94);
  assert.equal(inventory.processedBatches,1);
  assert.equal(inventory.stockKg,802.94);
  assert.equal(inventory.availableKg,402.94);
  assert.deepEqual((await call(path)).items,[batch]);

  const model=await call('/api/simulation/market',{siteId:'hainan',transportKgPerDay:1});
  assert.equal(model.params.stockKg,802.94);
  const plan=await call('/api/simulation/market-sales-plan',{modelId:model.id,scenarioId:'sell_now'});
  assert.equal(plan.inventory.processedKg,2.94);
  const shipmentPath=`/api/simulation/sales-shipments/${plan.shipments[0].id}/advance`;
  await call(shipmentPath,{siteId:'hainan'});
  assert.equal((await call('/api/simulation/sales-inventory?siteId=hainan')).inventory.stockKg,801.94);
  await call(shipmentPath,{siteId:'hainan'});
  const signed=(await call('/api/simulation/sales-inventory?siteId=hainan')).inventory;
  assert.equal(signed.stockKg,801.94);
  assert.equal(signed.soldKg,1);
  assert.equal(signed.inTransitKg,0);
  assert.equal(signed.processedKg,2.94);
  assert.equal((await call('/api/simulation/market/latest?siteId=hainan')).inventory.stockKg,801.94);
});

test('HTTP business mutations enforce scope, CAS, stage conditions and request identity without overwriting records', async t => {
  const call=await fixture(t), path='/api/simulation/logistics-batches';
  await call('/api/simulation/task-receipts',{tasks:[sourceTask('closed-http')]});
  const input={requestId:'http-once',siteId:'hainan',taskId:'closed-http',operator:'收胶员',collectionPointId:'hn-collection-a',containerCount:1,note:'模拟确认'};
  const batch=await call(path,input), resource=`${path}/${batch.id}`;
  assert.deepEqual(await call(path,input),batch);
  assert.equal((await call(path,{...input,note:'变化'},409)).error.code,'LOGISTICS_REQUEST_CONFLICT');
  assert.equal((await call(path,{...input,requestId:'again'},409)).error.code,'LOGISTICS_ALREADY_COLLECTED');
  const action={requestId:'bad-action',siteId:'xsbn',revision:batch.revision,operator:'经办人',note:'模拟操作'};
  assert.equal((await call(resource+'/pause',action,404)).error.code,'NOT_FOUND');
  assert.equal((await call(resource+'/pause',{...action,siteId:'hainan',revision:0},409)).error.code,'LOGISTICS_REVISION_CONFLICT');
  assert.equal((await call(resource+'/dispatch',{...action,siteId:'hainan'},409)).error.code,'LOGISTICS_STATE_CONFLICT');
  assert.equal((await call(path+'?siteId=unknown',undefined,400)).error.code,'INVALID_QUERY');
  assert.deepEqual((await call(path+'?siteId=xsbn')).items,[]);
  assert.deepEqual((await call(path+'?siteId=hainan')).items,[batch]);
});
