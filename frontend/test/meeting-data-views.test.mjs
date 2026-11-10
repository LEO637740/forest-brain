import {treeScopeSeries} from '../../shared/analyticsScope.ts';
import {productionSites} from '../../shared/parkCatalog.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc, parseAst} from 'vite';
import * as analyticsData from '../src/workspace/analyticsData.ts';
import * as collectionData from '../src/workspace/collectionPointData.ts';
import {sites,treeAlias} from '../src/workspace/model.ts';

async function declarations(file) {
  const {code} = await transformWithOxc(readFileSync(new URL(`../src/workspace/${file}`, import.meta.url), 'utf8'), file, {lang: file.endsWith('tsx') ? 'tsx' : 'ts', jsx: {runtime: 'classic'}});
  return parseAst(code).body.filter(node => node.type !== 'ImportDeclaration' && !(node.type === 'ExportNamedDeclaration' && node.source)).map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
}
const sourceFunctions = new Function('DATA', 'treeScopeSeries', await declarations('analyticsSource.ts') + ';return {analyticsSource,matchingDates,analyticsCsv,perTap};')(analyticsData.DATA, treeScopeSeries);
const analyticsCode = await declarations('AnalyticsPage.tsx');
const collectionCode = await declarations('CollectionPoints.tsx');
const dataCenterCode = await declarations('DataCenter.tsx');
const stub = () => null;
function walk(element, predicate) {
  if (!React.isValidElement(element)) return [];
  if (typeof element.type === 'function') return walk(element.type(element.props), predicate);
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  if (!React.isValidElement(element)) return '';
  if (typeof element.type === 'function') return text(element.type(element.props));
  return React.Children.toArray(element.props.children).map(text).join('');
}
function harness(code, componentName, additions = {}) {
  let cursor = 0, element;
  const slots = [], requested = [], focus = [];
  const bindings = {
    React, sites, treeAlias, ...analyticsData, ...sourceFunctions, ...collectionData,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useMemo: factory => factory(), useEffect: stub, useRef: () => ({current: null}),
    useRead(url) {requested.push(url); return {data: undefined, error: undefined, reload: stub};},
    Download: stub, AnalyticsHealthSummary: ({site}) => React.createElement('div', null, `健康策略 ${site}`), BackendMeasurements: () => React.createElement('div', null, '生长测量记录'),
    document: {getElementById: id => ({focus: () => focus.push(id)})}, ...additions,
  };
  const Component = new Function(...Object.keys(bindings), code + `;return ${componentName};`)(...Object.values(bindings));
  const props = {site: 'hainan', onTree: stub, onStory: stub, onNotify: stub};
  const render = patch => {Object.assign(props, patch); cursor = 0; element = Component(props); return element;};
  render();
  return {render, requested, focus, get element() {return element;}, button(label) {return walk(element, node => node.type === 'button' && text(node) === label)[0];}, click(label) {const button = this.button(label); assert.ok(button, label); button.props.onClick(); render();}};
}

// Real component render and handlers; only hooks, HTTP reads and unrelated child panels are replaced.
test('analytics mounts one topic at a time and keeps long tables out of the default view', () => {
  const page = harness(analyticsCode, 'AnalyticsPage');
  assert.equal(walk(page.element, node => node.props.role === 'tab').length, 4);
  assert.equal(walk(page.element, node => node.props.role === 'tabpanel').length, 1);
  assert.match(text(page.element), /产胶与降雨的时间关系/);
  assert.equal(walk(page.element, node => node.type === 'table').length, 0);
  for (const [label, expected, absent] of [['林班与采割分布', '采割频次分布', '产胶与降雨的时间关系'], ['健康关注', '健康关注对象', '采割频次分布'], ['记录明细', '日度记录', '健康关注对象']]) {
    page.click(label);
    assert.match(text(page.element), new RegExp(expected));
    assert.doesNotMatch(text(page.element), new RegExp(absent));
    assert.equal(walk(page.element, node => node.props.role === 'tabpanel').length, 1);
  }
});

test('shared block and date range survive topic changes, including all tree and day records', () => {
  const page = harness(analyticsCode, 'AnalyticsPage');
  page.click('末 7 天');
  walk(page.element, node => node.type === 'select')[0].props.onChange({target: {value: 'B'}}); page.render();
  const kpis = () => text(walk(page.element, node => node.props.className === 'ax-kpis')[0]);
  const before = kpis();
  for (const label of ['林班与采割分布', '健康关注', '记录明细']) {page.click(label); assert.equal(kpis(), before);}
  assert.equal(walk(page.element, node => node.type === 'select')[0].props.value, 'B');
  const tables = walk(page.element, node => node.type === 'tbody');
  assert.equal(React.Children.count(tables[0].props.children), 7);
  assert.equal(React.Children.count(tables[1].props.children), 50);
  assert.match(text(tables[1]), /HN-B-0001/);
  assert.doesNotMatch(text(tables[1]), /HN-A-/);
  page.render({site: 'xsbn'});
  assert.match(text(page.element), /XS-B-0001/);
  assert.doesNotMatch(text(page.element), /HN-B-/);
});

