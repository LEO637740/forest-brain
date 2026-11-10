import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArrowRight, Truck} from 'lucide-react';
import {parseAst, transformWithOxc} from 'vite';
import * as logistics from '../../shared/logistics.ts';
import {collectionPointSamples} from '../src/workspace/collectionPointData.ts';
import {logisticsDependencies} from '../src/workspace/taskLifecycleModel.ts';
import {operationDateLabel} from '../src/workspace/operationsModel.ts';
import {treeAlias} from '../src/workspace/model.ts';
import {makeDemoTasks} from '../../backend/src/adapters/demo-tasks.js';
import {transitionTask} from '../src/workspace/taskFlow.ts';
import {can} from '../src/workspace/identityModel.ts';

const at = '2026-10-19T03:00:00Z';
const record = (patch = {}) => ({id: 'record-1', at, operator: '经办甲', note: '现场模拟核对', ...patch});
const task = (patch = {}) => ({id: 'tap-one', revision: 3, site: 'hainan', title: '已完成割胶', date: '2026-10-18', block: 'A', robot: 'R-A', start: '08:00', end: '09:00', kind: '割胶', status: '已完成', treeIndices: [0], count: 1, done: 1, dispatch: {phase: 'completed', skipped: [], history: [{time: at, label: '模拟作业完成'}]}, ...patch});
const batch = (patch = {}) => ({id: 'batch-one', siteId: 'demo-hainan', revision: 4, stage: 'collected', mode: 'simulation', source: {taskId: 'tap-one', taskRevision: 3, taskTitle: '往期已完成割胶', taskStatus: '已完成', treeIndices: [0], completedTrees: 1, completionKind: 'flow', receipts: []}, collection: {...record(), point: {id: 'hn-collection-a', name: '海南示例收胶点 A'}, containerCount: 3}, inspections: [], history: [{...record(), action: 'collect', requestId: 'collect-one'}], ...patch});
const weighing = {...record({id: 'weigh-1'}), grossKg: 125, tareKg: 5, netKg: 120};
const inspection = {...record({id: 'inspect-1'}), sampleId: 'sample-1', dryRubberPercent: 30, decision: 'pass'};
const transport = {...record({id: 'transport-1'}), destination: {id: 'hn-processing-a', name: '海南示例加工厂 A'}, vehicleCode: '演示车辆-1', driver: '驾驶员甲', plannedDepartureAt: '2026-10-19T05:30:00Z', plannedKg: 120};
const rain = {id: 'rain-one', siteId: 'demo-hainan', kind: 'rain', zone: 0, status: 'active', note: 'A区降雨未恢复', createdAt: at, mode: 'simulation'};
const fleet = {ready: true, jobs: {}, zones: []};
const DetailStub = () => null;

