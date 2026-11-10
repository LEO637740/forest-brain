import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {hasNewStrategy} from '../src/integration/strategyRefreshState.ts';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseAst, transformWithOxc} from 'vite';
import {parks, sites} from '../../shared/parkCatalog.ts';
import {reviewPurpose,selectReviewJob} from '../src/integration/reviewPurpose.ts';

async function declarations(file, selected) {
  const {code} = await transformWithOxc(readFileSync(new URL(`../src/integration/${file}`, import.meta.url), 'utf8'), file,
    {lang: file.endsWith('.tsx') ? 'tsx' : 'ts', jsx: {runtime: 'classic'}});
  return parseAst(code).body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .filter(node => node && (node.type === 'FunctionDeclaration' ? !selected || selected.includes(node.id.name)
      : node.type === 'VariableDeclaration' && (!selected || node.declarations.some(item => selected.includes(item.id.name)))))
    .map(node => code.slice(node.start, node.end)).join('\n');
}
const marketCode = await declarations('MarketSimulation.tsx');
const reviewCode = await declarations('ReviewDesk.tsx');
const weatherCode = await declarations('StrategyWorkspace.tsx', ['Weather']);
const workspaceCode = await declarations('StrategyWorkspace.tsx', ['tabs', 'BackendStrategyWorkspace']);
const clientCode = await declarations('client.ts', ['siteIdOf', 'alias']);
const mapping = JSON.parse(readFileSync(new URL('../src/integration/tree-map.json', import.meta.url), 'utf8'));
const {siteIdOf, alias} = new Function('resolveTreeIdentity', 'parks', 'mapping', clientCode + ';return {siteIdOf,alias};')(resolveTreeIdentity, parks, mapping);
const Card = ({title, children}) => React.createElement('section', null, React.createElement('h2', null, title), children);
const stub = () => null;
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(code, name, props, options = {}) {
  const slots = [], calls = {reads: [], posts: [], scenarios: [], events: [], reloads: 0};
  let cursor = 0;
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => {slots[index] = typeof value === 'function' ? value(slots[index]) : value;}];
  };
  const bindings = {
    React, hasNewStrategy, StrategyRefreshStatus:stub, useState, useEffect: options.runEffects ? callback => callback() : stub, siteIdOf, alias, sites, reviewPurpose, selectReviewJob, ObservationEvidence:stub, DATA_MODE: 'demo',
    ParkWeather: props => React.createElement('div', {'data-weather-site':props.site}, '当地天气'),
    Card, State: stub, Result: stub, Chart: stub, WeatherChart: stub, CommodityReference: stub, EconomicFactors: stub, EudrReadiness: stub, when: value => value,
    window: {dispatchEvent: event => calls.events.push(event.type), addEventListener: stub, removeEventListener: stub},
    useRead: path => {calls.reads.push(path); return {data: options.read?.(path), reload: () => {calls.reloads++;}};},
    useScenario: (key, site) => {calls.scenarios.push({key, site}); return {result: {}, context: {}, session: {}};},
    post: async (path, input) => {calls.posts.push({path, input}); return options.post?.(path, input);},
  };
  const Component = new Function(...Object.keys(bindings), code + `;return ${name};`)(...Object.values(bindings));
  return {calls, render() {cursor = 0; return Component(props);}};
}
function walk(node, predicate) {
  if (!React.isValidElement(node)) return [];
  if (typeof node.type === 'function') return walk(node.type(node.props), predicate);
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => walk(child, predicate))];
}
const text = node => renderToStaticMarkup(node).replace(/<[^>]*>/g, '');
const button = (tree, label) => walk(tree, node => node.type === 'button' && text(node) === label)[0];
const scenario = {id: 'sell_phased', name: '分批销售', schedule: '每日模拟发运', soldKg: 210, revenueCny: 3150,
  endingStockKg: 790, endingAvailableKg: 780, productionCostCny: 100, transportCostCny: 40, holdingCostCny: 8, cashContributionCny: 3002,
  endingInventoryValueCny: 11000, comparisonValueCny: 14002, overflowKg: 0, feasible: true, daily: []};
const model = {id: 'market-local', generatedAt: '2026-10-20T02:00:00Z', params: {storageKg: 900, stockKg: 900,
  heldKg: 10, transportKgPerDay: 40, demandIndex: 105, dryKgPerTapping: .2, costPerTapping: 1, careLimit: 3},
  recommendedFrequency: 2, demand: {value: 105, baselineValue: 100, band: 'balanced'}, eligibleTreeCount: 180,
  excludedTreeCount: 20, exclusions: [], policyReasons: [], forecast: [], scenarios: [],
  sales: {productionFrequencyPerWeek: 2, scenarios: [scenario], recommendedScenarioId: scenario.id, basis: []}};

