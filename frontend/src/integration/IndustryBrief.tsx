import {useRead, DATA_MODE} from './client';
import type {ContextSnapshot, RunResponse} from './contracts';
import {Card, State} from './Views';
import {IndustryProposal} from './IndustryProposal';
import {assessIndustry, latestIndustryRunId, industryTime, type IndustryRunList} from './industryBriefData';
import './industryBrief.css';
import './marketResult.css';

export function IndustryBrief({onData}: {onData?: () => void} = {}) {
  const configuredRuns = useRead<IndustryRunList>(`/internal/harness/runs?kind=industry_brief&dataMode=${DATA_MODE}&generatorMode=configured&limit=20`,{pollMs:30000});
  const configuredId = latestIndustryRunId(configuredRuns.data);
  const configuredLatest = configuredRuns.data?.items.find(item => item.runId === configuredId);
  const configuredRecord=useRead<RunResponse>(configuredId?`/internal/harness/runs/${configuredId}`:null,{pollMs:30000});
  const configuredExpired=configuredRecord.data?.status==='succeeded'&&configuredRecord.data.strategy.qualityReview?.status!=='withdrawn'&&Date.parse(configuredRecord.data.strategy.expiresAt)<=Date.now();
  const configuredUsable = Boolean(configuredLatest && ['succeeded','queued','running'].includes(configuredLatest.status)&&!configuredExpired);
  const ruleRuns = useRead<IndustryRunList>(configuredRuns.data && !configuredUsable && !configuredRuns.error ? `/internal/harness/runs?kind=industry_brief&dataMode=${DATA_MODE}&generatorMode=demo_rules&limit=20` : null,{pollMs:30000});
  // A terminal configured failure can be replaced by the explicitly prepared
  // rule package; active or successful configured runs remain authoritative.
  const runs = configuredUsable || configuredRuns.error || !configuredRuns.data || (configuredExpired&&!ruleRuns.data?.items.length) ? configuredRuns : ruleRuns;
  const id = latestIndustryRunId(runs.data);
  const result = useRead<RunResponse>(id ? `/internal/harness/runs/${id}` : null,{pollMs:30000});
  const context = useRead<ContextSnapshot>(id ? `/internal/harness/runs/${id}/context` : null);
  const control = useRead<{paused: boolean}>('/api/model/control');
  const assessment = assessIndustry(result.data, context.data, runs.error || result.error || (result.data?.status === 'succeeded' ? context.error : undefined));
  const records = context.data?.modules.industry?.records || [];
  const missing = result.data?.status === 'needs_data' ? result.data.missingData : [];
  const reload = () => {configuredRuns.reload(); configuredRecord.reload();ruleRuns.reload(); result.reload(); context.reload(); control.reload();};
  return <div className="hb-industry-workspace">
    <Card title="行业与经营研判">
      <div className="hb-industry-result-toolbar"><span>{control.data?.paused ? '模型调用已暂停 · 查看已存建议' : '查看已保存的管理建议'}</span><button onClick={reload}>重新读取</button></div>
      {control.error && <p className="hb-industry-notice" role="status">模型控制状态读取失败：{control.error}</p>}
      {!runs.data ? <State error={runs.error} reload={runs.reload}/> : !id ? <p role="status">尚无行业研判记录，请先发起分析。</p> : <>
        {!assessment.available && <p className={'hb-industry-status '+assessment.status} role="status">{assessment.message}</p>}
        {assessment.available && assessment.strategy && <><p className="hb-result-eyebrow">{assessment.strategy.fallback ? '规则保底建议 · 待人工复核' : assessment.strategy.generationMetadata || assessment.strategy.modelVersion ? '模型研判 · 待人工复核' : '规则演示 · 待人工复核'}</p><IndustryProposal s={assessment.strategy} records={records}/><details className="hb-result-details"><summary>研判摘要</summary><p>{assessment.strategy.summary}</p></details></>}
        {missing.length > 0 && <ul className="hb-industry-gaps">{missing.map((item, index) => <li key={index}>{item.reason}</li>)}</ul>}
        {result.data?.status === 'succeeded' && result.data.strategy.qualityReview?.status === 'withdrawn' && result.data.strategy.qualityReview.notes.map((note, index) => <p key={index}>撤回原因：{note}</p>)}
      </>}
    <details className="hb-result-details hb-industry-input-details"><summary>研判时间与引用依据</summary>
      <p className="hb-muted">企业加工、库存、订单和运输使用模拟记录。</p>
      {result.data?.status === 'succeeded' && <p className="hb-time">生成：{industryTime(result.data.strategy.generatedAt)} · 有效至：{industryTime(result.data.strategy.expiresAt)}<br/>生成来源：{result.data.strategy.fallback ? '保守规则保底 · 大脑候选未采用' : result.data.strategy.generationMetadata ? `大模型 · ${result.data.strategy.generationMetadata.provider} / ${result.data.strategy.generationMetadata.model}` : result.data.strategy.modelVersion ? `外部模型 / ${result.data.strategy.modelVersion}` : '演示规则（未调用大模型）'}</p>}
      {result.data?.status === 'succeeded' && result.data.strategy.fallback && <div className="hb-industry-notice"><strong>已生成保守策略包，待人工复核</strong><p>大脑候选未通过独立校验或服务不可用，本次展示同一输入快照的规则保底结果。</p><p>{result.data.strategy.fallback.reasonCode}：{result.data.strategy.fallback.message}</p>{result.data.strategy.fallback.details.map((detail,index)=><p key={index}>{detail}</p>)}</div>}
      {id && context.data && <><p>本次输入时间：{industryTime(context.data.asOf)}。</p><ul>{records.map(record => <li key={record.observationId}>{record.title} · {record.period} · {record.scope}</li>)}</ul></>}
      {onData && <button onClick={onData}>查看完整行业资料 →</button>}
    </details>
    </Card>
  </div>;
}
