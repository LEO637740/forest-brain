import {useEffect,useState,useSyncExternalStore} from 'react';
import {getFleetSnapshot,subscribeFleet,pauseZone,cancelTree,retryFleetValidation,resetZonePosition,fleetBlockReason,fleetZoneHoldReason,type FleetJob,type FleetSnapshot,type ZoneState} from '../zoneFleet';
import {sameDispatchJob} from '../fleetJobIdentity';
import {treeAlias,type Task} from './model';
const phaseName={idle:'空闲',moving:'前往',working:'割胶中',retracting:'收臂中'};
const photoPhaseName={idle:'空闲',moving:'前往补拍点',working:'拍照中',retracting:'正在停止补拍'};
function zoneStatus(s:ZoneState,fleet:FleetSnapshot){
 const labels=s.active!==null&&fleet.jobs[s.active]?.observation?photoPhaseName:phaseName;
 const hold=s.active!==null?fleetZoneHoldReason(s,fleet.jobs[s.active]):s.eventHoldReason;
 if(hold)return s.phase==='retracting'?labels.retracting+' · '+hold:hold;
 if(s.phase==='retracting')return s.paused?labels.retracting+' · 本区暂停':labels.retracting;
 if(s.paused)return '已暂停';
 if(s.active!==null)return fleetBlockReason(fleet.jobs[s.active])?'等待处理':labels[s.phase];
 if(s.queue.some(i=>fleetBlockReason(fleet.jobs[i])))return '等待处理';
 return s.queue.length?'等待作业窗口':'空闲';
}
export function ZoneTaskControls({index,expectedJob}:{index:number;expectedJob:FleetJob}){
 const fleet=useSyncExternalStore(subscribeFleet,getFleetSnapshot),s=fleet.zones.find(zone=>zone.zone===Math.floor(index/50)),job=fleet.jobs[index];
 if(!Number.isInteger(index)||index<0||index>=200||!fleet.ready||!s||!job||(s.active!==index&&!s.queue.includes(index))||!sameDispatchJob(expectedJob,job))return null;
 const expected=structuredClone(job);
 const photo=Boolean(job.observation),labels=photo?photoPhaseName:phaseName;
 const active=s.active===index,retracting=active&&s.phase==='retracting',pending=job.validation==='pending',hold=fleetZoneHoldReason(s,job);
 const canRecheck=!retracting&&!(active&&s.phase==='working'&&job.validation==='valid')&&(hold||pending||job.validation==='invalid'||job.weatherBlock||(job.notAfter??Infinity)<=Date.now());
 return <section aria-label="机器人执行控制"><p aria-live="polite">{retracting?(photo?'正在停止补拍，完成后记录取消':'正在收臂，完成后记录取消'):hold||(pending?(photo?'正在核对补拍目标与任务':'正在核验策略和天气约束'):fleetBlockReason(job)||((job.notBefore??0)>Date.now()?'等待 '+new Date(job.notBefore!).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}):s.paused?'本区已暂停':active?labels[s.phase]:'等待本区机器人'))}</p>
 {photo?<p>补拍目标 {treeAlias(index)} · 模拟相机</p>:<p>方案 {job.planVersion} · 坡角 {job.angle}°</p>}
 {hold&&<p>{retracting?hold+'。':''}请在任务中心“天气与设备联动”中处理影响并确认恢复；事件恢复后会重新核验作业条件。</p>}
 {s.paused&&<p>{hold?'同时保留手工暂停；事件恢复后，仍需点击“继续本区作业”。':retracting?(photo?'补拍停止后本区仍保持暂停，后续任务继续排队。':'收臂完成后本区仍保持暂停，后续任务继续排队。'):'本区已暂停；核验不会恢复作业，准备好后请点击“继续本区作业”。'}</p>}
 {s.phase!=='retracting'&&<button className="ws-secondary" disabled={s.paused&&!!hold} onClick={()=>pauseZone(s.zone,!s.paused,{index,job:expected,paused:s.paused})}>{s.paused?'继续本区作业':'暂停本区作业'}</button>}{' '}
 {canRecheck&&<button className="ws-secondary" disabled={pending||!!hold} onClick={()=>retryFleetValidation(index,expected)}>{pending?'核验中…':'重新核验'}</button>}{' '}
 <button className="ws-secondary" disabled={retracting} onClick={()=>cancelTree(index,expected)}>{photo?(retracting?'正在停止补拍…':active?'停止补拍':'取消补拍排队'):retracting?'正在收臂…':active?'停止本次并收臂':'取消排队'}</button>
 </section>;
}
export function ZoneTreeDispatch({index,onArrange}:{index:number;onArrange:()=>void}){
 const fleet=useSyncExternalStore(subscribeFleet,getFleetSnapshot),zone=Math.floor(index/50),state=fleet.zones[zone];
 const active=state?.active===index,position=state?.queue.indexOf(index)??-1;
 const [following,setFollowing]=useState<number|null>(null);useEffect(()=>{const f=(e:Event)=>setFollowing((e as CustomEvent).detail);window.addEventListener('zone-follow-state',f);return()=>window.removeEventListener('zone-follow-state',f);},[]);
 return <section aria-label="本区机器人"><h3>{'ABCD'[zone]}区机器人 · {state?zoneStatus(state,fleet):'准备中'}</h3>
  <p>{state&&fleetZoneHoldReason(state,fleet.jobs[index])||fleet.jobs[index]&&fleetBlockReason(fleet.jobs[index])|| (state?.paused?'本区作业已暂停':active?(fleet.jobs[index]?.observation?photoPhaseName[state.phase]:state.phase==='moving'?'正在沿轨道前往这棵树':'正在执行割胶动作'):position>=0?`已排队 · 前方还有${position+(state?.active!==null?1:0)}棵`:state?.active!==null&&state?.active!==undefined?`正在处理 ${treeAlias(state.active)}，安排后自动排队。`:'本树未排队')}</p>
  <button className="ws-secondary ws-full" disabled={!fleet.ready||active||position>=0||!!state?.eventHoldReason} onClick={onArrange}>{fleet.error??(!fleet.ready?'机器人准备中…':state?.eventHoldReason?'当前区域作业暂缓':active?'正在执行':position>=0?'已加入队列':state?.active!==null?'加入本区队列':'人工补充安排这棵树')}</button>
  {fleet.jobs[index]&&<ZoneTaskControls index={index} expectedJob={fleet.jobs[index]}/>}
  {fleet.ready&&<button className="ws-secondary ws-full" onClick={()=>window.dispatchEvent(new CustomEvent('zone-fleet-focus',{detail:zone}))}>查看{'ABCD'[zone]}区机器人</button>}
 {fleet.ready&&<button className="ws-link ws-full" aria-pressed={following===zone} onClick={()=>window.dispatchEvent(new CustomEvent('zone-fleet-follow',{detail:following===zone?null:zone}))}>{following===zone?'取消镜头跟随':'跟随机器人'}</button>}
 </section>;
}
export function ZoneFleetBar({tasks=[]}:{tasks?:Task[]}={}){
 const fleet=useSyncExternalStore(subscribeFleet,getFleetSnapshot);
 const [notice,setNotice]=useState('');
 return <aside aria-label="四区机器人调度" className="field-devices">
 {fleet.zones.map(s=>{const legacyBusy=tasks.some(t=>t.site==='hainan'&&t.block==='ABCD'[s.zone]&&t.dispatch?.auto&&!['completed','cancelled','failed'].includes(t.dispatch.phase));
 const unavailable=s.active!==null||s.queue.length>0||s.paused||legacyBusy;
 return <div key={s.zone}><button className="ws-secondary" onClick={()=>window.dispatchEvent(new CustomEvent('zone-fleet-focus',{detail:s.zone}))}>
 <strong>{'ABCD'[s.zone]}区 · R-{'ABCD'[s.zone]}</strong><br/>{zoneStatus(s,fleet)}{s.active!==null?` · ${String(s.active%50+1).padStart(2,'0')}号树`:''}{s.queue.length?` · 排队${s.queue.length}`:''}
 </button><button className="ws-secondary" disabled={!fleet.ready||unavailable} title={unavailable?'设备正在执行、排队或暂停，不能复位':''} onClick={()=>setNotice(resetZonePosition(s.zone)?`R-${'ABCD'[s.zone]} 模拟机器人已复位到起点。`:'设备状态已变化，暂不能复位。')}>复位 R-{'ABCD'[s.zone]} 模拟机器人</button></div>})}
 {notice&&<p role="status">{notice}</p>}</aside>;
}
export function ZoneBatchDispatch({selected,onSubmit,onClose}:{selected:number[];onSubmit:()=>void;onClose:()=>void}){
 const fleet=useSyncExternalStore(subscribeFleet,getFleetSnapshot);
 const eventHold=selected.map(index=>fleet.zones[Math.floor(index/50)]?.eventHoldReason).find(Boolean);
 return <section className="ws-panel" style={{position:'absolute',bottom:32,left:'50%',transform:'translateX(-50%)',zIndex:25,padding:20,minWidth:320}} aria-label="选择割胶树">
 <h3>点击树木选择 · 已选{selected.length}棵</h3><p>各区机器人独立执行，同区按选择顺序排队。</p>
 {eventHold&&<p role="status">{eventHold}；请先处理影响并确认恢复，或重新选择未受影响区域的树木。</p>}
 <button className="ws-primary" disabled={!selected.length||!fleet.ready||!!eventHold} onClick={onSubmit}>安排所选树</button>{' '}
 <button className="ws-secondary" onClick={onClose}>取消</button></section>;
}
