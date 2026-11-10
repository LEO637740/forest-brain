/** Render an offline report without scripts, remote resources, or generated evidence. */
export function renderAcceptanceReport(report = {}) {
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const checksOf = scenario => Array.isArray(scenario.checks) ? scenario.checks : [];
  const scenarioPassed = scenario => scenario.passed === true && !scenario.error
    && checksOf(scenario).length > 0 && checksOf(scenario).every(check => check.passed === true);
  const passing = scenarios.filter(scenarioPassed).length;
  const checks = scenarios.flatMap(checksOf);
  const passed = report.passed === true && scenarios.length > 0 && passing === scenarios.length
    && report.modelRequests === 0;
  const overallLabel = passed ? '本轮验证通过' : '本轮验证未通过';
  const modelConstraint = report.modelRequests === 0
    ? '模型请求记录为 0 次。所有结果来自固定输入与本地业务逻辑。'
    : `模型请求记录为 ${escapeHtml(displayValue(report.modelRequests))} 次，不满足零模型调用的验收要求。`;

  const cards = scenarios.map((scenario, index) => {
    const scenarioChecks = checksOf(scenario);
    const success = scenarioPassed(scenario);
    const outcome = scenario.outcome ?? {};
    const trace = Array.isArray(scenario.trace) ? scenario.trace : [];
    const outcomeRows = [
      ['策略状态', outcome.strategyStatus],
      ['任务状态', outcome.taskStatus],
      ['完成数量 / 总数量', `${displayValue(outcome.done)} / ${displayValue(outcome.count)}`],
      ['回执数量', outcome.receiptCount],
      ['收胶与转运', outcome.logistics],
      ...(outcome.logisticsStage ? [['收胶净重 / kg',outcome.netKg],['签收重量 / kg',outcome.receivedKg]] : []),
    ];
    return `<article class="scenario ${success ? 'is-passed' : 'is-failed'}">
      <header class="scenario-heading">
        <span class="scenario-number">${String(index + 1).padStart(2, '0')}</span>
        <div class="scenario-name"><p class="scenario-id">${escapeHtml(displayValue(scenario.id))}</p><h2>${escapeHtml(displayValue(scenario.title))}</h2></div>
        <span class="badge ${success ? 'badge-pass' : 'badge-fail'}">${success ? '通过' : '未通过'}</span>
      </header>
      <div class="scenario-body">
        <div class="premise"><p><span class="field-label">固定输入</span>${escapeHtml(displayValue(scenario.input))}</p><p><span class="field-label">预期行为</span>${escapeHtml(displayValue(scenario.expected))}</p></div>
        <dl class="outcomes">${outcomeRows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(displayValue(value))}</dd></div>`).join('')}</dl>
        ${scenario.error ? `<div class="error"><strong>运行错误</strong><pre>${escapeHtml(displayValue(scenario.error))}</pre></div>` : ''}
        ${scenarioChecks.length === 0 ? '<p class="empty warning">未提供检查项，无法判定通过。</p>' : `<ul class="checks">${scenarioChecks.map(check => `<li class="${check.passed === true ? 'check-pass' : 'check-fail'}"><span class="check-mark" aria-label="${check.passed === true ? '通过' : '未通过'}">${check.passed === true ? '✓' : '×'}</span><div><span>${escapeHtml(displayValue(check.label))}</span>${hasOwn(check, 'actual') || hasOwn(check, 'expected') ? `<dl class="check-values">${hasOwn(check, 'actual') ? `<div><dt>实际</dt><dd>${escapeHtml(displayValue(check.actual))}</dd></div>` : ''}${hasOwn(check, 'expected') ? `<div><dt>预期</dt><dd>${escapeHtml(displayValue(check.expected))}</dd></div>` : ''}</dl>` : ''}</div></li>`).join('')}</ul>`}
        <details class="trace"><summary>查看过程证据<span>${trace.length} 条记录</span></summary>${trace.length > 0 ? `<ol>${trace.map(entry => `<li><div class="trace-heading"><strong>${escapeHtml(displayValue(entry.event))}</strong><time>${escapeHtml(displayValue(entry.at))}</time></div>${hasOwn(entry, 'details') ? `<pre>${escapeHtml(displayValue(entry.details))}</pre>` : ''}</li>`).join('')}</ol>` : '<p class="empty">未提供过程记录，请查看原始证据。</p>'}</details>
      </div>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>胶林项目 · 二阶段离线验收报告</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#21372f;background:#f3f6f2;font-synthesis:none;line-height:1.65;font-size:15px}
    *{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:0 auto;padding:48px 28px 32px}a{color:#13694e;text-underline-offset:4px}a:focus-visible,summary:focus-visible{outline:3px solid #dfb957;outline-offset:5px}h1,h2,p,dl,dd{margin:0}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.7}.eyebrow{font-size:12px;letter-spacing:2px;color:#567366;font-weight:700}.hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.hero h1{font-size:34px;line-height:1.3;letter-spacing:-1px;margin:9px 0 12px;font-weight:700}.subtitle{color:#5b6f65;max-width:720px}.result{white-space:nowrap;margin-top:6px;padding:10px 16px;border-radius:9px;border:1px solid;font-size:14px;font-weight:700}.result-pass{background:#e0f0e5;color:#22613f;border-color:#c5e0ce}.result-fail{background:#fff1e8;color:#96482b;border-color:#efc8b3}.boundary{margin-top:28px;padding:16px 20px;border-left:4px solid #49735a;background:#e9efe7;border-radius:0 8px 8px 0}.boundary strong{display:block;font-size:14px}.boundary p{color:#5b6f65;font-size:13px;margin-top:4px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0 30px}.metric{background:#fff;border:1px solid #dfe6dd;border-radius:10px;padding:17px 20px}.metric dt{font-size:12px;color:#64766d}.metric dd{font-size:27px;line-height:1.3;font-weight:700;margin-top:6px;overflow-wrap:anywhere}.metric dd small{font-size:13px;font-weight:400;color:#708077}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:14px}.section-heading h2{font-size:18px}.section-heading p{font-size:12px;color:#66796d}.scenario-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.scenario{background:#fff;border:1px solid #dce5da;border-radius:12px;overflow:hidden}.is-failed{border-color:#e6b7a0}.scenario-heading{display:flex;align-items:center;gap:12px;padding:19px 20px;border-bottom:1px solid #edf1ea;background:#fcfdfa}.scenario-number{font-size:21px;line-height:1.2;color:#759078;font-weight:600;font-variant-numeric:tabular-nums}.scenario-name{flex:1;min-width:0}.scenario-id{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:#7b8b80;overflow-wrap:anywhere}.scenario h2{font-size:17px;line-height:1.4;margin-top:2px;overflow-wrap:anywhere}.badge{font-size:11px;font-weight:700;white-space:nowrap;border-radius:30px;padding:3px 9px}.badge-pass{color:#2c6546;background:#e9f3e8}.badge-fail{color:#a2482b;background:#fff0e6}.scenario-body{padding:18px 20px 16px}.premise{font-size:13px;color:#54685b;overflow-wrap:anywhere;white-space:pre-wrap}.premise p+p{margin-top:9px}.field-label{display:block;font-size:11px;font-weight:700;color:#879386;margin-bottom:2px}.outcomes{margin:18px 0 16px;border-top:1px solid #e8ede5;border-bottom:1px solid #e8ede5;padding:8px 0}.outcomes>div{display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px;padding:4px 0;font-size:12px}.outcomes dt{color:#768371}.outcomes dd{font-weight:600;text-align:right;overflow-wrap:anywhere;white-space:pre-wrap}.checks{list-style:none;margin:0;padding:0;font-size:12px}.checks>li{display:flex;gap:9px;margin-top:9px}.checks>li>div{min-width:0;flex:1;overflow-wrap:anywhere}.check-mark{font-weight:700}.check-pass .check-mark{color:#37805b}.check-fail{color:#a14e2f}.check-values{color:#738072;font-size:11px;margin:3px 0}.check-values>div{display:grid;grid-template-columns:30px minmax(0,1fr);gap:6px}.check-values dd{white-space:pre-wrap;overflow-wrap:anywhere}.trace{border-top:1px solid #edf1e9;margin-top:18px;padding-top:12px;font-size:12px}.trace summary{cursor:pointer;color:#53705c;line-height:1.8}.trace summary span{float:right;color:#95a08f;font-size:10px}.trace ol{padding-left:18px;margin:13px 0 0}.trace li{padding:0 0 12px 4px}.trace-heading{display:flex;flex-direction:column;overflow-wrap:anywhere}.trace time{color:#8c9688;font-size:10px;font-variant-numeric:tabular-nums}.trace pre{padding:8px 10px;margin-top:5px;background:#f5f7f2;border-radius:6px;font-size:10px;color:#617058}.error{background:#fff1e9;color:#9a492f;padding:12px;margin-bottom:14px;border-radius:7px;font-size:12px}.error pre{margin-top:4px}.empty{font-size:13px;color:#7c8277;padding:12px 0}.warning{color:#a0522e}.empty-report{background:white;border:1px solid #e6b7a0;border-radius:10px;padding:28px;color:#994d31;grid-column:1/-1}.evidence{margin-top:26px;padding:19px 20px;border:1px solid #dce5da;border-radius:10px;background:#ebf0e7;font-size:12px;color:#6b7964}.evidence p+p{margin-top:5px}.evidence code{word-break:break-all;color:#4f6546;font-size:11px}.evidence strong{color:#3f5941}footer{display:flex;justify-content:space-between;gap:20px;margin-top:20px;padding-top:18px;border-top:1px solid #dce5da;font-size:11px;color:#7a8772}footer code{font-size:11px;overflow-wrap:anywhere}
    @media(max-width:760px){main{padding:25px 18px}.hero{display:block}.hero h1{font-size:27px}.result{display:inline-block;margin-top:18px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.metric{padding:14px 16px}.metric dd{font-size:24px}.scenario-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column;gap:3px}.scenario-heading{padding:16px}.scenario-body{padding:16px}.outcomes>div{grid-template-columns:110px minmax(0,1fr)}footer{flex-direction:column;gap:7px}}
    @media print{@page{size:A4;margin:14mm}body{background:#fff;color:#000;font-size:11px}main{max-width:none;padding:0}.hero h1{font-size:25px}.subtitle,.boundary p{font-size:11px}.metrics{margin:16px 0}.metric{padding:10px 13px}.metric dd{font-size:22px}.scenario-grid{display:block}.scenario{break-inside:avoid;page-break-inside:avoid;margin-bottom:14px}.scenario-heading{padding:12px 16px}.scenario-body{padding:12px 16px}.outcomes{margin:12px 0}.trace ol{display:block}.trace:not([open]) ol,.trace:not([open])>.empty{display:block}.trace{break-inside:avoid}.evidence,footer{break-inside:avoid}a{color:#000}.result,.badge,.boundary,.metric,.scenario,.evidence{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style>
</head>
<body>
<main>
  <header class="hero"><div><p class="eyebrow">胶林项目 / 二阶段优化</p><h1>离线业务验收报告</h1><p class="subtitle">逐项核对策略、任务、回执与后续作业状态，让远程讨论有可复现的依据。</p></div><p class="result ${passed ? 'result-pass' : 'result-fail'}">${overallLabel}</p></header>
  <aside class="boundary"><strong>验证边界：固定模拟时间 · 不接设备 · 不调用模型</strong><p>本报告是离线业务逻辑验证，不代替浏览器验收或实机验收。${modelConstraint}</p><p>固定模拟时间：<time>${escapeHtml(displayValue(report.clock))}</time></p></aside>
  <dl class="metrics"><div class="metric"><dt>已通过场景</dt><dd>${passing} <small>/ ${scenarios.length}</small></dd></div><div class="metric"><dt>已通过检查</dt><dd>${checks.filter(check => check.passed === true).length} <small>/ ${checks.length}</small></dd></div><div class="metric"><dt>模型请求次数</dt><dd>${escapeHtml(displayValue(report.modelRequests))}</dd></div><div class="metric"><dt>原始证据</dt><dd><a href="acceptance.json" style="font-size:16px">查看 JSON ↗</a></dd></div></dl>
  <section aria-label="场景验证结果"><div class="section-heading"><h2>场景与验证结果</h2><p>卡片展示实际结果；展开过程证据可逐步核对。</p></div><div class="scenario-grid">${cards || '<p class="empty-report">没有场景结果，本轮无法判定通过。请检查运行输出与原始证据。</p>'}</div></section>
  <section class="evidence" aria-label="复现信息"><p><strong>复现校验</strong> · 结果摘要用于比对重复运行是否一致，完整记录见同目录 <a href="acceptance.json">acceptance.json</a>。</p><p>结果摘要：<code>${escapeHtml(displayValue(report.repeatabilityDigest))}</code></p><p>报告版本：${escapeHtml(displayValue(report.version))}</p></section>
  <footer><span>模拟数据 · 仅用于本地验证与远程沟通</span><span>复现命令：<code>node scripts/run-acceptance.mjs</code></span></footer>
</main>
</body>
</html>`;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function displayValue(value) {
  if (value === undefined) return '未提供';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
