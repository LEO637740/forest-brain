// Read-only behavioral audit: does not change implementation or the running service database.
// Records observed gaps; exit 0 means the audit ran, not that the requirements passed.
import { writeFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { makeDemoContext, LocalContextProvider, HttpContextProvider } from '../src/adapters/context.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { checkContext } from '../src/validation.js';
import { AppError } from '../src/errors.js';

const now = new Date('2026-09-24T08:00:00Z');
const rows = [];
const makeRequest = (c, kind, requestId) => ({ requestId, kind, siteId: c.siteId, targetSnapshotId: c.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: c.snapshotId, version: c.version }, executionMode: 'simulation' });
async function run(context, kind, generator) {
  const store = new Store(); store.saveContext(context);
  const runtime = new HarnessRuntime({ store, contextProvider: new LocalContextProvider(store), generator, clock: () => now });
  try {
    const accepted = runtime.submit(makeRequest(context, kind, `audit-${kind}`));
    await runtime.idle(); return store.getRun(accepted.runId).result;
  } finally { await runtime.stop(); store.close(); }
}
{
  const c = makeDemoContext({ now });
  const past = { validFrom: '2026-09-24T06:00:00Z', validTo: '2026-09-24T07:00:00Z', rainfallMm: 0, rainProbabilityPct: 10 };
  c.modules.weather.forecast.steps.unshift(past);
  const generator = { mode: 'audit-upstream', modelVersion: 'audit-v1', async generate(args) {
    const candidate = await new RuleGenerator().generate(args);
    candidate.proposal.windows = [{ start: past.validFrom, end: past.validTo, suitability: 'suitable', reason: '上游错误地推荐已经结束的窗口' }];
    return candidate;
  } };
  const r = await run(c, 'weather_window', generator);
  rows.push({ id: 'G01', description: '外部候选将过去的预报时段列为适作窗口', expected: '拒绝过期窗口', actual: r.status, confirmedGap: r.status === 'succeeded', details: r.strategy?.proposal.windows ?? r.error });
}
{
  const c = makeDemoContext({ now });
  c.modules.weather.forecast.steps = [{ validFrom: now.toISOString(), validTo: '2026-09-24T08:01:00Z', rainfallMm: 0, rainProbabilityPct: 10 }];
  const r = await run(c, 'weather_window');
  rows.push({ id: 'G02', description: '所有预报窗口在 1 分钟后结束', expected: '策略有效期不能晚于支持它的全部窗口结束', actual: r.strategy?.expiresAt, confirmedGap: r.status === 'succeeded' && Date.parse(r.strategy.expiresAt) > Date.parse(c.modules.weather.forecast.steps[0].validTo), details: { forecastEndsAt: c.modules.weather.forecast.steps[0].validTo } });
}
{
  const c = makeDemoContext({ now });
  const rule = c.modules.knowledge.rules.find(r => r.kind === 'weather_window');
  rule.version = 'revised-rule-3'; rule.text = '本规则要求降雨概率大于等于 5% 的所有时段暂缓。';
  const r = await run(c, 'weather_window');
  rows.push({ id: 'G03', description: '上游规则文本/版本变化，但代码阈值仍为 60%', expected: '拒绝不支持的规则版本或按结构化版本规则执行', actual: r.status, confirmedGap: r.status === 'succeeded' && r.strategy.proposal.windows.some(w => w.suitability === 'suitable'), details: { inputRuleVersion: rule.version, publishedRuleVersion: r.strategy?.ruleVersion, citedReason: r.strategy?.reasons[0], windows: r.strategy?.proposal.windows } });
}
{
  const a = makeDemoContext({ now, treeIds: ['T-0012'] });
  const b = makeDemoContext({ now, treeIds: ['T-0013'] });
  b.targetSnapshot.targetSnapshotId = a.targetSnapshot.targetSnapshotId;
  const store = new Store(); store.saveContext(a); store.saveContext(b);
  const runtime = new HarnessRuntime({ store, contextProvider: new LocalContextProvider(store), clock: () => now });
  try {
    const results = [];
    for (const [i, c] of [a, b].entries()) { const accepted = runtime.submit(makeRequest(c, 'surface_action', `audit-target-${i}`)); await runtime.idle(); results.push(store.getRun(accepted.runId).result); }
    rows.push({ id: 'G04', description: '两个输入快照复用同一个目标快照 ID，但成员分别是 T-0012 / T-0013', expected: '本服务或业务服务固定目标 ID 与成员映射，不能换树', actual: results.map(r => r.status), confirmedGap: results.every(r => r.status === 'succeeded'), details: results.map(r => ({ targetSnapshotId: r.strategy?.targetSnapshotId, revision: r.strategy?.revision, trees: r.strategy?.proposal.findings.map(f => f.treeId) })) });
  } finally { await runtime.stop(); store.close(); }
}
{
  const c = makeDemoContext({ now, treeIds: ['T-0013'] }), e = c.modules.inspection.evidence[0];
  e.detections[0].reviewStatus = 'confirmed';
  e.detections.push({ ...structuredClone(e.detections[0]), detectionId: 'conflicting-detection', intersectsPlannedLine: true });
  const r = await run(c, 'surface_action');
  rows.push({ id: 'G05', description: '同一张图、同一框、同类别的已复核标记对是否碰割线给出相反事实', expected: '显式报告证据冲突并要求复核', actual: r.status, confirmedGap: r.status === 'succeeded' && new Set(r.strategy.proposal.findings.map(f => f.affectsCut)).size > 1, details: r.strategy?.proposal.findings });
}
{
  const c = makeDemoContext({ now }); c.modules.trees[0].rowId = 'row-A-01';
  let error;
  try { checkContext(makeRequest(c, 'tapping_angle', 'audit-fields'), c, now); } catch (e) { error = e; }
  rows.push({ id: 'G06', description: '向单树档案添加 09 文档明确允许的 rowId', expected: '经适配后能消费已约定字段', actual: error?.code ?? 'accepted', confirmedGap: error?.code === 'INVALID_CONTEXT', details: error?.details });
}
{
  const c = makeDemoContext({ now }); c.datasets = [{ module: 'inspection', datasetRef: 'unused-inspection', version: 1 }]; delete c.modules.inspection;
  const provider = new HttpContextProvider({ baseUrl: 'http://127.0.0.1' });
  let readUnused = false;
  provider.readJson = async () => structuredClone(c);
  provider.readDataset = async () => { readUnused = true; throw new AppError('CONTEXT_UNAVAILABLE', '无关的图像数据集暂不可用', 503); };
  let error;
  try { await provider.getContext({ snapshotId: c.snapshotId, version: c.version }); } catch (e) { error = e; }
  rows.push({ id: 'G07', description: '天气运行收到一个额外 inspection 数据集引用，该无关数据集不可用', expected: '取数阶段按能力按需加载，或业务侧仅提供必要模块', actual: error?.code ?? 'accepted', confirmedGap: readUnused && !!error, details: 'HTTP provider 在 runtime 按 kind 裁剪前先读取所有 datasets；此用例用替代只读方法，无外部网络请求。' });
}
const output = { auditedAt: new Date().toISOString(), auditClock: now.toISOString(), methodology: '原实现未修改；内存 SQLite + 定向变异输入；这些是已确认缺口，不是通过用例。', totalProbes: rows.length, confirmedGaps: rows.filter(r => r.confirmedGap).length, probes: rows };
writeFileSync(new URL('../docs/AUDIT_PROBES_20260924.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
for (const r of rows) console.log(`${r.id} | ${r.confirmedGap ? 'GAP CONFIRMED' : 'NOT REPRODUCED'} | ${r.description} | ${JSON.stringify(r.actual)}`);
