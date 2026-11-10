import * as THREE from "three";
import type { installGroundSample } from "./groundSample";
import {SCENE_ZONE_CENTERS} from './sceneTreeLayout';
import {chunkVegetation} from './vegetationChunks';

type Sample = ReturnType<typeof installGroundSample>;
const smooth = THREE.MathUtils.smoothstep;
function hash(x: number, z: number) {
  const n = Math.sin(x * 127.1 + z * 311.7 + 41.3) * 43758.5453;
  return n - Math.floor(n);
}
function noise(x: number, z: number) {
  const a=Math.floor(x),b=Math.floor(z),u=smooth(x-a,0,1),v=smooth(z-b,0,1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(a,b),hash(a+1,b),u),
    THREE.MathUtils.lerp(hash(a,b+1),hash(a+1,b+1),u),v);
}

/** Small folded, curved leaves: real silhouette, no crossed alpha cards.
 * Two authored-in-code variants, metre units. No downloaded assets.
 */
function tuftGeometry(broad: boolean) {
  const positions: number[]=[], colors: number[]=[], indices: number[]=[];
  const dark=new THREE.Color(broad ? "#45542b" : "#596338");
  const light=new THREE.Color(broad ? "#7b9050" : "#8d9854");
  const count=broad ? 7 : 14;
  for(let leaf=0;leaf<count;leaf++) {
    const angle=leaf*2.39996+hash(leaf,7)*.5;
    const dx=Math.cos(angle),dz=Math.sin(angle);
    const height=(broad ? .13 : .19)*( .65+hash(leaf,1)*.65);
    const reach=(broad ? .19 : .23)*(.65+hash(leaf,3)*.7);
    const width=broad ? .033 : .014;
    const spread=broad ? .05 : .16;
    const bx=dx*hash(leaf,9)*spread,bz=dz*hash(leaf,9)*spread;
    const base=positions.length/3;
    for(let row=0;row<3;row++) {
      const t=row*.36;
      const w=width*(broad ? Math.sin((t*.8+.13)*Math.PI) : 1-t*.55);
      const x=bx+dx*reach*t*t,z=bz+dz*reach*t*t,y=height*Math.sin(t*1.6);
      for(let side=-1;side<=1;side++) {
        positions.push(x-dz*w*side,y+(side===0?w*.26:0),z+dx*w*side);
        const color=dark.clone().lerp(light,.18+t*.65+hash(leaf,13)*.12);
        colors.push(color.r,color.g,color.b);
      }
    }
    positions.push(bx+dx*reach,height*.91,bz+dz*reach);
    colors.push(light.r,light.g,light.b);
    for(let row=0;row<2;row++) for(let side=0;side<2;side++) {
      const a=base+row*3+side;
      indices.push(a,a+3,a+1,a+1,a+3,a+4);
    }
    indices.push(base+6,base+9,base+7,base+7,base+9,base+8);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createSampleGroundCover(sample: Sample, options: { bounds?: Sample["bounds"]; spacing?: number } = {}) {
  const group=new THREE.Group();
  group.name="Sample_GroundCover_NonBusiness";
  const started=performance.now();
  const sites: {x:number;z:number;y:number;scale:number;broad:boolean;normal:THREE.Vector3}[]=[];
  const b=sample.bounds;
  const terrainPositions=sample.mesh.geometry.attributes.position;
  const gridStep=sample.step;
  const columns=Math.round((b.maxX-b.minX)/gridStep)+1;
  const surface=(x:number,z:number)=>{
    if(x<=b.minX+gridStep||x>=b.maxX-gridStep||z<=b.minZ+gridStep||z>=b.maxZ-gridStep)return sample.field(x,z).height;
    const gx=(x-b.minX)/gridStep,gz=(z-b.minZ)/gridStep;
    const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz;
    const a=terrainPositions.getY(iz*columns+ix),c=terrainPositions.getY(iz*columns+ix+1);
    const d=terrainPositions.getY((iz+1)*columns+ix),e=terrainPositions.getY((iz+1)*columns+ix+1);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,c,u),THREE.MathUtils.lerp(d,e,u),v);
  };
  // Reuse the already sampled terrain masks. Re-evaluating roads, drains and
  // hundreds of canopy neighbours for every blade made initial loading stall.
  const layers=sample.mesh.geometry.attributes.gsSurface;
  const coverField=(x:number,z:number)=>{
    if(x<=b.minX+gridStep||x>=b.maxX-gridStep||z<=b.minZ+gridStep||z>=b.maxZ-gridStep)return sample.field(x,z);
    const gx=(x-b.minX)/gridStep,gz=(z-b.minZ)/gridStep,ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz;
    const at=(c:number)=>{const read=(i:number)=>layers.getComponent(i,c);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(read(iz*columns+ix),read(iz*columns+ix+1),u),THREE.MathUtils.lerp(read((iz+1)*columns+ix),read((iz+1)*columns+ix+1),u),v);};
    return {litter:at(0),roadMask:at(1),wet:at(2),contact:at(3)};
  };
  // A bounded footprint inside the existing sample, not a new map extension.
  const footprint=options.bounds ?? b;
  const step=options.spacing ?? .38;
  for(let x=footprint.minX+7;x<footprint.maxX-7;x+=step) for(let z=footprint.minZ+7;z<footprint.maxZ-7;z+=step) {
    const px=x+(hash(x,z)-.5)*step*1.65,pz=z+(hash(z,x+9)-.5)*step*1.65;
    const boundaryDistance=Math.max(b.minX-px,px-b.maxX,b.minZ-pz,pz-b.maxZ);
    // Broad, warped patches rather than an evenly thinned lattice on the hillside.
    const warpX=px+(noise(px*.029,pz*.029)-.5)*24;
    const warpZ=pz+(noise(px*.027+53,pz*.027)-.5)*24;
    const colony=noise(warpX*.075,warpZ*.075);
    const hillsideBlend=smooth(boundaryDistance+(colony-.5)*35,-55,115);
    const retention=THREE.MathUtils.lerp(1,.16+.50*smooth(colony,.32,.72),hillsideBlend);
    if(hash(x+101,z)>retention)continue;
    const f=coverField(px,pz);
    const inWorkingStrip=SCENE_ZONE_CENTERS.some(c=>Math.abs(px-c.x)<17&&Array.from({length:5},(_,i)=>c.z+(i-2)*7+Math.sin(((px-c.x)/3+4.5)*.6)*.8+1.7).some(z=>Math.abs(pz-z)<1.25));
    if(inWorkingStrip)continue;
    if(f.roadMask>.12 || f.wet>.48 || f.contact>.01) continue;
    const patch=noise(warpX*.23,warpZ*.23);
    const fine=noise(px*.83+11,pz*.83);
    const density=smooth(patch,.31,.67)*(.38+.62*fine);
    if(hash(px+83,pz+19)>density*.82) continue;
    const edge=smooth(Math.min(px-footprint.minX-7,footprint.maxX-7-px,pz-footprint.minZ-7,footprint.maxZ-7-pz),0,50);
    if(hash(px+9,pz+33)>edge) continue;
    const normal=new THREE.Vector3(surface(px-.15,pz)-surface(px+.15,pz),.3,
      surface(px,pz-.15)-surface(px,pz+.15)).normalize();
    sites.push({x:px,z:pz,y:surface(px,pz)-.018,normal,
      scale:.9+hash(px+1,pz)*1.4,broad:hash(px,pz+41)>.72});
  }
  // Dry litter follows canopy coverage throughout the garden, not a rectangular demo patch.
  const leafSites:THREE.Vector3[]=[];
  for(let x=Math.max(b.minX,footprint.minX)+2;x<Math.min(b.maxX,footprint.maxX)-2;x+=2.0)for(let z=Math.max(b.minZ,footprint.minZ)+2;z<Math.min(b.maxZ,footprint.maxZ)-2;z+=2.0){
    const px=x+hash(x,z),pz=z+hash(z,x),f=coverField(px,pz);
    if(f.roadMask>.12||f.contact>.2||f.litter<.3||hash(px+47,pz)>.7)continue;
    for(let n=0;n<2;n++){const lx=px+(hash(x+n,z)-.5)*.6,lz=pz+(hash(z+n,x)-.5)*.6;leafSites.push(new THREE.Vector3(lx,surface(lx,lz)+.008,lz));}
  }
  const leaves=new THREE.InstancedMesh(new THREE.CircleGeometry(.085,5),new THREE.MeshStandardMaterial({color:'#66503a',roughness:1,side:THREE.DoubleSide}),leafSites.length);
  leaves.name='Canopy_Leaf_Litter';const leafTransform=new THREE.Object3D();
  leafSites.forEach((p,i)=>{leafTransform.position.copy(p);leafTransform.rotation.set(-Math.PI/2,0,hash(i,3)*Math.PI*2);leafTransform.scale.set(1,.45+hash(i,4)*.3,1);leafTransform.updateMatrix();leaves.setMatrixAt(i,leafTransform.matrix);});
  leaves.receiveShadow=true;leaves.instanceMatrix.needsUpdate=true;leaves.computeBoundingSphere();group.add(leaves);
  const counts=[0,0];
  // Optional surface trial: tint directly beneath the existing tuft sites.
  // Geometry locations/counts and the original density field stay unchanged.
  const coverAttribute=sample.mesh.geometry.getAttribute("gsCover");
  if(sample.coverMask) {
    const {data,width,height}=sample.coverMask.image;
    const texels=data as Uint8Array;
    const stepX=(b.maxX-b.minX)/width,stepZ=(b.maxZ-b.minZ)/height;
    for(const site of sites){
      const radius=.45*site.scale;
      const cx=Math.floor((site.x-b.minX)/stepX),cz=Math.floor((site.z-b.minZ)/stepZ);
      const reach=Math.ceil(radius/Math.min(stepX,stepZ));
      for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++){
        const ix=cx+dx,iz=cz+dz;
        if(ix<0||ix>=width||iz<0||iz>=height)continue;
        const distance=Math.hypot(b.minX+(ix+.5)*stepX-site.x,b.minZ+(iz+.5)*stepZ-site.z);
        const weight=Math.round((1-smooth(distance,0,radius))*.85*255);
        texels[iz*width+ix]=Math.max(texels[iz*width+ix],weight);
      }
    }
    sample.coverMask.needsUpdate=true;
  } else if(coverAttribute) {
    for(const site of sites) {
      const radius=.45*site.scale;
      const cx=Math.round((site.x-b.minX)/gridStep),cz=Math.round((site.z-b.minZ)/gridStep);
      const reach=Math.ceil(radius/gridStep);
      for(let dz=-reach;dz<=reach;dz++) for(let dx=-reach;dx<=reach;dx++) {
        const ix=cx+dx,iz=cz+dz,index=iz*columns+ix;
        if(ix<0 || ix>=columns || index<0 || index>=coverAttribute.count) continue;
        const distance=Math.hypot(b.minX+ix*gridStep-site.x,b.minZ+iz*gridStep-site.z);
        const weight=(1-smooth(distance,0,radius))*.85;
        coverAttribute.setX(index,Math.max(coverAttribute.getX(index),weight));
      }
    }
    coverAttribute.needsUpdate=true;
  }
  for(const broad of [false,true]) {
    const selected=sites.filter(s=>s.broad===broad);
    const geometry=tuftGeometry(broad);
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,
      metalness:0,side:THREE.DoubleSide,name:broad?"Sample_LowHerb":"Sample_ShortGrass"});
    const mesh=new THREE.InstancedMesh(geometry,material,selected.length);
    mesh.name=material.name;
    mesh.receiveShadow=true;
    // Sub-30cm leaves receive canopy shadows; avoid a separate alpha/depth
    // pass and shadow acne from sub-pixel foliage at this trial's sun-map scale.
    mesh.castShadow=false;
    mesh.userData={role:"visual-only",selectable:false};
    const transform=new THREE.Object3D();
    const up=new THREE.Vector3(0,1,0), yaw=new THREE.Quaternion();
    selected.forEach((site,index)=>{
      transform.position.set(site.x,site.y,site.z);
      transform.quaternion.setFromUnitVectors(up,site.normal);
      transform.quaternion.multiply(yaw.setFromAxisAngle(up,hash(site.x,site.z+17)*Math.PI*2));
      transform.scale.setScalar(site.scale);
      transform.updateMatrix();mesh.setMatrixAt(index,transform.matrix);
      mesh.setColorAt(index,new THREE.Color().setRGB(.86+hash(site.x+3,site.z)*.14,.91+hash(site.x+3,site.z)*.09,.84+hash(site.x+3,site.z)*.12));
    });
    mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    counts[broad?1:0]=selected.length;
  }
  const chunkCount=chunkVegetation(group);
  const stats={grassTufts:counts[0],lowHerbs:counts[1],variants:2,chunkCount,
    triangles:counts[0]*140+counts[1]*70+leafSites.length*5,leafLitter:leafSites.length,drawCalls:3,buildMs:performance.now()-started};
  return {group,stats,dispose:()=>{group.userData.disposeChunks?.();group.children.forEach(mesh=>(mesh as THREE.InstancedMesh).dispose());}};
}