test('each production park opens market, weather and review components using that park', () => {
  const Marker = type => props => React.createElement('div', {'data-component': type, 'data-site': props.site, 'data-health-only': props.healthOnly});
  const bindings = {React, sites, StrategyRefreshStatus:stub, useState:initial=>[initial,stub], ReviewDesk: Marker('review'), MarketSimulation: Marker('market'), Weather: Marker('weather'),
    Health: stub, Trees: stub, IndustryBrief: stub, Logistics: stub, History: stub, ActionHistory: stub, ExecutionLinks: stub,
    DemoTaskStrategies: stub, Market: stub, ModelControlPanel: stub, Card};
  const Component = new Function(...Object.keys(bindings), workspaceCode + ';return BackendStrategyWorkspace;')(...Object.values(bindings));
  for (const site of Object.keys(parks).filter(site => site !== 'xian')) {
    for (const [tab, expected] of [['market', ['market']], ['weather', ['weather']], ['health', ['review']], ['reviews', ['review']], ['records', []]]) {
      const tree = Component({site, tab, tasks: [], onTab: stub, onTree: stub});
      const components = walk(tree, node => node.props['data-component']);
      assert.deepEqual(components.map(node => node.props['data-component']), expected);
      assert.ok(components.every(node => node.props['data-site'] === site));
      assert.doesNotMatch(text(tree), /当前园区经营方案待确认|当前园区作业窗口待确认|远程核查待确认/);
    }
  }
});

for (const site of ['hainan', 'xsbn', 'guangdong-maoming']) {
  test(`${site}: market calculates sales and opens production in the selected park`, async () => {
    let productionOpened=0;
    const h = harness(marketCode, 'MarketSimulation', {site,onProductionPlan:()=>productionOpened++}, {post: (path, input) =>
      path === '/api/simulation/market' ? model : path === '/api/simulation/market-plan' ? {tasks: []}
        : {modelId: input.modelId, scenarioId: input.scenarioId, adoptedAt: model.generatedAt, mode: 'simulation', scenario, shipments: []}});
    await button(h.render(), '计算并保存').props.onClick();
    button(h.render(), '查看全园割胶策略').props.onClick();
    assert.equal(productionOpened,1);
    await button(h.render(), '采纳销售方案').props.onClick();
    const reads = h.calls.reads.filter(Boolean);
    assert.ok(reads.length && reads.every(path => path.includes(`siteId=demo-${site}`) && path.split('siteId=').length === 2));
    assert.ok(reads.filter(path => path.startsWith('/api/simulation/market/')).every(path => path === `/api/simulation/market/latest?siteId=demo-${site}`));
    assert.deepEqual(h.calls.posts, [
      {path: '/api/simulation/market', input: {siteId: `demo-${site}`, storageKg: 900, transportKgPerDay: 40, demandIndex: 105, economicScenarioId: 'baseline'}},
      {path: '/api/simulation/market-sales-plan', input: {siteId: `demo-${site}`, modelId: model.id, scenarioId: scenario.id}},
    ]);
    assert.match(text(h.render()), /已采纳：分批销售/);
    assert.deepEqual(h.calls.events, ['harness-sales-shipments-changed']);
  });
}

test('a saved market result is restored from the selected park latest endpoint', () => {
  const h = harness(marketCode, 'MarketSimulation', {site: 'guangdong-maoming'}, {runEffects: true,
    read: path => path === '/api/simulation/market/latest?siteId=demo-guangdong-maoming'
      ? {model, plan: null, salesPlan: {scenarioId: scenario.id, scenario, adoptedAt: model.generatedAt, shipments: []}} : undefined});
  h.render();
  assert.match(text(h.render()), /已采纳：分批销售/);
  assert.match(text(h.render()), /每周采割 2 次/);
  assert.equal(h.calls.posts.length, 0);
});

