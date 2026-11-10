import {parks, productionSites} from '../../../shared/parkCatalog.ts';
import type {Site} from './model';

export type CollectionPoint = {
  id: string;
  site: Exclude<Site, 'xian'>;
  name: string;
  kind: '收胶点' | '加工厂';
  distanceKm: number;
  latexPrice: number;
  position: {x: number; y: number};
  services: string[];
  receivingHours: string;
  capacity: string;
};

// Fictional fixtures for comparing destinations; these are not live quotations or GPS locations.
export const collectionPointAsOf = '2026-10-19';
export const collectionQuoteBasis = '鲜胶乳 · 干胶含量 30% · 人民币元 / kg 鲜胶乳';
const baseCollectionPoints: Record<'hainan'|'xsbn'|'xian', readonly CollectionPoint[]> = {
  hainan: [
    {id: 'hn-collection-a', site: 'hainan', name: '海南示例收胶点 A', kind: '收胶点', distanceKm: 3.2, latexPrice: 7.2, position: {x: 185, y: 95}, services: ['称重登记', '干胶含量取样', '暂存集运'], receivingHours: '示例 06:00—12:00', capacity: '示例日接收 2 吨',},
    {id: 'hn-collection-b', site: 'hainan', name: '海南示例收胶点 B', kind: '收胶点', distanceKm: 5.8, latexPrice: 7.4, position: {x: 390, y: 100}, services: ['称重登记', '质量取样', '批次交接'], receivingHours: '示例 06:30—13:00', capacity: '示例日接收 3 吨'},
    {id: 'hn-processing-a', site: 'hainan', name: '海南示例加工厂 A', kind: '加工厂', distanceKm: 12.6, latexPrice: 7.5, position: {x: 480, y: 260}, services: ['鲜胶乳验收', '集中加工', '成品批次登记'], receivingHours: '示例 07:00—16:00', capacity: '示例日加工 10 吨'},
  ],
  xsbn: [
    {id: 'xs-collection-a', site: 'xsbn', name: '西双版纳示例收胶点 A', kind: '收胶点', distanceKm: 2.4, latexPrice: 7.1, position: {x: 185, y: 95}, services: ['称重登记', '干胶含量取样', '暂存集运'], receivingHours: '示例 06:00—12:30', capacity: '示例日接收 2 吨'},
    {id: 'xs-collection-b', site: 'xsbn', name: '西双版纳示例收胶点 B', kind: '收胶点', distanceKm: 6.1, latexPrice: 7.3, position: {x: 390, y: 100}, services: ['称重登记', '质量取样', '批次交接'], receivingHours: '示例 07:00—14:00', capacity: '示例日接收 4 吨'},
    {id: 'xs-processing-a', site: 'xsbn', name: '西双版纳示例加工厂 A', kind: '加工厂', distanceKm: 15.3, latexPrice: 7.35, position: {x: 480, y: 260}, services: ['鲜胶乳验收', '集中加工', '成品批次登记'], receivingHours: '示例 07:30—16:30', capacity: '示例日加工 12 吨'},
  ],
  xian: [],
};

export const collectionPointSamples = Object.fromEntries([
  ['xian', []],
  ...productionSites.map(site=>{
    if(site==='hainan'||site==='xsbn')return [site,baseCollectionPoints[site]];
    const park=parks[site],base=baseCollectionPoints[park.sceneTemplate==='xsbn'?'xsbn':'hainan'];
    return [site,base.map((point,index)=>({...point,
      id:`${site}-${point.kind==='收胶点'?'collection':'processing'}-${index+1}`,site,
      name:`${park.name}示例${point.kind} ${index===1?'B':'A'}`,
      distanceKm:Number((point.distanceKm+(park.offset%5)*.6).toFixed(1)),
      latexPrice:Number((point.latexPrice+(park.offset%4)*.05).toFixed(2)),
    }))];
  }),
]) as Record<Site,readonly CollectionPoint[]>;
