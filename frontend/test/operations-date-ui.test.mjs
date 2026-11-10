import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc, parseAst } from 'vite';
import * as model from '../src/workspace/model.ts';
import * as taskFlow from '../src/workspace/taskFlow.ts';
import * as operationsModel from '../src/workspace/operationsModel.ts';
import * as fleetControlModel from '../src/workspace/taskFleetControlModel.ts';
import * as operationalEvents from '../src/workspace/operationalEvents.ts';

const source = readFileSync(new URL('../src/workspace/OperationsPage.tsx', import.meta.url), 'utf8');
const transformed = await transformWithOxc(source, 'OperationsPage.tsx', { lang: 'tsx', jsx: { runtime: 'classic' } });
const ast = parseAst(transformed.code);
const importNodes = ast.body.filter(node => node.type === 'ImportDeclaration');
const componentCode = ast.body.filter(node => node.type !== 'ImportDeclaration')
  .map(node => transformed.code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
const now = Date.parse('2026-10-18T02:00:00Z');
const today = '2026-10-18', yesterday = '2026-10-17', tomorrow = '2026-10-19';
const fleet = { ready: true, error: null, jobs: {}, zones: [] };
const stub = () => null;
const LogisticsPanel = () => null;
const SalesShipmentPanel = () => null;
const OperationalEventsPanel = () => null;
const TaskLifecycle = () => null;
const TaskMonitor = () => null;
const ZoneTaskControls = () => null;

function task(id, overrides = {}) {
  return { id, site: 'xsbn', title: `任务 ${id}`, block: 'A', robot: 'Robot 1', date: today,
    start: '08:00', end: '09:00', count: 3, done: 0, status: '待开始', kind: '割胶', treeIndices: [0, 1, 2], ...overrides };
}

function walk(element, predicate) {
  if (!React.isValidElement(element)) return [];
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  if (!React.isValidElement(element)) return '';
  return React.Children.toArray(element.props.children).map(text).join('');
}
const hasClass = (element, name) => String(element.props.className ?? '').split(' ').includes(name);

/** Render the real page and date model; replace only React scheduling and unrelated child views. */
function harness(tasks, overrides = {}) {
  let clock = now, cursor = 0, dirty = false, element, pendingEffects = [], frames = [], firstCommit = true;
  const currentFleet = overrides.fleet ?? fleet;
  const slots = [], timers = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const calls = { updates: [], notifications: [], selected: [], starts: [], retries: [], flows: [], trees: [] };
  const props = {
    shipments: [], salesInventory:null, shipmentError: '', onAdvanceShipment: async () => {}, onShipmentSource: stub,
    batches: [], onCreateBatch: async () => {}, onBatchAction: async () => {}, events: [], onCreateEvent: async () => {}, onResolveEvent: async () => {}, onResumeEvent: async () => {},
    site: 'xsbn', tasks: structuredClone(tasks), selectedTaskId: tasks[0]?.id ?? '',
    onSelectTask(id) { calls.selected.push(id); props.selectedTaskId = id; },
    onTaskUpdate(updated) {
      calls.updates.push(structuredClone(updated));
      props.tasks = props.tasks.map(current => current.id === updated.id ? updated : current);
    },
    onNotify(message) { calls.notifications.push(message); },
    onStartRailBatch(value) { calls.starts.push(value); }, onRetryRail(value) { calls.retries.push(value); },
    onOpenFlow(value) { calls.flows.push(value); }, onTree(value) { calls.trees.push(value); },
    onTreeHistory: stub, onStory: stub, ...overrides,
  };
  const sameDeps = (first, second) => first && second && first.length === second.length && first.every((value, index) => Object.is(value, second[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(slots[index].value, value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useMemo(factory) { cursor++; return factory(); },
    useCallback(callback) { cursor++; return callback; },
    useRef(value) { const index = cursor++; return (slots[index] ??= { current: value }); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) {
        pendingEffects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, callback, cleanup: callback() }; });
      }
    },
    useSyncExternalStore() { cursor++; return currentFleet; },
  };
  const setInterval = callback => { const id = timers.size + 1; timers.set(id, callback); return id; };
  const clearInterval = id => timers.delete(id);
  const events = registry => ({
    addEventListener(name, callback) { registry.set(name, callback); },
    removeEventListener(name, callback) { if (registry.get(name) === callback) registry.delete(name); },
  });
  const window = { ...events(windowEvents), setInterval, clearInterval, innerHeight: 900 };
  const document = { ...events(documentEvents), visibilityState: 'visible', hidden: false };
  const modules = {
    react: hooks, 'lucide-react': new Proxy({}, { get: () => stub }),
    './model': model, './taskFlow': taskFlow, './operationsModel': operationsModel, './taskFleetControlModel': fleetControlModel,
    './Modal': { Modal: stub }, './SurfaceReturn': { SurfaceReturn: stub },
    './ZoneFleetControls': { ZoneTaskControls }, '../zoneFleet': { getFleetSnapshot: () => currentFleet, subscribeFleet: stub },
    './TaskLifecycle': { TaskLifecycle }, './TaskArrange': { TaskMonitor }, './LogisticsPanel': { LogisticsPanel },
    './SalesShipmentPanel': { SalesShipmentPanel },
    './OperationalEventsPanel': { OperationalEventsPanel }, './operationalEvents': operationalEvents,
  };
  const bindings = { React, window, document, setInterval, clearInterval };
  for (const declaration of importNodes) for (const specifier of declaration.specifiers) {
    const module = modules[declaration.source.value];
    assert.ok(module, `Test harness needs the unrelated dependency ${declaration.source.value}`);
    bindings[specifier.local.name] = module[specifier.imported?.name ?? 'default'];
    assert.notEqual(bindings[specifier.local.name], undefined, `Missing dependency ${specifier.local.name}`);
  }
  const component = new Function(...Object.keys(bindings), componentCode + ';return OperationsPage;')(...Object.values(bindings));
  function atClock(action) {
    const original = Date.now;
    try { Date.now = () => clock; return action(); } finally { Date.now = original; }
  }
  function render() {
    return atClock(() => {
      let attempts = 0;
      frames = [];
      do {
        assert.ok(attempts++ < 15, 'React state/effects should settle');
        cursor = 0; dirty = false; pendingEffects = [];
        element = component(props);
        frames.push(element);
        for (const effect of pendingEffects) effect();
        if (firstCommit && overrides.strictEffects) {
          for (const slot of slots) if (slot?.callback) { slot.cleanup?.(); slot.cleanup = slot.callback(); }
        }
        firstCommit = false;
      } while (dirty);
      return element;
    });
  }
  const api = {
    calls, props, render,
    get element() { return element; },
    get frames() { return frames; },
    setProps(next) { Object.assign(props, next); return render(); },
    find(predicate) { return walk(element, predicate); },
    markup() { return renderToStaticMarkup(element); },
    act(action) { atClock(action); return render(); },
    button(label) {
      const found = walk(element, node => node.type === 'button' && text(node).startsWith(label));
      assert.equal(found.length, 1, `Expected one button starting with ${label}, found ${found.length}`);
      return found[0];
    },
    click(label) { return api.act(() => api.button(label).props.onClick()); },
    input(label) {
      const direct = walk(element, node => node.type === 'input' && node.props['aria-label'] === label);
      if (direct.length) { assert.equal(direct.length, 1); return direct[0]; }
      const labels = walk(element, node => node.type === 'label' && text(node).startsWith(label));
      assert.equal(labels.length, 1, `Expected one label ${label}`);
      const inputs = walk(labels[0], node => node.type === 'input');
      assert.equal(inputs.length, 1); return inputs[0];
    },
    change(label, value) { return api.act(() => api.input(label).props.onChange({ target: { value }, currentTarget: { value } })); },
    titles() { return api.find(node => node.type === 'button' && hasClass(node, 'op-task')).map(node => text(walk(node, child => child.type === 'strong')[0])); },
    bars() { return api.find(node => node.type === 'button' && hasClass(node, 'op-bar')); },
    submit() {
      const forms = api.find(node => node.type === 'form');
      assert.equal(forms.length, 1);
      return api.act(() => forms[0].props.onSubmit({ preventDefault() {} }));
    },
    tick(nextNow) { clock = nextNow; return api.act(() => { for (const callback of timers.values()) callback(); }); },
    focus(nextNow) { clock = nextNow; return api.act(() => windowEvents.get('focus')?.()); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
  render();
  return api;
}

test('daily queue and timeline exclude older and undated tasks, with explicit review scopes', () => {
  const h = harness([task('today'), task('older', { date: yesterday }), task('unknown', { date: undefined }), task('invalid', { date: '2026-02-30' })]);
  assert.deepEqual(h.titles(), ['任务 today']);
  assert.deepEqual(h.bars().map(text), ['任务 today']);
  assert.doesNotMatch(h.markup(), /设备时间冲突/);
  h.click('往期未结束');
  assert.deepEqual(h.titles(), ['任务 older']);
  assert.equal(h.bars().length, 0);
  h.click('日期待核');
  assert.deepEqual(h.titles().sort(), ['任务 invalid', '任务 unknown']);
  assert.equal(h.bars().length, 0);
  assert.match(h.markup(), /日期未记录/);
  assert.doesNotMatch(h.markup(), /设备时间冲突/);
  h.dispose();
});

test('same-date device conflict is shown even when the other task has another kind', () => {
  const h = harness([task('cut'), task('inspect', { kind: '巡检', start: '08:30', end: '09:30' })]);
  assert.deepEqual(h.titles(), ['任务 cut']);
  assert.match(h.markup(), /设备时间冲突/);
  assert.match(h.markup(), /inspect 任务 inspect/);
  assert.ok(h.bars()[0].props.className.includes('conflict'));
  h.dispose();
});

test('incomplete time remains visible for review without inventing a timeline end', () => {
  const h = harness([task('unknown-end', { end: '待定' })]);
  assert.deepEqual(h.titles(), ['任务 unknown-end']);
  assert.equal(h.bars().length, 0);
  assert.match(h.markup(), /排程待核|时间待核/);
  assert.match(h.markup(), /结束时间未记录或无效/);
  h.dispose();
});

test('future dates are described as future work and site-specific kinds remain reachable', () => {
  const h = harness([task('debug', { site: 'xian', kind: '联调', date: tomorrow })], { site: 'xian' });
  h.change('作业日期', tomorrow);
  assert.match(h.markup(), /未来计划/);
  assert.doesNotMatch(h.markup(), /历史作业/);
  h.click('联调');
  assert.deepEqual(h.titles(), ['任务 debug']);
  h.dispose();
});

test('schedule changes persist the selected date and navigate to the moved task', () => {
  const h = harness([task('move')]);
  h.click('调整排程');
  h.change('排程日期', tomorrow);
  h.change('开始时间', '10:00');
  h.change('结束时间', '11:00');
  h.submit();
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.updates[0].date, tomorrow);
  assert.equal(h.calls.updates[0].start, '10:00');
  assert.equal(h.calls.updates[0].end, '11:00');
  assert.equal(h.input('作业日期').props.value, tomorrow);
  assert.deepEqual(h.titles(), ['任务 move']);
  assert.ok(h.calls.selected.includes('move'));
  h.dispose();
});

test('date input events update the visible day and persist rescheduling before a change event', () => {
  const h = harness([task('today'), task('move', { date: tomorrow })]);
  const enterDate = (label, value) => h.act(() => {
    const input = h.input(label);
    assert.equal(typeof input.props.onInput, 'function');
    input.props.onInput({ currentTarget: { value }, target: { value } });
  });
  enterDate('作业日期', tomorrow);
  assert.equal(h.input('作业日期').props.value, tomorrow);
  assert.deepEqual(h.titles(), ['任务 move']);
  h.click('调整排程');
  enterDate('排程日期', '2026-10-20');
  assert.equal(h.input('排程日期').props.value, '2026-10-20');
  h.submit();
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.updates[0].id, 'move');
  assert.equal(h.calls.updates[0].date, '2026-10-20');
  assert.equal(h.input('作业日期').props.value, '2026-10-20');
  assert.deepEqual(h.titles(), ['任务 move']);
  h.dispose();
});

