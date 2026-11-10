import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { makeIndustryContext } from '../src/adapters/public-context.js';
import { normalizeZhejiangRubber } from '../src/adapters/public-data.js';
import { projectContext, checkCandidate } from '../src/validation.js';

const NOW=new Date('2026-10-07T02:00:00Z');
const status=()=>({location:{confirmed:false},sources:[{id:'production_hainan',title:'海南历史产量夹具',snapshotId:'hainan-fixture',sourceUrl:'https://stats.example/fixture',
  retrievedAt:NOW.toISOString(),validUntil:'2027-01-01T00:00:00Z',data:{period:'2025',scope:'海南',metrics:[{value:34.95,unit:'万吨'}]}}]});
const empty={status:()=>({location:{confirmed:false},sources:[]})};
const request=(context,id,generatorMode='demo_rules')=>({requestId:id,kind:'industry_brief',generatorMode,siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,
  inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'});
async function setup(options={}){
  const app=createApp({dbPath:':memory:',clock:()=>NOW,...options});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  return {app,async call(path,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,value:await response.json()};}};
}

test('industry rules: all source scopes and periods, simulated limits and exact missing-data list remain independently valid',async()=>{
  for(const dataMode of ['demo','mixed_demo','public']){
    const context=projectContext(makeIndustryContext({service:{status},now:NOW,dataMode}),'industry_brief');
    const candidate=await new RuleGenerator().generate({kind:'industry_brief',context,now:NOW});
    assert.doesNotThrow(()=>checkCandidate('industry_brief',candidate,context,NOW));
    assert.deepEqual(candidate.proposal.missingData,context.modules.industry.gaps);assert.equal(candidate.proposal.reviewRequired,true);
    for(const finding of candidate.proposal.findings){const source=context.modules.industry.records.find(record=>record.observationId===finding.sourceRefs[0]);assert.ok(source);
      assert.ok(finding.assessment.includes(source.scope));assert.ok(finding.assessment.includes(source.period));
      if(source.provenance.mode==='simulated')assert.ok(finding.limitation.includes('模拟'));
    }
    assert.ok(candidate.proposal.uncertainty.includes('不是大模型'));
    if(dataMode==='demo'){
      assert.ok(context.modules.industry.records.every(record=>record.provenance.mode==='simulated'));assert.equal(context.dataPolicy.mode,'demo');
      assert.ok(!context.modules.industry.records.some(record=>['commodity_reference','zhejiang_rubber'].includes(record.topic)));
    }
  }
});

test('industry rules: nine public sources retain rubber documents and business advice within the twelve-item limit',async()=>{
  const now=new Date('2026-10-21T02:00:00Z');
  const ids=['weather','market','warehouse','bulletin','monthly_report','production_national','production_hainan','pest_updates','zhejiang_rubber'];
  const news=normalizeZhejiangRubber({code:200,data:{newsTotal:'浙江大宗首笔橡胶现货标准仓单质押融资落地',releaseTime:'2026年10月12日',
    digest:'10月10日，宁波铜岸以60吨越南3L混合橡胶办理橡胶现货标准仓单质押融资。',newsInfo:'https://mp.weixin.qq.com/s/4VQ6EKVk1cKtVtZbq60l6A'}});
  const service={status:()=>({location:{confirmed:false},sources:ids.map(id=>({id,title:`${id}夹具`,snapshotId:`fixture-${id}`,sourceUrl:`https://source.example/${id}`,
    retrievedAt:now.toISOString(),validUntil:'2027-01-01T00:00:00Z',data:id==='zhejiang_rubber'?news:{scope:'测试资料范围',period:'2025',...(id==='weather'?{location:{name:'参考地点',confirmed:false},forecast:[]}:{})}}))})};
  const context=projectContext(makeIndustryContext({service,now,dataMode:'mixed_demo'}),'industry_brief');
  const candidate=await new RuleGenerator().generate({kind:'industry_brief',context,now});
  assert.equal(context.modules.industry.records.length,14);
  assert.equal(candidate.proposal.recommendations.length,12);assert.equal(candidate.proposal.findings.length,12);
  assert.doesNotThrow(()=>checkCandidate('industry_brief',candidate,context,now));
  for(const [topic,words] of [['processing','质检'],['inventory','质检冻结'],['transport','订单交期'],['production_sales','计量单位']]){
    const record=context.modules.industry.records.find(item=>item.topic===topic);
    const advice=candidate.proposal.recommendations.find(item=>item.sourceRefs.includes(record.observationId));
    assert.ok(advice);assert.ok(advice.action.includes(words));assert.ok(advice.reason.includes('模拟'));
  }
  for(const [topic,words] of [['commodity_reference','胶种牌号'],['zhejiang_rubber','现货仓单']]){
    const record=context.modules.industry.records.find(item=>item.topic===topic);
    assert.equal(record.provenance.mode,'measured');
    assert.ok(candidate.proposal.findings.some(item=>item.sourceRefs.includes(record.observationId)));
    const advice=candidate.proposal.recommendations.find(item=>item.sourceRefs.includes(record.observationId));
    assert.ok(advice.action.includes(words));
    if(topic==='commodity_reference'){
      assert.equal(JSON.parse(record.content).rubber.listing,'原有品种');
      assert.match(advice.action,/质检.*交收/);
    } else {
      assert.match(record.content,/60吨越南3L混合橡胶/);
      assert.match(advice.reason,/融资额度不是橡胶价格/);
    }
  }
  const publicContext=makeIndustryContext({service,now,dataMode:'public'});
  assert.ok(publicContext.modules.industry.records.some(record=>record.topic==='commodity_reference'));
  assert.ok(publicContext.modules.industry.records.some(record=>record.topic==='zhejiang_rubber'));
  const demo=makeIndustryContext({service,now,dataMode:'demo'});
  assert.ok(demo.modules.industry.records.every(record=>record.provenance.mode==='simulated'));
  assert.ok(!demo.modules.industry.records.some(record=>['commodity_reference','zhejiang_rubber'].includes(record.topic)));
});

test('industry contexts: offline demo/mixed preparation and rules use no refresh or model; public unavailable remains explicit',async()=>{
  const f=await setup();try{
    f.app.store.setModelPaused(true,NOW.toISOString());
    for(const dataMode of ['demo','mixed_demo']){
      const prepared=await f.call('/api/sources/industry-context',{dataMode});assert.equal(prepared.status,201);
      const context=f.app.store.getContext(prepared.value.inputSnapshot.snapshotId,1);assert.equal(context.dataPolicy.mode,dataMode);
      const submitted=await f.call('/internal/harness/runs',{...prepared.value,requestId:`offline-${dataMode}`,kind:'industry_brief',generatorMode:'demo_rules'});
      assert.equal(submitted.status,202);await f.app.runtime.idle();
      const result=(await f.call(`/internal/harness/runs/${submitted.value.runId}`)).value;
      assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.strategy.provenance.mode,'simulated');assert.equal(result.strategy.dataPolicy.mode,dataMode);
      assert.deepEqual(result.strategy.proposal.missingData,context.modules.industry.gaps);
      assert.ok(!f.app.store.events(submitted.value.runId).some(event=>event.stage==='llm_request'));
    }
    assert.equal((await f.call('/api/sources/industry-context',{dataMode:'public'})).status,503);
  }finally{await f.app.close();}
});

