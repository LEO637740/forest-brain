import {useState,type MouseEvent} from 'react';
import {put,useRead} from './client';
import {when} from './Views';

export type EconomicOrigin='public_reference'|'operator_confirmed'|'simulated'|'assumption';
export type ParkEconomicInput={
  key:string;label:string;value:number|string|null;unit:string;mode:EconomicOrigin;
  sourceLabel:string;sourceUrl?:string|null;period?:string|null;observedAt?:string|null;retrievedAt?:string|null;note?:string;
};
export type ParkEconomics={inputs:ParkEconomicInput[];decisionReasons:string[];baselineFrequency:number;marketTargetFrequency:number;finalFrequency:number;
  priceCnyPerKg:number;costPerTapping:number;dryKgPerTapping:number;contributionPerTapping:number;expectedContributionCny:number;demandBasis:string;fingerprint:string};
export type ParkModelProposal={mode:'llm';provider:string|null;model:string|null;generatedAt:string;inputFingerprint:string;inputSnapshot:Record<string,unknown>;
  summary:string;zones:{zone:string;frequencyPerWeek:number;reason:string;inputKeys:string[]}[];
  drivers:{inputKey:string;interpretation:string;effect:'increase'|'decrease'|'hold'}[];risks:string[];durationMs?:number;
  usage?:{promptTokens:number;completionTokens:number;cacheHitTokens?:number}};
export type ParkConstraintAdjustment={zone:string;kind:'care'|'weather'|'health'|'device'|'capacity'|'schedule';requestedFrequency:number;finalFrequency:number;reason:string};
type InputMode='operator_confirmed'|'assumption';
type InputSource={mode:InputMode;sourceLabel?:string;observedAt?:string};
type ValueInput=InputSource&{value:number};
export type ParkBusinessInputs={price?:ValueInput;cost?:ValueInput;yield?:ValueInput;demand?:ValueInput;inventory?:InputSource&{stockKg:number;heldKg:number;storageKg:number}};
type InputSettings={siteId:string;updatedAt:string|null;inputs:ParkBusinessInputs};
type InputKey=keyof ParkBusinessInputs;
type InputDraft={mode:InputMode;sourceLabel:string;observedAt:string;value?:string;stockKg?:string;heldKg?:string;storageKg?:string};
type Draft=Partial<Record<InputKey,InputDraft>>;

export const economicOriginLabels:Record<EconomicOrigin,string>={public_reference:'真实公开数据',operator_confirmed:'园区填报 · 未自动核验',simulated:'模拟数据',assumption:'人工假设'};
const quantity=(value:number|string|null)=>value===null?'—':typeof value==='number'?value.toLocaleString('zh-CN',{maximumFractionDigits:3}):value;
const evidenceDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value:when(value);
const inputGroups:{key:InputKey;label:string;description:string;fields:{key:'value'|'stockKg'|'heldKg'|'storageKg';label:string;min:number;step:string}[]}[]=[
  {key:'price',label:'园区胶价',description:'园区成交或收购价格，按干胶折算；未填报时使用方案列出的价格来源。',fields:[{key:'value',label:'元 / kg 干胶',min:0.001,step:'0.001'}]},
  {key:'cost',label:'割胶可变成本',description:'单棵树每次割胶、收集和加工的总可变费用。',fields:[{key:'value',label:'元 / 树次',min:0,step:'0.01'}]},
  {key:'yield',label:'单次干胶产出',description:'用实际称重与干胶含量估算单树单次干胶产量。',fields:[{key:'value',label:'kg 干胶 / 树次',min:0.001,step:'0.001'}]},
  {key:'demand',label:'未来 7 天需求',description:'从数据日期起 7 天的未交付订单；可填实际确认量或人工假设量，0 表示本次按无订单测算。请随交付更新剩余量，记录过 7 天恢复模拟需求。',fields:[{key:'value',label:'订单量 / kg 干胶',min:0,step:'0.01'}]},
  {key:'inventory',label:'园区库存',description:'园区干胶库存、冻结量与可用仓容，统一以 kg 计。',fields:[{key:'stockKg',label:'当前库存 / kg',min:0,step:'0.01'},{key:'heldKg',label:'冻结库存 / kg',min:0,step:'0.01'},{key:'storageKg',label:'总仓容 / kg',min:0.01,step:'0.01'}]},
];