async function componentSource(name) {
  const source = readFileSync(new URL(`../src/workspace/${name}.tsx`, import.meta.url), 'utf8');
  const {code} = await transformWithOxc(source, `${name}.tsx`, {lang: 'tsx', jsx: {runtime: 'classic'}});
  return parseAst(code).body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
}
const detailCode = await componentSource('LatexBatchDetail');
const panelCode = await componentSource('LogisticsPanel');
function makeHarness(code, name, props, bindings = {}) {
  const state = [], dependencies = [], events = []; let cursor = 0, dirty = false, effects = [];
  const useState = initial => {const index = cursor++;if (!(index in state)) state[index] = initial;return [state[index], value => {const next=typeof value === 'function' ? value(state[index]) : value;if(next!==state[index]){state[index]=next;dirty=true;}}];};
  const useEffect = (effect, deps) => {const index=cursor++;if(!dependencies[index]||deps.some((value,i)=>value!==dependencies[index][i])){dependencies[index]=deps;effects.push(effect);}};
  const FormData = class {constructor(form){this.form = form;}get(key){return this.form.values[key] ?? null;}};
  const values = {React, useState, useEffect, FormData, collectionPointSamples,
    window:{dispatchEvent:event=>events.push({type:event.type,detail:event.detail})},
    CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
    ...logistics, ...bindings};
  const component = new Function(...Object.keys(values), `${code};return ${name};`)(...Object.values(values));
  return {props, events, render(){let tree,passes=0;do{cursor=0;dirty=false;effects=[];tree=component(props);effects.forEach(effect=>effect());assert.ok(++passes<10);}while(dirty);return tree;}};
}
function detail(patch = {}) {
  const calls = [];
  return {calls, ...makeHarness(detailCode, 'LatexBatchDetail', {batch: batch(), events: [], onAction: async (...args) => {calls.push(args);}, ...patch})};
}
function panel(patch = {}, account = null) {
  const calls = {create: [], task: []};
  return {calls, ...makeHarness(panelCode, 'LogisticsPanel', {site: 'hainan', tasks: [task()], allTasks: [task()], fleet, events: [], batches: [], onCreateBatch: async input => {calls.create.push(input);}, onBatchAction: async () => {}, onTask: value => {calls.task.push(value);}, ...patch}, {ArrowRight, Truck, treeAlias, logisticsDependencies, operationDateLabel, LatexBatchDetail: DetailStub, batchTime: value => value, can, currentAccount:()=>account})};
}
function walk(element, predicate) {if (!React.isValidElement(element)) return [];return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];}
function text(element) {if (typeof element === 'string' || typeof element === 'number') return String(element);return React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join('') : '';}
const named = (tree, label) => walk(tree, node => node.props['aria-label'] === label)[0];
const button = (tree, label) => walk(tree, node => node.type === 'button' && text(node) === label)[0];
async function submit(form, values) {
  assert.ok(form, 'expected form to exist');
  const dom = {values, resets: 0, reset(){this.resets++;}};
  form.props.onSubmit({currentTarget: dom, preventDefault(){}});
  await new Promise(resolve => setImmediate(resolve));return dom;
}
const common = {operator: '  经办乙  ', note: '  已核实模拟单据  '};

test('viewing roles retain logistics records and exports without collection or processing forms', () => {
  const account={role:'executive',permissions:['site.read']};
  assert.equal(button(panel({},account).render(),'登记收胶'),undefined);
  const tree=panel({batches:[batch()]},account).render();
  assert.ok(button(tree,'查看批次'));
  assert.equal(walk(tree,node=>node.type===DetailStub)[0].props.readOnly,true);
  const detailTree=detail({readOnly:true}).render();
  assert.equal(named(detailTree,'登记称重'),undefined);
  assert.equal(button(detailTree,'暂停流程'),undefined);
  assert.ok(button(detailTree,'导出批次 JSON'));
  assert.ok(button(panel({}, {role:'manager',permissions:['logistics.write']}).render(),'登记收胶'));
});

test('shared batches remain visible across task dates and exclude foreign park records', () => {
  const original = task(), h = panel({tasks: [], allTasks: [original], batches: [batch(), batch({id: 'foreign-batch', siteId: 'demo-xsbn', source: {...batch().source, taskTitle: '外园区批次'}})]});
  const tree = h.render(), html = renderToStaticMarkup(tree);
  assert.match(html, /当前日期范围尚无割胶任务/); assert.match(html, /往期已完成割胶/);
  assert.match(html, /全部日期的批次/); assert.doesNotMatch(html, /外园区批次/);
  button(tree, '查看批次来源任务').props.onClick(); assert.equal(h.calls.task[0], original);
  assert.equal(walk(tree, node => node.type === DetailStub)[0].props.batch.id, 'batch-one');
});

test('unavailable source keeps the stored batch without forging a task link', () => {
  const h = panel({tasks: [], allTasks: [], batches: [batch()]});
  assert.match(text(h.render()), /来源任务当前不可用/);
  assert.equal(button(h.render(), '查看批次来源任务'), undefined);
});

test('collection accepts only shared eligible work and sends entered container count without inferred weight', async () => {
  const h = panel();button(h.render(), '登记收胶').props.onClick();
  const tree = h.render(), form = named(tree, '登记收胶批次');
  const options = walk(named(tree, '示例收胶点'), node => node.type === 'option').map(node => node.props.value);
  assert.deepEqual(options, ['', 'hn-collection-a', 'hn-collection-b']);
  const dom = await submit(form, {...common, collectionPointId: 'hn-collection-b', containerCount: '4'});
  assert.deepEqual(h.calls.create, [{taskId: 'tap-one', operator: '经办乙', collectionPointId: 'hn-collection-b', containerCount: 4, note: '已核实模拟单据'}]);
  assert.equal(dom.resets, 1); assert.deepEqual(h.props.batches, []);
  assert.equal(named(h.render(), '登记收胶批次'), undefined);
});