test('a cross-kind collision on the new date prevents a schedule write', () => {
  const h = harness([task('move'), task('inspection', { kind: '巡检', date: tomorrow })]);
  h.click('调整排程');
  h.change('排程日期', tomorrow);
  h.submit();
  assert.equal(h.calls.updates.length, 0);
  assert.match(h.calls.notifications.at(-1), /inspection.*排程冲突/);
  assert.equal(h.input('作业日期').props.value, today);
  h.dispose();
});

test('undated same-device work stays explicitly uncertain while a known task can be rescheduled', () => {
  const h = harness([task('move'), task('unknown', { kind: '巡检', date: undefined })]);
  assert.doesNotMatch(h.markup(), /设备时间冲突/);
  assert.match(h.markup(), /待核/);
  h.click('调整排程');
  h.change('排程日期', tomorrow);
  h.submit();
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.updates[0].date, tomorrow);
  assert.match(h.markup(), /待核/);
  assert.match(h.markup(), /unknown/);
  assert.doesNotMatch(h.markup(), /设备时间冲突|无冲突|设备空闲/);
  h.dispose();
});

test('missing task dates are not silently filled from the current date in the schedule form', () => {
  const h = harness([task('undated', { date: undefined })]);
  h.click('日期待核');
  h.click('调整排程');
  assert.equal(h.input('排程日期').props.value, '');
  h.submit();
  assert.equal(h.calls.updates.length, 0);
  assert.match(h.calls.notifications.at(-1), /有效的排程日期/);
  h.change('排程日期', yesterday);
  h.submit();
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.updates[0].date, yesterday);
  assert.equal(h.input('作业日期').props.value, yesterday);
  assert.deepEqual(h.titles(), ['任务 undated']);
  h.dispose();
});

