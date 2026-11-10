import {siteIdOf,useRead,type EnvironmentSite,type View} from './client';
import {refreshError,refreshStatusLabel,strategyRefreshPath,type StrategyRefreshState} from './strategyRefreshState';
import {treeAnalysisState} from './treeAnalysisState';
import './strategy-refresh.css';

const refreshTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
type Snapshot={data?:StrategyRefreshState;error?:string;reload:()=>void};
export function StrategyRefreshStatus({site='hainan',kind,snapshot,view}:{site?:EnvironmentSite;kind?:string;snapshot?:Snapshot;view?:View}) {
  const read=useRead<StrategyRefreshState>(snapshot?null:strategyRefreshPath(siteIdOf(site)),{pollMs:30000});
  const result=snapshot??read,state=result.data,item=state?.items.find(row=>row.kind===kind);
  const error=refreshError(item?item.error:state?.lastError);
  const status=state?.status==='paused'?'paused':item?.status??state?.status;
  const analysis=kind?treeAnalysisState(view,state,siteIdOf(site),kind):null;
  return <section className="hb-strategy-refresh" aria-label="后台策略更新状态" aria-live="polite">
    {analysis&&<div className="hb-tree-analysis-status"><strong>本树分析：{analysis.label}</strong><p>{analysis.detail}</p></div>}
    <div><strong>后台策略更新：{!state?result.error?'状态暂不可读':'正在读取':!state.enabled?'未启用':refreshStatusLabel(status??state.status)}</strong><button type="button" onClick={result.reload}>重新读取状态</button></div>
    {state&&<><p>{state.enabled?`每 ${state.intervalMinutes} 分钟更新${state.startupCatchUp?'；启动时补齐缺失或过期结果':''}。`:'当前未启用周期更新，可手动生成建议。'} 采用策略与派单仍需人工确认。</p>
      <p>{item?.lastSuccessAt?`本类最近成功：${refreshTime(item.lastSuccessAt)}。`:state.lastFinishedAt?`最近一轮结束：${refreshTime(state.lastFinishedAt)}。`:state.lastStartedAt?`本轮开始：${refreshTime(state.lastStartedAt)}。`:'尚无已完成的后台更新记录。'}{state.nextRunAt&&state.enabled&&state.status!=='paused'?` 下次检查：${refreshTime(state.nextRunAt)}。`:''}{item?` ${item.label}：${refreshStatusLabel(item.status)}。`:''}</p>
      {error&&<p role="status">最近更新提示：{error}。{error.includes('缺少')?'请补齐相应资料，后台会在后续周期继续更新。':error.includes('恢复')||error.includes('暂停')?'请按提示恢复后等待后台检查，也可手动查看或更新。':'后台会继续检查，也可手动查看或更新。'}</p>}
    </>}
    {result.error&&<p role="status">后台更新状态读取失败：{result.error}；页面仍保留已读取的策略。</p>}
  </section>;
}
