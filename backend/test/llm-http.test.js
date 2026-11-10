import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { LlmGenerator } from '../src/adapters/llm.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { makeDemoContext } from '../src/adapters/context.js';
import { configuredGenerator } from '../src/generator-config.js';

const now = new Date('2026-10-01T08:00:00Z');
const source = { id:'production_hainan', title:'海南产量测试夹具', snapshotId:'production_hainan-test', sourceUrl:'https://stats.hainan.gov.cn/test', retrievedAt:now.toISOString(), validUntil:'2027-01-01T00:00:00Z', data:{period:'2025',scope:'海南',metrics:[{value:34.95,unit:'万吨'}]} };
const service = {status:()=>({location:{confirmed:false},sources:[source]}),archive:id=>{assert.equal(id,source.snapshotId);return source;}};
async function listen(server) { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}`; }
const post = (url,path,body) => fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const request = (ref,kind,id) => ({requestId:id,kind,siteId:ref.siteId,targetSnapshotId:ref.targetSnapshotId,inputSnapshot:ref.inputSnapshot,executionMode:'simulation'});

test('HTTP LLM pipeline: surface and industry candidates, frozen inputs, metadata, source coverage and imports',async()=>{
  let calls=0;
  const upstream=http.createServer(async(req,res)=>{
    assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer test-model-key');
    let body='';for await(const chunk of req)body+=chunk;
    const payload=JSON.parse(body), input=JSON.parse(payload.messages[1].content);calls++;
    let candidate;
    if(input.kind==='surface_action')candidate=await new RuleGenerator().generate({...input,now:new Date(input.asOf)});
    else {
      assert.deepEqual(input.context.targetSnapshot.treeIds,[]);
      assert.deepEqual(Object.keys(input.context.modules),['industry','knowledge']);
      const ref=input.context.modules.industry.records[0].observationId;
      candidate={summary:'按统计期研判，补充企业数据',reasons:[{text:'年度数据仅为宏观参考',sourceRefs:[ref]}],evidenceRefs:[ref],proposal:{horizon:{start:now.toISOString(),end:'2026-10-02T08:00:00Z'},findings:[{topic:'production',assessment:'2025 年海南产量为 34.95 万吨',sourceRefs:[ref],limitation:'年度统计，不是园区产量'}],recommendations:[{priority:'medium',action:'补采园区产量',reason:'缺少企业资料',sourceRefs:[ref]}],missingData:input.context.modules.industry.gaps,uncertainty:'缺企业资料，需人工复核',reviewRequired:true}};
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:`mock-${calls}`,model:'http-mock-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(candidate)}}],usage:{prompt_tokens:120,completion_tokens:90}}));
  });
  const base=await listen(upstream);
  const a=createApp({dbPath:':memory:',clock:()=>now,publicDataService:service,generator:new LlmGenerator({baseUrl:base+'/v1',apiKey:'test-model-key',model:'http-mock-model'})});
  try {
    const url=await listen(a.server);
    for(const kind of ['surface_action','industry_brief']) {
      const contextResponse=kind==='surface_action'?await post(url,'/api/contexts',makeDemoContext({now})):await post(url,'/api/sources/industry-context',{});
      assert.equal(contextResponse.status,201);const ref=await contextResponse.json();
      const accepted=await (await post(url,'/internal/harness/runs',request(ref,kind,kind))).json();
      await a.runtime.idle();const result=await (await fetch(`${url}/internal/harness/runs/${accepted.runId}`)).json();
      assert.equal(result.status,'succeeded',JSON.stringify(result.error));
      assert.equal(result.strategy.schemaVersion,'2.1.0');assert.equal(result.strategy.provenance.mode,'estimated');
      assert.equal(result.strategy.generationMetadata.model,'http-mock-model');assert.equal(result.strategy.generationMetadata.attempts,1);
      assert.equal(result.strategy.generationMetadata.inputTokens,120);assert.equal(result.strategy.ruleBindings.length,1);
      const events=await (await fetch(`${url}/internal/harness/runs/${accepted.runId}/events`)).json();
      assert.equal(events.items.some(e=>e.stage==='llm_completed'),true);assert.equal(JSON.stringify(events).includes('test-model-key'),false);
      const frozen=await (await fetch(`${url}/internal/harness/runs/${accepted.runId}/context`)).json();assert.equal(frozen.snapshotId,ref.inputSnapshot.snapshotId);
      const again=await post(url,'/internal/harness/runs',request(ref,kind,kind));assert.equal(again.status,200);
    }
    assert.equal(calls,2);
    const coverage=await (await fetch(url+'/api/sources/coverage')).json();assert.equal(coverage.items.length,12);
    assert.equal(coverage.items.find(x=>x.id==='processing').status,'business_data_required');
    assert.equal((await fetch(url+'/api/sources/snapshots/production_hainan-test')).status,200);
    const changed=makeDemoContext({now});changed.modules.inspection.evidence[0].quality='suspect';
    assert.equal((await post(url,'/api/contexts',changed)).status,409);
    const batch=await (await post(url,'/api/demo/scenarios/run',{scenarioId:'all'})).json();await a.runtime.idle();
    assert.equal(batch.items.length,7);assert.equal(calls,2,'offline scenes must never call configured LLM');
    for(const item of batch.items)assert.equal(a.store.getRun(item.runId).result.status,['missing','resting'].includes(item.scenarioId)?'needs_data':'succeeded');
  }finally{await a.close();await new Promise(resolve=>upstream.close(resolve));}
});

test('Unavailable model config and provider account publish labelled fallbacks without secret exposure',async()=>{
  assert.equal(configuredGenerator({LLM_PROVIDER:'deepseek',LLM_MODEL:'test-model'}).describe().configured,false);
  for(const generator of [configuredGenerator({LLM_PROVIDER:'deepseek',LLM_MODEL:'test-model'}),new LlmGenerator({baseUrl:'https://example.invalid/v1',apiKey:'test-secret-key',model:'test-model',fetchImpl:async()=>Response.json({error:{message:'Access denied, please make sure your account is in good standing. test-secret-key'}},{status:400})})]) {
    const a=createApp({dbPath:':memory:',clock:()=>now,generator});
    try {
      const c=makeDemoContext({now});a.store.saveContext(c);
      const accepted=a.runtime.submit(request({siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version}},'surface_action','blocked'));
      await a.runtime.idle();const result=a.store.getRun(accepted.runId).result;
      assert.equal(result.status,'succeeded',JSON.stringify(result));
      assert.ok(['LLM_NOT_CONFIGURED','LLM_ACCOUNT_UNAVAILABLE'].includes(result.strategy.fallback.reasonCode));
      assert.equal(result.strategy.fallback.reviewRequired,true);
      assert.equal(JSON.stringify(result).includes('test-secret-key'),false);
    }finally{await a.close();}
  }
});

test('Local OpenAI-compatible profiles stay loopback-only and need no cloud key',()=>{
  const defaultProfile=configuredGenerator({});
  assert.equal(defaultProfile.describe().provider,'ollama');
  assert.equal(defaultProfile.describe().configured,true);
  const local=configuredGenerator({LLM_PROVIDER:'ollama',LLM_MODEL:'fixture-local-model'});
  assert.equal(local.describe().provider,'ollama');
  assert.equal(local.describe().model,'fixture-local-model');
  assert.equal(local.describe().configured,true);
  const lmstudio=configuredGenerator({LLM_PROVIDER:'lmstudio',LLM_MODEL:'fixture-lm-model'});
  assert.equal(lmstudio.describe().provider,'lmstudio');
  const vllm=configuredGenerator({LLM_PROVIDER:'vllm',LLM_MODEL:'fixture-vllm-model'});
  assert.equal(vllm.describe().provider,'vllm');
  assert.throws(()=>new LlmGenerator({provider:'ollama',baseUrl:'https://remote.example/v1',apiKey:'local-no-key',model:'fixture'}),e=>e.code==='INVALID_CONFIG');
  assert.throws(()=>new LlmGenerator({provider:'lmstudio',baseUrl:'http://10.0.0.2:1234/v1',apiKey:'local-no-key',model:'fixture'}),e=>e.code==='INVALID_CONFIG');
  assert.doesNotThrow(()=>new LlmGenerator({provider:'vllm',baseUrl:'http://127.0.0.1:8000/v1',apiKey:'local-no-key',model:'fixture'}));
});
