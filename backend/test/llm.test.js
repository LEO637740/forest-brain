import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmGenerator, strictOutputSchema, candidateOutputSchema } from '../src/adapters/llm.js';
import { makeDemoContext } from '../src/adapters/context.js';
import { makeIndustryContext } from '../src/adapters/public-context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { checkCandidate, checkContext, projectContext } from '../src/validation.js';
import { candidateSchemas } from '../src/contracts.js';
import { decisionSupport } from '../src/adapters/decision-support.js';
const now=new Date('2026-10-01T08:00:00Z');
const result=content=>Response.json({id:'test-response',model:'mock-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:80}});
const llm=fetchImpl=>new LlmGenerator({baseUrl:'https://model.example/v1',apiKey:'test-only-not-a-real-key',model:'mock-model',fetchImpl});
test('LLM: structured tapping output fixes input facts and nesting while retaining independent candidate angle', async()=>{
  const context=projectContext(makeDemoContext({now,treeIds:['T-0001']}),'tapping_angle');
  const original=structuredClone(candidateSchemas.tapping_angle),schema=candidateOutputSchema('tapping_angle',context),p=schema.properties.proposal.properties;
  assert.deepEqual(candidateSchemas.tapping_angle,original);
  assert.deepEqual(p.previousPlannedCutSlopeDeg.enum,[context.modules.tapping.panels[0].plannedCutSlopeDeg]);
  assert.deepEqual(p.treeId.enum,['T-0001']);assert.ok(p.method);assert.equal(schema.properties.method,undefined);
  assert.equal(p.recommendedCutSlopeDeg.enum,undefined);assert.equal(p.recommendedCutSlopeDeg.minimum,context.constraints.minCutSlopeDeg);
  const candidate=await new RuleGenerator().generate({kind:'tapping_angle',context,now});let sent;
  const generator=new LlmGenerator({provider:'ollama',baseUrl:'http://127.0.0.1:11434/v1',apiKey:'local-no-key',model:'fixture',outputMode:'json_schema',fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return result(candidate);}});
  await generator.generate({kind:'tapping_angle',context,now,validateCandidate:c=>checkCandidate('tapping_angle',c,context,now)});
  assert.equal(sent.response_format.type,'json_schema');assert.equal(sent.temperature,0);
  assert.deepEqual(sent.response_format.json_schema.schema.properties.proposal.properties.previousPlannedCutSlopeDeg.enum,p.previousPlannedCutSlopeDeg.enum);
});
test('LLM: current humidity applicability changes at the demo threshold without prescribing a candidate angle',()=>{
  const context=structuredClone(projectContext(makeDemoContext({now,treeIds:['T-0001']}),'tapping_angle'));
  context.modules.weather.observed.relativeHumidityPct=72;
  const below=decisionSupport('tapping_angle',context,now).tappingFacts;
  assert.equal(below.humidityDemoThresholdReached,false);assert.equal(below.humidityComparison,'72% < 80%');
  assert.match(below.humidityRuleApplicability,/未达到/);
  context.modules.weather.observed.relativeHumidityPct=80;
  const reached=decisionSupport('tapping_angle',context,now).tappingFacts;
  assert.equal(reached.humidityDemoThresholdReached,true);assert.equal(reached.humidityComparison,'80% >= 80%');
  assert.equal(Object.hasOwn(reached,'recommendedCutSlopeDeg'),false);
});
test('LLM: projected evidence, JSON contract, exactly one repair, usage metadata, no secret in audit',async()=>{
  const context=projectContext(makeDemoContext({now}),'surface_action');const good=await new RuleGenerator().generate({kind:'surface_action',context,now});const bad=structuredClone(good);bad.evidenceRefs.push('fabricated-ref');
  const calls=[],events=[];const generator=llm(async(url,options)=>{calls.push(JSON.parse(options.body));return result(calls.length===1?bad:good)});
  const candidate=await generator.generate({kind:'surface_action',context,now,runId:'mock-run',validateCandidate:p=>checkCandidate('surface_action',p,context,now),onEvent:(stage,data)=>events.push({stage,data})});
  assert.deepEqual(candidate,good);assert.equal(calls.length,2);assert.deepEqual(Object.keys(JSON.parse(calls[0].messages[1].content).context.modules),['inspection','knowledge']);
  assert.equal(calls[0].response_format.type,'json_object');assert.equal(calls[1].messages.length,4);
  assert.equal(calls[0].messages[0].content.includes('growth_plan：'),false);
  assert.equal(JSON.parse(calls[0].messages[1].content).decisionSupport.surfaceGeometry[0].affectsCut,'yes');
  const refs=JSON.parse(calls[0].messages[1].content).allowedEvidenceRefs;
  assert.ok(refs.includes(context.modules.inspection.evidence[0].evidenceId));
  assert.equal(refs.includes(context.snapshotId),false);assert.equal(refs.includes(context.modules.inspection.evidence[0].provenance.sourceId),false);
  assert.equal(events.at(-1).data.attempts,2);assert.equal(events.at(-1).data.inputTokens,200);assert.equal(JSON.stringify(events).includes('test-only-not-a-real-key'),false);
});
test('LLM: repeated invalid JSON, HTTP errors, truncation and refusal never fall back to rules',async()=>{
  const context=projectContext(makeDemoContext({now}),'surface_action'),args={kind:'surface_action',context,now,runId:'mock'};
  let calls=0;await assert.rejects(llm(async()=>{calls++;return result({wrong:'shape'})}).generate(args),e=>e.code==='INVALID_CANDIDATE');assert.equal(calls,2);
  for(const [response,code] of [[new Response('private upstream details',{status:401}),'LLM_REQUEST_REJECTED'],[new Response('',{status:429}),'CANDIDATE_SERVICE_UNAVAILABLE'],[Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),'LLM_INCOMPLETE'],[Response.json({choices:[{finish_reason:'stop',message:{refusal:'refused'}}]}),'LLM_REFUSED']])await assert.rejects(llm(async()=>response).generate(args),e=>e.code===code&&!e.message.includes('private'));
});
test('LLM: weather time support excludes already started segments while preserving raw evidence and independent rain checks',async()=>{
  const context=structuredClone(projectContext(makeDemoContext({now}),'weather_window'));
  context.modules.weather.forecast.steps[1].rainfallMm=2;
  const later=new Date(+now+1),good=await new RuleGenerator().generate({kind:'weather_window',context,now:later});
  let input;const generator=llm(async(url,options)=>{input=JSON.parse(JSON.parse(options.body).messages[1].content);return result(good)});
  await generator.generate({kind:'weather_window',context,now:later,validateCandidate:p=>checkCandidate('weather_window',p,context,later)});
  assert.deepEqual(input.context.modules.weather.forecast.steps,context.modules.weather.forecast.steps);
  assert.ok(input.decisionSupport.eligibleForecastWindows.every(w=>Date.parse(w.start)>=+later));
  assert.equal(input.decisionSupport.eligibleForecastWindows[0].rainfallMm,2);
  const unsafe=structuredClone(good);unsafe.proposal.windows[0].suitability='suitable';
  assert.throws(()=>checkCandidate('weather_window',unsafe,context,later),e=>e.code==='CANDIDATE_REJECTED');
});
test('LLM: bounded input rejects before network; Responses structured output omits storage',async()=>{
  const context=projectContext(makeDemoContext({now}),'surface_action');const good=await new RuleGenerator().generate({kind:'surface_action',context,now});
  const small=llm(()=>{throw new Error('network should not run')});small.maxInputBytes=10;await assert.rejects(small.generate({kind:'surface_action',context,now}),e=>e.code==='LLM_INPUT_TOO_LARGE');
  let sent;const generator=new LlmGenerator({baseUrl:'https://api.openai.com/v1',apiKey:'mock',model:'mock-model',protocol:'responses',outputMode:'json_schema',fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(good)}]}]});}});
  assert.deepEqual(await generator.generate({kind:'surface_action',context,now}),good);assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(strictOutputSchema(candidateSchemas.industry_brief).properties.proposal.properties.reviewRequired.type,'boolean');
});
test('LLM: derived time and arithmetic support preserve snapshot milliseconds, tree citations and rain constraints',async()=>{
  const snapshotTime=new Date('2026-10-02T11:45:28.485Z'),decisionTime=new Date(+snapshotTime+11);
  const growth=structuredClone(projectContext(makeDemoContext({now:snapshotTime}),'growth_plan'));
  const treeId=growth.targetSnapshot.treeIds[0],template=growth.modules.growth.measurements[0];
  growth.modules.growth.measurements=[
    {...template,observationId:'size-first',observedAt:'2026-09-02T11:45:28.485Z',circumferenceCm:48},
    {...template,observationId:'size-last',observedAt:snapshotTime.toISOString(),circumferenceCm:49},
  ];
  const baseline=decisionSupport('growth_plan',growth,decisionTime).growthBaseline;
  assert.equal(baseline.at,'2026-11-01T11:45:28.485Z');
  assert.equal(baseline.calculations[0].treeId,treeId);
  assert.equal(baseline.calculations[0].value,50);
  assert.deepEqual(baseline.calculations[0].sourceRefs,['size-first','size-last']);
  const good=await new RuleGenerator().generate({kind:'growth_plan',context:growth,now:decisionTime});
  good.proposal.predictions[0]={...good.proposal.predictions[0],at:baseline.at,value:50,sourceRefs:baseline.calculations[0].sourceRefs};
  assert.doesNotThrow(()=>checkCandidate('growth_plan',good,growth,decisionTime));
  const missingEndpoint=structuredClone(good);missingEndpoint.proposal.predictions[0].sourceRefs=['size-last'];
  assert.throws(()=>checkCandidate('growth_plan',missingEndpoint,growth,decisionTime),e=>e.code==='INVALID_CANDIDATE');
  good.proposal.predictions[0].value=51;
  assert.throws(()=>checkCandidate('growth_plan',good,growth,decisionTime),e=>e.code==='CANDIDATE_REJECTED');
  const weather=structuredClone(projectContext(makeDemoContext({now:snapshotTime}),'weather_window'));
  weather.modules.weather.observed.rainfallMm=4.2;
  assert.ok(decisionSupport('weather_window',weather,decisionTime).eligibleForecastWindows.every(w=>w.suitableForbidden));
  const horizon=decisionSupport('pest_risk',{},decisionTime).horizonBounds;
  assert.equal(horizon.start,decisionTime.toISOString());assert.equal(Date.parse(horizon.end)-Date.parse(horizon.start),7*86400000);
});
test('industry: no synthetic trees, source scope/period and gaps retained, hallucinated source rejected',()=>{
  const service={status:()=>({location:{confirmed:false},sources:[{id:'production_hainan',title:'海南产量',snapshotId:'production_hainan-abc',sourceUrl:'https://stats.hainan.gov.cn/test',retrievedAt:now.toISOString(),validUntil:'2027-01-01T00:00:00Z',data:{period:'2025',scope:'海南',metrics:[{value:34.95,unit:'万吨'}]}}]})};
  const c=makeIndustryContext({service,now});assert.deepEqual(c.targetSnapshot.treeIds,[]);assert.equal(c.modules.trees,undefined);
  const request={kind:'industry_brief',siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:1},executionMode:'simulation'};assert.equal(checkContext(request,c,now).missing.length,0);
  const ref=c.modules.industry.records[0].observationId;
  const p={summary:'需要补企业数据',reasons:[{text:'按年度统计判断',sourceRefs:[ref]}],evidenceRefs:[ref],proposal:{horizon:{start:now.toISOString(),end:'2026-10-02T08:00:00Z'},findings:[{topic:'production',assessment:'年度产量',sourceRefs:[ref],limitation:'不是园区产量'}],recommendations:[{priority:'medium',action:'补采企业数据',reason:'缺少企业信息',sourceRefs:[ref]}],missingData:c.modules.industry.gaps,uncertainty:'宏观数据不能替代现场',reviewRequired:true}};
  assert.doesNotThrow(()=>checkCandidate('industry_brief',p,c,now));p.proposal.findings[0].sourceRefs=['fake'];assert.throws(()=>checkCandidate('industry_brief',p,c,now),e=>e.code==='CANDIDATE_REJECTED');
});

