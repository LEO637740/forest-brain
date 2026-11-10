#!/usr/bin/env node

/**
 * Prepare the fixed Blender tree set and optionally export one read snapshot.
 *
 * This script deliberately talks to an already running Harness service. It
 * never starts the server, changes the model switch, or calls a provider API.
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { openServiceSession } from '../../frontend/scripts/service-session.mjs';

const baseUrl = (process.env.BRAIN_BASE_URL ?? 'http://127.0.0.1:4188').replace(/\/$/, '');
const token = process.env.BRAIN_API_TOKEN ?? process.env.HARNESS_API_TOKEN ?? '';
const args = process.argv.slice(2);

function value(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
function has(flag) { return args.includes(flag); }
function fail(message) { console.error(`demo:prepare: ${message}`); process.exitCode = 1; }
function parseTreeIds() {
  const raw = value('--tree-ids');
  if (!raw) return null;
  const ids = raw.split(',').map(x => x.trim()).filter(Boolean);
  if (!ids.length || ids.length > 10 || ids.some(x => !/^T-\d{4}$/.test(x))) {
    throw new Error('--tree-ids 必须是 1–10 个 T-0001 格式的树号，用逗号分隔');
  }
  return [...new Set(ids)];
}
const tokenHeaders = token ? { Authorization: `Bearer ${token}` } : {};
// Replaced by the background service account when the backend requires a login.
let session = { headers: {}, close: async () => {} };
function requestHeaders(withBody = false) {
  return { Accept: 'application/json', ...(withBody ? { 'Content-Type': 'application/json' } : {}), ...tokenHeaders, ...session.headers };
}
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...requestHeaders(Boolean(options.body)), ...(options.headers ?? {}) } });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const detail = data?.error?.message ?? data?.message ?? data?.error ?? `HTTP ${response.status}`;
    throw new Error(`${path}: ${detail}`);
  }
  return data;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function terminal(view) {
  return ['available', 'needs_data', 'failed', 'withdrawn', 'expired'].includes(view?.strategyStatus)
    || ['succeeded', 'needs_data', 'failed'].includes(view?.status);
}

async function main() {
  const kind = value('--kind', 'tapping_angle');
  const dataMode = value('--data-mode', 'mixed_demo');
  const generatorMode = has('--configured') ? 'configured' : value('--generator-mode', 'demo_rules');
  const timeoutMs = Number(value('--timeout-ms', '120000'));
  const intervalMs = Number(value('--interval-ms', '1000'));
  const output = value('--output');
  if (!['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk'].includes(kind)) throw new Error(`不支持的 kind: ${kind}`);
  if (!['demo', 'mixed_demo'].includes(dataMode)) throw new Error(`不支持的 dataMode: ${dataMode}`);
  if (!['demo_rules', 'configured'].includes(generatorMode)) throw new Error(`不支持的 generatorMode: ${generatorMode}`);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || !Number.isFinite(intervalMs) || intervalMs < 50) throw new Error('timeout/interval 参数无效');

  const manifest = await request('/api/demo/trees/manifest');
  const requestedTreeIds = parseTreeIds();
  const manifestIds = manifest.items?.map(item => item.treeId) ?? [];
  const treeIds = requestedTreeIds ?? manifestIds;
  if (!treeIds.length || treeIds.length > 10) throw new Error('manifest 没有 1–10 棵可准备的树');
  const missing = treeIds.filter(id => !manifestIds.includes(id));
  if (missing.length) throw new Error(`树号不在 manifest 中: ${missing.join(', ')}`);

  const preparationId = value('--preparation-id', `blender-${kind}-${dataMode}-${randomUUID()}`);
  const preparation = await request('/api/demo/trees/prepare', {
    method: 'POST',
    body: JSON.stringify({ preparationId, treeIds, kind, dataMode, generatorMode }),
  });
  console.log(JSON.stringify({ preparationId, kind, dataMode, generatorMode, count: treeIds.length, status: 'accepted' }));

  const started = Date.now();
  const views = [];
  for (const treeId of treeIds) {
    let view;
    while (true) {
      view = await request(`/api/demo/trees/${treeId}/view?kind=${encodeURIComponent(kind)}&dataMode=${encodeURIComponent(dataMode)}`);
      if (terminal(view) || Date.now() - started >= timeoutMs) break;
      await sleep(intervalMs);
    }
    views.push(view);
    console.log(JSON.stringify({ treeId, strategyStatus: view.strategyStatus, status: view.status, runId: view.run?.runId ?? null }));
    if (!terminal(view)) console.error(`demo:prepare: ${treeId} 在 ${timeoutMs}ms 内未到终态`);
  }

  if (output) {
    const checkedAt = new Date().toISOString();
    const snapshot = {
      schemaVersion: '1', preparation, manifest,
      checkedAt,
      expiresAt: views.map(view => view.strategy?.expiresAt).filter(Boolean).sort()[0] ?? null,
      snapshotNote: 'views 是一次读取快照；checkedAt 与 expiresAt 不能当作持续实时状态，Blender 点击时仍应重新 GET。',
      views,
    };
    writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`导出一次性树视图快照: ${output}`);
  }
}

openServiceSession(baseUrl, { headers: tokenHeaders }).then(async opened => {
  session = opened;
  try { await main(); } finally { await session.close(); }
}).catch(error => fail(error.message));
