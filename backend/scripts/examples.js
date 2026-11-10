import { writeFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { HarnessRuntime } from '../src/runtime.js';
import { makeDemoContext, LocalContextProvider } from '../src/adapters/context.js';
import { KINDS } from '../src/contracts.js';

const now = new Date();
const store = new Store();
const runtime = new HarnessRuntime({ store, contextProvider: new LocalContextProvider(store), clock: () => now });
const cases = [...KINDS.filter(k=>k!=='industry_brief').map(kind => ({ name: kind, kind, variant: 'normal' })),
  { name: 'weather_needs_data', kind: 'weather_window', variant: 'missing_weather' },
  { name: 'surface_unregistered', kind: 'surface_action', variant: 'unregistered' },
  { name: 'market_missing_cost', kind: 'market_scenario', variant: 'missing_cost' },
  { name: 'failed_wrong_site', kind: 'weather_window', variant: 'normal', wrongSite: true },
];
for (const sample of cases) {
  const context = makeDemoContext({ now, variant: sample.variant }); store.saveContext(context);
  const request = { requestId: `example-${sample.name}`, kind: sample.kind, siteId: sample.wrongSite ? 'incorrect-site' : context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version }, executionMode: 'simulation' };
  const accepted = runtime.submit(request); await runtime.idle();
  const result = store.getRun(accepted.runId).result;
  writeFileSync(`examples/${sample.name}.json`, JSON.stringify({ description: '真实执行本地 Harness 得到的模拟样例；时间过期后请重新运行 npm run examples。', request, context, result }, null, 2) + '\n');
  console.log(`${sample.name}: ${result.status}`);
}
await runtime.stop(); store.close();
