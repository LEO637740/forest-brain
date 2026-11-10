import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateParkPlan} from '../src/park-plan.js';
import {makeParkContext,DEMO_EXCEPTION_CASES} from '../src/adapters/park-demo.js';
import {assembleParkEconomicInputs} from '../src/park-economic-inputs.js';
import {modelProposal} from './helpers/park-plan-model.js';

const NOW=new Date('2026-10-26T21:00:00Z'); // 10/27 05:00 Beijing, before the work window.
const SITE='demo-xsbn';
const dayDate=day=>new Date(+NOW+8*3600000+day*86400000).toISOString().slice(0,10);
const hourAt=(day,hour)=>new Date(`${dayDate(day)}T${String(hour).padStart(2,'0')}:00:00+08:00`).toISOString();

function weather(suitability='suitable') {
  return {siteId:SITE,provider:'Open-Meteo',status:'available',stale:false,fetchedAt:NOW.toISOString(),
    validUntil:new Date(+NOW+7200000).toISOString(),decisionFingerprint:`economics-${suitability}`,
    windows:Array.from({length:7},(_,day)=>Array.from({length:6},(_,hour)=>({
      start:hourAt(day,6+hour),end:hourAt(day,7+hour),suitability,
      rainfallMm:suitability==='suitable'?0:3,rainProbabilityPct:suitability==='suitable'?10:90,
      reason:suitability,
    }))).flat()};
}

function parkInput(overrides={}) {
  const context=makeParkContext({siteId:SITE,now:NOW});
  context.modules.market.demand.value=100;
  context.modules.market.prices.forEach(row=>{row.value=15;});
  return {siteId:SITE,now:NOW,context,
    inventory:{stockKg:300,heldKg:0,availableKg:300,mode:'simulation'},storageKg:900,
    plannedSalesKg:0,events:[],salesSource:'模拟出货账本',liveWeather:weather(),...overrides};
}

const confirmed=value=>({value,mode:'operator_confirmed',sourceLabel:'测试园区已核对记录',observedAt:NOW.toISOString()});
function publicSources(changeRatio=0.02) {
  const common={provider:'上海期货交易所',sourceUrl:'https://official.example/quotation',
    retrievedAt:new Date(+NOW-1800000).toISOString(),validUntil:new Date(+NOW+86400000).toISOString(),stale:false,status:'available'};
  return [
    {...common,id:'market',snapshotId:`market-${changeRatio}`,data:{priceType:'futures',currency:'CNY',priceUnit:'CNY/tonne',
      tradeDate:'2026-10-26',contracts:[{contract:'RU2701',settlementCnyPerTonne:20000*(1+changeRatio),
        previousSettlementCnyPerTonne:20000,volumeLots:100,openInterestLots:80}]}},
    {...common,id:'monthly_report',snapshotId:'spot-october',provider:'农业农村部农垦局',data:{publishedAt:'2026-10-15T02:50:00Z',
      metrics:[{name:'云南鲜胶乳折干胶月均价',value:17333,unit:'CNY/tonne_dry_rubber',scope:'云南产区监测点',period:'2026-09'}]}},
  ];
}
function calculate({park={},settings={},sources=publicSources(),proposal=modelProposal(3)}={}) {
  const input=parkInput(park);
  const economicInputs=assembleParkEconomicInputs({...input,sources,settings});
  return calculateParkPlan({...input,economicInputs,modelProposal:proposal});
}

