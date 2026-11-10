import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {makeDemoContext} from '../src/adapters/context.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {classifyStrategyRoute,setRoutingDelegations,AUDIT_EVERY} from '../src/strategy-routing.js';
import {groupObservations,DELEGATION_RULES} from '../src/routing-evolution.js';
import {AppError} from '../src/errors.js';
import {LlmGenerator} from '../src/adapters/llm.js';

const now=new Date('2026-10-02T09:00:00Z');
const request=(c,id)=>({requestId:id,kind:'surface_action',siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version},executionMode:'simulation',generatorMode:'configured'});
// A "model" that reaches the rule's conclusion and reports its token use like the real LLM adapter.
function model(){return {mode:'llm',modelVersion:'offline-routing-test',calls:0,describe:()=>({configured:true}),
  async generate(args){args.onEvent('llm_request',{attempt:1});this.calls++;const candidate=await new RuleGenerator().generate(args);
    args.onEvent('llm_completed',{provider:'fixture',model:'fixture',inputTokens:6000,outputTokens:2000});return candidate;}};}
function setup(generator=model()){const a=createApp({dbPath:':memory:',clock:()=>now,generator}),c=makeDemoContext({now});a.store.saveContext(c);return {a,c,generator};}
async function runMany(a,c,prefix,count){for(let i=0;i<count;i++)a.runtime.submit(request(c,`${prefix}-${i}`));await a.runtime.idle();}
const observation=(outcome,patch={})=>({runId:`r-${Math.random()}`,siteId:'demo-hainan',kind:'pest_risk',signature:'health_finding',at:'2026-10-01T00:00:00Z',llmCalls:1,tokens:8000,auditOf:null,outcome,...patch});

for(const reasonCode of ['LLM_ACCOUNT_UNAVAILABLE','LLM_REQUEST_REJECTED','CANDIDATE_SERVICE_UNAVAILABLE'])
test(`${reasonCode}: ten unavailable calls are not validation evidence for delegation`,async()=>{
  const generator=model();
  generator.generate=async function(args){args.onEvent('llm_request',{attempt:1});this.calls++;throw new AppError(reasonCode,reasonCode==='CANDIDATE_SERVICE_UNAVAILABLE'?'网络超时':'HTTP 402 余额不足',502);};
  const {a,c}=setup(generator);try{
    await runMany(a,c,'unavailable',10);
    const data=a.routingEvolution.evaluate(c.siteId),group=data.groups.find(item=>item.kind==='surface_action');
    assert.equal(generator.calls,10);
    assert.equal(group.samples,10);
    assert.equal(group.compared,0);
    assert.equal(group.fallback+group.failed,0);
    assert.equal(group.excluded,10);
    assert.equal(group.fallbackRate,0);
    assert.equal(group.eligible,false);
    assert.equal(data.candidates,0);
    assert.match(group.explanation,/未计入/);
    assert.throws(()=>a.routingEvolution.propose(c.siteId,{kind:'surface_action',signature:group.signature},'manager-hn'),/暂不满足下沉条件/);
  }finally{await a.close();}
});

for(const reasonCode of ['INVALID_CANDIDATE','CANDIDATE_REJECTED'])
test(`${reasonCode}: actual candidate validation failures remain delegation evidence`,async()=>{
  const generator=model();
  generator.generate=async function(args){args.onEvent('llm_request',{attempt:1});this.calls++;throw new AppError(reasonCode,'候选没有通过校验',422);};
  const {a,c}=setup(generator);try{
    await runMany(a,c,'invalid',10);
    const group=a.routingEvolution.evaluate(c.siteId).groups.find(item=>item.kind==='surface_action');
    assert.equal(group.fallback,10);
    assert.equal(group.excluded,0);
    assert.equal(group.verdict,'brain_unreliable');
    assert.equal(group.eligible,true);
  }finally{await a.close();}
});

