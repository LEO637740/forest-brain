import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CloudRain, MapPin, RefreshCw } from 'lucide-react';
import { WEATHER_EVIDENCE, WEATHER_META, type WeatherDemoState, type WeatherAction } from './demoWeather';
import type { Task } from '../model';

type Props = {
 state: WeatherDemoState; task: Task; error: string; notice: string;
 onAction: (action: WeatherAction, window?: {start:string;end:string}) => void;
 onBack: () => void; onField: () => void; onReset: () => void;
 onFailure: () => void; failure: boolean;
};
const minutes = (s:string) => Number(s.slice(0,2))*60+Number(s.slice(3,5));
function WindowTrack({start,end,tone}:{start:string;end:string;tone:string}) {
 const from=minutes(start),to=minutes(end);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||from<240||to>840)return <div className="rb-window-track" aria-label="时间窗口待校验"/>;
 const left=(from-240)/600*100,width=(to-from)/600*100;
 return <div className="rb-window-track"><span className={tone} style={{left:left+'%',width:Math.min(width,100-left)+'%'}}><span>{start}–{end}</span></span></div>;
}
function WeatherChart({empty}:{empty:boolean}) {
 const [selected,setSelected]=useState(3);
 const points=WEATHER_EVIDENCE;
 const x=(hour:number)=>64+(hour-4)*62;
 const d=points[selected];
 if(empty)return <div className="rb-empty" role="status"><CloudRain size={28}/><h3>气象序列不可用</h3><p>当前未获得可用于本方案的观测与预测记录。</p></div>;
 return <>
  <div className="rb-chart-key"><span><i className="rb-blue"/>降雨量 · mm</span><span><i className="rb-amber"/>土壤含水率 · %</span><span>实色：观测　虚线：预测</span></div>
  <svg className="rb-weather-chart" viewBox="0 0 760 284" role="img" aria-label="04至14时降雨与土壤含水率，08时起为预测；数值明细可展开">
   <rect x="281" y="12" width="450" height="230" fill="currentColor" opacity=".025"/>
   {[0,2,4,6].map(v=><g key={v}><line x1="56" x2="720" y1={126-v*15} y2={126-v*15} className="rb-grid"/><text x="40" y={130-v*15} textAnchor="end">{v}</text></g>)}
   <text x="56" y="20">mm</text><text x="680" y="20">预测区间</text>
   <line x1="281" x2="281" y1="28" y2="245" className="rb-divider" strokeDasharray="4 5"/>
   {points.map(p=><g key={p.hour}><rect x={x(p.hour)-12} y={126-(p.rainMm??0)*15} width="24" height={(p.rainMm??0)*15} rx="2" fill={p.kind==='预测'?'transparent':'var(--rb-blue)'} stroke="var(--rb-blue)" strokeDasharray={p.kind==='预测'?'4 2':undefined}/><text x={x(p.hour)} y="266" textAnchor="middle">{String(p.hour).padStart(2,'0')}:00</text></g>)}
   {[30,35,40].map(v=><g key={v}><line x1="56" x2="720" y1={236-(v-28)*5} y2={236-(v-28)*5} className="rb-grid"/><text x="40" y={240-(v-28)*5} textAnchor="end">{v}</text></g>)}
   <text x="56" y="156">%</text>
   {points.slice(1).map((p,i)=>p.soilPct!==null&&points[i].soilPct!==null?<line key={p.hour} x1={x(points[i].hour)} x2={x(p.hour)} y1={236-(points[i].soilPct!-28)*5} y2={236-(p.soilPct-28)*5} stroke="var(--rb-amber)" strokeWidth="2.5" strokeDasharray={p.kind==='预测'?'5 4':undefined}/>:null)}
   {points.map(p=>p.soilPct===null?null:<circle key={p.hour} cx={x(p.hour)} cy={236-(p.soilPct-28)*5} r="3" fill="var(--rb-amber)"/>)}
   <line x1={x(d.hour)} x2={x(d.hour)} y1="30" y2="244" stroke="var(--rb-text)" opacity=".4"/>
  </svg>
  <div className="rb-chart-inspector"><label>查看时刻<select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{points.map((p,i)=><option key={p.hour} value={i}>{String(p.hour).padStart(2,'0')}:00 · {p.kind}</option>)}</select></label><strong>{d.rainMm===null?'降雨未采集':d.rainMm+' mm'}</strong><span>土壤含水率 {d.soilPct===null?'未采集':d.soilPct+'%'}</span></div>
  <details className="rb-disclosure"><summary>气象数值明细与来源</summary><p>海南演示气象站 · 2026-09-22 07:30更新 · 人工编制的可复现演示序列，非实时预报。土壤缺测区间不插值。</p><table className="rb-table"><thead><tr><th>时刻</th><th>数据性质</th><th>降雨量（mm）</th><th>土壤含水率（%）</th></tr></thead><tbody>{points.map(p=><tr key={p.hour}><td>{p.hour}:00</td><td>{p.kind}</td><td>{p.rainMm??'未采集'}</td><td>{p.soilPct??'未采集'}</td></tr>)}</tbody></table></details>
 </>;
}

