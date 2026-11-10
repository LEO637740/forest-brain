import type {TaskSyncState} from './taskSyncController';
import './taskSyncStatus.css';

const phaseLabels:Record<TaskSyncState['phase'],string>={
 loading:'正在读取任务记录',
 syncing:'正在同步任务记录',
 synced:'服务端已确认',
 pending:'浏览器更新待确认',
 error:'任务记录同步失败',
 conflict:'任务记录需核对',
};

function confirmedTime(value:number|null){
 if(value===null||!Number.isFinite(value))return '尚无成功同步记录';
 return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(value)+'（北京时间）';
}

export function TaskSyncStatus({state,onRetry,storageError}:{state:TaskSyncState;onRetry:()=>void;storageError?:string}){
 const label=storageError?'本地保存异常':phaseLabels[state.phase];
 const tone=storageError||state.phase==='error'?'error':state.phase==='conflict'||state.phase==='pending'?'warning':state.phase==='synced'?'success':'working';
 return <details className={'ws-task-sync ws-task-sync--'+tone} aria-label="全部园区任务记录同步状态">
  <summary aria-label={'任务记录同步状态：'+label}>
   <span className="ws-task-sync-dot" aria-hidden="true"/>
   <span className="ws-task-sync-label" role="status" aria-live="polite" aria-atomic="true">{label}{state.pendingCount>0&&<small>{state.pendingCount} 条待确认</small>}</span>
  </summary>
  <div className="ws-task-sync-body" aria-busy={state.busy}>
   <header><strong>任务记录同步</strong><span>全部园区</span></header>
   <p className="ws-task-sync-explanation">浏览器中的任务更新需要同步到服务端；服务端确认前，不能视为已提交。</p>
   <dl>
    <div><dt>待服务端确认</dt><dd>{state.pendingCount} 条</dd></div>
    <div><dt>最近成功同步</dt><dd>{confirmedTime(state.lastSuccessAt)}</dd></div>
   </dl>
   {!state.hydrated&&<p className="ws-task-sync-warning">尚未取得服务端任务记录，请同步成功后再开始作业。</p>}
   {state.phase==='error'&&state.hydrated&&<p className="ws-task-sync-warning">最近一次成功同步后的变化尚未核实，当前任务记录可能与服务端不一致。</p>}
   {state.error&&<p className="ws-task-sync-error" role="alert">同步失败：{state.error}</p>}
   {storageError&&<p className="ws-task-sync-error" role="alert">本地保存失败：{storageError}。当前浏览器中的更新可能在刷新或关闭页面后丢失。</p>}
   {state.conflicts.length>0&&<section className="ws-task-sync-conflicts" aria-label="需要核对的任务">
    <strong>需要核对的任务</strong>
    <ul>{state.conflicts.map((conflict,index)=><li key={conflict.taskId+'-'+index}>
     <span>任务 {conflict.taskId}</span>
     <p>{conflict.message}</p>
     {!conflict.task&&<p>服务端未返回此任务记录。已保留本地内容，请核对并修正任务后再同步。</p>}
    </li>)}</ul>
   </section>}
   {state.notice&&<p className="ws-task-sync-notice">{state.notice}</p>}
   <button className="ws-secondary" type="button" disabled={state.busy} onClick={onRetry}>{state.busy?'正在同步…':'重新同步'}</button>
  </div>
 </details>;
}