test('only the model chooses business frequency; source price moves remain facts rather than a hidden vote',()=>{
  const input=parkInput(),economicInputs=assembleParkEconomicInputs({...input,sources:publicSources(),settings:{}});
  const one=calculateParkPlan({...input,economicInputs,modelProposal:modelProposal(1)});
  const three=calculateParkPlan({...input,economicInputs,modelProposal:modelProposal(3)});
  assert.equal(one.frequencyPerWeek,1);assert.equal(three.frequencyPerWeek,3);
  assert.deepEqual(one.economics.inputs,three.economics.inputs);
  assert.ok(three.production.expectedDryKg>one.production.expectedDryKg);
  const falling=calculate({sources:publicSources(-0.2)});
  assert.equal(falling.frequencyPerWeek,3,'a price threshold must not silently veto the model choice');
  assert.equal(three.economics.priceCnyPerKg,17.333,'futures settlement is not the park selling price');
  assert.equal(falling.economics.priceCnyPerKg,17.333);
  assert.ok(three.economics.inputs.some(row=>row.key==='price_trend'&&row.mode==='public_reference'));
  assert.ok(three.signals.every(row=>row.score===0&&['health','weather','device','care','capacity'].includes(row.source)));
});

test('cost and demand affect input arithmetic but cannot replace the model business decision with an economic rule',()=>{
  const loss=calculate({settings:{cost:confirmed(100),demand:confirmed(0)}});
  assert.equal(loss.frequencyPerWeek,3);
  assert.ok(loss.economics.contributionPerTapping<0);
  assert.equal(loss.economics.costPerTapping,100);
  assert.equal(loss.economics.inputs.find(row=>row.key==='demand').value,0);
  const pause=calculate({settings:{cost:confirmed(100),demand:confirmed(0)},proposal:modelProposal(0)});
  assert.equal(pause.frequencyPerWeek,0);assert.equal(pause.production.expectedDryKg,0);
  assert.ok(pause.zones.every(zone=>zone.dates.length===0));
  assert.deepEqual(loss.economics.inputs,pause.economics.inputs,'the difference comes from model advice, not different data');
});

test('recorded sale price and dry yield participate in contribution and production without a hidden profit threshold',()=>{
  const profitable=calculate({settings:{price:confirmed(20),cost:confirmed(2),yield:confirmed(0.3)}});
  const lowPrice=calculate({settings:{price:confirmed(5),cost:confirmed(2),yield:confirmed(0.3)}});
  const lowYield=calculate({settings:{price:confirmed(20),cost:confirmed(2),yield:confirmed(0.05)}});
  assert.equal(profitable.economics.contributionPerTapping,4);
  assert.equal(lowPrice.economics.contributionPerTapping,-0.5);
  assert.equal(lowYield.economics.contributionPerTapping,-1);
  assert.equal(profitable.frequencyPerWeek,3);assert.equal(lowPrice.frequencyPerWeek,3);assert.equal(lowYield.frequencyPerWeek,3);
  const measured=calculate({settings:{yield:confirmed(0.4)}});
  assert.equal(measured.production.dryKgPerTapping,0.4);
  assert.equal(measured.production.expectedDryKg,
    Math.round(measured.zones.reduce((sum,zone)=>sum+zone.eligibleTrees*zone.frequency*0.4,0)*10)/10);
});

test('recorded or assumed small orders remain source-labelled facts and do not impose a fixed order-size frequency rule',()=>{
  const park={inventory:{stockKg:0,heldKg:0,availableKg:0,mode:'simulation'}};
  const small=calculate({park,settings:{demand:confirmed(1)}});
  assert.equal(small.frequencyPerWeek,3,'the model may explicitly choose to build stock beyond the current order book');
  const assumed=calculate({park,settings:{demand:{...confirmed(1),mode:'assumption',sourceLabel:'人工假设'}}});
  const evidence=assumed.economics.inputs.find(row=>row.key==='demand');
  assert.equal(evidence.mode,'assumption');assert.match(evidence.label,/假设订单/);
  assert.doesNotMatch(evidence.label,/确认|填报/);
  assert.match(assumed.economics.demandBasis,/假设订单/);
});

