import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AlertTriangle, ArrowRight, CloudRain, Wrench} from 'lucide-react';
import {parseAst, transformWithOxc} from 'vite';
import {sites} from '../src/workspace/model.ts';
import {operationDateLabel} from '../src/workspace/operationsModel.ts';
import {logisticsDependency} from '../src/workspace/taskLifecycleModel.ts';
import {batchAssessment} from '../../shared/logistics.ts';
import {eventAffectsTask, eventMatchesTask, eventHoldForTask, eventKindLabels, eventScopeLabel, eventStatusLabels} from '../src/workspace/operationalEvents.ts';

const source = readFileSync(new URL('../src/workspace/OperationalEventsPanel.tsx', import.meta.url), 'utf8');
const {code} = await transformWithOxc(source, 'OperationalEventsPanel.tsx', {lang: 'tsx', jsx: {runtime: 'classic'}});
const declarations = parseAst(code).body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
const event = (patch = {}) => ({id: 'rain-1', siteId: 'demo-hainan', kind: 'rain', zone: 0, status: 'active', note: '持续降雨', createdAt: '2026-10-19T03:00:00Z', mode: 'simulation', ...patch});
const task = (patch = {}) => ({id: 'tap-a', site: 'hainan', title: '往期未完成割胶', date: '2026-10-18', block: 'A', robot: 'R-A', start: '08:00', end: '09:00', kind: '割胶', status: '执行中', treeIndices: [0], count: 1, done: 0, ...patch});
const batch = (patch = {}) => ({id: 'batch-a', siteId: 'demo-hainan', revision: 5, stage: 'planned', mode: 'simulation',
  source: {taskId: 'tap-a', taskRevision: 3, taskTitle: '已完成割胶', taskStatus: '已完成', treeIndices: [0], completedTrees: 1, completionKind: 'flow', receipts: []},
  collection: {id: 'collect-a', at: '2026-10-18T02:00:00Z', operator: '经办人', note: '收胶', point: {id: 'hn-collection-a', name: '收胶点'}, containerCount: 1},
  inspections: [], history: [], ...patch});

function harness(patch = {}) {
  const state = [], calls = {create: [], resolve: [], resume: [], task: []}; let cursor = 0;
  const props = {site: 'hainan', tasks: [task()], batches: [], events: [event()], onCreate: async value => {calls.create.push(value);}, onResolve: async (...args) => {calls.resolve.push(args);}, onResume: async (...args) => {calls.resume.push(args);}, onTask: value => calls.task.push(value), ...patch};
  const useState = initial => {const index = cursor++;if (!(index in state)) state[index] = initial;return [state[index], value => {state[index] = value;}];};
  const FormData = class {constructor(form){this.form = form;}get(key){return this.form.values[key];}};
  const component = new Function('React','useState','FormData','AlertTriangle','ArrowRight','CloudRain','Wrench','sites','operationDateLabel','logisticsDependency','batchAssessment','eventAffectsTask','eventMatchesTask','eventHoldForTask','eventKindLabels','eventScopeLabel','eventStatusLabels', declarations + ';return OperationalEventsPanel;')(
    React,useState,FormData,AlertTriangle,ArrowRight,CloudRain,Wrench,sites,operationDateLabel,logisticsDependency,batchAssessment,eventAffectsTask,eventMatchesTask,eventHoldForTask,eventKindLabels,eventScopeLabel,eventStatusLabels);
  return {calls, props, render(){cursor = 0;return component(props);}};
}
function walk(element, predicate) {if(!React.isValidElement(element))return [];return [...(predicate(element)?[element]:[]), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];}
function text(element) {if(typeof element === 'string'||typeof element === 'number')return String(element);return React.isValidElement(element)?React.Children.toArray(element.props.children).map(text).join(''):'';}
const named = (tree, label) => walk(tree, node => node.props['aria-label'] === label)[0];
const settle = () => new Promise(resolve => setImmediate(resolve));
async function submit(form, note) {const dom = {values: {note}, resets: 0, reset(){this.resets++;}}; form.props.onSubmit({currentTarget: dom, preventDefault(){}});await settle();return dom;}

test('panel lists real shared past tasks and does not create records while rendering', () => {
  const current = task(), h = harness({tasks: [current, task({id: 'foreign', site: 'xsbn'}), task({id: 'done', status: '已完成', done: 1})]});
  const tree = h.render(), html = renderToStaticMarkup(tree);
  assert.match(html, /往期未完成割胶/); assert.match(html, /2026-10-18/); assert.match(html, /割胶已完成，保留原回执/);
  assert.match(html, /人工模拟事件/); assert.match(html, /生成天气候选方案不会自动创建事件/); assert.doesNotMatch(html, /foreign/);
  assert.deepEqual(h.calls, {create: [], resolve: [], resume: [], task: []});
  walk(tree, node => node.type === 'button' && text(node) === '查看任务')[0].props.onClick();
  assert.equal(h.calls.task[0], current);
});

