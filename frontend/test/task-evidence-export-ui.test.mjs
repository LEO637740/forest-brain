import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc, parseAst } from 'vite';

async function componentSource(name) {
  const source = readFileSync(new URL(`../src/workspace/${name}.tsx`, import.meta.url), 'utf8');
  const { code } = await transformWithOxc(source, `${name}.tsx`, { lang: 'tsx', jsx: { runtime: 'classic' } });
  return parseAst(code).body.filter(node => node.type !== 'ImportDeclaration')
    .map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
}
const exportCode = await componentSource('TaskEvidenceActions');
const lifecycleCode = await componentSource('TaskLifecycle');
const task = { id: 'rail-one', site: 'hainan', status: '已完成', count: 1, done: 1 };
const fleet = { ready: true, error: null, jobs: {}, zones: [] };

function harness({ snapshotError, clickError } = {}) {
  let notice = null;
  const calls = { snapshots: [], artifacts: [], blobs: [], links: [], revoked: [], timers: [] };
  const createSnapshot = (...args) => {
    calls.snapshots.push(args);
    if (snapshotError) throw snapshotError;
    return { task: structuredClone(args[0]) };
  };
  const artifact = (snapshot, format) => {
    calls.artifacts.push({ snapshot, format });
    return { filename: `核对单.${format}`, mimeType: format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8', content: `record-${format}` };
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'a');
      const link = { clicks: 0, removed: false, click() { this.clicks++; if (clickError) throw clickError; }, remove() { this.removed = true; } };
      calls.links.push(link);
      return link;
    },
    body: { appendChild(link) { link.appended = true; } },
  };
  const url = { createObjectURL(blob) { calls.blobs.push(blob); return 'blob:task-evidence'; }, revokeObjectURL(value) { calls.revoked.push(value); } };
  const component = new Function('React', 'useState', 'createTaskEvidenceSnapshot', 'taskEvidenceArtifact', 'document', 'URL', 'Blob', 'setTimeout', exportCode + ';return TaskEvidenceActions;')(
    React, () => [notice, value => { notice = value; }], createSnapshot, artifact, document, url, Blob,
    (callback, delay) => { calls.timers.push({ callback, delay }); },
  );
  return { calls, component, render(props = { task, fleet }) { return component(props); } };
}

function buttons(element) {
  if (!React.isValidElement(element)) return [];
  if (element.type === 'button') return [element];
  return React.Children.toArray(element.props.children).flatMap(buttons);
}
const markup = element => renderToStaticMarkup(element);

test('export controls disclose browser snapshot scope and perform no work while rendering', () => {
  const h = harness();
  const element = h.render();
  const html = markup(element);
  assert.equal(h.calls.snapshots.length, 0);
  assert.equal(h.calls.links.length, 0);
  assert.match(html, /导出浏览器当前快照/);
  assert.match(html, /HTML.*JSON/);
  assert.deepEqual(buttons(element).map(button => [button.props.type, button.props.children]), [['button', '导出核对单'], ['button', '导出原始记录']]);
  assert.doesNotMatch(html, /已同步|已确认|已下载|role="status"/);
});

test('HTML export captures the selected record at click time and releases the download URL', async () => {
  const h = harness();
  const currentTask = structuredClone(task);
  const element = h.render({ task: currentTask, fleet });
  currentTask.done = 0;
  buttons(element)[0].props.onClick();
  assert.equal(h.calls.snapshots.length, 1);
  assert.equal(h.calls.snapshots[0][0], currentTask);
  assert.equal(h.calls.snapshots[0][1], fleet);
  assert.equal(h.calls.artifacts[0].snapshot.task.done, 0);
  assert.equal(h.calls.artifacts[0].format, 'html');
  assert.equal(h.calls.blobs[0].type, 'text/html;charset=utf-8');
  assert.equal(await h.calls.blobs[0].text(), 'record-html');
  const link = h.calls.links[0];
  assert.equal(link.href, 'blob:task-evidence');
  assert.equal(link.download, '核对单.html');
  assert.equal(link.hidden, true);
  assert.equal(link.appended, true);
  assert.equal(link.clicks, 1);
  assert.equal(link.removed, true);
  assert.equal(h.calls.revoked.length, 0);
  h.calls.timers[0].callback();
  assert.deepEqual(h.calls.revoked, ['blob:task-evidence']);
  assert.match(markup(h.render()), /role="status">已生成核对单，请在浏览器下载中查看/);
  assert.doesNotMatch(markup(h.render()), /下载成功|已保存|已同步/);
});

test('JSON export uses the raw-record format and names the generated artifact accurately', async () => {
  const h = harness();
  buttons(h.render())[1].props.onClick();
  assert.equal(h.calls.artifacts[0].format, 'json');
  assert.equal(h.calls.blobs[0].type, 'application/json;charset=utf-8');
  assert.equal(await h.calls.blobs[0].text(), 'record-json');
  assert.equal(h.calls.links[0].download, '核对单.json');
  assert.match(markup(h.render()), /已生成原始记录，请在浏览器下载中查看/);
});

