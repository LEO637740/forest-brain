import {s,timestamp,validate} from './schema.js';
import {invariant} from './errors.js';
import {digest} from './util.js';
import {normalizeSiteId} from './adapters/park-demo.js';
import {resolvePublicMarketInputs} from './park-market-inputs.js';

const provenance={mode:s.enum('operator_confirmed','assumption'),sourceLabel:s.str({maxLength:200}),observedAt:timestamp};
const measure=(minimum=0)=>s.obj({value:s.num({minimum}),...provenance},['sourceLabel','observedAt']);
export const parkEconomicInputSchema=s.obj({siteId:s.str(),inputs:s.obj({
  price:measure(0.001),cost:measure(),yield:measure(0.001),demand:measure(),
  inventory:s.obj({stockKg:s.num({minimum:0}),heldKg:s.num({minimum:0}),storageKg:s.num({minimum:0.001}),...provenance},['sourceLabel','observedAt']),
},['price','cost','yield','demand','inventory'])});

// One persisted set of planning inputs per park. It never changes the simulation
// sales ledger; that ledger and a manager's physical count are different sources.
export class ParkEconomicInputStore {
  constructor(store,clock=()=>new Date()) {
    Object.assign(this,{store,clock});
    store.db.exec('CREATE TABLE IF NOT EXISTS park_economic_inputs (site_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  read(siteId) {
    siteId=normalizeSiteId(siteId);
    const row=this.store.db.prepare('SELECT body FROM park_economic_inputs WHERE site_id=?').get(siteId);
    return row?JSON.parse(row.body):{siteId,updatedAt:null,inputs:{}};
  }
  save(input,identity) {
    validate(parkEconomicInputSchema,input);
    const siteId=normalizeSiteId(input.siteId);
    identity.require('park_plan.write');identity.requireSite(siteId);
    const stock=input.inputs.inventory;
    invariant(!stock||stock.heldKg<=stock.stockKg,'INVALID_PARAMETERS','冻结库存不能超过总库存。',422);
    for(const item of Object.values(input.inputs)) {
      if(item.mode==='assumption') {
        item.sourceLabel??='人工假设';item.observedAt??=this.clock().toISOString();
      }
      invariant(item.sourceLabel&&item.observedAt,'INVALID_PARAMETERS','实际填报需要来源说明和数据日期。',422);
      invariant(item.sourceLabel.trim().length>0,'INVALID_PARAMETERS','请填写数据来源。',422);
      invariant(Date.parse(item.observedAt)<=+this.clock(),'INVALID_PARAMETERS','数据记录时间不能晚于当前时间。',422);
    }
    const result={siteId,updatedAt:this.clock().toISOString(),updatedBy:identity.accountId,inputs:input.inputs};
    this.store.db.prepare('INSERT INTO park_economic_inputs VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET body=excluded.body').run(siteId,JSON.stringify(result));
    return result;
  }
}

export function assembleParkEconomicInputs({siteId,now,context,inventory,storageKg,plannedSalesKg=0,sources=[],settings={}}) {
  const market=resolvePublicMarketInputs({siteId,now,sources,simulatedMarket:context.modules.market});
  const inputs=[...market.evidence];
  let priceBasis=market.priceBasis;
  if(settings.price) {
    priceBasis={...settings.price,cnyPerKg:settings.price.value,label:'园区干胶收购/成交价',note:settings.price.mode==='assumption'?'人工假设的干胶价，用于情景测算。':'园区填报的同口径干胶价；尚未由外部系统核验。'};
    inputs.splice(inputs.findIndex(row=>row.key==='selling_price'),1,{key:'selling_price',label:priceBasis.label,unit:'元/kg 干胶',...settings.price,note:priceBasis.note});
  }
  const cost=settings.cost??{value:2,mode:'simulated',sourceLabel:'全园演示成本假设'};
  const yieldInput=settings.yield??{value:0.3,mode:'simulated',sourceLabel:'全园演示单产假设'};
  inputs.push({key:'cost',label:'每树每次可变成本',unit:'元/树次',...cost,note:'含割胶、收集及随产量发生的加工成本；未计固定资产、土地和税费。'},
    {key:'yield',label:'每树每次干胶产出',unit:'kg 干胶/树次',...yieldInput,note:'预计产量依据；应以同季节实际称重和干胶含量校准。'});
  const stock=settings.inventory??{stockKg:inventory.stockKg,heldKg:inventory.heldKg??Math.max(0,inventory.stockKg-inventory.availableKg),storageKg,mode:'simulated',sourceLabel:'模拟收胶、加工与出货账本'};
  inputs.push(...[['stock','总库存',stock.stockKg],['held','冻结库存',stock.heldKg],['storage','仓容',stock.storageKg]].map(([key,label,value])=>({key,label,value,unit:'kg 干胶',mode:stock.mode,sourceLabel:stock.sourceLabel,observedAt:stock.observedAt,note:settings.inventory?'园区库存快照，仅用于本次策略，不改写模拟出货账本。':'模拟账本数量，未连接园区实盘库存。'})));
  // A dated order book covers the following seven days. An expired book cannot
  // silently become next week's confirmed orders.
  const orders=settings.demand&&+now<Date.parse(settings.demand.observedAt)+7*86400000?settings.demand:null;
  const demand=orders?{kind:'orders',ordersKg:orders.value,...orders}:{kind:'index',value:context.modules.market.demand.value,baselineValue:context.modules.market.demand.baselineValue??100,mode:'simulated',sourceLabel:'园区模拟需求指数'};
  inputs.push({key:'demand',label:orders?orders.mode==='operator_confirmed'?'未来7天填报订单':'未来7天假设订单':'需求指数',unit:orders?'kg 干胶':'点',...demand,note:orders?'按订单记录日起7天的未交付需求，先扣可售库存；订单不等于已出库。':settings.demand?'原订单记录已超过7天，本次使用模拟需求；请更新订单。':'尚未接入园区真实订单；指数基准为100。'});
  const salesKg=settings.inventory?0:plannedSalesKg;
  inputs.push({key:'planned_sales',label:'期末库存测算的计划出货',value:salesKg,unit:'kg 干胶',mode:'simulated',sourceLabel:settings.inventory?'园区快照未关联出货计划':'模拟出货计划',note:'计划出货未发生前，不作为新增割胶可用仓容；园区快照不混用模拟出货。'});
  const result={priceBasis,priceSignal:market.priceSignal,costPerTapping:cost.value,dryKgPerTapping:yieldInput.value,demand,
    inventory:{stockKg:stock.stockKg,heldKg:stock.heldKg,availableKg:Math.max(0,stock.stockKg-stock.heldKg)},storageKg:stock.storageKg,plannedSalesKg:salesKg,inputs};
  // Refresh timestamps alone do not invalidate a decision; values, quotation
  // periods and the manager's source records do.
  const evidence=inputs.map(({retrievedAt,observedAt,snapshotId,validUntil,...row})=>row);
  result.fingerprint=digest({evidence,price:priceBasis.cnyPerKg,trend:market.priceSignal.changeRatio,threshold:market.priceSignal.thresholdRatio,settings});
  return result;
}
