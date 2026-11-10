import {useState} from 'react';
import {post,read,sessionToken,useRead} from '../integration/client';
import {assistantSessionPath} from '../integration/assistantClient';

type Operation={id:string;label:string;kind:string;targetId:string|null;step:string|null;state:string;siteId:string;payload:Record<string,unknown>;result?:{id?:string;status?:string;stage?:string;adoption?:{taskIds:string[];skipped?:{zone:string;date:string;reason:string}[]};observation?:{status:string}}};
const names:Record<string,string>={grossKg:'毛重（kg）',tareKg:'皮重（kg）',netKg:'净重（kg）',drcPct:'干胶含量（%）',dryRubberPercent:'干胶含量（%）',sampleId:'样本编号',decision:'质检结论',destinationId:'目的地',vehicleCode:'车牌',driver:'驾驶员',plannedDepartureAt:'计划发车时间',dryKg:'干胶产出（kg）',lossKg:'损耗（kg）',note:'依据',replace:'替换未开始的旧任务',treeLabel:'树木',receivedKg:'签收重量（kg）'};
export function AssistantOperation({sessionId,operationId,onClose}:{sessionId:string;operationId:string;onClose:()=>void}){
  const path=`${assistantSessionPath(sessionId)}/operations/${encodeURIComponent(operationId)}`;
  const state=useRead<Operation>(path);
  const [receipt,setReceipt]=useState<Operation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const operation=receipt??state.data;
  function resumeCapture(value:Operation){
    window.dispatchEvent(new CustomEvent('harness-open-review',{detail:{siteId:value.siteId,treeId:value.targetId,kind:'capture'}}));
    window.dispatchEvent(new CustomEvent('harness-assistant-capture',{detail:{id:value.result?.id,siteId:value.siteId,treeId:value.targetId,requestId:value.id}}));
  }
  async function confirm(){
    if(!operation||busy)return;
    const token=sessionToken();
    if(!token){setError('登录身份已失效，请重新选择身份。');return;}
    setBusy(true);setError('');
    const identityError=(message:string)=>/登录|身份|权限|无权|不属于当前会话/.test(message);
    const receive=(done:Operation)=>{
      if(sessionToken()!==token)throw Error('登录身份已变更，请重新读取。');
      if(done.id!==operationId)throw Error('操作回执不匹配，请重新读取。');
      setReceipt(done);
      if(done.state!=='completed')return;
      if(done.kind==='capture_tree')resumeCapture(done);
      for(const event of ['harness-tasks-created','harness-logistics-changed','harness-reviews-changed'])window.dispatchEvent(new Event(event));
    };
    try{
      // Recomputing includes tree-strategy preparation and a model call, as on the plan page.
      receive(await post<Operation>(`${path}/confirm`,{},operation.kind==='recompute_plan'?{timeoutMs:180_000}:undefined));
    }catch(e){
      const message=(e as Error).message;
      if(sessionToken()!==token||identityError(message)){setError(message);return;}
      // The server may have committed before the response was lost. Read this same
      // operation once; never prepare a new operation or automatically execute it again.
      try{
        const saved=await read<Operation>(path);
        receive(saved);
        if(saved.state!=='completed')setError(message);
      }catch(recoveryError){
        const recoveryMessage=(recoveryError as Error).message;
        setError(sessionToken()!==token?'登录身份已变更，请重新读取。':identityError(recoveryMessage)?recoveryMessage:message);
      }
    }finally{setBusy(false);}
  }
  if(!operation)return <p role="status">{state.error??'正在读取操作…'}</p>;
  return <section className="ba-operation" aria-label="操作确认">
    <h3>{operation.label}</h3>
    {operation.targetId&&<p>{String(operation.payload.treeLabel??operation.targetId)}</p>}
    {operation.step&&<p>批次操作：{({weigh:'称重',inspect:'质检/复检',plan:'安排收运',dispatch:'发车',receive:'签收',process:'加工入库',hold:'冻结',resume:'恢复',pause:'暂停',cancel:'取消','start-processing':'开始加工'} as Record<string,string>)[operation.step]??operation.step}</p>}
    {Object.entries(operation.payload).filter(([key])=>!['treeLabel','revision','operator'].includes(key)).length>0&&<dl>{Object.entries(operation.payload).filter(([key])=>!['treeLabel','revision','operator'].includes(key)).map(([key,value])=><div key={key}><dt>{names[key]??key}</dt><dd>{typeof value==='boolean'?(value?'是':'否'):typeof value==='object'?JSON.stringify(value):String(value)}</dd></div>)}</dl>}
    {operation.state==='completed'?<><p role="status">{operation.kind==='capture_tree'?'补拍任务已派发，可查看现场回传。':operation.kind==='adopt_plan'?`已排程 ${operation.result?.adoption?.taskIds.length??0} 项作业。`:operation.kind==='recompute_plan'?'新方案已生成，尚未采用。':`批次已更新：${operation.result?.stage??'已处理'}`}</p>
      {operation.kind==='adopt_plan'&&operation.result?.adoption?.skipped?.map(item=><p key={item.zone+item.date}>{item.zone}区 · {item.date}：{item.reason}</p>)}
      {operation.kind==='batch_step'&&<button onClick={()=>window.dispatchEvent(new CustomEvent('harness-open-logistics',{detail:{site:operation.siteId.replace(/^demo-/,''),id:operation.targetId}}))}>查看批次</button>}
      {operation.kind==='capture_tree'&&<button onClick={()=>resumeCapture(operation)}>查看补拍</button>}
      {['adopt_plan','recompute_plan'].includes(operation.kind)&&<button onClick={()=>window.dispatchEvent(new CustomEvent('harness-open-park-plan',{detail:{site:operation.siteId.replace(/^demo-/,''),planId:operation.result?.id}}))}>查看生产计划</button>}
    </>:<button className="rb-button rb-primary" disabled={busy} onClick={confirm}>{busy?'正在执行…':'确认执行'}</button>}
    <button className="rb-button" disabled={busy} onClick={onClose}>关闭</button>
    {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  </section>;
}
