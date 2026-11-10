import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceDemo, transitionTask} from '../src/workspace/taskFlow.ts';

const task = (phase = 'running', stage = 'work') => ({id: 'flow-event', site: 'hainan', title: '模拟割胶',
  block: 'A', robot: 'R-A', start: '10:00', end: '11:00', count: 1, done: 0,
  status: phase === 'running' ? '执行中' : '待开始', kind: '割胶', treeIndices: [0],
  dispatch: {phase, requestId: 'flow-request', history: [], auto: {nextAt: 1000, startedAt: 0, stage}},
});

for (const [phase, stage, nextPhase, nextStage] of [
  ['waiting', 'travel', 'scheduled', 'travel'],
  ['scheduled', 'travel', 'running', 'travel'],
  ['running', 'travel', 'running', 'work'],
  ['running', 'work', 'completed', 'travel'],
]) test(`event hold preserves the remaining ${phase}/${stage} demo interval across reload and recovery`, () => {
  const before = task(phase, stage);
  const held = advanceDemo(before, 200, true);
  assert.equal(held.dispatch.auto.eventHeldAt, 200);
  assert.equal(held.dispatch.auto.nextAt, 1000);
  assert.equal(held.dispatch.phase, phase);assert.equal(held.done, 0);
  assert.equal(advanceDemo(held, 5000, true), held, 'continued influence must not reset the original hold time');
  assert.deepEqual(held.dispatch.history, []);
  const persisted = JSON.parse(JSON.stringify(held));
  const recovered = advanceDemo(persisted, 5200, false);
  assert.equal(recovered.dispatch.auto.eventHeldAt, undefined);
  assert.equal(recovered.dispatch.auto.nextAt, 6000);
  assert.equal(recovered.dispatch.phase, phase);assert.equal(recovered.done, 0);
  assert.equal(advanceDemo(recovered, 5999), recovered);
  const next = advanceDemo(recovered, 6000);
  assert.equal(next.dispatch.phase, nextPhase);assert.equal(next.dispatch.auto.stage, nextStage);
  assert.equal(next.done, nextPhase === 'completed' ? 1 : 0);
  assert.equal(before.dispatch.auto.eventHeldAt, undefined, 'the original task record remains immutable');
});

test('multiple event hold intervals add only their duration and do not create catch-up progress', () => {
  let current = advanceDemo(task(), 200, true);
  current = advanceDemo(current, 5200, false);
  current = advanceDemo(current, 5500, true);
  current = advanceDemo(current, 10000, false);
  assert.equal(current.dispatch.auto.nextAt, 10500);
  assert.equal(current.done, 0);assert.deepEqual(current.dispatch.history, []);
  assert.equal(advanceDemo(current, 10499), current);
  const completed = advanceDemo(current, 10500);
  assert.equal(completed.done, 1);assert.equal(completed.dispatch.phase, 'completed');
  assert.equal(advanceDemo(completed, 999999, true), completed);
});

test('event recovery does not resume a manual pause or fabricate its acknowledgement', () => {
  const before = task('paused');before.status = '待处理';
  const held = advanceDemo(before, 200, true);
  assert.equal(advanceDemo(held, 5000, true), held);
  const recovered = advanceDemo(held, 5200, false);
  assert.equal(recovered.dispatch.phase, 'paused');assert.equal(recovered.status, '待处理');
  assert.equal(advanceDemo(recovered, 999999), recovered);
  assert.deepEqual(recovered.dispatch.history, []);assert.equal(recovered.done, 0);
});

test('a manual pause requested after a long event is acknowledged on its own clock and remains paused after recovery', () => {
  const held = advanceDemo(task(), 200, true), pauseAt = 3600200;
  let pausing = transitionTask(held, 'pause', new Date(pauseAt).toISOString());
  pausing = {...pausing, dispatch: {...pausing.dispatch, auto: {...pausing.dispatch.auto, nextAt: pauseAt + 650}}};
  assert.equal(advanceDemo(pausing, pauseAt + 649, true), pausing);
  const paused = advanceDemo(pausing, pauseAt + 650, true);
  assert.equal(paused.dispatch.phase, 'paused');assert.equal(paused.status, '待处理');assert.equal(paused.done, 0);
  assert.equal(paused.dispatch.history.at(-1).label, '已暂停');
  assert.equal(paused.dispatch.history.at(-1).time, new Date(pauseAt + 650).toISOString());
  assert.equal(paused.dispatch.auto.nextAt, pauseAt + 650 + 2500);
  const heldPause = advanceDemo(paused, pauseAt + 1000, true);
  const recovered = advanceDemo(heldPause, pauseAt + 3600000, false);
  assert.equal(recovered.dispatch.phase, 'paused');assert.equal(recovered.done, 0);
  assert.equal(advanceDemo(recovered, pauseAt + 7200000), recovered);
});

test('a cancellation can still be acknowledged during an event and never becomes a completed cut', () => {
  const held = advanceDemo(task(), 200, true);
  const cancelling = transitionTask(held, 'cancel', new Date(500).toISOString());
  const cancelled = advanceDemo(cancelling, 5000, true);
  assert.equal(cancelled.dispatch.phase, 'cancelled');assert.equal(cancelled.status, '已取消');
  assert.equal(cancelled.done, 0);
  assert.equal(advanceDemo(cancelled, 999999, true), cancelled);
  assert.equal(advanceDemo(cancelled, 999999, false), cancelled);
});
