import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { transformWithOxc, parseAst } from 'vite';
import * as fleet from '../src/zoneFleet.ts';
import * as fleetIdentity from '../src/fleetJobIdentity.ts';
import * as model from '../src/workspace/model.ts';

const { code } = await transformWithOxc(readFileSync(new URL('../src/workspace/ZoneFleetControls.tsx', import.meta.url), 'utf8'), 'ZoneFleetControls.tsx', { lang: 'tsx', jsx: { runtime: 'classic' } });
const ast = parseAst(code);
const declarations = ast.body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
const hooks = { useSyncExternalStore: (_subscribe, read) => read(), useState: value => [value, () => {}], useEffect() {} };
const modules = { react: hooks, '../zoneFleet': fleet, '../fleetJobIdentity': fleetIdentity, './model': model };
const bindings = { React };
for (const declaration of ast.body.filter(node => node.type === 'ImportDeclaration')) {
  for (const specifier of declaration.specifiers) {
    const dependency = modules[declaration.source.value];
    assert.ok(dependency, `Missing component dependency ${declaration.source.value}`);
    bindings[specifier.local.name] = dependency[specifier.imported?.name ?? 'default'];
    assert.notEqual(bindings[specifier.local.name], undefined, `Missing component binding ${specifier.local.name}`);
  }
}
const { ZoneTaskControls, ZoneTreeDispatch, ZoneBatchDispatch, ZoneFleetBar } = new Function(...Object.keys(bindings), declarations + ';return {ZoneTaskControls, ZoneTreeDispatch, ZoneBatchDispatch, ZoneFleetBar};')(...Object.values(bindings));
const epoch = Date.parse('2026-10-18T02:00:00Z');
const routes = Array.from({ length: 4 }, (_, zone) => ({ zone, points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], distances: [0, 100], stations: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [zone * 50 + i, i])) }));
const job = (overrides = {}) => ({ id: 'rail-controls', attemptId: 'dispatch-one', planVersion: 'adopted-v1', angle: 28, requestedAt: new Date(epoch).toISOString(), weatherBlock: '天气待核验', harnessSource: { treeId: 'T-0001', strategyId: 'strategy-one', runId: 'run-one', revision: 1, angle: 28, expiresAt: '2099-01-01T00:00:00Z', adoptedAt: new Date(epoch).toISOString(), mode: 'simulation', dataMode: 'demo', siteId: 'demo-hainan' }, ...overrides });
const settle = () => new Promise(resolve => setImmediate(resolve));
function walk(element, predicate) {
  if (!React.isValidElement(element)) return [];
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  return React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join('') : '';
}
function button(element, label) {
  const buttons = walk(element, node => node.type === 'button' && text(node) === label);
  assert.equal(buttons.length, 1, `Expected one ${label} button`);
  assert.equal(!!buttons[0].props.disabled, false, `${label} must be enabled`);
  return buttons[0].props.onClick;
}

/** Real global fleet APIs and scheduler; only browser storage and React scheduling are replaced. */
function fixture(t, initial = job()) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) } });
  const completed = [], cancelled = [], validations = [];
  const scheduler = fleet.createZoneScheduler(routes, (index, input) => completed.push({ index, job: structuredClone(input) }), (index, input) => cancelled.push({ index, job: structuredClone(input) }), () => epoch);
  fleet.setFleetValidator(async (index, input) => { validations.push({ index, job: structuredClone(input) }); return { weatherBlock: '' }; });
  fleet.attachFleet(scheduler);
  assert.equal(fleet.dispatchTree(0, initial), true);
  let publications = 0;
  const unsubscribe = fleet.subscribeFleet(() => { publications++; });
  t.after(() => {
    unsubscribe(); fleet.detachFleet(); fleet.setFleetValidator(undefined);
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  });
  return {
    scheduler, completed, cancelled, validations,
    render(expectedJob = structuredClone(fleet.getFleetSnapshot().jobs[0]), index = 0) { return ZoneTaskControls({ index, expectedJob }); },
    publish() { fleet.publishFleet(scheduler.zones, true, null, scheduler.jobs); },
    snapshot() { return structuredClone(fleet.getFleetSnapshot()); },
    resetPublications() { publications = 0; },
    get publications() { return publications; },
    replace(next) { assert.equal(scheduler.retire(0), true); assert.equal(scheduler.enqueue(0, next), true); this.publish(); },
  };
}