test('ordinary simulated starts also honor cross-kind device conflicts', () => {
  const h = harness([task('cut'), task('inspection', { kind: '巡检', start: '08:30', end: '09:30' })]);
  h.click('处理冲突后启动');
  assert.equal(h.calls.updates.length, 0);
  assert.equal(h.calls.starts.length, 0);
  assert.match(h.calls.notifications.at(-1), /inspection.*排程冲突/);
  h.dispose();
});

test('logistics receives the same explicit date scope and returns to the chosen upstream task', () => {
  const h = harness([task('today'), task('older', { date: yesterday }), task('unknown', { date: undefined }), task('elsewhere', { site: 'hainan' })]);
  h.click('储运联动');
  const panel = () => {
    const panels = h.find(node => node.type === LogisticsPanel);
    assert.equal(panels.length, 1); return panels[0];
  };
  assert.deepEqual(panel().props.tasks.map(value => value.id), ['today']);
  h.click('往期未结束');
  assert.deepEqual(panel().props.tasks.map(value => value.id), ['older']);
  h.click('日期待核');
  assert.deepEqual(panel().props.tasks.map(value => value.id), ['unknown']);
  h.act(() => panel().props.onTask(panel().props.tasks[0]));
  assert.deepEqual(h.titles(), ['任务 unknown']);
  assert.equal(h.calls.selected.at(-1), 'unknown');
  assert.match(h.markup(), /日期未记录/);
  h.dispose();
});

test('timeline selection clears search and opens the selected task despite a previous filter', () => {
  const h = harness([task('first'), task('second', { start: '10:00', end: '11:00' })]);
  const search = h.find(node => node.type === 'input' && node.props.placeholder === '搜索任务、区域或设备')[0];
  h.act(() => search.props.onChange({ target: { value: '没有匹配项' } }));
  assert.deepEqual(h.titles(), []);
  const second = h.bars().find(node => text(node) === '任务 second');
  assert.ok(second);
  h.act(() => second.props.onClick());
  assert.equal(h.find(node => node.type === 'input' && node.props.placeholder === '搜索任务、区域或设备')[0].props.value, '');
  assert.equal(h.calls.selected.at(-1), 'second');
  assert.match(text(h.find(node => node.type === 'h2')[0]), /任务 second/);
  h.dispose();
});

test('Hainan rail dispatch remains delegated to the scheduler without a synthetic progress update', () => {
  const planned = task('planned', { site: 'hainan', robot: '待分配设备' });
  const h = harness([planned], { site: 'hainan' });
  h.click('开始机器人作业');
  assert.equal(h.calls.starts.length, 1);
  assert.equal(h.calls.starts[0].id, 'planned');
  assert.equal(h.calls.updates.length, 0);
  h.dispose();
});

test('existing rail tasks retain their controls instead of exposing local schedule edits', () => {
  const job = { id: 'rail-current', attemptId: 'current', planVersion: 'v1', angle: 28, requestedAt: new Date(now).toISOString() };
  const liveFleet = {ready: true, error: null, jobs: {0: job}, zones: [{zone: 0, active: 0, queue: [], paused: false}]};
  const h = harness([task('rail-current', { site: 'hainan', count: 1, treeIndices: [0], railJob: job })], { site: 'hainan', fleet: liveFleet });
  assert.equal(h.find(node => node.type === ZoneTaskControls).length, 1);
  assert.deepEqual(h.find(node => node.type === ZoneTaskControls)[0].props.expectedJob, job);
  assert.equal(h.find(node => node.type === 'button' && text(node).startsWith('调整排程')).length, 0);
  assert.equal(h.calls.updates.length, 0);
  h.dispose();
});

test('today view follows Shanghai midnight while a manually selected date stays fixed', () => {
  const h = harness([task('today'), task('tomorrow', { date: tomorrow })]);
  h.tick(Date.parse('2026-10-18T16:00:01Z'));
  assert.equal(h.input('作业日期').props.value, tomorrow);
  assert.deepEqual(h.titles(), ['任务 tomorrow']);
  h.change('作业日期', yesterday);
  h.focus(Date.parse('2026-10-19T16:00:01Z'));
  assert.equal(h.input('作业日期').props.value, yesterday);
  h.click('回到今天');
  assert.equal(h.input('作业日期').props.value, '2026-10-20');
  h.dispose();
});


test('task details hide controls for historical and other-park records even when the live job matches', () => {
  const job = {id: 'rail-scoped', attemptId: 'scoped', planVersion: 'v1', angle: 28, requestedAt: new Date(now).toISOString()};
  const liveFleet = {ready: true, error: null, jobs: {0: job}, zones: [{zone: 0, active: 0, queue: [], paused: false}]};
  for (const patch of [{site: 'xsbn'}, {status: '已完成', done: 1}, {status: '已取消'}]) {
    const original = task('rail-scoped', {site: 'hainan', status: '待处理', count: 1, treeIndices: [0], railJob: job, ...patch});
    const h = harness([original], {site: original.site, fleet: liveFleet});
    if (['已完成', '已取消'].includes(original.status)) h.click('已结束');
    assert.equal(h.find(node => node.type === ZoneTaskControls).length, 0);
    assert.equal(h.find(node => node.type === 'button' && text(node).startsWith('重新安排')).length, 0);
    h.dispose();
  }
});

test('task details distinguish a replaced attempt from a free target before offering recovery', () => {
  const job = {id: 'rail-recovery', attemptId: 'saved', planVersion: 'v1', angle: 28, requestedAt: new Date(now).toISOString()};
  const original = task('rail-recovery', {site: 'hainan', status: '待处理', count: 1, treeIndices: [0], railJob: job});
  const occupied = {ready: true, error: null, jobs: {0: {...job, attemptId: 'replacement'}}, zones: [{zone: 0, active: 0, queue: [], paused: false}]};
  const h = harness([original], {site: 'hainan', fleet: occupied});
  assert.equal(h.find(node => node.type === ZoneTaskControls).length, 0);
  assert.equal(h.find(node => node.type === 'button' && text(node).startsWith('重新安排')).length, 0);
  assert.match(text(h.element), /树位已有其它执行/);h.dispose();
  const free = harness([original], {site: 'hainan', fleet: {...occupied, jobs: {}, zones: [{zone: 0, active: null, queue: [], paused: false}]}});
  free.click('重新安排此任务');assert.equal(free.calls.retries[0].id, original.id);free.dispose();
});