test('unfinished, unverified and rain-held work cannot begin another collection', () => {
  for (const patch of [{tasks: [task({status: '执行中', done: 0})]}, {tasks: [task({dispatch: undefined})]}, {events: [rain]}]) {
    const h = panel(patch); assert.equal(button(h.render(), '登记收胶').props.disabled, true); assert.deepEqual(h.calls.create, []);
  }
  const h = panel({batches: [batch()]}); assert.equal(button(h.render(), '登记收胶'), undefined); assert.ok(button(h.render(), '查看批次'));
});

test('weighing submits only entered gross and tare with displayed revision, never a locally calculated net', async () => {
  const h = detail({events: [rain]});
  assert.equal(walk(named(h.render(), '登记称重'), node => node.type === 'fieldset')[0].props.disabled, false);
  await submit(named(h.render(), '登记称重'), {...common, grossKg: '125.25', tareKg: '5.25'});
  assert.deepEqual(h.calls, [['batch-one', 'weigh', {revision: 4, operator: '经办乙', note: '已核实模拟单据', grossKg: 125.25, tareKg: 5.25}]]);
  assert.equal(h.props.batch.weighing, undefined);
});

test('quality-held batches append explicit reinspection and preserve the prior result', async () => {
  const failed = {...inspection, decision: 'hold', note: '杂质待复检'};
  const value = batch({stage: 'quality-held', weighing, inspections: [failed]});
  const h = detail({batch: value}), tree = h.render();
  assert.ok(named(tree, '追加质检复检')); assert.equal(named(tree, '安排运输'), undefined);
  assert.equal(named(tree, '质检结论').props.defaultValue, ''); assert.equal(named(tree, '质检结论').props.required, true);
  assert.match(text(tree), /杂质待复检/); assert.match(text(tree), /共 1 次检测/);
  await submit(named(tree, '追加质检复检'), {...common, sampleId: ' sample-recheck ', dryRubberPercent: '31.5', decision: 'pass'});
  assert.equal(h.calls[0][1], 'inspect'); assert.deepEqual(h.calls[0][2], {revision: 4, operator: '经办乙', note: '已核实模拟单据', sampleId: 'sample-recheck', dryRubberPercent: 31.5, decision: 'pass'});
  assert.equal(value.inspections.length, 1); assert.equal(value.inspections[0].decision, 'hold');
});

test('transport planning selects this park factory and keeps planning separate from dispatch', async () => {
  const h = detail({batch: batch({stage: 'ready', weighing, inspections: [inspection]}), events: [rain]});
  const tree = h.render(), options = walk(named(tree, '示例运输目的地'), node => node.type === 'option').map(node => node.props.value);
  assert.deepEqual(options, ['', 'hn-processing-a']); assert.equal(named(tree, '确认发车'), undefined);
  await submit(named(tree, '安排运输'), {...common, destinationId: 'hn-processing-a', vehicleCode: ' 演示车A ', driver: ' 司机乙 ', plannedDepartureAt: '2026-10-19T13:30'});
  assert.deepEqual(h.calls[0], ['batch-one', 'plan', {revision: 4, operator: '经办乙', note: '已核实模拟单据', destinationId: 'hn-processing-a', vehicleCode: '演示车A', driver: '司机乙', plannedDepartureAt: '2026-10-19T05:30:00.000Z'}]);
});

test('rain disables departure and recovering a manual pause does not claim to recover rain', async () => {
  const value = batch({stage: 'planned', weighing, inspections: [inspection], transport, manualHold: record({note: '人工核对车次'})});
  const h = detail({batch: value, events: [rain]});
  assert.equal(walk(named(h.render(), '确认发车'), node => node.type === 'fieldset')[0].props.disabled, true);
  button(h.render(), '恢复手工暂停').props.onClick();
  const tree = h.render();assert.match(text(tree), /当前雨情对发车的限制继续生效/);
  assert.equal(walk(named(tree, '恢复流程'), node => node.type === 'fieldset')[0].props.disabled, false);
  await submit(named(tree, '恢复流程'), common);
  assert.deepEqual(h.calls[0], ['batch-one', 'resume', {revision: 4, operator: '经办乙', note: '已核实模拟单据'}]);
});

