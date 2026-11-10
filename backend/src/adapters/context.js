import { CARE_LIMIT_PER_WEEK } from '../market-policy.js';
import { SensorDeviceAdapter, WebServiceAdapter, ResearchPartnerAdapter, FarmerExpertAdapter } from './demo-sources.js';
import { digest, iso } from '../util.js';
import { validate } from '../schema.js';
import { contextSchema, datasetFields, datasetPageSchemas, CATALOG } from '../contracts.js';
import { invariant, AppError } from '../errors.js';

export function makeDemoContext({ treeIds = ['T-0012'], now = new Date(), variant = 'normal' } = {}) {
  const args = { treeIds, now };
  const device = new SensorDeviceAdapter().read(args), web = new WebServiceAdapter().read(args);
  const research = new ResearchPartnerAdapter().read(args), expert = new FarmerExpertAdapter().read(args);
  const modules = {
    trees: expert.trees, weather: { siteId: 'demo-hainan', observed: device.observed, forecast: web.forecast },
    inspection: device.inspection, tapping: device.tapping, growth: device.growth, health: device.health,
    market: { ...web.market, costAssumptions: expert.costAssumptions }, knowledge: { rules: [...research.rules, ...expert.rules] },
  };
  if (variant === 'missing_weather') modules.weather.observed.rainfallMm = null;
  if (variant === 'rainy') modules.weather.observed.rainfallMm = 4.2;
  if (variant === 'unregistered') modules.inspection.evidence.forEach(e => { e.geometryRegistered = false; e.detections.forEach(d => { d.intersectsPlannedLine = null; }); });
  if (variant === 'missing_cost') modules.market.costAssumptions = null;
  const targetSnapshotId = `target-${digest(treeIds).slice(0, 20)}`;
  const context = {
    snapshotId: 'pending', version: 1, siteId: 'demo-hainan', asOf: iso(now), validUntil: iso(now, 2 * 3600000), executionMode: 'simulation',
    targetSnapshot: { targetSnapshotId, siteId: 'demo-hainan', treeIds },
    constraints: { minCutSlopeDeg: 20, maxCutSlopeDeg: 40, maxTappingsPerWeek: CARE_LIMIT_PER_WEEK, ruleSetId: 'demo-rules-2' }, modules,
  };
  context.snapshotId = `input-${digest(context).slice(0, 24)}`;
  return validate(contextSchema, context);
}

export class LocalContextProvider {
  constructor(store) { this.store = store; this.mode = 'demo'; }
  async getContext({ snapshotId, version }) {
    const context = this.store.getContext(snapshotId, version);
    invariant(context, 'CONTEXT_NOT_FOUND', '输入快照不存在，请由业务后端提供有效快照', 404);
    return context;
  }
}

export class HttpContextProvider {
  constructor({ baseUrl, token, timeoutMs = 10000 }) {
    const url = new URL(baseUrl);
    invariant(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'INVALID_CONFIG', '业务数据地址必须为 HTTPS 或本机 HTTP');
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.token = token; this.timeoutMs = timeoutMs; this.mode = 'remote';
  }
  async getContext({ snapshotId, version }, { kind, onManifest } = {}) {
    const context = await this.readJson(`/contexts/${encodeURIComponent(snapshotId)}?version=${version}`);
    validate(contextSchema, context, 'INVALID_CONTEXT');
    invariant(context.snapshotId === snapshotId && context.version === version, 'SNAPSHOT_MISMATCH', '上游返回了不同的快照 ID 或版本', 409);
    onManifest?.(structuredClone(context));
    // Keep the original manifest intact; only resolve the datasets required by this run.
    const required = kind ? CATALOG.find(c => c.kind === kind)?.modules : null;
    const modulesSeen = new Set();
    for (const ref of context.datasets ?? []) {
      invariant(!modulesSeen.has(ref.module), 'INVALID_CONTEXT', '一个模块只能引用一个版本化数据集', 422); modulesSeen.add(ref.module);
      if (required && !required.includes(ref.module)) continue;
      const field = datasetFields[ref.module];
      const inline = field ? context.modules[ref.module]?.[field] : context.modules[ref.module];
      invariant(!inline?.length, 'INVALID_CONTEXT', '同一模块不能同时提供内联记录和分页记录', 422);
      const items = [], cursors = new Set(); let cursor = null;
      do {
        const page = await this.readDataset(ref, { snapshotId, version }, cursor);
        items.push(...page.items);
        invariant(items.length <= (ref.module === 'trees' ? 200 : 1000), 'CONTEXT_TOO_LARGE', '当前运行超出数据预算，请业务后端缩小固定目标范围', 422);
        cursor = page.nextCursor;
        invariant(!cursor || !cursors.has(cursor), 'INVALID_DATASET_PAGE', '数据集游标重复，停止读取', 502);
        if (cursor) cursors.add(cursor);
        invariant(cursors.size <= 20, 'CONTEXT_TOO_LARGE', '数据集超过 20 页预算，请缩小本次范围', 422);
      } while (cursor);
      context.modules[ref.module] = field ? { [field]: items } : items;
    }
    return validate(contextSchema, context, 'INVALID_CONTEXT');
  }
  async readDataset(ref, snapshot, cursor = null) {
    const query = new URLSearchParams({ version: String(ref.version), snapshotId: snapshot.snapshotId, snapshotVersion: String(snapshot.version), ...(cursor ? { cursor } : {}) });
    const page = await this.readJson(`/datasets/${encodeURIComponent(ref.datasetRef)}?${query}`);
    validate(datasetPageSchemas[ref.module], page, 'INVALID_DATASET_PAGE');
    invariant(page.datasetRef === ref.datasetRef && page.version === ref.version, 'DATASET_VERSION_MISMATCH', '分页数据集的 ID 或版本发生变化', 409);
    return page;
  }
  async readJson(path) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    } catch { throw new AppError('CONTEXT_UNAVAILABLE', '业务上下文服务不可用或超时', 503); }
    if (!response.ok) throw new AppError(response.status === 404 ? 'CONTEXT_NOT_FOUND' : 'CONTEXT_UNAVAILABLE', '业务上下文服务未返回可用快照', response.status === 404 ? 404 : 503);
    // Bounded streaming read avoids unbounded materialization from a faulty upstream.
    let body;
    try { body = await readBounded(response, 2 * 1024 * 1024); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('CONTEXT_UNAVAILABLE', '业务上下文读取中断或超时', 503); }
    try { return JSON.parse(body); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('INVALID_CONTEXT', '业务上下文不是合法 JSON', 502); }
  }
}
export async function readBounded(response, maxBytes) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('RESPONSE_TOO_LARGE', '上游响应超过限制', 502);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