test('batch task details control the active remaining tree and exclude a tree with a receipt', () => {
  const job = index => ({id: 'batch-' + index, attemptId: 'attempt-' + index, planVersion: 'v1', angle: 28, requestedAt: new Date(now).toISOString()});
  const jobs = {0: job(0), 1: job(1), 2: job(2)};
  const original = task('batch-plan', {site: 'hainan', status: '执行中', done: 1, railBatch: {baseDone: 0, jobs, results: {0: {index: 0, job: jobs[0], outcome: 'completed', finishedAt: new Date(now).toISOString()}}}});
  const liveFleet = {ready: true, error: null, jobs, zones: [{zone: 0, active: 2, queue: [0, 1], paused: false}]};
  const h = harness([original], {site: 'hainan', fleet: liveFleet});
  const controls = h.find(node => node.type === ZoneTaskControls);
  assert.equal(controls.length, 1);assert.equal(controls[0].props.index, 2);assert.deepEqual(controls[0].props.expectedJob, jobs[2]);
  assert.equal(h.find(node => node.type === 'button' && text(node).startsWith('重新安排')).length, 0);h.dispose();
});


const request = (id, site = 'xsbn', sequence = 1) => ({id, site, sequence});
const detailTitle = h => h.find(node => node.type === 'h2').map(text);
const selectedTitles = h => h.find(node => node.type === 'button' && hasClass(node, 'op-task') && node.props['aria-pressed']).map(node => text(walk(node, child => child.type === 'strong')[0]));
const searchInput = h => h.find(node => node.type === 'input' && node.props.placeholder === '搜索任务、区域或设备')[0];

for (const [label, overrides, expectedScope] of [
  ['completed past', {date: yesterday, status: '已完成', done: 3}, '当日计划'],
  ['cancelled past', {date: yesterday, status: '已取消'}, '当日计划'],
  ['future inspection', {date: tomorrow, kind: '巡检'}, '当日计划'],
  ['missing date', {date: undefined}, '日期待核'],
  ['invalid date', {date: '2026-02-30'}, '日期待核'],
  ['nonstandard kind', {kind: '联调'}, '当日计划'],
]) test(`external request precisely opens ${label} without showing the fallback first`, () => {
  const target = task('target', overrides);
  const h = harness([task('fallback'), target], {selectedTaskId: 'target', openRequest: request('target')});
  assert.equal(walk(h.frames[0], node => node.type === 'h2').length, 0);
  assert.match(text(h.frames[0]), /正在定位目标任务/);
  assert.deepEqual(detailTitle(h), ['任务 target']);
  assert.deepEqual(selectedTitles(h), ['任务 target']);
  assert.equal(h.button(expectedScope).props['aria-pressed'], true);
  assert.equal(h.button(operationsModel.isClosed(target) ? '已结束' : '未完成').props['aria-pressed'], true);
  assert.equal(h.button(target.kind).props['aria-pressed'], true);
  if (operationsModel.taskDate(target)) assert.equal(h.input('作业日期').props.value, target.date);
  assert.equal(h.calls.updates.length, 0);
  h.dispose();
});

test('external request leaves logistics and clears a previous unmatched search', () => {
  const tasks = [task('first'), task('target', {date: yesterday, status: '已完成', done: 3})];
  const h = harness(tasks);
  h.act(() => searchInput(h).props.onChange({target: {value: '无匹配搜索'}}));
  h.click('储运联动');
  assert.equal(h.find(node => node.type === LogisticsPanel).length, 1);
  h.setProps({selectedTaskId: 'target', openRequest: request('target')});
  assert.equal(h.find(node => node.type === LogisticsPanel).length, 0);
  assert.equal(searchInput(h).props.value, '');
  assert.deepEqual(detailTitle(h), ['任务 target']);
  assert.equal(h.calls.updates.length, 0);
  h.dispose();
});

test('external request closes the previous task schedule, records and tree dialog', () => {
  const h = harness([task('first'), task('target')]);
  h.click('调整排程'); h.click('执行记录'); h.click('树木清单');
  assert.equal(h.find(node => node.type === 'form').length, 1);
  assert.equal(h.find(node => hasClass(node, 'op-records')).length, 1);
  assert.equal(h.find(node => hasClass(node, 'op-modal-host')).length, 1);
  h.setProps({selectedTaskId: 'target', openRequest: request('target')});
  assert.deepEqual(detailTitle(h), ['任务 target']);
  assert.equal(h.find(node => node.type === 'form').length, 0);
  assert.equal(h.find(node => hasClass(node, 'op-records')).length, 0);
  assert.equal(h.find(node => hasClass(node, 'op-modal-host')).length, 0);
  h.dispose();
});

test('cross-site external request wins over site defaults and ignores same id elsewhere', () => {
  const target = task('shared', {site: 'xian', date: yesterday, kind: '联调', status: '已取消'});
  const h = harness([task('shared', {title: '其他园区同号任务'}), target]);
  h.setProps({site: 'xian', selectedTaskId: 'shared', openRequest: request('shared', 'xian')});
  assert.equal(walk(h.frames[0], node => node.type === 'h2').length, 0);
  assert.deepEqual(detailTitle(h), ['任务 shared']);
  assert.equal(h.input('作业日期').props.value, yesterday);
  assert.equal(h.button('已结束').props['aria-pressed'], true);
  assert.equal(h.button('联调').props['aria-pressed'], true);
  assert.deepEqual(selectedTitles(h), ['任务 shared']);
  h.dispose();
});

test('request waits for the intended site without consuming it against another park', () => {
  const h = harness([task('same'), task('same', {site: 'xian', title: '西安目标', kind: '联调', date: tomorrow})], {openRequest: request('same', 'xian')});
  assert.deepEqual(detailTitle(h), []);
  assert.match(h.markup(), /正在切换园区并定位目标任务/);
  assert.equal(h.calls.selected.length, 0);
  h.setProps({site: 'xian'});
  assert.deepEqual(detailTitle(h), ['西安目标']);
  assert.equal(h.input('作业日期').props.value, tomorrow);
  assert.equal(h.calls.selected.at(-1), 'same');
  h.dispose();
});

test('same request is consumed once and synchronized task arrays do not restore manual filters', () => {
  const tasks = [task('today'), task('target', {date: yesterday, status: '已完成', done: 3})];
  const h = harness(tasks, {openRequest: request('target')});
  h.change('作业日期', today); h.click('未完成');
  h.setProps({tasks: structuredClone(tasks), openRequest: {...request('target')}});
  assert.equal(h.input('作业日期').props.value, today);
  assert.equal(h.button('未完成').props['aria-pressed'], true);
  assert.deepEqual(detailTitle(h), ['任务 today']);
  assert.equal(h.calls.selected.filter(id => id === 'target').length, 1);
  h.dispose();
});