test('evidence controls pass displayed events and shared batches into the click-time snapshot', () => {
  const events = [{id: 'rain-1', siteId: 'demo-hainan', kind: 'rain', zone: 0, status: 'resolved', note: '降雨已解除，待核对恢复'}];
  const batches = [{id: 'batch-one', siteId: 'demo-hainan', source: {taskId: task.id}, stage: 'received'}];
  const h = harness();
  buttons(h.render({task, fleet, events, batches}))[0].props.onClick();
  assert.equal(h.calls.snapshots[0][3], events);
  assert.equal(h.calls.snapshots[0][4], batches);
  assert.equal(typeof h.calls.snapshots[0][2], 'number');
  const exported = React.Children.toArray(lifecycle({})({task, fleet, events, batches}).props.children).at(-1);
  assert.equal(exported.props.events, events);
  assert.equal(exported.props.batches, batches);
});

test('snapshot failure exposes an escaped alert without initiating a download', () => {
  const h = harness({ snapshotError: new Error('<script>invalid</script>') });
  buttons(h.render())[0].props.onClick();
  assert.equal(h.calls.blobs.length, 0);
  assert.equal(h.calls.links.length, 0);
  const html = markup(h.render());
  assert.match(html, /role="alert">导出失败：&lt;script&gt;invalid&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|已生成/);
});

test('download initiation failure cleans up the temporary link and URL', () => {
  const h = harness({ clickError: new Error('浏览器拒绝下载') });
  buttons(h.render())[0].props.onClick();
  assert.equal(h.calls.links[0].removed, true);
  assert.deepEqual(h.calls.revoked, ['blob:task-evidence']);
  assert.equal(h.calls.timers.length, 0);
  assert.match(markup(h.render()), /role="alert">导出失败：浏览器拒绝下载/);
  assert.doesNotMatch(markup(h.render()), /已生成/);
});

function lifecycle(evidence) {
  return new Function('React', 'taskEvidence', 'taskHoldReason', 'phaseLabels', 'TaskEvidenceActions', 'treeAlias', lifecycleCode + ';return TaskLifecycle;')(
    React, () => ({ sources: [], receipts: [], completedReceipts: 0, cancelledReceipts: 0, issues: [], completionKind: null, ...evidence }),
    () => null, {}, () => React.createElement('span', null, 'export-controls'), (index, site) => `${site}-tree-${index}`,
  );
}

test('lifecycle renders rejected evidence as issues instead of claiming receipt completion', () => {
  const component = lifecycle({ issues: [{ code: 'source-mismatch', message: '策略不一致 <script>' }] });
  const html = markup(component({ task, fleet }));
  assert.match(html, /证据待核对 · 1 项/);
  assert.match(html, /策略不一致 &lt;script&gt;/);
  assert.match(html, /尚无可核对的执行完成回执/);
  assert.doesNotMatch(html, /<script>|关联核对通过：|完成依据：/);
});

test('many missing receipts stay collapsed and identify each tree without calling it an execution failure', () => {
  const component = lifecycle({ issues: Array.from({ length: 200 }, (_, index) => ({ code: 'receipt_missing', message: '等待执行回执', index })) });
  const html = markup(component({ task: { ...task, status: '执行中' }, fleet }));
  assert.match(html, /<details><summary>证据待核对 · 200 项（展开明细）/);
  assert.doesNotMatch(html, /<details open/);
  assert.match(html, /hainan-tree-0 · 索引 0：/);
  assert.match(html, /hainan-tree-199 · 索引 199：/);
  assert.match(html, /缺少回执不代表执行失败/);
  assert.match(html, /export-controls/);
});

test('source identity keys distinguish adoption runs, revisions and times', () => {
  const base = { treeId: 'T-0001', strategyId: 's1', runId: 'r1', revision: 1, adoptedAt: '2026-10-18T02:00:00Z', expiresAt: '2026-10-18T03:00:00Z' };
  const sources = [base, { ...base, runId: 'r2' }, { ...base, revision: 2 }, { ...base, adoptedAt: '2026-10-18T02:10:00Z' }, { ...base, siteId: 'demo-xsbn' }];
  const component = lifecycle({ sources });
  function findSources(element) {
    if (!React.isValidElement(element)) return [];
    if (element.type === 'dl') return [element];
    return React.Children.toArray(element.props.children).flatMap(findSources);
  }
  const keys = findSources(component({ task, fleet })).map(element => element.key);
  assert.equal(keys.length, 5);
  assert.equal(new Set(keys).size, 5);
});

test('lifecycle distinguishes rail, workflow and manual surface completion evidence', () => {
  for (const [completionKind, expected] of [['rail', '完成依据：关联核对通过的模拟轨道回执'], ['flow', '完成依据：模拟流程完成记录'], ['surface', '完成依据：现场处理人工回传']]) {
    const component = lifecycle({ completionKind });
    assert.ok(markup(component({ task, fleet })).includes(expected));
  }
});

test('lifecycle uses Shanghai time and remounts export notices when the selected task changes', () => {
  const component = lifecycle({ sources: [{ treeId: 'T-0001', strategyId: 's1', runId: 'r1', revision: 1, adoptedAt: '2026-10-18T02:00:00Z', expiresAt: '2026-10-18T03:00:00Z' }] });
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utc = markup(component({ task, fleet }));
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(markup(component({ task, fleet })), utc);
    assert.match(utc, /10:00:00（北京时间）/);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  const exportKey = currentTask => React.Children.toArray(component({ task: currentTask, fleet }).props.children).at(-1).key;
  assert.notEqual(exportKey(task), exportKey({ ...task, id: 'rail-two' }));
  assert.notEqual(exportKey(task), exportKey({ ...task, site: 'xsbn' }));
});
