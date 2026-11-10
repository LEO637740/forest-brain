import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachFleet, createZoneScheduler, detachFleet, getFleetSnapshot,
  setFleetEventHolds, setFleetObservationWeatherOverride, setFleetValidator, subscribeFleet,
} from '../src/zoneFleet.ts';
import {finishRailTask, syncRailTask} from '../src/workspace/railTaskState.ts';
import {robotStatus} from '../src/workspace/robotCenterModel.ts';

const now = Date.parse('2026-10-19T02:00:00.000Z');
const routes = Array.from({length: 4}, (_, zone) => ({zone,
  points: [{x: 0, y: 0, z: 0}, {x: 100, y: 0, z: 0}], distances: [0, 100],
  stations: Object.fromEntries(Array.from({length: 50}, (_, index) => [zone * 50 + index, index])),
}));
const job = (index = 0) => ({id: 'rail-' + index, attemptId: 'attempt-' + index,
  planVersion: 'plan-v1', angle: 28, requestedAt: new Date(now).toISOString()});
const task = (index = 0, patch = {}) => ({id: 'rail-' + index, site: 'hainan', title: '事件联动作业',
  block: 'ABCD'[Math.floor(index / 50)], robot: 'R-' + 'ABCD'[Math.floor(index / 50)],
  start: '10:00', end: '—', count: 1, done: 0, status: '执行中', kind: '割胶',
  treeIndices: [index], railJob: job(index), ...patch});
const snapshot = scheduler => ({ready: true, error: null, zones: scheduler.zones, jobs: scheduler.jobs});
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject;const promise = new Promise((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};};
const makeScheduler = validate => {
  const receipts = [];
  const record = outcome => (index, job) => receipts.push({index, job, outcome, finishedAt: new Date(now + 10000).toISOString()});
  return {scheduler: createZoneScheduler(routes, record('completed'), record('cancelled'), () => now, validate), receipts};
};
async function beginCut(scheduler) {
  scheduler.enqueue(0, job());scheduler.update(1);await settle();scheduler.update(1);scheduler.update(3);
  assert.equal(scheduler.zones[0].phase, 'working');
  assert.equal(scheduler.zones[0].elapsed, 3);
}

test('demo weather releases only queued photo work and freezes it when switched off', () => {
  const {scheduler,receipts}=makeScheduler();
  const photo={...job(5),id:'photo-5',observation:{reviewId:'review-5',captureId:'capture-5',siteId:'demo-hainan',treeId:'T-0006'}};
  scheduler.setEventHold(0,'天气暂缓',true);
  scheduler.enqueue(1,job(1));scheduler.enqueue(5,photo);
  scheduler.update(20);assert.equal(scheduler.zones[0].active,null);
  scheduler.setObservationWeatherOverride(true);assert.equal(scheduler.zones[0].active,5);
  scheduler.update(.2);const distance=scheduler.zones[0].distance;assert.ok(distance>0);
  scheduler.setObservationWeatherOverride(false);scheduler.update(20);assert.equal(scheduler.zones[0].distance,distance);
  scheduler.setObservationWeatherOverride(true);scheduler.update(1);scheduler.update(2);
  assert.deepEqual(receipts.map(result=>[result.index,result.outcome]),[[5,'completed']]);
  assert.equal(scheduler.zones[0].active,null);assert.deepEqual(scheduler.zones[0].queue,[1]);
  scheduler.setEventHold(0,'天气暂缓',false);scheduler.enqueue(6,{...photo,id:'photo-6'});
  scheduler.update(20);assert.equal(scheduler.zones[0].active,null,'same text classified as an event remains blocking');
});

test('a manually paused queued photo can resume during demo weather, but a fault still blocks it',()=>{
  const {scheduler}=makeScheduler();
  const photo={...job(5),id:'photo-5',observation:{reviewId:'review-5',captureId:'capture-5',siteId:'demo-hainan',treeId:'T-0006'}};
  scheduler.setEventHold(0,'天气暂缓',true);scheduler.pause(0,true);scheduler.enqueue(5,photo);
  scheduler.setObservationWeatherOverride(true);assert.equal(scheduler.zones[0].active,null);
  assert.equal(scheduler.pause(0,false),true);assert.equal(scheduler.zones[0].active,5);
  scheduler.pause(0,true);scheduler.setEventHold(0,'设备故障');
  assert.equal(scheduler.pause(0,false),false);assert.equal(scheduler.retryValidation(5),false);
});

