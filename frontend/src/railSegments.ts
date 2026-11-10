/** Only reviewed, independent segments belong here. No implied connection between segments. */
export type RailSegment = {
  id:string;
  label:string;
  indices:readonly number[];
  reportUrl:string;
  yaw:number;
};
export const railSegments:readonly RailSegment[]=[
  {id:'c2-16-18',label:'C区 · 16–18号树',indices:[115,116,117],
    reportUrl:'/assets/robot/rail-row-pilot/aligned_corridor.json',yaw:0},
  {id:'c2-12',label:'C区 · 12号树单站',indices:[111],
    reportUrl:'/assets/robot/rail-row-pilot/single-111.json',yaw:3.446044265507184},
  {id:'c2-14',label:'C区 · 14号树单站',indices:[113],
    reportUrl:'/assets/robot/rail-row-pilot/single-113.json',yaw:3.5692476361420975},
  {id:'c2-13',label:'C区 · 13号树单站',indices:[112],
    reportUrl:'/assets/robot/rail-row-pilot/single-112.json',yaw:1.7409544626099662},
  {id:'c2-19',label:'C区 · 19号树单站',indices:[118],
    reportUrl:'/assets/robot/rail-row-pilot/single-118.json',yaw:3.8253056619866665},
  {id:'c2-11',label:'C区 · 11号树单站',indices:[110],
    reportUrl:'/assets/robot/rail-row-pilot/single-110.json',yaw:2.0628187905111566},
  {id:'c2-20',label:'C区 · 20号树单站',indices:[119],
    reportUrl:'/assets/robot/rail-row-pilot/single-119.json',yaw:5.984965240591071},
];
export const segmentForTree=(index:number)=>railSegments.find(s=>s.indices.includes(index));
export const segmentDuration=(count:number)=>count===1?8:count*12+2;
export const railTreeLabel=(index:number)=>`HN-${'ABCD'[Math.floor(index/50)]}-${String(index%50+1).padStart(4,'0')}`;
