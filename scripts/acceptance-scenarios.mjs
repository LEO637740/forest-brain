import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '../backend/src/store.js';
import { HarnessRuntime } from '../backend/src/runtime.js';
import { LocalContextProvider } from '../backend/src/adapters/context.js';
import { makeParkContext, SCENARIOS, scenarioContext } from '../backend/src/adapters/park-demo.js';
import { SimulationService } from '../backend/src/simulation.js';
import { ReviewWorkflow } from '../backend/src/review-workflow.js';
import { integrationContext } from '../backend/src/tree-context.js';
import { digest } from '../backend/src/util.js';
import { createZoneScheduler } from '../frontend/src/zoneFleet.ts';
import { finishRailTask, syncRailTask } from '../frontend/src/workspace/railTaskState.ts';
import { logisticsDependency, taskEvidence } from '../frontend/src/workspace/taskLifecycleModel.ts';
import { verifyFleetJobWith } from '../frontend/src/integration/fleetVerification.ts';
import { weatherTimingFor } from '../frontend/src/integration/weatherConstraints.ts';
import { eventHoldForZone } from '../frontend/src/workspace/operationalEvents.ts';
import { batchStageLabels, batchHoldReason } from '../shared/logistics.ts';

export const FIXED_TIME = '2026-10-17T02:00:00.000Z';
export const ACCEPTANCE_SCENARIOS = [
  { id:'normal', title:'正常作业', input:'海南 T-0001，完整模拟档案，采用角度建议后提交模拟机器人。', expected:'策略可用，任务开始执行；未完成前没有完成回执，收胶仍等待。' },
  { id:'missing', title:'缺数据与补测', input:'海南 T-0042，树围缺失；通过模拟核查采集证据，再明确提交补测依据。', expected:'缺项时不出角度；补测后重新生成建议，但不会自动创建割胶任务或虚构生长历史。' },
  { id:'rain', title:'降雨暂缓', input:'同一批 50 棵树，先晴天再更新降雨、土壤水分与干胶指标。', expected:'天气建议转为暂缓，不能采用暂缓窗口；不据此宣称已自动停机。' },
  { id:'fault', title:'核验服务故障', input:'任务到达开割前，注入明确的模拟核验服务异常。', expected:'停留待处理，完成数和执行回执均为零，收胶计划暂缓；不是实机故障测试。' },
  { id:'rejected', title:'策略复核驳回', input:'采用后、开割前撤回原策略，保留复核理由并重新核验。', expected:'撤回后不能再次采用，已排队任务也不能开割；采用记录不等于正式审批。' },
  { id:'cancelled', title:'部分完成后取消', input:'T-0001 与 T-0003 的模拟批量任务，第一棵完成后取消第二棵。', expected:'等收臂产生取消回执，保留已完成数量，取消后不再推进储运计划。' },
  { id:'completed', title:'完成与回执核对', input:'T-0001 模拟执行至结束，并重放回执及尝试陈旧状态回写。', expected:'任务、树、策略与回执相互对应；重复回执不重复计数，完成后仍待收胶称重。' },
  { id:'recovery', title:'核验故障后恢复', input:'T-0001 开割前注入模拟核验服务故障，暂停区域后重试，恢复服务再明确继续。', expected:'故障期间零进度、零回执；核验成功仍保持暂停，继续前再次核验，原任务只完成一次；不是实机故障测试。' },
  { id:'operational-rain', title:'运行降雨与收胶联动', input:'已开割的 T-0001 明确登记全园模拟降雨，解除后确认恢复；完成后再登记雨情。', expected:'运行进度冻结且不编造回执，雨停后仍待确认；恢复须重新核验，完成记录保留，后续雨情仍约束收胶准备。' },
  { id:'operational-fault', title:'分区故障与并存事件', input:'A、B 区同时执行；手动暂停 A 区后登记设备故障，再叠加降雨，分别解除与确认恢复。', expected:'A 区故障不影响 B 区完成，事件不能互相覆盖，其他园区事件不越界，确认恢复不解除原手动暂停，已有回执始终保留。' },
  { id:'logistics-complete', title:'收胶称重质检运输闭环', input:'实际模拟割胶完成后，登记 2 个容器、毛重 20 kg、皮重 2 kg、干胶含量 30%，发往海南示例加工厂并登记 17.8 kg 签收。', expected:'每一步保留操作人、依据、时间和原任务回执；净重由称重计算，差额签收明确记录；重复请求不新增批次或事实，陈旧版本不能覆盖。' },
  { id:'logistics-quality', title:'质检暂扣与复检', input:'同一完成任务先验证未称重不能质检，再登记质检暂扣、追加复检通过、生成模拟运单并在发车前取消。', expected:'称重数值受业务约束，质检暂扣时不能运输；复检保留原结果；取消保留称重和质检记录，一个来源任务只有一个批次，跨园区不能操作。' },
  { id:'logistics-hold', title:'部分完成收胶与雨情恢复', input:'A、B 区两棵树完成 A 区一棵后取消，登记雨情后尝试收胶；确认恢复后收取已完成部分，再在手工暂停与雨情并存时逐项恢复。', expected:'只收取有完成回执的一棵树，不由树数换算公斤；设备故障不倒退完成证据，雨情解除仍待确认，天气恢复保留手工暂停；已发车后可如实登记到货。' },
];