test('selected record date stays linked to trend and keyboard tabs move focus', () => {
  const page = harness(analyticsCode, 'AnalyticsPage');
  page.click('记录明细');
  const selectedDate = analyticsData.DATA.hainan.at(-3).date;
  page.click(selectedDate); page.click('产量趋势');
  const readout = walk(page.element, node => node.props.className === 'ax-readout')[0];
  assert.match(text(readout), new RegExp(selectedDate));
  const active = walk(page.element, node => node.props.role === 'tab' && node.props['aria-selected'])[0];
  active.props.onKeyDown({key: 'End', preventDefault: stub}); page.render();
  assert.equal(page.focus.at(-1), 'analytics-tab-records');
  assert.equal(walk(page.element, node => node.props.role === 'tabpanel')[0].props.id, 'analytics-panel-records');
});

test('Xian has no production charts, data requests or collection price samples', () => {
  const page = harness(analyticsCode, 'AnalyticsPage');
  page.requested.length = 0; page.render({site: 'xian'});
  assert.match(text(page.element), /尚无连续生产序列/);
  assert.equal(walk(page.element, node => node.props.role === 'tab' || node.type === 'svg').length, 0);
  assert.ok(page.requested.every(url => url === null));
  const points = harness(collectionCode, 'CollectionPoints'); points.render({site: 'xian'});
  assert.match(text(points.element), /西安用于设备联调/);
  assert.equal(walk(points.element, node => node.type === 'table' || node.type === 'svg').length, 0);
  assert.deepEqual(collectionData.collectionPointSamples.xian, []);
});

test('collection network and details remain in their own park when the site changes', () => {
  const page = harness(collectionCode, 'CollectionPoints');
  page.click('海南示例加工厂 A');
  const detail = () => walk(page.element, node => node.props['aria-label'] === '网点详情')[0];
  assert.match(text(detail()), /海南示例加工厂 A/);
  page.render({site: 'xsbn'});
  assert.match(text(detail()), /西双版纳示例收胶点 A/);
  assert.doesNotMatch(text(page.element), /海南/);
  assert.equal(walk(page.element, node => node.type === 'tbody')[0].props.children.length, 3);
});

test('price comparison states its common basis, fixed date and fictional location boundary', () => {
  for (const site of ['hainan', 'xsbn']) {
    const page = harness(collectionCode, 'CollectionPoints'); page.render({site});
    const html = renderToStaticMarkup(page.element);
    assert.match(html, /虚构网点 · 示例报价/);
    assert.match(html, /无真实坐标/);
    assert.match(html, /干胶含量 30%/);
    assert.match(html, new RegExp(collectionData.collectionPointAsOf));
    assert.match(html, /未计运输、检测或扣杂费用/);
    for (const point of collectionData.collectionPointSamples[site]) {
      assert.equal(point.site, site);
      assert.ok(point.name.includes('示例'));
      assert.match(html, new RegExp(`${point.latexPrice.toFixed(2)} 元 / kg`));
    }
  }
});

test('schematic points open the same processing detail with keyboard as the comparison table', () => {
  const page = harness(collectionCode, 'CollectionPoints');
  const point = walk(page.element, node => node.props['aria-label'] === '查看海南示例加工厂 A')[0];
  point.props.onKeyDown({key: 'Enter', preventDefault: stub}); page.render();
  const detail = walk(page.element, node => node.props['aria-label'] === '网点详情')[0];
  assert.match(text(detail), /加工与交接环节.*集中加工/);
  assert.equal(page.button('海南示例加工厂 A').props['aria-pressed'], true);
});

test('data center exposes the collection network beside production analysis', () => {
  const CollectionPoints = stub;
  const page = harness(dataCenterCode, 'DataCenter', {AnalyticsPage: stub, CollectionPoints, PublicMarket: stub, PublicWeather: stub});
  // Inspect top-level children without evaluating the unrelated source catalog.
  const nav = React.Children.toArray(page.element.props.children).find(node => node.type === 'nav');
  const button = walk(nav, node => node.type === 'button' && text(node) === '收胶点与加工厂')[0];
  assert.ok(button); button.props.onClick(); page.render({site: 'xsbn'});
  const content = React.Children.toArray(page.element.props.children).find(node => node.type === CollectionPoints);
  assert.ok(content); assert.equal(content.props.site, 'xsbn');
});

test('every production park opens its own analysis and current tree aliases',()=>{
  const page=harness(analyticsCode,'AnalyticsPage');
  for(const site of productionSites){
    page.render({site});
    page.click('记录明细');
    assert.match(text(page.element),new RegExp(treeAlias(0,site)));
    assert.ok(page.requested.includes(`/api/demo/analytics?site=${site}&days=30`));
    assert.ok(page.button('单树档案 →'));
  }
});

