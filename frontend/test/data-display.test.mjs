import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';
import {allocateTreeSamples, treeScopeSeries} from '../../shared/analyticsScope.ts';
import {parks, productionSites} from '../../shared/parkCatalog.ts';
import {treeAlias} from '../src/workspace/model.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc, parseAst} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Compile the real TS/TSX declarations. Only network hooks and unrelated children
// are supplied as fixtures; the display and calculation code is not copied.
const sourceRoot = new URL('../src/', import.meta.url);
async function declarations(file, names) {
  const {code} = await transformWithOxc(readFileSync(new URL(file, sourceRoot), 'utf8'), file, {lang: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: {runtime: 'classic'}});
  const nodes = parseAst(code).body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n).filter(Boolean).filter(n => n.type === 'FunctionDeclaration' ? names.includes(n.id?.name) : n.type === 'VariableDeclaration' && n.declarations.some(d => names.includes(d.id.name)));
  const found = nodes.flatMap(n => n.type === 'FunctionDeclaration' ? [n.id.name] : n.declarations.map(d => d.id.name));
  for (const name of names) assert.ok(found.includes(name), `Compiled ${name} from ${file}`);
  return nodes.map(n => code.slice(n.start, n.end)).join('\n');
}
const helpers = [
  await declarations('integration/healthAssessment.ts', ['assessHealth']),
  await declarations('workspace/analyticsData.ts', ['REPORT_END', 'reportDate', 'BASE_DATA', 'DATA', 'allocateTrees', 'blockSeries']),
  await declarations('workspace/analyticsSource.ts', ['analyticsSource', 'matchingDates', 'perTap', 'analyticsCsv']),
].join('\n');
const {assessHealth, DATA, analyticsSource, matchingDates, analyticsCsv} = new Function('parks', 'productionSites', 'allocateTreeSamples', 'treeScopeSeries', helpers + '\nreturn {assessHealth,DATA,analyticsSource,matchingDates,analyticsCsv};')(parks, productionSites, allocateTreeSamples, treeScopeSeries);
const componentCode = [helpers,
  await declarations('integration/client.ts', ['valid', 'statuses', 'alias', 'indexOf', 'siteIdOf', 'useScenario']),
  await declarations('integration/Views.tsx', ['Card', 'State', 'Chart', 'StrategyBody', 'Result', 'WeatherChart', 'when']),
  await declarations('integration/HealthSummary.tsx', ['useHealthSummary', 'HealthCounts', 'AnalyticsHealthSummary']),
  await declarations('integration/StrategyWorkspace.tsx', ['Health', 'Weather']),
  await declarations('integration/ParkWeather.tsx', ['weatherTime', 'windowLabels', 'ParkWeather']),
  await declarations('workspace/AnalyticsPage.tsx', ['topics', 'green', 'blue', 'red', 'fmt', 'date', 'Panel', 'Grid', 'AnalyticsPage']),
].join('\n');
const mapping = JSON.parse(readFileSync(new URL('integration/tree-map.json', sourceRoot), 'utf8'));
const sites = {hainan: '海南', xsbn: '西双版纳', xian: '西安'};
const now = Date.now();
const strategy = {kind: 'pest_risk', strategyId: 'health-test', runId: 'health-run', summary: '近期症状需复核', revision: 1,
  inputSnapshot: {snapshotId: 'snapshot-1', version: 1}, targetSnapshotId: 'target-1', generatedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), reasons: [],
  proposal: {horizon: {start: new Date(now).toISOString(), end: new Date(now + 86_400_000).toISOString()}, findings: [{treeId: 'T-0005', riskLevel: 'review', reason: '近期症状', symptomCodes: ['leaf_spot']}]}};
