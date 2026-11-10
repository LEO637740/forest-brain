import {useState} from 'react';
import {alias,kinds,post,useRead} from './client';
import type {ModelControl,ModelMeta} from './modelGenerationFlow';
import {changeAutomaticPause,changeModelPause,modelResumeReason,type AutomaticStatus} from './modelControls';
import {StrategyRefreshStatus} from './StrategyRefreshStatus';
import {refreshStatusLabel,strategyRefreshPath,type StrategyRefreshState} from './strategyRefreshState';
import './model-controls.css';

export function ModelControlPanel({compact=false}:{compact?:boolean}){
  const meta=useRead<ModelMeta>('/api/meta');
  const model=useRead<ModelControl>('/api/model/control',{pollMs:compact?0:60000});
  const automatic=useRead<AutomaticStatus>(compact?null:'/api/automatic',{pollMs:compact?0:60000});
  const strategyRefresh=useRead<StrategyRefreshState>(compact?null:strategyRefreshPath('demo-hainan'),{pollMs:compact?0:30000});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const blocked=modelResumeReason(meta.data,model.data,meta.error||model.error);
  const refresh=()=>{meta.reload();model.reload();automatic.reload();strategyRefresh.reload();};
  async function setModel(paused:boolean){
    if(busy||(!paused&&blocked))return;
    setBusy(true);setMessage('');
    try{
      await changeModelPause(paused,post);
      setMessage(paused?'模型调用已暂停；正在发送中的请求可能仍需等待结束。':'模型调用已恢复；自动分析仍按其独立开关运行。');
      window.dispatchEvent(new Event('harness-model-control-changed'));
      refresh();
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  async function setAutomatic(paused:boolean){
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      await changeAutomaticPause(paused,automatic.data,meta.data,model.data,post,strategyRefresh.data);
      setMessage(paused?'自动分析已暂停。':'自动分析已恢复，将按下方范围和次数上限运行。');
      window.dispatchEvent(new Event('harness-model-control-changed'));automatic.reload();strategyRefresh.reload();
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  const scheduler=automatic.data;
  const autoActive=Boolean(strategyRefresh.data?.enabled?strategyRefresh.data.status!=='paused'&&strategyRefresh.data.status!=='disabled':scheduler?.config?.enabled&&!scheduler.paused&&!scheduler.circuitReason&&scheduler.status!=='budget_wait');
  const canResumeAuto=Boolean(!busy&&(strategyRefresh.data?.enabled?!strategyRefresh.error:!automatic.error&&scheduler?.config?.enabled)&&!blocked&&model.data?.paused===false);
  const autoScope=(()=>{
    const groups=new Map<string,{treeIds:Set<string>;jobs:number;industry:boolean}>();
    for(const job of scheduler?.jobs??[]){
      const group=groups.get(job.kind)??{treeIds:new Set<string>(),jobs:0,industry:job.kind==='industry_brief'};
      job.treeIds.forEach(treeId=>group.treeIds.add(treeId));group.jobs++;groups.set(job.kind,group);
    }
    return [...groups.entries()].map(([kind,group])=>{
      const label=kinds[kind as keyof typeof kinds]||kind;
      if(group.industry)return `${label} · 行业资料`;
      const ids=[...group.treeIds];
      const scope=ids.length>=20?`全园 ${ids.length} 棵树`:ids.length<=5?ids.map(id=>alias(id)).join('、'):`${ids.length} 棵树`;
      return `${label} · ${scope}（${group.jobs} 个自动任务）`;
    }).join('；');
  })();
  return <section className={'hb-model-controls'+(compact?' compact':'')} aria-label="模型调用控制" aria-busy={busy}>
    <div className="hb-model-controls-row"><strong>模型调用：{model.data?(model.data.paused?'已暂停':'已允许'):model.error?'状态不可读':'正在核验'}</strong>
      {model.data?.paused===false?<button disabled={busy} onClick={()=>setModel(true)}>暂停模型调用</button>:<button disabled={busy||Boolean(blocked)} onClick={()=>setModel(false)}>恢复模型调用</button>}
      <button disabled={busy} onClick={refresh}>重新读取状态</button>
    </div>
    <p>页面展示后台生成的策略；后台按周期更新，启动时补齐缺失或过期结果。各策略页仍可手动刷新，采用与派单需人工确认。</p>
    {!compact&&<StrategyRefreshStatus snapshot={strategyRefresh}/>}
    {blocked&&<p role="status">{blocked}</p>}
    {!compact&&<div className="hb-model-scheduler"><div className="hb-model-controls-row"><strong>自动分析：{strategyRefresh.data?.enabled?refreshStatusLabel(strategyRefresh.data.status):!scheduler?automatic.error?'状态不可读':'正在核验':!scheduler.config?.enabled?'本次启动未启用':model.data?.paused?'大脑暂停；简单规则仍可运行':scheduler.paused?'已暂停':scheduler.circuitReason?'错误后暂停':scheduler.status==='running'?'运行中':scheduler.status==='budget_wait'?'预算等待':'已允许'}</strong>
      {autoActive?<button disabled={busy} onClick={()=>setAutomatic(true)}>暂停自动分析</button>:!strategyRefresh.data?.enabled&&scheduler?.status==='budget_wait'?<button disabled>等待额度恢复</button>:<button disabled={!canResumeAuto} onClick={()=>setAutomatic(false)}>恢复自动分析</button>}
    </div>
    {scheduler?.config?.enabled?<><p>启动时立即检查；之后每 {scheduler.config.intervalMinutes} 分钟检查，重要数据源产生新快照时会提前触发。滚动 24 小时最多 {scheduler.config.maxRunsPer24Hours} 项分析、{scheduler.config.maxModelRequestsPer24Hours} 次模型请求。</p><p>自动范围：{autoScope||'未配置任务'}。成功结果可在对应单树或行业页面读取。</p>{scheduler.lastTrigger&&<p>上次触发：{scheduler.lastTrigger.type==='event'?'重要数据源变化':'启动或定时检查'}{scheduler.lastTrigger.sourceIds?.length?`（${scheduler.lastTrigger.sourceIds.join('、')}）`:''}。</p>}{scheduler.budget&&<p>最近 24 小时已提交 {scheduler.budget.runs} 项分析、{scheduler.budget.modelRequests} 次模型请求。</p>}{scheduler.status==='budget_wait'&&<p role="status">自动任务已达到滚动 24 小时额度上限，等待额度释放后才会再次提交。</p>}{scheduler.lastResultStatus==='failed'&&scheduler.lastError&&<p role="status">最近一次自动分析失败：{scheduler.lastError.message||scheduler.lastError.code||'未提供错误详情'}。失败结果不会被当作可采用策略。</p>}</>:strategyRefresh.data?.enabled?<p>后台周期更新已启用，暂停或恢复会同步作用于后台更新。</p>:<p>本次启动未启用自动分析，请使用默认启动或 <code>node start.mjs --automatic</code>。</p>}
    {scheduler?.circuitReason&&<p role="status">{scheduler.circuitReason.message}</p>}{automatic.error&&<p role="status">{automatic.error}</p>}
    </div>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
