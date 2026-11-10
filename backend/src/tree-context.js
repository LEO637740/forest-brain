import { makeParkContext } from './adapters/park-demo.js';
import { makeMixedContext } from './adapters/public-context.js';
import { digest } from './util.js';

// Preparation and review regeneration must use the same evidence projection.
export function integrationContext({ treeIds, dataMode = 'demo', now, service, reviews, siteId = 'demo-hainan', site = null }) {
  let context;
  if (dataMode === 'mixed_demo' && service) {
    context = makeMixedContext({ treeIds, service, now, siteId, site });
  } else {
    context = makeParkContext({ treeIds, now, siteId, site });
    if (treeIds?.length === 1) {
      context.modules.weather.observed.relativeHumidityPct = 72 + (Number(treeIds[0].slice(2)) % 5) * 3;
      context.modules.weather.observed.observationId += '-synthetic-microclimate';
    }
    if (dataMode === 'mixed_demo') context.dataPolicy = {
      mode: 'mixed_demo',
      notices: ['公开数据服务未启用，本次使用明确标注的模拟天气和园区档案。'],
      substitutions: [
        { module: 'weather', sourceId: 'demo-weather-service', reason: '未配置可用公开天气服务。' },
        { module: 'trees', sourceId: 'demo-tree-register', reason: '未接入真实树木档案。' },
      ],
    };
  }
  context = reviews.apply(context);
  context.snapshotId = `input-${digest(context).slice(0, 24)}`;
  return context;
}
