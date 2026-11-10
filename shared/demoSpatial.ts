import {parks, type Site} from './parkCatalog.ts';
export type DemoSpatialSite = Site;
export type DemoSpatialPoint = { longitude: number; latitude: number };
export type DemoSpatialZone = 'A' | 'B' | 'C' | 'D';

export const DEMO_SPATIAL_SOURCE = '内置园区模拟数据';
export const DEMO_SPATIAL_SITES: Record<DemoSpatialSite, {
  center: DemoSpatialPoint;
  elevationM: number;
  sourceName: string;
}> = Object.fromEntries(Object.values(parks).map(park => [park.key, {center: park.center, elevationM: park.elevationM, sourceName: DEMO_SPATIAL_SOURCE}])) as Record<DemoSpatialSite, {center: DemoSpatialPoint; elevationM: number; sourceName: string}>;

const rounded = (value: number, digits = 7) => Number(value.toFixed(digits));
// Conventional rubber planting: 3 m between trees in a row and 7 m between rows,
// about 32 trees per mu (Hainan University field comparison, 3 m × 7 m). Each zone
// holds 10 trees in each of 5 east–west rows; zones are separated by a 13 m track.
export const PLANT_SPACING_M = 3;
export const ROW_SPACING_M = 7;
const ZONE_HALF_WIDTH = 5 * PLANT_SPACING_M, ZONE_HALF_DEPTH = 2.5 * ROW_SPACING_M;
const zoneOffset = (zone: DemoSpatialZone) => ({
  east: (zone === 'B' || zone === 'D') ? 22 : -22,
  north: (zone === 'A' || zone === 'B') ? 22 : -22,
});

function position(site: DemoSpatialSite, east: number, north: number): DemoSpatialPoint {
  const { center } = DEMO_SPATIAL_SITES[site];
  return {
    longitude: rounded(center.longitude + east / (111320 * Math.cos(center.latitude * Math.PI / 180))),
    latitude: rounded(center.latitude + north / 111320),
  };
}

function rectangle(site: DemoSpatialSite, east: number, north: number, halfWidth: number, halfHeight: number): DemoSpatialPoint[] {
  return [
    position(site, east - halfWidth, north + halfHeight),
    position(site, east + halfWidth, north + halfHeight),
    position(site, east + halfWidth, north - halfHeight),
    position(site, east - halfWidth, north - halfHeight),
  ];
}

export function demoZoneCenter(site: DemoSpatialSite, zone: DemoSpatialZone): DemoSpatialPoint {
  const { east, north } = zoneOffset(zone);
  return position(site, east, north);
}

export function demoZoneBoundary(site: DemoSpatialSite, zone: DemoSpatialZone): DemoSpatialPoint[] {
  const { east, north } = zoneOffset(zone);
  return rectangle(site, east, north, ZONE_HALF_WIDTH, ZONE_HALF_DEPTH);
}

export function demoParkBoundary(site: DemoSpatialSite): DemoSpatialPoint[] {
  return rectangle(site, 0, 0, 22 + ZONE_HALF_WIDTH + 4, 22 + ZONE_HALF_DEPTH + 4);
}

// Each business zone has ten aligned trees in each of five evenly spaced rows.
// These are built-in simulated coordinates, not survey points; the 7–9 % ground
// slope is a modelled hillside, not a measured elevation.
export function demoTreePosition(site: DemoSpatialSite, index: number): DemoSpatialPoint & { elevationM: number } {
  const zone = 'ABCD'[Math.floor(index / 50)] as DemoSpatialZone;
  const local = index % 50, { east, north } = zoneOffset(zone);
  const x = east + (local % 10 - 4.5) * PLANT_SPACING_M;
  const y = north + (2 - Math.floor(local / 10)) * ROW_SPACING_M;
  return {
    ...position(site, x, y),
    elevationM: rounded(DEMO_SPATIAL_SITES[site].elevationM + x * 0.09 + y * 0.075 + Math.sin(index * 0.65) * 0.35, 2),
  };
}

export function isDemoSpatialRecord(record: { sourceName: string; provenanceMode: string }): boolean {
  return record.sourceName === DEMO_SPATIAL_SOURCE && record.provenanceMode === 'simulated';
}
