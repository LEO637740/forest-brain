import {sceneTreeLayout} from '../sceneTreeLayout.ts';
// Read-only diagnostic snapshot of DigitalTwinScene's 20260918 seeded layout.
// Not business records; never written back to the homepage.
export const businessHeight=(x:number,z:number)=>Math.sin(x*.032)*3.3+Math.cos(z*.041)*2.4+Math.sin((x+z)*.018)*2.2+Math.cos((x-z)*.024)*1.4;
export function trialBusinessLayout(){
  return sceneTreeLayout().map(({x,z,scale,rotation,archetype})=>({x,z,y:businessHeight(x,z),scale,rotation,family:archetype}));
}
