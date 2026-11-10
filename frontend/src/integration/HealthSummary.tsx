import {useEffect, useState} from 'react';
import {alias, indexOf, siteIdOf, useRead, useScenario, type EnvironmentSite, type Park} from './client';
import {assessHealth, type HealthAssessment} from './healthAssessment';

const blockOf=(treeId:string)=>'ABCD'[Math.min(3,Math.max(0,Math.floor((Number(treeId.replace(/^T-/,'')||1)-1)/50)))];

export function useHealthSummary(site:EnvironmentSite='hainan') {
  const scenario = useScenario('park-health',site);
  const [now, setNow] = useState(Date.now);
  const expiresAt = scenario.result.data?.status === 'succeeded' ? scenario.result.data.strategy.expiresAt : undefined;
  useEffect(() => {
    if (!expiresAt) return;
    const expires = Date.parse(expiresAt);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(2_147_483_647, expires - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  useEffect(() => {
    if (!scenario.result.data || !['queued','running'].includes(scenario.result.data.status)) return;
    const timer = setInterval(scenario.result.reload, 1000);
    return () => clearInterval(timer);
  }, [scenario.result.data?.status]);
  const assessment = assessHealth(scenario.result.data, scenario.context.data, scenario.result.error || scenario.context.error || scenario.session.error, Math.max(now, Date.now()));
  return {...scenario, assessment};
}

export function HealthCounts({assessment}: {assessment: HealthAssessment}) {
  const blockFor=(treeId:string)=>'ABCD'[Math.min(3,Math.max(0,Math.floor((Number(treeId.replace(/^T-/,'')||1)-1)/50)))];
  return <div className="hb-health-counts">{'ABCD'.split('').map(block => {
    const covered = assessment.treeIds.filter(id => blockFor(id)===block);
    const findings = assessment.findings.filter(f => covered.includes(f.treeId));
    return <div key={block}><strong>{block} 区</strong>{assessment.available && covered.length ? <><p>需复核 {findings.filter(f => f.riskLevel === 'review').length} · 关注 {findings.filter(f => f.riskLevel === 'watch').length}</p><small>本次未触发 {covered.length - findings.length} / 已分析 {covered.length} 株</small></> : <p>待更新 · 无有效统计</p>}</div>;
  })}</div>;
}

export function AnalyticsHealthSummary({site='hainan',onTree}:{site?:EnvironmentSite;onTree?:(index:number)=>void}) {
  const {assessment, result} = useHealthSummary(site);
  const park = useRead<Park>(`/api/demo/park?siteId=${siteIdOf(site)}`);
  const records = park.data?.modules.health?.records ?? [];
  const modes = {simulated:'模拟记录', measured:'实测记录', estimated:'估计记录', forecast:'预测记录'};
  const time = (value:string) => new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'});
  return <><p role="status">{assessment.message}{!assessment.available && <button onClick={result.reload}>重新读取</button>}</p><HealthCounts assessment={assessment}/><p className="ax-note">与策略中心使用同一份园区健康分析{assessment.generatedAt ? `，生成于 ${time(assessment.generatedAt)}` : ''}。这是当前结果，不随上方产量日期筛选变化；模拟巡查与规则推断不构成病害诊断。</p>
    <section aria-label="园区健康分布"><h4>本轮分析对象分布</h4><div className="hb-tree-grid">{assessment.treeIds.map(treeId => {
      const finding = assessment.findings.find(item => item.treeId === treeId);
      const state = !assessment.available ? '待更新' : finding?.riskLevel === 'review' ? '需复核' : finding ? '关注' : '本次未触发';
      const label = alias(treeId,siteIdOf(site)), index = indexOf(treeId);
      return <button key={treeId} aria-label={`${label} · ${state}`} title={`${label} · ${state}`} className={!assessment.available?'unknown':finding?'risk':''} disabled={!onTree||index===undefined} onClick={() => {if(index!==undefined)onTree?.(index);}}/>;
    })}</div><p className="ax-note">{assessment.available?'暖色：关注或需复核；灰绿：本次未触发。点击树位查看单树档案。':'灰色：状态待更新，当前不能据此判断无风险。'}</p></section>
    <details className="ax-health-records"><summary>巡查原始资料{park.data ? ` · ${records.length} 条` : ''}</summary><p className="ax-note">所选园区当前可见的巡查记录，保留原始症状、来源和观察时间；不依赖健康策略是否已经生成。</p>{park.error && <p role="alert">巡查资料读取失败：{park.error} <button onClick={park.reload}>重新读取资料</button></p>}{!park.data ? !park.error && <p role="status">正在读取巡查资料…</p> : records.length ? <div className="ax-table-scroll"><table><thead><tr><th>对象</th><th>观察时间</th><th>症状与既有诊断记录</th><th>来源</th><th>资料状态</th></tr></thead><tbody>{records.map(record => <tr key={record.recordId}><td>{alias(record.treeId,siteIdOf(site))}</td><td>{time(record.observedAt)}</td><td>{record.symptomCodes.join('、')||'本条记录未标注症状'}{record.confirmedDiagnosis && <small>已有诊断：{record.confirmedDiagnosis.code} · {record.confirmedDiagnosis.actorId} · {time(record.confirmedDiagnosis.confirmedAt)}</small>}</td><td>{modes[record.provenance.mode]}<small>{record.provenance.sourceId}</small></td><td>{record.quality==='valid'?'已记录':record.quality==='missing'?'缺少资料':'待核验'}</td></tr>)}</tbody></table></div> : <p>当前园区尚无可展示的巡查原始记录。</p>}</details>
  </>;
}
