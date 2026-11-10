import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAcceptanceReport } from './acceptance-report.mjs';

function report(overrides = {}) {
  return {
    version: '1',
    clock: '2026-10-17T02:00:00.000Z',
    passed: true,
    modelRequests: 0,
    repeatabilityDigest: 'sample-digest',
    scenarios: [{
      id: 'normal', title: '正常作业', input: '固定输入', expected: '等待审核', passed: true,
      checks: [{ label: '策略等待审核', passed: true, actual: 'pending_review', expected: 'pending_review' }],
      outcome: { strategyStatus: 'pending_review', taskStatus: '未下发', done: 0, count: 1, receiptCount: 0, logistics: '等待上游作业' },
      trace: [{ at: '2026-10-17T02:00:00.000Z', event: 'strategy_generated', details: { status: 'pending_review' } }],
    }],
    ...overrides,
  };
}

test('renders truthful values, fixed-time boundaries and local evidence link without executable resources', () => {
  const html = renderAcceptanceReport(report());
  assert.match(html, /本轮验证通过/);
  assert.match(html, /固定模拟时间：<time>2026-10-17T02:00:00\.000Z<\/time>/);
  assert.match(html, /不代替浏览器验收或实机验收/);
  assert.match(html, /<dt>回执数量<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>完成数量 \/ 总数量<\/dt><dd>0 \/ 1<\/dd>/);
  assert.match(html, /<details class="trace">/);
  assert.match(html, /href="acceptance\.json"/);
  assert.match(html, /node scripts\/run-acceptance\.mjs/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|\bfetch\s*\(|\b(?:src|href)="https?:|@import|url\s*\(/i);
});

test('escapes every externally supplied text field, including nested evidence and error messages', () => {
  const attack = '<img src=x onerror="alert(1)"> & \'test\'';
  const value = report({ version: attack, clock: attack, repeatabilityDigest: attack, modelRequests: attack });
  value.scenarios = [{
    id: attack, title: attack, input: attack, expected: attack, passed: false,
    checks: [{ label: attack, passed: false, actual: attack, expected: { nested: attack } }],
    outcome: { strategyStatus: attack, taskStatus: attack, done: attack, count: attack, receiptCount: attack, logistics: attack },
    trace: [{ at: attack, event: attack, details: { nested: attack } }], error: attack,
  }];
  const html = renderAcceptanceReport(value);
  assert.doesNotMatch(html, /<img\b|<script\b/);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;'));
  assert.ok(html.includes('&quot;nested&quot;:'));
  assert.match(html, /本轮验证未通过/);
});

test('empty scenarios cannot appear as a passing report even when the producer claims success', () => {
  const html = renderAcceptanceReport(report({ scenarios: [] }));
  assert.match(html, /本轮验证未通过/);
  assert.match(html, /没有场景结果/);
  assert.doesNotMatch(html, /本轮验证通过|class="result result-pass"/);
});

test('empty checks cannot appear as a passing scenario or report', () => {
  const value = report();
  value.scenarios[0].checks = [];
  const html = renderAcceptanceReport(value);
  assert.match(html, /本轮验证未通过/);
  assert.match(html, /未提供检查项，无法判定通过/);
  assert.match(html, /class="scenario is-failed"/);
  assert.doesNotMatch(html, /class="badge badge-pass"/);
});

test('failed checks override an inconsistent passing scenario flag', () => {
  const value = report();
  value.scenarios[0].checks[0].passed = false;
  const html = renderAcceptanceReport(value);
  assert.match(html, /本轮验证未通过/);
  assert.match(html, /class="scenario is-failed"/);
  assert.match(html, /aria-label="未通过"/);
});

test('scenario errors, explicit failures and nonzero model calls are never reported as overall success', () => {
  const withError = report();
  withError.scenarios[0].error = '任务未产生回执';
  const failedScenario = report();
  failedScenario.scenarios[0].passed = false;
  for (const value of [withError, failedScenario, report({ passed: false }), report({ modelRequests: 1 })]) {
    assert.match(renderAcceptanceReport(value), /本轮验证未通过/);
  }
  assert.match(renderAcceptanceReport(withError), /任务未产生回执/);
  assert.match(renderAcceptanceReport(report({ modelRequests: 1 })), /不满足零模型调用的验收要求/);
});

test('missing evidence is shown as missing, while explicit false and null are retained', () => {
  const value = report();
  value.scenarios[0].outcome = {};
  value.scenarios[0].checks = [{ label: '保留原始值', passed: false, actual: false, expected: null }];
  value.scenarios[0].trace = [];
  const html = renderAcceptanceReport(value);
  assert.match(html, /<dt>回执数量<\/dt><dd>未提供<\/dd>/);
  assert.match(html, /<dt>实际<\/dt><dd>false<\/dd>/);
  assert.match(html, /<dt>预期<\/dt><dd>null<\/dd>/);
  assert.match(html, /未提供过程记录/);
});

test('the same evidence always renders the same HTML', () => {
  const value = report();
  assert.equal(renderAcceptanceReport(value), renderAcceptanceReport(structuredClone(value)));
});


test('logistics outcomes show recorded kilogram values separately from tapping tree counts', () => {
  const value=report();
  value.scenarios[0].outcome={taskStatus:'已取消',done:1,count:2,receiptCount:2,logistics:'已登记模拟签收',logisticsStage:'received',netKg:18,receivedKg:17.8};
  const html=renderAcceptanceReport(value);
  assert.match(html, /<dt>完成数量 \/ 总数量<\/dt><dd>1 \/ 2<\/dd>/);
  assert.match(html, /<dt>收胶净重 \/ kg<\/dt><dd>18<\/dd>/);
  assert.match(html, /<dt>签收重量 \/ kg<\/dt><dd>17\.8<\/dd>/);
});
