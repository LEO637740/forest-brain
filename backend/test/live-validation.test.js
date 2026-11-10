import test from 'node:test';
import assert from 'node:assert/strict';
import {FOLLOWUP_CASES,validationContext,acceptanceErrors} from '../scripts/live-validation-cases.js';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/runtime.js';
import {LocalContextProvider} from '../src/adapters/context.js';
import {contextSchema} from '../src/contracts.js';
import {validate} from '../src/schema.js';
import {assertPersistedModelEnabled} from '../src/model-control.js';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const now=new Date('2026-10-02T08:00:00Z'),service={status:()=>({location:{confirmed:false},sources:[]})};
test('live acceptance matrix: nine paid cases maximum, two missing-data cases, genuinely mixed inputs',async()=>{
  assert.equal(FOLLOWUP_CASES.filter(c=>!c.expectedStatus).length,9);
  const store=new Store(),runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock:()=>now});
  try{for(const spec of FOLLOWUP_CASES){
    const c=validationContext(spec,service,now);validate(contextSchema,c);
    if(spec.mode!=='public')assert.equal(c.dataPolicy.mode,'mixed_demo');
    if(spec.kind==='industry_brief')continue; // The offline rule engine deliberately has no industry proposal.
    store.saveContext(c);const run=runtime.submit({requestId:spec.id,kind:spec.kind,siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:c.version},executionMode:'simulation'});
    await runtime.idle();const result=store.getRun(run.runId).result;
    assert.deepEqual(acceptanceErrors(spec,result,store.events(run.runId)),[],spec.id+': '+JSON.stringify(result));
  }}finally{await runtime.stop();store.close();}
});
test('live acceptance: read-only model gate respects legacy DB, persisted pause and later changes',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-live-gate-')),'test.sqlite');
  assert.doesNotThrow(()=>assertPersistedModelEnabled(path));assert.equal(existsSync(path),false);
  const legacy=new DatabaseSync(path);legacy.exec('CREATE TABLE legacy_fixture(id INTEGER)');legacy.close();
  assert.doesNotThrow(()=>assertPersistedModelEnabled(path));
  const store=new Store(path);try{
    assert.doesNotThrow(()=>assertPersistedModelEnabled(path));
    store.setModelPaused(true,now.toISOString());assert.throws(()=>assertPersistedModelEnabled(path),e=>e.code==='MODEL_PAUSED');
    store.setModelPaused(false,now.toISOString());assert.doesNotThrow(()=>assertPersistedModelEnabled(path));
  }finally{store.close();}
});
test('live acceptance CLI: paused main database stops script before model configuration or network',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'rubber-cli-pause-')),'test.sqlite'),store=new Store(path);
  store.setModelPaused(true,now.toISOString());store.close();
  // Rules ensures an accidental guard regression still cannot call a provider.
  const result=spawnSync(process.execPath,['scripts/smoke-llm.js','--surface-only','--single-attempt'],{
    cwd:new URL('../',import.meta.url),env:{...process.env,HARNESS_DB_PATH:path,HARNESS_GENERATOR:'rules',CANDIDATE_SERVICE_URL:''},encoding:'utf8',timeout:10000,
  });
  assert.equal(result.status,1);assert.match(result.stderr,/MODEL_PAUSED/);assert.doesNotMatch(result.stdout,/Saved/);
});
