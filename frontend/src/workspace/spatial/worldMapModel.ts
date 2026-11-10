import {PROVINCE_OUTLINES} from '../../../../shared/chinaRubberProvinces.ts';
import {productionRegions, regions, type RegionId} from '../../../../shared/parkCatalog.ts';
import {RUBBER_PRODUCERS, RUBBER_PRODUCTION_SOURCE, type RubberProducer} from '../../../../shared/rubberProducers.ts';
import type {GeoArea, GeoMarker, GeoPoint} from './GeoMapCanvas';

export const CHINA_M49 = '159';
// Pinned names for the largest producers, placed so the Southeast Asian labels do not collide.
const PINNED: Record<string, GeoMarker['labelSide']> = {'764': 'left', '360': 'below', '384': 'below', '704': 'right', [CHINA_M49]: 'above'};
const largest = Math.max(...RUBBER_PRODUCERS.map(item => item.tonnes));

/** Bubble area is proportional to output, so the diameter follows its square root. */
export const bubbleSize = (tonnes: number) => Math.round(10 + 46 * Math.sqrt(tonnes / largest));
export const wanTonnes = (tonnes: number) => tonnes >= 100_000 ? (tonnes / 10_000).toFixed(1) : (tonnes / 10_000).toFixed(2);
export const worldShare = (tonnes: number) => tonnes / RUBBER_PRODUCTION_SOURCE.worldTonnes;

export function producerMarkers(selected: string | null): GeoMarker[] {
  // Draw the largest first so smaller bubbles stay clickable on top of them.
  return RUBBER_PRODUCERS.map((producer: RubberProducer): GeoMarker => ({
    id: `producer:${producer.m49}`, position: producer.position, kind: 'producer', size: bubbleSize(producer.tonnes),
    label: `${producer.name} · ${wanTonnes(producer.tonnes)} 万吨`, selected: producer.m49 === selected,
    ...(PINNED[producer.m49] ? {pinned: producer.name, labelSide: PINNED[producer.m49]} : {}),
    detail: producer.m49 === CHINA_M49 ? '进入中国，查看云南、海南、广东' : `占全球 ${(worldShare(producer.tonnes) * 100).toFixed(1)}%`,
  }));
}

export const provinceOutline = (region: RegionId): GeoPoint[] => PROVINCE_OUTLINES[region].map(([longitude, latitude]) => ({longitude, latitude}));
export const provincePoints = (): GeoPoint[] => productionRegions.flatMap(provinceOutline);

type SourceMetric = {name: string; value: number; unit: string; scope: string; period: string};
export type ProductionSource = {id: string; status: string; url?: string; data?: {metrics?: SourceMetric[]; publisher?: string; period?: string}};
export type DomesticFigure = {value: number; period: string; publisher: string; url?: string};
export type DomesticProduction = {national: DomesticFigure | null; hainan: DomesticFigure | null; rest: number | null};

const figure = (sources: ProductionSource[], id: string, metric: string): DomesticFigure | null => {
  const source = sources.find(item => item.id === id && item.status === 'available');
  const value = source?.data?.metrics?.find(item => item.name === metric && item.unit === '万吨');
  return source && value ? {value: value.value, period: value.period, publisher: source.data?.publisher ?? '', url: source.url} : null;
};

/** Official national and Hainan totals; Yunnan and Guangdong together only by subtraction for the same year. */
export function domesticProduction(sources: ProductionSource[] | undefined): DomesticProduction {
  const national = figure(sources ?? [], 'production_national', '天然橡胶产量');
  const hainan = figure(sources ?? [], 'production_hainan', '橡胶产量');
  const rest = national && hainan && national.period === hainan.period ? Math.round((national.value - hainan.value) * 100) / 100 : null;
  return {national, hainan, rest};
}

export function provinceAreas(selected: RegionId | null, production: DomesticProduction, parkCount: (region: RegionId) => number): GeoArea[] {
  return productionRegions.map(region => ({
    id: `region:${region}`, points: provinceOutline(region), selected: region === selected,
    label: region === 'hainan' && production.hainan ? `海南 · ${production.hainan.value} 万吨` : `${regions[region].name} · ${parkCount(region)} 个园区`,
  }));
}
