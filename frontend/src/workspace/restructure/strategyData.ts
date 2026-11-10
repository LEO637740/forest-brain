/** Replace this repository with persisted database / Harness snapshots when available. */
export const strategyMeta={id:'HN-20260922-v1',site:'hainan',generated_at:'2026-09-22 08:00',data_as_of:'2026-09-22 07:30',valid_until:'2026-09-23 08:00',source:'统一策略演示样本',sample:true,model:'情景算式 v1 · 非训练预测模型'};
export const priceSeries=Array.from({length:104},(_,i)=>({date:new Date(Date.UTC(2026,5,25+i)).toISOString().slice(0,10),value:i<90?14800+i*8+Math.sin(i*.19)*360+Math.cos(i*.71)*95:(14800+89*8+Math.sin(89*.19)*360+Math.cos(89*.71)*95)+(i-89)*24,forecast:i>=90,band:i>=90?220+(i-90)*20:0}));
export const logistics={opening:72,capacity:120,transport:80,treeLimit:64,weatherLimit:60,dryContent:.34,productionCost:2.4,transportCost:.35,holdingCost:.04};
export const plans=[{id:'protect',name:'保护树体',requested:44},{id:'steady',name:'保持节奏',requested:56},{id:'increase',name:'约束下增产',requested:72}];
export function simulate(requested:number,transport:number,capacity=120){
 let stock=logistics.opening;
 return Array.from({length:7},(_,i)=>{const opening=stock;const storageLimit=Math.max(0,capacity-opening+transport);const production=Math.max(0,Math.min(requested,logistics.treeLimit,logistics.weatherLimit,storageLimit));const shipped=Math.min(transport,opening+production);stock=opening+production-shipped;const price=priceSeries[90+i].value/1000*logistics.dryContent;const revenue=shipped*price;const cost=production*logistics.productionCost+shipped*logistics.transportCost+stock*logistics.holdingCost;return {day:'09.'+(23+i),opening,production,shipped,stock,revenue,cost,margin:revenue-cost,limited:requested-production};});
}
export const batches=[{id:'HN-0922-01',kg:28,destination:'海南加工点 A',state:'待装车',start:9,end:11},{id:'HN-0922-02',kg:24,destination:'海南加工点 A',state:'待质检',start:11,end:14},{id:'HN-0922-03',kg:20,destination:'合作加工点 B',state:'待交接',start:14,end:17}];
export const healthSeries=Array.from({length:14},(_,i)=>({date:'09.'+String(i+9).padStart(2,'0'),b:[2,2,3,3,4,4,4,5,5,6,6,7,8,8][i],c:[1,1,1,2,2,2,2,2,3,3,3,4,4,4][i]}));
export const treeStrategies=[
 {id:'TREE-001',index:44,type:'角度优化',name:'HN-A-0045',mode:'需复核',advice:'保留原角度，先核验黏度与树皮观测',before:'30°',after:'28° 候选',evidence:'树皮观测样本 / 黏度输入缺测',limit:'角度与增产关系尚未验证；不自动下发设备',gain:'尚无实测增益',confidence:'证据不足'},
 {id:'TREE-002',index:71,type:'表面识别',name:'HN-B-0022',mode:'需复核',advice:'结节疑似区域暂停切入，复核后规划绕行',before:'原割线',after:'跳过疑似区域',evidence:'现场表面识别样本 / 结节候选',limit:'不得将候选标签视为确诊；保留现场确认',gain:'避免接触疑似凸起',confidence:'待核验'},
 {id:'TREE-003',index:101,type:'表面识别',name:'HN-C-0002',mode:'规则建议',advice:'表面污染先清理并复拍，再判断能否继续',before:'污染候选',after:'清理 → 复拍',evidence:'鸟粪/泥巴分类演示 / 原始图待接入',limit:'复拍异常或识别不确定时转人工',gain:'减少不必要的跳过',confidence:'规则演示'},
 {id:'TREE-004',index:145,type:'生长与割线',name:'HN-C-0046',mode:'仅供参考',advice:'下一周期重新测量树围与可用割面',before:'当前割面',after:'下周期复测',evidence:'树体档案与月度生长样本',limit:'没有新的测量数据，不自动改割线',gain:'规划后续可用割面',confidence:'待观测'},
];
export type ReviewRecord={id:string;topic:string;action:string;time:string;snapshot:string};
export const strategyRepository={getSnapshot:()=>({meta:strategyMeta,prices:priceSeries,logistics,batches,health:healthSeries,trees:treeStrategies})};
