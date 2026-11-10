import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMixedContext, makePublicContext, makeIndustryContext } from '../src/adapters/public-context.js';
import { makeBusinessDemo } from '../src/adapters/business-demo.js';
import { checkContext, checkCandidate } from '../src/validation.js';
import { createApp } from '../src/server.js';
const now=new Date('2026-10-01T08:00:00Z');
const ref=c=>({siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:1},executionMode:'simulation',kind:'weather_window',requestId:'mixed-test',generatorMode:'demo_rules'});
function fixture({confirmed=false,stale=false}={}) {
  const forecast=[{validFrom:'2026-10-01T09:00:00Z',validTo:'2026-10-01T10:00:00Z',rainfallMm:1,rainProbabilityPct:80}];
  const status={location:{confirmed,siteId:'demo-hainan'},sources:[{id:'weather',title:'天气',snapshotId:'real-weather',retrievedAt:now.toISOString(),validUntil:'2026-10-01T10:00:00Z',sourceUrl:'https://weather.example/test',stale,data:{location:{name:'参考点'},period:'2026-10-01',forecast}},{id:'market',title:'行情',stale:true}]};
  return {status:()=>structuredClone(status)};
}
test('mixed tree inputs fill unavailable observations/costs, but unknown-site public forecast stays reference only',()=>{
  const service=fixture(),c=makeMixedContext({treeIds:['T-0012'],service,now});
  assert.equal(c.modules.weather.observed.provenance.mode,'simulated');assert.equal(c.modules.weather.forecast.provenance.mode,'simulated');
  assert.equal(c.modules.market.costAssumptions.provenance.mode,'simulated');assert.equal(c.dataPolicy.mode,'mixed_demo');
  assert.equal(c.sourceSnapshots.includes('real-weather'),false);assert.equal(checkContext(ref(c),c,now).missing.length,0);
  const strict=makePublicContext({treeIds:['T-0012'],service,now});assert.equal(strict.modules.weather.observed,null);assert.equal(strict.modules.market,undefined);assert.ok(checkContext(ref(strict),strict,now).missing.length);
});
test('matching confirmed site preserves real forecast; stale real forecast is replaced with explicitly simulated evidence',()=>{
  const real=makeMixedContext({treeIds:['T-0012'],service:fixture({confirmed:true}),now});
  assert.equal(real.modules.weather.forecast.forecastRunId,'real-weather');assert.equal(real.modules.weather.forecast.provenance.mode,'forecast');
  assert.equal(real.modules.weather.forecast.steps[0].rainfallMm,1);
  const stale=makeMixedContext({treeIds:['T-0012'],service:fixture({confirmed:true,stale:true}),now});assert.equal(stale.modules.weather.forecast.provenance.mode,'simulated');
});
test('partial public forecast keeps valid real hours without inventing values for the missing hours',()=>{
  const status=fixture({confirmed:true}).status(),weather=status.sources[0];
  weather.data.forecast.push({validFrom:'2026-10-01T10:00:00Z',validTo:'2026-10-01T11:00:00Z',rainfallMm:null,rainProbabilityPct:30});
  const service={status:()=>structuredClone(status)};
  const c=makeMixedContext({treeIds:['T-0012'],service,now});
  assert.equal(c.modules.weather.forecast.provenance.mode,'forecast');
  assert.deepEqual(c.modules.weather.forecast.steps,[weather.data.forecast[0]]);
  assert.ok(c.dataPolicy.notices.some(x=>x.includes('1 个未来时段')&&x.includes('未用模拟值')));
  assert.ok(!c.dataPolicy.substitutions.some(x=>x.sourceId==='demo-weather-service'));
  assert.equal(checkContext(ref(c),c,now).missing.length,0);
  const strict=makePublicContext({treeIds:['T-0012'],service,now});
  assert.equal(strict.modules.weather.forecast.steps[1].rainfallMm,null);
  assert.ok(checkContext(ref(strict),strict,now).missing.some(x=>x.field==='forecast.steps'));
  weather.data.forecast[0].rainfallMm=null;
  assert.equal(makeMixedContext({treeIds:['T-0012'],service,now}).modules.weather.forecast.provenance.mode,'simulated');
});
test('outage keeps unexpired real evidence and its original timestamp instead of simulating over it',()=>{
  const status=fixture({confirmed:true}).status();status.sources[0].lastError={code:'SOURCE_UNAVAILABLE',message:'offline'};
  const service={status:()=>structuredClone(status)},c=makeMixedContext({treeIds:['T-0012'],service,now});
  assert.equal(c.modules.weather.forecast.provenance.mode,'forecast');assert.equal(c.modules.weather.forecast.issuedAt,now.toISOString());
  assert.ok(c.dataPolicy.notices.some(x=>x.includes('最近更新失败')));
  const industry=makeIndustryContext({service,now,supplementSimulated:true});
  assert.equal(industry.modules.industry.records.find(x=>x.topic==='weather').observationId,'real-weather');
  assert.ok(industry.modules.industry.gaps.some(x=>x.includes('最近更新失败')));
});
test('source expiry is checked against context time even if a cached status claims it is fresh',()=>{
  for(const timestamp of ['2026-10-01T07:59:59Z',now.toISOString()]) {
    const status=fixture({confirmed:true}).status();status.sources[0].validUntil=timestamp;
    const service={status:()=>structuredClone(status)};
    assert.equal(makeMixedContext({treeIds:['T-0012'],service,now}).modules.weather.forecast.provenance.mode,'simulated');
    const strict=makePublicContext({treeIds:['T-0012'],service,now});assert.equal(strict.modules.weather.forecast,null);assert.deepEqual(strict.sourceSnapshots,[]);
    assert.ok(!makeIndustryContext({service,now}).modules.industry.records.some(x=>x.topic==='weather'));
    const mixed=makeIndustryContext({service,now,supplementSimulated:true});assert.equal(mixed.modules.industry.records.find(x=>x.topic==='weather').provenance.mode,'simulated');
  }
});
test('future retrieval timestamps do not establish usable public facts; real snapshot refs name only used sources',()=>{
  const status=fixture({confirmed:true}).status();status.sources.push({id:'production_hainan',snapshotId:'unused-production',data:{},stale:true});
  const service={status:()=>structuredClone(status)};
  assert.deepEqual(makePublicContext({treeIds:['T-0012'],service,now}).sourceSnapshots,['real-weather']);
  status.sources[0].retrievedAt='2026-10-01T09:00:00Z';
  assert.equal(makePublicContext({treeIds:['T-0012'],service,now}).modules.weather.forecast,null);
  assert.equal(makeMixedContext({treeIds:['T-0012'],service,now}).modules.weather.forecast.provenance.mode,'simulated');
  assert.ok(!makeIndustryContext({service,now}).modules.industry.records.some(x=>x.observationId==='real-weather'));
});
test('industry weather preserves nulls and reports incomplete hours instead of declaring full rainfall coverage',()=>{
  const status=fixture().status();status.sources[0].data.forecast[0].rainfallMm=null;
  const c=makeIndustryContext({service:{status:()=>status},now,supplementSimulated:true});
  const record=c.modules.industry.records.find(x=>x.topic==='weather'),data=JSON.parse(record.content);
  assert.equal(record.provenance.mode,'forecast');assert.equal(data.forecast[0].rainfallMm,null);
  assert.equal(data.forecastCoverage.returnedHours,1);assert.equal(data.forecastCoverage.completeHours,0);
  assert.deepEqual(data.forecastCoverage.missingHours,[{start:'2026-10-01T09:00:00Z',end:'2026-10-01T10:00:00Z'}]);
  assert.ok(c.modules.industry.gaps.some(x=>x.includes('空值不是零')));
});
test('business fixtures reconcile production, work-in-process, inventory, reservation and shipment',()=>{
  const rows=makeBusinessDemo(now);assert.equal(rows.length,4);assert.ok(rows.every(r=>r.provenance.mode==='simulated'&&r.title.includes('模拟')));
  const [production,processing,inventory,transport]=rows.map(r=>JSON.parse(r.content));
  assert.equal(processing.batches.reduce((sum,b)=>sum+b.quantityKg,0),production.productionKg);
  for(const i of inventory.items)assert.equal(i.availableKg+i.reservedKg+i.heldKg,i.onHandKg);
  for(const b of processing.batches.filter(b=>b.stage!=='drying'))assert.equal(b.quantityKg,inventory.items.filter(i=>i.batchId===b.batchId).reduce((s,i)=>s+i.onHandKg,0)+transport.shipments.filter(i=>i.batchId===b.batchId).reduce((s,i)=>s+i.quantityKg,0));
  assert.equal(production.orders[0].quantityKg,transport.shipments[0].quantityKg);
});
test('mixed industry retains real references and gaps, adds labeled fallback and rejects simulated facts presented as real',()=>{
  const c=makeIndustryContext({service:fixture(),now,supplementSimulated:true}),rows=c.modules.industry.records;
  assert.ok(rows.some(r=>r.observationId==='real-weather'&&r.provenance.mode==='forecast'));
  assert.ok(rows.some(r=>r.topic==='market'&&r.provenance.mode==='simulated'&&!r.sourceUrl.includes('shfe')));
  assert.equal(rows.length,7);assert.ok(rows.some(r=>r.topic==='commodity_reference'&&JSON.parse(r.content).listings[0].productCode==='WZX26063'));assert.equal(c.targetSnapshot.treeIds.length,0);assert.ok(c.modules.industry.gaps.some(g=>g.includes('真实业务接口')));
  const source=rows.find(r=>r.topic==='inventory').observationId;
  const p={summary:'模拟企业库存复核',reasons:[{text:'依据模拟库存',sourceRefs:[source]}],evidenceRefs:[source],proposal:{horizon:{start:now.toISOString(),end:'2026-10-02T08:00:00Z'},findings:[{topic:'inventory',assessment:'B02 待复核',sourceRefs:[source],limitation:'模拟记录'}],recommendations:[{priority:'high',action:'复核库存',reason:'模拟批次待确认',sourceRefs:[source]}],missingData:c.modules.industry.gaps,uncertainty:'演示情景',reviewRequired:true}};
  assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
  p.proposal.findings[0].limitation='实际记录';assert.throws(()=>checkCandidate('industry_brief',p,c,now),e=>e.code==='CANDIDATE_REJECTED');
  const strict=makeIndustryContext({service:fixture(),now});assert.ok(strict.modules.industry.records.every(r=>r.provenance.mode!=='simulated'));
});
test('industry inventory: reject the observed live-model confusion between on-hand and available stock',()=>{
  const c=makeIndustryContext({service:fixture(),now,supplementSimulated:true});
  const source=c.modules.industry.records.find(r=>r.topic==='inventory').observationId;
  const p={summary:'模拟企业可用库存合计200kg',reasons:[{text:'依据模拟库存',sourceRefs:[source]}],evidenceRefs:[source],proposal:{horizon:{start:now.toISOString(),end:'2026-10-02T08:00:00Z'},findings:[{topic:'inventory',assessment:'SIM-B01在库400kg，可用库存200kg；SIM-B02可用库存0kg。企业可用库存合计0.2吨。',sourceRefs:[source],limitation:'模拟记录'}],recommendations:[{priority:'high',action:'复核库存',reason:'模拟批次待确认',sourceRefs:[source]}],missingData:c.modules.industry.gaps,uncertainty:'演示情景',reviewRequired:true}};
  assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
  for(const text of ['模拟企业库存400kg可用','模拟场景下，企业可用库存400kg','模拟企业数据显示库存可用量400kg','模拟企业可用库存合计0.4吨']){
    const bad=structuredClone(p);bad.summary=text;
    assert.throws(()=>checkCandidate('industry_brief',bad,c,now),e=>e.code==='CANDIDATE_REJECTED'&&e.details.some(x=>x.includes('可用库存数量')));
  }
  const badReason=structuredClone(p);badReason.reasons[0].text='模拟企业可用库存400kg';assert.throws(()=>checkCandidate('industry_brief',badReason,c,now));
  const badBatch=structuredClone(p);badBatch.proposal.findings[0].assessment='SIM-B02 可用库存400kg';assert.throws(()=>checkCandidate('industry_brief',badBatch,c,now));
});
test('HTTP mixed mode persists data policy in strategy/export while default source API remains strict',async()=>{
  const a=createApp({dbPath:':memory:',clock:()=>now,publicDataService:fixture()});
  try {
    await new Promise((resolve,reject)=>{a.server.once('error',reject);a.server.listen(0,'127.0.0.1',resolve)});const url=`http://127.0.0.1:${a.server.address().port}`;
    const post=(path,data)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const snapshot=await (await post('/api/sources/contexts',{treeIds:['T-0012'],dataMode:'mixed_demo'})).json();
    const run=await (await post('/internal/harness/runs',{...snapshot,requestId:'mixed-http',kind:'weather_window',generatorMode:'demo_rules',asOf:undefined,targetCount:undefined})).json();
    await a.runtime.idle();const result=await (await fetch(`${url}/internal/harness/runs/${run.runId}/export`)).json();
    assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.strategy.dataPolicy.mode,'mixed_demo');assert.ok(result.strategy.summary.includes('模拟'));
    assert.ok(result.strategy.dataPolicy.substitutions.every(s=>['weather','knowledge'].includes(s.module)));
    const business=await (await fetch(url+'/api/demo/business-data')).json();assert.equal(business.records.length,4);assert.equal(business.mode,'simulated');
    const industry=await post('/api/sources/industry-context',{dataMode:'mixed_demo'});assert.equal(industry.status,201);
    const strict=await (await post('/api/sources/contexts',{treeIds:['T-0012']})).json();const stored=a.store.getContext(strict.inputSnapshot.snapshotId,1);assert.equal(stored.modules.weather.observed,null);
  } finally {await a.close();}
});