test('an event freezes moving and queued work in its own zone while another zone finishes', () => {
  const {scheduler, receipts} = makeScheduler();
  scheduler.enqueue(1, job(1));scheduler.enqueue(2, job(2));scheduler.enqueue(50, job(50));
  scheduler.update(.01);
  const distance = scheduler.zones[0].distance;
  scheduler.setEventHold(0, 'A区降雨，割胶及储运暂缓');scheduler.update(20);
  assert.equal(scheduler.zones[0].distance, distance);
  assert.equal(scheduler.zones[0].active, 1);
  assert.deepEqual(scheduler.zones[0].queue, [2]);
  assert.equal(scheduler.zones[0].paused, false);
  assert.deepEqual(receipts.map(result => [result.index, result.outcome]), [[50, 'completed']]);
});

test('a fault during cutting freezes elapsed work without fabricating a completion or progress', async () => {
  const {scheduler, receipts} = makeScheduler(async () => {});
  await beginCut(scheduler);
  scheduler.setEventHold(0, 'R-A故障，等待处理');
  scheduler.update(100);
  assert.equal(scheduler.zones[0].elapsed, 3);
  assert.equal(scheduler.zones[0].completed, 0);
  assert.deepEqual(receipts, []);
  const after = syncRailTask(task(), snapshot(scheduler), now);
  assert.equal(after.status, '待处理');assert.equal(after.done, 0);assert.equal(after.railResult, undefined);
  assert.equal(robotStatus(scheduler.zones[0], snapshot(scheduler), now), 'R-A故障，等待处理');
});

test('an event during retraction preserves one cancellation and prevents the next queued tree from starting', async () => {
  const {scheduler, receipts} = makeScheduler(async () => {});
  await beginCut(scheduler);scheduler.enqueue(1, job(1));
  scheduler.cancel(0);scheduler.update(.4);
  scheduler.setEventHold(0, '降雨已解除，待人工恢复');
  assert.match(robotStatus(scheduler.zones[0], snapshot(scheduler), now), /收臂中.*待人工恢复/);
  scheduler.update(.6);scheduler.update(100);
  assert.equal(receipts.length, 1);assert.equal(receipts[0].outcome, 'cancelled');
  assert.equal(finishRailTask(task(), receipts[0]).done, 0);
  assert.equal(scheduler.zones[0].active, null);assert.equal(scheduler.zones[0].paused, false);
  assert.deepEqual(scheduler.zones[0].queue, [1]);
  scheduler.setEventHold(0, '');
  assert.equal(scheduler.zones[0].active, 1);
});

for (const manualPause of [false, true]) test(`event set and clear preserve manual pause ${manualPause}`, () => {
  const {scheduler} = makeScheduler();
  scheduler.pause(0, manualPause);scheduler.enqueue(0, job());
  scheduler.setEventHold(0, '设备故障');
  assert.equal(scheduler.pause(0, false), false);
  assert.equal(scheduler.retryValidation(0), false);
  assert.equal(scheduler.zones[0].paused, manualPause);
  scheduler.setEventHold(0, '设备已修复，待人工恢复');scheduler.update(100);
  assert.equal(scheduler.zones[0].eventHoldReason, '设备已修复，待人工恢复');
  assert.equal(scheduler.zones[0].elapsed, 0);
  scheduler.setEventHold(0, '');
  assert.equal(scheduler.zones[0].paused, manualPause);
  if (manualPause) {assert.equal(scheduler.zones[0].active, null);assert.deepEqual(scheduler.zones[0].queue, [0]);}
});

