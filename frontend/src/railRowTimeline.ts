export type RowStation={id:string;parkLocalX:number;extensionM:number;sliderOffsetM:number};
export function createRowTimeline(stations:RowStation[]){
  if(stations.length<1||stations.length>10||new Set(stations.map(s=>s.id)).size!==stations.length||stations.some((s,i)=>!s.id||![s.parkLocalX,s.extensionM,s.sliderOffsetM].every(Number.isFinite)||s.extensionM<.03||s.extensionM>.54||s.sliderOffsetM<-.35||s.sliderOffsetM>0||(i>0&&s.parkLocalX<=stations[i-1].parkLocalX)))throw new Error('Invalid rail segment stations');
  type Pose={x:number;extension:number;slider:number;station:number;phase:string};
  const keys:({time:number}&Pose)[]=[];
  let time=0;
  const add=(dt:number,x:number,extension:number,slider:number,station:number,phase:string)=>{time+=dt;keys.push({time,x,extension,slider,station,phase});};
  add(0,stations[0].parkLocalX,0,0,0,'停靠');
  stations.forEach((s,i)=>{
    const end=s.extensionM-.03,mid=Math.min(.3,end),x=s.parkLocalX;
    if(i)add(4,x,0,0,i,'行驶');
    add(.5,x,0,0,i,'停靠');add(1,x,mid,0,i,'伸出');add(1,x,mid,s.sliderOffsetM,i,'下降');
    add(1,x,end,s.sliderOffsetM,i,'接近');add(1.5,x,end,s.sliderOffsetM,i,'停留');
    add(1,x,mid,s.sliderOffsetM,i,'退回');add(1,x,mid,0,i,'抬升');add(1,x,0,0,i,'收拢');
  });
  if(stations.length>1)add(6,stations[0].parkLocalX,0,0,0,'返回');
  const duration=time;
  return {duration,sample(seconds:number){
    if(!Number.isFinite(seconds))throw new Error('Invalid time');
    const t=Math.max(0,Math.min(duration,seconds));let i=0;
    while(i<keys.length-2&&t>=keys[i+1].time)i++;
    const a=keys[i],b=keys[i+1],u=(t-a.time)/(b.time-a.time),v=u*u*(3-2*u);
    return {x:a.x+(b.x-a.x)*v,extension:a.extension+(b.extension-a.extension)*v,slider:a.slider+(b.slider-a.slider)*v,station:b.station,phase:t===duration?'已返回':b.phase,time:t};
  }};
}
