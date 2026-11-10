import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';

const file='../src/integration/ParkEconomics.tsx';
const compiled=await transformWithOxc(readFileSync(new URL(file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
const code=parseAst(compiled.code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>compiled.code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!React.isValidElement(node))return '';if(typeof node.type==='function')return text(node.type(node.props));return React.Children.toArray(node.props.children).map(text).join('');}
function walk(node,predicate){if(!React.isValidElement(node))return [];if(typeof node.type==='function')return walk(node.type(node.props),predicate);return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];}
const field=(tree,label)=>walk(tree,node=>node.type==='label'&&text(node)===label).flatMap(node=>walk(node,input=>input.type==='input'||input.type==='select'))[0];
function harness(inputs={},options={}){
  let cursor=0;const state=[],calls={reads:[],puts:[],reloads:0,saved:0,scrolled:[]};
  const bindings={React,when:options.when??(value=>value),useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],value=>state[i]=typeof value==='function'?value(state[i]):value];},
    useRead:path=>{calls.reads.push(path);return {data:{siteId:'demo-xsbn',updatedAt:null,inputs},reload:()=>calls.reloads++};},
    put:async(path,input)=>{calls.puts.push({path,input});if(options.failure)throw Error(options.failure);return {siteId:input.siteId,updatedAt:'2026-10-27T01:00:00Z',inputs:input.inputs};},
    document:{getElementById:id=>({scrollIntoView:options=>calls.scrolled.push({id,options})})},
  };
  const exported=new Function(...Object.keys(bindings),code+';return {ParkEconomicEvidence,ParkBusinessInputsEditor,ParkModelReasoning};')(...Object.values(bindings));
  return {calls,...exported,render(){cursor=0;return exported.ParkBusinessInputsEditor({siteId:'demo-xsbn',canEdit:options.canEdit??true,onSaved:()=>calls.saved++});}};
}

test('plan evidence distinguishes public reference, unverified operator data, simulation and assumptions',()=>{
  const h=harness(),economics={baselineFrequency:2,marketTargetFrequency:1,finalFrequency:1,priceCnyPerKg:17.3,costPerTapping:6,dryKgPerTapping:.3,contributionPerTapping:-.81,expectedContributionCny:-81,
    decisionReasons:['每树每次贡献为负，减少割次。','当前库存已覆盖确认订单，优先出货。'],inputs:[
      {key:'selling_price',label:'云南鲜胶乳折干月均价',value:17.3,unit:'元/kg 干胶',mode:'public_reference',sourceLabel:'农业农村部月报',sourceUrl:'https://example.test/report',period:'2026-09',observedAt:'2026-09-30T00:00:00Z',retrievedAt:'2026-10-26T00:00:00Z',note:'区域月均参考，不是园区成交。'},
      {key:'cost',label:'总可变成本',value:6,unit:'元/树次',mode:'operator_confirmed',sourceLabel:'10 月成本台账',observedAt:'2026-10-26T00:00:00Z'},
      {key:'yield',label:'单次干胶产出',value:.3,unit:'kg/树次',mode:'simulated',sourceLabel:'模拟参数'},
      {key:'demand',label:'订单量',value:100,unit:'kg',mode:'assumption',sourceLabel:'测算假设'},
      {key:'price_trend',label:'期货方向',value:null,unit:'%',mode:'public_reference',sourceLabel:'SHFE',note:'缺少比较值，未影响方向评分。'},
    ]};
  const page=h.ParkEconomicEvidence({economics,modelGenerated:true}),content=text(page);
  for(const expected of ['模型使用的经营数据','真实公开数据','园区填报 · 未自动核验','模拟数据','人工假设','统计期：2026-09','数据日期：2026-09-30','获取时间：2026-10-26','17.3 元/kg × 0.3 kg − 6 元成本 = -0.81 元贡献','未扣固定投入','— %'])assert.ok(content.includes(expected),expected);
  assert.equal(walk(page,node=>node.type==='a')[0].props.href,'https://example.test/report');
  assert.doesNotMatch(content,/NaN|undefined|实际利润/);
  assert.match(text(h.ParkEconomicEvidence({economics,scenarioLabel:'需求转弱'})),/本次叠加“需求转弱”情景.*情景调整后的数值.*原始输入及其来源/);
});