test('grower analytics keeps filters, totals, detail and CSV inside the contracted 33 trees online and offline',async()=>{
  for(const online of [false,true]) {
    const indices=Array.from({length:33},(_,index)=>50+index);
    const account={role:'grower',siteIds:['demo-hainan'],plot:{siteId:'demo-hainan',label:'B区承包地 1 亩（33 棵）',treeIds:indices.map(index=>`T-${String(index+1).padStart(4,'0')}`)}};
    const scopedRows=treeScopeSeries(analyticsData.DATA.hainan,indices);
    const response={site:'hainan',asOf:scopedRows.at(-1).date,rows:scopedRows,source:{label:'后端承包范围模拟样本',rainfall:'园区降雨',mode:'backend_demo'}};
    let exported;
    const page=harness(analyticsCode,'AnalyticsPage',{
      useRead(url) {return {data:online&&url?.includes('site=hainan')?response:undefined,error:online?undefined:'服务不可用',reload:stub};},
      URL:{createObjectURL(blob){exported=blob;return 'blob:scoped-csv';},revokeObjectURL:stub},
      document:{createElement:()=>({click:stub})},setTimeout:stub,
    });
    page.render({account});page.click('末 7 天');
    const select=walk(page.element,node=>node.type==='select')[0];
    assert.deepEqual(React.Children.toArray(select.props.children).map(node=>node.props.value),['all','B']);
    assert.doesNotMatch(text(page.element),/园区比较|A 区|C 区|D 区/);
    page.click('记录明细');
    const tables=walk(page.element,node=>node.type==='tbody');
    assert.equal(React.Children.count(tables[0].props.children),7);
    assert.equal(React.Children.count(tables[1].props.children),33);
    assert.match(text(tables[1]),/HN-B-0001/);
    assert.doesNotMatch(text(tables[1]),/HN-A-|HN-C-|HN-D-|HN-B-0034/);
    page.click(' 导出日度数据');
    const csv=await exported.text();
    assert.match(csv,/B区承包地 1 亩（33 棵）/);
    const actualRows=csv.split('\n').slice(1).map(line=>line.split(',').map(cell=>cell.replaceAll('"','')));
    assert.deepEqual(actualRows.map(row=>Number(row[2])),scopedRows.slice(-7).map(row=>Number(row.actual.toFixed(3))));
    assert.deepEqual(actualRows.map(row=>Number(row[3])),scopedRows.slice(-7).map(row=>row.taps));
    const visible=analyticsData.allocateTrees(scopedRows.slice(-7));
    assert.equal(visible.length,33);
    assert.ok(Math.abs(visible.reduce((sum,tree)=>sum+tree.latex,0)-scopedRows.slice(-7).reduce((sum,row)=>sum+row.actual,0))<1e-9);
  }
});

test('analytics requests comparison only when the signed-in account can view that park',()=>{
  const page=harness(analyticsCode,'AnalyticsPage');
  for(const account of [
    {role:'grower',siteIds:['demo-hainan'],plot:{treeIds:['T-0051']}},
    {role:'manager',siteIds:['demo-hainan']},
  ]) {
    page.requested.length=0;page.render({account});
    assert.deepEqual(page.requested,['/api/demo/analytics?site=hainan&days=30',null]);
    assert.doesNotMatch(text(page.element),/园区比较/);
  }
  page.requested.length=0;page.render({account:{role:'executive',siteIds:['demo-hainan','demo-xsbn']}});
  assert.deepEqual(page.requested,['/api/demo/analytics?site=hainan&days=30','/api/demo/analytics?site=xsbn&days=30']);
  assert.match(text(page.element),/园区比较/);
  page.click('记录明细');
  assert.equal(React.Children.count(walk(page.element,node=>node.type==='tbody')[1].props.children),200);
});

test('scoped daily samples are not scaled again and keep the same allocation in a middle date window',()=>{
  const indices=Array.from({length:33},(_,index)=>50+index),rows=treeScopeSeries(analyticsData.DATA.hainan,indices);
  const response={site:'hainan',asOf:rows.at(-1).date,rows,source:{label:'后端承包范围',rainfall:'园区降雨',mode:'backend_demo'}};
  const source=sourceFunctions.analyticsSource('hainan',response,undefined,indices);
  assert.deepEqual(source.rows,rows);
  const selected=source.rows.slice(9,16),block=analyticsData.blockSeries(selected,'B',9);
  assert.deepEqual(block,selected);
  const detail=analyticsData.allocateTrees(selected,9),expected=analyticsData.allocateTrees(analyticsData.DATA.hainan.slice(9,16),9).filter(tree=>indices.includes(tree.index));
  assert.deepEqual(detail,expected);
  assert.equal(detail.reduce((sum,tree)=>sum+tree.taps,0),selected.reduce((sum,row)=>sum+row.taps,0));
});
