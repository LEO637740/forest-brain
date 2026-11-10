/** Scene-independent rehearsal. No operation records or robot commands are written. */
export const railStages = [
  {label:'沿轨行驶',seconds:4}, {label:'停靠',seconds:1.5},
  {label:'伸出机构',seconds:2.5}, {label:'接近作业点',seconds:2},
  {label:'收回机构',seconds:2.5}, {label:'离开',seconds:4},
] as const;
export const railDuration=railStages.reduce((sum,s)=>sum+s.seconds,0);
export interface RailPose { travelM:number; extensionM:number; sliderOffsetM:number; toolFeedM:number }
export interface RailAdapter { apply(pose:RailPose):void }
const ease=(t:number)=>t*t*(3-2*t);
export function railFrame(elapsed:number){
  const time=Math.max(0,Math.min(railDuration,elapsed));
  let index=0,local=time;
  while(index<railStages.length-1 && local>=railStages[index].seconds){local-=railStages[index].seconds;index++;}
  const t=ease(Math.min(1,local/railStages[index].seconds));
  const pose:RailPose={travelM:0,extensionM:0,sliderOffsetM:0,toolFeedM:0};
  if(index===0)pose.travelM=-3*(1-t);
  if(index===2)pose.extensionM=.30*t;
  if(index===3){pose.extensionM=.30+.18*t;pose.sliderOffsetM=-.12*t;pose.toolFeedM=.005*t;}
  // Reverse the same two R3 sampled paths; do not mix independent axes.
  if(index===4){
    const lift=ease(Math.min(1,local/1.25));
    const retract=ease(Math.max(0,Math.min(1,(local-1.25)/1.25)));
    pose.extensionM=local<=1.25?.48-.18*lift:.30*(1-retract);
    pose.sliderOffsetM=-.12*(1-lift);pose.toolFeedM=.005*(1-lift);
  }
  if(index===5)pose.travelM=3*t;
  return {index,pose,done:time>=railDuration,progress:time/railDuration};
}