// The routes are a fixed scheduler fixture, not measured rail geometry.
const routes = Array.from({length:4}, (_,zone) => ({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function runScenario(definition) {
  let time = Date.parse(FIXED_TIME), configuredCalls = 0, task = null, scheduler = null, batch = null;
  const clock = () => new Date(time), store = new Store(':memory:');
  // A configured generator cannot use network or credentials, even by accident.
  const generator = {mode:'llm',modelVersion:'forbidden-in-acceptance',async generate(){configuredCalls++;throw Error('离线验收不允许配置模型调用');}};
  const runtime = new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator,clock});
  const simulation = new SimulationService(store,clock), reviews = new ReviewWorkflow(store,clock,runtime);
  store.setModelPaused(true,FIXED_TIME);
  const row = {...definition,passed:false,checks:[],trace:[],outcome:{},evidence:{taskHistory:[],receipts:[],dispatchedJobs:{}}};
  const trace = (event,details={}) => row.trace.push({at:clock().toISOString(),event,details:structuredClone(details)});
  const check = (label,actual,expected=true) => {
    const passed = isDeepStrictEqual(actual,expected);
    row.checks.push({label,passed,actual,expected});
    assert.ok(passed,`${label}: ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
  };
  const expectError = (label,fn,code) => {
    let caught; try { fn(); } catch(error) { caught=error; }
    check(label,caught?.code??'未拒绝',code);
    trace(label,{code:caught.code,message:caught.message});
  };
  const prepare = async (treeId,kind='tapping_angle',context=integrationContext({treeIds:[treeId],dataMode:'demo',now:clock(),reviews})) => {
    store.saveContext(context);
    const requestId=`acceptance-${definition.id}-${store.listRuns({limit:100}).items.length}`;
    const accepted=runtime.submit({requestId,kind,siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode:'demo_rules'});
    if(kind!=='weather_window')store.bindTreeView({treeId,siteId:context.siteId,kind,dataMode:'demo',preparationId:requestId,requestId,runId:accepted.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
    await runtime.idle();
    const result=store.getRun(accepted.runId).result;
    trace('策略运行结束',{treeId,kind,status:result.status,runId:accepted.runId,strategyId:result.strategy?.strategyId,missing:result.missingData});
    row.outcome.strategyStatus=result.status;
    return result;
  };
  const adopt = (result,treeId) => simulation.record({requestId:`adopt-${definition.id}-${treeId}`,kind:'adopt_angle',treeId,strategyId:result.strategy.strategyId});
  let weatherConstraints=[],operationalEvents=[];
  // Adapt local service records to the same reads used by the browser verifier.
  // These are isolated business calls; HTTP transport/UI remain separate checks.
  const verification={
    siteId:'demo-hainan',dataMode:'demo',now:()=>time,treeId:index=>`T-${String(index+1).padStart(4,'0')}`,
    refreshWeather:async()=>{const current=simulation.effectiveConstraints();weatherConstraints=current.constraints;operationalEvents=current.operationalEvents;},
    weatherTiming:index=>{
      const hold=eventHoldForZone('hainan',Math.floor(index/50),operationalEvents);
      return hold?{weatherBlock:hold}:weatherTimingFor(verification.treeId(index),weatherConstraints,{siteId:verification.siteId,now:time});
    },
    post:async(path,input)=>{
      assert.equal(path,'/api/simulation/strategy-validity');return simulation.validateStrategies(input);
    },
    read:async path=>{
      const url=new URL(path,'http://acceptance.invalid');
      assert.equal(url.searchParams.get('siteId'),verification.siteId,'读取必须携带当前园区');
      if(url.pathname==='/api/simulation/actions')return {items:simulation.list(url.searchParams.get('treeId'),'demo-hainan')};
      const match=url.pathname.match(/^\/api\/demo\/trees\/(T-\d{4})\/view$/);
      assert.ok(match,'验收不支持此读取');
      const treeId=match[1],kind=url.searchParams.get('kind'),mode=url.searchParams.get('dataMode');
      const binding=store.getTreeViewBinding(treeId,kind,mode,'demo-hainan');
      const run=binding&&store.getRun(binding.runId),strategy=run?.result?.strategy;
      const context=run?store.getRunContext(run.runId):makeParkContext({treeIds:[treeId],now:clock()});
      const validity=strategy&&simulation.strategyValidity({treeId,strategyId:strategy.strategyId,runId:strategy.runId,revision:strategy.revision,dataMode:mode});
      return {siteId:context.siteId,tree:context.modules.trees.find(t=>t.treeId===treeId),strategy:validity?.valid?strategy:null,strategyStatus:validity?.valid?'available':validity?.status??run?.status??'needs_generation'};
    },
  };
  const snapshot = () => scheduler ? {ready:true,error:null,zones:scheduler.zones,jobs:scheduler.jobs} : undefined;
  const eventState = () => simulation.operationalEvents.list();
  const downstream = () => logisticsDependency(task,snapshot(),time,eventState());
  const applyEventState = (label,event) => {
    const events=eventState();
    for(const zone of scheduler.zones)scheduler.setEventHold(zone.zone,eventHoldForZone('hainan',zone.zone,events));
    trace(label,{event,zoneHolds:scheduler.zones.map(zone=>({zone:zone.zone,reason:zone.eventHoldReason??'',paused:zone.paused}))});
  };
  const registerEvent = input => {
    const event=simulation.operationalEvents.create(input);applyEventState('明确登记模拟运行事件',event);return event;
  };
  const transitionEvent = (event,action,note) => {
    const updated=simulation.operationalEvents.transition(event.id,action,{siteId:event.siteId,note});
    applyEventState(action==='resolve'?'登记异常解除，等待恢复确认':'明确确认事件恢复条件',updated);return updated;
  };
  const persist = event => {
    const saved=simulation.tasks({tasks:[task]});
    assert.deepEqual(saved.conflicts,[],`任务保存冲突：${event}`);
    task=saved.tasks.find(t=>t.id===task.id);
    row.evidence.taskHistory.push({at:clock().toISOString(),event,task:structuredClone(task)});
    trace(event,{taskId:task.id,status:task.status,done:task.done,count:task.count,revision:task.revision});
  };
  const createTask = async (indices=[0],validator=null) => {
    const jobs={};
    for(const index of indices){
      const treeId=`T-${String(index+1).padStart(4,'0')}`;
      const surface=await prepare(treeId,'surface_action');
      check(`${treeId} 树表策略可用`,surface.status,'succeeded');
      check(`${treeId} 正常树没有待放行标记`,surface.strategy.proposal.findings.length,0);
      const result=await prepare(treeId);
      check(`${treeId} 角度策略可用`,result.status,'succeeded');
      const source=adopt(result,treeId);
      trace('明确采用模拟建议',source);
      jobs[index]={id:`rail-${definition.id}-${index}`,requestedAt:clock().toISOString(),angle:source.angle,planVersion:`harness-${source.revision}`,harnessSource:source};
    }
    row.evidence.dispatchedJobs=structuredClone(jobs);
    task={id:indices.length===1?jobs[indices[0]].id:`rail-${definition.id}-batch`,site:'hainan',title:definition.title,block:'A',robot:'R-A',start:'10:00',end:'10:15',count:indices.length,done:0,status:'待开始',kind:'割胶',treeIndices:indices,...(indices.length===1?{railJob:jobs[indices[0]]}:{railBatch:{jobs,results:{},baseDone:0}})};
    const receive = outcome => (index,job) => {
      const receipt=structuredClone({index,job,outcome,finishedAt:clock().toISOString()});
      task=finishRailTask(task,receipt);
      row.evidence.receipts.push(receipt);
      trace('收到模拟执行回执',receipt);
    };
    scheduler=createZoneScheduler(routes,receive('completed'),receive('cancelled'),()=>time,async(index,job)=>{
      if(validator)await validator(index,job);
      return verifyFleetJobWith(index,job,verification);
    });
    for(const index of indices)check(`${index+1} 号树进入模拟队列`,scheduler.enqueue(index,jobs[index]));
    persist('任务提交');
  };
  const tick = async (seconds=1) => {
    time+=seconds*1000;scheduler.update(seconds);await settle();
    const updated=syncRailTask(task,snapshot(),time);
    if(!isDeepStrictEqual(updated,row.evidence.taskHistory.at(-1)?.task)){task=updated;persist('执行状态同步');}
  };
  const until = async (predicate,label) => {
    for(let i=0;i<40&&!predicate();i++)await tick();
    check(label,predicate());
  };
  try {
    if(definition.id==='missing'){
      const result=await prepare('T-0042');
      check('缺树围时不输出策略',result.status,'needs_data');
      check('缺项结果不包含角度建议',result.strategy===undefined);
      expectError('不存在的策略不能采用',()=>simulation.record({requestId:'missing-adopt',kind:'adopt_angle',treeId:'T-0042',strategyId:'nonexistent'}),'STRATEGY_UNAVAILABLE');
      const job=reviews.create({treeIds:['T-0042'],kind:'measure',assignee:'robot'})[0];
      check('补测未采集前不能完成',job.status,'queued');
      let premature;
      try { await reviews.complete(job.id,{note:'未采集就提交'}); } catch(error) { premature=error; }
      check('先有证据再提交补测',premature?.code??'未拒绝','NO_EVIDENCE');
      const collected=reviews.collect(job.id);trace('模拟补测采集',collected);
      check('固定模拟树围',collected.evidence.circumferenceCm,66);
      time+=1000;
      const completed=await reviews.complete(job.id,{note:'离线验收：模拟补测记录已核对'});await runtime.idle();
      trace('核查完成并重新生成策略',completed);
      const view=kind=>store.getRun(store.getTreeViewBinding('T-0042',kind,'demo').runId).result;
      check('补测后角度建议可用',view('tapping_angle').status,'succeeded');
      check('单次补测不编造生长历史',view('growth_plan').status,'needs_data');
      check('补测后没有自动创建割胶任务',simulation.latestTasks().length,0);
      row.outcome.strategyStatus='needs_data → succeeded（补测后）';
    } else if(definition.id==='rain'){
      const weather=async id=>{const scene=SCENARIOS.find(s=>s.id===id);return prepare('T-0001','weather_window',scenarioContext(scene,clock()));};
      const morning=await weather('morning'),rain=await weather('rain');
      check('晴天存在候选窗口',morning.strategy.proposal.windows.some(w=>w.suitability==='suitable'));
      check('更新后全部窗口暂缓',rain.strategy.proposal.windows.length>0&&rain.strategy.proposal.windows.every(w=>w.suitability==='defer'));
      check('前后策略针对同一树群',rain.strategy.targetSnapshotId,morning.strategy.targetSnapshotId);
      expectError('暂缓窗口不能采用',()=>simulation.record({requestId:'rain-adopt',kind:'adopt_weather',treeId:'T-0001',strategyId:rain.strategy.strategyId,start:rain.strategy.proposal.windows[0].start}),'INVALID_WINDOW');
      check('没有创建割胶任务或停机回执',simulation.latestTasks().length,0);
      row.outcome.strategyStatus='暂缓作业';
    } else if(definition.id.startsWith('logistics-')){
      const partial=definition.id==='logistics-hold';
      await createTask(partial?[0,52]:[0]);
      const collectInput={requestId:`collect-${definition.id}`,siteId:'hainan',taskId:task.id,operator:'离线验收收胶员',collectionPointId:'hn-collection-a',containerCount:2,note:'固定模拟收胶登记，未接入电子秤或现场设备'};
      expectError('割胶未结束不能提前登记收胶',()=>simulation.logistics.create(collectInput),'LOGISTICS_SOURCE_INVALID');
      if(partial)check('先暂停 B 区以保留未完成部分',scheduler.pause(1,true));
      await until(()=>task.done===1,'上游获得实际模拟完成回执');
      if(partial){
        check('剩余树取消请求受理',scheduler.cancel(52));
        await until(()=>task.status==='已取消','等待收臂并收到剩余树的取消回执');
        check('部分取消保留一棵完成和一棵取消回执',row.evidence.receipts.map(receipt=>receipt.outcome),['completed','cancelled']);
      } else await until(()=>task.status==='已完成','原割胶任务结束后再处理收胶');
      const upstream=structuredClone(task),receipts=structuredClone(row.evidence.receipts);
      const collect=()=>{
        time+=1000;batch=simulation.logistics.create(collectInput);
        trace('明确登记模拟收胶批次',{batch});return batch;
      };
      let sequence=0;
      const action=(kind,facts={},note=`离线验收：${kind} 模拟业务记录`)=>{
        time+=1000;
        const input={requestId:`${definition.id}-${kind}-${++sequence}`,siteId:'hainan',revision:batch.revision,operator:'离线验收业务员',note,...facts};
        batch=simulation.logistics.transition(batch.id,kind,input);
        trace(`明确登记模拟业务：${kind}`,{batch});return {input,batch};
      };
      const planFacts={destinationId:'hn-processing-a',vehicleCode:'模拟车辆 HN-01',driver:'模拟驾驶员甲',plannedDepartureAt:'2026-10-17T03:00:00.000Z'};
      if(partial){
        const rain=registerEvent({requestId:'logistics-collection-rain',siteId:'hainan',kind:'rain',zone:0,note:'收胶前 A 区模拟降雨'});
        expectError('降雨阻止新登记收胶',()=>simulation.logistics.create(collectInput),'LOGISTICS_SOURCE_INVALID');
        transitionEvent(rain,'resolve','雨已停止，等待容器与通行条件核对');
        expectError('雨停未确认仍不能登记收胶',()=>simulation.logistics.create(collectInput),'LOGISTICS_SOURCE_INVALID');
        transitionEvent(rain,'resume','收胶容器遮盖、通行条件已确认');
        registerEvent({requestId:'logistics-completed-device',siteId:'hainan',kind:'device_fault',zone:0,note:'已完成割胶后 R-A 模拟故障，不改写历史完成回执'});
        registerEvent({requestId:'logistics-foreign-rain',siteId:'xsbn',kind:'rain',zone:null,note:'另一园区模拟降雨'});
        registerEvent({requestId:'logistics-cancelled-zone-rain',siteId:'hainan',kind:'rain',zone:1,note:'B 区取消树所在分区降雨，不影响只有 A 区完成产出的收胶批次'});
      }
      collect();
      check('收胶登记进入已收胶待称重',batch.stage,'collected');
      check('收胶批次明确标注模拟模式',batch.mode,'simulation');
      check('来源保存原任务与版本',[batch.source.taskId,batch.source.taskRevision],[task.id,task.revision]);
      check('来源只引用有效完成的树木',[batch.source.completedTrees,batch.source.treeIndices],[1,[0]]);
      check('批次附原任务已保存的完成回执',batch.source.receipts,taskEvidence(upstream).receipts.filter(receipt=>receipt.outcome==='completed'));
      check('收胶数量不自动推算公斤',batch.weighing===undefined);
      const collected=structuredClone(batch.collection);
      const indoorRain=partial?registerEvent({requestId:'logistics-indoor-rain',siteId:'hainan',kind:'rain',zone:0,note:'收胶后 A 区再次降雨，室内称重质检可记录，发车继续等待'}):null;
      if(definition.id==='logistics-quality'){
        expectError('未称重不能登记质检',()=>simulation.logistics.transition(batch.id,'inspect',{requestId:'quality-before-weigh',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查顺序限制',sampleId:'SIM-Q-0',dryRubberPercent:30,decision:'pass'}),'LOGISTICS_STATE_CONFLICT');
        for(const [name,grossKg,tareKg] of [['皮重高于毛重',2,3],['负数重量',-1,0]]){
          expectError(`${name}不能入账`,()=>simulation.logistics.transition(batch.id,'weigh',{requestId:`invalid-weigh-${name==='负数重量'?'negative':'tare'}`,siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查输入边界',grossKg,tareKg}),'INVALID_LOGISTICS_INPUT');
        }
      }
      const weighing=action('weigh',{grossKg:20,tareKg:2});
      check('服务端计算鲜胶乳净重 kg',[batch.weighing.grossKg,batch.weighing.tareKg,batch.weighing.netKg],[20,2,18]);
      check('称重后保持原收胶记录',batch.collection,collected);
      const weightRecord=structuredClone(batch.weighing);
      if(definition.id==='logistics-quality'){
        action('inspect',{sampleId:'SIM-Q-1',dryRubberPercent:28,decision:'hold'},'固定模拟样品待复核，暂扣本批次');
        check('不通过质检进入暂扣',batch.stage,'quality-held');
        const firstInspection=structuredClone(batch.inspections[0]);
        expectError('质检暂扣不能生成运单',()=>simulation.logistics.transition(batch.id,'plan',{requestId:'held-plan',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查暂扣约束',...planFacts}),'LOGISTICS_STATE_CONFLICT');
        action('inspect',{sampleId:'SIM-Q-2',dryRubberPercent:30,decision:'pass'},'追加模拟复检，人工确认可运输');
        check('复检通过才进入待安排运输',batch.stage,'ready');
        check('复检追加并保留原暂扣结果',[batch.inspections.length,batch.inspections[0]],[2,firstInspection]);
      } else {
        action('inspect',{sampleId:'SIM-Q-1',dryRubberPercent:30,decision:'pass'},'固定模拟样品由操作人明确选择通过');
        check('明确质检通过后可安排运输',batch.stage,'ready');
      }
      const plan=action('plan',planFacts);
      check('生成模拟运单但未自动发车',[batch.stage,batch.transport.plannedKg,batch.transport.departure===undefined],['planned',18,true]);
      check('运单使用同园区示例加工厂',batch.transport.destination.id,'hn-processing-a');
      if(definition.id==='logistics-quality'){
        const inspections=structuredClone(batch.inspections),transport=structuredClone(batch.transport);
        expectError('另一个请求不能重复收取同一任务',()=>simulation.logistics.create({...collectInput,requestId:'duplicate-source-collection'}),'LOGISTICS_ALREADY_COLLECTED');
        check('其他园区列表不泄露本园批次',simulation.logistics.list('xsbn').length,0);
        expectError('其他园区不能操作本园批次',()=>simulation.logistics.transition(batch.id,'cancel',{requestId:'foreign-cancel',siteId:'xsbn',revision:batch.revision,operator:'验收员',note:'检查园区边界'}),'NOT_FOUND');
        action('cancel',{},'发车前人工取消，保留已发生的收胶和质检记录');
        check('发车前取消有明确终态',batch.stage,'cancelled');
        check('取消保留称重和全部质检',[batch.weighing,batch.inspections,batch.transport],[weightRecord,inspections,transport]);
        expectError('已取消运单不能发车',()=>simulation.logistics.transition(batch.id,'dispatch',{requestId:'cancelled-dispatch',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查取消终态'}),'LOGISTICS_STATE_CONFLICT');
      } else {
        expectError('未发车不能提前签收',()=>simulation.logistics.transition(batch.id,'receive',{requestId:`premature-receive-${definition.id}`,siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查运输顺序',receivedKg:18}),'LOGISTICS_STATE_CONFLICT');
        if(partial){
          action('pause',{},'手工暂停，等待交接人员核对');
          const hold=structuredClone(batch.manualHold);
          const rain=indoorRain;
          check('降雨期间仍能留存称重质检与运输计划',batch.weighing.netKg===18&&batch.inspections.length===1&&batch.transport.plannedKg===18&&eventState().some(event=>event.id===rain.id&&event.status==='active'));
          transitionEvent(rain,'resolve','雨停，等待道路与防雨条件确认');
          transitionEvent(rain,'resume','道路和容器防雨条件已确认');
          check('天气恢复保留批次手工暂停',batch.manualHold,hold);
          check('手工暂停仍有明确业务原因',batchHoldReason(batch,eventState()).includes(hold.note));
          expectError('天气恢复不能绕过手工暂停发车',()=>simulation.logistics.transition(batch.id,'dispatch',{requestId:'manual-held-dispatch',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查手工暂停'}),'LOGISTICS_STATE_CONFLICT');
          action('resume',{},'交接核对完成，明确恢复本批次');
          const departureRain=registerEvent({requestId:'logistics-dispatch-rain',siteId:'hainan',kind:'rain',zone:0,note:'明确恢复后重新出现降雨，发车仍须等待'});
          expectError('当前降雨阻止发车',()=>simulation.logistics.transition(batch.id,'dispatch',{requestId:'rain-held-dispatch',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查天气联动'}),'LOGISTICS_STATE_CONFLICT');
          transitionEvent(departureRain,'resolve','雨已停止');
          expectError('雨情未确认恢复仍不能发车',()=>simulation.logistics.transition(batch.id,'dispatch',{requestId:'rain-resolved-dispatch',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查恢复确认'}),'LOGISTICS_STATE_CONFLICT');
          transitionEvent(departureRain,'resume','道路、车辆、容器已复核');
        }
        action('dispatch',{},'已核对模拟车辆与司机，明确记录发车');
        check('发车后进入运输中',batch.stage,'in-transit');
        const departure=structuredClone(batch.transport.departure);
        if(partial){
          registerEvent({requestId:'logistics-in-transit-rain',siteId:'hainan',kind:'rain',zone:0,note:'模拟运输途中下雨，允许如实登记已到货的签收事实'});
          expectError('已经发车不能取消运输事实',()=>simulation.logistics.transition(batch.id,'cancel',{requestId:'in-transit-cancel',siteId:'hainan',revision:batch.revision,operator:'验收员',note:'检查发车事实不可抹除'}),'LOGISTICS_STATE_CONFLICT');
        }
        const receipt=action('receive',{receivedKg:17.8},'模拟到货复称 17.8 kg，比发车净重少 0.2 kg，差额已在本说明中登记');
        check('明确签收后流程完成',batch.stage,'received');
        check('差额签收保留发车重量与实收重量',[batch.transport.plannedKg,batch.transport.receipt.receivedKg,batch.transport.receipt.differenceKg],[18,17.8,-0.2]);
        check('签收保留原发车事实',batch.transport.departure,departure);
        const received=structuredClone(batch);
        check('重复签收请求不追加记录',simulation.logistics.transition(batch.id,'receive',receipt.input),received);
        check('重复收胶请求返回同一当前批次',simulation.logistics.create(collectInput),received);
        check('较早动作重试返回最新状态而非倒退',simulation.logistics.transition(batch.id,'weigh',weighing.input),received);
        expectError('同请求改写称重事实被拒绝',()=>simulation.logistics.transition(batch.id,'weigh',{...weighing.input,grossKg:22}),'LOGISTICS_REQUEST_CONFLICT');
        expectError('陈旧版本不能覆盖物流记录',()=>simulation.logistics.transition(batch.id,'cancel',{requestId:`stale-cancel-${definition.id}`,siteId:'hainan',revision:plan.batch.revision,operator:'验收员',note:'检查版本冲突'}),'LOGISTICS_REVISION_CONFLICT');
      }
      check('所有后续步骤保留原任务完成与取消证据',task,upstream);
      check('原逐树回执始终不变',row.evidence.receipts,receipts);
      check('业务历史记录操作人时间和依据',batch.history.every(record=>record.id&&record.operator&&record.note&&record.requestId&&Number.isFinite(Date.parse(record.at))));
      check('同一完成任务只保存一个收胶批次',simulation.logistics.list('hainan').length,1);
      check('新的服务实例读取同一持久化业务结果',new SimulationService(store,clock).logistics.list('hainan')[0],batch);
    } else if(definition.id==='operational-rain'){
      let checks=0;
      await createTask([0],async()=>{checks++;});
      await until(()=>scheduler.zones[0].phase==='working','原策略通过核验后开始割胶');
      await tick(3);
      check('事件前已有三秒有效作业进度',scheduler.zones[0].elapsed,3);
      const event=registerEvent({requestId:'operational-rain-running',siteId:'hainan',kind:'rain',zone:null,note:'全园模拟降雨，检查收胶遮盖'});
      await tick(20);
      check('降雨冻结已开始的切割进度',scheduler.zones[0].elapsed,3);
      check('雨情期间没有完成数或回执',[task.done,row.evidence.receipts.length],[0,0]);
      check('同一任务显示待处理',task.status,'待处理');
      check('收胶储运同步暂缓',downstream().state,'blocked');
      check('下游显示登记的降雨原因',downstream().reason.includes(event.note));
      const source=task.railJob.harnessSource;
      check('事件不撤回原采用策略',simulation.strategyValidity(source).valid);
      check('新的执行核验被运行事件阻断',simulation.validateStrategies({strategies:[source]}).items[0].status,'operational_hold');
      expectError('异常未解除前不能确认恢复',()=>simulation.operationalEvents.transition(event.id,'resume',{siteId:'hainan',note:'提前恢复'}),'EVENT_STATE_CONFLICT');
      transitionEvent(event,'resolve','雨已停止，仍待检查地表和收胶防雨条件');
      await tick(20);
      check('解除异常仍冻结进度与回执',[scheduler.zones[0].elapsed,task.done,row.evidence.receipts.length],[3,0,0]);
      check('解除异常仍暂缓收胶储运',downstream().state,'blocked');
      check('等待恢复时不重复发起开割核验',checks,1);
      transitionEvent(event,'resume','已检查地表、设备和收胶遮盖，确认恢复条件');
      check('确认恢复本身不增加作业进度或回执',[scheduler.zones[0].elapsed,row.evidence.receipts.length],[3,0]);
      await tick();
      check('恢复前重新执行实际策略核验',checks,2);
      check('重新核验期间进度没有补跳',scheduler.zones[0].elapsed,3);
      await until(()=>task.status==='已完成','恢复后原任务完成剩余作业');
      check('原任务只产生一条完成回执',[task.done,row.evidence.receipts.length],[1,1]);
      check('恢复完成回执关联原派发策略',taskEvidence(task).sources[0].strategyId,source.strategyId);
      const completed=structuredClone(task),receipt=structuredClone(row.evidence.receipts[0]);
      const later=registerEvent({requestId:'operational-rain-collected',siteId:'hainan',kind:'rain',zone:null,note:'割胶完成后再次降雨，暂缓收胶准备'});
      await tick(20);
      check('后续降雨不改写已完成任务',task,completed);
      check('后续降雨仍约束待收胶准备',downstream().state,'blocked');
      transitionEvent(later,'resolve','雨停，待检查收胶容器');
      check('完成任务的收胶在解除后仍待确认',downstream().state,'blocked');
      transitionEvent(later,'resume','收胶容器与防雨条件已确认');
      check('恢复后仍需实际收胶称重',downstream().state,'awaiting-weighing');
      check('全程保留原完成回执',row.evidence.receipts[0],receipt);
      check('没有自动生成运输任务',simulation.latestTasks().length,1);
    } else if(definition.id==='operational-fault'){
      await createTask([0,50]);
      await until(()=>scheduler.zones[0].phase==='working'&&scheduler.zones[1].phase==='working','A、B区均通过核验并进入作业');
      await tick(2);
      check('原手动暂停被受理',scheduler.pause(0,true));
      trace('保留事件发生前的手动暂停',{zone:0,paused:true});
      const fault=registerEvent({requestId:'operational-fault-a',siteId:'hainan',kind:'device_fault',zone:0,note:'R-A割胶头模拟故障'});
      registerEvent({requestId:'operational-foreign-rain',siteId:'xsbn',kind:'rain',zone:null,note:'版纳模拟降雨'});
      await tick(6);
      check('故障只冻结A区原有进度',scheduler.zones[0].elapsed,2);
      check('B区不受A区故障或其他园区雨情影响',row.evidence.receipts.map(receipt=>[receipt.index,receipt.outcome]),[[50,'completed']]);
      check('批次保留B区完成数量',task.done,1);
      check('存在故障的批次下游暂缓',downstream().state,'blocked');
      const firstReceipt=structuredClone(row.evidence.receipts[0]);
      const rain=registerEvent({requestId:'operational-fault-rain',siteId:'hainan',kind:'rain',zone:null,note:'全园模拟降雨，与设备故障并存'});
      check('故障和雨情原因同时可查',scheduler.zones[0].eventHoldReason.includes(fault.note)&&scheduler.zones[0].eventHoldReason.includes(rain.note));
      transitionEvent(fault,'resolve','设备维修完成，等待空载测试');
      await tick(20);
      check('设备解除仍保持事件阻断及手动暂停',[scheduler.zones[0].elapsed,scheduler.zones[0].paused,task.done],[2,true,1]);
      transitionEvent(fault,'resume','设备空载测试通过');
      check('确认设备恢复不能覆盖仍在生效的雨情',scheduler.zones[0].eventHoldReason.includes(rain.note));
      check('设备恢复后收胶储运仍受雨情约束',downstream().state,'blocked');
      transitionEvent(rain,'resolve','雨停，待核对地表和收胶条件');
      await tick(20);
      check('雨停未确认时没有新增进度或回执',[scheduler.zones[0].elapsed,task.done,row.evidence.receipts.length],[2,1,1]);
      transitionEvent(rain,'resume','雨后作业及收胶防雨条件已确认');
      await tick(20);
      check('事件恢复保留原有手动暂停',scheduler.zones[0].paused);
      check('手动暂停期间任务不自行推进',[scheduler.zones[0].elapsed,task.done,row.evidence.receipts.length],[2,1,1]);
      check('下游仍说明机器人手动暂停',downstream().reason.includes('暂停'));
      check('人工继续原暂停区域被受理',scheduler.pause(0,false));
      trace('人工继续原暂停区域',{zone:0,taskId:task.id});
      await until(()=>task.status==='已完成','人工继续后仅完成A区剩余作业');
      check('两个区域各产生一条完成回执',row.evidence.receipts.map(receipt=>[receipt.index,receipt.outcome]),[[50,'completed'],[0,'completed']]);
      check('先完成的B区回执始终不变',row.evidence.receipts[0],firstReceipt);
      check('完成批次的回执全部可核对',taskEvidence(task).hasCompletionRecord);
      check('完成后仍待收胶确认',downstream().state,'awaiting-weighing');
      check('他园尚未恢复的事件没有被本园操作关闭',eventState().find(event=>event.siteId==='demo-xsbn').status,'active');
    } else {
      let verificationUnavailable=definition.id==='recovery',verificationAttempts=0;
      await createTask(definition.id==='cancelled'?[0,2]:[0],['fault','recovery'].includes(definition.id)?async()=>{
        verificationAttempts++;
        if(definition.id==='recovery')trace('执行模拟任务核验',{attempt:verificationAttempts,serviceAvailable:!verificationUnavailable});
        if(definition.id==='fault'||verificationUnavailable)throw Error('模拟核验服务不可用，请恢复后重试');
      }:null);
      if(definition.id==='rejected'){
        const source=task.railJob.harnessSource;
        store.withdrawStrategy(source.runId,'离线验收：复核驳回原建议',clock().toISOString());
        trace('复核驳回并撤回策略',{runId:source.runId,reason:'离线验收：复核驳回原建议'});
        expectError('撤回后禁止再次采用',()=>simulation.record({requestId:'adopt-after-withdrawal',kind:'adopt_angle',treeId:source.treeId,strategyId:source.strategyId}),'STRATEGY_UNAVAILABLE');
        row.outcome.strategyStatus='withdrawn';
      }
      if(['fault','rejected'].includes(definition.id)){
        await tick();await tick(20);
        check('故障或撤回时任务待处理',task.status,'待处理');
        check('核验失败时不开割',scheduler.zones[0].phase,'moving');
        check('未增加完成数',task.done,0);
        check('不生成完成回执',row.evidence.receipts.length,0);
        check('收胶计划暂缓',logisticsDependency(task,snapshot(),time).state,'blocked');
      } else {
        if(definition.id==='recovery'){
          trace('注入模拟核验服务故障',{hardwareFault:false});
          await tick();await tick(20);
          check('首次核验失败后保持待处理',task.status,'待处理');
          check('故障期间没有进入开割',scheduler.zones[0].phase,'moving');
          check('故障期间作业进度为零',scheduler.zones[0].elapsed,0);
          check('故障期间完成数和回执均为零',[task.done,row.evidence.receipts.length],[0,0]);
          check('故障期间没有自动反复核验',verificationAttempts,1);
          check('区域暂停操作被受理',scheduler.pause(0,true));
          check('暂停时可明确重试核验',scheduler.retryValidation(0));
          check('重试进入核验中',scheduler.jobs[0].validation,'pending');
          check('核验中重复重试被拒绝',scheduler.retryValidation(0),false);
          await tick(20);
          check('服务仍故障时重试不能放行',scheduler.jobs[0].validation,'invalid');
          check('失败重试后仍保持暂停',scheduler.zones[0].paused);
          check('失败重试未增加进度、完成数或回执',[scheduler.zones[0].elapsed,task.done,row.evidence.receipts.length],[0,0,0]);
          check('失败重试只增加一次核验',verificationAttempts,2);
          verificationUnavailable=false;
          trace('恢复模拟核验服务',{hardwareFault:false});
          check('服务恢复后可再次重试',scheduler.retryValidation(0));
          check('恢复核验中重复重试被拒绝',scheduler.retryValidation(0),false);
          await tick(20);
          check('重试成功后仍需开割前再次核验',scheduler.jobs[0].validation,'required');
          check('重试成功没有自动解除暂停',scheduler.zones[0].paused);
          check('暂停区域仍显示待处理',task.status,'待处理');
          check('恢复核验没有启动作业或生成回执',[scheduler.zones[0].phase,scheduler.zones[0].elapsed,task.done,row.evidence.receipts.length],['moving',0,0,0]);
          check('成功重试只增加一次核验',verificationAttempts,3);
          check('明确继续区域操作被受理',scheduler.pause(0,false));
          trace('明确继续暂停区域',{taskId:task.id});
          await tick();
          check('继续区域后再次执行开割前核验',verificationAttempts,4);
          check('开割核验通过才获得执行许可',scheduler.jobs[0].validation,'valid');
          check('核验完成前没有推进切割进度',scheduler.zones[0].elapsed,0);
        }
        await until(()=>scheduler.zones[0].phase==='working','通过核验后才进入模拟作业');
        if(definition.id==='normal'){
          check('任务显示执行中',task.status,'执行中');check('作业未结束时无回执',row.evidence.receipts.length,0);
          check('收胶等待割胶完成',logisticsDependency(task,snapshot(),time).state,'waiting');
        } else {
          await until(()=>task.done===1,'第一棵树收到完成回执');
          if(definition.id==='cancelled'){
            check('取消第二棵任务被受理',scheduler.cancel(2));
            check('收臂前没有取消回执',row.evidence.receipts.filter(r=>r.outcome==='cancelled').length,0);
            await tick();check('取消后保留已完成数量',task.done,1);check('最终任务已取消',task.status,'已取消');
            check('完成与取消回执各一条',row.evidence.receipts.map(r=>r.outcome),['completed','cancelled']);
            check('取消后停止储运计划',logisticsDependency(task,snapshot(),time).state,'cancelled');
          } else {
            check('全部完成',task.status,'已完成');
            check('回执可关联原策略',taskEvidence(task).sources[0].strategyId===row.evidence.dispatchedJobs[0].harnessSource.strategyId);
            check('仅进入待收胶确认',logisticsDependency(task,snapshot(),time).state,'awaiting-weighing');
          }
          const final=structuredClone(task),receipt=row.evidence.receipts[0];
          check('所有回执对应原始派发的树、任务、策略、版本与角度',row.evidence.receipts.every(r=>{
            const original=row.evidence.dispatchedJobs[r.index];
            return original&&original.id===r.job?.id&&original.angle===r.job.angle&&original.planVersion===r.job.planVersion&&isDeepStrictEqual(original.harnessSource,r.job.harnessSource);
          }));
          check('重复回执不修改结果',isDeepStrictEqual(finishRailTask(task,receipt),task));
          const stale=row.evidence.taskHistory[0].task;
          check('陈旧任务写入被拒绝',simulation.tasks({tasks:[stale]}).conflicts[0]?.code,'TASK_REVISION_CONFLICT');
          check('终态不能重新打开',simulation.tasks({tasks:[{...task,status:'执行中',railResult:undefined}]}).conflicts[0]?.code,'TASK_TERMINAL');
          await tick(20);check('结束后不继续增加进度或回执',isDeepStrictEqual(task,final));
          check('服务端最终记录与页面状态一致',isDeepStrictEqual(simulation.latestTasks()[0],task));
          if(definition.id==='recovery'){
            check('恢复后保持原任务与原树',[task.id,task.treeIndices],[row.evidence.dispatchedJobs[0].id,[0]]);
            check('恢复后只完成一次且仅有一条完成回执',[task.done,row.evidence.receipts.length,row.evidence.receipts[0].outcome],[1,1,'completed']);
            check('终态任务不能重新发起调度核验',scheduler.retryValidation(0),false);
            check('任务完成后不再核验',verificationAttempts,4);
          }
        }
      }
    }
    check('没有调用配置模型',configuredCalls,0);
    row.passed=true;
  } catch(error) {
    row.error=error.message;
    if(!row.checks.some(c=>!c.passed))row.checks.push({label:'场景执行完成',passed:false,actual:error.message,expected:'无异常'});
  } finally {
    await runtime.stop();
    const runs=store.listRuns({limit:100}).items.map(run=>store.getRun(run.runId));
    row.evidence.runs=runs.map(run=>({...run,context:store.getRunContext(run.runId),events:store.events(run.runId)}));
    row.evidence.adoptions=simulation.list(null);
    row.evidence.operationalEvents=eventState();
    row.evidence.logisticsBatches=simulation.logistics.list();
    row.evidence.reviewJobs=reviews.jobs();
    row.evidence.reviewEvents=store.db.prepare('SELECT body FROM review_events ORDER BY seq').all().map(r=>JSON.parse(r.body));
    row.outcome={...row.outcome,taskStatus:task?.status??'未创建',done:task?.done??0,count:task?.count??0,receiptCount:row.evidence.receipts.length,taskStart:task?.start??null,taskEnd:task?.end??null,angles:Object.values(row.evidence.dispatchedJobs).map(job=>job.angle),logistics:batch?batchStageLabels[batch.stage]:task?downstream().label:'未创建收胶或运输计划',...(batch?{logisticsStage:batch.stage,netKg:batch.weighing?.netKg??null,receivedKg:batch.transport?.receipt?.receivedKg??null}: {})};
    row.modelRequests=configuredCalls;store.close();
  }
  return row;
}

export async function runAcceptance(ids=ACCEPTANCE_SCENARIOS.map(s=>s.id)) {
  assert.ok(ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>ACCEPTANCE_SCENARIOS.some(s=>s.id===id)),'场景编号无效或重复');
  const scenarios=[];
  for(const id of ids)scenarios.push(await runScenario(ACCEPTANCE_SCENARIOS.find(s=>s.id===id)));
  // Compare business outcomes, not deliberately unique run/evidence identifiers.
  const stable=scenarios.map(({id,passed,outcome,checks})=>({id,passed,outcome,checks:checks.map(({label,passed})=>({label,passed}))}));
  return {version:'1',clock:FIXED_TIME,passed:scenarios.every(s=>s.passed),modelRequests:scenarios.reduce((sum,s)=>sum+s.modelRequests,0),repeatabilityDigest:digest(stable),scenarios};
}
