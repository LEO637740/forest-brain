// MH simulation API extensions; immutable strategy schemas remain unchanged.
import {parks} from '../../shared/parkCatalog.ts';
const object={type:'object',additionalProperties:true};
const list={type:'array',items:object};
const items={type:'object',required:['items'],properties:{items:list}};
const response=schema=>({description:'Simulation response',content:{'application/json':{schema}}});
const endpoint=(summary,requestSchema,responseSchema=object,status=200)=>({summary,...(requestSchema?{requestBody:{required:true,content:{'application/json':{schema:requestSchema}}}}:{}),responses:{[status]:response(responseSchema),400:{description:'Invalid request'},409:{description:'Conflict or unavailable strategy'}}});
const site={type:'string',description:'Canonical demo-<park key> from the shared park catalog, or its short key. Scope selection is not user authorization.'};
const task={type:'object',required:['id','site','status'],properties:{id:{type:'string'},site:{enum:Object.keys(parks)},siteId:{...site,description:'When supplied, must agree with site; referenced strategy sites must also agree.'},status:{type:'string'},revision:{type:'integer',minimum:0}},additionalProperties:true};
const timestamp={type:'string',format:'date-time'};
const eventNote={type:'string',minLength:1,maxLength:1000,description:'Nonblank human-entered explanation, trimmed on save.'};
const eventZone={anyOf:[{type:'integer',minimum:0,maximum:3},{type:'null'}],description:'A–D = 0–3. Null means park-wide rain; device_fault requires a numbered zone.'};
const operationalEvent={type:'object',additionalProperties:false,required:['id','siteId','kind','zone','status','note','createdAt','mode'],properties:{
 id:{type:'string'},siteId:{enum:Object.values(parks).map(park=>park.siteId)},kind:{enum:['rain','device_fault']},zone:eventZone,
 status:{enum:['active','resolved','closed'],description:'active and resolved both block dispatch. resolved means cleared but awaiting human recovery confirmation; closed permits normal task revalidation, never automatic task restart.'},
 note:eventNote,createdAt:timestamp,resolvedAt:timestamp,resolutionNote:eventNote,closedAt:timestamp,resumeNote:eventNote,mode:{const:'simulation'}
}};
const operationalEvents={type:'array',items:operationalEvent};
const requestId={type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'};
const operator={type:'string',minLength:1,maxLength:100};
const point={type:'object',required:['id','name'],properties:{id:{type:'string'},name:{type:'string'}}};
const businessRecord={type:'object',required:['id','at','operator','note'],properties:{id:{type:'string'},at:timestamp,operator,note:eventNote}};
const recordWith=properties=>({...businessRecord,required:[...businessRecord.required,...Object.keys(properties)],properties:{...businessRecord.properties,...properties}});
const kg={type:'number',minimum:0,maximum:1000000,description:'kg fresh latex; never inferred from tree counts or converted to dry rubber. Rounded to 3 decimal places.'};
const logisticsBatch={type:'object',required:['id','siteId','revision','stage','mode','source','collection','inspections','history'],properties:{
 id:{type:'string'},siteId:site,revision:{type:'integer',minimum:1},mode:{const:'simulation'},
 stage:{enum:['collected','weighed','quality-held','ready','planned','in-transit','received','cancelled']},
 source:{type:'object',required:['taskId','taskRevision','taskTitle','taskStatus','treeIndices','completedTrees','completionKind','receipts'],properties:{
  taskId:{type:'string'},taskRevision:{type:'integer',minimum:1},taskTitle:{type:'string'},taskStatus:{enum:['已完成','已取消']},
  treeIndices:{type:'array',items:{type:'integer',minimum:0,maximum:199}},completedTrees:{type:'integer',minimum:1},
  completionKind:{enum:['rail','flow']},receipts:list}},
 collection:recordWith({point,containerCount:{type:'integer',minimum:1,maximum:10000}}),
 weighing:recordWith({grossKg:kg,tareKg:kg,netKg:kg}),
 inspections:{type:'array',items:recordWith({sampleId:{type:'string'},dryRubberPercent:{type:'number',exclusiveMinimum:0,maximum:100},decision:{enum:['pass','hold']}})},
 transport:{...recordWith({destination:point,vehicleCode:{type:'string'},driver:{type:'string'},plannedDepartureAt:timestamp,plannedKg:kg}),
  properties:{...recordWith({destination:point,vehicleCode:{type:'string'},driver:{type:'string'},plannedDepartureAt:timestamp,plannedKg:kg}).properties,
   departure:businessRecord,receipt:recordWith({receivedKg:kg,differenceKg:{type:'number',description:'receivedKg minus original netKg; discrepancies require the operation note.'}})}},
 manualHold:businessRecord,
 history:{type:'array',items:recordWith({action:{enum:['collect','weigh','inspect','plan','dispatch','receive','pause','resume','cancel']},requestId})}
}};
const logisticsBatches={type:'array',items:logisticsBatch};
export const integrationPaths={
 '/api/simulation/tasks':{get:endpoint('Latest authoritative task states, operational events and logistics batches using the same optional site scope',null,{type:'object',required:['items','operationalEvents','logisticsBatches'],properties:{items:{type:'array',items:task},operationalEvents,logisticsBatches}})},
 '/api/simulation/task-receipts':{
  get:endpoint('Latest receipt for each task',null,items),
  post:endpoint('Compare-and-set task batch; inspect conflicts even on HTTP 200',{type:'object',required:['tasks'],properties:{tasks:{type:'array',maxItems:1000,items:task}}},{type:'object',required:['accepted','tasks','conflicts','mode'],properties:{accepted:{type:'integer'},tasks:{type:'array',items:task},conflicts:list,mode:{const:'simulation'}}})
 },
 '/api/simulation/constraints':{get:endpoint('Latest adopted weather constraints plus explicit operational events; forecasts never create or resolve operational events',null,{type:'object',required:['siteId','constraints','operationalEvents','checkedAt'],properties:{siteId:site,constraints:list,operationalEvents,checkedAt:timestamp}})},
 '/api/simulation/operational-events':{
  get:endpoint('Explicit simulation event history; omit siteId to synchronize all parks',null,{type:'object',required:['siteId','items','checkedAt'],properties:{siteId:{anyOf:[site,{type:'null'}]},items:operationalEvents,checkedAt:timestamp}}),
  post:endpoint('Register an explicit rain/device fault; same requestId and facts return current state without reopening it',{type:'object',required:['requestId','siteId','kind','note'],properties:{requestId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},siteId:site,kind:{enum:['rain','device_fault']},zone:eventZone,note:eventNote}},operationalEvent)
 },
 '/api/simulation/logistics-batches':{
  get:endpoint('Persisted simulated collection-to-receipt batches; omit siteId for shared task synchronization',null,{type:'object',required:['siteId','items','checkedAt'],properties:{siteId:{anyOf:[site,{type:'null'}]},items:logisticsBatches,checkedAt:timestamp}}),
  post:endpoint('Collect once from a server-persisted, closed tapping task with verified completed trees',
   {type:'object',required:['requestId','siteId','taskId','operator','collectionPointId','containerCount','note'],properties:{requestId,siteId:site,taskId:{type:'string'},operator,collectionPointId:{type:'string'},containerCount:{type:'integer',minimum:1,maximum:10000},note:eventNote}},logisticsBatch)
 },
 '/api/simulation/strategy-validity':{post:endpoint('Check expected site, expiry, withdrawal, mode and latest binding before execution; mismatched site returns valid=false and site_mismatch',{type:'object',required:['strategies'],properties:{strategies:{type:'array',items:{type:'object',required:['treeId','strategyId','runId','revision'],properties:{treeId:{type:'string'},strategyId:{type:'string'},runId:{type:'string'},revision:{type:'integer'},siteId:site,dataMode:{enum:['demo','mixed_demo']}}}}}},items)},
 '/api/simulation/actions':{get:endpoint('Recent audit events (maximum 200); not effective constraint state',null,items),post:endpoint('Idempotently adopt current simulated angle, surface or weather strategy',object)},
 '/api/simulation/reviews':{get:endpoint('Review jobs and per-tree issues',null),post:endpoint('Create simulated collection or review jobs',object,items,201)},
 '/api/simulation/reviews/refresh':{post:endpoint('Regenerate four kinds in both demo and mixed_demo; eight run references tagged by dataMode',object,items,202)},
 '/api/simulation/market':{post:endpoint('Calculate and persist an explicitly simulated business scenario',object)},
 '/api/simulation/market/latest':{get:endpoint('Latest scenario and task plan',null)},
 '/api/simulation/market/{modelId}':{get:{...endpoint('Read simulated scenario',null),parameters:[{name:'modelId',in:'path',required:true,schema:{type:'string'}}]}},
 '/api/simulation/market-plan':{post:endpoint('Create simulated market-linked tasks subject to tree eligibility',object)},
 '/api/demo/analytics':{get:{...endpoint('Simulated daily series with site/date/source metadata',null),parameters:[{name:'site',in:'query',schema:{enum:Object.keys(parks)}},{name:'days',in:'query',schema:{type:'integer',minimum:7,maximum:90}}]}},
 '/api/demo/scenarios/run':{post:endpoint('Prepare explicitly simulated or mixed-demo scenario snapshots; read-only views do not create runs',{type:'object',required:['scenarioId'],properties:{scenarioId:{type:'string'},dataMode:{enum:['demo','mixed_demo']}}},items,202)},
};
for(const action of ['collect','complete','regenerate','events'])integrationPaths['/api/simulation/reviews/{jobId}/'+action]={[action==='events'?'get':'post']:{...endpoint('Simulated review '+action,action==='events'?null:object),parameters:[{name:'jobId',in:'path',required:true,schema:{type:'string'}}]}};