test('industry context preparation is cached-only and demo cannot inherit cached real sources',async()=>{
  let reads=0,refreshes=0;const service={status(){reads++;return status();},async refresh(){refreshes++;}};
  const f=await setup({publicDataService:service});try{
    const demo=await f.call('/api/sources/industry-context',{dataMode:'demo'});assert.equal(demo.status,201);assert.equal(reads,0);
    const mixed=await f.call('/api/sources/industry-context',{dataMode:'mixed_demo'});assert.equal(mixed.status,201);assert.equal(reads,1);assert.equal(refreshes,0);
    const context=f.app.store.getContext(mixed.value.inputSnapshot.snapshotId,1);assert.ok(context.modules.industry.records.some(record=>record.observationId==='hainan-fixture'));
  }finally{await f.app.close();}
});

test('run filters: paginate within kind/mode/generator, keep latest failure and queued records, exclude public and other modes',async()=>{
  const f=await setup();f.app.runtime.stopping=true;
  try{
    const demo=makeIndustryContext({service:empty,now:NOW,dataMode:'demo'}),mixed=makeIndustryContext({service:empty,now:NOW,dataMode:'mixed_demo'}),publicContext=makeIndustryContext({service:{status},now:NOW,dataMode:'public'});
    for(const context of [demo,mixed,publicContext])f.app.store.saveContext(context);
    const old=f.app.store.submit(request(demo,'old-configured','configured'),NOW.toISOString()).run;
    f.app.store.submit(request(mixed,'mixed-configured','configured'),NOW.toISOString());
    f.app.store.submit(request(publicContext,'public-configured','configured'),NOW.toISOString());
    const latest=f.app.store.submit(request(demo,'new-configured','configured'),NOW.toISOString()).run;
    f.app.store.finish(latest.runId,{runId:latest.runId,requestId:latest.requestId,status:'failed',updatedAt:NOW.toISOString(),error:{code:'OFFLINE_FIXTURE',message:'offline fixture failure',retryable:false}});
    f.app.store.submit(request(demo,'newer-rule','demo_rules'),NOW.toISOString());
    const query='/internal/harness/runs?kind=industry_brief&dataMode=demo&generatorMode=configured&limit=1';
    const first=(await f.call(query)).value;assert.equal(first.items[0].runId,latest.runId);assert.equal(first.items[0].status,'failed');assert.equal(first.items[0].generatorMode,'configured');assert.ok(first.nextCursor);
    const next=(await f.call(`${query}&cursor=${first.nextCursor}`)).value;assert.equal(next.items[0].runId,old.runId);assert.equal(next.items[0].status,'queued');assert.equal(next.nextCursor,null);
    const other=(await f.call('/internal/harness/runs?kind=industry_brief&dataMode=mixed_demo')).value;assert.equal(other.items.length,1);assert.equal(other.items[0].requestId,'mixed-configured');
    const all=(await f.call('/internal/harness/runs')).value;assert.equal(all.items.length,5);
    for(const bad of ['kind=made_up','dataMode=public','generatorMode=unknown'])assert.equal((await f.call('/internal/harness/runs?'+bad)).status,400);
  }finally{await f.app.close();}
});