const context = {snapshotId: 'snapshot-1', targetSnapshot: {targetSnapshotId: 'target-1', treeIds: ['T-0001', 'T-0005']}};
const cases = {
  risk: {status: 'succeeded', strategy},
  clear: {status: 'succeeded', strategy: {...strategy, proposal: {...strategy.proposal, findings: []}}},
  expired: {status: 'succeeded', strategy: {...strategy, expiresAt: new Date(now - 1000).toISOString()}},
  withdrawn: {status: 'succeeded', strategy: {...strategy, qualityReview: {status: 'withdrawn'}}},
  failed: {status: 'failed', error: {message: '测试分析失败'}},
  needsData: {status: 'needs_data', missingData: [{reason: '缺少巡查记录'}]},
};
function runtime({health = cases.risk, snapshot = context, reads = {}} = {}) {
  const calls = [];
  const fixtures = {
    '/harness-session.json': {jobs: [{key: 'park-health', runId: 'health-run'}, {key: 'morning', runId: 'morning-run'}]},
    '/internal/harness/runs/health-run': health,
    '/internal/harness/runs/health-run/context': snapshot,
    ...reads,
  };
  const useRead = path => {calls.push(path); const item = fixtures[path]; return typeof item?.error === 'string' ? {error: item.error, reload() {}} : {data: item, reload() {}};};
  const exports = new Function('resolveTreeIdentity', 'parks', 'productionSites', 'allocateTreeSamples', 'treeScopeSeries', 'treeAlias', 'React', 'useState', 'useRef', 'useEffect', 'useMemo', 'useRef', 'useRead', 'mapping', 'sites', 'Download', 'BackendMeasurements', 'StrategyRecommendation', componentCode + '\nreturn {Health,Weather,AnalyticsHealthSummary,AnalyticsPage,useScenario};')(
    resolveTreeIdentity, parks, productionSites, allocateTreeSamples, treeScopeSeries, treeAlias, React, React.useState, React.useRef, React.useEffect, React.useMemo, React.useRef, useRead, mapping, sites, () => React.createElement('svg'), () => null, () => null);
  return {...exports, calls};
}

test('health action list and data analysis summary distinguish clear results from unavailable results', () => {
  for (const [name, health] of Object.entries(cases)) {
    const {Health, AnalyticsHealthSummary} = runtime({health});
    const html = renderToStaticMarkup(React.createElement(Health, {onTree() {}}));
    const summary = renderToStaticMarkup(React.createElement(AnalyticsHealthSummary));
    if (name === 'risk') {
      assert.match(html, /HN-A-0005/);
      assert.match(html, /查看单树/);
      assert.match(html, /需复核/);
      assert.match(summary, /需复核 1/);
    } else if (name === 'clear') {
      assert.match(html, /本轮未触发健康风险建议/);
      assert.doesNotMatch(html, /查看单树/);
      assert.match(summary, /本次未触发 2/);
    } else {
      assert.doesNotMatch(html, /本轮未触发健康风险建议|查看单树/, name);
      assert.match(html, /当前没有有效健康判断/, name);
      assert.match(summary, /待更新 · 无有效统计/, name);
      assert.doesNotMatch(summary, /需复核 0|本次未触发 2/, name);
    }
  }
});

test('health mismatched or unreadable snapshots cannot establish no risk', () => {
  assert.equal(assessHealth(cases.risk, {...context, snapshotId: 'different'}, undefined, now).available, false);
  assert.equal(assessHealth(cases.clear, context, '网络中断', now).available, false);
  assert.equal(assessHealth(cases.clear, undefined, undefined, now).available, false);
  assert.equal(assessHealth(cases.risk, context, undefined, Date.parse(strategy.expiresAt)).available, false);
});

test('data center health distribution and original patrol records retain selected park and remain readable without a strategy', () => {
  const observedAt='2026-10-26T01:00:00Z';
  const patrol={recordId:'patrol-5',treeId:'T-0005',observedAt,symptomCodes:['leaf_spot'],confirmedDiagnosis:null,quality:'valid',provenance:{mode:'simulated',sourceId:'XS巡查员记录'}};
  const snapshot={...context,siteId:'demo-xsbn',modules:{health:{records:[patrol,{...patrol,recordId:'outside',treeId:'T-0100',provenance:{...patrol.provenance,sourceId:'不在分析范围'}}]}}};
  for(const [name,health] of [['risk',cases.risk],['expired',cases.expired],['failed',cases.failed]]) {
    const {AnalyticsHealthSummary,calls}=runtime({reads:{'/api/demo/health?siteId=demo-xsbn':{result:health,context:snapshot},'/api/demo/park?siteId=demo-xsbn':{modules:{health:{records:[patrol]}}}}});
    const html=renderToStaticMarkup(React.createElement(AnalyticsHealthSummary,{site:'xsbn',onTree(){}}));
    assert.ok(calls.includes('/api/demo/health?siteId=demo-xsbn'));
    assert.ok(calls.includes('/api/demo/park?siteId=demo-xsbn'));
    assert.match(html,/园区健康分布/);assert.match(html,/XS-A-0005/);assert.doesNotMatch(html,/HN-A-0005/);
    assert.match(html,/巡查原始资料 · 1 条/);assert.match(html,/leaf_spot/);assert.match(html,/XS巡查员记录/);
    assert.match(html,/2026\/10\/26 09:00:00/);assert.doesNotMatch(html,/不在分析范围/);
    if(name!=='risk'){assert.match(html,/XS-A-0005 · 待更新/);assert.doesNotMatch(html,/XS-A-0005 · 本次未触发/);}
    else assert.match(html,/XS-A-0005 · 需复核/);
  }
});