test('closing an event revalidates the interrupted cut and completes exactly its remaining work', async () => {
  let calls = 0;
  const {scheduler, receipts} = makeScheduler(async () => {calls++;});
  await beginCut(scheduler);assert.equal(calls, 1);
  scheduler.setEventHold(0, '天气异常');scheduler.setEventHold(0, '天气已解除，待人工恢复');
  scheduler.update(100);assert.equal(calls, 1);assert.equal(scheduler.zones[0].elapsed, 3);
  scheduler.setEventHold(0, '');scheduler.update(1);
  assert.equal(scheduler.zones[0].elapsed, 3);assert.equal(receipts.length, 0);
  await settle();assert.equal(calls, 2);
  scheduler.update(5);scheduler.update(100);
  assert.equal(receipts.length, 1);assert.equal(receipts[0].outcome, 'completed');
  assert.equal(receipts[0].job.angle, 28);assert.equal(receipts[0].job.planVersion, 'plan-v1');
});

for (const outcome of ['success', 'failure']) test(`a late validation ${outcome} cannot remove an event hold or settle a replacement check`, async () => {
  const checks = [];
  const {scheduler, receipts} = makeScheduler(() => {const check = deferred();checks.push(check);return check.promise;});
  scheduler.enqueue(0, job());scheduler.update(1);await settle();
  scheduler.setEventHold(0, '设备故障');
  assert.equal(scheduler.retryValidation(0), false);scheduler.update(100);
  assert.equal(checks.length, 1);assert.equal(scheduler.jobs[0].validation, 'required');
  scheduler.setEventHold(0, '');scheduler.update(1);await settle();
  assert.equal(checks.length, 2);
  if (outcome === 'success') checks[0].resolve({weatherBlock: '', notAfter: now + 100000});
  else checks[0].reject(Error('旧核验失败'));
  await settle();assert.equal(scheduler.jobs[0].validation, 'pending');
  assert.equal(scheduler.jobs[0].notAfter, undefined);
  checks[1].reject(Error('恢复后的天气仍不适合割胶'));await settle();scheduler.update(100);
  assert.equal(scheduler.jobs[0].validation, 'invalid');
  assert.match(scheduler.jobs[0].strategyBlock, /恢复后的天气/);
  assert.deepEqual(receipts, []);
});

test('checkpoint restoration keeps interrupted work, event reason and manual pause independently', async () => {
  const first = makeScheduler(async () => {});await beginCut(first.scheduler);
  first.scheduler.pause(0, true);first.scheduler.setEventHold(0, '设备故障未恢复');
  const restored = makeScheduler(async () => {});
  assert.equal(restored.scheduler.restore(structuredClone({zones: first.scheduler.zones, jobs: first.scheduler.jobs})), true);
  restored.scheduler.update(100);
  assert.equal(restored.scheduler.zones[0].elapsed, 3);
  assert.equal(restored.scheduler.zones[0].eventHoldReason, '设备故障未恢复');
  assert.equal(restored.scheduler.zones[0].paused, true);
  restored.scheduler.setEventHold(0, '');restored.scheduler.update(100);
  assert.equal(restored.scheduler.zones[0].elapsed, 3);assert.deepEqual(restored.receipts, []);
});

test('resetting local simulated work does not clear a server event or let a new task start', () => {
  const {scheduler, receipts} = makeScheduler();
  scheduler.enqueue(0, job());scheduler.setEventHold(0, '设备故障未恢复');
  scheduler.reset();scheduler.enqueue(1, job(1));scheduler.update(100);
  assert.equal(scheduler.zones[0].eventHoldReason, '设备故障未恢复');
  assert.equal(scheduler.zones[0].active, null);assert.deepEqual(scheduler.zones[0].queue, [1]);
  assert.deepEqual(receipts, []);
});

