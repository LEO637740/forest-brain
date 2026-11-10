import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { SimulationService } from '../src/simulation.js';
import { makeDemoTasks } from '../src/adapters/demo-tasks.js';
import { resolveSurface, transitionTask } from '../../frontend/src/workspace/taskFlow.ts';
import { batchAssessment } from '../../shared/logistics.ts';
import { EudrReadinessService } from '../src/eudr-readiness.js';

const completeTask = (id = 'tap-flow', site = 'hainan') => ({id,site,title:'有模拟完成流程的割胶任务',kind:'割胶',
  block:'A',robot:'R-A',start:'08:00',end:'09:00',status:'已完成',count:2,done:2,treeIndices:[0,1],
  dispatch:{phase:'completed',history:[{time:'2026-10-19T01:00:00.000Z',label:'模拟割胶完成'}]}});

function partialTask(id = 'tap-partial') {
  const job = index => ({id:`${id}-${index}`,planVersion:'plan-v1',angle:25,requestedAt:'2026-10-19T00:30:00.000Z',attemptId:`try-${index}`});
  const jobs = {0:job(0),50:job(50)};
  return {...completeTask(id),status:'已取消',count:2,done:1,treeIndices:[0,50],dispatch:undefined,
    railBatch:{jobs,results:{0:{index:0,job:jobs[0],outcome:'completed',finishedAt:'2026-10-19T01:00:00.000Z'},
      50:{index:50,job:jobs[50],outcome:'cancelled',finishedAt:'2026-10-19T01:00:00.000Z'}}}};
}

function fixture(t) {
  let instant = Date.parse('2026-10-19T02:00:00.000Z'), sequence = 0;
  const clock = () => new Date(instant), store = new Store(), simulation = new SimulationService(store, clock);
  t.after(() => store.close());
  return {store,simulation,workflow:simulation.logistics,advance(){instant += 60_000;},
    task(task = completeTask()) {const result=simulation.tasks({tasks:[task]}); assert.equal(result.conflicts.length,0);return result.tasks.find(item=>item.id===task.id);},
    create(taskId = 'tap-flow', extra = {}) {return simulation.logistics.create({requestId:`collect-${++sequence}`,siteId:'hainan',taskId,
      operator:'模拟收胶员',collectionPointId:'hn-collection-a',containerCount:2,note:'模拟收胶并核对来源',...extra});},
    act(batch,action,extra = {}) {return simulation.logistics.transition(batch.id,action,{requestId:`action-${++sequence}`,siteId:batch.siteId,
      revision:batch.revision,operator:'模拟经办人',note:`模拟${action}依据`,...extra});},
  };
}

function ready(f, batch) {
  batch=f.act(batch,'weigh',{grossKg:12.3,tareKg:2});
  return f.act(batch,'inspect',{sampleId:'sample-1',dryRubberPercent:30,decision:'pass'});
}

function planned(f, batch) {
  batch=ready(f,batch);
  return f.act(batch,'plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-001',driver:'模拟驾驶员',plannedDepartureAt:'2026-10-19T03:00:00Z'});
}

test('simulated collection to receipt persists one source snapshot and exact fresh-latex weight accounting', t => {
  const f=fixture(t), task=f.task(), original=f.store.db.prepare('SELECT * FROM simulation_task_receipts').all();
  let batch=f.create();
  assert.equal(batch.stage,'collected');assert.equal(batch.source.taskRevision,task.revision);
  assert.deepEqual(batch.source.treeIndices,[0,1]);assert.equal(batch.collection.point.id,'hn-collection-a');
  assert.equal(batch.weighing,undefined);assert.equal(batch.mode,'simulation');
  batch=planned(f,batch);
  assert.equal(batch.weighing.netKg,10.3);assert.equal(batch.transport.plannedKg,10.3);
  assert.equal(batch.inspections[0].dryRubberPercent,30);
  batch=f.act(batch,'dispatch');assert.equal(batch.stage,'in-transit');
  f.advance();batch=f.act(batch,'receive',{receivedKg:10.1,note:'模拟签收，记录途中差额 0.2 kg'});
  assert.equal(batch.transport.receipt.differenceKg,-0.2);assert.equal(batch.stage,'received');
  assert.deepEqual(batch.history.map(item=>item.action),['collect','weigh','inspect','plan','dispatch','receive']);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM simulation_task_receipts').all(),original);
  const reloaded=new SimulationService(f.store,f.simulation.clock).logistics;
  assert.deepEqual(reloaded.list('hainan'),[batch]);
  assert.equal(reloaded.list('xsbn').length,0);
});

