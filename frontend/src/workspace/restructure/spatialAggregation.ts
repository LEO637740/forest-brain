import { spatialTrees } from './orchardSpatial';
/** Pointy hexagons, radius 7 scene metres. Every tree contributes to exactly one cell. */
export const hexRadius=7;
function axialRound(q:number,r:number){let x=Math.round(q),z=Math.round(r),y=Math.round(-q-r);const dx=Math.abs(x-q),dy=Math.abs(y+q+r),dz=Math.abs(z-r);if(dx>dy&&dx>dz)x=-y-z;else if(dz>dy)z=-x-y;return [x,z];}
export const frequencyCells=(()=>{
 const cells=new Map<string,{id:string;x:number;z:number;indices:number[];total:number;mean:number}>();
 for(const t of spatialTrees){const [q,r]=axialRound((Math.sqrt(3)/3*t.x-t.z/3)/hexRadius,(2/3*t.z)/hexRadius),id=q+':'+r;let cell=cells.get(id);if(!cell){cell={id,x:hexRadius*Math.sqrt(3)*(q+r/2),z:hexRadius*1.5*r,indices:[],total:0,mean:0};cells.set(id,cell);}cell.indices.push(t.index);cell.total+=t.frequency;cell.mean=cell.total/cell.indices.length;}
 return [...cells.values()];
})();
