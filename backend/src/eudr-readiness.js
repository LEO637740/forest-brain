import {invariant} from './errors.js';
import {normalizeSiteId, parkSite} from './adapters/park-demo.js';
import {demoZoneBoundary, DEMO_SPATIAL_SOURCE} from '../../shared/demoSpatial.ts';
import {batchActionLabels} from '../../shared/logistics.ts';

export const EUDR_RULES = {
  checkedAt: '2026-10-21', cutoffDate: '2020-12-31',
  productScope: '天然干胶演示分类 ex 4001；适用巴西橡胶树（Hevea brasiliensis）来源的天然橡胶，合成橡胶不在该范围。',
  dates: [
    {role:'大型及中型经营者',date:'2026-12-30'},
    {role:'多数微型及小型经营者',date:'2027-06-30'},
    {role:'已受欧盟木材法规约束的微型及小型经营者',date:'2026-12-30'},
  ],
  role: '本园区演示向欧盟进口商提供资料。首次投放欧盟市场的经营者负责适用的尽职调查与申报；本系统不提交 DDS。',
  geolocation: '地块不超过 4 公顷可用点；超过 4 公顷须用边界多边形；经纬至少六位小数。演示沿用园区模拟分区边界。',
  sources: [
    {title:'EUDR 2026-09-18 综合文本：第 2、9 条与附件 I',url:'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A02023R1115-20260918'},
    {title:'2026/2102：天然橡胶产品范围修订',url:'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32026R2102'},
    {title:'欧委会：角色、责任与实施日期',url:'https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/roles-and-responsibilities_en'},
    {title:'欧委会：资料收集、风险评估与减缓',url:'https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/understand-due-diligence_en'},
  ],
};

const allocationNote = '欧盟出货须在发车前指定来源加工批次；未指定的出货单按园区汇总库存出货，来源未知，不能作为欧盟交付的来源证明。';
const kg = value => Math.round(value * 1000) / 1000;
const coordinate = value => Number(value.toFixed(6));
const precisePlot = plot => ({...plot,geometry:{...plot.geometry,coordinates:plot.geometry.coordinates.map(ring => ring.map(point => point.map(coordinate)))}});
const riskReview = {
  status:'not_assessed',
  summary:'模拟资料整理不构成无风险或可忽略风险判断；真实资料的风险评估与必要减缓由进口责任方继续完成。',
  actions:['替换并核验地块、生产期间、合法生产和无毁林的真实依据。','核对出货与来源批次，评估混料及来源不明风险。','按适用义务完成风险评估和必要的减缓措施，再由责任方申报。'],
};
const sourceIndices = batch => batch.source.treeIndices ?? [];
const sourceKnown = batch => sourceIndices(batch).length > 0 && sourceIndices(batch).every(index => Number.isInteger(index) && index >= 0 && index < 200);
const zoneNames = batch => sourceKnown(batch) ? [...new Set(sourceIndices(batch).map(index => 'ABCD'[Math.floor(index / 50)]))].sort() : [];

function sourcePlots(siteId, batch) {
  const park = parkSite(siteId);
  return zoneNames(batch).map(zone => {
    const ring = demoZoneBoundary(park.key, zone).map(point => [coordinate(point.longitude),coordinate(point.latitude)]);
    ring.push([...ring[0]]);
    return {id:`${siteId}:${zone}`,name:`${park.name} ${zone} 区`,zone,
      areaHa:96 * 56 / 10000,geometry:{type:'Polygon',coordinates:[ring]},mode:'simulated',source:DEMO_SPATIAL_SOURCE};
  });
}

function geojson(plots) {
  return {type:'FeatureCollection',features:plots.map(plot => ({type:'Feature',id:plot.id,geometry:plot.geometry,
    properties:{name:plot.name,areaHa:plot.areaHa,mode:plot.mode,source:plot.source}}))};
}

function productionPeriod(batch, task) {
  const receiptTimes = [...(batch.source.demoReceipts ?? []),...(batch.source.receipts ?? [])]
    .filter(receipt => receipt.outcome === 'completed').map(receipt => receipt.finishedAt);
  const times = (receiptTimes.length ? receiptTimes : (task?.dispatch?.history ?? []).map(entry => entry.time))
    .filter(at => Number.isFinite(Date.parse(at))).sort();
  if (times.length) return {from:times[0],to:times.at(-1)};
  if (task?.date && Number.isFinite(Date.parse(task.date))) return {from:task.date,to:task.date};
  return null;
}