test('unavailable calls do not alter the validation failure ratio or supply missing samples',()=>{
  const invalid=Array.from({length:9},()=>observation('fallback'));
  const excluded=Array.from({length:10},()=>observation('other',{reasonCode:'LLM_ACCOUNT_UNAVAILABLE'}));
  const insufficient=groupObservations([...invalid,...excluded])[0];
  assert.equal(insufficient.eligible,false);
  assert.equal(insufficient.fallbackRate,1);
  const enough=groupObservations([...invalid,observation('agree'),...excluded])[0];
  assert.equal(enough.eligible,true);
  assert.equal(enough.fallbackRate,0.9);
});

test('ten HTTP 402 responses through the LLM adapter never become delegation evidence',async()=>{
  let calls=0;
  const generator=new LlmGenerator({baseUrl:'https://model.example/v1',apiKey:'offline-fixture',model:'offline-fixture',
    fetchImpl:async()=>{calls++;return Response.json({error:{message:'Insufficient Balance'}},{status:402});}});
  const {a,c}=setup(generator);try{
    await runMany(a,c,'http-402',10);
    const data=a.routingEvolution.evaluate(c.siteId),group=data.groups[0];
    assert.equal(calls,10);
    assert.equal(group.excluded,10);
    assert.equal(group.compared,0);
    assert.equal(group.fallback,0);
    assert.equal(group.eligible,false);
    assert.equal(data.totals.excluded,10);
    assert.equal(data.candidates,0);
  }finally{await a.close();}
});

for(const reasonCode of ['CANDIDATE_SERVICE_UNAVAILABLE','CANDIDATE_REJECTED'])
test(`legacy failed runs retain their actual reason: ${reasonCode}`,async()=>{
  const {a,c}=setup();try{
    for(let i=0;i<10;i++){
      const run=a.store.submit(request(c,`legacy-${i}`),now.toISOString()).run;
      a.store.saveRunContext(run.runId,c);
      a.store.stage(run.runId,'llm_request',now.toISOString(),{attempt:1});
      a.store.finish(run.runId,{runId:run.runId,requestId:run.requestId,status:'failed',updatedAt:now.toISOString(),
        error:{code:reasonCode,message:'fixture persisted failure',retryable:false}});
    }
    const group=a.routingEvolution.evaluate(c.siteId).groups[0],invalid=reasonCode==='CANDIDATE_REJECTED';
    assert.equal(group.failed,invalid?10:0);
    assert.equal(group.excluded,invalid?0:10);
    assert.equal(group.eligible,invalid);
  }finally{await a.close();}
});