for (const [name, mutate] of [
  ['another attempt with the same task ID', value => ({ ...value, attemptId: 'dispatch-two' })],
  ['a changed plan version', value => ({ ...value, planVersion: 'adopted-v2' })],
  ['a changed cut angle', value => ({ ...value, angle: 31 })],
  ['a changed strategy revision', value => ({ ...value, harnessSource: { ...value.harnessSource, revision: 2 } })],
  ['a changed source site', value => ({ ...value, harnessSource: { ...value.harnessSource, siteId: 'demo-xsbn' } })],
]) for (const label of ['取消排队', '重新核验', '暂停本区作业']) {
  test(`the rendered ${label} callback cannot affect ${name}`, async t => {
    const h = fixture(t), expected = structuredClone(h.scheduler.jobs[0]);
    const click = button(h.render(expected), label);
    h.replace(mutate(structuredClone(expected)));
    const before = h.snapshot(); h.resetPublications();
    click(); await settle();
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(h.cancelled, []); assert.deepEqual(h.completed, []); assert.deepEqual(h.validations, []);
    assert.equal(h.publications, 0, 'A rejected stale command must not publish a misleading update');
    assert.equal(h.render(expected), null, 'Old task details must no longer show controls for the replacement');
  });
}

for (const label of ['取消排队', '重新核验', '暂停本区作业']) test(`${label} captures nested source evidence before a mutable live record changes`, async t => {
  const h = fixture(t), expected = structuredClone(h.scheduler.jobs[0]);
  const click = button(h.render(expected), label);
  // Fleet snapshots historically share nested source references; an old callback must own its evidence.
  h.scheduler.jobs[0].harnessSource.revision++;
  h.publish(); const before = h.snapshot(); h.resetPublications();
  click(); await settle();
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.cancelled, []); assert.deepEqual(h.validations, []); assert.equal(h.publications, 0);
});

for (const initiallyPaused of [false, true]) test(`a stale ${initiallyPaused ? 'resume' : 'pause'} button does not act after the zone pause state changes`, async t => {
  const h = fixture(t);
  if (initiallyPaused) { h.scheduler.pause(0, true); h.publish(); }
  const click = button(h.render(), initiallyPaused ? '继续本区作业' : '暂停本区作业');
  h.scheduler.pause(0, !initiallyPaused); h.publish();
  const before = h.snapshot(); h.resetPublications();
  click(); await settle();
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.cancelled, []); assert.deepEqual(h.validations, []); assert.equal(h.publications, 0);
});

test('controls require a ready fleet and an active or queued job in its own zone', t => {
  const h = fixture(t), expected = structuredClone(h.scheduler.jobs[0]);
  assert.ok(h.render(expected));
  fleet.publishFleet(h.scheduler.zones, false, '场景未连接', h.scheduler.jobs);
  assert.equal(h.render(expected), null);
  fleet.publishFleet([], true, null, h.scheduler.jobs);
  assert.equal(h.render(expected), null);
  h.scheduler.zones[0].queue = [];
  h.publish();
  assert.equal(h.render(expected), null, 'An orphan job record does not authorize controls');
});

test('the tree view passes the actual rendered dispatch evidence to task controls', t => {
  const h = fixture(t);
  const element = ZoneTreeDispatch({ index: 0, onArrange() {} });
  const child = walk(element, node => node.type === ZoneTaskControls);
  assert.equal(child.length, 1);
  assert.deepEqual(child[0].props.expectedJob, fleet.getFleetSnapshot().jobs[0]);
  assert.equal(child[0].props.index, 0);
  assert.ok(ZoneTaskControls(child[0].props));
  h.replace(job({ attemptId: 'dispatch-two' }));
  assert.equal(ZoneTaskControls(child[0].props), null);
});

test('a current queued cancellation produces exactly one receipt even if clicked twice', async t => {
  const h = fixture(t), click = button(h.render(), '取消排队');
  click(); click(); await settle();
  assert.equal(h.scheduler.jobs[0], undefined);
  assert.deepEqual(h.scheduler.zones[0].queue, []);
  assert.equal(h.cancelled.length, 1); assert.equal(h.cancelled[0].job.attemptId, 'dispatch-one');
  assert.deepEqual(h.completed, []); assert.deepEqual(h.validations, []);
});

