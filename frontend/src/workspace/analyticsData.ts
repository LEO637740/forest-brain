import {parks, productionSites} from '../../../shared/parkCatalog.ts';
import type { Site } from './model';
import {allocateTreeSamples, treeScopeSeries, type AnalyticsDatum, type TreeSample} from '../../../shared/analyticsScope.ts';
export type Datum = AnalyticsDatum;
export type {TreeSample} from '../../../shared/analyticsScope.ts';

const REPORT_END = Date.UTC(2026, 8, 22);
function reportDate(index: number) {
  return new Date(REPORT_END - (29 - index) * 86_400_000).toISOString().slice(0, 10);
}

const BASE_DATA: Record<'hainan' | 'xsbn', Datum[]> = {
  hainan: Array.from({ length: 30 }, (_, i) => ({
    date: reportDate(i),
    actual: [44,48,51,47,53,55,49,46,52,54,43,49,51,56,50,47,53,57,52,51,49,54,58,56,50,55,59,57,53,56][i],
    forecast: [48,50,52,51,54,56,55,53,55,57,52,54,56,58,57,55,57,59,58,57,56,58,60,59,57,59,61,60,58,60][i],
    rain: [2,0,6,0,1,8,12,5,0,0,22,31,14,3,0,2,0,0,4,7,12,3,0,0,9,4,0,0,6,3][i],
    taps: [132,141,149,145,153,158,147,136,151,155,118,137,146,160,152,142,156,164,151,148,143,157,169,163,149,161,174,168,154,166][i],
  })),
  xsbn: Array.from({ length: 30 }, (_, i) => ({
    date: reportDate(i),
    actual: [35,38,40,36,42,43,39,37,41,44,38,40,43,45,42,39,44,46,43,42,41,45,47,46,43,46,48,47,45,46][i],
    forecast: [39,41,42,41,44,45,44,43,45,47,44,45,47,48,47,45,47,49,48,47,46,48,50,49,47,49,51,50,49,50][i],
    rain: [4,1,9,3,0,12,18,8,2,1,26,34,17,6,1,4,0,2,7,10,16,5,2,1,12,7,2,1,8,5][i],
    taps: [111,120,126,115,131,134,122,117,129,136,119,125,135,141,132,121,138,144,134,130,127,140,149,145,133,143,152,147,139,146][i],
  })),
};

// Each production park has its own reproducible demo series.
export const DATA = Object.fromEntries(productionSites.map(site=>{
  if(site==='hainan'||site==='xsbn')return [site,BASE_DATA[site]];
  const park=parks[site],base=BASE_DATA[park.sceneTemplate==='xsbn'?'xsbn':'hainan'];
  const factor=.82+(park.offset%9)*.035;
  return [site,base.map((row,index)=>({...row,
    actual:Number((row.actual*factor+(index+park.offset)%3).toFixed(1)),
    forecast:Number((row.forecast*factor).toFixed(1)),
    rain:Number((row.rain*(.85+(park.offset%5)*.06)).toFixed(1)),
    taps:Math.round(row.taps*(.9+(park.offset%4)*.02)),
  }))];
})) as Record<Exclude<Site,'xian'>,Datum[]>;

export type HomeTrendPoint = Readonly<Pick<Datum, 'date' | 'actual' | 'forecast'>>;

/** Sum of recent latex observations; Xi'an has no production data. */
export function getRecentLatex(site: Site, days = 7): number | null {
  if (site === 'xian') return null;
  return Number(DATA[site].slice(-Math.max(1, days)).reduce((sum, item) => sum + item.actual, 0).toFixed(1));
}

/** Compact production series for the home page; Xi'an intentionally returns no points. */
export function getHomeTrend(site: Site, days = 7): HomeTrendPoint[] {
  if (site === 'xian') return [];
  return DATA[site].slice(-Math.max(1, days)).map(({ date, actual, forecast }) => ({ date, actual, forecast }));
}


/**
 * A reproducible, tree-specific production sample for the single-tree drawer.
 *
 * The park series is deliberately scaled to a single tree instead of reusing
 * the park total.  The index-dependent factor gives every tree its own curve
 * while keeping all values visibly within the illustrative range of the park
 * sample.  This remains a demo fixture: it is not a sensor or collection
 * record and must not be presented as measured latex.
 */
export type TreeYieldPoint = { date:string; actual:number; forecast:number; rain:number; taps:number };
export function getTreeYieldSeries(index:number, site:Site='hainan', days=5):TreeYieldPoint[] {
 if(site==='xian')return [];
 const rows=DATA[site].slice(-Math.max(1,days));
 const safeIndex=Math.max(0,Math.floor(index));
 const factor=.78+((safeIndex*37+(site==='xsbn'?11:parks[site].offset))%35)/100;
 const slope=((safeIndex%9)-4)*.004;
 return rows.map((row,i)=>{
  const perTap=row.actual/Math.max(row.taps,1);
  const perTapForecast=row.forecast/Math.max(row.taps,1);
  const variation=1+slope*(i-(rows.length-1)/2);
  return {date:row.date,actual:Number((perTap*factor*variation).toFixed(3)),forecast:Number((perTapForecast*factor*variation).toFixed(3)),rain:row.rain,taps:row.taps};
 });
}
// Deterministic illustrative allocation. Daily totals remain identical to source series.
export function allocateTrees(rows: Datum[], offset = 0): TreeSample[] {
 return allocateTreeSamples(rows,offset);
}
export function blockSeries(rows:Datum[],block:string,offset:number):Datum[]{
 if(block==='all')return rows;
 return treeScopeSeries(rows,Array.from({length:50},(_,index)=>'ABCD'.indexOf(block)*50+index),offset);
}