test('a new sequence reopens the same id after manual changes', () => {
  const h = harness([task('today'), task('target', {date: yesterday, status: '已完成', done: 3})], {openRequest: request('target')});
  h.change('作业日期', today); h.click('未完成'); h.click('储运联动');
  h.setProps({selectedTaskId: 'target', openRequest: request('target', 'xsbn', 2)});
  assert.deepEqual(detailTitle(h), ['任务 target']);
  assert.equal(h.input('作业日期').props.value, yesterday);
  assert.equal(h.calls.selected.filter(id => id === 'target').length, 2);
  h.dispose();
});

for (const [label, targets, message] of [
  ['missing', [], /已找不到目标任务/],
  ['only in another park', [task('target', {site: 'hainan'})], /已找不到目标任务/],
  ['duplicate', [task('target'), task('target', {title: '重复目标'})], /多个同编号任务/],
]) test(`external ${label} target shows a precise empty detail instead of another task`, () => {
  const h = harness([task('fallback'), ...targets], {selectedTaskId: 'target', openRequest: request('target')});
  assert.deepEqual(detailTitle(h), []);
  assert.deepEqual(selectedTitles(h), []);
  assert.match(h.markup(), message);
  assert.equal(h.find(node => node.type === 'button' && text(node).startsWith('模拟启动')).length, 0);
  assert.equal(h.calls.updates.length, 0);
  assert.equal(h.calls.selected.length, 0);
  h.act(() => h.find(node => node.type === 'button' && hasClass(node, 'op-task') && text(node).startsWith('任务 fallback'))[0].props.onClick());
  assert.deepEqual(detailTitle(h), ['任务 fallback']);
  h.dispose();
});

for (const [label, change, message] of [
  ['removed', () => [], /已找不到目标任务/],
  ['moved to another park', target => [{...target, site: 'hainan'}], /已找不到目标任务/],
  ['duplicated', target => [target, {...target, title: '重复目标'}], /多个同编号任务/],
  ['date changed', target => [{...target, date: tomorrow}], /日期、类型或状态已变化/],
  ['kind changed', target => [{...target, kind: '巡检'}], /日期、类型或状态已变化/],
]) test(`focused target ${label} during synchronization never falls back to a different task`, () => {
  const target = task('target');
  const h = harness([task('fallback'), target], {openRequest: request('target')});
  h.setProps({tasks: [task('fallback'), ...change(target)]});
  assert.deepEqual(detailTitle(h), []);
  assert.deepEqual(selectedTitles(h), []);
  assert.match(h.markup(), message);
  assert.equal(h.calls.updates.length, 0);
  h.act(() => h.find(node => node.type === 'button' && hasClass(node, 'op-task') && text(node).startsWith('任务 fallback'))[0].props.onClick());
  assert.deepEqual(detailTitle(h), ['任务 fallback']);
  h.dispose();
});

test('focused target content refresh remains selected without resetting open records', () => {
  const target = task('target');
  const h = harness([task('fallback'), target], {openRequest: request('target')});
  h.click('执行记录');
  h.setProps({tasks: [task('fallback'), {...target, title: '同步后的目标名称', status: '执行中', done: 1}]});
  assert.deepEqual(detailTitle(h), ['同步后的目标名称']);
  assert.equal(h.find(node => hasClass(node, 'op-records')).length, 1);
  assert.equal(h.calls.selected.length, 1);
  h.dispose();
});

test('target beyond the first page is visible and selected without rendering the whole queue', () => {
  const tasks = Array.from({length: 70}, (_, index) => task(`task-${index}`));
  const h = harness(tasks, {selectedTaskId: 'task-65', openRequest: request('task-65')});
  assert.deepEqual(detailTitle(h), ['任务 task-65']);
  assert.deepEqual(selectedTitles(h), ['任务 task-65']);
  assert.equal(h.titles()[0], '任务 task-65');
  assert.equal(h.titles().length, 31);
  assert.ok(h.button('加载更多任务'));
  h.dispose();
});

test('manual site changes leave an already consumed focus and retain normal site defaults', () => {
  const h = harness([task('target', {date: yesterday}), task('xian', {site: 'xian', kind: '联调', date: yesterday})], {openRequest: request('target')});
  h.setProps({site: 'xian', selectedTaskId: 'xian'});
  assert.deepEqual(detailTitle(h), ['任务 xian']);
  assert.equal(h.button('联调').props['aria-pressed'], true);
  assert.doesNotMatch(h.markup(), /正在切换园区|已找不到目标任务/);
  h.dispose();
});

test('externally opened date remains fixed through Shanghai midnight', () => {
  const h = harness([task('target'), task('tomorrow', {date: tomorrow})], {openRequest: request('target')});
  h.tick(Date.parse('2026-10-18T16:00:01Z'));
  assert.equal(h.input('作业日期').props.value, today);
  assert.deepEqual(detailTitle(h), ['任务 target']);
  h.dispose();
});


test('development effect replay does not overwrite or consume an external request twice', () => {
  const h = harness([task('fallback'), task('target', {date: yesterday, kind: '巡检', status: '已完成', done: 3})], {openRequest: request('target'), strictEffects: true});
  assert.deepEqual(detailTitle(h), ['任务 target']);
  assert.equal(h.input('作业日期').props.value, yesterday);
  assert.equal(h.button('巡检').props['aria-pressed'], true);
  assert.equal(h.button('已结束').props['aria-pressed'], true);
  assert.deepEqual(h.calls.selected, ['target']);
  h.click('回到今天'); h.click('割胶'); h.click('未完成');
  assert.deepEqual(detailTitle(h), ['任务 fallback']);
  h.tick(Date.parse('2026-10-18T16:00:01Z'));
  assert.equal(h.input('作业日期').props.value, tomorrow);
  h.dispose();
});

test('manual search exits external focus and survives a task synchronization refresh', () => {
  const tasks = [task('fallback'), task('target')];
  const h = harness(tasks, {openRequest: request('target')});
  h.act(() => searchInput(h).props.onChange({target: {value: 'fallback'}}));
  h.setProps({tasks: structuredClone(tasks)});
  assert.deepEqual(detailTitle(h), ['任务 fallback']);
  assert.equal(searchInput(h).props.value, 'fallback');
  assert.equal(h.calls.selected.length, 1);
  h.dispose();
});

test('manual logistics view stays open after a consumed request and task refresh', () => {
  const tasks = [task('target')];
  const h = harness(tasks, {openRequest: request('target')});
  h.click('储运联动');
  h.setProps({tasks: structuredClone(tasks)});
  assert.equal(h.find(node => node.type === LogisticsPanel).length, 1);
  assert.deepEqual(detailTitle(h), []);
  assert.equal(h.calls.selected.length, 1);
  h.dispose();
});