// Field checks follow EUDR Art. 2(28) and 9(1)(d): six-decimal coordinates,
// polygons for plots over 4 ha, a production period, and the cut-off evidence.
function batchChecks({known,period,plots,prepared,allocatedKg}) {
  const rings = plots.map(plot => plot.geometry.coordinates[0]);
  const closed = rings.length > 0 && rings.every(ring => ring.length >= 4 && ring[0].join() === ring.at(-1).join());
  const precise = rings.length > 0 && rings.flat().flat().every(value => Number.isFinite(value) && Math.abs(value * 1e6 - Math.round(value * 1e6)) < 1e-3);
  const large = plots.filter(plot => plot.areaHa > 4);
  return [
    {key:'source',label:'来源树木与地块',ok:known,detail:known?`${plots.length} 个分区地块`:'批次缺少来源树木'},
    {key:'period',label:'生产日期',ok:Boolean(period),detail:period?'取自割胶回执时间':'缺割胶时间'},
    {key:'geometry',label:'地块边界',ok:closed,detail:closed?(large.length?`${large.length} 个地块超过 4 公顷，已用多边形`:'地块不超过 4 公顷，已用多边形（点也可）'):'边界缺失或未闭合'},
    {key:'precision',label:'坐标精度',ok:precise,detail:precise?'经纬度保留 6 位小数':'坐标位数不符'},
    {key:'legality',label:'合法生产与土地使用',ok:Boolean(prepared),detail:prepared?'模拟样例，待替换真实凭证':'未整理'},
    {key:'deforestation',label:'2020-12-31 后无毁林',ok:Boolean(prepared),detail:prepared?'模拟样例，待遥感或现场核验':'未整理'},
    {key:'parties',label:'供货方与欧盟客户',ok:Boolean(prepared),detail:prepared?'模拟供货方与客户':'未整理'},
    {key:'shipment',label:'出货单对应',ok:allocatedKg>0,detail:allocatedKg>0?`已分配 ${kg(allocatedKg)} 公斤给出货单`:'尚未指定给任何出货单'},
  ];
}

export class EudrReadinessService {
  constructor({store,simulation,clock=()=>new Date()}) {
    this.store=store; this.simulation=simulation; this.clock=clock;
    store.db.exec(`CREATE TABLE IF NOT EXISTS simulation_eudr_preparations (
      batch_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, body TEXT NOT NULL
    )`);
  }

  allocations(siteId) {
    // Earlier versions retained allocations when replacing a sales plan.
    return this.store.db.prepare(`SELECT a.body FROM simulation_eudr_allocations a
      JOIN simulation_sales_shipments s ON s.id=a.shipment_id AND s.site_id=a.site_id
      WHERE a.site_id=? AND json_extract(s.body,'$.status')!='cancelled'
      ORDER BY a.rowid`).all(siteId).map(row => JSON.parse(row.body));
  }

  allocatedKg(siteId, batchId, exceptShipmentId = null) {
    return kg(this.allocations(siteId).filter(item => item.shipmentId !== exceptShipmentId)
      .flatMap(item => item.parts).filter(part => part.batchId === batchId).reduce((sum, part) => sum + part.kg, 0));
  }