test('stopping the current active job retracts before recording cancellation', async t => {
  const h = fixture(t, job({ weatherBlock: '' }));
  assert.equal(h.scheduler.zones[0].active, 0);
  button(h.render(), '停止本次并收臂')();
  assert.equal(h.scheduler.zones[0].phase, 'retracting'); assert.equal(h.cancelled.length, 0);
  const stop = walk(h.render(), node => node.type === 'button' && text(node) === '正在收臂…');
  assert.equal(stop.length, 1); assert.equal(stop[0].props.disabled, true);
  h.scheduler.update(1); h.publish(); await settle();
  assert.equal(h.cancelled.length, 1); assert.equal(h.scheduler.jobs[0], undefined);
  assert.deepEqual(h.completed, []); assert.deepEqual(h.validations, []);
});

test('current pause and resume controls preserve queued work without creating receipts', t => {
  const h = fixture(t);
  button(h.render(), '暂停本区作业')();
  assert.equal(h.scheduler.zones[0].paused, true);
  assert.deepEqual(h.scheduler.zones[0].queue, [0]);
  button(h.render(), '继续本区作业')();
  assert.equal(h.scheduler.zones[0].paused, false);
  assert.deepEqual(h.scheduler.zones[0].queue, [0], 'Weather-blocked work remains queued after resume');
  assert.deepEqual(h.completed, []); assert.deepEqual(h.cancelled, []); assert.deepEqual(h.validations, []);
});

test('current recovery checks evidence once and does not resume a paused zone', async t => {
  const h = fixture(t);
  button(h.render(), '暂停本区作业')();
  const retry = button(h.render(), '重新核验'); retry(); retry();
  await settle(); h.publish();
  assert.equal(h.validations.length, 1);
  assert.equal(h.validations[0].job.attemptId, 'dispatch-one');
  assert.equal(h.scheduler.zones[0].paused, true);
  assert.equal(h.scheduler.zones[0].active, null); assert.deepEqual(h.scheduler.zones[0].queue, [0]);
  assert.equal(h.scheduler.jobs[0].weatherBlock, '');
  assert.deepEqual(h.cancelled, []); assert.deepEqual(h.completed, []);
});

test('event-held controls show the reason, preserve manual pause and disable resume and revalidation', t => {
  const h = fixture(t);
  h.scheduler.setEventHold(0, 'A区降雨已解除，待确认恢复');h.publish();
  let element = h.render();
  assert.match(text(element), /A区降雨已解除，待确认恢复/);
  assert.match(text(element), /天气与设备联动/);
  const retry = walk(element, node => node.type === 'button' && text(node) === '重新核验')[0];
  assert.equal(retry.props.disabled, true);
  button(element, '暂停本区作业')();
  element = h.render();
  assert.match(text(element), /同时保留手工暂停/);
  const resume = walk(element, node => node.type === 'button' && text(node) === '继续本区作业')[0];
  assert.equal(resume.props.disabled, true);
  assert.equal(h.scheduler.zones[0].paused, true);
  h.scheduler.setEventHold(0, '');h.publish();
  button(h.render(), '继续本区作业')();
  assert.equal(h.scheduler.zones[0].paused, false);
  assert.deepEqual(h.cancelled, []);assert.deepEqual(h.completed, []);
});

test('resume and revalidation callbacks rendered before an event cannot bypass its current hold', async t => {
  const h = fixture(t);h.scheduler.pause(0, true);h.publish();
  const resume = button(h.render(), '继续本区作业'), retry = button(h.render(), '重新核验');
  h.scheduler.setEventHold(0, 'R-A设备故障');h.publish();
  const before = h.snapshot();h.resetPublications();
  resume();retry();await settle();
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.publications, 0);assert.deepEqual(h.validations, []);
});

test('an event-held active task still permits cancellation and explains retraction without promising completion', t => {
  const h = fixture(t, job({weatherBlock: ''}));
  h.scheduler.setEventHold(0, 'R-A设备故障');h.publish();
  button(h.render(), '停止本次并收臂')();
  const element = h.render();
  assert.match(text(element), /正在收臂，完成后记录取消/);
  assert.match(text(element), /R-A设备故障/);
  assert.equal(walk(element, node => node.type === 'button' && text(node) === '继续本区作业').length, 0);
  h.scheduler.update(1);assert.equal(h.cancelled.length, 1);assert.deepEqual(h.completed, []);
});

