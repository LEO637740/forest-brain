import {useState,useSyncExternalStore} from 'react';
import {useRead} from './client';
import {getFleetSnapshot,subscribeFleet,cancelTree,pauseZone,fleetBlockReason,fleetZoneHoldReason,retryFleetValidation} from '../zoneFleet';
import {dispatchObservation} from '../observation/robotObservation';
import {alias} from './client';
import './observation.css';
export type ObservationJob={id:string;siteId:string;treeId:string;kind:string;status:string;observation?:{captureId:string;requestId?:string;status:string;message?:string;robotId:string};evidence?:{imagePath?:string}};
const labels:Record<string,string>={attachment:'待确认附着物',nodule:'疑似结节',bird_dropping:'鸟粪附着',mud:'泥巴附着',lesion:'疑似病斑',scar:'割面伤痕'};
export function ObservationEvidence({job,onChange}:{job:ObservationJob;onChange:()=>void}){
 const fleet=useSyncExternalStore(subscribeFleet,getFleetSnapshot),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [annotations,setAnnotations]=useState(true);
 const frame=useRead<{image:string;capturedAt:string;treeId:string;position:number[];annotationNote:string;annotations:{classCode:string}[]}>(job.evidence?.imagePath??null);
 const index=Number(job.treeId.slice(2))-1,zone=Math.floor(index/50),live=fleet.jobs[index]?.observation?.reviewId===job.id?fleet.jobs[index]:undefined,s=fleet.zones[zone];
 const phase=live?((s&&fleetZoneHoldReason(s,live))||fleetBlockReason(live)|| (s?.paused?'已暂停':s?.active!==index?'等待设备':s.phase==='moving'?'沿导轨前往目标':s.phase==='working'?'停靠拍照 · 刀具收回':'正在停止')):job.observation?.status==='dispatched'?'本轮尚无回执，可重新派出':job.observation?.status==='returned'?'画面已回传':job.observation?.status==='interrupted'?'补拍中断':'待派出';
 async function send(){setBusy(true);setError('');try{await dispatchObservation(job);onChange();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="observation" aria-label="机器人现场补拍"><header><strong>机器人补拍</strong><span>{phase}</span></header>
 <p>R-{'ABCD'[zone]} → {alias(job.treeId,job.siteId)} <small>模拟任务</small></p>
 <ol className="observation-steps" aria-label="补拍进度">{['前往','拍摄','回传','复核'].map((label,i)=>{const step=job.status==='completed'||job.status==='collected'?3:live&&s?.phase==='working'?1:job.observation?.status==='returned'?2:0;return <li key={label} aria-current={i===step?'step':undefined} className={i<step?'done':''}>{label}</li>;})}</ol>
 {!fleet.ready&&job.status!=='completed'&&<button onClick={()=>window.dispatchEvent(new CustomEvent('harness-open-review',{detail:{siteId:job.siteId,treeId:job.treeId,kind:'capture'}}))}>打开三维现场</button>}
 {job.status!=='completed'&&<div className="observation-actions">{live?<><button onClick={()=>pauseZone(zone,!s?.paused)}>{s?.paused?'继续补拍':'暂停设备'}</button><button onClick={()=>cancelTree(index)}>停止补拍</button></>:<button disabled={busy||!fleet.ready} onClick={send}>{busy?'正在派出…':job.evidence?.imagePath?'重新拍摄':'派机器人前往并拍照'}</button>}{live&&<button onClick={()=>window.dispatchEvent(new CustomEvent('zone-fleet-follow',{detail:zone}))}>跟随机器人</button>}</div>}
 {live?.validation==='invalid'&&<button onClick={()=>retryFleetValidation(index)}>重新核验补拍任务</button>}{job.observation?.status==='interrupted'&&job.observation.message&&<p role="alert">{job.observation.message}</p>}{error&&<p role="alert">{error}</p>}
 {frame.error&&<p role="alert">照片读取失败 <button onClick={frame.reload}>重新读取</button></p>}
 {frame.data&&<><div className="observation-frame"><img src={frame.data.image} alt={`${job.treeId} 的三维机器人相机回传画面`}/>{annotations&&<span className="observation-target">目标树干</span>}<b>{live?'上次照片 · 模拟':'模拟相机'}</b></div><p>{new Date(frame.data.capturedAt).toLocaleString('zh-CN')} · {alias(frame.data.treeId,job.siteId)}</p><p><strong>待核查：</strong>{frame.data.annotations.map(a=>labels[a.classCode]??a.classCode).join('、')||'树表与割线位置'}</p><small>标记来自已有记录，非本次图像识别。</small><details><summary>照片信息与标记</summary><label><input type="checkbox" checked={annotations} onChange={e=>setAnnotations(e.target.checked)}/> 显示目标定位框</label><p>{frame.data.annotationNote}</p><p>任务 {job.id} · 采集 {job.observation?.captureId}</p><p>相机位置 {frame.data.position.map(v=>v.toFixed(2)).join(' / ')}。到达目标后采集；照片不会自动解除异常或授权割胶。</p></details></>}
 </section>;
}
