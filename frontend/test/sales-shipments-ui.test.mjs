import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArrowRight, CheckCircle2, Truck} from 'lucide-react';
import {parseAst, transformWithOxc} from 'vite';
import {sites} from '../src/workspace/model.ts';
import {salesShipmentStatusLabels} from '../../shared/salesShipments.ts';
import {can} from '../src/workspace/identityModel.ts';

const source = readFileSync(new URL('../src/workspace/SalesShipmentPanel.tsx', import.meta.url), 'utf8');
const {code} = await transformWithOxc(source, 'SalesShipmentPanel.tsx', {lang: 'tsx', jsx: {runtime: 'classic'}});
const declarations = parseAst(code).body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
const at = '2026-10-20T03:00:00.000Z';
const inventory = (patch = {}) => ({siteId: 'demo-hainan', openingStockKg: 800, processedKg: 0, processedBatches: 0, stockKg: 800, availableKg: 400, heldKg: 400, dispatchedKg: 0, inTransitKg: 0, soldKg: 0, salesRevenueCny: 0, updatedAt: at, mode: 'simulation', unit: 'kg_dry_rubber', ...patch});
const shipment = (patch = {}) => ({
  id: 'shipment-one', siteId: 'demo-hainan', modelId: 'model-source', scenarioId: 'hold_short', scenarioName: '短期囤货',
  day: 4, plannedDepartureAt: '2026-10-23T00:00:00.000Z', plannedKg: 20, priceCnyPerKg: 15,
  plannedRevenueCny: 300, buyer: {id: 'buyer-one', name: '海南模拟接货商'}, status: 'planned',
  createdAt: at, mode: 'simulation', ...patch,
});
function walk(element, predicate) {
  if (!React.isValidElement(element)) return [];
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  return React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join('') : '';
}
const button = (tree, label) => walk(tree, node => node.type === 'button' && text(node) === label)[0];
const named = (tree, label) => walk(tree, node => node.props['aria-label'] === label)[0];
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(patch = {}, account = null) {
  const slots = [], deps = [], advances = [], sources = [];
  let cursor = 0, dirty = false, pending = [];
  const bindings = {
    React, ArrowRight, CheckCircle2, Truck, sites, salesShipmentStatusLabels, can, currentAccount:()=>account,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => {if (slots[index] !== value) {slots[index] = value; dirty = true;}}];
    },
    useEffect(effect, values) {
      const index = cursor++;
      if (!deps[index] || values.some((value, i) => value !== deps[index][i])) {deps[index] = values; pending.push(effect);}
    },
  };
  const Component = new Function(...Object.keys(bindings), `${declarations};return SalesShipmentPanel;`)(...Object.values(bindings));
  const props = {site: 'hainan', shipments: [shipment()], inventory: inventory(), onAdvance: async id => advances.push(id), onSource: id => sources.push(id), ...patch};
  return {props, advances, sources, render(update = {}) {
    Object.assign(props, update);
    let tree, passes = 0;
    do {cursor = 0; dirty = false; pending = []; tree = Component(props); pending.forEach(effect => effect()); assert.ok(++passes < 8);}
    while (dirty);
    return tree;
  }};
}

test('viewing roles can follow shipment progress without being offered actions the server rejects', () => {
  for (const role of ['executive','operator']) {
    for (const status of ['planned','in-transit']) {
      const h=harness({shipments:[shipment({status})]},{role,permissions:['site.read']});
      const tree=h.render();
      assert.equal(button(tree,'模拟发车'),undefined);
      assert.equal(button(tree,'模拟签收并回传'),undefined);
      assert.ok(button(tree,'查看来源销售方案'));
      assert.match(text(tree),/由园区管理办理发车与签收/);
    }
  }
  assert.ok(button(harness({}, {role:'manager',permissions:['sales.write']}).render(),'模拟发车'));
});

test('shipment overview shows future business batches and scopes totals while keeping calculation and ids folded', () => {
  const h = harness({shipments: [
    shipment(),
    shipment({id: 'cancelled-one', plannedKg: 99, status: 'cancelled', cancelledAt: at}),
    shipment({id: 'foreign', siteId: 'demo-xsbn', buyer: {id: 'foreign', name: '外园区接货商'}, plannedKg: 900}),
  ]});
  const tree = h.render(), html = renderToStaticMarkup(tree);
  const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
  assert.match(visible, /10月23日出货 20 公斤干胶/);
  assert.match(html, /可提前演示未来批次/);
  assert.match(visible, /本页计划出货 20 公斤干胶/);
  assert.match(visible, /仓内库存<\/dt><dd>800/);
  assert.match(visible, /可用库存<\/dt><dd>400/);
  assert.match(visible, /累计已销售<\/dt><dd>0/);
  assert.match(visible, /已替换/);
  assert.doesNotMatch(visible, /外园区接货商|shipment-one|model-source|预计销售额|300 元|模拟单价|累计销售额|累计出库|演示初始库存/);
  assert.match(html, /<details class="op-sales-records"><summary>查看执行记录与计算详情/);
  assert.match(html, /shipment-one/);
  assert.match(html, /300 元/);
  button(tree, '查看来源销售方案').props.onClick();
  assert.deepEqual(h.sources, ['model-source']);
});