test('unavailable park weather does not fall back to saved simulation scenes', () => {
  const {Weather, calls} = runtime({reads:{'/api/weather/window?siteId=demo-hainan':{error:'天气服务暂不可用'}}});
  const html = renderToStaticMarkup(React.createElement(Weather));
  assert.deepEqual(calls, ['/api/weather/window?siteId=demo-hainan']);
  assert.match(html, /天气服务暂不可用/);
  assert.doesNotMatch(html, /模拟早间窗口|模拟降雨|候选作业窗口|预报降雨 mm趋势/);
});

const remote = site => ({site, asOf: '2026-10-07T00:00:00.000Z', source: {mode: 'backend_demo', label: '后端可复现演示序列', rainfall: '后端模拟降雨'}, rows: Array.from({length: 30}, (_, i) => ({date: new Date(Date.UTC(2026, 8, 8 + i)).toISOString().slice(0, 10), actual: site === 'hainan' ? 40 : 30, forecast: 42, taps: 100, rain: 3}))});

test('analytics preserves source and date provenance through remote, fallback and CSV', () => {
  const live = analyticsSource('hainan', remote('hainan'));
  const offline = analyticsSource('hainan', undefined, '服务不可用');
  assert.equal(live.fallback, false);
  assert.equal(offline.fallback, true);
  assert.match(offline.message, /后端读取失败.*本地固定模拟样本/);
  assert.equal(offline.rows.at(-1).date, DATA.hainan.at(-1).date);
  const csv = analyticsCsv(offline.rows.slice(-7), '海南 A', offline);
  assert.match(csv, /本地固定模拟样本/);
  assert.doesNotMatch(csv, /后端演示序列/);
  assert.equal(csv.split('\n').length, 8);
  assert.match(csv, /2026-09-22/);
  assert.match(analyticsCsv(live.rows.slice(-7), '海南 A', live), /后端可复现演示序列/);
  assert.equal(analyticsSource('hainan', {...remote('hainan'), rows: []}).fallback, true);
});

test('comparison uses the exact selected dates and never substitutes another date range', () => {
  const current = analyticsSource('hainan', remote('hainan'));
  const other = analyticsSource('xsbn', remote('xsbn'));
  assert.deepEqual(matchingDates(current.rows.slice(-7), other, true).map(d => d.date), current.rows.slice(-7).map(d => d.date));
  assert.equal(matchingDates(current.rows, {...other, rows: other.rows.slice(1)}, true), null);
  assert.equal(matchingDates(current.rows, analyticsSource('xsbn'), true), null);
  assert.equal(matchingDates(DATA.hainan.slice(-7), analyticsSource('xsbn'), false).length, 7);
});

test('analytics page renders a visible failure and matching fallback, or suppresses incomplete comparison', () => {
  const paths = {hainan: '/api/demo/analytics?site=hainan&days=30', xsbn: '/api/demo/analytics?site=xsbn&days=30'};
  const props = {site: 'hainan', onTree() {}, onStory() {}, onNotify() {}};
  const offline = runtime({reads: {[paths.hainan]: {error: '连接已断开'}, [paths.xsbn]: {error: '连接已断开'}}});
  const offlineHtml = renderToStaticMarkup(React.createElement(offline.AnalyticsPage, props));
  assert.match(offlineHtml, /class="ax-data-status fallback" role="status"/);
  assert.match(offlineHtml, /后端读取失败：连接已断开/);
  assert.match(offlineHtml, /本地固定模拟样本/);
  assert.doesNotMatch(offlineHtml, /后端空间样本快照|正在读取后端分析序列/);
  const partial = runtime({reads: {[paths.hainan]: remote('hainan'), [paths.xsbn]: {error: '连接已断开'}}});
  const partialHtml = renderToStaticMarkup(React.createElement(partial.AnalyticsPage, props));
  assert.match(partialHtml, /同期数据尚未齐备，暂不比较/);
  assert.doesNotMatch(partialHtml, /本地固定模拟样本/);
  const online = runtime({reads: {[paths.hainan]: remote('hainan'), [paths.xsbn]: remote('xsbn')}});
  const onlineHtml = renderToStaticMarkup(React.createElement(online.AnalyticsPage, props));
  assert.match(onlineHtml, /相同日期 30 天/);
  assert.match(onlineHtml, /0\.400/);
  assert.match(onlineHtml, /0\.300/);
  assert.doesNotMatch(onlineHtml, /NaN|Infinity|后端空间样本快照/);
});