test('live task synchronization marks the held batch only and keeps earlier receipts and foreign parks intact', () => {
  const {scheduler} = makeScheduler();scheduler.enqueue(1, job(1));scheduler.enqueue(50, job(50));scheduler.setEventHold(0, 'A区降雨');
  const received = {index: 0, job: job(), outcome: 'completed', finishedAt: new Date(now + 1000).toISOString()};
  const batch = task(0, {id: 'batch-a', count: 2, done: 1, treeIndices: [0, 1], railJob: undefined,
    railBatch: {baseDone: 0, jobs: {0: job(), 1: job(1)}, results: {0: received}}});
  const after = syncRailTask(batch, snapshot(scheduler), now);
  assert.equal(after.status, '待处理');assert.equal(after.done, 1);
  assert.equal(after.railBatch.results[0], received);
  assert.equal(syncRailTask(task(50), snapshot(scheduler), now).status, '执行中');
  for (const site of ['xsbn', 'xian']) {
    const foreign = task(1, {site});assert.equal(syncRailTask(foreign, snapshot(scheduler), now), foreign);
  }
});

test('server event cache overlays checkpoint holds only after retrieval, publishes reason changes and saves them immediately', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)),
  }});
  const key = 'rubber-fleet-checkpoint-v1', original = makeScheduler().scheduler;
  original.pause(0, true);original.enqueue(0, job());original.setEventHold(0, '检查点中的天气异常');
  const checkpoint = JSON.stringify({zones: original.zones, jobs: original.jobs});
  let unsubscribe = () => {};
  try {
    memory.set(key, checkpoint);setFleetValidator(undefined);
    const first = makeScheduler().scheduler;attachFleet(first);
    assert.equal(getFleetSnapshot().zones[0].eventHoldReason, '检查点中的天气异常');
    detachFleet();
    setFleetEventHolds(['服务器已解除，待人工恢复', '', '', '']);
    memory.set(key, checkpoint);
    const next = makeScheduler().scheduler;attachFleet(next);
    assert.equal(next.zones[0].eventHoldReason, '服务器已解除，待人工恢复');assert.equal(next.zones[0].paused, true);
    const publications = [];unsubscribe = subscribeFleet(() => publications.push(getFleetSnapshot()));
    setFleetEventHolds(['服务器更新后的故障原因', '', '', '']);
    assert.equal(publications.length, 1);
    assert.equal(JSON.parse(memory.get(key)).zones[0].eventHoldReason, '服务器更新后的故障原因');
    setFleetEventHolds(['服务器更新后的故障原因', '', '', '']);assert.equal(publications.length, 1);
    setFleetEventHolds(['', '', '', '']);assert.equal(publications.length, 2);
    assert.equal(next.zones[0].eventHoldReason, undefined);assert.equal(next.zones[0].paused, true);
    unsubscribe();unsubscribe = () => {};detachFleet();
    memory.set(key, checkpoint);
    const recovered = makeScheduler().scheduler;attachFleet(recovered);
    assert.equal(recovered.zones[0].eventHoldReason, undefined, 'confirmed empty event list supersedes a stale checkpoint');
    assert.equal(recovered.zones[0].paused, true);
  } finally {
    unsubscribe();setFleetEventHolds([]);detachFleet();setFleetValidator(undefined);
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);else delete globalThis.localStorage;
  }
});

test('reattaching a checkpoint synchronizes the current tab switch and starts its existing photo',t=>{
  const memory=new Map(),oldStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  t.after(()=>{setFleetObservationWeatherOverride(false);setFleetEventHolds([]);detachFleet();globalThis.localStorage=oldStorage;});
  const old=makeScheduler().scheduler,photo={...job(5),id:'photo-5',observation:{reviewId:'review-5',captureId:'capture-5',siteId:'demo-hainan',treeId:'T-0006'}};
  old.setEventHold(0,'天气暂缓',true);old.enqueue(5,photo);
  memory.set('rubber-fleet-checkpoint-v1',JSON.stringify({zones:old.zones,jobs:old.jobs}));
  setFleetEventHolds(['天气暂缓','','',''],[true,false,false,false]);setFleetObservationWeatherOverride(true);
  const next=makeScheduler().scheduler;attachFleet(next);
  assert.equal(next.zones[0].active,5);assert.equal(next.jobs[5].id,'photo-5');
  assert.equal(getFleetSnapshot().zones[0].observationWeatherOverride,true);
});
