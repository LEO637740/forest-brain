import type { FleetJob } from './zoneFleet';

export const recordedText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const recordedTime = (value: unknown): value is string => recordedText(value) && Number.isFinite(Date.parse(value));
export const sourceSite = (source: NonNullable<FleetJob['harnessSource']>) => source.siteId ?? 'demo-hainan';
export const sourceIdentity = (source: NonNullable<FleetJob['harnessSource']>) => JSON.stringify([
  sourceSite(source), source.treeId, source.strategyId, source.runId, source.revision, source.adoptedAt,
]);
export const sourceRecord = (source: NonNullable<FleetJob['harnessSource']>) => JSON.stringify([
  sourceIdentity(source), source.angle, source.expiresAt, source.mode, source.dataMode ?? null,
]);
/** A retry may reuse a task ID, but it must not inherit an earlier execution. */
export function sameDispatchAttempt(left?: FleetJob, right?: FleetJob): boolean {
  if (!left || !right || !recordedText(left.id) || !recordedText(right.id) || left.id !== right.id
    || !recordedTime(left.requestedAt) || !recordedTime(right.requestedAt) || left.requestedAt !== right.requestedAt) return false;
  if (left.attemptId === undefined && right.attemptId === undefined) return true;
  return recordedText(left.attemptId) && recordedText(right.attemptId) && left.attemptId === right.attemptId;
}

export function sameDispatchSource(left?: FleetJob, right?: FleetJob): boolean {
  const leftSource = left?.harnessSource, rightSource = right?.harnessSource;
  return leftSource ? !!rightSource && sourceRecord(leftSource) === sourceRecord(rightSource) : !rightSource;
}

export function sameDispatchJob(left?: FleetJob, right?: FleetJob): boolean {
  return sameDispatchAttempt(left, right) && left!.planVersion === right!.planVersion && left!.angle === right!.angle
    && sameDispatchSource(left, right);
}

