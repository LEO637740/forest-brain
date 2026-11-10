// Explicit, paid live API validation. Never runs under npm test or on server startup.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredGenerator, loadLocalEnv } from '../src/generator-config.js';
import { PublicDataService } from '../src/adapters/public-data.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { FOLLOWUP_CASES, validationContext, acceptanceErrors } from './live-validation-cases.js';
import { assertPersistedModelEnabled } from '../src/model-control.js';
loadLocalEnv();
const root=fileURLToPath(new URL('../',import.meta.url)),controlDb=process.env.HARNESS_DB_PATH??resolve(root,'var/brain.sqlite');
assertPersistedModelEnabled(controlDb);
const generator=configuredGenerator();
if(generator.mode!=='llm')throw new Error('This acceptance script requires the LLM engine');
if(!generator.describe().configured)throw new Error('Configure the provider API key and model locally before live validation');
if(process.argv.includes('--single-attempt')) generator.maxAttempts=1;
const service=new PublicDataService({directory:resolve(root,'data/real-sources'),config:JSON.parse(readFileSync(resolve(root,'config/data-sources.json'),'utf8'))});
class AcceptanceStore extends Store {
  assertModelEnabled() { super.assertModelEnabled(); assertPersistedModelEnabled(controlDb); }
}
const store=new AcceptanceStore(), runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),generator});
const kinds=process.argv.includes('--weather-only')?['weather_window']:process.argv.includes('--surface-only')?['surface_action']:process.argv.includes('--industry-only')?['industry_brief']:process.argv.includes('--all')?['weather_window','tapping_angle','surface_action','growth_plan','market_scenario','pest_risk','industry_brief']:['surface_action','industry_brief'];
const cases=process.argv.includes('--followup')?FOLLOWUP_CASES:kinds.map(kind=>({id:kind,kind,mode:process.argv.includes('--mixed')?'mixed_demo':kind==='industry_brief'?'public':'demo',treeIds:['T-0012']}));
const filter=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
if(filter&&!cases.some(c=>c.id===filter))throw new Error('Unknown validation case; no model call sent');
const report={testedAt:new Date().toISOString(),configuration:generator.describe(),runs:[]};
try {
  for(const spec of cases.filter(c=>!filter||c.id===filter)) {
    const {kind}=spec, now=new Date(), context=validationContext(spec,service,now);
    store.saveContext(context);
    const accepted=runtime.submit({requestId:`live-smoke-${kind}-${Date.now()}`,kind,siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'});
    await runtime.idle(130000);
    const result=store.getRun(accepted.runId).result;
    const events=store.events(accepted.runId),errors=acceptanceErrors(spec,result,events);
    report.runs.push({caseId:spec.id,kind,inputType:context.dataPolicy?.mode??spec.mode??'mixed_demo',expectedStatus:spec.expectedStatus??'succeeded',accepted:!errors.length,acceptanceErrors:errors,result,events,context});
    console.log(JSON.stringify({caseId:spec.id,kind,status:result.status,accepted:!errors.length,error:result.error,acceptanceErrors:errors,model:result.strategy?.generationMetadata?.model,summary:result.strategy?.summary}));
    if(errors.length)process.exitCode=1;
    if(['LLM_ACCOUNT_UNAVAILABLE','LLM_NOT_CONFIGURED','LLM_REQUEST_REJECTED'].includes(result.error?.code)){
      report.stoppedReason=result.error.code;console.log('Stopped remaining live checks: provider/account unavailable.');break;
    }
  }
} finally {
  await runtime.stop();store.close();
  const dir=resolve(root,'data/llm-validation');mkdirSync(dir,{recursive:true});
  const path=resolve(dir,`acceptance-${report.testedAt.replace(/[:.]/g,'-')}.json`);writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  console.log(`Saved ${path}`);
}
