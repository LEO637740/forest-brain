import {useRead, DATA_MODE} from './client';
import type {ContextSnapshot} from './contracts';
import {latestIndustryRunId, industryRecordState, industrySourceUrl, industryTime, type IndustryRunList} from './industryBriefData';
import {publicSourceState, type PublicSources} from './publicMarketData';

function recordContent(content: string) {
  try {return JSON.stringify(JSON.parse(content), null, 2);} catch {return content;}
}

export function IndustryRecords() {
  const configured = useRead<IndustryRunList>(`/internal/harness/runs?kind=industry_brief&dataMode=${DATA_MODE}&generatorMode=configured&limit=20`);
  const configuredId = latestIndustryRunId(configured.data);
  const latest = configured.data?.items.find(item => item.runId === configuredId);
  const useConfigured = Boolean(latest && ['succeeded','queued','running'].includes(latest.status));
  const rules = useRead<IndustryRunList>(configured.data && !useConfigured && !configured.error ? `/internal/harness/runs?kind=industry_brief&dataMode=${DATA_MODE}&generatorMode=demo_rules&limit=20` : null);
  const runs = useConfigured || configured.error || !configured.data ? configured : rules;
  const id = latestIndustryRunId(runs.data);
  const context = useRead<ContextSnapshot>(id ? `/internal/harness/runs/${id}/context` : null);
  const sources = useRead<PublicSources>('/api/sources');
  const records = context.data?.modules.industry?.records ?? [];
  const reload = () => {configured.reload(); rules.reload(); context.reload(); sources.reload();};
  return <div className="dc-industry-records">
    <section className="dc-intro"><div><h2>行业研判使用的资料</h2><p>公开资料与模拟企业记录保留原统计期、地区和来源；企业样例不代表当前园区。</p></div><button onClick={reload}>重新读取资料</button></section>
    <section className="dc-panel"><h3>最近一次研判的输入</h3>
      {runs.error || context.error ? <p role="alert">资料读取失败：{runs.error || context.error}</p> : !runs.data ? <p role="status">正在读取行业记录…</p> : !id ? <p>尚无已保存的行业研判输入。</p> : !context.data ? <p role="status">正在读取本轮资料…</p> : <>
        <p>本轮资料保存于 {industryTime(context.data.asOf)}。以下保留当时的输入，不随最新行情改写。</p>
        {records.length ? <div className="dc-table"><table><thead><tr><th>资料</th><th>统计期 / 范围</th><th>来源与状态</th><th>资料内容</th></tr></thead><tbody>{records.map(record => {const url = industrySourceUrl(record); return <tr key={record.observationId}><td>{record.title}<small>获取：{industryTime(record.retrievedAt)}</small></td><td>{record.period}<small>{record.scope}</small></td><td>{industryRecordState(record)}<small>{url ? <a href={url} target="_blank" rel="noreferrer">查看原始来源 ↗</a> : '本地演示记录'}</small></td><td><details><summary>查看原始资料</summary><pre className="dc-record-content">{recordContent(record.content)}</pre></details></td></tr>;})}</tbody></table></div> : <p>本轮尚无行业资料。</p>}
        {Boolean(context.data.modules.industry?.gaps.length) && <details><summary>资料缺项与来源限制</summary><ul>{context.data.modules.industry?.gaps.map((gap,index) => <li key={index}>{gap}</li>)}</ul></details>}
      </>}
    </section>
    <section className="dc-panel"><h3>当前公开来源状态</h3><p>下列状态更新至最近采集时间，与上方保存的研判输入分别展示。</p>
      {sources.error && <p role="alert">来源状态读取失败：{sources.error}</p>}
      {sources.data ? <ul className="hb-industry-sources">{sources.data.sources.map(source => {const state = publicSourceState(source); return <li key={source.id}><strong>{source.title || source.id}</strong><span>{state.label}</span><small>最近获取：{industryTime(source.retrievedAt)}</small></li>;})}</ul> : !sources.error && <p role="status">正在读取来源状态…</p>}
    </section>
  </div>;
}
