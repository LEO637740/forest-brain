import {useRead} from './client';
import type {EconomicScenarioId} from './EconomicFactors';
import {MarketEvents} from './MarketEvents';
import './priceFactors.css';

type Level = 'alert'|'watch'|'normal'|'unknown';
export type PriceFactor = {
  key:string;horizon:'short'|'long';label:string;teacher:string;reading:string;rule:string;priceEffect:string;action:string;
  scenarioId:EconomicScenarioId|null;decisions:string[];owner:string;level:Level;levelLabel:string;
  sources:{label:string;mode:string;at:string|null;url:string|null}[];missing:string[];
};
export type PriceFactorReport = {
  siteId:string;park:string;generatedAt:string;headline:string;counts:Record<Level,number>;
  recommendedScenarioId:EconomicScenarioId;recommendation:string;factors:PriceFactor[];
  interactions:{key:string;title:string;active:boolean;text:string}[];study:{document:string;views:string[]};basis:string;
};
const modeLabels:Record<string,string> = {registered:'中心登记',measured:'公开数据',forecast:'公开预报',simulated:'模拟',system:'系统记录',assumption:'演示假设',research:'老师材料',catalog:'园区目录'};
const decisionLabels:Record<string,string> = {park_plan:'全园割胶',sales_plan:'经营方案',eudr:'欧盟客户资料',machinery:'机器人算例'};
const day = (value:string|null) => value ? value.slice(0,10) : '';

/** The brain's check of the teacher's price factors: what it reads, how it judges, and which decision each one changes. */
export function PriceFactorMonitor({siteId,scenarioId,onUseScenario}:{siteId:string;scenarioId:EconomicScenarioId;onUseScenario:(id:EconomicScenarioId)=>void}) {
  const result = useRead<PriceFactorReport>(`/api/economics/price-factors?siteId=${siteId}`,{pollMs:300000});
  const data = result.data;
  if (result.error) return <section className="hb-factors"><p role="alert">价格因素体检读取失败：{result.error} <button type="button" onClick={result.reload}>重试</button></p></section>;
  if (!data) return <section className="hb-factors"><p>正在读取价格因素…</p></section>;
  const group = (horizon:'short'|'long') => data.factors.filter(item => item.horizon === horizon);
  return <section className="hb-factors" aria-label="价格因素体检">
    <header><div><h3>价格因素体检</h3><p>{data.headline}</p></div><span className="hb-factors-tag">公开数据 + 模拟</span></header>
    <p className="hb-factors-recommend"><strong>大脑建议</strong>{data.recommendation}
      {data.recommendedScenarioId !== scenarioId && <button type="button" onClick={() => onUseScenario(data.recommendedScenarioId)}>选用建议情景</button>}</p>
    <details className="hb-factors-details"><summary>查看 {data.factors.length} 项因素与数据来源</summary>
    {(['short','long'] as const).map(horizon => <div key={horizon} className="hb-factors-group">
      <h4>{horizon === 'short' ? '短期因素' : '长期因素'}</h4>
      <ul>{group(horizon).map(item => <li key={item.key} className={`hb-factor hb-factor-${item.level}`}>
        <details>
          <summary><span className="hb-factor-level">{item.levelLabel}</span><strong>{item.label}</strong><span className="hb-factor-reading">{item.reading}</span></summary>
          <dl>
            <dt>对应动作</dt><dd>{item.action}<small>影响：{item.decisions.map(key => decisionLabels[key] ?? key).join('、')} · 负责：{item.owner}</small></dd>
            <dt>判断规则</dt><dd>{item.rule}</dd>
            <dt>对价格的作用</dt><dd>{item.priceEffect}</dd>
            <dt>老师原文</dt><dd>{item.teacher}</dd>
            <dt>数据来源</dt><dd><ul className="hb-factor-sources">{item.sources.map(source => <li key={source.label}>
              <span className={`hb-factor-mode hb-mode-${source.mode}`}>{modeLabels[source.mode] ?? source.mode}</span>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a> : source.label}{source.at ? ` · ${day(source.at)}` : ''}</li>)}</ul></dd>
            {item.missing.length > 0 && <><dt>待接入</dt><dd>{item.missing.join('；')}</dd></>}
          </dl>
        </details>
      </li>)}</ul>
    </div>)}
    <div className="hb-factors-group"><h4>短期与长期互相作用</h4>
      <ul className="hb-factors-links">{data.interactions.map(item => <li key={item.key} className={item.active ? 'is-active' : ''}><strong>{item.title}</strong>{item.text}</li>)}</ul></div>
    <p className="hb-factors-basis">{data.basis} 研究观点：{data.study.views.join('；')}。</p>
    </details>
    <MarketEvents siteId={siteId} onChanged={result.reload}/>
  </section>;
}
