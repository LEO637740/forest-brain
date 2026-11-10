import {SCENE_ZONE_CENTERS} from './sceneTreeLayout.ts';
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Photo-informed demonstration terraces, not surveyed topography. X/Z tree IDs stay fixed. */
export function terracedTerrainHeight(x:number,z:number){
 const natural=(z+50)*.16+Math.sin(x*.025)*1.6+Math.cos(z*.035)*.6;
 for(const center of SCENE_ZONE_CENTERS){
  const local=x-center.x;
  const edge=1-smooth(17,24,Math.abs(local));
  if(!edge)continue;
  const curve=Math.sin((local/3+4.5)*.6)*.8;
  const row=Math.max(-2,Math.min(2,Math.round((z-center.z-curve-.65)/7)));
  const rowZ=center.z+row*7+curve;
  // Tree row and rail (+1.25m) share a 4.6m bench; the remaining band is the riser.
  const across=z-rowZ-.65;
  const bench=1-smooth(2.3,3.5,Math.abs(across));
  const level=(center.z+row*7+50)*.16+Math.sin(x*.025)*1.6+Math.cos(rowZ*.035)*.6+across*.025;
  return natural+(level-natural)*edge*bench;
 }
 return natural;
}