test('the event entry receives shared tasks from every date instead of the selected daily queue', () => {
  const tasks = [task('today'), task('past', {date: yesterday}), task('future', {date: tomorrow}), task('undated', {date: undefined}), task('finished', {date: yesterday, status: '已完成', done: 3})];
  const events = [{id: 'rain', siteId: 'demo-xsbn', kind: 'rain', zone: null, status: 'active', note: '降雨影响'}];
  const batches = [{id: 'batch-finished', siteId: 'demo-xsbn', stage: 'received', source: {taskId: 'finished'}}];
  const h = harness(tasks, {events, batches});
  assert.deepEqual(h.titles(), ['任务 today']);
  h.click('天气与设备联动');
  const panel = h.find(node => node.type === OperationalEventsPanel)[0];
  assert.equal(panel.props.tasks, h.props.tasks);
  assert.deepEqual(panel.props.tasks.map(value => value.id), tasks.map(value => value.id));
  assert.equal(panel.props.events, events);
  assert.equal(panel.props.batches, batches);
  assert.equal(panel.props.onCreate, h.props.onCreateEvent);
  assert.equal(panel.props.onResolve, h.props.onResolveEvent);
  assert.equal(panel.props.onResume, h.props.onResumeEvent);
  assert.equal(h.find(node => node.props['aria-label'] === '任务日期范围').length, 0);
  assert.equal(h.calls.updates.length, 0);
  h.dispose();
});

for (const [label, patch, expectedDay, expectedScope, ended] of [
  ['past unfinished', {date: yesterday}, yesterday, '当日计划', false],
  ['future', {date: tomorrow}, tomorrow, '当日计划', false],
  ['undated', {date: undefined}, today, '日期待核', false],
  ['invalid date', {date: '2026-02-30'}, today, '日期待核', false],
  ['completed past', {date: yesterday, status: '已完成', done: 3}, yesterday, '当日计划', true],
]) test(`event task navigation opens the ${label} original record without using the current date fallback`, () => {
  const h = harness([task('today'), task('affected', patch)]);
  h.click('天气与设备联动');
  const panel = h.find(node => node.type === OperationalEventsPanel)[0];
  const original = panel.props.tasks.find(value => value.id === 'affected');
  h.act(() => panel.props.onTask(original));
  assert.equal(h.find(node => node.type === OperationalEventsPanel).length, 0);
  assert.deepEqual(detailTitle(h), ['任务 affected']);
  assert.deepEqual(selectedTitles(h), ['任务 affected']);
  assert.equal(h.input('作业日期').props.value, expectedDay);
  assert.equal(h.button(expectedScope).props['aria-pressed'], true);
  assert.equal(h.button(ended ? '已结束' : '未完成').props['aria-pressed'], true);
  assert.equal(h.calls.updates.length, 0);
  h.dispose();
});

test('a robot event-view request opens once and permits normal task navigation after synchronization', () => {
  const h = harness([task('target', {date: yesterday})], {eventViewRequest: 4});
  assert.equal(h.find(node => node.type === OperationalEventsPanel).length, 1);
  const panel = h.find(node => node.type === OperationalEventsPanel)[0];
  h.act(() => panel.props.onTask(h.props.tasks[0]));
  h.setProps({tasks: structuredClone(h.props.tasks)});
  assert.deepEqual(detailTitle(h), ['任务 target']);
  assert.equal(h.find(node => node.type === OperationalEventsPanel).length, 0);
  h.setProps({eventViewRequest: 5});
  assert.equal(h.find(node => node.type === OperationalEventsPanel).length, 1);
  h.dispose();
});

test('task lifecycle and logistics receive the same current events and confirmed rain prevents local simulated work', () => {
  const events = [{id: 'rain', siteId: 'demo-xsbn', kind: 'rain', zone: null, status: 'resolved', note: '降雨解除后尚待恢复确认'}];
  const h = harness([task('target')], {events});
  assert.equal(h.find(node => node.type === TaskLifecycle)[0].props.events, events);
  h.click('模拟启动');
  assert.equal(h.calls.updates.length, 0);
  assert.match(h.calls.notifications.at(-1), /待确认恢复/);
  h.click('储运联动');
  assert.equal(h.find(node => node.type === LogisticsPanel)[0].props.events, events);
  h.dispose();
});

test('logistics keeps all current-park source tasks available outside the selected date scope',()=>{
 const old=task('old-complete',{date:yesterday,status:'已完成',done:3});
 const batches=[{id:'business-batch',siteId:'demo-xsbn',source:{taskId:old.id}}];
 const create=async()=>{},action=async()=>{};
 const h=harness([task('today'),old,task('foreign',{site:'hainan'})],{batches,onCreateBatch:create,onBatchAction:action});
 h.click('储运联动');const panel=h.find(node=>node.type===LogisticsPanel)[0];
 assert.deepEqual(panel.props.tasks.map(task=>task.id),['today']);
 assert.deepEqual(panel.props.allTasks.map(task=>task.id),['today','old-complete']);
 assert.equal(panel.props.batches,batches);assert.equal(panel.props.onCreateBatch,create);assert.equal(panel.props.onBatchAction,action);
 h.act(()=>panel.props.onTask(panel.props.allTasks[1]));
 assert.deepEqual(h.titles(),['任务 old-complete']);assert.equal(h.calls.selected.at(-1),old.id);
 assert.match(h.markup(),new RegExp(yesterday));h.dispose();
});

test('sales navigation includes future shipments and keeps source and execution callbacks connected',()=>{
 const shipments=[{id:'future-shipment',siteId:'demo-xsbn',plannedDepartureAt:`${tomorrow}T01:00:00Z`,plannedKg:20,status:'planned'}];
 const salesInventory={siteId:'demo-xsbn',stockKg:780,availableKg:380,soldKg:20,inTransitKg:0};
 const h=harness([task('today')],{shipments,salesInventory,shipmentOpenRequest:{site:'xsbn',id:'future-shipment',sequence:1}});
 const panel=h.find(node=>node.type===SalesShipmentPanel)[0];
 assert.equal(h.button('销售出货').props['aria-pressed'],true);
 assert.equal(panel.props.shipments,shipments);
 assert.equal(panel.props.inventory,salesInventory);
 assert.equal(panel.props.selectedId,'future-shipment');
 assert.equal(panel.props.onAdvance,h.props.onAdvanceShipment);
 assert.equal(panel.props.onSource,h.props.onShipmentSource);
 assert.equal(h.find(node=>node.props['aria-label']==='任务日期范围').length,0);
 assert.equal(h.find(node=>node.props['aria-label']==='任务概览').length,0);
 h.click('作业任务');
 h.setProps({tasks:structuredClone(h.props.tasks)});
 assert.equal(h.find(node=>node.type===SalesShipmentPanel).length,0);
 h.setProps({shipmentOpenRequest:{site:'xsbn',id:'future-shipment',sequence:2}});
 assert.equal(h.find(node=>node.type===SalesShipmentPanel).length,1);
 assert.equal(h.calls.updates.length,0);
 h.dispose();
});

