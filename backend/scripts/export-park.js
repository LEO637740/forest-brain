import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeParkContext, parkOverview, SCENARIOS, scenarioContext } from '../src/adapters/park-demo.js';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';

// Frozen replay clock: never relabel old evidence as today's live data.
const now = new Date(process.env.DEMO_AS_OF ?? '2026-09-28T01:00:00.000Z');
if (!Number.isFinite(+now)) throw new Error('DEMO_AS_OF must be an ISO timestamp');
const out = fileURLToPath(new URL('../data/park-demo/', import.meta.url));
for (const folder of ['', 'inputs', 'contexts', 'results']) mkdirSync(resolve(out, folder), { recursive: true });
const write = (name, data) => writeFileSync(resolve(out, name), JSON.stringify(data, null, 2) + '\n');
const c = makeParkContext({ now });
for (const [name, data] of Object.entries(c.modules)) write(`inputs/${name}.json`, data);
const overview = parkOverview(now);
const store = new Store(), runtime = new HarnessRuntime({ store, contextProvider: new LocalContextProvider(store), clock: () => now });
const scenarios = [];
try {
  for (const s of SCENARIOS) {
    const context = scenarioContext(s, now); store.saveContext(context);
    const request = { requestId: `park-${s.id}`, kind: s.kind, siteId: context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version }, executionMode: 'simulation', trigger: { type: 'user', eventId: 'offline-demo-replay' } };
    const accepted = runtime.submit(request); await runtime.idle();
    const result = store.getRun(accepted.runId).result;
    write(`contexts/${s.id}.json`, context); write(`results/${s.id}.json`, result);
    scenarios.push({ ...s, request, status: result.status, inputFile: `contexts/${s.id}.json`, resultFile: `results/${s.id}.json` });
    if (result.status === 'failed') throw new Error(`${s.id}: ${result.error.message}`);
    console.log(`${s.id}: ${result.status}`);
  }
  const profiles = Object.fromEntries(Object.entries(overview.profiles).map(([key, label]) => [label, overview.trees.filter(t => t.profile === key).length]));
  write('manifest.json', { description: '固定模拟时间回放。inputs 是园区原始数据，contexts 是每次分析输入，results 是实际执行规则引擎的输出。不是 LLM 结果或实测记录。', replayClock: now.toISOString(), counts: overview.counts, profiles, scenarios });
  console.log(`Exported to ${out}`);
} finally { await runtime.stop(); store.close(); }
