/** Only the three-station inspection view uses this budget; no logical tree is removed. */
export function railViewLOD(preferred:0|1|2|3,target:boolean,enabled:boolean):0|1|2|3 {
  return enabled ? Math.max(target?1:2,preferred) as 0|1|2|3 : preferred;
}
