import type {Strategy} from './contracts';
import {strategyRecommendation} from './recommendationModel';
import './strategyRecommendation.css';

export function StrategyRecommendation({strategy}:{strategy:Strategy}){
  const result=strategyRecommendation(strategy);
  const status=strategy.qualityReview?.status==='withdrawn'?'已撤回':Date.parse(strategy.expiresAt)<=Date.now()?'已过期':strategy.fallback?'规则建议 · 待复核':result.tone==='defer'?'建议暂缓':result.tone==='review'?'待复核':'当前建议';
  return <section className={`sr-recommendation ${result.tone}`} aria-label="推荐策略">
    <header><span>推荐策略</span><small>{status}{strategy.executionMode==='simulation'?' · 模拟':''}</small></header>
    <h3>{result.title}</h3>
    <dl><div><dt>对象</dt><dd>{result.target}</dd></div><div><dt>时机</dt><dd>{result.timing}</dd></div></dl>
    {result.reason&&<p className="sr-reason">{result.reason}</p>}
    {result.note&&<p className="sr-note">{result.note}</p>}
  </section>;
}