test('a conversation link reads its exact historical model and adopts that same model',async () => {
  const historical={...model,id:'older-round-model',params:{...model.params,transportKgPerDay:20},recommendedFrequency:1};
  let latestOpened=0,productionOpened=0;
  const h=harness(marketCode,'MarketSimulation',{site:'guangdong-maoming',modelId:historical.id,onLatest:()=>latestOpened++,onProductionPlan:()=>productionOpened++},{
    runEffects:true,
    read:path=>path==='/api/simulation/market/older-round-model?siteId=demo-guangdong-maoming'?historical:{model:{...model,id:'different-latest-model'},plan:null},
    post:(path,input)=>path==='/api/simulation/market-plan'?{tasks:[]}:{modelId:input.modelId,scenarioId:input.scenarioId,adoptedAt:model.generatedAt,scenario,shipments:[]},
  });
  h.render();
  assert.match(text(h.render()),/查看对话中保存的经营方案.*每周采割 1 次/);
  const transport=walk(h.render(),node=>node.type==='label'&&text(node).startsWith('每日运力'))[0];
  assert.equal(walk(transport,node=>node.type==='input')[0].props.value,20);
  button(h.render(),'查看全园割胶策略').props.onClick();assert.equal(productionOpened,1);
  await button(h.render(),'采纳销售方案').props.onClick();
  assert.ok(h.calls.reads.includes('/api/simulation/market/older-round-model?siteId=demo-guangdong-maoming'));
  assert.ok(h.calls.reads.includes('/api/simulation/market/latest?siteId=demo-guangdong-maoming'));
  assert.match(text(h.render()),/后台已有新的经营方案/);
  assert.ok(h.calls.reads.filter(Boolean).every(path=>path.includes('siteId=demo-guangdong-maoming')));
  assert.deepEqual(h.calls.posts.map(call=>call.input.modelId),['older-round-model']);
  button(h.render(),'查看最新方案').props.onClick();assert.equal(latestOpened,1);
});

test('strategy layers pass the selected market model and remount when the conversation round changes',async () => {
  const filename='StrategyCenter.tsx';
  const {code}=await transformWithOxc(readFileSync(new URL('../src/workspace/restructure/StrategyCenter.tsx',import.meta.url),'utf8'),filename,{lang:'tsx',jsx:{runtime:'classic'}});
  const node=parseAst(code).body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name==='StrategyCenter').declaration;
  const marker=()=>null;
  const Center=new Function('React','BackendStrategyWorkspace',code.slice(node.start,node.end)+';return StrategyCenter;')(React,marker);
  const onLatest=()=>{};
  const outer=Center({site:'xsbn',tasks:[],tab:'market',marketModelId:'round-one',onLatestMarket:onLatest});
  assert.equal(outer.props.marketModelId,'round-one');assert.equal(outer.props.onLatestMarket,onLatest);
  const market=()=>null;
  const bindings={React,sites,StrategyRefreshStatus:stub,useState:initial=>[initial,stub],ReviewDesk:stub,MarketSimulation:market,Market:stub,ModelControlPanel:stub};
  const Workspace=new Function(...Object.keys(bindings),workspaceCode+';return BackendStrategyWorkspace;')(...Object.values(bindings));
  const getMarket=modelId=>{
    const page=Workspace({...outer.props,marketModelId:modelId});
    return React.Children.toArray(page.props.children).flatMap(child=>React.isValidElement(child)&&child.type===React.Fragment?React.Children.toArray(child.props.children):[child]).find(child=>child.type===market);
  };
  const first=getMarket('round-one'),second=getMarket('round-two'),latest=getMarket(null);
  assert.equal(first.props.modelId,'round-one');assert.equal(second.props.modelId,'round-two');
  assert.equal(first.props.onLatest,onLatest);
  assert.notEqual(first.key,second.key);assert.notEqual(second.key,latest.key);
});

test('strategy layers keep the original park plan ID and remount for another saved plan or latest',async()=>{
  const filename='StrategyCenter.tsx';
  const {code}=await transformWithOxc(readFileSync(new URL('../src/workspace/restructure/StrategyCenter.tsx',import.meta.url),'utf8'),filename,{lang:'tsx',jsx:{runtime:'classic'}});
  const node=parseAst(code).body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name==='StrategyCenter').declaration;
  const Center=new Function('React','BackendStrategyWorkspace',code.slice(node.start,node.end)+';return StrategyCenter;')(React,stub);
  const onLatest=()=>{};
  const outer=Center({site:'xsbn',tasks:[],tab:'park',parkPlanId:'baseline',onLatestParkPlan:onLatest});
  assert.equal(outer.props.parkPlanId,'baseline');assert.equal(outer.props.onLatestParkPlan,onLatest);
  const park=()=>null;
  const bindings={React,sites,StrategyRefreshStatus:stub,useState:initial=>[initial,stub],ReviewDesk:stub,ParkTappingPlan:park,ModelControlPanel:stub};
  const Workspace=new Function(...Object.keys(bindings),workspaceCode+';return BackendStrategyWorkspace;')(...Object.values(bindings));
  const getPlan=parkPlanId=>React.Children.toArray(Workspace({...outer.props,parkPlanId}).props.children).find(child=>child.type===park);
  const first=getPlan('baseline'),second=getPlan('typhoon'),latest=getPlan(null);
  assert.equal(first.props.planId,'baseline');assert.equal(second.props.planId,'typhoon');
  assert.equal(first.props.onLatest,onLatest);
  assert.notEqual(first.key,second.key);assert.notEqual(second.key,latest.key);
});