test('manager records zero confirmed demand with provenance, then restores defaults without editing the public feed',async()=>{
  const h=harness();let page=h.render();
  assert.deepEqual(h.calls.reads,['/api/park-plan/inputs?siteId=demo-xsbn']);
  assert.equal(walk(page,node=>node.type==='input'&&node.props.type==='number').length,0);
  field(page,'未来 7 天需求').props.onChange({target:{checked:true}});
  page=h.render();field(page,'数据性质人工假设园区实际填报（未自动核验）').props.onChange({target:{value:'operator_confirmed'}});
  page=h.render();
  assert.equal(field(page,'数据日期').props.required,true);assert.equal(field(page,'来源 / 凭据说明').props.required,true);
  field(page,'订单量 / kg 干胶').props.onChange({target:{value:'0'}});page=h.render();
  field(page,'数据日期').props.onChange({target:{value:'2026-10-27'}});page=h.render();
  field(page,'来源 / 凭据说明').props.onChange({target:{value:'  未来七天订单台账  '}});page=h.render();
  await walk(page,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
  assert.deepEqual(h.calls.puts,[{path:'/api/park-plan/inputs',input:{siteId:'demo-xsbn',inputs:{demand:{mode:'operator_confirmed',sourceLabel:'未来七天订单台账',observedAt:'2026-10-27T00:00:00+08:00',value:0}}}}]);
  assert.equal(h.calls.saved,1);assert.equal(h.calls.reloads,1);
  assert.match(text(h.render()),/经营输入已保存，重新测算后用于新方案/);
  field(h.render(),'未来 7 天需求').props.onChange({target:{checked:false}});
  await walk(h.render(),node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
  assert.deepEqual(h.calls.puts.at(-1).input.inputs,{});
});

test('date-only market evidence stays a reporting date while full timestamps retain time formatting',()=>{
  const formatted=[],h=harness({},{when:value=>{formatted.push(value);return `formatted(${value})`;}});
  const economics={baselineFrequency:2,marketTargetFrequency:2,priceCnyPerKg:17,costPerTapping:2,dryKgPerTapping:.3,contributionPerTapping:3.1,expectedContributionCny:310,decisionReasons:[],inputs:[
    {key:'price_trend',label:'期货方向',value:1.2,unit:'%',mode:'public_reference',sourceLabel:'SHFE',observedAt:'2026-10-26',retrievedAt:'2026-10-27T01:00:00Z'},
    {key:'cost',label:'成本',value:2,unit:'元/树次',mode:'operator_confirmed',sourceLabel:'园区台账',observedAt:'2026-10-26T16:00:00Z'},
  ]};
  const content=text(h.ParkEconomicEvidence({economics}));
  assert.match(content,/数据日期：2026-10-26/);assert.match(content,/数据日期：formatted\(2026-10-26T16:00:00Z\)/);
  assert.deepEqual(formatted,['2026-10-27T01:00:00Z','2026-10-26T16:00:00Z']);
});

test('inventory and real cost preserve their own values and China reporting dates',async()=>{
  const h=harness({cost:{value:2.8,mode:'operator_confirmed',sourceLabel:'人工收集加工台账',observedAt:'2026-10-26T16:00:00.000Z'},inventory:{stockKg:540,heldKg:40,storageKg:900,mode:'assumption'}});
  const page=h.render(),dates=walk(page,node=>node.type==='input'&&node.props.type==='date');
  assert.equal(dates[0].props.value,'2026-10-27');assert.equal(dates[1].props.required,false);
  assert.match(text(page),/割胶、收集和加工的总可变费用/);
  field(page,'当前库存 / kg').props.onChange({target:{value:'530'}});
  await walk(h.render(),node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
  assert.deepEqual(h.calls.puts[0].input.inputs,{cost:{value:2.8,mode:'operator_confirmed',sourceLabel:'人工收集加工台账',observedAt:'2026-10-27T00:00:00+08:00'},inventory:{mode:'assumption',stockKg:530,heldKg:40,storageKg:900}});
});

test('viewers do not see editable fields and a rejected save keeps the draft without marking plans changed',async()=>{
  const viewer=harness({},{canEdit:false});assert.equal(walk(viewer.render(),node=>node.type==='form').length,0);assert.match(text(viewer.render()),/由农场管理填报/);
  const h=harness({cost:{value:2,mode:'assumption'}},{failure:'只有农场管理可以更新经营输入'});
  field(h.render(),'元 / 树次').props.onChange({target:{value:'3'}});
  await walk(h.render(),node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
  assert.equal(field(h.render(),'元 / 树次').props.value,'3');assert.match(text(h.render()),/只有农场管理可以更新/);assert.equal(h.calls.saved,0);assert.equal(h.calls.reloads,0);
});


test('model proposal reasons and cited inputs remain separate from the hard-constraint reductions',()=>{
  const h=harness();
  const proposal={mode:'llm',provider:'deepseek',model:'deepseek-chat',generatedAt:'2026-10-27T01:00:00Z',summary:'错误汇总：全园预计产出 99999 kg。',
    zones:[{zone:'A',frequencyPerWeek:3,reason:'订单缺口较大且每次割胶贡献为正，建议三次。',inputKeys:['demand','cost']},{zone:'B',frequencyPerWeek:1,reason:'B区预留恢复时间，本周安排一次。',inputKeys:['cost']}],
    drivers:[{inputKey:'demand',interpretation:'已扣除可售库存后仍有新增需求。',effect:'increase'}],risks:['公开价格是月均参考，实际成交需要核实。']};
  const inputs=[{key:'demand',label:'未来7天填报订单'},{key:'cost',label:'可变成本'}];
  const page=h.ParkModelReasoning({proposal,inputs,zones:[{zone:'A',frequency:1,eligibleTrees:40},{zone:'B',frequency:1,eligibleTrees:40}],
    adjustments:[{zone:'A',kind:'capacity',requestedFrequency:3,finalFrequency:1,reason:'当前剩余仓容仅容纳一次新增产量。'}]});
  const content=text(page);
  for(const expected of ['大模型提出建议','deepseek-chat','模型本周目标 3 次 → 单树本周最多 1 次','订单缺口较大','未来7天填报订单','仓容：当前剩余仓容仅容纳一次新增产量','硬约束核验后保留模型割次','支持增割','实际成交需要核实'])assert.ok(content.includes(expected),expected);
  assert.match(content,/全园产量由系统按可执行排程计算/);
  assert.doesNotMatch(content,/错误汇总|99999/,'未核实的模型自由摘要不能覆盖系统产量');
  assert.deepEqual([...new Set(walk(page,node=>node.type==='a').map(node=>node.props.href))],['#pp-evidence-demand','#pp-evidence-cost']);
  let prevented=false;
  walk(page,node=>node.type==='a')[0].props.onClick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true,'evidence navigation must not replace the application hash route');
  assert.deepEqual(h.calls.scrolled,[{id:'pp-evidence-demand',options:{behavior:'smooth',block:'start'}}]);
  assert.doesNotMatch(content,/分值|合计.*分|≥2|≤−2/);
});
