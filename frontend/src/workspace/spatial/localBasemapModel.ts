import {BASEMAP_SHAPES} from './localBasemapData.ts';
import {projectPoint,TILE_SIZE,type GeoView,type MapSize} from './geoMapModel.ts';

/** Preprojected local outlines: selecting a layer does not fetch or parse a basemap. */
export function localBasemap(view:GeoView,size:MapSize){
  const scale=2**view.zoom,center=projectPoint(view.center,0);
  const left=center.x-size.width/(2*scale),right=center.x+size.width/(2*scale);
  const top=center.y-size.height/(2*scale),bottom=center.y+size.height/(2*scale);
  // At tree scale, show the supplied park/plot/tree coordinates on a metric grid.
  // A continental outline is not a surveyed field or street map.
  const paths=[];
  if(view.zoom<=12)for(let copy=Math.floor(left/TILE_SIZE);copy<=Math.floor(right/TILE_SIZE);copy++){
    const shift=copy*TILE_SIZE;
    for(const shape of BASEMAP_SHAPES){
      if(shape.kind==='province'&&view.zoom<4)continue;
      const [x0,y0,x1,y1]=shape.bounds;
      if(x1+shift<left||x0+shift>right||y1<top||y0>bottom)continue;
      paths.push({id:`${copy}:${shape.id}`,kind:shape.kind,path:shape.path,
        transform:`translate(${size.width/2-(center.x-shift)*scale} ${size.height/2-center.y*scale}) scale(${scale})`});
    }
  }
  return paths;
}