test('in-transit arrival records zero received weight during rain and cannot be cancelled', async () => {
  const value = batch({stage: 'in-transit', weighing, inspections: [inspection], transport: {...transport, departure: record({id: 'departure-1'})}});
  const h = detail({batch: value, events: [rain]}), tree = h.render();
  assert.equal(button(tree, '取消流程'), undefined);
  assert.equal(walk(named(tree, '登记签收'), node => node.type === 'fieldset')[0].props.disabled, false);
  assert.equal(named(tree, '签收重量（kg 鲜胶乳）').props.min, '0');
  await submit(named(tree, '登记签收'), {...common, receivedKg: '0'});
  assert.deepEqual(h.calls[0], ['batch-one', 'receive', {revision: 4, operator: '经办乙', note: '已核实模拟单据', receivedKg: 0}]);
});

test('received batch starts processing separately from inventory and offers a factory quality freeze', async () => {
  const value = batch({stage: 'received', weighing, inspections: [inspection], transport: {...transport, departure: record(), receipt: {...record(), receivedKg: 118.5, differenceKg: -1.5}}});
  const h = detail({batch: value}), tree = h.render();
  assert.match(text(tree), /签收 118.5 kg · 较发运净重 -1.5 kg/);
  assert.match(text(tree), /开始模拟加工/);
  assert.match(text(tree), /工厂实收 118.5 公斤鲜胶乳，质检干胶含量 30%/);
  assert.equal(walk(tree, node => node.type === 'form').length, 1);
  assert.equal(button(tree, '暂停流程'), undefined); assert.ok(button(tree, '导出批次 JSON'));
  assert.ok(button(tree,'质检冻结'));
  const form=named(tree,'开始模拟加工');
  assert.equal(named(form,'经办人（模拟）').props.defaultValue,'模拟加工员');
  assert.match(named(form,'办理说明').props.defaultValue,/签收与质检/);
  await submit(form,{operator:named(form,'经办人（模拟）').props.defaultValue,note:named(form,'办理说明').props.defaultValue});
  assert.deepEqual(h.calls,[['batch-one','start-processing',{revision:4,operator:'模拟加工员',note:'已核对本批签收与质检记录，开始模拟加工。'}]]);
  assert.equal(value.processing,undefined);
});

test('processing submits an explicit dry-rubber loss and displays the formula without claiming inventory has increased', async () => {
  const value=batch({stage:'processing',weighing,inspections:[{...inspection,grade:'B'}],processingStarted:record(),transport:{...transport,receipt:{...record(),receivedKg:118.5,differenceKg:-1.5}}});
  const h=detail({batch:value}),tree=h.render(),form=named(tree,'模拟加工入库');
  assert.match(text(tree),/当前库存尚未增加/);assert.match(text(tree),/理论干胶 35.55 kg/);
  assert.match(text(tree),/入库干胶 = 到厂实收鲜胶乳 × 干胶含量 − 加工损耗/);
  assert.equal(named(form,'加工损耗（kg 干胶）').props.defaultValue,'0');
  assert.equal(button(tree,'质检冻结'),undefined);
  await submit(form,{...common,processLossKg:'0.55'});
  assert.deepEqual(h.calls[0],['batch-one','process',{revision:4,operator:'经办乙',note:'已核实模拟单据',processLossKg:0.55}]);
  assert.equal(value.processing,undefined);
});

test('quality freeze is explicit and a factory retest submits the chosen demo grade while preserving receipt facts', async()=>{
  const receipt={...record(),receivedKg:118.5,differenceKg:-1.5};
  const value=batch({stage:'received',weighing,inspections:[inspection],transport:{...transport,receipt}});
  const h=detail({batch:value});button(h.render(),'质检冻结').props.onClick();
  await submit(named(h.render(),'质检冻结'),common);
  assert.equal(h.calls[0][1],'hold');
  h.props.batch={...value,stage:'quality-held',qualityHold:{...record({note:'到厂复检'}),resumeStage:'received'},revision:5};
  const tree=h.render();assert.ok(named(tree,'追加质检复检'));assert.equal(button(tree,'开始模拟加工'),undefined);
  await submit(named(tree,'追加质检复检'),{...common,sampleId:'factory-retest',dryRubberPercent:'34',decision:'pass',grade:'A'});
  assert.equal(h.calls[1][2].grade,'A');assert.equal(h.calls[1][2].revision,5);
  assert.deepEqual(h.props.batch.transport.receipt,receipt);
});