test('different per-zone model choices are preserved under identical feasible conditions',()=>{
  const proposal=modelProposal(3);
  proposal.zones.forEach((zone,index)=>{zone.frequencyPerWeek=index;zone.reason=`模型为${zone.zone}区选择${index}次`;});
  const plan=calculate({proposal});
  assert.deepEqual(plan.zones.map(zone=>zone.frequency),[0,1,2,3]);
  assert.deepEqual(plan.modelProposal,proposal);
  assert.ok(plan.economics.decisionReasons.some(reason=>reason.includes('模型为D区选择3次')));
});

test('hard weather windows preserve model suggestions for other zones when one zone only has one usable day',()=>{
  const context=parkInput().context;
  // Additional resting trees stay excluded; the smaller A/B/C zones fit 90-minute windows.
  for(const tree of context.modules.trees.filter(tree=>{
    const index=Number(tree.treeId.slice(2))-1;
    return index>=50&&index<60||index>=100&&index<110;
  }))tree.tappingStatus='resting';
  const limited=weather();
  limited.windows=Array.from({length:7},(_,day)=>({start:hourAt(day,6),
    end:day===0?hourAt(day,12):new Date(Date.parse(hourAt(day,7))+30*60000).toISOString(),
    suitability:'suitable',rainfallMm:0,rainProbabilityPct:10,reason:'suitable'}));
  const plan=calculate({park:{context,liveWeather:limited,inventory:{stockKg:0,heldKg:0,availableKg:0,mode:'simulation'}},
    settings:{demand:confirmed(100)}});
  assert.equal(plan.zones.find(zone=>zone.zone==='D').frequency,1);
  assert.equal(plan.frequencyPerWeek,3);
  assert.ok(plan.production.expectedDryKg>=100,'a short D-zone window must not lower other zones business frequency');
  assert.ok(plan.zones.filter(zone=>zone.zone!=='D').every(zone=>zone.frequency===3));
});

test('actual free storage caps production and planned departures do not pre-release warehouse space',()=>{
  const almostFull={stockKg:880,heldKg:0,availableKg:880,mode:'simulation'};
  const constrained=calculate({park:{inventory:almostFull,plannedSalesKg:200}});
  assert.equal(constrained.frequencyPerWeek,0);
  assert.ok(constrained.inventory.stockKg+constrained.production.expectedDryKg<=constrained.inventory.storageKg);
  const full=calculate({park:{inventory:{stockKg:900,heldKg:0,availableKg:900,mode:'simulation'},plannedSalesKg:400}});
  assert.equal(full.frequencyPerWeek,0,'an unexecuted shipment does not make room for a new cut');
  const afterDispatch=calculate({park:{inventory:{stockKg:700,heldKg:0,availableKg:700,mode:'simulation'}}});
  assert.ok(afterDispatch.frequencyPerWeek>full.frequencyPerWeek,'a stock reduction after dispatch can restore production');
  assert.ok(afterDispatch.inventory.stockKg+afterDispatch.production.expectedDryKg<=afterDispatch.inventory.storageKg);
  const oneRound=calculate({park:{inventory:{stockKg:820,heldKg:0,availableKg:820,mode:'simulation'}}});
  assert.equal(oneRound.frequencyPerWeek,1,'80 kg of headroom allows one 57.3 kg whole-park round');
  assert.ok(oneRound.inventory.overflowKg===0);
});

test('operator inventory takes precedence and does not combine a physical count with simulated shipments',()=>{
  const settings={inventory:{stockKg:895,heldKg:50,storageKg:900,mode:'operator_confirmed',
    sourceLabel:'测试仓库盘点',observedAt:NOW.toISOString()}};
  const plan=calculate({park:{plannedSalesKg:500},settings});
  assert.equal(plan.inventory.stockKg,895);
  assert.equal(plan.inventory.availableKg,845);
  assert.equal(plan.inventory.plannedSalesKg,0);
  assert.equal(plan.frequencyPerWeek,0);
  assert.match(plan.economics.inputs.find(row=>row.key==='stock').sourceLabel,/测试仓库盘点/);
  assert.equal(plan.modelProposal.zones[0].frequencyPerWeek,3);
  assert.ok(plan.constraintAdjustments.some(row=>row.kind==='capacity'));
});