  batchReadiness(siteId, batch) {
    const row = this.store.db.prepare('SELECT body FROM simulation_eudr_preparations WHERE batch_id=? AND site_id=?').get(batch.id,siteId);
    const prepared = row ? JSON.parse(row.body) : null;
    const task = this.simulation.latestTasks(siteId).find(item => item.id === batch.source.taskId);
    const plots = (prepared?.plots ?? sourcePlots(siteId,batch)).map(precisePlot);
    const period = productionPeriod(batch,task);
    const missing = [];
    if (!sourceKnown(batch)) missing.push('该批次来源树木及对应地块');
    if (!period) missing.push('割胶生产日期或时间区间');
    if (!prepared) missing.push('合法生产与土地使用资料','2020-12-31 之后无毁林的依据','供货方与欧盟客户资料');
    const status = missing.length ? 'missing' : 'demo_prepared';
    const allocatedKg = this.allocatedKg(siteId,batch.id);
    return {
      id:batch.id,title:batch.source.taskTitle,dryKg:batch.processing.dryKg,productName:'天然干胶（模拟产品）',hsCode:'ex 4001',countryOfProduction:'CN',
      sourceTaskId:batch.source.taskId,sourceTreeIds:sourceIndices(batch).map(index=>`T-${String(index+1).padStart(4,'0')}`),
      sourceZones:zoneNames(batch),productionPeriod:period,plots,geojson:geojson(plots),evidence:prepared?.evidence ?? [],
      supplier:prepared?.supplier ?? null,buyer:prepared?.buyer ?? null,status,
      statusLabel:status==='demo_prepared'?'演示资料已整理':'资料待补齐',missing,
      nextStep:status==='demo_prepared'?'可导出演示资料包交给客户核对；实际交易时替换模拟资料并由责任方完成尽职调查。':`补充${missing.join('、')}。`,
      preparedAt:prepared?.preparedAt ?? null,ddsReference:null,traceabilityNote:allocationNote,riskReview,
      allocatedKg,remainingKg:kg(Math.max(0,batch.processing.dryKg-allocatedKg)),
      checks:batchChecks({known:sourceKnown(batch),period,plots,prepared,allocatedKg}),
    };
  }

  shipmentView(shipment, allocation, batches) {
    const zones = allocation ? [...new Set(allocation.parts.flatMap(part => batches.find(batch => batch.id === part.batchId)?.sourceZones ?? []))].sort() : [];
    const traceStatus = allocation ? 'traceable' : shipment.status === 'planned' ? 'unallocated' : 'shipped_untraced';
    return {id:shipment.id,day:shipment.day,plannedDepartureAt:shipment.plannedDepartureAt,plannedKg:shipment.plannedKg,status:shipment.status,
      buyer:shipment.buyer?.name ?? null,traceStatus,
      traceLabel:{traceable:'来源可追溯',unallocated:'待指定来源批次',shipped_untraced:'已出货，来源未指定'}[traceStatus],
      allocation:allocation ? {parts:allocation.parts,allocatedAt:allocation.allocatedAt,allocatedBy:allocation.allocatedBy,sourceZones:zones} : null};
  }

  read(siteId) {
    siteId=normalizeSiteId(siteId);
    const park=parkSite(siteId), inventory=this.simulation.salesInventory(siteId);
    const batches=this.simulation.logistics.list(siteId).filter(batch=>batch.stage==='processed').map(batch=>this.batchReadiness(siteId,batch));
    const prepared=batches.filter(batch=>batch.status==='demo_prepared').length;
    const allocations=new Map(this.allocations(siteId).map(item=>[item.shipmentId,item]));
    const shipments=this.simulation.salesShipments.list(siteId).filter(item=>item.status!=='cancelled')
      .map(item=>this.shipmentView(item,allocations.get(item.id),batches)).sort((a,b)=>a.plannedDepartureAt.localeCompare(b.plannedDepartureAt));
    const traced=shipments.filter(item=>item.traceStatus==='traceable');
    return {
      siteId,parkName:park.name,asOf:this.clock().toISOString(),status:batches.length>0&&prepared===batches.length?'demo_prepared':'missing',
      summary:batches.length?`${batches.length} 个加工批次中，${prepared} 个已整理演示资料。`:'尚无加工入库批次，请先完成收胶、到厂签收和加工入库。',
      nextStep:batches.length?(prepared===batches.length?'选择批次导出资料包，并补齐销售出货与来源批次的对应关系。':'选择一个加工批次，整理其来源地块和演示依据。'):'前往任务中心，完成一个收胶批次的加工入库。',
      batches,rules:EUDR_RULES,inventory:{openingStockKg:inventory.openingStockKg,stockKg:inventory.stockKg,
        availableKg:inventory.availableKg,processedKg:inventory.processedKg,dispatchedKg:inventory.dispatchedKg,soldKg:inventory.soldKg,
        sourceAllocation:traced.length?'partial':'unknown',
        note:`期初库存 ${inventory.openingStockKg} 公斤来源资料待补齐，只走国内渠道；${shipments.length} 张出货单中 ${traced.length} 张已指定来源批次（${kg(traced.reduce((sum,item)=>sum+item.plannedKg,0))} 公斤）。${allocationNote}`},
      shipments,
    };
  }

