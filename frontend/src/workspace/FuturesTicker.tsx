import {useState} from 'react';
import {useRead} from '../integration/client';
import type {RubberMarketQuotes, RubberQuote} from '../../../shared/marketQuotes';
import './futuresTicker.css';

const number = (value:number) => value.toLocaleString('zh-CN',{maximumFractionDigits:2});
const signed = (value:number) => `${value>0?'+':''}${number(value)}`;
const timestamp = (value:string|null) => value ? new Date(value).toLocaleString('zh-CN',{
  timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,
}) : null;
const direction = (quote:RubberQuote) => {
  const change=quote.change??quote.changePct??0;
  return change>0?'ft-up':change<0?'ft-down':'ft-flat';
};
const changeText = (quote:RubberQuote) => quote.change===null && quote.changePct===null ? '涨跌待更新'
  : [quote.change===null?null:signed(quote.change),quote.changePct===null?null:`${signed(quote.changePct)}%`].filter(Boolean).join(' / ');

export function FuturesTicker() {
  const result = useRead<RubberMarketQuotes>('/api/market/quotes',{pollMs:30000});
  const [paused,setPaused] = useState(false);
  const data = result.data, quotes = data?.quotes??[];
  const stale = Boolean(result.error) || data?.status==='stale';
  const timing = data?.mode==='daily' ? '收盘日报' : data?.delayMinutes!==null && data?.delayMinutes!==undefined ? `延时 ${data.delayMinutes} 分钟` : '盘中行情';
  const state = data?.status==='offline' ? '离线演示' : !quotes.length ? '等待行情' : stale ? `${timing} · 保留上次行情` : timing;
  const quoteTime = data?.mode==='daily' ? data.tradeDate : timestamp(data?.quoteAt??null);
  const renderQuote = (quote:RubberQuote) => <div className={`ft-quote ${direction(quote)}`} key={quote.contract} role="listitem">
    <span className="ft-contract">{quote.contract}</span>
    <strong key={`${quote.contract}:${quote.lastPrice}`} className="ft-number">{number(quote.lastPrice)}</strong>
    <span className="ft-change">{changeText(quote)}</span>
  </div>;
  return <section className={`ft-ticker${paused?' ft-paused':''}`} aria-label="天然橡胶期货行情">
    <header className="ft-header">
      <div className="ft-heading"><h3>天然橡胶期货</h3><span className="ft-source">{data?.provider||'上海期货交易所'}</span><span className="ft-badge">{state}</span></div>
      <div className="ft-tools">{quotes.length>0&&<button type="button" aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?'继续滚动':'暂停滚动'}</button>}<button type="button" onClick={result.reload}>刷新行情</button></div>
    </header>
    {quotes.length ? <>
      <div className="ft-viewport" tabIndex={0} aria-label="合约报价，聚焦时暂停滚动">
        <div className="ft-track">
          <div className="ft-group" role="list" aria-label="天然橡胶合约报价">{quotes.map(renderQuote)}</div>
          <div className="ft-group ft-duplicate" aria-hidden="true">{quotes.map(renderQuote)}</div>
        </div>
      </div>
      <footer className="ft-footer"><span>元 / 吨 · 涨跌较昨结 · 期货价格不等同鲜胶乳收购价</span><span>{quoteTime?`行情 ${quoteTime}`:'行情时间待更新'}{data?.mode==='delayed'?' · 每 30 秒更新':''}{stale?' · 更新暂缓':''}</span></footer>
      <details className="ft-details"><summary>全部合约与来源</summary>
        <div className="ft-table-wrap"><table><thead><tr><th>合约</th><th>{data?.mode==='daily'?'收盘价':'最新价'}（元 / 吨）</th><th>较昨结涨跌</th><th>成交量（手）</th></tr></thead><tbody>{quotes.map(quote=><tr key={quote.contract}><th>{quote.contract}</th><td>{number(quote.lastPrice)}</td><td className={direction(quote)}>{changeText(quote)}</td><td>{quote.volumeLots===null?'—':number(quote.volumeLots)}</td></tr>)}</tbody></table></div>
        <p>{data?.provider} · {timing}{data?.fetchedAt?` · 最近读取 ${timestamp(data.fetchedAt)}`:''}{data?.sourceUrl&&<> · <a href={data.sourceUrl} target="_blank" rel="noreferrer">查看行情来源 ↗</a></>}</p>
      </details>
    </> : <div className="ft-empty" role="status">{result.error?'行情暂未读到，稍后自动更新。':data?.message||(data?.status==='offline'?'离线演示未连接期货行情。':data?'暂未取得期货报价，稍后自动更新。':'正在读取期货行情…')}</div>}
  </section>;
}
