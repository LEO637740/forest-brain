// Timing only: geometry paths remain owned by the delivered R4 driver.
export const railStages=[
  {label:'收拢进站',seconds:3},
  {label:'伸出至准备位',seconds:2}, {label:'下降至目标高度',seconds:2},
  {label:'非接触对准',seconds:2}, {label:'退出树表',seconds:2},
  {label:'抬升复位',seconds:2}, {label:'收拢完成',seconds:2},
  {label:'收拢离站',seconds:3},
] as const;
export const railDuration=18;
export const inspectionTime=9-1e-6;
export function railFrame(elapsed:number,parkedTravelM=.0846424041){
  const time=Math.max(0,Math.min(railDuration,elapsed));
  const smooth=(t:number)=>t*t*(3-2*t);
  if(time<3)return {index:0,segment:0,pathProgress:0,travelM:-3+(parkedTravelM+3)*smooth(time/3),progress:time/railDuration,done:false};
  if(time>=15)return {index:7,segment:5,pathProgress:1,travelM:parkedTravelM+(3-parkedTravelM)*smooth((time-15)/3),progress:time/railDuration,done:time===railDuration};
  const segment=Math.min(5,Math.floor((time-3)/2));
  const t=(time-3-segment*2)/2;
  return {index:segment+1,segment,pathProgress:smooth(t),travelM:parkedTravelM,progress:time/railDuration,done:false};
}
