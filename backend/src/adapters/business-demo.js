import { digest, iso } from '../util.js';

// Fictional scenario data. Never write these into the real-source archive.
export function simulationRecord(topic, title, content, now, reason) {
  const stamp = digest({topic,content,asOf:iso(now)}).slice(0,12);
  return {observationId:`sim-${topic}-${stamp}`,topic,title:`【模拟】${title}`,scope:'虚构演示企业，与真实园区无对应关系',period:iso(now).slice(0,10),retrievedAt:iso(now),expiresAt:iso(now,3600000),sourceUrl:'/api/demo/business-data',content:JSON.stringify({mode:'simulated',reason,...content}),provenance:{sourceId:`demo-${topic}`,sourceClass:'farmer_expert',mode:'simulated'},quality:'valid'};
}

export function makeBusinessDemo(now=new Date()) {
  const reason='尚无实际企业接口或人工记录，按用户要求用合成数据演示；不是实际生产经营事实。';
  const inventoryItems=[
    {batchId:'SIM-B01',warehouseId:'SIM-W01',onHandKg:400,reservedKg:200,availableKg:200,heldKg:0},
    {batchId:'SIM-B02',warehouseId:'SIM-Q01',onHandKg:400,reservedKg:0,availableKg:0,heldKg:400},
  ];
  const totals=Object.fromEntries(['onHandKg','reservedKg','availableKg','heldKg'].map(key=>[key,inventoryItems.reduce((sum,item)=>sum+item[key],0)]));
  return [
    simulationRecord('production_sales','生产、订单与经营假设',{
      basis:'以下重量统一为 kg_dry_rubber；固定场景按当前演示时刻重放，不是今天实测。',
      productionKg:1200, illustrativeSalePriceCnyPerKg:16,
      orders:[{orderId:'SIM-O01',batchId:'SIM-B01',quantityKg:200,status:'in_transit'},{orderId:'SIM-O02',batchId:'SIM-B01',quantityKg:200,status:'reserved',dueAt:iso(now,86400000)}],
      expertNote:'演示审核意见：质量待复核的批次不能计入可售库存；该意见并非真实专家访谈。',
    },now,reason),
    simulationRecord('processing','加工与质检',{
      unit:'kg_dry_rubber',batches:[
        {batchId:'SIM-B01',quantityKg:600,stage:'finished',qualityStatus:'passed',checkedAt:iso(now,-3600000)},
        {batchId:'SIM-B02',quantityKg:400,stage:'quality_hold',qualityStatus:'needs_recheck',checkedAt:iso(now,-1800000)},
        {batchId:'SIM-B03',quantityKg:200,stage:'drying',qualityStatus:'not_checked',checkedAt:null},
      ],
    },now,reason),
    simulationRecord('inventory','企业库存',{
      unit:'kg_dry_rubber',items:inventoryItems,totals,
      note:'在库=预留+可用+质检冻结。可用量必须用 availableKg，不能用 onHandKg。B01 另有 200 kg 已出库运输；B03 仍在加工。预留量包含在在库量内。',
    },now,reason),
    simulationRecord('transport','运输与延迟',{
      unit:'kg_dry_rubber',shipments:[{shipmentId:'SIM-S01',orderId:'SIM-O01',batchId:'SIM-B01',quantityKg:200,status:'delayed',plannedArrivalAt:iso(now,2*3600000),estimatedArrivalAt:iso(now,8*3600000),delayReason:'演示场景：车辆故障，需跟进承运方'}],
    },now,reason),
  ];
}

const publicSamples={
  weather:{airTemperatureC:28,relativeHumidityPct:80,forecastRainfallNextHourMm:2,location:'模拟参考点'},
  market:{instrument:'模拟天然橡胶期货合约',priceCnyPerTonne:16000},
  warehouse:{registeredWarehouseQuantityTonnes:150000},
  bulletin:{guidance:'演示条件：连续降雨后增加巡查，不能作为真实年度风险预测。'},
  monthly_report:{regionalPriceCnyPerTonne:15500,illustrativeMonthlyImportsTonnes:200000},
  production_national:{illustrativeAnnualProductionTonnes:1000000},
  production_hainan:{illustrativeAnnualProductionTonnes:350000},
  pest_updates:{guidance:'模拟巡查建议：有症状先记录、补拍和人工复核；不自动确诊。'},
};
export function publicSimulationRecord(source,now) {
  const sample=publicSamples[source.id];
  if(!sample)return null;
  return simulationRecord(source.id,`${source.title}替代样例`,{...sample,basis:'仅用于接口不可用时的演示，不是任何机构公布的数值。'},now,'真实来源不可用或过期；本记录为明确标注的模拟替代。');
}
