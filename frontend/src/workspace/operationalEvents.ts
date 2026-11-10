import type {Site, Task} from './model';

export type OperationalEvent = {
  id: string;
  siteId: string;
  kind: 'rain' | 'device_fault';
  zone: number | null;
  status: 'active' | 'resolved' | 'closed';
  note: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
  closedAt?: string;
  resumeNote?: string;
  mode: 'simulation';
};

export const eventKindLabels = {rain: '降雨影响', device_fault: '设备故障'};
export const eventStatusLabels = {active: '影响中', resolved: '已解除 · 待确认恢复', closed: '已确认恢复'};

export function eventScopeLabel(event: Pick<OperationalEvent, 'kind' | 'zone'>): string {
  return event.zone === null ? '全园区' : event.kind === 'device_fault' ? `R-${'ABCD'[event.zone]} · ${'ABCD'[event.zone]}区` : `${'ABCD'[event.zone]}区`;
}

/** Explicit tree membership takes precedence over a display block or robot name. */
export function taskEventZones(task: Task): number[] {
  if (task.treeIndices !== undefined) return [...new Set(task.treeIndices
    .filter(index => Number.isInteger(index) && index >= 0 && index < 200)
    .map(index => Math.floor(index / 50)))];
  return /^[ABCD]$/.test(task.block) ? ['ABCD'.indexOf(task.block)] : [];
}

/** Scope only: closed events can still be included in a task's event history. */
export function eventMatchesTask(task: Task, event: OperationalEvent): boolean {
  return task.kind === '割胶' && event.siteId === `demo-${task.site}`
    && (event.zone === null || taskEventZones(task).includes(event.zone));
}

export function eventAffectsTask(task: Task, event: OperationalEvent, logistics = false): boolean {
  if (!eventMatchesTask(task, event) || task.status === '已取消' || task.dispatch?.phase === 'cancelled') return false;
  if (task.status === '已完成' || task.dispatch?.phase === 'completed') return logistics && event.kind === 'rain';
  return true;
}

function eventReason(event: OperationalEvent): string {
  const reason = `${eventKindLabels[event.kind]} · ${eventScopeLabel(event)}：${event.note}`;
  return event.status === 'resolved' ? `${reason}（已解除，待确认恢复）` : reason;
}

export function eventHoldForTask(task: Task, events: readonly OperationalEvent[], logistics = false): string | null {
  return events.filter(event => event.status !== 'closed' && eventAffectsTask(task, event, logistics)).map(eventReason).join('；') || null;
}

export function eventHoldForZone(site: Site, zone: number, events: readonly OperationalEvent[]): string {
  return events.filter(event => event.siteId === `demo-${site}` && event.status !== 'closed'
    && (event.zone === null || event.zone === zone)).map(eventReason).join('；');
}
