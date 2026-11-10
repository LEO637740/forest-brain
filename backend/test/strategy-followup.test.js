import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoContext } from '../src/adapters/context.js';
import { makeIndustryContext } from '../src/adapters/public-context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { checkCandidate, checkContext } from '../src/validation.js';

const now = new Date('2026-10-02T02:00:00Z');
const request = (c,kind) => ({kind,siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version},executionMode:'simulation'});
function industry() {
  const service = {status:() => ({location:{confirmed:false},sources:[
    {id:'weather',title:'参考点天气',snapshotId:'weather-followup',sourceUrl:'https://weather.example/',retrievedAt:now.toISOString(),validUntil:'2026-10-02T04:00:00Z',data:{location:{name:'海口参考点',confirmed:false},forecast:[{validFrom:'2026-10-02T03:00:00Z',validTo:'2026-10-02T04:00:00Z',rainfallMm:0.1,rainProbabilityPct:10}]}},
    {id:'market',title:'期货',snapshotId:'market-followup',sourceUrl:'https://market.example/',retrievedAt:now.toISOString(),validUntil:'2026-10-10T00:00:00Z',data:{tradeDate:'2026-09-30',contracts:[{contract:'RU2701',closeCnyPerTonne:20095,settlementCnyPerTonne:19710}]}}
  ]})};
  const c = makeIndustryContext({service,now,supplementSimulated:true});
  const stock = c.modules.industry.records.find(r=>r.topic==='inventory').observationId;
  const p = {summary:'模拟企业库存需人工复核',reasons:[{text:'依据模拟库存记录',sourceRefs:[stock]}],evidenceRefs:[stock,'weather-followup','market-followup'],proposal:{horizon:{start:now.toISOString(),end:'2026-10-03T02:00:00Z'},findings:[{topic:'inventory',assessment:'企业可用库存合计200kg',sourceRefs:[stock],limitation:'模拟记录'}],recommendations:[{priority:'medium',action:'复核库存记录',reason:'基于模拟库存，不执行发货',sourceRefs:[stock]}],missingData:c.modules.industry.gaps,uncertainty:'模拟情景，需复核',reviewRequired:true}};
  return {c,p,stock};
}
function rejects(p,c,part) { assert.throws(()=>checkCandidate('industry_brief',p,c,now),e=>e.code==='CANDIDATE_REJECTED'&&(!part||e.details.some(text=>text.includes(part)))); }