test('processing credits factory-received latex at the latest passed dry-rubber percentage exactly once', t => {
  const f=fixture(t),task=f.task();
  let batch=f.act(f.create(),'weigh',{grossKg:12.3,tareKg:2});
  batch=f.act(batch,'inspect',{sampleId:'held-sample',dryRubberPercent:25,decision:'hold'});
  batch=f.act(batch,'inspect',{sampleId:'approved-sample',dryRubberPercent:30,decision:'pass'});
  batch=f.act(batch,'plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-PROCESS',driver:'模拟驾驶员',plannedDepartureAt:'2026-10-19T03:00:00Z'});
  batch=f.act(batch,'dispatch');
  batch=f.act(batch,'receive',{receivedKg:10.1});
  const received=batch, before=f.simulation.salesInventory();
  assert.equal(before.processedKg,0);
  assert.equal(before.stockKg,800);
  f.advance();
  const input={requestId:'process-once',siteId:batch.siteId,revision:batch.revision,operator:'模拟加工员',note:'按实收及合格质检折算模拟干胶'};
  batch=f.workflow.transition(batch.id,'process',input);
  assert.equal(batch.stage,'processed');
  assert.equal(batch.processing.latexKg,10.1);
  assert.equal(batch.processing.dryRubberPercent,30);
  assert.equal(batch.processing.dryKg,3.03);
  assert.equal(batch.processing.inspectionId,received.inspections[1].id);
  assert.equal(batch.source.taskId,task.id);
  assert.deepEqual(batch.source,received.source);
  assert.deepEqual(batch.transport,received.transport);
  assert.deepEqual(batch.inspections,received.inspections);
  assert.equal(batch.history.at(-1).action,'process');
  assert.match(batchAssessment(batch,[]).reason,/10.1 kg.*30%.*3.03 kg/);
  const inventory=f.simulation.salesInventory();
  assert.equal(inventory.stockKg,803.03);
  assert.equal(inventory.availableKg,403.03);
  assert.equal(inventory.processedKg,3.03);
  assert.equal(inventory.processedBatches,1);
  assert.equal(inventory.updatedAt,batch.processing.at);
  assert.equal(f.simulation.market().params.stockKg,803.03);
  assert.deepEqual(f.workflow.transition(batch.id,'process',input),batch);
  assert.throws(()=>f.act(batch,'process'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  assert.deepEqual(f.simulation.salesInventory(),inventory);
  assert.deepEqual(new SimulationService(f.store,f.simulation.clock).salesInventory(),inventory);
  assert.equal(f.simulation.salesInventory('xsbn').processedKg,0);
  assert.equal(f.simulation.salesInventory('xsbn').stockKg,800);
});

test('each park credits only its own explicitly processed dry rubber', t => {
  const f=fixture(t);f.task();f.task(completeTask('xs-processing','xsbn'));
  let hn=f.act(planned(f,f.create()),'dispatch');
  hn=f.act(hn,'receive',{receivedKg:10});
  f.act(hn,'process');
  let xs=f.create('xs-processing',{siteId:'xsbn',collectionPointId:'xs-collection-a'});
  xs=f.act(xs,'weigh',{grossKg:22,tareKg:2});
  xs=f.act(xs,'inspect',{sampleId:'xs-approved',dryRubberPercent:35,decision:'pass'});
  xs=f.act(xs,'plan',{destinationId:'xs-processing-a',vehicleCode:'SIM-XS',driver:'模拟驾驶员',plannedDepartureAt:'2026-10-19T03:00:00Z'});
  xs=f.act(xs,'dispatch');
  xs=f.act(xs,'receive',{receivedKg:19.5});
  assert.throws(()=>f.act(xs,'process',{siteId:'hainan'}),error=>error.code==='NOT_FOUND');
  xs=f.act(xs,'process');
  assert.equal(xs.processing.dryKg,6.825);
  assert.equal(f.simulation.salesInventory('hainan').stockKg,803);
  assert.equal(f.simulation.salesInventory('xsbn').stockKg,806.825);
  assert.equal(f.simulation.salesInventory('hainan').processedBatches,1);
  assert.equal(f.simulation.salesInventory('xsbn').processedBatches,1);
});

test('daily demo collection takes completed trees from cancelled, skipped and fully completed work', t => {
  const f=fixture(t), at=f.simulation.clock().toISOString();
  const samples=makeDemoTasks(f.simulation.clock()).filter(task=>task.site==='hainan');
  const cancel=task=>f.task(transitionTask(f.task(transitionTask(task,'cancel',at)),'ack',at));
  const running=cancel(f.task(samples.find(task=>task.block==='B')));
  let reviewed=f.task(samples.find(task=>task.block==='C'));
  const skippedIndex=reviewed.dispatch.incident.treeIndex;
  reviewed=f.task(resolveSurface(reviewed,'skip',+f.simulation.clock()));
  reviewed=f.task(transitionTask(reviewed,'progress',at));
  reviewed=cancel(reviewed);
  const completed=f.task(samples.find(task=>task.block==='D'));

  for(const [task,count] of [[running,12],[reviewed,9],[completed,32]]) {
    const expected=task.demoReceipts.filter(receipt=>receipt.outcome==='completed');
    const batch=f.create(task.id);
    assert.equal(batch.source.completedTrees,count);
    assert.deepEqual(batch.source.treeIndices,expected.map(receipt=>receipt.treeIndex));
    assert.deepEqual(batch.source.demoStrategy,task.demoStrategy);
    assert.deepEqual(batch.source.demoReceipts,expected);
    assert.equal(batch.source.taskStatus,task.status);
    assert.deepEqual(new SimulationService(f.store,f.simulation.clock).logistics.get(batch.id,batch.siteId),batch);
  }
  const reviewBatch=f.workflow.list('hainan').find(batch=>batch.source.taskId===reviewed.id);
  assert.equal(reviewBatch.source.treeIndices.includes(skippedIndex),false);
  assert.equal(reviewed.demoReceipts.filter(receipt=>receipt.outcome==='cancelled').length,18);
});

test('a cancelled demo’s completed portion retains its strategy and receipts through collection, transport and reload', t => {
  const f=fixture(t), at=f.simulation.clock().toISOString();
  let task=f.task(makeDemoTasks(f.simulation.clock()).find(task=>task.site==='hainan'&&task.block==='B'));
  task=f.task(transitionTask(task,'cancel',at));
  task=f.task(transitionTask(task,'ack',at));
  let batch=f.create(task.id);
  const source=structuredClone(batch.source);
  batch=f.act(planned(f,batch),'dispatch');
  f.advance();
  batch=f.act(batch,'receive',{receivedKg:10.1,note:'完成部分已到厂，核对 0.2 kg 运输差额'});
  const reloaded=new SimulationService(f.store,f.simulation.clock).logistics.get(batch.id,batch.siteId);
  assert.equal(reloaded.stage,'received');
  assert.equal(reloaded.transport.receipt.differenceKg,-0.2);
  assert.deepEqual(reloaded.source,source);
  assert.equal(reloaded.source.demoReceipts.length,12);
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded)).source,source);
  assert.deepEqual(reloaded.history.map(item=>item.action),['collect','weigh','inspect','plan','dispatch','receive']);
});

