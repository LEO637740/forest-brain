export type GeoPoint = {longitude: number; latitude: number};
export type GeoView = {center: GeoPoint; zoom: number};
export type MapSize = {width: number; height: number};
export type PixelPoint = {x: number; y: number};
export type MapTile = {id: string; url: string; left: number; top: number; size: number};

export const TILE_SIZE = 256;
// OSM serves tiles up to z19. Plantation rows 3 m apart need closer views, so z20–21
// enlarge the z19 tiles while markers stay exactly projected.
export const MAX_ZOOM = 21;
export const TILE_MAX_ZOOM = 19;
const MAX_LATITUDE = 85.0511287798066;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrap = (value: number, range: number) => ((value % range) + range) % range;
export const mapZoom = (zoom: number) => clamp(Math.round(zoom), 0, MAX_ZOOM);

// OSM standard tiles use the Web Mercator / slippy-map pixel grid.
// https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
export function projectPoint(point: GeoPoint, zoom: number): PixelPoint {
  const world = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(point.latitude, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI / 180;
  return {x: (point.longitude + 180) / 360 * world, y: (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * world};
}

export function unprojectPoint(point: PixelPoint, zoom: number): GeoPoint {
  const world = TILE_SIZE * 2 ** zoom;
  return {longitude: wrap(point.x / world * 360, 360) - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * clamp(point.y, 0, world) / world))) * 180 / Math.PI};
}

export function screenPoint(point: GeoPoint, view: GeoView, size: MapSize): PixelPoint {
  const projected = projectPoint(point, view.zoom), center = projectPoint(view.center, view.zoom);
  const world = TILE_SIZE * 2 ** view.zoom;
  const dx = wrap(projected.x - center.x + world / 2, world) - world / 2;
  return {x: size.width / 2 + dx, y: size.height / 2 + projected.y - center.y};
}

export function visibleTiles(view: GeoView, size: MapSize): MapTile[] {
  const tileZoom = Math.min(view.zoom, TILE_MAX_ZOOM), tileSize = TILE_SIZE * 2 ** (view.zoom - tileZoom);
  const center = projectPoint(view.center, view.zoom), count = 2 ** tileZoom;
  const left = center.x - size.width / 2, top = center.y - size.height / 2;
  const firstX = Math.floor(left / tileSize), lastX = Math.ceil((left + size.width) / tileSize) - 1;
  const firstY = Math.max(0, Math.floor(top / tileSize)), lastY = Math.min(count - 1, Math.ceil((top + size.height) / tileSize) - 1);
  const tiles: MapTile[] = [];
  for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
    const wrappedX = wrap(x, count), tileId = `${tileZoom}/${wrappedX}/${y}`;
    tiles.push({id: `${view.zoom}/${x}/${y}`, url: `https://tile.openstreetmap.org/${tileId}.png`, left: x * tileSize - left, top: y * tileSize - top, size: tileSize});
  }
  return tiles;
}

export function panView(view: GeoView, offset: PixelPoint): GeoView {
  const center = projectPoint(view.center, view.zoom);
  return {zoom: view.zoom, center: unprojectPoint({x: center.x - offset.x, y: center.y - offset.y}, view.zoom)};
}

export function zoomView(view: GeoView, zoom: number, anchor: PixelPoint, size: MapSize): GeoView {
  const nextZoom = mapZoom(zoom), center = projectPoint(view.center, view.zoom);
  const ratio = 2 ** (nextZoom - view.zoom);
  const offset = {x: anchor.x - size.width / 2, y: anchor.y - size.height / 2};
  return {zoom: nextZoom, center: unprojectPoint({x: (center.x + offset.x) * ratio - offset.x, y: (center.y + offset.y) * ratio - offset.y}, nextZoom)};
}

export function fitMapView(points: GeoPoint[], size: MapSize, padding = 64): GeoView | null {
  if (points.length === 0 || size.width === 0 || size.height === 0) return null;
  const origin = projectPoint(points[0], 0), world = TILE_SIZE;
  const projected = points.map(point => {
    const pixel = projectPoint(point, 0);
    return {x: origin.x + wrap(pixel.x - origin.x + world / 2, world) - world / 2, y: pixel.y};
  });
  const minX = Math.min(...projected.map(point => point.x)), maxX = Math.max(...projected.map(point => point.x));
  const minY = Math.min(...projected.map(point => point.y)), maxY = Math.max(...projected.map(point => point.y));
  const availableWidth = Math.max(1, size.width - padding * 2), availableHeight = Math.max(1, size.height - padding * 2);
  const zoom = Math.min(points.length === 1 ? 18 : MAX_ZOOM, Math.max(0, Math.floor(Math.min(
    maxX === minX ? MAX_ZOOM : Math.log2(availableWidth / (maxX - minX)),
    maxY === minY ? MAX_ZOOM : Math.log2(availableHeight / (maxY - minY)),
  ))));
  return {center: unprojectPoint({x: (minX + maxX) / 2, y: (minY + maxY) / 2}, 0), zoom};
}

export function mapScale(view: GeoView) {
  const metersPerPixel = 40075016.68557849 * Math.cos(view.center.latitude * Math.PI / 180) / (TILE_SIZE * 2 ** view.zoom);
  const target = metersPerPixel * 100, magnitude = 10 ** Math.floor(Math.log10(target));
  const distance = [5, 2, 1].map(step => step * magnitude).find(value => value <= target) ?? magnitude;
  return {pixels: distance / metersPerPixel, label: distance >= 1000 ? `${distance / 1000} km` : `${distance} m`};
}
