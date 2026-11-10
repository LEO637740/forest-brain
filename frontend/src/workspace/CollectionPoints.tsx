import {useState} from 'react';
import {sites, type Site} from './model';
import {collectionPointAsOf, collectionPointSamples, collectionQuoteBasis} from './collectionPointData';
import './collectionPoints.css';

export function CollectionPoints({site}: {site: Site}) {
  const [selectedId, setSelectedId] = useState('');
  const points = collectionPointSamples[site];
  if (site === 'xian') return <section className="cp-empty dc-panel"><h2>西安试验站</h2><p>西安用于设备联调，不设置生产园区的收胶点、胶乳报价或加工厂样本。</p><p>切换至海南、云南或广东的生产园区查看。</p></section>;

  const selected = points.find(point => point.id === selectedId) || points[0];
  const nearest = points.reduce((a, b) => a.distanceKm < b.distanceKm ? a : b);
  const highest = points.reduce((a, b) => a.latexPrice > b.latexPrice ? a : b);
  const lowestPrice = Math.min(...points.map(point => point.latexPrice));
  return <div className="cp-page">
    <div className="dc-notice"><strong>虚构网点 · 示例报价</strong><p>报价快照：{collectionPointAsOf}。网点与距离为演示样本，示意图无真实坐标。</p></div>
    <div className="cp-summary"><div><span>所属园区</span><strong>{sites[site]}演示园区</strong><small>2 个收胶点 · 1 个加工厂</small></div><div><span>示例最近接收点</span><strong>{nearest.name}</strong><small>样例距离 {nearest.distanceKm.toFixed(1)} km</small></div><div><span>示例最高报价</span><strong>{highest.latexPrice.toFixed(2)} <small>元 / kg 鲜胶乳</small></strong><small>{highest.name} · 未扣运输与检测费用</small></div></div>
    <div className="cp-layout">
      <section className="dc-panel cp-map-panel"><header><div><h2>收胶与加工分布示意</h2><p>点击网点查看接收条件。</p></div></header>
        <svg className="cp-map" viewBox="0 0 620 340" role="group" aria-label={`${sites[site]}虚构收胶与加工网络示意图`}>
          <title>{`${sites[site]}演示园区的三个虚构接收点`}</title>
          <rect className="cp-map-ground" x="10" y="10" width="600" height="320" rx="20"/>
          {points.map(point => <g key={`line-${point.id}`}><line x1="150" y1="245" x2={point.position.x} y2={point.position.y} className="cp-map-link"/><text className="cp-map-distance" x={(150 + point.position.x) / 2 + 8} y={(245 + point.position.y) / 2 - 8}>{point.distanceKm.toFixed(1)} km 示例</text></g>)}
          <circle className="cp-map-origin" cx="150" cy="245" r="24"/><text x="150" y="250" textAnchor="middle">园区</text><text className="cp-map-label" x="150" y="286" textAnchor="middle">{sites[site]}演示园区</text>
          {points.map(point => <g key={point.id} role="button" tabIndex={0} aria-label={`查看${point.name}`} aria-pressed={selected.id === point.id} className={`cp-map-point ${selected.id === point.id ? 'selected' : ''}`} onClick={() => setSelectedId(point.id)} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); setSelectedId(point.id);}}}>
            <circle cx={point.position.x} cy={point.position.y} r="22"/><text x={point.position.x} y={point.position.y + 4} textAnchor="middle">{point.kind === '加工厂' ? '加工' : '收胶'}</text><text className="cp-map-label" x={point.position.x} y={point.position.y + 42} textAnchor="middle">{point.name}</text>
          </g>)}
        </svg>
      </section>
      <section className="dc-panel cp-detail" aria-label="网点详情" aria-live="polite"><header><div><span className="cp-tag">{selected.kind} · 虚构</span><h2>{selected.name}</h2></div></header><dl><dt>所属园区</dt><dd>{sites[selected.site]}演示园区</dd><dt>样例距离</dt><dd>{selected.distanceKm.toFixed(1)} km</dd><dt>胶乳报价</dt><dd><strong>{selected.latexPrice.toFixed(2)} 元 / kg 鲜胶乳</strong></dd><dt>报价日期</dt><dd>{collectionPointAsOf} · 示例</dd><dt>统一口径</dt><dd>干胶含量 30%，未计运输、检测或扣杂费用</dd><dt>接收时段</dt><dd>{selected.receivingHours}</dd><dt>接收能力</dt><dd>{selected.capacity}</dd></dl><h3>{selected.kind === '加工厂' ? '加工与交接环节' : '接收与交接环节'}</h3><ul>{selected.services.map(service => <li key={service}>{service}</li>)}</ul></section>
    </div>
    <section className="dc-panel"><header><div><h2>同口径报价对比</h2><p>{collectionQuoteBasis} · {collectionPointAsOf} 示例快照</p></div></header><div className="dc-table"><table className="cp-quotes"><thead><tr><th>接收点</th><th>类型 / 园区</th><th>样例距离</th><th>示例报价</th><th>较本组最低报价</th></tr></thead><tbody>{points.map(point => <tr key={point.id} className={selected.id === point.id ? 'selected' : ''}><td><button aria-pressed={selected.id === point.id} onClick={() => setSelectedId(point.id)}>{point.name}</button></td><td>{point.kind}<small>{sites[point.site]}演示园区</small></td><td>{point.distanceKm.toFixed(1)} km</td><td>{point.latexPrice.toFixed(2)} 元 / kg</td><td>+{(point.latexPrice - lowestPrice).toFixed(2)} 元 / kg</td></tr>)}</tbody></table></div><p className="cp-note">同日期、同干胶含量报价；净收益还需扣除运输与检测费用。</p></section>
  </div>;
}