test('processing navigation opens the original batch and ordinary task refresh does not reopen it',()=>{
 const request={site:'xsbn',id:'processed-batch',sequence:1};
 const h=harness([task('today')],{batchOpenRequest:request});
 assert.equal(h.button('储运联动').props['aria-pressed'],true);
 assert.equal(h.find(node=>node.type===LogisticsPanel)[0].props.openRequest,request);
 h.click('作业任务');
 h.setProps({tasks:structuredClone(h.props.tasks)});
 assert.equal(h.find(node=>node.type===LogisticsPanel).length,0);
 h.setProps({batchOpenRequest:{...request,sequence:2}});
 assert.equal(h.find(node=>node.type===LogisticsPanel).length,1);
 assert.equal(h.calls.updates.length,0);
 h.dispose();
});


const demoDispatch = {phase:'running',requestId:'inline-flow',history:[{time:'2026-10-18T01:00:00Z',label:'开始'}],auto:{stage:'work',startedAt:now,nextAt:now+500}};

test('task center embeds execution controls and keeps a completed task selected for its returned result',()=>{
 const original=task('inline-flow',{dispatch:demoDispatch,status:'执行中'});
 const h=harness([original,task('other',{robot:'Other robot'})],{openRequest:request(original.id)});
 const monitor=h.find(node=>node.type===TaskMonitor)[0];
 assert.equal(monitor.props.embedded,true);
 assert.equal(monitor.props.task.id,original.id);
 assert.equal(monitor.props.executionIssue,null);
 assert.deepEqual(h.calls.flows,[]);
 h.setProps({tasks:[{...original,status:'已完成',done:3,dispatch:{...demoDispatch,phase:'completed'}},task('other',{robot:'Other robot'})]});
 assert.deepEqual(detailTitle(h),['任务 inline-flow']);
 assert.equal(h.find(node=>node.type===TaskMonitor)[0].props.task.status,'已完成');
 assert.equal(h.find(node=>node.type==='button'&&text(node)==='已结束')[0].props['aria-pressed'],true);
 assert.deepEqual(h.calls.flows,[]);
 h.dispose();
});

test('an inline result from carried-over work returns to its original date without selecting another task',()=>{
 const original=task('carry-flow',{date:yesterday,dispatch:demoDispatch,status:'执行中'});
 const h=harness([original]);h.click('往期未结束1');
 assert.equal(h.find(node=>node.type===TaskMonitor)[0].props.task.id,original.id);
 h.setProps({tasks:[{...original,status:'已完成',done:3,dispatch:{...demoDispatch,phase:'completed'}}]});
 assert.deepEqual(detailTitle(h),['任务 carry-flow']);
 assert.equal(h.find(node=>node.props['aria-label']==='作业日期')[0].props.value,yesterday);
 h.dispose();
});

test('a new external task request leaves the prior inline result and opens the requested active task',()=>{
 const original=task('first-flow',{dispatch:demoDispatch,status:'执行中'});
 const next=task('next-flow',{date:tomorrow,dispatch:{...demoDispatch,phase:'scheduled',auto:undefined},robot:'Other robot'});
 const h=harness([original,next],{openRequest:request(original.id)});
 h.setProps({tasks:[{...original,status:'已完成',done:3,dispatch:{...demoDispatch,phase:'completed'}},next]});
 assert.equal(h.find(node=>node.type===TaskMonitor)[0].props.task.id,original.id);
 h.setProps({openRequest:{...request(next.id),sequence:2}});
 assert.deepEqual(detailTitle(h),['任务 next-flow']);
 assert.equal(h.find(node=>node.type===TaskMonitor)[0].props.task.id,next.id);
 assert.equal(h.button('未完成').props['aria-pressed'],true);
 assert.equal(h.input('作业日期').props.value,tomorrow);
 h.dispose();
});

test('inline execution accepts future simulation dates and exposes invalid scheduling, missing device and conflicts',()=>{
 const dispatch={...demoDispatch,phase:'scheduled',auto:undefined};
 const future=task('future-flow',{date:tomorrow,dispatch});
 const page=harness([future],{openRequest:request(future.id)});
 assert.equal(page.find(node=>node.type===TaskMonitor)[0].props.executionIssue,null);
 page.dispose();
 for(const patch of [{date:'bad-date'},{start:'invalid'},{robot:''}]){
  const original=task('invalid-flow',{dispatch,...patch});
  const h=harness([original],{openRequest:request(original.id)});
  assert.ok(h.find(node=>node.type===TaskMonitor)[0].props.executionIssue);
  h.dispose();
 }
 const original=task('conflict-flow',{dispatch});
 const h=harness([original,task('occupied',{kind:'巡检'})],{openRequest:request(original.id)});
 assert.match(h.find(node=>node.type===TaskMonitor)[0].props.executionIssue,/设备时间冲突/);
 h.dispose();
});

test('an explicitly opened Hainan plan keeps its detail when rail batch receipts finish the task',()=>{
 const original=task('hainan-plan',{site:'hainan',date:tomorrow,sourceParkPlanId:'plan-1'});
 const other=task('other',{site:'hainan',date:tomorrow,robot:'Other robot'});
 const h=harness([original,other],{site:'hainan',openRequest:request(original.id,'hainan')});
 h.click('开始机器人作业');
 assert.equal(h.calls.starts[0].id,original.id);
 const running={...original,status:'执行中',railBatch:{baseDone:0,jobs:{},results:{}}};
 h.setProps({tasks:[running,other]});
 const completed={...running,status:'已完成',done:3,railBatch:{...running.railBatch,results:{0:{index:0,outcome:'completed',finishedAt:new Date(now).toISOString()}}}};
 h.setProps({tasks:[completed,other]});
 assert.deepEqual(detailTitle(h),['任务 hainan-plan']);
 assert.equal(h.button('已结束').props['aria-pressed'],true);
 assert.equal(h.find(node=>node.type===TaskLifecycle)[0].props.task,completed);
 assert.equal(h.input('作业日期').props.value,tomorrow);
 assert.equal(h.calls.updates.length,0);
 h.dispose();
});

test('manually choosing unfinished work releases completion following even after a background refresh',()=>{
 const original=task('tracked',{site:'hainan',status:'执行中',railBatch:{baseDone:0,jobs:{},results:{}}});
 const other=task('other',{site:'hainan',robot:'Other robot'});
 const h=harness([original,other],{site:'hainan',openRequest:request(original.id,'hainan')});
 h.click('未完成');
 h.setProps({tasks:structuredClone([original,other])});
 h.setProps({tasks:[{...original,status:'已完成',done:3},other]});
 assert.equal(h.button('未完成').props['aria-pressed'],true);
 assert.deepEqual(detailTitle(h),['任务 other']);
 h.dispose();
});

