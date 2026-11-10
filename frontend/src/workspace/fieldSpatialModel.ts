import type {FieldTreeRecord} from '../../../shared/fieldTrees.ts';

const EARTH_RADIUS_M=6_371_008.8;
const radians=(value:number)=>value*Math.PI/180;
export const elevationColors=['#466e8b','#94b6a3','#e1c187'] as const;
export type FieldMapPoint={record:FieldTreeRecord;xM:number;northM:number};
export type ElevationGroup={key:string;datum:string;mode:FieldTreeRecord['provenanceMode'];points:FieldMapPoint[];min:number;max:number};

/** Local equirectangular offsets around the supplied orchard coordinates. */
export function projectFieldTrees(items:FieldTreeRecord[]){
  const located=items.filter((record):record is FieldTreeRecord&{longitude:number;latitude:number}=>typeof record.longitude==='number'&&typeof record.latitude==='number');
  if(!located.length)return null;
  const origin={longitude:located.reduce((sum,r)=>sum+r.longitude,0)/located.length,latitude:located.reduce((sum,r)=>sum+r.latitude,0)/located.length};
  const points:FieldMapPoint[]=located.map(record=>({record,xM:EARTH_RADIUS_M*radians(record.longitude-origin.longitude)*Math.cos(radians(origin.latitude)),northM:EARTH_RADIUS_M*radians(record.latitude-origin.latitude)}));
  return {origin,points,missingCoordinates:items.length-located.length};
}

export function elevationGroupKey(record:FieldTreeRecord):string|null{
  return typeof record.elevationM==='number'&&record.elevationDatum?JSON.stringify([record.elevationDatum,record.provenanceMode]):null;
}
export function groupFieldElevations(points:FieldMapPoint[]):ElevationGroup[]{
  const groups=new Map<string,ElevationGroup>();
  for(const point of points){
    const key=elevationGroupKey(point.record);if(key===null)continue;
    const value=point.record.elevationM!;
    const group=groups.get(key);
    if(group){group.points.push(point);group.min=Math.min(group.min,value);group.max=Math.max(group.max,value);}
    else groups.set(key,{key,datum:point.record.elevationDatum!,mode:point.record.provenanceMode,points:[point],min:value,max:value});
  }
  return [...groups.values()];
}

export function niceMapDistance(value:number){
  const magnitude=10**Math.floor(Math.log10(value)),fraction=value/magnitude;
  return (fraction>=5?5:fraction>=2?2:1)*magnitude;
}
export function fieldMapFrame(points:FieldMapPoint[],width=720,height=440,padding=58){
  const xs=points.map(point=>point.xM),ys=points.map(point=>point.northM);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const scale=Math.min((width-2*padding)/Math.max(10,maxX-minX),(height-2*padding)/Math.max(10,maxY-minY));
  const x=(value:number)=>width/2+(value-centerX)*scale;
  const y=(value:number)=>height/2-(value-centerY)*scale;
  const scaleBarM=niceMapDistance((width-2*padding)/scale/4);
  return {width,height,padding,scale,x,y,scaleBarM,scaleBarPixels:scaleBarM*scale,
    xTicks:[-2,-1,0,1,2].map(i=>centerX+i*(width-2*padding)/scale/4),
    yTicks:[-2,-1,0,1,2].map(i=>centerY+i*(height-2*padding)/scale/4)};
}
export function fieldElevationColor(value:number,group:Pick<ElevationGroup,'min'|'max'>){
  const ratio=group.max===group.min ? .5 : Math.max(0,Math.min(1,(value-group.min)/(group.max-group.min)));
  const start=ratio<.5?0:1,fraction=ratio<.5?ratio*2:(ratio-.5)*2;
  const color=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const a=color(elevationColors[start]),b=color(elevationColors[start+1]);
  return `rgb(${a.map((value,i)=>Math.round(value+(b[i]-value)*fraction)).join(', ')})`;
}

export type ContourLevel={level:number;segments:[number,number,number,number][]};
export type ElevationContours={interval:number;levels:ContourLevel[];pointCount:number;method:string};

/** Inverse-distance-weighted grid from tree ground elevations, traced into contour segments (metres, local frame). */
export function elevationContours(points:FieldMapPoint[],columns=36,rows=28):ElevationContours|null{
  const valued=points.filter(point=>typeof point.record.elevationM==='number');
  if(valued.length<4)return null;
  const values=valued.map(point=>point.record.elevationM!),min=Math.min(...values),max=Math.max(...values);
  if(max-min<0.05)return null;
  const xs=valued.map(point=>point.xM),ys=valued.map(point=>point.northM);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const gx=(i:number)=>minX+(maxX-minX)*i/columns,gy=(j:number)=>minY+(maxY-minY)*j/rows;
  const grid=Array.from({length:rows+1},(_,j)=>Array.from({length:columns+1},(_,i)=>{
    let weight=0,sum=0;
    for(const point of valued){
      const d2=(point.xM-gx(i))**2+(point.northM-gy(j))**2;
      if(d2<1e-6)return point.record.elevationM!;
      const w=1/d2;weight+=w;sum+=w*point.record.elevationM!;
    }
    return sum/weight;
  }));
  const interval=niceMapDistance((max-min)/5);
  const levels:ContourLevel[]=[];
  for(let level=Math.ceil(min/interval)*interval;level<max;level+=interval){
    const segments:ContourLevel['segments']=[];
    const cross=(x1:number,y1:number,v1:number,x2:number,y2:number,v2:number):[number,number]=>{const t=(level-v1)/(v2-v1);return [x1+(x2-x1)*t,y1+(y2-y1)*t];};
    for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
      const x0=gx(i),x1=gx(i+1),y0=gy(j),y1=gy(j+1);
      const a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i+1],d=grid[j+1][i];
      const edges:[number,number][]=[];
      if((a<level)!==(b<level))edges.push(cross(x0,y0,a,x1,y0,b));
      if((b<level)!==(c<level))edges.push(cross(x1,y0,b,x1,y1,c));
      if((c<level)!==(d<level))edges.push(cross(x1,y1,c,x0,y1,d));
      if((d<level)!==(a<level))edges.push(cross(x0,y1,d,x0,y0,a));
      for(let k=0;k+1<edges.length;k+=2)segments.push([edges[k][0],edges[k][1],edges[k+1][0],edges[k+1][1]]);
    }
    if(segments.length)levels.push({level:Math.round(level*100)/100,segments});
  }
  return {interval,levels,pointCount:valued.length,method:'树点高程反距离加权插值'};
}