test('shadow comparison groups past big-brain runs by trigger combination and proposes a hand-down',async()=>{
  const {a,c,generator}=setup();try{
    await runMany(a,c,'before',DELEGATION_RULES.minSamples);
    assert.equal(generator.calls,DELEGATION_RULES.minSamples);
    const data=a.routingEvolution.evaluate('demo-hainan');
    const group=data.groups.find(item=>item.kind==='surface_action');
    assert.equal(group.signature,'inspection_finding');
    assert.equal(group.agree,DELEGATION_RULES.minSamples);
    assert.equal(group.verdict,'delegate');
    assert.equal(group.tokens,8000*DELEGATION_RULES.minSamples);
    assert.match(group.locked,/校验器/);
    assert.match(data.headline,/树表异常处置·树表检测发现/);
    // Shadow replay never writes: no new runs, strategies or delegations.
    assert.equal(a.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,DELEGATION_RULES.minSamples);
    assert.equal(a.routingEvolution.list('demo-hainan').length,0);

    const proposal=a.routingEvolution.propose('demo-hainan',{kind:'surface_action',signature:'inspection_finding'},'manager-hn');
    assert.equal(proposal.status,'pending');
    assert.equal(proposal.evidence.agree,DELEGATION_RULES.minSamples);
    // Pending proposals do not change routing.
    assert.equal(classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action'}).executor,'big_brain');
    assert.throws(()=>a.routingEvolution.propose('demo-hainan',{kind:'pest_risk',signature:'health_finding'},'manager-hn'),/没有这类情况/);

    a.routingEvolution.decide(proposal.id,{decision:'approve'},null);
    const route=classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action'});
    assert.equal(route.executor,'small_brain');
    assert.equal(route.delegation.id,proposal.id);
    assert.match(route.reason,/批准下沉/);
    assert.throws(()=>a.routingEvolution.propose('demo-hainan',{kind:'surface_action',signature:'inspection_finding'},'manager-hn'),/已经下沉/);

    // After approval most requests skip the model; one in AUDIT_EVERY is still sent as an audit.
    const extra=20;await runMany(a,c,'after',extra);
    const routed=a.store.db.prepare(`SELECT e.data FROM events e JOIN runs r ON r.id=e.run_id WHERE e.stage='routing' AND r.request_id LIKE 'after-%'`).all().map(row=>JSON.parse(row.data));
    const audits=routed.filter(item=>item.routes[0].delegation?.audit);
    assert.equal(routed.length,extra);
    assert.equal(generator.calls,DELEGATION_RULES.minSamples+audits.length);
    assert.ok(routed.filter(item=>!item.routes[0].delegation?.audit).every(item=>item.executor==='small_brain'));
    assert.ok(audits.every(item=>item.executor==='big_brain'));
    const active=a.routingEvolution.evaluate('demo-hainan').delegations.find(item=>item.id===proposal.id);
    assert.equal(active.review.handedDown,extra-audits.length);
    assert.equal(active.review.audits,audits.length);
    // Audits are kept out of the evidence that justified the hand-down.
    assert.equal(a.routingEvolution.evaluate('demo-hainan').groups.find(item=>item.kind==='surface_action').samples,DELEGATION_RULES.minSamples);

    const evolution=a.routingEvolution.digest('demo-hainan');
    assert.equal(evolution.active[0].id,proposal.id);
    a.routingEvolution.revoke(proposal.id,{note:'演示收回'},null);
    assert.equal(classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action'}).executor,'big_brain');
    assert.throws(()=>a.routingEvolution.revoke(proposal.id,{},null),/生效中/);
  }finally{await a.close();}
});

test('only an exact trigger combination is handed down; audits are sampled deterministically by run',()=>{
  const c=makeDemoContext({now});
  setRoutingDelegations(c.siteId,[{id:'route-x',kind:'surface_action',signature:'health_finding+inspection_finding',approvedAt:now.toISOString()}]);
  try{
    // T-0012 surface_action only has the inspection finding: a different combination stays with the brain.
    assert.equal(classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action'}).executor,'big_brain');
    setRoutingDelegations(c.siteId,[{id:'route-y',kind:'surface_action',signature:'inspection_finding',approvedAt:now.toISOString()}]);
    const keys=Array.from({length:200},(_,i)=>`run-${i}`);
    const audited=keys.filter(key=>classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action',sampleKey:key}).delegation.audit);
    assert.ok(audited.length>200/AUDIT_EVERY/2&&audited.length<200/AUDIT_EVERY*2);
    assert.deepEqual(audited,keys.filter(key=>classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action',sampleKey:key}).delegation.audit));
    // Other kinds are not affected by a surface_action delegation.
    assert.equal(classifyStrategyRoute(c,{treeId:'T-0012',kind:'tapping_angle'}).delegation,undefined);
  }finally{setRoutingDelegations(c.siteId,null);}
});

test('verdicts: disagreement keeps the brain, repeated validation failure is flagged, few samples wait',()=>{
  const groups=groupObservations([
    ...Array.from({length:12},()=>observation('agree')),...Array.from({length:3},()=>observation('disagree',{detail:'巡查对象不同'})),
    ...Array.from({length:12},()=>observation('fallback',{kind:'tapping_angle',signature:'inspection_finding'})),
    ...Array.from({length:3},()=>observation('agree',{kind:'surface_action',signature:'inspection_finding'})),
  ]);
  const by=kind=>groups.find(item=>item.kind===kind);
  assert.equal(by('pest_risk').verdict,'keep_brain');
  assert.equal(by('pest_risk').eligible,false);
  assert.equal(by('pest_risk').examples.disagree[0].detail,'巡查对象不同');
  assert.equal(by('tapping_angle').verdict,'brain_unreliable');
  assert.equal(by('tapping_angle').eligible,true);
  assert.equal(by('surface_action').verdict,'insufficient');
  assert.equal(groups[0].eligible,true);
});

test('audit review suggests revoking a hand-down when the brain starts to disagree',()=>{
  const {a}=setup();try{
    const delegation={id:'route-audit',siteId:'demo-hainan',decidedAt:'2026-10-01T00:00:00Z'};
    const audits=[...Array.from({length:4},()=>observation('agree',{auditOf:'route-audit'})),observation('disagree',{auditOf:'route-audit',detail:'巡查对象不同'})];
    const review=a.routingEvolution.review(delegation,audits);
    assert.equal(review.verdict,'revoke_suggested');
    assert.match(review.summary,/建议收回/);
    assert.equal(a.routingEvolution.review(delegation,audits.slice(0,4)).status,'collecting');
    assert.equal(a.routingEvolution.review(delegation,[...audits.slice(0,4),observation('agree',{auditOf:'route-audit'})]).verdict,'keep');
  }finally{a.close();}
});

test('HTTP: roles, decision list and approval for hand-downs',async t=>{
  const {a,c}=setup();t.after(()=>a.close());
  await runMany(a,c,'http',DELEGATION_RULES.minSamples);
  await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${a.server.address().port}`;
  const call=async(path,{input,token,status=200}={})=>{
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Rubber-Session':token}:{})},body:input===undefined?undefined:JSON.stringify(input)});
    const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);return data;};
  const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
  const manager=await login('manager-hn'),operator=await login('operator-hn'),grower=await login('grower-hn-wang'),other=await login('manager-xs');
  await call('/api/brain/routing?siteId=demo-hainan',{token:grower,status:403});
  const view=await call('/api/brain/routing?siteId=demo-hainan',{token:operator});
  assert.equal(view.groups[0].verdict,'delegate');
  assert.ok((await call('/api/workspace/brief?siteId=demo-hainan',{token:manager})).items.some(item=>item.id==='routing-learn'));
  const input={siteId:'demo-hainan',kind:'surface_action',signature:'inspection_finding'};
  await call('/api/brain/routing/propose',{token:operator,input,status:403});
  const proposal=await call('/api/brain/routing/propose',{token:manager,input,status:201});
  const brief=await call('/api/workspace/brief?siteId=demo-hainan',{token:manager});
  assert.ok(brief.items.some(item=>item.id==='routing-pending'&&item.priority==='high'));
  assert.ok(!brief.items.some(item=>item.id==='routing-learn'));
  await call(`/api/brain/routing/${proposal.id}/decision`,{token:operator,input:{decision:'approve'},status:403});
  await call(`/api/brain/routing/${proposal.id}/decision`,{token:other,input:{decision:'approve'},status:403});
  const approved=await call(`/api/brain/routing/${proposal.id}/decision`,{token:manager,input:{decision:'approve',note:'对照一致'}});
  assert.equal(approved.status,'active');
  assert.equal(approved.decidedBy,'manager-hn');
  const evolution=await call('/api/brain/evolution?siteId=demo-hainan',{token:manager});
  assert.equal(evolution.routing.evolution.active[0].id,proposal.id);
  await call(`/api/brain/routing/${proposal.id}/revoke`,{token:manager,input:{note:'演示结束'}});
  assert.equal(classifyStrategyRoute(c,{treeId:'T-0012',kind:'surface_action'}).executor,'big_brain');
});