test('followup: stock numbers must cite the actual inventory source in the same output block',()=>{
  const {c,p}=industry();assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
  for (const field of ['finding','reason','summary']) {
    const bad=structuredClone(p);
    if(field==='finding'){bad.proposal.findings[0].sourceRefs=['weather-followup'];bad.proposal.findings[0].limitation='区域天气';}
    if(field==='reason')bad.reasons=[{text:'企业可用库存200kg',sourceRefs:['weather-followup']}];
    if(field==='summary'){bad.summary='模拟：企业可用库存200kg';bad.evidenceRefs=['weather-followup'];}
    rejects(bad,c,'库存数量断言必须');
  }
});
test('followup: inventory references select one snapshot; ambiguous snapshots and nonexistent batch prefixes are rejected',()=>{
  const {c,p,stock}=industry(),original=c.modules.industry.records.find(r=>r.observationId===stock);
  c.modules.industry.records.push({...original,observationId:'second-stock'});
  assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
  const ambiguous=structuredClone(p);ambiguous.proposal.findings[0].sourceRefs.push('second-stock');rejects(ambiguous,c,'多份库存');
  const nonexistent=structuredClone(p);nonexistent.proposal.findings[0].assessment='SIM-B010可用库存200kg';rejects(nonexistent,c,'不存在的批次');
});
test('followup: stock thousand separators, kg/tonnes and batch continuity remain correctly checked',()=>{
  const {c,p}=industry();
  for(const assessment of ['SIM-B02在库400kg，可用库存0kg；企业可用库存合计0.2吨。','SIM-B01在库0.4 tonnes，可用库存200kg。','企业可用库存并非400kg；企业可用库存合计200kg。','不能称为可用库存400kg。']){
    const good=structuredClone(p);good.proposal.findings[0].assessment=assessment;assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now));
  }
  for(const assessment of ['企业可用库存1,200kg','SIM-B02在库400kg，可用库存200kg','企业可用库存0.4吨']){
    const bad=structuredClone(p);bad.proposal.findings[0].assessment=assessment;rejects(bad,c,'数量与输入不符');
  }
});
test('followup: explicit limitations do not trigger positive weather/soil/market-claim guards',()=>{
  const {c,p}=industry();
  for(const text of ['不能说参考点预报未来24小时无雨。','参考点预报有非零降雨，不能概括为未来24小时无雨。','不能判断土壤水分充足。','不能声称当前处于高温高湿季节。','不能写08:00-10:00 UTC+8有雨，应复制完整来源时间。','不能概括近月合约价格区间。','不能将9月预计上涨当作当前判断。']){
    const good=structuredClone(p);good.summary='模拟：'+text;assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now),text);
  }
  for(const text of ['参考点预报未来24小时无雨。','土壤水分充足。','当前处于高温高湿季节。','参考点08:00-10:00 UTC+8有雨。','近月合约价格在19000元/吨区间。','9月预计上涨。']){
    const bad=structuredClone(p);bad.summary='模拟：'+text;rejects(bad,c);
  }
});
test('followup: unrelated negation or question cannot authorize a positive main-contract or site-operation claim',()=>{
  const {c,p}=industry();
  for(const text of ['RU2701不是现货而是主力合约。','是否已经核实无关，建议暂停割胶作业。']){
    const bad=structuredClone(p);bad.summary='模拟：'+text;rejects(bad,c);
  }
  for(const text of ['不能判断RU2701是否为主力合约。','先核实园区位置后再评估是否适合割胶。']){
    const good=structuredClone(p);good.summary='模拟：'+text;assert.doesNotThrow(()=>checkCandidate('industry_brief',good,c,now));
  }
});
test('followup: missing forecast rain is not zero, while an explicit uncertainty remains valid',()=>{
  const {c,p}=industry(),record=c.modules.industry.records.find(r=>r.topic==='weather');
  const data=JSON.parse(record.content);data.forecast[0].rainfallMm=null;record.content=JSON.stringify(data);
  p.summary='模拟：参考点未来24小时无雨。';rejects(p,c,'缺失雨量');
  p.summary='模拟：部分时段缺数据，无法确认未来24小时无雨。';assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));
});
test('followup: future industry retrieval timestamps and ambiguous forecast windows require corrected inputs',()=>{
  const {c}=industry();assert.equal(checkContext(request(c,'industry_brief'),c,now).missing.length,0);
  c.modules.industry.records[0].retrievedAt='2026-10-03T02:00:00Z';
  assert.ok(checkContext(request(c,'industry_brief'),c,now).missing.some(m=>m.field==='retrievedAt'));
  const w=makeDemoContext({now});assert.equal(checkContext(request(w,'weather_window'),w,now).missing.length,0);
  w.modules.weather.forecast.steps.push({...w.modules.weather.forecast.steps[0],rainfallMm:99});
  assert.ok(checkContext(request(w,'weather_window'),w,now).missing.some(m=>m.reason.includes('同一预报窗口重复')));
});
test('followup: one-cent and 0.01kg arithmetic errors fail, and conflicting same-time spot prices are not arbitrarily selected',async()=>{
  const c=makeDemoContext({now}),p=await new RuleGenerator().generate({kind:'market_scenario',context:c,now});
  assert.doesNotThrow(()=>checkCandidate('market_scenario',p,c,now));
  for(const field of ['expectedDryRubberKg','estimatedContributionCny']){
    const bad=structuredClone(p);bad.proposal.scenarios[0][field]+=0.01;
    assert.throws(()=>checkCandidate('market_scenario',bad,c,now),e=>e.code==='CANDIDATE_REJECTED');
  }
  c.modules.market.prices.push({...c.modules.market.prices.at(-1),observationId:'conflicting-price',value:1000});
  assert.ok(checkContext(request(c,'market_scenario'),c,now).missing.some(m=>m.reason.includes('现货价存在冲突')));
});
