import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {digest} from './util.js';
import {makeParkContext,TREE_IDS,normalizeSiteId,parkSite} from './adapters/park-demo.js';
import {validate} from './schema.js';
import {contextSchema} from './contracts.js';
import {integrationContext} from './tree-context.js';
import {FieldTreeRecords} from './field-trees.js';
import {assessParkReadiness} from './tree-readiness.js';

function taskBelongsToSite(task, siteId) {
 if(task.site!==parkSite(siteId).key)return false;
 try{return task.siteId===undefined||normalizeSiteId(task.siteId)===siteId;}catch{return false;}
}

// Simulation-only evidence collection. Never sends commands to physical devices.
export class ReviewWorkflow {
 constructor(store,clock,runtime,service=null,fieldTrees=new FieldTreeRecords(store,clock)){this.store=store;this.clock=clock;this.runtime=runtime;this.service=service;this.fieldTrees=fieldTrees;store.db.exec('CREATE TABLE IF NOT EXISTS review_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS review_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, body TEXT NOT NULL)');}
 jobs(siteId=null){
  const jobs=this.store.db.prepare('SELECT body FROM review_jobs ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));
  if(siteId===null)return jobs;
  const selected=normalizeSiteId(siteId);
  // Unscoped historical reviews were created for the original Hainan demo.
  return jobs.filter(job=>normalizeSiteId(job.siteId??'demo-hainan')===selected);
 }
 save(job,event){this.store.transaction(()=>{this.store.db.prepare('INSERT INTO review_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(job.id,JSON.stringify(job));this.store.db.prepare('INSERT INTO review_events(job_id,body) VALUES(?,?)').run(job.id,JSON.stringify({at:this.clock().toISOString(),event,status:job.status,evidence:job.evidence,conclusion:job.conclusion,note:job.note,runs:job.runs}));});return job;}
 get(id){const row=this.store.db.prepare('SELECT body FROM review_jobs WHERE id=?').get(id);invariant(row,'NOT_FOUND','核查任务不存在',404);return JSON.parse(row.body);}
 apply(context){const c=structuredClone(context),now=Date.parse(c.asOf);const jobs=this.jobs(c.siteId).filter(j=>j.status==='completed'&&Date.parse(j.expiresAt)>now&&Date.parse(j.completedAt)<=now);
  for(const tree of c.modules.trees||[]){const measure=jobs.find(j=>j.treeId===tree.treeId&&j.kind==='measure');if(measure){tree.circumferenceCm=measure.evidence.circumferenceCm;tree.measuredAt=measure.completedAt;tree.provenance={sourceClass:'sensor_device',sourceId:measure.id,mode:'simulated'};if(c.dataPolicy)c.dataPolicy.substitutions.push({module:'trees',sourceId:measure.id,reason:'树围来自已完成的模拟补测；不是现场实测。'});c.modules.growth?.measurements.push({observationId:measure.id,treeId:tree.treeId,observedAt:measure.completedAt,circumferenceCm:tree.circumferenceCm,measurementHeightM:1.3,provenance:{sourceClass:'sensor_device',sourceId:measure.id,mode:'simulated'},quality:'valid'});}
   const review=jobs.find(j=>j.treeId===tree.treeId&&j.kind!=='measure'&&j.purpose!=='health');if(review){for(const e of c.modules.inspection?.evidence||[]){if(e.treeId!==tree.treeId)continue;e.evidenceId=review.id;e.capturedAt=review.evidence.capturedAt;e.geometryRegistered=true;e.provenance={sourceClass:'sensor_device',sourceId:review.id,mode:'simulated'};if(review.conclusion==='clear')e.detections=e.detections.map(d=>({...d,reviewStatus:'rejected'}));}
   }
   const healthReview=jobs.find(j=>j.treeId===tree.treeId&&j.kind==='inspect'&&(j.purpose==='health'||!j.purpose));
   if(healthReview&&c.modules.health){const symptoms=[...new Set(c.modules.health.records.filter(r=>r.treeId===tree.treeId).flatMap(r=>r.symptomCodes))];c.modules.health.records.push({recordId:healthReview.id,treeId:tree.treeId,observedAt:healthReview.completedAt,symptomCodes:healthReview.conclusion==='clear'?[]:symptoms,confirmedDiagnosis:null,provenance:{sourceClass:'sensor_device',sourceId:healthReview.id,mode:'simulated'},quality:'valid'});}
  }c.snapshotId='input-'+digest(c).slice(0,24);return this.fieldTrees.apply(c);
 }
 issues(dataMode='demo',siteId='demo-hainan'){invariant(['demo','mixed_demo'].includes(dataMode),'INVALID_DATA_MODE','数据模式无效',400);siteId=normalizeSiteId(siteId);const today=new Date(+this.clock()+8*3600000).toISOString().slice(0,10);const tasks=this.store.db.prepare('SELECT body FROM simulation_task_receipts WHERE rowid IN (SELECT MAX(rowid) FROM simulation_task_receipts GROUP BY task_id)').all().map(r=>JSON.parse(r.body)).filter(t=>taskBelongsToSite(t,siteId)&&(t.sourceScenarioId||t.sourceParkPlanId)&&t.status!=='已取消'&&Math.abs(Date.parse(t.date)-Date.parse(today))<7*86400000);const jobs=this.jobs(siteId);const c=this.apply(makeParkContext({now:this.clock(),siteId}));const readiness=assessParkReadiness({siteId,context:c,now:this.clock(),store:this.store,simulation:this.simulation,dispatchDataMode:dataMode});const pending=new Map(readiness.reviewTrees.map(tree=>[tree.treeId,tree]));return c.modules.trees.map(tree=>{
   const evidence=c.modules.inspection.evidence.find(e=>e.treeId===tree.treeId),review=pending.get(tree.treeId);let code=review?.reviewKind??'ready',reason=review?.reasons.join('；')??'可进入作业检查';
   const plannedTasks=tasks.filter(t=>t.treeIndices?.includes(Number(tree.treeId.slice(2))-1)).map(t=>({id:t.id,title:t.title,date:t.date,status:t.status}));if(code==='ready'&&plannedTasks.length){code='planned';reason='已在近期计划中，无需重复安排';}
   return {plannedTasks,treeId:tree.treeId,block:tree.blockId,code,reason,circumferenceCm:tree.circumferenceCm,detections:evidence.detections,health:c.modules.health.records.filter(r=>r.treeId===tree.treeId&&r.symptomCodes.length),job:jobs.find(j=>j.treeId===tree.treeId)};
  });}
 create(input){invariant(Array.isArray(input.treeIds)&&input.treeIds.length>0&&input.treeIds.length<=200&&new Set(input.treeIds).size===input.treeIds.length&&input.treeIds.every(id=>TREE_IDS.includes(id)),'INVALID_TREES','请选择园区内的树',400);invariant(['capture','measure','inspect'].includes(input.kind)&&['robot','human'].includes(input.assignee),'INVALID_REVIEW','核查类型或执行方式无效',400);invariant(input.kind!=='inspect'||input.assignee==='human','INVALID_REVIEW','异常评估需人工复核',400);const siteId=normalizeSiteId(input.siteId??'demo-hainan');
  const issues=this.issues(input.dataMode??'demo',siteId),existing=this.jobs(siteId);const proposed=input.treeIds.map(treeId=>{const prior=existing.find(j=>j.treeId===treeId&&j.kind===input.kind&&(j.purpose??'surface')===(input.purpose??'surface')&&!['completed','cancelled'].includes(j.status));if(prior)return prior;const issue=issues.find(t=>t.treeId===treeId);invariant(issue.code===input.kind||input.kind==='capture'&&input.captureRequest===true&&siteId==='demo-hainan'&&issue.code!=='rest'||input.kind==='measure'&&input.purpose==='growth'||input.kind==='inspect'&&(issue.health.length||input.captureRequest===true&&siteId==='demo-hainan'&&issue.code!=='rest'),'INVALID_REVIEW','该树当前不需要此类核查',409);return {id:'review-'+randomUUID(),treeId,siteId,...(input.purpose?{purpose:input.purpose}:{}),kind:input.kind,assignee:input.assignee,status:'queued',reason:issue.reason,createdAt:this.clock().toISOString(),mode:'simulation'};});return proposed.map(job=>existing.some(j=>j.id===job.id)?job:this.save(job,'created'));
 }
 collect(id,input={}){const job=this.get(id);invariant(!job.observation,'CAMERA_REQUIRED','请通过三维相机完成本次补拍',409);if(job.kind==='measure'&&input.circumferenceCm!==undefined)invariant(Number.isFinite(input.circumferenceCm)&&input.circumferenceCm>=10&&input.circumferenceCm<=200,'INVALID_MEASUREMENT','树围需为10至200厘米',400);if(job.status!=='queued')return job;const n=Number(job.treeId.slice(2));job.status='collected';job.evidence={id:'evidence-'+randomUUID(),source:job.assignee==='robot'?'模拟机器人采集':'模拟人工采集',capturedAt:this.clock().toISOString(),treeId:job.treeId,kind:job.kind,quality:'usable',...(job.kind==='measure'?{circumferenceCm:input.circumferenceCm??(48+n%24),measurementHeightM:1.3}:{geometryRegistered:true,note:job.kind==='capture'?'模拟补拍完成，需确认标记是否为误报或已清除':'模拟现场巡查完成，需填写结论；不是病害确诊',diagram:true})};return this.save(job,'collected');}
 async complete(id,input){let job=this.get(id);if(job.status==='completed'){invariant(input.note?.trim()===job.note&&(job.kind==='measure'||input.conclusion===job.conclusion),'REVIEW_CONFLICT','已提交的核查不可改写，请创建新的核查',409);return job;}invariant(job.observation?.status!=='dispatched','CAMERA_PENDING','补拍尚未返回，请等待或停止采集',409);invariant(job.status==='collected','NO_EVIDENCE','请先采集核查证据',409);invariant(typeof input.note==='string'&&input.note.trim().length>=2&&input.note.length<=1000,'NOTE_REQUIRED','请填写核查依据',400);invariant(job.kind==='measure'||['clear','blocked'].includes(input.conclusion),'INVALID_CONCLUSION','请选择复核结论',400);
  job={...job,status:'completed',completedAt:this.clock().toISOString(),expiresAt:new Date(+this.clock()+24*3600000).toISOString(),conclusion:job.kind==='measure'?'measured':input.conclusion,note:input.note.trim()};this.save(job,'reviewed');
  return this.regenerate(id);
 }
 async regenerate(id){const job=this.get(id);invariant(job.status==='completed','NOT_REVIEWED','先提交核查结果',409);job.runs=await this.refresh(job.treeId,job.siteId??'demo-hainan');return this.save(job,'regenerated');}
 async refresh(treeId,siteId='demo-hainan'){
  siteId=normalizeSiteId(siteId);
  invariant(TREE_IDS.includes(treeId),'INVALID_TREE','树不存在',404);
  const result=[],now=this.clock();
  for(const dataMode of ['demo','mixed_demo']){
   const context=validate(contextSchema,integrationContext({treeIds:[treeId],siteId,dataMode,now,service:this.service,reviews:this}));
   this.store.saveContext(context);
   for(const kind of ['surface_action','tapping_angle','growth_plan','pest_risk']){
    const requestId='review-'+randomUUID();
    const run=this.runtime.submit({requestId,kind,siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation',generatorMode:'demo_rules',trigger:{type:'user',eventId:requestId}});
    this.store.bindTreeView({treeId,siteId,kind,dataMode,preparationId:requestId,requestId,runId:run.runId,contextSnapshotId:context.snapshotId,asOf:context.asOf});
    result.push({kind,dataMode,runId:run.runId});
   }
  }
  return result;
 }
}
