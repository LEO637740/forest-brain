import {randomUUID} from 'node:crypto';
import {invariant} from './errors.js';

// Demo camera receipts are isolated from cutting receipts and never authorize a cut.
export class RobotObservation {
 constructor(reviews){this.reviews=reviews;this.db=reviews.store.db;this.db.exec('CREATE TABLE IF NOT EXISTS review_images (capture_id TEXT PRIMARY KEY, body TEXT NOT NULL)');}
 start(id,input={}){
  const job=this.reviews.get(id);
  if(job.observation?.status==='dispatched')return job;
  if(input.requestId){
   invariant(typeof input.requestId==='string'&&/^[\w-]{8,150}$/.test(input.requestId),'INVALID_CAPTURE_REQUEST','补拍请求编号无效',400);
   if(job.observation?.requestId===input.requestId&&['dispatched','returned'].includes(job.observation.status))return job;
  }
  invariant(job.siteId==='demo-hainan'&&job.kind!=='measure','CAPTURE_UNAVAILABLE','当前三维补拍仅支持海南树表或健康核查',409);
  invariant(['queued','collected'].includes(job.status),'REVIEW_CLOSED','已提交的复核不能覆盖，请创建新的核查',409);
  job.observation={captureId:'capture-'+randomUUID(),...(input.requestId?{requestId:input.requestId}:{}),status:'dispatched',requestedAt:this.reviews.clock().toISOString(),robotId:'R-'+'ABCD'[Math.floor((Number(job.treeId.slice(2))-1)/50)],mode:'scene_simulation'};
  return this.reviews.save(job,'camera_dispatched');
 }
 verify(id,captureId){const job=this.reviews.get(id);invariant(job.observation?.captureId===captureId&&job.observation.status==='dispatched'&&['queued','collected'].includes(job.status),'CAPTURE_STALE','补拍已结束或被新一轮替代',409);return job;}
 collect(id,input){
  let job=this.reviews.get(id);
  if(job.observation?.captureId===input.captureId&&job.observation.status==='returned')return job;
  job=this.verify(id,input.captureId);
  invariant(typeof input.image==='string'&&input.image.length<900000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.image),'INVALID_IMAGE','需要本次三维相机回传的 JPEG 图像',400);
  invariant(input.treeId===job.treeId&&input.width===640&&input.height===480,'WRONG_TARGET','相机回执对象或尺寸不匹配',400);
  invariant(Array.isArray(input.position)&&input.position.length===3&&input.position.every(Number.isFinite),'INVALID_CAMERA','缺少相机位置',400);
  const capturedAt=this.reviews.clock().toISOString();
  const issue=this.reviews.issues('demo',job.siteId).find(i=>i.treeId===job.treeId);
  const frame={reviewId:id,siteId:job.siteId,captureId:input.captureId,treeId:job.treeId,image:input.image,width:640,height:480,position:input.position,capturedAt,
   annotations:(issue?.detections??[]).filter(d=>d.reviewStatus!=='rejected').map(d=>({classCode:d.classCode,source:'existing_demo_record'})),
   annotationNote:'图像为三维相机渲染；待核查类别来自已有模拟记录，不是本图的视觉识别结果。'};
  this.db.prepare('INSERT INTO review_images VALUES(?,?)').run(input.captureId,JSON.stringify(frame));
  job.status='collected';job.observation={...job.observation,status:'returned',capturedAt};
  job.evidence={id:input.captureId,source:'三维机器人相机（模拟）',capturedAt,treeId:job.treeId,kind:job.kind,quality:'review_required',imagePath:`/api/simulation/reviews/${id}/photo/${input.captureId}`,note:'已到达目标并回传画面，等待人工确认；未自动消除异常'};
  return this.reviews.save(job,'camera_returned');
 }
 fail(id,input){const job=this.verify(id,input.captureId);job.observation={...job.observation,status:'interrupted',message:String(input.message||'采集未完成').slice(0,180)};return this.reviews.save(job,'camera_interrupted');}
 image(id,captureId){this.reviews.get(id);const row=this.db.prepare('SELECT body FROM review_images WHERE capture_id=?').get(captureId);invariant(row,'NOT_FOUND','图片尚未回传',404);const data=JSON.parse(row.body);invariant(data.reviewId===id&&data.treeId===this.reviews.get(id).treeId,'NOT_FOUND','图像不属于该树',404);return data;}
}
