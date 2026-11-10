import {ArrowRight, MapPin, Sprout} from 'lucide-react';
import {collectionPointAsOf} from './collectionPointData';
import {treeAlias, type Site} from './model';
import {treePosition} from './workbenchModel';
import type {DemoAccount} from './identityModel';
import type {PlotSummary} from './TodayDecisions';
import {FuturesTicker} from './FuturesTicker';
import './growerFocus.css';

type Props = {plot:PlotSummary;account:DemoAccount;site:Site;onCollection:()=>void;onTree:(index:number)=>void};

export function GrowerFocus({plot,account,site,onCollection,onTree}:Props) {
  const points = plot.collectionPoints;
  const prices = points.map(point => point.latexPrice);
  const care = new Map(plot.care.map(item => [item.treeId, item.reasons]));
  const label = (treeId:string) => {
    const index = treePosition(treeId);
    return index === null ? treeId : treeAlias(index,site);
  };
  const openTree = (treeId:string) => {
    const index = treePosition(treeId);
    if (index !== null) onTree(index);
  };
  return <div className="gf-focus" aria-label="胶价与我的承包地">
    <FuturesTicker/>
    <div className="gf-main">
      <section className="gf-card gf-price" aria-labelledby="gf-price-title">
        <header><h3 id="gf-price-title">附近收胶价</h3><span>示例报价 · {collectionPointAsOf}</span></header>
        {points.length ? <>
          <div className="gf-price-value"><strong>{Math.min(...prices).toFixed(2)}–{Math.max(...prices).toFixed(2)}</strong><span>元 / 公斤鲜胶乳</span></div>
          <p className="gf-note">干胶含量 30% · 未计运输、检测费用</p>
          <div className="gf-quotes">{points.map(point => <div key={point.id}>
            <span><strong>{point.name}</strong><small><MapPin size={12}/>距园区约 {point.distanceKm.toFixed(1)} 公里</small></span>
            <b>{point.latexPrice.toFixed(2)}<small> 元 / 公斤</small></b>
          </div>)}</div>
        </> : <p>当前园区暂无收胶点报价。</p>}
        <button className="rb-button rb-primary gf-action" onClick={onCollection}>比较收胶点报价<ArrowRight size={16}/></button>
      </section>
      <section className="gf-card gf-plot" aria-labelledby="gf-plot-title">
        <header><h3 id="gf-plot-title"><Sprout size={19}/>我的承包地</h3><span>{plot.zone} 区</span></header>
        <div className="gf-plot-stats">
          <div><span>承包面积</span><strong>{account.plot?.areaMu ?? '—'}<small>亩</small></strong></div>
          <div><span>我的树木</span><strong>{plot.treeCount}<small>棵</small></strong></div>
          <div className={plot.care.length ? 'gf-attention' : ''}><span>需要照看</span><strong>{plot.care.length}<small>棵</small></strong></div>
        </div>
        <div className="gf-care" aria-label="承包地重点树木">
          {plot.care.length ? plot.care.slice(0,3).map(item => <button key={item.treeId} onClick={() => openTree(item.treeId)}>
            <span><strong>{label(item.treeId)}</strong><small>{item.reasons.join(' · ')}</small></span><ArrowRight size={16}/>
          </button>) : <p>树木状态正常，按计划养护和割胶。</p>}
        </div>
        <details className="gf-all-trees"><summary>查看全部 {plot.treeCount} 棵树{plot.care.length > 3 ? ` · 另有 ${plot.care.length-3} 棵需照看` : ''}</summary>
          <div className="gf-tree-grid" role="list">{plot.treeIds.map(treeId => <div key={treeId} role="listitem"><button
            className={care.has(treeId) ? 'gf-tree-care' : ''} aria-label={`${label(treeId)}${care.has(treeId) ? '（需要照看）' : ''}`}
            onClick={() => openTree(treeId)}><strong>{label(treeId)}</strong><small>{care.get(treeId)?.join(' · ') ?? '状态正常'}</small></button></div>)}</div>
        </details>
      </section>
    </div>
    <section className="gf-harvest" aria-label="我的产胶与估算收入">
      <div><span>已完成割胶</span><strong>{plot.completedTaps}<small>株次</small></strong></div>
      <div><span>估算鲜胶乳</span><strong>{plot.estimatedLatexKg.toLocaleString('zh-CN')}<small>公斤</small></strong></div>
      <div><span>估算收入</span><strong>{plot.estimatedIncomeCny === null ? '—' : plot.estimatedIncomeCny.toLocaleString('zh-CN',{maximumFractionDigits:2})}<small>元</small></strong></div>
      <details><summary>估算口径</summary><p>{plot.basis}</p></details>
    </section>
  </div>;
}