test('collection requires verifiable closed tapping evidence and snapshots only completed trees from a cancelled run', t => {
  const f=fixture(t);
  f.task({...completeTask('label-only'),dispatch:undefined});
  assert.throws(()=>f.create('label-only'),error=>error.code==='LOGISTICS_SOURCE_INVALID');
  f.task({...completeTask('running'),status:'执行中',done:1,dispatch:undefined});
  assert.throws(()=>f.create('running'),error=>error.code==='LOGISTICS_SOURCE_INVALID');
  f.task(completeTask('trial','xian'));
  assert.throws(()=>f.create('trial',{siteId:'xian',collectionPointId:'hn-collection-a'}),error=>error.code==='LOGISTICS_SOURCE_INVALID');
  f.task(partialTask());
  const batch=f.create('tap-partial');
  assert.equal(batch.source.taskStatus,'已取消');assert.equal(batch.source.completedTrees,1);
  assert.deepEqual(batch.source.treeIndices,[0]);assert.equal(batch.source.receipts.length,1);
  assert.equal(batch.source.receipts[0].outcome,'completed');
});

test('collection and action retries are idempotent after later steps, while changed requests and duplicate collection conflict', t => {
  const f=fixture(t);f.task();
  const input={requestId:'collect-once',siteId:'hainan',taskId:'tap-flow',operator:'收胶员',collectionPointId:'hn-collection-a',containerCount:1,note:'明确收胶依据'};
  let batch=f.workflow.create(input);
  const weigh={requestId:'weigh-once',siteId:'demo-hainan',revision:batch.revision,operator:'称重员',note:'秤已去皮',grossKg:10,tareKg:1};
  batch=f.workflow.transition(batch.id,'weigh',weigh);
  batch=f.act(batch,'inspect',{sampleId:'S-1',dryRubberPercent:31,decision:'pass'});
  assert.deepEqual(f.workflow.create(input),batch);
  assert.deepEqual(f.workflow.transition(batch.id,'weigh',weigh),batch);
  assert.throws(()=>f.workflow.create({...input,note:'改写来源'}),error=>error.code==='LOGISTICS_REQUEST_CONFLICT');
  assert.throws(()=>f.create(),error=>error.code==='LOGISTICS_ALREADY_COLLECTED');
  assert.throws(()=>f.workflow.transition(batch.id,'weigh',{...weigh,grossKg:11}),error=>error.code==='LOGISTICS_REQUEST_CONFLICT');
  assert.equal(f.workflow.list().length,1);assert.equal(batch.history.length,3);
});

