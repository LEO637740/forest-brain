import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicDataService, SOURCE_INFO, normalizeZhejiangRubber } from '../src/adapters/public-data.js';

const config = { location: { name: '海南模拟园区', latitude: 20, longitude: 110, confirmed: false, siteId: 'demo-hainan' }, refreshMinutes: 60, maxWeatherAgeMinutes: 120, marketLookbackDays: 3 };
const zhejiangRubber = { code: 200, data: {
  id: 2154, newsTotal: '【舟山、宁波片区】浙江大宗首笔橡胶现货标准仓单质押融资落地', releaseTime: '2026年10月12日',
  digest: '10月10日，宁波铜岸橡胶国际贸易有限公司以60吨越南3L混合橡胶办理现货标准仓单质押获得便利化银行融资。',
  newsInfo: 'https://mp.weixin.qq.com/s/4VQ6EKVk1cKtVtZbq60l6A',
} };

test('Zhejiang rubber news: retain publication and article provenance without creating a price', () => {
  const news = normalizeZhejiangRubber(zhejiangRubber);
  assert.equal(news.publishedAt, '2026-10-12T00:00:00+08:00');
  assert.equal(news.sourceUrl, SOURCE_INFO.zhejiang_rubber.url);
  assert.equal(news.articleUrl, zhejiangRubber.data.newsInfo);
  assert.equal(news.summary, zhejiangRubber.data.digest);
  assert.equal(news.period, '2026-10-12发布的业务资讯');
  assert.equal(news.scope, '浙江大宗橡胶现货仓单业务');
  assert.match(news.limitation, /历史现货仓单融资案例/);
  assert.equal(news.price, undefined);
  assert.equal(news.priceType, undefined);
  assert.throws(() => normalizeZhejiangRubber({ code: 200, data: { ...zhejiangRubber.data, releaseTime: '' } }), e => e.code === 'INVALID_PUBLIC_DATA');
});
test('Zhejiang news collector: fixed public JSON, daily refresh, persisted snapshot and original publication date', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'harness-zhejiang-public-'));
  let clock = new Date('2026-10-21T02:00:00Z');
  const calls = [];
  const service = new PublicDataService({ directory, config: { ...config, enabledSources: ['zhejiang_rubber'] }, clock: () => clock,
    fetchImpl: async url => { calls.push(url); return Response.json(zhejiangRubber); },
  });
  await service.refresh();
  const first = service.status().sources[0];
  assert.equal(first.id, 'zhejiang_rubber');
  assert.equal(first.provider, '浙江自贸');
  assert.equal(first.status, 'available');
  assert.deepEqual(calls, [SOURCE_INFO.zhejiang_rubber.url]);
  assert.deepEqual(service.archive(first.snapshotId).raw, zhejiangRubber);
  const restored = new PublicDataService({ directory, config: { ...config, enabledSources: ['zhejiang_rubber'] }, clock: () => clock });
  assert.equal(restored.status().sources[0].snapshotId, first.snapshotId);
  clock = new Date(+clock + 3600000);
  await service.refresh();
  assert.equal(calls.length, 1);
  clock = new Date(+clock + 86400000);
  await service.refresh();
  assert.equal(calls.length, 2);
  const latest = service.status().sources[0];
  assert.notEqual(latest.snapshotId, first.snapshotId);
  assert.equal(latest.data.publishedAt, first.data.publishedAt);
  assert.equal(latest.validUntil, first.validUntil);
});
