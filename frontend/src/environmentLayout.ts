import * as THREE from "three";
import { Noise2D, mulberry32 } from "./vendor/tidewaterNoise";

/** Visual-only habitat scatter. Inspired by Tidewater Scatter.js's shared
 * cover/exclusion/spacing approach; site rules below are specific to this garden.
 * No IDs, business transforms or operational records are created or mutated.
 */
type Point = { x: number; z: number };
type Road = { points: readonly Point[]; width: number; shoulderWidth?: number };
type Bounds = { x0: number; x1: number; z0: number; z1: number };
export type HabitatPoint = Point & { vigor: number };
export type EnvironmentLayout = {
  rubber: HabitatPoint[]; smallTrees: HabitatPoint[];
  shrubs: HabitatPoint[]; proxies: HabitatPoint[]; seed: number;
};
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (lo: number, hi: number, v: number) => { const t = clamp((v-lo)/(hi-lo)); return t*t*(3-2*t); };

/** Same centripetal spline as the visible road, not its unsmoothed control polygon. */
export function createRoadClearance(roads: readonly Road[]) {
  const segments: {a: Point;b: Point;half:number}[] = [];
  for (const road of roads) {
    const curve = new THREE.CatmullRomCurve3(road.points.map(p=>new THREE.Vector3(p.x,0,p.z)));
    const points = curve.getSpacedPoints(Math.ceil(curve.getLength()));
    for(let i=1;i<points.length;i++) segments.push({a:points[i-1],b:points[i],half:road.width*.5+(road.shoulderWidth??0)});
  }
  return (x:number,z:number) => {
    let closest=Infinity;
    for(const {a,b,half} of segments) {
      const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1));
      closest=Math.min(closest,Math.hypot(x-a.x-t*dx,z-a.z-t*dz)-half);
    }
    return closest;
  };
}

export function createEnvironmentLayout(options: {
  business: readonly Point[]; roads: readonly Road[];
  heightAt:(x:number,z:number)=>number; seed?:number;
}): EnvironmentLayout {
  const seed=options.seed??20260924, n=new Noise2D(seed), n2=new Noise2D(seed+107);
  const roadDistance=createRoadClearance(options.roads);
  // Fixed seeds per layer prevent changes in one layer from reshuffling another.
  const cover=(x:number,z:number)=>n.fbm(x/57,z/57)*.65+n2.fbm(x/19,z/19)*.35;
  const slope=(x:number,z:number)=>Math.hypot(
    (options.heightAt(x+1,z)-options.heightAt(x-1,z))*.5,
    (options.heightAt(x,z+1)-options.heightAt(x,z-1))*.5);
  const rootClear=(x:number,z:number,r:number)=>options.business.every(p=>(p.x-x)**2+(p.z-z)**2>r*r);
  const footprint={x0:-211,x1:211,z0:-194,z1:105};
  // Preserve an empty operator approach; natural plants cannot invade the managed rows.
  const outsideManaged=(x:number,z:number)=>z< -61 || Math.abs(x)>122 || z>67;
  const scatter=(count:number,b:Bounds,step:number,spacing:number,layerSeed:number,
    probability:(x:number,z:number)=>number,allow:(x:number,z:number)=>boolean):HabitatPoint[]=>{
    const rand=mulberry32(seed+layerSeed), candidates:{x:number;z:number;rank:number;vigor:number}[]=[];
    // Full-cell jitter + weighted selection, rather than jittering a fixed set of rows.
    for(let z=b.z0;z<b.z1;z+=step)for(let x=b.x0;x<b.x1;x+=step){
      const px=x+rand()*Math.min(step,b.x1-x),pz=z+rand()*Math.min(step,b.z1-z);
      const p=probability(px,pz);
      if(p<=.025 || !allow(px,pz))continue;
      candidates.push({x:px,z:pz,rank:-Math.log(Math.max(1e-8,rand()))/p,
        vigor:clamp(.5+cover(px,pz)*.9+(rand()-.5)*.48)});
    }
    candidates.sort((a,b)=>a.rank-b.rank);
    const out:HabitatPoint[]=[];
    for(const c of candidates){
      if(out.some(p=>(p.x-c.x)**2+(p.z-c.z)**2<spacing*spacing))continue;
      out.push({x:c.x,z:c.z,vigor:c.vigor});
      if(out.length===count)break;
    }
    if(out.length!==count)throw new Error(`Habitat ${layerSeed}: placed ${out.length}/${count}; do not silently expand the map.`);
    return out;
  };
  const rubber=scatter(360,{x0:-205,x1:205,z0:-158,z1:103},2.8,6.0,11,
    (x,z)=>{
      const patch=cover(x,z);
      // A wandering inner forest edge, not a rectangular wall behind A/B.
      const edge=-60+n.noise(x/39,5)*15;
      const rear=smooth(0,19,edge-z);
      const side=smooth(122,148,Math.abs(x));
      const foreground=smooth(71,88,z)*smooth(85,115,Math.abs(x));
      return Math.max(rear,side*.7,foreground*.6)*smooth(-.02,.22,patch);
    },(x,z)=>outsideManaged(x,z)&&rootClear(x,z,6)&&roadDistance(x,z)>3.8&&slope(x,z)<.72);
  const smallTrees=scatter(80,{x0:-205,x1:205,z0:-159,z1:101},3.8,5.0,29,
    (x,z)=>smooth(-.10,.31,cover(x+27,z-13))*(.4+.6*smooth(118,179,Math.abs(x))),
    (x,z)=>(z< -61 || Math.abs(x)>122)&&roadDistance(x,z)>4.8&&rootClear(x,z,6)
      &&rubber.every(p=>(p.x-x)**2+(p.z-z)**2>4.5**2)&&slope(x,z)<.65);
  const shrubs=scatter(320,{x0:-154,x1:160,z0:-92,z1:78},1.45,1.05,47,
    (x,z)=>{
      const edge=Math.max(Math.exp(-(((Math.abs(x)-128)/19)**2)),
        Math.exp(-(((z+77)/11)**2)),Math.exp(-(((z-67)/9)**2)));
      const patch=n.fbm(x/17+8,z/17)*.7+n2.noise(x/5,z/5)*.3;
      return edge*smooth(-.12,.3,patch);
    },(x,z)=>roadDistance(x,z)>1.25&&rootClear(x,z,2)
      &&smallTrees.every(p=>(p.x-x)**2+(p.z-z)**2>1.1**2)&&slope(x,z)<.75);
  const proxies=scatter(96,{...footprint,z1:-133},3.8,6.5,73,
    (x,z)=>smooth(-.02,.25,cover(x-12,z+34))*(.5+.5*smooth(140,182,Math.abs(z))),
    (x,z)=>roadDistance(x,z)>8&&slope(x,z)<.7
      &&rubber.every(p=>(p.x-x)**2+(p.z-z)**2>3.2**2)
      &&smallTrees.every(p=>(p.x-x)**2+(p.z-z)**2>3.0**2));
  return {rubber,smallTrees,shrubs,proxies,seed};
}