test('model advice never overrides rain, device faults, tree findings or the care limit',()=>{
  const context=parkInput().context;context.modules.market.demand.value=130;
  const settings={price:confirmed(30),cost:confirmed(1)};
  const clear=calculate({park:{context},settings,proposal:modelProposal(5)});
  const rainy=calculate({park:{context,liveWeather:weather('defer')},settings});
  assert.equal(clear.frequencyPerWeek,3);
  assert.ok(clear.constraintAdjustments.some(row=>row.kind==='care'));
  assert.equal(clear.modelProposal.zones[0].frequencyPerWeek,5);
  assert.equal(rainy.frequencyPerWeek,0);
  assert.equal(rainy.production.expectedDryKg,0);
  assert.ok(rainy.zones.every(zone=>zone.schedule.length===0));
  const fault=calculate({park:{context,events:[{kind:'device_fault',zone:2,status:'active',note:'测试设备故障'}]},settings});
  assert.equal(fault.zones.find(zone=>zone.zone==='C').frequency,0);
  assert.ok(fault.zones.every(zone=>zone.frequency<=3));
  assert.equal(clear.readiness.readyCount,191);
  assert.deepEqual(clear.readiness.reviewTrees.map(tree=>tree.treeId),DEMO_EXCEPTION_CASES.map(tree=>tree.treeId));
  const excluded=new Set(clear.readiness.reviewTrees.map(tree=>tree.treeIndex));
  assert.ok(clear.zones.every(zone=>zone.treeIndices.every(index=>!excluded.has(index))));
});

test('economic scenarios stay hypothetical and do not overwrite the public and operator input evidence',()=>{
  const input=parkInput();
  const economicInputs=assembleParkEconomicInputs({...input,sources:publicSources(),settings:{cost:confirmed(2)}});
  const original=structuredClone(economicInputs);
  const proposal=modelProposal(3),proposalBefore=structuredClone(proposal);
  const baseline=calculateParkPlan({...input,economicInputs,modelProposal:proposal});
  const storm=calculateParkPlan({...input,economicInputs,modelProposal:proposal,economicScenarioId:'typhoon'});
  assert.deepEqual(economicInputs,original);
  assert.equal(original.priceBasis.mode,'public_reference');
  assert.equal(original.inputs.find(row=>row.key==='cost').mode,'operator_confirmed');
  assert.equal(original.inputs.find(row=>row.key==='yield').mode,'simulated');
  assert.equal(original.inputs.find(row=>row.key==='demand').mode,'simulated');
  assert.deepEqual(baseline.economics.inputs,original.inputs);
  assert.deepEqual(storm.economics.inputs,original.inputs);
  assert.ok(storm.economics.decisionReasons.length>0);
  assert.equal(storm.economicImpact.mode,'simulation');
  assert.equal(storm.frequencyPerWeek,3,'only actual weather/capacity limits constrain a model-proposed three rounds');
  assert.deepEqual(proposal,proposalBefore);
  assert.deepEqual(storm.outlook.slice(1,4).map(day=>day.tappable),[false,false,false]);
  assert.ok(storm.zones.every(zone=>zone.dates.every(date=>!storm.outlook.slice(1,4).some(day=>day.date===date))));
  assert.ok(storm.production.expectedDryKg<baseline.production.expectedDryKg);
  assert.ok(storm.signals.every(row=>row.score===0&&['health','weather','device','care','capacity'].includes(row.source)));
});


test('the pure scheduler cannot synthesize a rule proposal when no model result is supplied',()=>{
  assert.throws(()=>calculateParkPlan(parkInput()),error=>error.code==='PLAN_MODEL_REQUIRED');
  assert.throws(()=>calculateParkPlan({...parkInput(),modelProposal:{mode:'rules'}}),error=>error.code==='PLAN_MODEL_REQUIRED');
});