for(const [phase,auto] of [['waiting',undefined],['scheduled',undefined],['paused',demoDispatch.auto],['failed',demoDispatch.auto],['review',demoDispatch.auto],['recapturing',undefined]]){
 test(`a ${phase} dispatch can repair its date and time while preserving execution state and conflict checks`,()=>{
  const incident=['review','recapturing'].includes(phase)?{treeIndex:0,detectedAt:new Date(now).toISOString(),lastCaptureAt:new Date(now).toISOString(),status:phase,category:'结构隆起',captures:1}:undefined;
  const original=task('repair',{date:undefined,start:'bad',end:'',status:['waiting','scheduled'].includes(phase)?'待开始':'待处理',dispatch:{...demoDispatch,phase,auto,incident}});
  const collision=task('occupied',{date:tomorrow,kind:'巡检'});
  const h=harness([original,collision],{openRequest:request(original.id)});
  assert.ok(h.find(node=>node.type===TaskMonitor)[0].props.executionIssue);
  h.click('调整排程');h.submit();
  assert.equal(h.calls.updates.length,0);
  h.change('排程日期',tomorrow);h.change('开始时间','08:00');h.change('结束时间','09:00');h.submit();
  assert.equal(h.calls.updates.length,0);
  assert.match(h.calls.notifications.at(-1),/排程冲突/);
  h.change('开始时间','10:00');h.change('结束时间','11:00');h.submit();
  assert.equal(h.calls.updates.length,1);
  const updated=h.calls.updates[0];
  assert.equal(updated.date,tomorrow);
  assert.deepEqual(updated.dispatch,original.dispatch);
  assert.equal(updated.done,original.done);
  const monitor=h.find(node=>node.type===TaskMonitor)[0];
  assert.equal(monitor.props.executionIssue,null);
  assert.match(monitor.props.sessionNotes[0],/模拟排程调整/);
  h.dispose();
 });
}

test('a paused schedule form cannot overwrite a task that has resumed in the meantime',()=>{
 const original=task('paused-form',{status:'待处理',dispatch:{...demoDispatch,phase:'paused'}});
 const h=harness([original],{openRequest:request(original.id)});
 h.click('调整排程');h.change('开始时间','10:00');h.change('结束时间','11:00');
 const submit=h.find(node=>node.type==='form')[0].props.onSubmit;
 const running={...original,status:'执行中',dispatch:{...demoDispatch,phase:'running'}};
 h.setProps({tasks:[running]});
 assert.equal(h.find(node=>node.type==='form').length,0);
 assert.equal(h.find(node=>node.type==='button'&&text(node)==='调整排程').length,0);
 h.act(()=>submit({preventDefault(){}}));
 assert.equal(h.calls.updates.length,0);
 assert.match(h.calls.notifications.at(-1),/任务已变化/);
 h.dispose();
});

test('dispatch records and trees use the embedded monitor with an optional scene callback',()=>{
 const original=task('one-monitor',{status:'执行中',dispatch:demoDispatch});
 const h=harness([original]);
 assert.equal(h.find(node=>node.type==='button'&&['执行记录','树木清单'].includes(text(node))).length,0);
 const monitor=h.find(node=>node.type===TaskMonitor)[0];
 assert.deepEqual(h.calls.flows,[]);
 h.act(()=>monitor.props.onOpenScene());
 assert.equal(h.calls.flows[0].id,original.id);
 h.dispose();
});

test('a saved Hainan preflight failure can be rechecked through the normal batch dispatch callback',()=>{
 const original=task('hainan-blocked',{site:'hainan',status:'待处理',sourceParkPlanId:'plan-1'});
 const h=harness([original],{site:'hainan',openRequest:request(original.id,'hainan')});
 assert.equal(h.button('重新核验并执行').props.disabled,false);
 h.click('重新核验并执行');
 assert.equal(h.calls.starts.length,1);
 assert.deepEqual(h.calls.starts[0],original);
 assert.deepEqual(h.calls.updates,[],'the page must not mark a blocked task running or erase its state');
 h.dispose();
});

test('retry stays unavailable for unrelated work and closed Hainan tasks',()=>{
 for(const patch of [{site:'xsbn'},{site:'hainan',kind:'巡检'}]){
  const original=task('unrelated',{status:'待处理',...patch});
  const h=harness([original],{site:original.site,openRequest:request(original.id,original.site)});
  assert.equal(h.find(node=>node.type==='button'&&text(node)==='重新核验并执行').length,0);
  assert.equal(h.button('待调整').props.disabled,true);
  h.dispose();
 }
 for(const status of ['已完成','已取消']){
  const original=task('closed-hainan',{site:'hainan',status,done:status==='已完成'?3:0});
  const h=harness([original],{site:'hainan',openRequest:request(original.id,'hainan')});
  assert.equal(h.find(node=>node.type==='button'&&['重新核验并执行','开始机器人作业'].includes(text(node))).length,0);
  h.dispose();
 }
});

test('preflight retry still respects active operational holds',()=>{
 const original=task('blocked-by-event',{site:'hainan',status:'待处理'});
 const h=harness([original],{site:'hainan',events:[{id:'rain',siteId:'demo-hainan',kind:'rain',zone:0,status:'open',note:'降雨未解除',affectedTaskIds:[original.id]}]});
 h.click('重新核验并执行');
 assert.equal(h.calls.starts.length,0);
 assert.equal(h.calls.updates.length,0);
 assert.ok(h.calls.notifications.length>0);
 h.dispose();
});

test('execution records show saved preflight history after opening the task again',()=>{
 const checks=[
  {time:'2026-10-18T01:40:00.000Z',outcome:'blocked',message:'HN-A-0004 存在树表标记，请复核'},
  {time:'2026-10-18T01:50:00.000Z',outcome:'passed',message:'派发核验通过，已安排本区机器人执行'},
 ];
 const original=task('saved-checks',{site:'hainan',status:'执行中',railDispatchChecks:checks});
 const h=harness([structuredClone(original)],{site:'hainan'});
 h.click('执行记录');
 const records=text(h.find(node=>node.type==='div'&&hasClass(node,'op-records'))[0]);
 assert.match(records,/派发核验未通过.*HN-A-0004/);
 assert.match(records,/派发核验通过/);
 assert.ok(records.indexOf(checks[1].message)<records.indexOf(checks[0].message),'newest check appears first');
 assert.match(records,/北京时间/);
 assert.doesNotMatch(records,/本次会话暂无操作记录/);
 h.dispose();
});