  prepareDemo({siteId,batchId}) {
    siteId=normalizeSiteId(siteId);
    const batch=this.simulation.logistics.get(batchId,siteId);
    invariant(batch.stage==='processed','EUDR_BATCH_NOT_PROCESSED','请先完成该批次的加工入库。',409);
    invariant(sourceKnown(batch),'EUDR_SOURCE_UNKNOWN','请先补齐该批次的来源树木与地块，才能整理演示资料。',409);
    const park=parkSite(siteId), preparedAt=this.clock().toISOString(),plots=sourcePlots(siteId,batch),plotIds=plots.map(plot=>plot.id);
    const document={preparedAt,plots,ddsReference:null,
      supplier:{name:`${park.name}供货方（模拟）`,country:'CN',address:`${park.name}园区办公室（模拟地址）`,email:'supplier@example.invalid',mode:'simulated'},
      buyer:{name:'欧盟天然胶进口商（模拟客户）',country:'NL',address:'荷兰进口商办公地址（模拟）',email:'buyer@example.invalid',mode:'simulated'},
      evidence:[
        {id:`demo-legality-${batch.id}`,kind:'legality',title:'合法生产与土地使用依据（模拟样例）',mode:'simulated',plotIds,recordedAt:preparedAt,
          note:'演示土地使用与生产记录如何关联本批次地块；未提供实际权属凭证或开展合法性核验。'},
        {id:`demo-deforestation-${batch.id}`,kind:'deforestation',title:'2020-12-31 后无毁林依据（模拟样例）',mode:'simulated',plotIds,recordedAt:preparedAt,
          note:'演示地块历史资料与核对说明；未进行真实遥感判定或现场调查，不能据此认定无毁林。'},
      ]};
    this.store.db.prepare('INSERT OR REPLACE INTO simulation_eudr_preparations VALUES(?,?,?)').run(batch.id,siteId,JSON.stringify(document));
    return this.batchReadiness(siteId,batch);
  }

  allocate({siteId,shipmentId,batchIds},identity=null) {
    siteId=normalizeSiteId(siteId);
    return this.store.transaction(() => {
      const shipment=this.simulation.salesShipments.list(siteId).find(item=>item.id===shipmentId);
      invariant(shipment,'NOT_FOUND','当前园区没有该出货单。',404);
      invariant(shipment.status==='planned','EUDR_SHIPMENT_LOCKED','只能在发车前指定来源批次；已发车的出货单不能补记来源。',409);
      invariant(batchIds.length>0&&new Set(batchIds).size===batchIds.length,'INVALID_INPUT','请选择不重复的来源批次。',400);
      let need=kg(shipment.plannedKg);
      const parts=[];
      for (const batchId of batchIds) {
        const batch=this.batchReadiness(siteId,this.simulation.logistics.get(batchId,siteId));
        invariant(batch.status==='demo_prepared','EUDR_BATCH_NOT_READY',`${batch.title}的来源资料未整理齐全，不能用于欧盟出货。`,409);
        const free=kg(batch.dryKg-this.allocatedKg(siteId,batchId,shipmentId));
        if (need>0&&free>0) { const take=kg(Math.min(free,need)); parts.push({batchId,title:batch.title,kg:take}); need=kg(need-take); }
      }
      invariant(need<=0,'EUDR_BATCH_INSUFFICIENT',`所选批次可分配 ${kg(shipment.plannedKg-need)} 公斤，本出货单需要 ${kg(shipment.plannedKg)} 公斤；请再选一个已整理资料的批次或调整出货量。`,409);
      const record={shipmentId,siteId,parts,allocatedAt:this.clock().toISOString(),allocatedBy:identity?.accountId??'local-tool'};
      this.store.db.prepare('INSERT OR REPLACE INTO simulation_eudr_allocations VALUES(?,?,?)').run(shipmentId,siteId,JSON.stringify(record));
      return this.read(siteId).shipments.find(item=>item.id===shipmentId);
    });
  }