function inputDraft(inputs:ParkBusinessInputs):Draft {
  return Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,{...input,sourceLabel:input.sourceLabel??'',observedAt:input.observedAt?new Date(input.observedAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):'',...('value'in input?{value:String(input.value)}:{stockKg:String(input.stockKg),heldKg:String(input.heldKg),storageKg:String(input.storageKg)})}]));
}
export function serializeParkInputs(draft:Draft):ParkBusinessInputs {
  return Object.fromEntries(Object.entries(draft).map(([key,input])=>[key,{mode:input.mode,...(input.sourceLabel.trim()?{sourceLabel:input.sourceLabel.trim()}:{}),...(input.observedAt?{observedAt:`${input.observedAt}T00:00:00+08:00`}:{}),
    ...(key==='inventory'?{stockKg:Number(input.stockKg),heldKg:Number(input.heldKg),storageKg:Number(input.storageKg)}:{value:Number(input.value)})}]));
}

export function ParkModelReasoning({proposal,adjustments,zones,inputs}:{proposal:ParkModelProposal;adjustments:ParkConstraintAdjustment[];zones:{zone:string;frequency:number;existingFrequency?:number;totalFrequency?:number;eligibleTrees:number}[];inputs:ParkEconomicInput[]}) {
  const inputLabel=(key:string)=>inputs.find(input=>input.key===key)?.label??key;
  const showEvidence=(event:MouseEvent<HTMLAnchorElement>,key:string)=>{
    event.preventDefault();
    document.getElementById(`pp-evidence-${key}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const effectLabel={increase:'支持增割',decrease:'支持减割',hold:'支持维持'};
  const constraintLabel={care:'养护上限',weather:'天气窗口',health:'树木健康与就绪',device:'设备状态',capacity:'仓容',schedule:'已有任务排程'};
  return <section className="pp-card pp-model-reasoning" aria-label="大模型建议与硬约束调整">
    <div className="pp-model-title"><h3>大模型提出建议，硬约束核验执行</h3><span className="pp-data-origin pp-data-public_reference">大模型生成</span></div>
    <p className="pp-note">{proposal.provider??'已配置模型'} · {proposal.model??'模型'} · 生成于 {when(proposal.generatedAt)}</p>
    <p className="pp-model-summary">查看各区模型建议和理由；全园产量由系统按可执行排程计算。</p>
    <div className="pp-model-zones">{proposal.zones.map(proposed=>{
      const actual=zones.find(zone=>zone.zone===proposed.zone);
      const constraints=adjustments.filter(item=>item.zone===proposed.zone);
      return <article className="pp-model-zone" key={proposed.zone}>
        <h4>{proposed.zone}区 <span>模型本周目标 <strong>{proposed.frequencyPerWeek} 次</strong> → 单树本周最多 <strong>{actual?.totalFrequency??actual?.frequency??0} 次</strong></span></h4>
        <p className="pp-note">此次新增 {actual?.frequency??0} 次{Boolean(actual?.existingFrequency)&&`；部分树已有最多 ${actual?.existingFrequency} 次安排或已完成作业，保留各任务实际进度`}。</p>
        <p><strong>模型理由：</strong>{proposed.reason}</p>
        <p className="pp-model-citations">引用数据：{proposed.inputKeys.map(key=><a key={key} href={`#pp-evidence-${key}`} onClick={event=>showEvidence(event,key)}>{inputLabel(key)}</a>)}</p>
        {constraints.length>0?<ul className="pp-model-constraints">{constraints.map((item,index)=><li key={`${item.kind}:${index}`}><strong>{constraintLabel[item.kind]}：</strong>{item.reason}</li>)}</ul>:<p className="pp-note">硬约束核验后保留模型割次；本区 {actual?.eligibleTrees??0} 棵可执行。</p>}
      </article>;
    })}</div>
    <details className="pp-model-drivers"><summary>模型如何权衡经营数据</summary><ul>{proposal.drivers.map((driver,index)=><li key={`${driver.inputKey}:${index}`}><a href={`#pp-evidence-${driver.inputKey}`} onClick={event=>showEvidence(event,driver.inputKey)}>{inputLabel(driver.inputKey)}</a><span>{effectLabel[driver.effect]}</span><p>{driver.interpretation}</p></li>)}</ul></details>
    {proposal.risks.length>0&&<details className="pp-model-risks"><summary>模型提出的待确认事项 · {proposal.risks.length} 项</summary><ul>{proposal.risks.map((risk,index)=><li key={index}>{risk}</li>)}</ul></details>}
    <p className="pp-note">模型综合分析经营数据并提出各区割次；系统按天气、树木健康、设备、养护上限和仓容检查可执行范围。采用后才生成任务。</p>
  </section>;
}