const issue = {treeId: 'T-0051', code: 'capture', reason: '模拟树表待补拍', circumferenceCm: 52, health: [], detections: [], plannedTasks: []};
test('review creation and refresh read the selected park and display its tree aliases', async () => {
  for (const site of ['xsbn', 'guangdong-maoming']) {
    const rows = [issue, {...issue, treeId: 'T-0052', code: 'refresh'}];
    const h = harness(reviewCode, 'ReviewDesk', {site}, {read: () => ({items: [], issues: rows}), post: () => ({})});
    assert.match(text(h.render()), new RegExp(`${parks[site].treePrefix}-B-0001`));
    assert.doesNotMatch(text(h.render()), /HN-B-0001/);
    await button(h.render(), '生成模拟人工核查任务').props.onClick();
    button(h.render(), '更新策略').props.onClick();
    await button(h.render(), '更新本树策略').props.onClick();
    assert.ok(h.calls.reads.every(path => path === `/api/simulation/reviews?dataMode=demo&siteId=demo-${site}`));
    assert.deepEqual(h.calls.posts, [
      {path: '/api/simulation/reviews', input: {siteId: `demo-${site}`, treeIds: ['T-0051'], kind: 'capture', assignee: 'human', purpose:'surface', captureRequest:false, dataMode: 'demo'}},
      {path: '/api/simulation/reviews/refresh', input: {siteId: `demo-${site}`, treeId: 'T-0052'}},
    ]);
  }
});

test('review collection, conclusion and regeneration retain the selected park job identity', async () => {
  const site = 'guangdong-maoming', id = 'review-maoming-capture';
  for (const status of ['queued', 'collected', 'completed']) {
    const job = {id, treeId: issue.treeId, kind: 'capture', status, assignee: 'human', createdAt: model.generatedAt};
    const h = harness(reviewCode, 'ReviewDesk', {site}, {read: () => ({items: [job], issues: [{...issue, job}]}), post: () => ({})});
    if (status === 'queued') {
      await button(h.render(), '生成模拟核查回执').props.onClick();
      assert.deepEqual(h.calls.posts, [{path: `/api/simulation/reviews/${id}/collect`, input: {siteId:`demo-${site}`}}]);
    } else if (status === 'collected') {
      walk(h.render(), node => node.type === 'textarea')[0].props.onChange({target: {value: '已补拍确认割线无障碍'}});
      walk(h.render(), node => node.type === 'select')[0].props.onChange({target: {value: 'clear'}});
      button(h.render(), '保存结果并重新判断').props.onClick();
      await settle();
      assert.deepEqual(h.calls.posts, [{path: `/api/simulation/reviews/${id}/complete`, input: {siteId:`demo-${site}`,conclusion: 'clear', note: '已补拍确认割线无障碍'}}]);
    } else {
      await button(h.render(), '重新计算策略').props.onClick();
      assert.deepEqual(h.calls.posts, [{path: `/api/simulation/reviews/${id}/regenerate`, input: {siteId:`demo-${site}`}}]);
    }
    assert.equal(h.calls.reloads, 1);
  }
});

for (const site of ['hainan', 'xsbn', 'guangdong-maoming']) {
  test(`${site}: weather opens the shared live-weather view for the selected park`, () => {
    const h = harness(weatherCode, 'Weather', {site});
    const views = walk(h.render(), node => node.props['data-weather-site']);
    assert.equal(views.length, 1);
    assert.equal(views[0].props['data-weather-site'], site);
    assert.deepEqual(h.calls.scenarios, []);
    assert.deepEqual(h.calls.posts, []);
  });
}