test('LLM: historical rain remains advisory while hourly rain blocks only its own window',async()=>{
  const context=structuredClone(projectContext(makeDemoContext({now}),'weather_window'));
  const weather=context.modules.weather;
  weather.observed.rainfallMm=0;
  weather.observed.soilMoisture={...weather.observed.soilMoisture,value:38.3};
  weather.observed.dryRubberContent=null;
  weather.observed.recentRainfall=[{observationId:'history-rain-test',observedAt:'2026-09-30T08:00:00Z',rainfallMm:10.3,rainfallPeriodMinutes:60,quality:'valid',provenance:{sourceClass:'sensor_device',sourceId:'history-source',mode:'simulated'}}];
  weather.forecast.steps=weather.forecast.steps.map((row,i)=>({...row,rainfallMm:i===0?0.2:2,rainProbabilityPct:20}));
  const candidate=await new RuleGenerator().generate({kind:'weather_window',context,now});
  assert.equal(candidate.proposal.timingAssessment.wetSpell,true);
  assert.equal(candidate.proposal.windows[0].suitability,'suitable');
  assert.equal(candidate.proposal.windows[1].suitability,'defer');
  let prompt,input;
  const generator=llm(async(_url,options)=>{
    const request=JSON.parse(options.body);prompt=request.messages[0].content;
    input=JSON.parse(request.messages[1].content);return result(candidate);
  });
  await generator.generate({kind:'weather_window',context,now,validateCandidate:value=>checkCandidate('weather_window',value,context,now)});
  assert.equal(input.decisionSupport.eligibleForecastWindows[0].suitableForbidden,false);
  assert.equal(input.decisionSupport.eligibleForecastWindows[1].suitableForbidden,true);
  assert.match(prompt,/累计雨量偏高作为巡查提示/);
  assert.doesNotMatch(prompt,/若雨史偏湿但干胶数据不足，至少 review/);
});
