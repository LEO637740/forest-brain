// Background preparation shares the same protected backend path as explicit
// rule preparation. It never changes human permissions or adopts a task.
import {writeFile,mkdir,rename,access,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {connectionConfig} from './connection.mjs';
import {prepareIndustry} from './prepare-industry.mjs';
import {openServiceSession} from './service-session.mjs';

export function preparationSessionName(siteId) {
  if(!/^demo-[a-z-]+$/.test(siteId))throw Error('HARNESS_SITE_ID 无效');
  return siteId==='demo-hainan'?'harness-session.json':`harness-session-${siteId}.json`;
}
export async function prepareHarnessSnapshots(call,{siteId='demo-hainan',dataMode='mixed_demo',reason='startup',includeTrees=true,stamp=Date.now().toString(36),now=Date.now,previous=null,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(!['demo','mixed_demo'].includes(dataMode))throw Error('HARNESS_DATA_MODE 必须为 demo 或 mixed_demo');
  if(!['startup','scheduled','site_activated','manual'].includes(reason))throw Error('HARNESS_PREPARE_REASON 无效');
  preparationSessionName(siteId);
  const manifest=await call(`/api/demo/trees/manifest?scope=park&siteId=${encodeURIComponent(siteId)}`);
  if(manifest.siteId!==siteId)throw Error('树清单不属于当前园区');
  const preparations=[],jobs=[],outcomes=[],old=previous?.siteId===siteId||!previous?.siteId&&siteId==='demo-hainan'?previous?.jobs??[]:[];
  const wait=async job=>{for(let n=0;n<150;n++){
    const run=await call('/internal/harness/runs/'+job.runId);
    if(!['queued','running'].includes(run.status)){
      if(!['succeeded','needs_data'].includes(run.status))throw Object.assign(Error(run.result?.error?.message??run.error?.message??`策略准备未成功（${run.status}）`),{preparationFailed:true});
      outcomes.push({kind:run.request?.kind??job.kind??'snapshots',status:run.status,missingData:run.result?.missingData??[]});return run;
    }
    await sleep(100);
  }throw Object.assign(Error('Strategy preparation timed out'),{preparationFailed:true});};
  const keep=async job=>{
    if(!job?.runId)return null;
    let run;try{run=await call('/internal/harness/runs/'+job.runId);}catch(error){if(error.status===404)return null;throw error;}
    const s=run.result?.strategy;
    if(run.request?.siteId!==siteId)return null;
    return s?.qualityReview?.status==='withdrawn'||['queued','running'].includes(run.status)||s&&Date.parse(s.expiresAt)>now()&&(reason!=='scheduled'||run.request.generatorMode==='configured')?{...job,preserved:true}:null;
  };
  for(const kind of includeTrees?['tapping_angle','surface_action','growth_plan','pest_risk']:[])for(let offset=0;offset<manifest.items.length;offset+=10){
    const prepared=await call('/api/demo/trees/prepare',{preparationId:`ui-${stamp}-${kind}-${offset}`,siteId,treeIds:manifest.items.slice(offset,offset+10).map(t=>t.treeId),kind,dataMode,generatorMode:'demo_rules',preserveConfigured:true,background:true,refreshReason:reason});
    preparations.push(prepared);for(const job of prepared.items)await wait({...job,kind});
  }
  const priorScenarios=old.filter(job=>!['market','park-health','industry','weather-reference'].includes(job.key));
  if(priorScenarios.length){
    for(const job of priorScenarios){const kept=await keep(job);if(kept)jobs.push(kept);else{const batch=await call('/api/demo/scenarios/run',{scenarioId:job.key,dataMode,siteId});jobs.push(...batch.items.map(t=>({...t,key:t.scenarioId})));}}
  }else{const batch=await call('/api/demo/scenarios/run',{scenarioId:'all',dataMode,siteId});jobs.push(...batch.items.map(t=>({...t,key:t.scenarioId})));}
  for(const [key,kind] of [['market','market_scenario'],['park-health','pest_risk']]){
    const kept=await keep(old.find(job=>job.key===key));if(kept){jobs.push(kept);continue;}
    const context=await call('/api/demo/contexts',{treeIds:manifest.items.map(t=>t.treeId),variant:'normal',siteId});
    const job=await call('/internal/harness/runs',{requestId:`ui-${stamp}-${key}`,kind,siteId:context.siteId,targetSnapshotId:context.targetSnapshotId,inputSnapshot:context.inputSnapshot,executionMode:'simulation',generatorMode:'demo_rules',trigger:{type:reason==='scheduled'?'scheduled':'event',eventId:`ui-${stamp}`}});jobs.push({...job,key,title:key});
  }
  // Industry is global rather than belonging to the selected park. Only the
  // Haikou snapshot writer prepares it; other parks reuse this same catalog.
  if(siteId==='demo-hainan')jobs.push(await prepareIndustry(call,{dataMode,stamp,now:now(),reason}));
  for(const job of jobs)if(!job.preserved&&!job.preservedConfigured)await wait(job);
  if(siteId==='demo-hainan')try{
    const kept=await keep(old.find(job=>job.key==='weather-reference'));
    if(kept)jobs.push(kept);
    else{
      const sources=await call('/api/sources'),weather=sources.sources.find(s=>s.id==='weather'),morning=jobs.find(j=>j.key==='morning');
      if(weather?.status==='available'&&morning){
        const context=await call('/internal/harness/runs/'+morning.runId+'/context');
        const steps=weather.data.forecast.filter(s=>Date.parse(s.validFrom)>=now()&&Number.isFinite(s.rainfallMm)&&Number.isFinite(s.rainProbabilityPct)).map(({validFrom,validTo,rainfallMm,rainProbabilityPct})=>({validFrom,validTo,rainfallMm,rainProbabilityPct}));
        if(steps.length){context.asOf=new Date(Math.max(now(),Date.parse(weather.retrievedAt))).toISOString();context.validUntil=new Date(Date.parse(context.asOf)+3600000).toISOString();context.snapshotId='ui-weather-'+stamp;context.modules.weather.forecast={forecastRunId:weather.snapshotId,issuedAt:weather.retrievedAt,issuedAtBasis:'retrieved',timezone:'Asia/Shanghai',steps,provenance:{sourceId:weather.snapshotId,sourceClass:'web_service',mode:'forecast'},quality:'valid'};context.sourceSnapshots=[weather.snapshotId];context.dataPolicy={mode:'mixed_demo',notices:['海口参考点预报用于模拟园区排程，不是已确认园区的实测天气。'],substitutions:[{module:'weather',sourceId:'demo-station-hn',reason:'现场观测为模拟值；预报来自海口参考点。'}]};
          const ref=await call('/api/contexts',context),job=await call('/internal/harness/runs',{requestId:'ui-reference-'+stamp,kind:'weather_window',siteId:ref.siteId,targetSnapshotId:ref.targetSnapshotId,inputSnapshot:ref.inputSnapshot,executionMode:'simulation',generatorMode:'demo_rules',trigger:{type:'event',eventId:'ui-reference-'+stamp}});await wait(job);jobs.push({...job,key:'weather-reference',title:'参考点预报排程模拟'});
        }
      }
    }
  }catch(error){if(error.preparationFailed)throw error;console.warn('Reference forecast not prepared:',error.message);}
  const items=[...new Set(outcomes.map(row=>row.kind))].map(kind=>{const rows=outcomes.filter(row=>row.kind===kind),needsData=rows.filter(row=>row.status==='needs_data').length;return {kind,status:needsData?'partial':'succeeded',needsData,...(needsData?{error:`${needsData} 项策略缺少必要业务数据，已保留待补充状态`}:{})};});
  return {preparedAt:new Date(now()).toISOString(),siteId,dataMode,reason,jobs,trees:manifest.items,items,
    summary:{prepared:preparations.reduce((n,p)=>n+p.items.length,0),preserved:preparations.reduce((n,p)=>n+(p.skipped?.length??0),0),scenarios:jobs.length,modelRequests:0}};
}

async function main(){
  const base=connectionConfig().backendUrl,siteId=process.env.HARNESS_SITE_ID||'demo-hainan',name=preparationSessionName(siteId);
  // Non-Haikou hourly work normally uses the backend internal service. This
  // CLI remains scoped to an explicitly authorized existing human/service role.
  const accountId=process.env.HARNESS_SERVICE_ACCOUNT||({'demo-hainan':'operator-hn','demo-xsbn':'manager-xs','demo-guangdong-maoming':'manager-gd'}[siteId]);
  if(!accountId)throw Error('该园区请使用后端内部策略刷新；脚本没有对应后台身份。');
  const session=await openServiceSession(base,{accountId});
  const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...session.headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok){const error=Error(`${path}: ${r.status} ${await r.text()}`);error.status=r.status;throw error;}return r.json();};
  try{
    let previous=null;try{previous=JSON.parse(await readFile(new URL('../public/'+name,import.meta.url),'utf8'));}catch{}
    const result=await prepareHarnessSnapshots(call,{siteId,dataMode:process.env.HARNESS_DATA_MODE||'mixed_demo',reason:process.env.HARNESS_PREPARE_REASON||'startup',includeTrees:process.env.HARNESS_PREPARE_TREES!=='0',previous});
    await mkdir(new URL('../public/',import.meta.url),{recursive:true});
    for(const dir of ['public','dist']){try{await access(new URL('../'+dir+'/',import.meta.url));}catch{continue;}const tmp=new URL('../'+dir+'/'+name.replace('.json','.next.json'),import.meta.url);await writeFile(tmp,JSON.stringify(result,null,2));await rename(tmp,new URL('../'+dir+'/'+name,import.meta.url));}
    console.log(JSON.stringify({type:'strategy-snapshots',siteId,...result.summary,items:result.items}));
  }finally{await session.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
