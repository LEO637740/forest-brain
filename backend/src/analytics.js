import {parkSite,normalizeSiteId} from './adapters/park-demo.js';
import {treeScopeSeries} from '../../shared/analyticsScope.ts';

export function analyticsSeries(site, now, days=30, identity=null) {
  const end=new Date(now); end.setUTCHours(0,0,0,0);
  const key = String(site || 'hainan').toLowerCase();
  const config=parkSite(key),offset=key==='xsbn'?11:key==='xian'?23:config.offset,highland=config.climate==='tropical_highland',trial=config.climate==='temperate_trial';
  const rows=Array.from({length:days},(_,i)=>{const d=new Date(+end-(days-1-i)*86400000),seed=(i*17+offset*13)%31;const rain=[0,2,5,0,8,14,3,0,1,6,0,11,4,0,2,18,7,0,3,5,0,9,1,0,4,12,0,2,6,0][(i+offset)%30];const actual=highland?38+((i*7+offset)%13)+Math.round(rain*.09):trial?31+((i*5+offset)%11)+Math.round(rain*.07):48+((i*9+offset)%15)+Math.round(rain*.11);const taps=highland?118+((i*11+offset)%36):trial?64+((i*9+offset)%24):142+((i*13+offset)%42);return {date:d.toISOString().slice(0,10),actual,forecast:actual+2+(seed%4),rain,taps};});
  const siteId=normalizeSiteId(key);
  const treeIndices=identity?.plot ? identity.treeIds(siteId).map(id=>Number(id.slice(2))-1) : undefined;
  return {site:key,siteId,asOf:end.toISOString(),rows:treeScopeSeries(rows,treeIndices),
    source:{mode:'backend_demo',label:treeIndices?'后端可复现演示序列 · 承包范围':'后端可复现演示序列',rainfall:'按日期生成的历史样本；未接入园区雨量计'}};
}
