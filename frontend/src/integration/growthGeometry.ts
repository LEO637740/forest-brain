import {BufferGeometry,Float32BufferAttribute,Matrix4} from 'three';
// Quantized GLB attributes cannot hold world-space metres (> 1) in place.
export function bakeWorldGeometry(source:BufferGeometry,matrix:Matrix4){
 const geometry=source.clone();
 for(const name of ['position','normal','tangent']){
  const attribute=geometry.getAttribute(name);if(!attribute)continue;
  const values=new Float32Array(attribute.count*attribute.itemSize);
  for(let i=0;i<attribute.count;i++)for(let j=0;j<attribute.itemSize;j++)values[i*attribute.itemSize+j]=attribute.getComponent(i,j);
  geometry.setAttribute(name,new Float32BufferAttribute(values,attribute.itemSize));
 }
 return geometry.applyMatrix4(matrix);
}
// Geometry is an inspection illustration, not a robot tool path.
export function circumferenceRadius(cm:number){
 if(!Number.isFinite(cm)||cm<=0)throw Error('树围必须是有效正数');
 return cm/100/(2*Math.PI);
}
export function cutPoint(radius:number,angleDeg:number,t:number,rotation=0){
 const theta=-Math.PI/2+Math.PI*t+rotation;
 return {x:Math.sin(theta)*radius,y:1.5-Math.PI*t*radius*Math.tan(angleDeg*Math.PI/180),z:Math.cos(theta)*radius};
}
export function predictionDelta(current:number,predicted:number){return {cm:predicted-current,ratio:predicted/current};}
export function trunkSection(points:{x:number;y:number;z:number}[]){
 const band=points.filter(p=>Math.abs(p.y-1.3)<.2);
 if(band.length<3)throw Error('树干缺少1.3m附近的横截面顶点');
 const x=(Math.min(...band.map(p=>p.x))+Math.max(...band.map(p=>p.x)))/2;
 const z=(Math.min(...band.map(p=>p.z))+Math.max(...band.map(p=>p.z)))/2;
 const radius=Math.max(...band.map(p=>Math.hypot(p.x-x,p.z-z)));
 if(!Number.isFinite(radius)||radius<=0)throw Error('树干横截面无效');
 return {x,z,radius};
}