test('CAS and numeric failures roll back both the batch and idempotency request', t => {
  const f=fixture(t);f.task();let batch=f.create();
  const input={requestId:'retry-valid-weight',siteId:'hainan',revision:batch.revision,operator:'称重员',note:'毛皮重录入',grossKg:1,tareKg:2};
  assert.throws(()=>f.workflow.transition(batch.id,'weigh',input),error=>error.code==='INVALID_LOGISTICS_INPUT');
  assert.deepEqual(f.workflow.get(batch.id,batch.siteId),batch);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM simulation_logistics_requests').get().n,1);
  batch=f.workflow.transition(batch.id,'weigh',{...input,grossKg:12});
  assert.equal(batch.weighing.netKg,10);
  assert.throws(()=>f.act(batch,'inspect',{revision:1,sampleId:'S-2',dryRubberPercent:30,decision:'pass'}),error=>error.code==='LOGISTICS_REVISION_CONFLICT');
  assert.deepEqual(f.workflow.get(batch.id,batch.siteId),batch);
});

test('quality hold retains failed samples, requires explicit reinspection, and prevents transport before approval', t => {
  const f=fixture(t);f.task();let batch=f.create();
  assert.throws(()=>f.act(batch,'plan'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  batch=f.act(batch,'weigh',{grossKg:10,tareKg:1});
  batch=f.act(batch,'inspect',{sampleId:'S-hold',dryRubberPercent:28,decision:'hold',note:'模拟样品暂扣，等待复检'});
  const original=batch.inspections[0];
  assert.equal(batch.stage,'quality-held');
  assert.throws(()=>f.act(batch,'plan'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  batch=f.act(batch,'inspect',{sampleId:'S-recheck',dryRubberPercent:30,decision:'pass',note:'人工追加模拟复检，确认通过'});
  assert.equal(batch.stage,'ready');assert.equal(batch.inspections.length,2);assert.deepEqual(batch.inspections[0],original);
  assert.throws(()=>f.act(batch,'inspect',{sampleId:'overwrite',dryRubberPercent:50,decision:'pass'}),error=>error.code==='LOGISTICS_STATE_CONFLICT');
});

test('freezing a planned batch preserves its waybill and reinspection resumes its original stage with a demo grade', t => {
  const f=fixture(t);f.task();let batch=planned(f,f.create());
  const waybill=structuredClone(batch.transport), firstInspection=structuredClone(batch.inspections[0]);
  batch=f.act(batch,'hold',{note:'发现沉淀，冻结并重新取样'});
  assert.equal(batch.stage,'quality-held');assert.equal(batch.qualityHold.resumeStage,'planned');
  assert.throws(()=>f.act(batch,'dispatch'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  batch=f.act(batch,'inspect',{sampleId:'freeze-retest',dryRubberPercent:29,decision:'hold',grade:'A'});
  assert.equal(batch.stage,'quality-held');assert.equal(batch.inspections.at(-1).grade,undefined);
  batch=f.act(batch,'inspect',{sampleId:'release-retest',dryRubberPercent:30,decision:'pass',grade:'B'});
  assert.equal(batch.stage,'planned');assert.equal(batch.qualityHold,undefined);
  assert.deepEqual(batch.transport,waybill);assert.deepEqual(batch.inspections[0],firstInspection);
  assert.equal(batch.inspections.at(-1).grade,'B');
  batch=f.act(batch,'dispatch');assert.equal(batch.stage,'in-transit');
});

test('factory retest and explicit processing preserve transport differences and credit only the loss-adjusted dry output once', t => {
  const f=fixture(t);f.task();
  let batch=f.act(f.create(),'weigh',{grossKg:105,tareKg:5});
  batch=f.act(batch,'inspect',{sampleId:'original',dryRubberPercent:30,decision:'pass',grade:'B'});
  batch=f.act(batch,'plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-LOSS',driver:'驾驶员',plannedDepartureAt:'2026-10-19T03:00:00Z'});
  batch=f.act(batch,'dispatch');batch=f.act(batch,'receive',{receivedKg:98});
  const receipt=structuredClone(batch.transport.receipt);
  batch=f.act(batch,'hold',{note:'到厂后重新核对干胶含量'});
  assert.throws(()=>f.act(batch,'start-processing'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  batch=f.act(batch,'inspect',{sampleId:'factory',dryRubberPercent:34,decision:'pass',grade:'A'});
  assert.equal(batch.stage,'received');assert.deepEqual(batch.transport.receipt,receipt);
  const input={requestId:'start-once',siteId:batch.siteId,revision:batch.revision,operator:'加工员',note:'开始加工'};
  batch=f.workflow.transition(batch.id,'start-processing',input);
  assert.equal(batch.stage,'processing');assert.equal(batch.processing,undefined);
  assert.equal(f.simulation.salesInventory().stockKg,800);
  assert.deepEqual(f.workflow.transition(batch.id,'start-processing',input),batch);
  assert.equal(new SimulationService(f.store,f.simulation.clock).logistics.get(batch.id,batch.siteId).stage,'processing');
  const finish={requestId:'finish-once',siteId:batch.siteId,revision:batch.revision,operator:'加工员',note:'记录干胶加工损耗',processLossKg:1.32};
  batch=f.workflow.transition(batch.id,'process',finish);
  assert.equal(batch.processing.theoreticalDryKg,33.32);
  assert.equal(batch.processing.processLossKg,1.32);assert.equal(batch.processing.dryKg,32);
  assert.equal(batch.processing.grade,'A');assert.equal(batch.transport.receipt.differenceKg,-2);
  assert.equal(batch.processing.inspectionId,batch.inspections.at(-1).id);
  assert.equal(f.simulation.salesInventory().stockKg,832);
  assert.equal(f.simulation.market().params.stockKg,832);
  assert.deepEqual(f.workflow.transition(batch.id,'process',finish),batch);
  assert.equal(f.simulation.salesInventory().processedKg,32);
  assert.equal(f.simulation.salesInventory('xsbn').processedKg,0);
  const eudr=new EudrReadinessService({store:f.store,simulation:f.simulation,clock:f.simulation.clock});
  assert.equal(eudr.exportPack('hainan',batch.id).batch.dryKg,32);
});

test('zero-loss processing keeps the 100 kg times 34 percent example and rejects impossible losses without changing inventory', t => {
  const f=fixture(t);f.task();let batch=f.act(f.create(),'weigh',{grossKg:105,tareKg:5});
  assert.throws(()=>f.act(batch,'inspect',{sampleId:'bad-grade',dryRubberPercent:34,decision:'pass',grade:'C'}),error=>error.code==='INVALID_LOGISTICS_INPUT');
  batch=f.act(batch,'inspect',{sampleId:'drc34',dryRubberPercent:34,decision:'pass'});
  batch=f.act(batch,'plan',{destinationId:'hn-processing-a',vehicleCode:'SIM-BASE',driver:'驾驶员',plannedDepartureAt:'2026-10-19T03:00:00Z'});
  batch=f.act(batch,'dispatch');batch=f.act(batch,'receive',{receivedKg:100});batch=f.act(batch,'start-processing');
  for(const processLossKg of [-1,35])assert.throws(()=>f.act(batch,'process',{processLossKg}),error=>error.code==='INVALID_LOGISTICS_INPUT');
  assert.equal(f.simulation.salesInventory().processedKg,0);assert.equal(f.workflow.get(batch.id,batch.siteId).stage,'processing');
  batch=f.act(batch,'process');assert.equal(batch.processing.dryKg,34);assert.equal(batch.processing.processLossKg,0);
  assert.equal(f.simulation.salesInventory().processedKg,34);
});

test('rain blocks collection and departure while allowing indoor records and already completed arrival facts', t => {
  const f=fixture(t);f.task(partialTask());
  const events=f.simulation.operationalEvents;
  const createEvent=(requestId,kind,zone)=>events.create({requestId,siteId:'hainan',kind,zone,note:'模拟异常登记'});
  createEvent('b-rain','rain',1);createEvent('a-fault','device_fault',0);
  let batch=f.create('tap-partial'); // B's cancelled tree and A's later fault do not invalidate A's latex.
  const rain=createEvent('a-rain','rain',0);
  batch=planned(f,batch); // Weighing, quality and an unstarted plan remain recordable indoors.
  assert.throws(()=>f.act(batch,'dispatch'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  events.transition(rain.id,'resolve',{siteId:'hainan',note:'雨停，仍待确认恢复'});
  assert.throws(()=>f.act(batch,'dispatch'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  events.transition(rain.id,'resume',{siteId:'hainan',note:'防雨及道路条件已确认'});
  batch=f.act(batch,'dispatch');
  createEvent('rain-again','rain',0);
  batch=f.act(batch,'receive',{receivedKg:10.3,note:'到厂事实已发生，按实记录'});
  assert.equal(batch.stage,'received');
  f.task(completeTask('new-task'));
  assert.throws(()=>f.create('new-task'),error=>error.code==='LOGISTICS_SOURCE_INVALID');
});

test('manual pause is independent of weather and a cancelled batch preserves its records without reopening collection', t => {
  const f=fixture(t);f.task();let batch=planned(f,f.create());
  batch=f.act(batch,'pause',{note:'模拟车辆临时异常'});const hold=batch.manualHold;
  const event=f.simulation.operationalEvents.create({requestId:'manual-rain',siteId:'hainan',kind:'rain',zone:0,note:'模拟降雨'});
  f.simulation.operationalEvents.transition(event.id,'resolve',{siteId:'hainan',note:'雨停'});
  f.simulation.operationalEvents.transition(event.id,'resume',{siteId:'hainan',note:'地表检查通过'});
  assert.deepEqual(f.workflow.get(batch.id,batch.siteId).manualHold,hold);
  assert.throws(()=>f.act(batch,'dispatch'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  f.simulation.operationalEvents.create({requestId:'new-rain',siteId:'hainan',kind:'rain',zone:0,note:'再次降雨'});
  batch=f.act(batch,'resume');assert.equal(batch.manualHold,undefined);
  assert.throws(()=>f.act(batch,'dispatch'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  batch=f.act(batch,'cancel',{note:'模拟运输取消，原胶乳需另行人工处理'});
  assert.equal(batch.stage,'cancelled');assert.equal(batch.transport.vehicleCode,'SIM-001');
  assert.equal(batch.weighing.netKg,10.3);assert.equal(batch.inspections.length,1);
  assert.throws(()=>f.act(batch,'resume'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  assert.throws(()=>f.create(),error=>error.code==='LOGISTICS_ALREADY_COLLECTED');
});

test('parks cannot read or mutate another batch and endpoints must use that park’s collection points and factories', t => {
  const f=fixture(t);f.task();f.task(completeTask('xs-task','xsbn'));
  assert.throws(()=>f.create('xs-task',{siteId:'xsbn'}),error=>error.code==='INVALID_LOGISTICS_INPUT');
  let batch=f.create();
  assert.throws(()=>f.workflow.get(batch.id,'demo-xsbn'),error=>error.code==='NOT_FOUND');
  assert.throws(()=>f.act(batch,'pause',{siteId:'xsbn'}),error=>error.code==='NOT_FOUND');
  batch=ready(f,batch);
  assert.throws(()=>f.act(batch,'plan',{destinationId:'xs-processing-a',vehicleCode:'V',driver:'D',plannedDepartureAt:'2026-10-19T03:00:00Z'}),error=>error.code==='INVALID_LOGISTICS_INPUT');
  assert.throws(()=>f.act(batch,'plan',{destinationId:'hn-collection-a',vehicleCode:'V',driver:'D',plannedDepartureAt:'2026-10-19T03:00:00Z'}),error=>error.code==='INVALID_LOGISTICS_INPUT');
  const xs=f.create('xs-task',{siteId:'xsbn',collectionPointId:'xs-collection-a'});
  assert.equal(xs.siteId,'demo-xsbn');assert.deepEqual(f.workflow.list('xsbn'),[xs]);
  assert.deepEqual(f.workflow.list('hainan'),[batch]);
});

test('an in-transit batch cannot be cancelled and terminal signatures are immutable', t => {
  const f=fixture(t);f.task();let batch=f.act(planned(f,f.create()),'dispatch');
  assert.throws(()=>f.act(batch,'cancel'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  assert.throws(()=>f.act(batch,'receive',{receivedKg:-1}),error=>error.code==='INVALID_LOGISTICS_INPUT');
  batch=f.act(batch,'receive',{receivedKg:0,note:'模拟空罐签收，全部差额须核实'});
  assert.equal(batch.transport.receipt.differenceKg,-10.3);
  assert.throws(()=>f.act(batch,'receive',{receivedKg:10.3}),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  assert.throws(()=>f.act(batch,'process'),error=>error.code==='LOGISTICS_STATE_CONFLICT');
  assert.deepEqual(f.workflow.get(batch.id,batch.siteId),batch);
});