test('processed batch shows saved dry rubber output, folds tracing ids and opens current market inventory without a second processing action',()=>{
  const processing={...record({id:'processing-one'}),latexKg:118.5,dryRubberPercent:30,dryKg:35.55,inspectionId:inspection.id};
  const value=batch({stage:'processed',weighing,inspections:[inspection],transport:{...transport,departure:record(),receipt:{...record(),receivedKg:118.5,differenceKg:-1.5}},processing});
  const h=detail({batch:value}),tree=h.render(),html=renderToStaticMarkup(tree),visible=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  assert.match(visible,/35.55 公斤干胶已入库/);
  assert.match(visible,/已增加本园区可售干胶库存/);
  assert.match(html,/工厂实收 118.5 公斤鲜胶乳 × 干胶含量 30%/);
  assert.doesNotMatch(visible,/processing-one|inspect-1|batch-one|tap-one/);
  assert.match(html,/processing-one/);assert.match(html,/inspect-1/);
  assert.equal(walk(tree,node=>node.type==='form').length,0);
  assert.equal(button(tree,'模拟加工入库'),undefined);
  button(tree,'查看经营方案与最新库存').props.onClick();
  assert.deepEqual(h.events,[{type:'harness-open-market',detail:{site:'hainan'}}]);
});

test('server rejection preserves form values and revision instead of inventing a successful stage', async () => {
  const h = detail({onAction: async () => {throw Error('批次已被其他操作更新，请重新核对');}});
  const dom = await submit(named(h.render(), '登记称重'), {...common, grossKg: '100', tareKg: '5'});
  assert.equal(dom.resets, 0); assert.equal(h.props.batch.stage, 'collected');
  assert.match(renderToStaticMarkup(h.render()), /role="alert">批次已被其他操作更新，请重新核对/);
});

test('a newly registered source becomes selected even if another batch was already open', async () => {
  const old = batch({id: 'older-batch', source: {...batch().source, taskId: 'older-task', taskTitle: '先前收胶'}});
  const h = panel({batches: [old]});
  button(h.render(), '登记收胶').props.onClick();
  await submit(named(h.render(), '登记收胶批次'), {...common, collectionPointId: 'hn-collection-a', containerCount: '1'});
  h.props.batches = [old, batch()];
  assert.equal(walk(h.render(), node => node.type === DetailStub)[0].props.batch.id, 'batch-one');
});

test('a previously displayed form keeps its own revision if another client updates the batch', async () => {
  const h = detail(), oldForm = named(h.render(), '登记称重');
  h.props.batch = batch({revision: 5, manualHold: record({note: '其他经办人暂停'})});
  const latestForm = named(h.render(), '登记称重');
  assert.notEqual(oldForm.key, latestForm.key);
  assert.equal(walk(latestForm, node => node.type === 'fieldset')[0].props.disabled, true);
  await submit(oldForm, {...common, grossKg: '80', tareKg: '4'});
  assert.equal(h.calls[0][2].revision, 4);
});


test('partial cancellation offers only verified completed trees and counts them under confirmation', () => {
  const first = {id: 'cut-one', requestedAt: at, angle: 28, planVersion: 'baseline-v0'};
  const second = {...first, id: 'cut-two'};
  const value = task({status: '已取消', count: 2, done: 1, treeIndices: [0, 1], dispatch: undefined, railBatch: {baseDone: 0, jobs: {0: first, 1: second}, results: {0: {index: 0, job: first, outcome: 'completed', finishedAt: at}, 1: {index: 1, job: second, outcome: 'cancelled', finishedAt: at}}}});
  assert.equal(logistics.collectionIssue(value, []), null);
  const h = panel({tasks: [value], allTasks: [value]}), tree = h.render();
  assert.match(text(tree), /完成部分待收胶/); assert.match(text(tree), /仅登记已核对完成的 1 株：HN-A-0001/);
  assert.doesNotMatch(text(tree), /HN-A-0002|停止计划/);
  assert.equal(button(tree, '登记收胶').props.disabled, false);
  assert.ok(button(tree, '待办理1')); assert.ok(button(tree, '暂缓 \/ 停止0'));
  button(tree, '待办理1').props.onClick(); assert.match(text(h.render()), /完成部分待收胶/);
});

