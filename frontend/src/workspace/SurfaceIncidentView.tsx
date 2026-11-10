import { Check, CornerDownRight } from 'lucide-react';
import { Modal } from './Modal';
import { treeAlias, type Task } from './model';
import { resolveSurface, type SurfaceIncident } from './taskFlow';

export function incidentResult(i:SurfaceIncident){
 return i.status==='completed'?'模拟避让作业已完成 · 无真实设备回执':i.status==='skipped'?'已跳过 · 等待复查':i.status==='adopted'?'已采用避让方案 · 模拟执行中':i.status==='cancelled'?'作业已取消 · 本树未完成':i.status==='recapturing'?'补拍任务已生成':'等待确认处理方式';
}

export function SurfaceIncidentView({task,onUpdate,onClose,readOnlyReason,demoWeather,onDemoWeatherChange}:{task:Task;onUpdate:(task:Task)=>void;onClose:()=>void;readOnlyReason?:string;demoWeather?:boolean;onDemoWeatherChange?:(enabled:boolean)=>void}){
 const i=task.dispatch!.incident!;
 const waiting=task.dispatch!.phase==='review'&&i.status==='review',capturing=i.status==='recapturing';
 function act(action:'adopt'|'recapture'|'skip'){if(readOnlyReason)return;const next=resolveSurface(task,action);if(next===task)return;onUpdate(next);if(action!=='recapture')onClose();}
 return <Modal title={`树表异常处理 · ${treeAlias(i.treeIndex,task.site)}`} wide onClose={onClose}>
  <div className="si-plain-layout"><section className="si-decision">
    <span className="si-eyebrow">模拟核查记录 · {treeAlias(i.treeIndex,task.site)}</span>
    <h3>{waiting?'处理树表异常':incidentResult(i)}</h3>
    <p>规则检测到树表异常，暂无现场照片或设备回执。</p>
    <dl className="si-facts"><div><dt>发现</dt><dd>{new Date(i.detectedAt).toLocaleTimeString('zh-CN')}</dd></div><div><dt>影响</dt><dd>原割线可能与异常位置冲突</dd></div><div><dt>数据状态</dt><dd>演示标记 · 待现场证据确认</dd></div></dl>
    {!readOnlyReason&&<div className="si-outcome"><CornerDownRight size={20}/><span>{waiting?'选择处理方式后继续演示。':capturing?'模拟补拍记录已生成，等待核查结论。':incidentResult(i)}</span></div>}
    {readOnlyReason&&<p className="ws-muted" role="status">{readOnlyReason}</p>}
    {waiting&&onDemoWeatherChange&&<div className="si-demo-weather"><label><input type="checkbox" checked={Boolean(demoWeather)} onChange={e=>onDemoWeatherChange(e.target.checked)}/> 演示天气：模拟适合作业</label><p className="ws-muted">仅供当前标签页模拟任务使用，不改变真实天气、作业时间和其他限制。</p></div>}
    {waiting&&<div className="si-actions"><button className="ws-primary" disabled={Boolean(readOnlyReason)} onClick={()=>act('adopt')}><Check size={18}/>采用模拟避让方案</button><button className="ws-secondary" disabled={Boolean(readOnlyReason)} onClick={()=>act('recapture')}>生成模拟补拍记录</button><button className="ws-link" disabled={Boolean(readOnlyReason)} onClick={()=>act('skip')}>跳过这棵，继续其余作业 →</button></div>}
    <details className="si-records"><summary>查看处理记录</summary><p>发现：{new Date(i.detectedAt).toLocaleTimeString('zh-CN')}</p><p>补拍次数：{i.captures} 次（无真实照片）</p>{i.decidedAt&&<p>处理：{new Date(i.decidedAt).toLocaleTimeString('zh-CN')} · {i.action==='skip'?'跳过':'采用避让方案'}</p>}{i.completedAt&&<p>完成：{new Date(i.completedAt).toLocaleTimeString('zh-CN')}</p>}</details>
  </section></div>
 </Modal>;
}