  release({siteId,shipmentId}) {
    siteId=normalizeSiteId(siteId);
    return this.store.transaction(() => {
      const shipment=this.simulation.salesShipments.list(siteId).find(item=>item.id===shipmentId);
      invariant(shipment,'NOT_FOUND','当前园区没有该出货单。',404);
      invariant(shipment.status==='planned','EUDR_SHIPMENT_LOCKED','已发车的出货单不能撤销来源批次。',409);
      this.store.db.prepare('DELETE FROM simulation_eudr_allocations WHERE shipment_id=? AND site_id=?').run(shipmentId,siteId);
      return this.read(siteId).shipments.find(item=>item.id===shipmentId);
    });
  }

  exportShipmentPack(siteId,shipmentId) {
    siteId=normalizeSiteId(siteId);
    const view=this.read(siteId), shipment=view.shipments.find(item=>item.id===shipmentId);
    invariant(shipment,'NOT_FOUND','当前园区没有该出货单。',404);
    invariant(shipment.allocation,'EUDR_SHIPMENT_UNTRACED','该出货单尚未指定来源批次，不能导出欧盟客户资料。',409);
    const batches=shipment.allocation.parts.map(part=>view.batches.find(batch=>batch.id===part.batchId));
    const plots=[...new Map(batches.flatMap(batch=>batch.plots).map(plot=>[plot.id,plot])).values()];
    return {format:'rubber-eudr-shipment-demo-v1',exportedAt:this.clock().toISOString(),siteId,parkName:view.parkName,
      disclaimer:'演示资料包：地块、供货方、客户与证明材料均为模拟样例；不代表 EUDR 合规认证，也未向欧盟提交 DDS。',
      shipment,product:{name:'天然干胶（模拟产品）',hsCode:'ex 4001',netKg:shipment.plannedKg,countryOfProduction:'CN'},
      productionPeriod:{from:batches.map(batch=>batch.productionPeriod?.from).filter(Boolean).sort()[0]??null,to:batches.map(batch=>batch.productionPeriod?.to).filter(Boolean).sort().at(-1)??null},
      plots,geojson:geojson(plots),batches:batches.map(batch=>({id:batch.id,title:batch.title,kg:shipment.allocation.parts.find(part=>part.batchId===batch.id).kg,
        sourceTreeIds:batch.sourceTreeIds,evidence:batch.evidence,checks:batch.checks})),
      supplier:batches[0].supplier,buyer:batches[0].buyer,riskReview,rules:EUDR_RULES,ddsReference:null};
  }

  exportPack(siteId,batchId) {
    siteId=normalizeSiteId(siteId);
    const source=this.simulation.logistics.get(batchId,siteId);
    invariant(source.stage==='processed','EUDR_BATCH_NOT_PROCESSED','请先完成该批次的加工入库。',409);
    const batch=this.batchReadiness(siteId,source);
    return {format:'rubber-eudr-demo-v1',exportedAt:this.clock().toISOString(),siteId,parkName:parkSite(siteId).name,status:batch.status,
      disclaimer:'演示资料包：地块、供货方、客户与证明材料均为模拟样例；不代表 EUDR 合规认证，也未向欧盟提交 DDS。',
      rules:EUDR_RULES,batch,riskReview,
      flowChain:source.history.map(record=>({action:record.action,label:batchActionLabels[record.action],at:record.at,note:record.note})),
      sourceRecord:{taskId:source.source.taskId,taskRevision:source.source.taskRevision,treeIndices:sourceIndices(source)},
      shipmentAllocation:{status:batch.allocatedKg>0?'allocated':'unknown',allocatedKg:batch.allocatedKg,remainingKg:batch.remainingKg,
        shipments:this.allocations(siteId).filter(item=>item.parts.some(part=>part.batchId===batchId))
          .map(item=>({shipmentId:item.shipmentId,kg:item.parts.find(part=>part.batchId===batchId).kg,allocatedAt:item.allocatedAt})),note:allocationNote}};
  }
}
