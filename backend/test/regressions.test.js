import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider, HttpContextProvider, makeDemoContext } from '../src/adapters/context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { checkContext, checkCandidate } from '../src/validation.js';
const now=new Date('2026-10-01T08:00:00Z');
const req=(c,kind='weather_window')=>({requestId:`regression-${kind}`,kind,siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version},executionMode:'simulation'});
async function run(c,kind='weather_window',generator) {
  const store=new Store();store.saveContext(c);const runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator,clock:()=>now});
  try{const a=runtime.submit(req(c,kind));await runtime.idle();return store.getRun(a.runId).result;}finally{await runtime.stop();store.close();}
}
test('G01/G02: past candidate windows rejected and strategy expiry bounded by earliest window',async()=>{
  const c=makeDemoContext({now});
  const p=await new RuleGenerator().generate({kind:'weather_window',context:c,now});
  p.proposal.windows[0].start='2026-10-01T06:00:00Z';p.proposal.windows[0].end='2026-10-01T07:00:00Z';
  c.modules.weather.forecast.steps.push({validFrom:p.proposal.windows[0].start,validTo:p.proposal.windows[0].end,rainfallMm:0,rainProbabilityPct:10});
  assert.throws(()=>checkCandidate('weather_window',p,c,now),e=>e.code==='CANDIDATE_REJECTED');
  c.modules.weather.forecast.steps=[{validFrom:now.toISOString(),validTo:'2026-10-01T08:01:00Z',rainfallMm:0,rainProbabilityPct:10}];
  const result=await run(c);assert.equal(result.status,'succeeded');assert.equal(Date.parse(result.strategy.expiresAt),Date.parse('2026-10-01T08:01:00Z'));
});
test('G03: changed rule text or version cannot silently use demo algorithm',async()=>{
  for(const field of ['text','version']){const c=makeDemoContext({now});c.modules.knowledge.rules.find(x=>x.kind==='weather_window')[field]='changed-policy';const r=await run(c);assert.equal(r.error.code,'UNSUPPORTED_RULE_VERSION');}
});
test('G04: target ID binds site and unordered membership across input snapshots',()=>{
  const s=new Store();try{const a=makeDemoContext({now,treeIds:['T-0012']}),b=makeDemoContext({now,treeIds:['T-0013']});b.targetSnapshot.targetSnapshotId=a.targetSnapshot.targetSnapshotId;s.saveContext(a);assert.throws(()=>s.saveContext(b),e=>e.code==='TARGET_SNAPSHOT_CONFLICT');assert.equal(s.getContext(b.snapshotId,1),null);}finally{s.close();}
});
test('G05/G06: conflicting geometry blocks output; rowId is accepted',async()=>{
  const c=makeDemoContext({now,treeIds:['T-0013']});c.modules.trees[0].rowId='row-A-01';assert.doesNotThrow(()=>checkContext(req(c,'tapping_angle'),c,now));
  const e=c.modules.inspection.evidence[0],d=e.detections[0];d.reviewStatus='confirmed';e.detections.push({...d,detectionId:'conflict',intersectsPlannedLine:!d.intersectsPlannedLine});
  const r=await run(c,'surface_action');assert.equal(r.status,'needs_data');assert.ok(r.missingData.some(x=>x.field==='conflict'));
});
test('G07: HTTP context resolves only requested datasets and preserves original manifest',async()=>{
  const c=makeDemoContext({now});c.datasets=[{module:'inspection',datasetRef:'unneeded',version:1}];delete c.modules.inspection;
  const provider=new HttpContextProvider({baseUrl:'http://127.0.0.1'});provider.readJson=async()=>structuredClone(c);provider.readDataset=async()=>{throw new Error('unused dataset must not be requested')};
  let manifest;const loaded=await provider.getContext({snapshotId:c.snapshotId,version:1},{kind:'weather_window',onManifest:c=>manifest=c});assert.deepEqual(manifest,c);assert.deepEqual(loaded,c);
});
test('LLM cannot fabricate arithmetic contribution or publish explicitly expired image evidence',async()=>{
  const c=makeDemoContext({now});const p=await new RuleGenerator().generate({kind:'market_scenario',context:c,now});p.proposal.scenarios[0].estimatedContributionCny=9999;
  assert.throws(()=>checkCandidate('market_scenario',p,c,now),e=>e.code==='CANDIDATE_REJECTED');
  c.modules.inspection.evidence[0].expiresAt='2026-10-01T07:59:00Z';const r=await run(c,'surface_action');assert.equal(r.status,'needs_data');assert.ok(r.missingData.some(x=>x.field==='expiresAt'));
});