test('a cancelled daily demo shows its twelve receipts and can register the completed portion from confirmation', async () => {
  const running=makeDemoTasks(new Date(at)).find(task=>task.site==='hainan'&&task.block==='B');
  const cancelled=transitionTask(transitionTask(running,'cancel',at),'ack',at);
  const h=panel({tasks:[cancelled],allTasks:[cancelled]});
  let tree=h.render();
  assert.match(text(tree),/12 份模拟完成回执/);
  assert.match(text(tree),/仅登记已核对完成的 12 株/);
  assert.doesNotMatch(text(tree),/尚无完成回执/);
  assert.ok(button(tree,'暂缓 / 停止0'));
  button(tree,'待办理1').props.onClick();
  tree=h.render();
  assert.match(text(tree),/完成部分待收胶/);
  assert.equal(button(tree,'登记收胶').props.disabled,false);
  button(tree,'登记收胶').props.onClick();
  await submit(named(h.render(),'登记收胶批次'),{...common,collectionPointId:'hn-collection-b',containerCount:'2'});
  assert.deepEqual(h.calls.create,[{taskId:cancelled.id,operator:'经办乙',collectionPointId:'hn-collection-b',containerCount:2,note:'已核实模拟单据'}]);
});

test('batch details show the source demo strategy and the number of completed receipts stored with it', () => {
  const running=makeDemoTasks(new Date(at)).find(task=>task.site==='hainan'&&task.block==='B');
  const cancelled=transitionTask(transitionTask(running,'cancel',at),'ack',at);
  const source=logistics.collectionSource(cancelled);
  const h=detail({batch:batch({source})}), tree=h.render();
  assert.match(text(tree),/来源模拟方案与回传 · 12 份完成回执/);
  assert.ok(text(tree).includes(source.demoStrategy.title));
  assert.ok(text(tree).includes(source.demoStrategy.strategyId));
  assert.match(text(tree),/收胶关联 12 棵已完成树；逐树回传随批次 JSON 保存/);
  assert.ok(button(tree,'导出批次 JSON'));
});

test('a terminal batch removes an already open administrative form after another client finishes it', () => {
  for (const stage of ['processed', 'cancelled']) {
    const h = detail();button(h.render(), '暂停流程').props.onClick();
    assert.ok(named(h.render(), '暂停流程'));
    h.props.batch = batch({stage, revision: 5});
    assert.equal(walk(h.render(), node => node.type === 'form').length, 0);
    assert.equal(button(h.render(), '暂停流程'), undefined);
    assert.ok(button(h.render(), '导出批次 JSON'));
  }
});

test('a signed batch remains pending processing and a processed batch closes that work even when the upstream was cancelled',()=>{
  const upstream=task({status:'已取消'});
  const signed=batch({stage:'received',weighing,inspections:[inspection],transport:{...transport,departure:record(),receipt:{...record(),receivedKg:119.5,differenceKg:-0.5}}});
  const h=panel({tasks:[upstream],allTasks:[upstream],batches:[signed],events:[rain]});
  const tree=h.render();
  assert.ok(button(tree,'暂缓 / 停止0'));assert.ok(button(tree,'待办理1'));
  assert.match(text(tree),/已到厂签收 · 待加工/);assert.match(text(tree),/119.5/);
  assert.doesNotMatch(text(tree),/此割胶任务已登记收胶批次/);
  h.props.batches=[{...signed,stage:'processed',processing:{...record(),latexKg:119.5,dryRubberPercent:30,dryKg:35.85,inspectionId:inspection.id}}];
  assert.ok(button(h.render(),'待办理0'));
  assert.match(text(h.render()),/35.85 公斤干胶已入库/);
});

test('a batch open request selects the saved processing batch and retains its source task route',()=>{
  const source=task();
  const first=batch({id:'first',source:{...batch().source,taskId:'older'}});
  const selected=batch({id:'processed-target',source:{...batch().source,taskId:source.id},stage:'processed',processing:{...record(),latexKg:120,dryRubberPercent:30,dryKg:36,inspectionId:inspection.id}});
  const h=panel({tasks:[source],allTasks:[source],batches:[first,selected],openRequest:{id:'processed-target',sequence:1}});
  const tree=h.render();
  assert.equal(walk(tree,node=>node.type===DetailStub)[0].props.batch.id,'processed-target');
  button(tree,'查看批次来源任务').props.onClick();
  assert.equal(h.calls.task[0],source);
});