export function ParkEconomicEvidence({economics,scenarioLabel,modelGenerated=false}:{economics:ParkEconomics;scenarioLabel?:string;modelGenerated?:boolean}) {
  const {inputs}=economics;
  return <section className="pp-card pp-economic-evidence" aria-label="经营数据与割次调整依据">
    <h3>{modelGenerated?'模型使用的经营数据':'原方案的经营数据快照'}</h3>
    {scenarioLabel&&<p className="pp-note"><span className="pp-data-origin pp-data-assumption">人工假设</span> 本次叠加“{scenarioLabel}”情景，贡献公式使用情景调整后的数值；下方保留原始输入及其来源。</p>}
    <p className="pp-economic-margin">每树每次：{quantity(economics.priceCnyPerKg)} 元/kg × {quantity(economics.dryKgPerTapping)} kg − {quantity(economics.costPerTapping)} 元成本 = <strong>{quantity(economics.contributionPerTapping)} 元贡献</strong>；本方案预计贡献 <strong>{quantity(economics.expectedContributionCny)} 元</strong>。</p>
    <p className="pp-note">贡献为收入扣除本次录入的可变成本，未扣固定投入。区域月均参考价不等于本园成交价；含模拟数据或人工假设的结果为情景测算。</p>
    <div className="pp-economic-inputs">{inputs.map(input=><article key={input.key} id={`pp-evidence-${input.key}`} className="pp-economic-input">
      <div className="pp-economic-input-head"><h4>{input.label}</h4><span className={`pp-data-origin pp-data-${input.mode}`}>{economicOriginLabels[input.mode]}</span></div>
      <strong className="pp-economic-value">{quantity(input.value)} <small>{input.unit}</small></strong>
      {input.note&&<p>{input.note}</p>}
      <footer>
        {input.sourceUrl?<a href={input.sourceUrl} target="_blank" rel="noreferrer">{input.sourceLabel} ↗</a>:<span>{input.sourceLabel}</span>}
        {input.period&&<span>统计期：{input.period}</span>}
        {input.observedAt&&<span>数据日期：{evidenceDate(input.observedAt)}</span>}
        {input.retrievedAt&&<span>获取时间：{when(input.retrievedAt)}</span>}
      </footer>
    </article>)}</div>
    <p className="pp-note">以上为本方案使用的数据快照。{modelGenerated?'贡献公式用于核算模型建议对应的预计收入与可变成本，割次由模型提出。':'本记录来自历史规则方案，重新生成后才能查看模型建议。'}</p>
  </section>;
}

