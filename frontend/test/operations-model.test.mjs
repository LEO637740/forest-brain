import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupOperationsTasks, isCalendarDay, isClosed, needsDeviceAssignment,
  operationDateLabel, shanghaiDay, taskConflicts, taskDate, taskScheduleIssue,
  timelineTasks, timeToMinutes, unverifiedSchedules,
} from '../src/workspace/operationsModel.ts';

const day = '2026-10-18';
const task = (id = 'selected', patch = {}) => ({
  id, site: 'hainan', date: day, title: id, block: 'A', robot: 'R-A',
  start: '06:00', end: '07:30', count: 1, done: 0, status: '待开始', kind: '割胶', ...patch,
});
const ids = tasks => tasks.map(item => item.id);

test('Shanghai dates cross midnight independently of the host timezone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
      process.env.TZ = zone;
      assert.equal(shanghaiDay(Date.parse('2026-10-17T15:59:59.999Z')), '2026-10-17');
      assert.equal(shanghaiDay(Date.parse('2026-10-17T16:00:00.000Z')), day);
      assert.equal(shanghaiDay(Date.parse('2026-12-31T16:00:00.000Z')), '2027-01-01');
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('calendar validation rejects normalized overflow and accepts actual leap days', () => {
  for (const date of [day, '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.equal(isCalendarDay(date), true, date);
  for (const date of [undefined, null, 20261018, '', '2026-2-18', '2026-10-8', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '0000-01-01', '2026-10-18T00:00:00Z', ' 2026-10-18', '2026-10-18\n']) {
    assert.equal(isCalendarDay(date), false, String(date));
  }
});

test('missing and invalid task dates stay distinct instead of defaulting to today', () => {
  assert.equal(taskDate(task()), day);
  assert.equal(operationDateLabel(task()), day);
  for (const date of [undefined, null, '', '  ']) {
    assert.equal(taskDate(task('missing', { date })), null);
    assert.equal(operationDateLabel(task('missing', { date })), '日期未记录');
  }
  for (const date of ['2026-02-30', 'yesterday', 20261018]) {
    assert.equal(taskDate(task('invalid', { date })), null);
    assert.equal(operationDateLabel(task('invalid', { date })), '日期无效，待核对');
  }
});

test('either task status or dispatch terminal phase closes a task, but retryable failures do not', () => {
  for (const patch of [{ status: '已完成' }, { status: '已取消' }, { dispatch: { phase: 'completed' } }, { dispatch: { phase: 'cancelled' } }]) assert.equal(isClosed(task('closed', patch)), true);
  for (const phase of ['failed', 'cancel-requested', 'review', 'paused', 'running']) assert.equal(isClosed(task('open', { dispatch: { phase } })), false);
});

test('scope groups isolate the site and retain undated terminal evidence for review', () => {
  const tasks = [task('today'), task('today-ended', { status: '已完成' }), task('old', { date: '2026-10-17' }),
    task('old-ended', { date: '2026-10-17', status: '已取消' }), task('old-dispatch-ended', { date: '2026-10-17', dispatch: { phase: 'completed' } }),
    task('future', { date: '2026-10-19' }), task('undated', { date: undefined }), task('invalid-ended', { date: '2026-02-30', status: '已完成' }),
    task('other-site', { site: 'xsbn' }), task('other-site-undated', { site: 'xsbn', date: undefined })];
  const groups = groupOperationsTasks(tasks, 'hainan', day);
  assert.deepEqual(ids(groups.day), ['today', 'today-ended']);
  assert.deepEqual(ids(groups.carryover), ['old']);
  assert.deepEqual(ids(groups.undated), ['undated', 'invalid-ended']);
  assert.equal(groups.day[0], tasks[0]);
  assert.deepEqual(ids(groupOperationsTasks(tasks, 'hainan', '2026-10-19').carryover), ['today', 'old']);
});

test('invalid selected days never create a synthetic day or carryover range', () => {
  const tasks = [task(), task('undated', { date: undefined })];
  for (const value of ['', '2026-02-30', 'yesterday']) {
    const groups = groupOperationsTasks(tasks, 'hainan', value);
    assert.deepEqual(groups.day, []);
    assert.deepEqual(groups.carryover, []);
    assert.deepEqual(ids(groups.undated), ['undated']);
  }
});

test('time parsing requires exact 24-hour HH:mm and never normalizes invalid minutes', () => {
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('06:09'), 369);
  assert.equal(timeToMinutes('23:59'), 1439);
  for (const value of ['', '—', '6:00', '06:0', '24:00', '06:99', '-1:00', '06:00:00', ' 06:00', '06:00\n', undefined, null, 600]) assert.equal(Number.isNaN(timeToMinutes(value)), true, String(value));
});

test('placeholder devices remain unassigned while assigned device names are trimmed for comparisons', () => {
  for (const robot of ['', ' ', '待分配', '未分配设备', '暂无设备', '无', '-', '—', undefined]) assert.equal(needsDeviceAssignment(task('missing', { robot })), true);
  assert.equal(needsDeviceAssignment(task('assigned', { robot: ' R-A ' })), false);
});

test('schedule issues identify missing dates, invalid endpoints and unsupported reversed ranges', () => {
  assert.equal(taskScheduleIssue(task()), null);
  assert.match(taskScheduleIssue(task('missing', { date: undefined })), /日期未记录/);
  assert.match(taskScheduleIssue(task('invalid', { date: '2026-02-30' })), /日期无效/);
  assert.match(taskScheduleIssue(task('start', { start: '06:99' })), /开始时间/);
  assert.match(taskScheduleIssue(task('end', { end: '—' })), /结束时间/);
  assert.match(taskScheduleIssue(task('both', { start: '', end: '' })), /开始和结束时间/);
  for (const end of ['06:00', '05:59']) assert.match(taskScheduleIssue(task('range', { end })), /结束时间必须晚于开始时间/);
});

test('the reproduced old-day false conflict is replaced by the actual same-day cross-kind conflict', () => {
  const current = task();
  const all = [task('old', { date: '2026-10-17' }), current, task('inspection', { kind: '巡检' })];
  assert.deepEqual(ids(taskConflicts(current, all)), ['inspection']);
  assert.deepEqual(ids(groupOperationsTasks(all, 'hainan', day).carryover), ['old']);
});

test('conflicts require the same park and trimmed device, and use half-open time intervals', () => {
  const current = task();
  const all = [current, task('same-id-copy', { id: current.id }), task('trimmed', { robot: ' R-A ' }),
    task('starts-at-end', { start: '07:30', end: '08:00' }), task('ends-at-start', { start: '05:00', end: '06:00' }),
    task('one-minute', { start: '07:29', end: '08:00' }), task('other-site', { site: 'xsbn' }), task('other-device', { robot: 'R-B' }),
    task('future', { date: '2026-10-19' }), task('closed', { status: '已完成' }), task('dispatch-closed', { dispatch: { phase: 'cancelled' } })];
  assert.deepEqual(ids(taskConflicts(current, all)), ['trimmed', 'one-minute']);
});

test('unknown dates and invalid time ranges never masquerade as confirmed conflicts', () => {
  const all = [task('no-date', { date: undefined }), task('bad-date', { date: '2026-02-30' }), task('bad-start', { start: '06:99' }),
    task('no-end', { end: '—' }), task('reversed', { start: '08:00', end: '06:00' })];
  assert.deepEqual(taskConflicts(task(), all), []);
  assert.deepEqual(ids(unverifiedSchedules(task(), all)), ids(all));
  for (const incomplete of all) assert.deepEqual(taskConflicts(incomplete, [task()]), []);
});

test('unverified schedules exclude known different dates, parks, devices and terminal records', () => {
  const all = [task('unknown', { date: undefined }), task('today-no-end', { end: '—' }),
    task('yesterday-no-end', { date: '2026-10-17', end: '—' }), task('future-no-end', { date: '2026-10-19', end: '—' }),
    task('other-site', { site: 'xsbn', date: undefined }), task('other-device', { robot: 'R-B', date: undefined }),
    task('closed', { status: '已取消', date: undefined }), task('dispatch-closed', { dispatch: { phase: 'completed' }, date: undefined }),
    task('confirmed-overlap'), task('confirmed-separated', { start: '08:00', end: '09:00' })];
  assert.deepEqual(ids(unverifiedSchedules(task(), all)), ['unknown', 'today-no-end']);
});

test('an incomplete selected task keeps same-device peers uncertain even when their own times are complete', () => {
  const peers = [task('today-peer'), task('tomorrow-peer', { date: '2026-10-19' })];
  assert.deepEqual(ids(unverifiedSchedules(task('missing-date', { date: undefined }), peers)), ['today-peer', 'tomorrow-peer']);
  assert.deepEqual(ids(unverifiedSchedules(task('missing-time', { end: '—' }), peers)), ['today-peer']);
});

test('closed or unassigned selected tasks have no device conflict or uncertainty candidates', () => {
  const peers = [task('overlap'), task('unknown', { date: undefined })];
  for (const selected of [task('closed', { status: '已完成' }), task('dispatch-closed', { dispatch: { phase: 'completed' } }), task('unassigned', { robot: '待分配' })]) {
    assert.deepEqual(taskConflicts(selected, peers), []);
    assert.deepEqual(unverifiedSchedules(selected, peers), []);
  }
});

test('timeline includes only exact-day valid ranges for the requested park and kind without fabricating ends', () => {
  const tasks = [task('today'), task('today-ended', { status: '已完成' }), task('old', { date: '2026-10-17' }),
    task('undated', { date: undefined }), task('invalid-date', { date: '2026-02-30' }), task('unknown-end', { end: '—' }),
    task('invalid-time', { start: '06:99' }), task('reversed', { end: '05:00' }), task('inspection', { kind: '巡检' }), task('other-site', { site: 'xian' })];
  const before = structuredClone(tasks);
  assert.deepEqual(ids(timelineTasks(tasks, 'hainan', day, '割胶')), ['today', 'today-ended']);
  assert.deepEqual(ids(timelineTasks(tasks, 'hainan', day, '巡检')), ['inspection']);
  assert.deepEqual(timelineTasks(tasks, 'hainan', '2026-02-30', '割胶'), []);
  assert.deepEqual(tasks, before);
});
