import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
import {digest} from './util.js';
import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';

const permissions={recompute_plan:'park_plan.write',adopt_plan:'park_plan.write',capture_tree:'reviews.write',batch_step:'logistics.write'};
const labels={recompute_plan:'重新计算生产计划',adopt_plan:'采用生产计划并排程',capture_tree:'派机器人补拍',batch_step:'处理收胶批次'};
const steps=['weigh','inspect','plan','dispatch','receive','process','pause','resume','cancel','hold','start-processing'];

/** Model may prepare an operation. Only an authenticated user's confirmation executes it. */
export class AssistantActions {
  constructor({store,simulation,reviews,observations,parkPlans,recompute,clock=()=>new Date()}) {
    Object.assign(this,{store,simulation,reviews,observations,parkPlans,recompute,clock});
    this.pending=new Map();
    store.db.exec('CREATE TABLE IF NOT EXISTS assistant_operations (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  save(value){this.store.db.prepare('INSERT OR REPLACE INTO assistant_operations VALUES(?,?)').run(value.id,JSON.stringify(value));return value;}
  get(id,session,identity){
    const row=this.store.db.prepare('SELECT body FROM assistant_operations WHERE id=?').get(id);
    invariant(row,'NOT_FOUND','操作不存在。',404);
    const operation=JSON.parse(row.body);
    invariant(identity && operation.accountId===identity.accountId && operation.sessionId===session.sessionId,'NOT_FOUND','操作不属于当前会话。',404);
    identity.require(permissions[operation.kind]);identity.requireSite(operation.siteId);
    return operation;
  }
  snapshot(kind,siteId,target){
    if(kind==='batch_step')return this.simulation.logistics.get(target,siteId);
    if(kind==='adopt_plan'){
      const plan=this.parkPlans.get(target);
      invariant(plan.siteId===siteId,'SITE_MISMATCH','计划不属于当前园区。',409);
      return plan;
    }
    if(kind==='capture_tree')return this.reviews.jobs(siteId).filter(job=>job.treeId===target);
    return null;
  }
  prepare(args,{session,identity,turn}){
    invariant(identity,'LOGIN_REQUIRED','请先登录。',401);
    invariant(permissions[args.kind],'INVALID_OPERATION','不支持此操作。');
    identity.require(permissions[args.kind]);identity.requireSite(session.siteId);
    let target=args.targetId??null,payload={};
    if(args.payloadJson){try{payload=JSON.parse(args.payloadJson);}catch{invariant(false,'INVALID_OPERATION','操作参数不是有效JSON。');}}
    invariant(payload&&typeof payload==='object'&&!Array.isArray(payload),'INVALID_OPERATION','请提供操作参数。');
    if(args.kind==='capture_tree'){
      const tree=resolveTreeIdentity(session.siteId,target??turn.treeId??'');
      invariant(tree,'INVALID_TREE','请先明确要补拍的树。');
      identity.requireTree(session.siteId,tree.treeId);
      invariant(session.siteId==='demo-hainan','CAPTURE_UNAVAILABLE','当前三维补拍支持海南海口园区。',409);
      target=tree.treeId;payload={treeLabel:tree.label};
    }
    if(args.kind==='batch_step'){
      invariant(steps.includes(args.step),'INVALID_OPERATION','请选择有效的批次操作。');
      const required={weigh:['grossKg','tareKg'],inspect:['sampleId','dryRubberPercent','decision'],plan:['destinationId','vehicleCode','driver','plannedDepartureAt'],receive:['receivedKg']}[args.step]??[];
      const missing=['note',...required].filter(key=>payload[key]===undefined||payload[key]===null||payload[key]==='');
      invariant(!missing.length,'MISSING_OPERATION_FIELDS',`操作参数缺少：${missing.join('、')}。请使用接口字段；如用户未提供，先追问。`);
      const numeric=['grossKg','tareKg','dryRubberPercent','receivedKg','processLossKg'];
      for(const key of numeric)if(payload[key]!==undefined)invariant(typeof payload[key]==='number'&&Number.isFinite(payload[key])&&payload[key]>=0,'INVALID_OPERATION',`${key} 必须为非负数。`);
      if(args.step==='inspect')invariant(payload.dryRubberPercent>0&&payload.dryRubberPercent<=100&&['pass','hold'].includes(payload.decision),'INVALID_OPERATION','dryRubberPercent 应为0到100的百分数，decision为pass或hold。');
      if(args.step==='weigh')invariant(payload.grossKg>payload.tareKg,'INVALID_OPERATION','毛重必须大于皮重。');
    }
    const snapshot=this.snapshot(args.kind,session.siteId,target);
    if(args.kind==='batch_step')payload={...payload,revision:snapshot.revision,operator:identity.accountId};
    const operation=this.save({id:`operation-${randomUUID()}`,sessionId:session.sessionId,turnId:turn.turnId,
      accountId:identity.accountId,siteId:session.siteId,kind:args.kind,targetId:target,step:args.step??null,payload,
      label:labels[args.kind],state:'prepared',fingerprint:digest(snapshot),createdAt:this.clock().toISOString(),expiresAt:new Date(+this.clock()+600000).toISOString()});
    return {data:operation,label:'准备操作',summary:`${operation.label}，等待确认。`,sourceRefs:[operation.id],
      actions:[{type:'execute',operationId:operation.id,label:operation.label}]};
  }
  async confirm(id,session,identity,authorize=()=>identity){
    const operation=this.get(id,session,identity);
    if(operation.state==='completed')return operation;
    if(this.pending.has(id))return this.pending.get(id);
    const run=this.perform(operation,session,authorize);
    this.pending.set(id,run);
    try{return await run;}finally{this.pending.delete(id);}
  }
  async perform(operation,session,authorize){
    const identity=authorize();this.get(operation.id,session,identity);
    invariant(Date.parse(operation.expiresAt)>+this.clock(),'OPERATION_EXPIRED','操作已过期，请重新准备。',409);
    invariant(digest(this.snapshot(operation.kind,operation.siteId,operation.targetId))===operation.fingerprint,'OPERATION_CHANGED','对象状态已变化，请重新查询并准备操作。',409);
    let result;
    if(operation.kind==='recompute_plan')result=await this.recompute(operation.siteId,authorize);
    else result=this.store.transaction(()=>{
      let value;
      if(operation.kind==='adopt_plan')value=this.parkPlans.adopt({planId:operation.targetId,siteId:operation.siteId,replace:operation.payload.replace===true},identity);
      else if(operation.kind==='capture_tree'){
        const [job]=this.reviews.create({siteId:operation.siteId,treeIds:[operation.targetId],kind:'capture',assignee:'robot',captureRequest:true});
        value=this.observations.start(job.id,{requestId:operation.id});
      } else value=this.simulation.logistics.transition(operation.targetId,operation.step,{...operation.payload,siteId:operation.siteId,requestId:operation.id});
      this.save({...operation,state:'completed',completedAt:this.clock().toISOString(),result:value});
      return value;
    });
    return this.save({...operation,state:'completed',completedAt:this.clock().toISOString(),result});
  }
}
