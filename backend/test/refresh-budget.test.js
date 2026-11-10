import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const now=new Date('2026-10-30T02:00:00.000Z');
const limits={maxRunsPer24Hours:20,maxModelRequestsPer24Hours:8,maxRequestsPerRun:2};
function fixture(t,state={}) {
  const store=new Store();let sequence=0;
  t.after(()=>store.close());
  store.saveAutomaticState({configuredEnabled:false,paused:true,requestLimit:1,refreshEnabled:true,refreshPaused:false,refreshRequestLimit:4,...state});
  const context=makeParkContext({siteId:'demo-hainan',treeIds:['T-0004'],now});
  store.saveContext(context);
  const request=()=>({requestId:`refresh-budget-${++sequence}`,kind:'surface_action',siteId:context.siteId,
    targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},
    executionMode:'simulation',generatorMode:'configured',trigger:{type:'scheduled',eventId:'budget-test'}});
  const automatic=(overrides={})=>({...limits,jobId:'refresh-tree:demo-hainan:surface_action:T-0004',cycleKey:`cycle-${sequence}`,...overrides});
  const submit=(overrides={})=>{const input=request();return store.submit(input,now.toISOString(),automatic(overrides)).run.runId;};
  const reserve=runId=>store.reserveAutomaticRequest(runId,now.toISOString());
  const patch=values=>store.saveAutomaticState({...store.getAutomaticState(),...values});
  return {store,request,automatic,submit,reserve,patch};
}

test('refresh reservations have independent enable/pause controls while disabled legacy jobs remain blocked',t=>{
  const f=fixture(t);
  const legacy=f.submit({jobId:'legacy-tree'}),refresh=f.submit();
  assert.throws(()=>f.reserve(legacy),{code:'AUTO_PAUSED'});
  f.reserve(refresh);
  assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,1);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM automatic_requests WHERE run_id=?').get(legacy).n,0);
  assert.equal(f.store.getAutomaticState().configuredEnabled,false);
  assert.equal(f.store.getAutomaticState().paused,true);
});

test('refresh must be explicitly enabled and respects pause and the shared provider circuit',t=>{
  const f=fixture(t),runId=f.submit();
  for(const patch of [
    {refreshEnabled:undefined,refreshPaused:false,circuitReason:null},
    {refreshEnabled:false,refreshPaused:false,circuitReason:null},
    {refreshEnabled:true,refreshPaused:true,circuitReason:null},
    {refreshEnabled:true,refreshPaused:false,circuitReason:{code:'LLM_ACCOUNT_UNAVAILABLE'}},
  ]) {
    f.patch(patch);assert.throws(()=>f.reserve(runId),{code:'AUTO_PAUSED'});
    assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,0);
  }
  f.patch({refreshEnabled:true,refreshPaused:false,circuitReason:null});f.reserve(runId);
  assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,1);
});

test('refresh uses its own request limit and keeps per-run, persisted daily and rolling caps',t=>{
  const f=fixture(t,{refreshRequestLimit:3}),first=f.submit();
  f.reserve(first);f.reserve(first);
  assert.throws(()=>f.reserve(first),{code:'AUTO_BUDGET_EXHAUSTED'},'repair attempts obey the per-run cap');
  const second=f.submit();f.reserve(second);
  assert.throws(()=>f.reserve(second),{code:'AUTO_BUDGET_EXHAUSTED'},'refresh cap overrides the larger persisted daily limit');
  assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,3);
  f.patch({refreshRequestLimit:100});
  const third=f.submit({maxModelRequestsPer24Hours:4});f.reserve(third);
  assert.throws(()=>f.reserve(third),{code:'AUTO_BUDGET_EXHAUSTED'},'increasing state cap cannot exceed the persisted run cap');
  assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,4);
  f.store.reserveAutomaticRequest(second,new Date(+now+86400000).toISOString());
  assert.equal(f.store.automaticBudget(new Date(+now+86400000).toISOString()).modelRequests,1,'old reservations leave the rolling window');
});

test('refresh falls back to the persisted daily limit when no refresh override is set',t=>{
  const f=fixture(t,{refreshRequestLimit:undefined}),runId=f.submit({maxModelRequestsPer24Hours:2});
  f.reserve(runId);f.reserve(runId);
  assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,2,'legacy requestLimit=1 does not leak into refresh');
});

test('legacy reservations retain their own limit and share usage with refresh',t=>{
  const f=fixture(t,{configuredEnabled:true,paused:false,requestLimit:2,refreshRequestLimit:5});
  const legacy=f.submit({jobId:'legacy-tree'}),refresh=f.submit();
  f.reserve(legacy);f.reserve(refresh);
  assert.throws(()=>f.reserve(legacy),{code:'AUTO_BUDGET_EXHAUSTED'});
  f.reserve(refresh);
  assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,3);
});

test('runtime commits refresh reservations before outbound work and rejects a repair after cap without sending it',async t=>{
  const f=fixture(t,{refreshRequestLimit:1});let outbound=0;
  const runtime=new HarnessRuntime({store:f.store,contextProvider:new LocalContextProvider(f.store),clock:()=>now,concurrency:0,
    generator:{mode:'llm',async generate(args){
      args.onEvent('llm_request',{attempt:1});
      assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,1);
      outbound++;
      args.onEvent('llm_request',{attempt:2});
      outbound++;
      return new RuleGenerator().generate(args);
    }}});
  const request=f.request(),accepted=runtime.submit(request,f.automatic());
  try {
    await runtime.execute(accepted.runId);
    assert.equal(outbound,1);
    const run=f.store.getRun(accepted.runId);
    assert.equal(run.status,'failed');assert.equal(run.result.error.code,'AUTO_BUDGET_EXHAUSTED');
    assert.equal(f.store.automaticBudget(now.toISOString()).modelRequests,1);
  } finally {await runtime.stop();}
});
