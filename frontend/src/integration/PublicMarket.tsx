import {useRead,type EnvironmentSite} from './client';
import {Card, State} from './Views';
import {CommodityReference} from './CommodityReference';
import {futuresRows, publicSourceState, officialSourceUrl, metricUnit, type PublicSource, type PublicSources, type FuturesData, type WarehouseData, type MonthlyData} from './publicMarketData';
import './publicMarket.css';

const number = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : '缺失';
const timestamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false}) : '尚未获取';

function SourceInfo({source}: {source: PublicSource | undefined}) {
  const state = publicSourceState(source), url = officialSourceUrl(source);
  return <div className="hb-public-source">
    <span className={'hb-source-state' + (state.warning ? ' warning' : '')} role="status">{state.label}</span>
    <p>{source?.provider || '官方公开来源'} · 获取（北京时间）：{timestamp(source?.retrievedAt)}</p>
    {source?.validUntil && <details className="hb-source-details"><summary>查看有效期</summary><p>有效期至：{timestamp(source.validUntil)}</p></details>}
    {source?.lastError && <p className="hb-source-warning">最近更新异常：{source.lastError.message || source.lastError.code || '上游暂不可用'}</p>}
    {url && <a href={url} target="_blank" rel="noreferrer">查看官方来源 ↗</a>}
  </div>;
}

export function PublicMarket({site='hainan'}:{site?:EnvironmentSite}) {
  const result = useRead<PublicSources>('/api/sources');
  if (!result.data) return <div className="hb-public-market"><Card title="公开行情"><State error={result.error} reload={result.reload}/></Card><CommodityReference site={site}/></div>;
  const sources = result.data.sources;
  const market = sources.find(source => source.id === 'market') as PublicSource<FuturesData> | undefined;
  const warehouse = sources.find(source => source.id === 'warehouse') as PublicSource<WarehouseData> | undefined;
  const monthly = sources.find(source => source.id === 'monthly_report') as PublicSource<MonthlyData> | undefined;
  const rows = futuresRows(market?.data), warrants = warehouse?.data;
  const validWarrants = warrants?.scope === 'SHFE_registered_warrants' && Number.isFinite(warrants.quantityTonnes) && Number.isFinite(warrants.changeTonnes);
  const metrics = (monthly?.data?.metrics || []).filter(metric => Number.isFinite(metric.value));
  return <div className="hb-public-market">
    {result.error && <p className="hb-source-warning" role="alert">重新读取失败：{result.error} <button onClick={result.reload}>重试</button></p>}
    <Card title="公开行情 · 上期所天然橡胶期货">
      <div className="hb-source-toolbar"><p>已结算交易日：<strong>{market?.data?.tradeDate || '尚无数据'}</strong> · 收盘与结算价，单位元 / 吨</p><button onClick={result.reload}>重新读取</button></div>
      <SourceInfo source={market}/>
      {rows.length ? <div className="hb-market-table"><table><caption>同一交易日各 RU 合约报价</caption><thead><tr><th>合约</th><th>收盘 元 / 吨</th><th>结算 元 / 吨</th><th>成交量 手</th><th>持仓量 手</th></tr></thead><tbody>{rows.map(row => <tr key={row.contract}><td>{row.contract}</td><td>{number(row.closeCnyPerTonne)}</td><td>{number(row.settlementCnyPerTonne)}</td><td>{number(row.volumeLots)}</td><td>{number(row.openInterestLots)}</td></tr>)}</tbody></table></div> : <p role="status">暂无可展示的真实合约报价，请检查来源状态。</p>}
      <p className="hb-muted">已结算交易日的期货报价，非盘中行情或园区现货价。</p>
    </Card>
    <div className="hb-two">
      <Card title="公开数据 · 天然橡胶仓单">
        <SourceInfo source={warehouse}/>
        {validWarrants && warrants ? <><p>报告日期：{warrants.reportDate}</p><div className="hb-kpis"><div><span>注册仓单数量</span><strong>{number(warrants.quantityTonnes)}<small> 吨</small></strong></div><div><span>较前日变化</span><strong>{warrants.changeTonnes > 0 ? '+' : ''}{number(warrants.changeTonnes)}<small> 吨</small></strong></div></div></> : <p role="status">暂无有效仓单报表。</p>}
        <p className="hb-muted">上期所注册仓单数量，非园区库存。</p>
      </Card>
      <Card title="公开数据 · 现货与进口月报">
        <SourceInfo source={monthly}/>
        {monthly?.data && <p>{monthly.data.title} · 发布：{timestamp(monthly.data.publishedAt)}</p>}
        {metrics.length ? <div className="hb-market-table"><table><thead><tr><th>指标</th><th>数值</th><th>统计期</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric.name + metric.period}><td>{metric.name}<small className="hb-metric-scope">{metric.scope}</small></td><td>{number(metric.value)} {metricUnit(metric.unit)}</td><td>{metric.period}</td></tr>)}</tbody></table></div> : <p role="status">暂无可展示的真实月度指标。</p>}
        <p className="hb-muted">产区月度参考，非本园区成交报价。</p>
      </Card>
    </div>
    <CommodityReference site={site}/>
  </div>;
}
