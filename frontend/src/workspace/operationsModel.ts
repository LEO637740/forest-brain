import type { Site, Task } from './model';

export type OperationsScope = 'day' | 'carryover' | 'undated';

/** All operation dates use the project's business timezone, never the browser timezone. */
export function shanghaiDay(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function isClosed(task: Task): boolean {
  return task.status === '已完成' || task.status === '已取消'
    || task.dispatch?.phase === 'completed' || task.dispatch?.phase === 'cancelled';
}

export function timeToMinutes(value: string): number {
  const match = typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

export function needsDeviceAssignment(task: Task): boolean {
  const value = typeof task.robot === 'string' ? task.robot.trim() : '';
  return !value || /^(待分配|未分配|暂无|无|[-—])/.test(value);
}

export function taskDate(task: Task): string | null {
  return isCalendarDay(task.date) ? task.date : null;
}

export function operationDateLabel(task: Task): string {
  const date = taskDate(task);
  if (date) return date;
  return task.date == null || (typeof task.date === 'string' && !task.date.trim())
    ? '日期未记录' : '日期无效，待核对';
}

export function groupOperationsTasks(tasks: Task[], site: Site, day: string): Record<OperationsScope, Task[]> {
  const result: Record<OperationsScope, Task[]> = { day: [], carryover: [], undated: [] };
  const validDay = isCalendarDay(day);
  for (const task of tasks) {
    if (task.site !== site) continue;
    const date = taskDate(task);
    if (!date) result.undated.push(task);
    else if (validDay && date === day) result.day.push(task);
    else if (validDay && date < day && !isClosed(task)) result.carryover.push(task);
  }
  return result;
}

export function taskScheduleIssue(task: Task): string | null {
  if (!taskDate(task)) return `${operationDateLabel(task)}，无法核对排程`;
  const start = timeToMinutes(task.start), end = timeToMinutes(task.end);
  if (!Number.isFinite(start) && !Number.isFinite(end)) return '开始和结束时间未记录或无效，请核对 24 小时制时间';
  if (!Number.isFinite(start)) return '开始时间未记录或无效，请核对 24 小时制时间';
  if (!Number.isFinite(end)) return '结束时间未记录或无效，请核对 24 小时制时间';
  if (end <= start) return '结束时间必须晚于开始时间，当前排程不支持跨日时段';
  return null;
}

function sameDeviceCandidates(task: Task, allTasks: Task[]): Task[] {
  if (isClosed(task) || needsDeviceAssignment(task)) return [];
  const robot = task.robot.trim();
  return allTasks.filter(other => other.id !== task.id && other.site === task.site
    && !isClosed(other) && !needsDeviceAssignment(other) && other.robot.trim() === robot);
}

export function taskConflicts(task: Task, allTasks: Task[]): Task[] {
  if (taskScheduleIssue(task)) return [];
  const date = taskDate(task), start = timeToMinutes(task.start), end = timeToMinutes(task.end);
  return sameDeviceCandidates(task, allTasks).filter(other => taskDate(other) === date
    && !taskScheduleIssue(other)
    && start < timeToMinutes(other.end) && timeToMinutes(other.start) < end);
}

/** A missing date or endpoint is uncertainty, not proof that the device is free. */
export function unverifiedSchedules(task: Task, allTasks: Task[]): Task[] {
  const date = taskDate(task), issue = taskScheduleIssue(task);
  return sameDeviceCandidates(task, allTasks).filter(other => {
    const otherDate = taskDate(other);
    if (date && otherDate && date !== otherDate) return false;
    return Boolean(issue || taskScheduleIssue(other));
  });
}

export function timelineTasks(tasks: Task[], site: Site, day: string, kind: string): Task[] {
  if (!isCalendarDay(day)) return [];
  return tasks.filter(task => task.site === site && task.kind === kind
    && taskDate(task) === day && !taskScheduleIssue(task));
}
