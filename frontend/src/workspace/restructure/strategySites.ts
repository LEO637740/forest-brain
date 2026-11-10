import {strategyMeta,logistics,plans,batches,treeStrategies,priceSeries} from './strategyData';
export type ProductionSite='hainan'|'xsbn';
export function siteSnapshot(site:ProductionSite){const xs=site==='xsbn';return {
 meta:{...strategyMeta,id:xs?'XS-20260922-v1':strategyMeta.id,site},
 name:xs?'西双版纳':'海南',prefix:xs?'XS':'HN',
 logistics:xs?{...logistics,opening:96,capacity:160,transport:60,treeLimit:58,weatherLimit:50}:logistics,
 plans:xs?plans.map((p,i)=>({...p,requested:[36,46,62][i]})):plans,
 batches:xs?[{id:'XS-0922-01',kg:40,destination:'勐腊加工点',state:'待质检',start:9,end:12},{id:'XS-0922-02',kg:32,destination:'景洪加工点',state:'待装车',start:12,end:15},{id:'XS-0922-03',kg:24,destination:'合作加工点 C',state:'待交接',start:15,end:18}]:batches,
 trees:treeStrategies.map((t,i)=>xs?{...t,id:'XS-'+t.id,name:['XS-A-0025','XS-B-0012','XS-C-0017','XS-D-0009'][i],evidence:'西双版纳独立演示观测 / '+t.evidence,index:[24,61,116,158][i]}:t),
 risk:xs?[{block:'A',count:3,type:'叶片斑点',action:'需要现场核验'},{block:'D',count:6,type:'叶片缺损',action:'需要现场核验'}]:[{block:'B',count:8,type:'叶片变化',action:'需要现场核验'},{block:'C',count:4,type:'冠层变化',action:'继续观察'}]
};}
export function simulateSite(site:ProductionSite,requested:number,transport:number,capacity:number){const l=siteSnapshot(site).logistics;let stock=l.opening;return Array.from({length:7},(_,i)=>{const opening=stock,production=Math.max(0,Math.min(requested,l.treeLimit,l.weatherLimit,capacity-opening+transport)),shipped=Math.min(transport,opening+production);stock=opening+production-shipped;const revenue=shipped*priceSeries[90+i].value/1000*l.dryContent,cost=production*l.productionCost+shipped*l.transportCost+stock*l.holdingCost;return {day:'09.'+(23+i),opening,production,shipped,stock,revenue,cost,margin:revenue-cost,limited:requested-production};});}
export const weatherCases=[
 {id:'HN-03',site:'hainan',zone:'C',title:'晨间降雨 · 割胶窗口后移',count:28,original:[6,7.5],proposed:[8,9.5],reason:'降雨与原定割胶窗口重叠，建议待雨势减弱后复查割面。',state:'需复核'},
 {id:'HN-07',site:'hainan',zone:'A',title:'午后阵雨 · 收胶提前',count:32,original:[13,15],proposed:[11,13],reason:'午后有阵雨样本，建议提前收胶并准备遮雨措施。',state:'建议调整'},
 {id:'XS-04',site:'xsbn',zone:'B',title:'持续降雨 · 山地割胶延后',count:24,original:[6,8],proposed:[10,12],reason:'清晨降雨持续，需同时核验山地道路与树皮干燥情况。',state:'需复核'},
 {id:'XS-06',site:'xsbn',zone:'D',title:'雨后巡检 · 窗口调整',count:18,original:[8,10],proposed:[11,13],reason:'避开样本降雨高峰，完成巡检前不扩展作业范围。',state:'建议调整'}
] as const;

export const weatherSources={
 hainan:{id:'HN-WX-0922',name:'海南园区气象站',coverage:'A—D 区共用站点序列',rain:[.2,1.8,3.6,1.1,.3,0,0,.1,.4,1.8,3.1]},
 xsbn:{id:'XS-WX-0922',name:'西双版纳园区气象站',coverage:'A—D 区共用站点序列',rain:[2.1,3.4,4.6,3.1,1.8,.6,.2,0,0,.1,.2]}
};
export function adviceHistory(site:ProductionSite){const s=siteSnapshot(site);const entries=[
 {id:'market',topic:'市场与生产',object:s.name,advice:'按保持节奏情景安排生产，受养护、天气与储运共同约束',evidence:'价格样本 / 7日库存平衡 / '+s.logistics.transport+' kg每日运力',condition:'天气与仓储条件未出现新的变化'},
 {id:'logistics',topic:'储运与交付',object:s.name,advice:'按批次质检与交接窗口组织出库',evidence:s.batches.length+' 批 / 期初库存 '+s.logistics.opening+' kg',condition:'称重、质检和车辆确认完成'},
 ...s.risk.map(r=>({id:'health-'+r.block,topic:'健康与病虫害',object:s.name+' '+r.block+'区',advice:r.action,evidence:r.count+' 株'+r.type+'观测；未完成核验',condition:'需复拍与现场检查后再作病虫害判断'})),
 ...s.trees.map(t=>({id:t.id,topic:'一树一策',object:t.name,advice:t.advice,evidence:t.evidence,condition:t.limit})),
 ...weatherCases.filter(q=>q.site===site).map(q=>({id:q.id,topic:'天气与作业',object:s.name+' '+q.zone+'区 / '+q.id,advice:q.title,evidence:weatherSources[site].id+' / '+q.count+' 株关联任务',condition:'现场天气与作业条件复查通过'}))
 ];return entries.flatMap(e=>e.topic==='天气与作业'?[{...e,version:2,generated:'2026-09-22 08:00',asOf:'2026-09-22 07:30',state:'当前建议',change:'07:30气象更新后，调整原任务窗口',snapshot:s.meta.id},{...e,version:1,generated:'2026-09-21 18:00',asOf:'2026-09-21 17:30',state:'已被 v2 替代',advice:'保留原排程，晨间更新气象后重新核验',evidence:'前日排程样本 / 前日气象摘要',change:'初始排程建议',snapshot:s.prefix+'-20260921-v1'}]:[{...e,version:1,generated:'2026-09-22 08:00',asOf:'2026-09-22 07:30',state:'当前建议',change:'首次生成演示建议',snapshot:s.meta.id}]);}
