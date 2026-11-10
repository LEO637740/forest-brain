import {SCENE_ZONE_CENTERS,sceneTreeLayout} from '../../sceneTreeLayout.ts';
/** Shared demonstration snapshot for the overview spatial layers.
 * Scene coordinates are metres, not surveyed longitude/latitude.
 * Yield allocation, health, density and logistics are illustrative samples.
 */
export const spatialMeta={source:'空间分析统一样本 v1',date:'2026-09-22',sample:true};
export const zoneCenters=SCENE_ZONE_CENTERS;
export const heightAt=(x:number,z:number)=>Math.sin(x*.032)*3.3+Math.cos(z*.041)*2.4+Math.sin((x+z)*.018)*2.2+Math.cos((x-z)*.024)*1.4;
export const roads=[
  {points:[[-115,62],[-64,40],[-21,10],[15,-5],[58,-38],[112,-58]],width:4.8},
  {points:[[-58,-76],[-42,-35],[-35,9],[-29,62]],width:2.7},
  {points:[[18,-74],[29,-34],[37,5],[55,58]],width:2.4},
  {points:[[78,-66],[74,-24],[81,18],[91,55]],width:2.3},
];
// Same managed trees as the 3D scene (shared 3 m × 7 m layout and seeded families).
export const spatialTrees=sceneTreeLayout().map(({x,z,zone,index,archetype,scale,rotation})=>({x,z,zone,index,archetype,scale,rotation,
  yieldWeight:.6+((index*37)%101)/100,
  risk:zone===1&&index-50>=21&&index-50<=28?2:zone===2&&(index-100)%13===0?1:0,
  frequency:2+(index*7)%5}));
export type SpatialLayer='base'|'yield'|'health'|'density'|'weather'|'work'|'slope';
export const layerInfo:Record<SpatialLayer,{title:string;description:string;legend:string[];colors:string[];source:string}>={
  base:{title:'地形与树冠',description:'现有场景的地形、道路与树冠；可聚焦四个作业区。',legend:['管理树冠','道路','园区边界'],colors:['#95b392','#c3b291','#d3dfd8'],source:'场景模型 · 非测绘/遥感'},
  yield:{title:'产胶分布',description:'树冠由浅至深表示分配量增加，保留实际模型高度。将园区近 7 日总量按样本权重分配至单树，区标签显示合计。',legend:['低分配量','中分配量','高分配量'],colors:['#d8e8b6','#83b8a0','#3c8e75'],source:'样本分配 · 非逐树实测'},
  health:{title:'健康风险',description:'显示当前园区健康建议中涉及树木，投射到统一模拟树位；不表示确诊。',legend:['未标记','关注','待巡检'],colors:['#81958a','#cfb379','#cc8278'],source:'园区健康建议 · 模拟位置 · 非诊断'},
  density:{title:'割胶频次',description:'每棵树只计入一个六边形。柱高和颜色均表示近30日平均割胶次数，避免把树多误读为频次高。点击单元查看树数、累计树次与均值。',legend:['2 次/树','4 次/树','6 次/树'],colors:['#a5d2c6','#639f94','#246b64'],source:'近30日频次样本 · 六边形聚合'},
  weather:{title:'降雨分布',description:'贴合园区曲面的降雨空间样本，色阶放大局部差异。时间轴选择参考序列时刻，空间细节为演示数据，不代表实测精度。',legend:['较低','参考值','较高'],colors:['#e3f0ed','#58a8b8','#143e70'],source:'固定演示气象序列 + 空间样本，非园区实测'},
  work:{title:'作业与设备',description:'读取当前园区任务，标记对应的模拟树位与任务状态。连线仅用于示意，不代表实际路径或实时轨迹。',legend:['已完成','计划','待处理'],colors:['#81cba5','#9eabb1','#cfb379'],source:'园区任务记录 · 模拟树位连线'},
  slope:{title:'地形高程',description:'色带直接贴合整个地形曲面，由低到高显示场景相对高程；不再使用等高线或悬浮高程标签。范围固定为−10至+10m，非实测海拔。',legend:['−10 m','0 m','+10 m'],colors:['#344f5a','#90a99a','#dfc79c'],source:'场景相对高程 · 非测绘'},
};
export const logisticsNodes=[
  {id:'collect',name:'园区收集点',x:-63,z:41,note:'批次 HN-0922-01 · 48 kg · 待转运'},
  {id:'store',name:'暂存仓',x:-112,z:64,note:'样本库存 72 / 120 kg · 可用 48 kg'},
  {id:'exit',name:'出园交接点',x:121,z:-62,note:'样本车辆载重 80 kg · 计划 15:30 发车'},
];