test('dispatch then receipt uses saved server state for progress and displays returned quantity', async () => {
  const original = shipment(), h = harness({shipments: [original]});
  let tree = h.render();
  assert.equal(named(tree, '出货执行进度').props['aria-valuenow'], 0);
  button(tree, '模拟发车').props.onClick();
  await settle();
  assert.deepEqual(h.advances, ['shipment-one']);
  assert.equal(original.status, 'planned');
  tree = h.render({shipments: [shipment({status: 'in-transit', departureAt: at})], inventory: inventory({stockKg: 780, availableKg: 380, dispatchedKg: 20, inTransitKg: 20})});
  assert.equal(named(tree, '出货执行进度').props['aria-valuenow'], 50);
  assert.equal(button(tree, '模拟发车'), undefined);
  assert.match(renderToStaticMarkup(named(tree, '园区库存与销售')), /仓内库存<\/dt><dd>780/);
  assert.match(renderToStaticMarkup(named(tree, '园区库存与销售')), /正在运输<\/dt><dd>20/);
  assert.match(renderToStaticMarkup(named(tree, '园区库存与销售')), /累计已销售<\/dt><dd>0/);
  button(tree, '模拟签收并回传').props.onClick();
  await settle();
  assert.deepEqual(h.advances, ['shipment-one', 'shipment-one']);
  tree = h.render({shipments: [shipment({status: 'received', departureAt: at, receipt: {at, receivedKg: 19.5, priceCnyPerKg: 15, revenueCny: 292.5, note: '模拟接货核对完成', mode: 'simulation'}})], inventory: inventory({stockKg: 780, availableKg: 380, dispatchedKg: 20, soldKg: 19.5, salesRevenueCny: 292.5})});
  assert.equal(named(tree, '出货执行进度').props['aria-valuenow'], 100);
  assert.match(text(named(tree, '销售出货回传结果')), /19.5 公斤干胶已签收/);
  assert.match(text(named(tree, '销售出货回传结果')), /模拟接货核对完成/);
  assert.equal(button(tree, '模拟签收并回传'), undefined);
  assert.match(renderToStaticMarkup(named(tree, '园区库存与销售')), /仓内库存<\/dt><dd>780/);
  assert.match(renderToStaticMarkup(named(tree, '园区库存与销售')), /正在运输<\/dt><dd>0/);
  assert.match(renderToStaticMarkup(named(tree, '园区库存与销售')), /累计已销售<\/dt><dd>19.5/);
  assert.match(renderToStaticMarkup(tree), /回传销售额<\/dt><dd>292.5 元/);
});

test('processed production updates dry stock while sales quantities retain their separate meaning',()=>{
  const h=harness({shipments:[shipment()]});
  const html=renderToStaticMarkup(h.render({inventory:inventory({processedKg:34,processedBatches:1,stockKg:814,availableKg:414,dispatchedKg:20,soldKg:20})}));
  const visible=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(html,/累计加工入库 34 公斤干胶 · 1 批/);
  assert.match(visible,/仓内库存<\/dt><dd>814/);
  assert.match(visible,/可用库存<\/dt><dd>414/);
  assert.match(visible,/累计已销售<\/dt><dd>20/);
  assert.match(html,/800 公斤 \+ 加工入库 34 公斤 − 累计出库 20 公斤 = 当前库存 814 公斤/);
});

test('selection requests locate the exact batch and a cancelled batch keeps records without execution controls', () => {
  const h = harness({shipments: [shipment(), shipment({id: 'second', day: 5, plannedDepartureAt: '2026-10-24T00:00:00Z', status: 'cancelled', cancelledAt: at})]});
  let tree = h.render({selectedId: 'second'});
  assert.match(text(named(tree, '当前出货任务')), /10月24日出货/);
  assert.match(text(named(tree, '当前出货任务')), /此批已被新方案替换/);
  assert.equal(named(tree, '出货执行进度'), undefined);
  assert.equal(button(tree, '模拟发车'), undefined);
  tree = h.render({selectedId: 'shipment-one'});
  assert.match(text(named(tree, '当前出货任务')), /10月23日出货/);
  assert.ok(button(tree, '模拟发车'));
});

test('an empty park has no invented task and a failed action leaves its saved stage available', async () => {
  const empty = harness({shipments: []});
  assert.match(text(empty.render()), /当前园区还没有销售出货任务/);
  assert.equal(button(empty.render(), '模拟发车'), undefined);
  const h = harness({onAdvance: async () => {throw Error('服务暂不可用');}});
  button(h.render(), '模拟发车').props.onClick();
  await settle();
  const tree = h.render();
  assert.equal(named(tree, '出货执行进度').props['aria-valuenow'], 0);
  assert.equal(walk(tree, node => node.props.role === 'alert').map(text).join(''), '服务暂不可用');
  assert.equal(button(tree, '模拟发车').props.disabled, false);
});
