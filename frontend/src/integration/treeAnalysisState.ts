import type {View} from './client';
import {refreshCovers,type StrategyRefreshState} from './strategyRefreshState.ts';

/** Scope enrollment is not evidence that this tree has entered a model run. */
export function treeAnalysisState(view:View|undefined,refresh:StrategyRefreshState|undefined,siteId:string,kind:string):{label:string;detail:string}|null {
  if(!view)return null;
  const {run,strategy,strategyRoute:route}=view;
  const automatic=refreshCovers(refresh,siteId,kind)&&refresh?.treeModelsEnabled===true;
  const waiting=automatic?(refresh?.status==='paused'?'自动分析已暂停；恢复后继续检查。':'后台会自动检查并调用大脑；尚无本树本维度正在调用的记录。'):'';
  if(view.strategyStatus==='withdrawn'||view.automaticSkipReason==='withdrawn')return {label:'建议已人工撤回',detail:'后台保留撤回决定，不会自动覆盖或重新生成。'};
  if(view.automaticSkipReason==='angle_adopted'||view.automaticSkipReason==='review_skip')return {label:'人工已处理，后台保留当前决定',detail:view.automaticSkipReason==='angle_adopted'?'本树角度已有采用记录，后台不会自动替换已采用方案。':'本树已复核跳过本次割胶，后台保留有效期内的跳过决定。'};
  if(view.strategyStatus==='pending')return run?.generatorMode==='configured'
    ?{label:run.status==='queued'?'大脑分析正在排队':'大脑正在分析',detail:'本树本维度已提交大脑分析，完成后自动显示结果。'}
    :{label:'规则建议正在生成',detail:'当前运行的是规则分析。'};
  if(view.strategyStatus==='needs_data'||route?.status==='blocked')return {label:'等待补充资料',detail:route?.reason||view.missingData?.map(item=>item.reason).join('；')||'必要数据不完整，补齐后重新检查。'};
  if(view.strategyStatus==='failed')return {label:run?.generatorMode==='configured'?'本轮大脑分析失败':'本轮策略生成失败',detail:view.error?.message||'请查看后台更新提示；也可手动重试。'};
  if(strategy?.fallback)return {label:'当前为规则保底结果',detail:`大脑未产出可采用的结果：${strategy.fallback.message}。需人工复核。`};
  if(strategy?.generationMetadata&&strategy.modelVersion)return {label:'大脑结果已生成',detail:`生成来源：${strategy.generationMetadata.provider} / ${strategy.generationMetadata.model}。采用策略仍需人工确认。`};
  if(strategy?.modelVersion)return {label:'已有外部模型结果',detail:`生成来源：${strategy.modelVersion}。采用策略仍需人工确认。`};
  if(route?.status==='needs_big_brain')return {label:automatic?(refresh?.status==='paused'?'大脑自动分析已暂停':'等待后台自动分析'):'需要大脑分析',detail:`${strategy?'当前显示规则结果，尚未采用大脑结果。':'尚无可用的大脑结果。'}${waiting||(refresh?'自动大脑分析尚未启用，可手动提交。':'正在核验后台自动分析状态。')}`};
  if(strategy)return {label:'当前为规则分析结果',detail:'该结果由规则生成，未调用大模型。'};
  return {label:'尚无可用策略',detail:view.strategyStatus==='expired'?'已有建议已过期，等待更新。':'后台完成分析后会自动显示结果。'};
}