test('tree, batch and fleet views expose event reasons and permit only unaffected-zone new arrangements', t => {
  const h = fixture(t);h.scheduler.setEventHold(0, 'A区降雨暂缓');h.publish();
  const tree = ZoneTreeDispatch({index: 1, onArrange() {}});
  assert.match(text(tree), /A区降雨暂缓/);
  const arrange = walk(tree, node => node.type === 'button' && text(node) === '当前区域作业暂缓')[0];
  assert.equal(arrange.props.disabled, true);
  const batch = ZoneBatchDispatch({selected: [1, 50], onSubmit() {}, onClose() {}});
  assert.match(text(batch), /A区降雨暂缓/);
  assert.equal(walk(batch, node => node.type === 'button' && text(node) === '安排所选树')[0].props.disabled, true);
  button(ZoneBatchDispatch({selected: [50], onSubmit() {}, onClose() {}}), '安排所选树');
  assert.match(text(ZoneFleetBar()), /A区降雨暂缓/);
});

test('photo validation describes the target check and hides cutting parameters', t => {
  const h = fixture(t, job({weatherBlock:'',harnessSource:undefined,angle:0,planVersion:'camera-demo-v1',observation:{reviewId:'review-1',captureId:'capture-1',treeId:'T-0001',siteId:'demo-hainan'}}));
  h.scheduler.update(1);h.publish();
  assert.equal(h.scheduler.jobs[0].strategyBlock,'正在核对补拍目标与任务');
  const value=text(h.render());
  assert.match(value,/正在核对补拍目标与任务/);
  assert.match(value,/补拍目标/);
  assert.doesNotMatch(value,/坡角|核验策略和天气|收臂/);
});

test('photo execution and cancellation retain shared controls without claiming cutting or arm retraction', t => {
  const h = fixture(t, job({weatherBlock:'',harnessSource:undefined,angle:0,observation:{reviewId:'review-1',captureId:'capture-1',treeId:'T-0001',siteId:'demo-hainan'}}));
  h.scheduler.jobs[0].validation='valid';h.scheduler.zones[0].phase='working';h.publish();
  assert.match(text(h.render()),/拍照中/);
  assert.match(text(ZoneTreeDispatch({index:0,onArrange(){}})),/拍照中/);
  assert.match(text(ZoneFleetBar()),/拍照中/);
  button(h.render(),'停止补拍')();
  const value=text(h.render());
  assert.match(value,/正在停止补拍/);
  assert.doesNotMatch(value,/坡角|割胶|收臂/);
  h.scheduler.update(1);
  assert.equal(h.cancelled.length,1);
  assert.equal(h.completed.length,0);
});

test('a single idle simulated robot returns to its starting station without changing jobs or other zones', t => {
 const h=fixture(t);assert.equal(h.scheduler.retire(0),true);h.scheduler.zones[0].distance=25;
 assert.equal(h.scheduler.enqueue(50,job({id:'other-zone'})),true);h.publish();
 const other=structuredClone(h.scheduler.zones[1]),jobs=structuredClone(h.scheduler.jobs);
 const bar=ZoneFleetBar({tasks:[]});button(bar,'复位 R-A 模拟机器人')();
 assert.equal(h.scheduler.zones[0].distance,0);assert.deepEqual(h.scheduler.zones[1],other);assert.deepEqual(h.scheduler.jobs,jobs);
 assert.deepEqual(h.cancelled,[]);assert.deepEqual(h.completed,[]);
});

test('robot reset is unavailable during active, queued, paused, or other simulated work',t=>{
 const h=fixture(t);h.scheduler.setEventHold(0,'天气暂缓');h.publish();
 let bar=ZoneFleetBar({tasks:[]});let control=walk(bar,node=>node.type==='button'&&text(node)==='复位 R-A 模拟机器人')[0];
 assert.equal(control.props.disabled,true);assert.equal(fleet.resetZonePosition(0),false);
 assert.equal(h.scheduler.retire(0),true);h.scheduler.zones[0].paused=true;h.publish();
 assert.equal(fleet.resetZonePosition(0),false);
 h.scheduler.zones[0].paused=false;h.publish();
 bar=ZoneFleetBar({tasks:[{site:'hainan',block:'A',dispatch:{phase:'running',auto:{}}}]});
 control=walk(bar,node=>node.type==='button'&&text(node)==='复位 R-A 模拟机器人')[0];assert.equal(control.props.disabled,true);
});
