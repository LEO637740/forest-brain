import {railSegments,segmentForTree} from './railSegments';
// Runtime presentation only. Keep the authored asset and business positions unchanged.
// The original trio faces +Z; standalone stations preserve their authored runtime yaw.
export const RAIL_JOINT_SAMPLE = {
  indices: railSegments.flatMap(segment=>[...segment.indices]) as readonly number[],
  yawRadians: 0,
  panelDirection: '+Z',
} as const;

export function jointSampleYaw(index: number, originalYaw: number, enabled: boolean) {
  return enabled ? segmentForTree(index)?.yaw ?? originalYaw : originalYaw;
}