test('creation submits the selected actual zone and operator note, using backend results instead of local event copies', async () => {
  const h = harness({events: []});let tree = h.render();
  walk(tree, node => node.type === 'button' && text(node) === '设备故障')[0].props.onClick();
  tree = h.render();named(tree, '事件影响范围').props.onChange({target: {value: '2'}});
  const dom = await submit(named(h.render(), '确认天气或设备影响'), '  R-C割胶头检修  ');
  assert.deepEqual(h.calls.create, [{kind: 'device_fault', zone: 2, note: 'R-C割胶头检修'}]);
  assert.equal(dom.resets, 1); assert.deepEqual(h.props.events, []);
});

test('active events expose resolve only; resolved events expose a separate recovery confirmation', async () => {
  const h = harness();
  assert.equal(named(h.render(), '确认恢复'), undefined);
  await submit(named(h.render(), '解除影响'), '降雨已停止，道路待核对');
  assert.deepEqual(h.calls.resolve, [['rain-1', '降雨已停止，道路待核对']]); assert.deepEqual(h.calls.resume, []);
  h.props.events = [event({status: 'resolved', resolvedAt: '2026-10-19T04:00:00Z', resolutionNote: '降雨已停止'})];
  assert.equal(named(h.render(), '解除影响'), undefined);
  assert.match(text(h.render()), /已解除 · 待确认恢复/);
  await submit(named(h.render(), '确认恢复'), '已确认作业与收胶道路条件');
  assert.deepEqual(h.calls.resume, [['rain-1', '已确认作业与收胶道路条件']]);
});

test('event selection preserves other pending events in task and logistics reasons', () => {
  const h = harness({events: [event(), event({id: 'fault-1', kind: 'device_fault', note: '独立设备故障'})]});
  walk(h.render(), node => node.type === 'button' && text(node).startsWith('设备故障 · R-A'))[0].props.onClick();
  const tree = h.render(), detail = named(tree, '选中事件详情');
  assert.match(text(detail), /独立设备故障/); assert.match(text(detail), /持续降雨/);
  assert.match(text(detail), /其他未恢复事件、手工暂停、策略与天气窗口限制继续生效/);
});

test('foreign park devices are unavailable and foreign events are hidden', () => {
  const h = harness({site: 'xsbn', tasks: [task({site: 'xsbn'})]});
  const tree = h.render();
  assert.equal(walk(tree, node => node.type === 'button' && text(node) === '设备故障')[0].props.disabled, true);
  assert.match(text(tree), /本园区设备尚未接入/); assert.doesNotMatch(text(tree), /持续降雨|往期未完成割胶/);
});

test('backend rejection leaves the entered form intact and presents one visible error', async () => {
  const h = harness({onResolve: async () => {throw Error('该事件已被其他人处理，请刷新');}});
  const dom = await submit(named(h.render(), '解除影响'), '核实已解除');
  assert.equal(dom.resets, 0);
  assert.match(renderToStaticMarkup(h.render()), /role="alert">该事件已被其他人处理，请刷新/);
});

test('later rain does not count a signed or cancelled batch as pending logistics', () => {
  for (const stage of ['received', 'cancelled']) {
    const h = harness({tasks: [task({status: '已完成', done: 1})], batches: [batch({stage})]});
    const detail = text(named(h.render(), '选中事件详情'));
    assert.match(detail, /关联任务与储运依赖 · 0 项/);
    assert.doesNotMatch(detail, /往期未完成割胶|暂缓计划|待收胶确认/);
  }
});

test('an existing batch keeps its saved transport stage during rain and after recovery', () => {
  const h = harness({tasks: [task({status: '已完成', done: 1})], batches: [batch()]});
  let detail = text(named(h.render(), '选中事件详情'));
  assert.match(detail, /关联任务与储运依赖 · 1 项/);
  assert.match(detail, /已生成模拟运单 · 待发车/);
  assert.match(detail, /降雨影响 · A区：持续降雨/);
  h.props.events = [event({status: 'closed', closedAt: '2026-10-19T04:00:00Z', resumeNote: '恢复条件已核对'})];
  walk(h.render(), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({target: {checked: true}});
  detail = text(named(h.render(), '选中事件详情'));
  assert.match(detail, /已生成模拟运单 · 待发车/);
  assert.match(detail, /已登记独立收胶批次，请按批次记录继续办理/);
  assert.doesNotMatch(detail, /待收胶确认|暂缓计划/);
});

test('partial cancellation uses the collected trees for downstream event scope', () => {
  const partial = task({status: '已取消', count: 2, done: 1, treeIndices: [0, 50]});
  const value = batch({source: {...batch().source, taskStatus: '已取消'}});
  const h = harness({tasks: [partial], batches: [value]});
  assert.match(text(named(h.render(), '选中事件详情')), /关联任务与储运依赖 · 1 项/);
  assert.match(text(named(h.render(), '选中事件详情')), /已生成模拟运单 · 待发车/);
  h.props.events = [event({zone: 1})];
  assert.match(text(named(h.render(), '选中事件详情')), /关联任务与储运依赖 · 0 项/);
});

test('another park batch with the same source id cannot suppress a local task', () => {
  const h = harness({tasks: [task({status: '已完成', done: 1})], batches: [batch({siteId: 'demo-xsbn', stage: 'received'})]});
  const detail = text(named(h.render(), '选中事件详情'));
  assert.match(detail, /关联任务与储运依赖 · 1 项/);
  assert.match(detail, /暂缓计划/);
});