export function ParkBusinessInputsEditor({siteId,canEdit,onSaved}:{siteId:string;canEdit:boolean;onSaved:()=>void}) {
  const saved=useRead<InputSettings>(`/api/park-plan/inputs?siteId=${siteId}`);
  const [draft,setDraft]=useState<Draft|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const current=draft??inputDraft(saved.data?.inputs??{});
  function change(key:InputKey,patch:Partial<InputDraft>){setDraft({...current,[key]:{...current[key]!,...patch}});setMessage('');}
  function enable(key:InputKey,enabled:boolean){
    const next={...current};
    if(enabled)next[key]={mode:'assumption',sourceLabel:'',observedAt:'',...(key==='inventory'?{stockKg:'',heldKg:'0',storageKg:''}:{value:''})};
    else delete next[key];
    setDraft(next);setMessage('');
  }
  async function save(event:{preventDefault:()=>void}) {
    event.preventDefault();if(saving)return;
    setSaving(true);setError('');setMessage('');
    try{const result=await put<InputSettings>('/api/park-plan/inputs',{siteId,inputs:serializeParkInputs(current)});setDraft(inputDraft(result.inputs));saved.reload();setMessage('经营输入已保存，重新测算后用于新方案。');onSaved();}
    catch(cause){setError((cause as Error).message);}
    finally{setSaving(false);}
  }
  return <details className="pp-card pp-disclosure pp-business-editor" aria-label="园区经营输入">
    <summary>补充园区经营数据 <span className="pp-note">成本 · 产出 · 需求 · 库存 · 园区胶价</span></summary>
    <p className="pp-note">勾选需要填报的项目。取消勾选并保存后，恢复该项目默认来源。公开行情由系统读取，数值和来源不能在这里修改。</p>
    {!canEdit?<p className="pp-note">由农场管理填报本园经营数据。</p>:<>
      {saved.error&&<p className="pp-error" role="alert">{saved.error} <button className="rb-button" onClick={saved.reload}>重试</button></p>}
      {!saved.data&&!saved.error&&<p role="status">正在读取经营输入…</p>}
      {saved.data&&<form onSubmit={save}>
        <div className="pp-business-groups">{inputGroups.map(group=>{
          const input=current[group.key];
          return <fieldset key={group.key} disabled={saving} className={input?'pp-business-enabled':''}>
            <legend><label><input type="checkbox" checked={Boolean(input)} onChange={event=>enable(group.key,event.target.checked)}/>{group.label}</label></legend>
            <p>{group.description}</p>
            {input?<div className="pp-business-fields">
              {group.fields.map(field=><label key={field.key}>{field.label}<input type="number" min={field.min} step={field.step} required value={input[field.key]} onChange={event=>change(group.key,{[field.key]:event.target.value})}/></label>)}
              <label>数据性质<select value={input.mode} onChange={event=>change(group.key,{mode:event.target.value as InputMode})}><option value="assumption">人工假设</option><option value="operator_confirmed">园区实际填报（未自动核验）</option></select></label>
              <label>数据日期<input type="date" value={input.observedAt} required={input.mode==='operator_confirmed'} onChange={event=>change(group.key,{observedAt:event.target.value})}/></label>
              <label className="pp-business-source">来源 / 凭据说明<input type="text" value={input.sourceLabel} required={input.mode==='operator_confirmed'} placeholder={group.key==='demand'?'例如：本周确认订单汇总':'例如：园区台账或称重记录'} onChange={event=>change(group.key,{sourceLabel:event.target.value})}/></label>
            </div>:<small>沿用默认来源，实际采用的数据见上方方案。</small>}
          </fieldset>;
        })}</div>
        <div className="pp-actions"><button className="rb-button rb-primary" type="submit" disabled={saving||draft===null}>{saving?'正在保存…':'保存经营输入'}</button>{saved.data.updatedAt&&<small>上次保存：{when(saved.data.updatedAt)}</small>}</div>
      </form>}
      {error&&<p className="pp-error" role="alert">{error}</p>}
      {message&&<p className="pp-note" role="status">{message}</p>}
    </>}
  </details>;
}