for(const path of ['/api/simulation/tasks','/api/simulation/task-receipts','/api/simulation/actions','/api/simulation/constraints','/api/simulation/operational-events','/api/simulation/logistics-batches','/api/simulation/reviews','/api/simulation/market/latest','/api/simulation/market/{modelId}']){
 const scopedDefault=['/api/simulation/actions','/api/simulation/constraints','/api/simulation/reviews','/api/simulation/market/latest'].includes(path);
 const operation=integrationPaths[path].get;
 operation.parameters=[...(operation.parameters??[]),{name:'siteId',in:'query',required:false,description:scopedDefault?'Defaults to Hainan; historical unscoped records belong only to Hainan.':'Optional scope filter; omit to preserve the existing global task synchronization or unique-resource lookup.',schema:{...site,...(scopedDefault?{default:'demo-hainan'}:{})}}];
 operation.responses[404]={description:'The unique resource does not belong to the requested site'};
}
for(const action of ['collect','complete','regenerate','events']){
 const operation=integrationPaths['/api/simulation/reviews/{jobId}/'+action][action==='events'?'get':'post'];
 operation.parameters.push({name:'siteId',in:'query',required:false,schema:site,description:'When supplied, the job must belong to this site; a mismatch returns 404 before any write.'});
 operation.responses[404]={description:'Review job missing from this site'};
}
integrationPaths['/api/simulation/actions'].post.description='Optional body.siteId must match the referenced strategy; a mismatch returns 409 STRATEGY_CHANGED with details.status=site_mismatch. Audit filtering happens before the 200-record limit.';
integrationPaths['/api/simulation/market-plan'].post.description='Optional body.siteId must match the model, otherwise 409 SITE_MISMATCH. Tree reservations are evaluated only within that park.';
integrationPaths['/api/simulation/constraints'].get.description='Only this park is returned; same-numbered trees in other parks cannot replace its newest adopted weather constraint. Response includes canonical siteId.';
integrationPaths['/api/simulation/strategy-validity'].post.description='An otherwise valid strategy for a tree affected by an active or resolved operational event returns valid=false, status=operational_hold, reason and operationalEventIds. This blocks dispatch without withdrawing or replacing the original strategy.';
for(const action of ['resolve','resume'])integrationPaths['/api/simulation/operational-events/{eventId}/'+action]={post:{
 ...endpoint(action==='resolve'?'Record abnormal condition cleared; dispatch remains blocked pending recovery confirmation':'Confirm recovery conditions after resolution; close only this event, without starting tasks or modifying receipts',
 {type:'object',required:['siteId','note'],properties:{siteId:site,note:eventNote}},operationalEvent),
 parameters:[{name:'eventId',in:'path',required:true,schema:{type:'string'}}],
 description:'Site must match. Same transition and note are idempotent; a later state is returned unchanged. Changed notes conflict. Event and task receipt histories are retained.'
}};
const businessActionFields={
 weigh:{grossKg:kg,tareKg:kg},
 inspect:{sampleId:{type:'string',minLength:1,maxLength:100},dryRubberPercent:{type:'number',exclusiveMinimum:0,maximum:100},decision:{enum:['pass','hold']}},
 plan:{destinationId:{type:'string'},vehicleCode:operator,driver:operator,plannedDepartureAt:timestamp},
 dispatch:{},receive:{receivedKg:kg},pause:{},resume:{},cancel:{},
};
for(const [action,fields] of Object.entries(businessActionFields))integrationPaths['/api/simulation/logistics-batches/{batchId}/'+action]={post:{
 ...endpoint('Record simulated business action: '+action,{type:'object',required:['requestId','siteId','revision','operator','note',...Object.keys(fields)],
  properties:{requestId,siteId:site,revision:{type:'integer',minimum:1},operator,note:eventNote,...fields}},logisticsBatch),
 parameters:[{name:'batchId',in:'path',required:true,schema:{type:'string'}}],
 description:'One transaction checks scope, immutable request identity, CAS revision, shared business stage and relevant event holds. An identical request retry returns the current batch even after later steps. Changed request facts and stale revisions return 409. Rain blocks new collection/departure, including resolved events awaiting recovery; indoor records and already happened arrivals remain recordable. Manual holds require their own explicit resume. Quality hold permits append-only reinspection. Received/cancelled batches and upstream task receipts remain immutable.',
 responses:{...endpoint('',null,logisticsBatch).responses,404:{description:'Batch missing from selected park'}}
}};
integrationPaths['/api/simulation/logistics-batches'].post.description='No quantity is inferred from completed trees. The service freezes only verified completed trees/receipts from a closed task; a partially cancelled rail run can contribute its verified completed trees. Bare completed labels, ongoing tasks, zero completed trees and Xi’an trial tasks are ineligible. One batch per task, including cancelled batches; points/factories must belong to that park. Rain prevents new collection. No real collection, scale, lab or vehicle connection is invoked.';
integrationPaths['/api/simulation/logistics-batches'].post.responses[404]={description:'Source task missing from selected park'};
