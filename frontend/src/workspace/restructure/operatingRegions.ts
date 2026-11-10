export type RegionView = 'production' | 'centers';
export type ProvinceFeature = {properties:{name:string};geometry:{type:string;coordinates:number[][][][]}};
export const productionProvinces=['云南省','海南省','广东省'];
export const centerProvinces=[...productionProvinces,'陕西省','浙江省'];

export function provincesForView(features:ProvinceFeature[],view:RegionView){
  const names=view==='production'?productionProvinces:centerProvinces;
  return features.filter(feature=>names.includes(feature.properties.name));
}

// A regional viewport keeps the production areas legible. Coordinates outside
// the viewport are clipped by the SVG; this is a regional view, not a full map.
export function regionalProjection(view:RegionView){
  const bounds=view==='production'?{west:97,east:119,south:17,north:30}:{west:97,east:124,south:17,north:41};
  const longitudeScale=Math.cos((bounds.north+bounds.south)/2*Math.PI/180);
  const width=(bounds.east-bounds.west)*longitudeScale,height=bounds.north-bounds.south;
  const scale=Math.min(550/width,364/height);
  const left=(630-width*scale)/2,top=(450-height*scale)/2;
  return ([lon,lat]:number[])=>[left+(lon-bounds.west)*longitudeScale*scale,top+(bounds.north-lat)*scale];
}

export function provincePath(feature:ProvinceFeature,project:(point:number[])=>number[]){
  const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates as unknown as number[][][]];
  return polygons.flatMap(polygon=>polygon.map(ring=>ring.map((point,index)=>{const [x,y]=project(point);return `${index?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ')+'Z')).join(' ');
}
