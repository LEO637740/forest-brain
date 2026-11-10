/** Position-only dry-run planning. Never calls a driver or clamps unreachable targets. */
export interface RailLimits {
  extension:readonly [number,number];
  sliderOffset:readonly [number,number];
  toolFeed:readonly [number,number];
}
export function planRailApproach(surface:readonly number[],limits:RailLimits,gapM=.03){
  if(surface.length!==3||!surface.every(Number.isFinite)||!Number.isFinite(gapM)||gapM<=0)
    throw new RangeError('Expected finite surface XYZ and positive non-contact gap');
  const [x,y,z]=surface;
  // R3 coordinate contract: rail +X, up +Y, approach -Z; feed remains zero.
  const target=[x,y,z+gapM] as const;
  const pose={travelM:x+.22,extension:-(z+gapM)-.645,sliderOffset:y-1.79,toolFeed:0};
  const violations=(Object.keys(limits) as (keyof RailLimits)[]).flatMap(axis=>{
    const [min,max]=limits[axis],value=pose[axis];
    if(!Number.isFinite(min)||!Number.isFinite(max)||min>max)throw new RangeError('Invalid axis limits');
    return value<min||value>max?[{axis,value,min,max,excessM:value<min?min-value:value-max}]:[];
  });
  return {surface:[...surface],target,gapM,gapDirection:'+Z',pose,violations,
    axisRangesPassed:violations.length===0,executionApproved:false,
    scope:'Point-only; rail dock range, tool orientation, full path and collisions not validated'};
}