export function WeatherDetail({state,task,error,notice,onAction,onBack,onField,onReset,onFailure,failure}:Props) {
 const [start,setStart]=useState(state.start),[end,setEnd]=useState(state.end),[empty,setEmpty]=useState(false);
 useEffect(()=>{setStart(state.start);setEnd(state.end);},[state.start,state.end,state.version]);
 const editable=state.status==='草案'||state.status==='待重新复核';
 const change=minutes(start)-360;
 return <section className="rb-page rb-weather" aria-labelledby="weather-title">
  <button className="rb-back" onClick={onBack}><ArrowLeft size={16}/>返回运营总览</button>
  <header className="rb-page-heading"><div><div className="rb-breadcrumb">决策与复核 / 海南生产园区</div><h1 id="weather-title">C区作业窗口调整 <span className="rb-status">{state.status}</span></h1><p>28棵业务树 · HN-03 · 方案版本 v{state.version}</p></div><button className="rb-button" onClick={onField}><MapPin size={16}/>定位C区</button></header>
  <div className="rb-source-line"><span className="rb-source">隔离演示数据</span><span>统计日 2026-09-22</span><span>气象记录更新 07:30</span><span>任务范围固定，不新增树木</span></div>
  <div className="rb-decision-layout">
   <section className="rb-evidence"><header className="rb-section-heading"><h2>降雨与作业窗口</h2><span>海南演示气象站 / C区适用</span></header><WeatherChart empty={empty}/>
    <div className="rb-windows"><div><span>原作业窗口</span><WindowTrack start="06:00" end="07:30" tone="original"/></div><div><span>建议作业窗口</span><WindowTrack start={start} end={end} tone="proposed"/></div><div className="rb-window-axis"><span>04:00</span><span>08:00</span><span>14:00</span></div></div>
    <section className="rb-rationale"><h2>调整依据</h2><p>{WEATHER_META.rationale}</p><p className="rb-secondary">{WEATHER_META.qualification}</p></section>
   </section>
   <aside className="rb-proposal" aria-label="建议方案与操作"><header className="rb-section-heading"><h2>方案对照</h2><span>仅调整时间</span></header>
    <table className="rb-table rb-comparison"><thead><tr><th>项目</th><th>原方案</th><th>建议方案</th></tr></thead><tbody><tr><th>开始时间</th><td>06:00</td><td><input aria-label="建议开始时间" type="time" value={start} disabled={!editable} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></td></tr><tr><th>结束时间</th><td>07:30</td><td><input aria-label="建议结束时间" type="time" value={end} disabled={!editable} onInput={e=>setEnd(e.currentTarget.value)} onChange={e=>setEnd(e.target.value)}/></td></tr><tr><th>关联树组</th><td>C区28棵</td><td>保持不变</td></tr><tr><th>执行设备</th><td>{task.robot}</td><td>保持不变</td></tr></tbody></table>
    <div className="rb-change"><ClockIcon/><span>开始时间调整</span><strong>{Number.isFinite(change)?(change>=0?'+':'')+change:'待填写'}<small>分钟</small></strong></div>
    <section className="rb-constraints"><h3>适用条件</h3><ul>{WEATHER_META.constraints.map(c=><li key={c.label}>{c.confirmed?<Check size={16}/>:<span className="rb-dot"/>}{c.label}</li>)}</ul></section>
    <div className="rb-demo-actions"><div className="rb-section-heading"><h3>演示流程</h3><span>仅本地记录</span></div>
     {error&&<p className="rb-alert" role="alert">{error}</p>}{notice&&<p className="rb-notice" role="status">{notice}</p>}
     {editable&&<><button className="rb-button rb-primary" disabled={empty} onClick={()=>onAction('submit',{start,end})}>提交复核<ArrowRight size={16}/></button><button className="rb-button" onClick={()=>onAction('save',{start,end})}>保存本地草案</button></>}
     {state.status==='待复核'&&<button className="rb-button rb-primary" disabled={empty} onClick={()=>onAction('approve')}>批准方案</button>}
     {state.status==='已批准'&&!state.applied&&<button className="rb-button rb-primary" disabled={empty} onClick={()=>onAction('apply')}>更新演示任务</button>}
     {!state.applied&&state.status!=='未采纳'&&<button className="rb-button" onClick={()=>onAction('retain')}>保留原方案</button>}
     {state.applied&&<p className="rb-notice">{state.receipt?'演示任务已完成，效果待观察。':'演示排程已更新，尚无设备受理记录。'}</p>}
    </div>
   </aside>
  </div>
  <section className="rb-task-receipt"><header className="rb-section-heading"><h2>关联任务与回执</h2><span>同一任务范围 · HN-03</span></header><div className="rb-task-summary"><div><strong>{task.title}</strong><span>C区 · 28棵 · {task.robot}</span></div><div><span>任务窗口</span><strong>{state.applied?state.start:'06:00'}–{state.applied?state.end:'07:30'}</strong></div><div><span>任务状态</span><strong>{state.receipt?'已完成（演示回执）':state.applied?'待下发（演示）':'未更新'}</strong></div><div><span>效果跟踪</span><strong>待观察</strong></div></div></section>
  <details className="rb-disclosure"><summary>复核与采用记录 · {state.history.length}条</summary>{state.history.length?<ol className="rb-history">{state.history.map((h,i)=><li key={i}><time>{h.time}</time><span>{h.action}</span></li>)}</ol>:<p>暂无本地操作记录。</p>}</details>
  <details className="rb-disclosure rb-tools"><summary>演示验证工具与能力说明</summary><p>此样板不调用Harness、生产数据库或设备接口。批准、排程与回执分别记录；演示回执不触发三维机器人，旧现场作业链路保持独立。</p><div className="rb-action-row"><button className="rb-button" onClick={onFailure} aria-pressed={failure}>{failure?'取消失败注入':'模拟下一次提交失败'}</button><button className="rb-button" aria-pressed={empty} onClick={()=>setEmpty(v=>!v)}>{empty?'恢复气象数据':'模拟数据缺失'}</button><button className="rb-button" disabled={state.applied||!['待复核','已批准'].includes(state.status)} onClick={()=>onAction('invalidate')}>模拟条件更新</button><button className="rb-button" disabled={!state.applied||state.receipt} onClick={()=>onAction('receipt')}>注入演示完成回执</button><button className="rb-button" onClick={()=>{setEmpty(false);onReset();}}><RefreshCw size={15}/>重置天气样板</button></div></details>
 </section>;
}
function ClockIcon(){return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor"/><path d="M10 5v5l3 2" stroke="currentColor"/></svg>}
