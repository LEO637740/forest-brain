import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseAst,transformWithOxc} from 'vite';
import {ECONOMIC_SCENARIOS,economicImpact} from '../../backend/src/economic-scenario.js';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/EconomicFactors.tsx',import.meta.url),'utf8'),'EconomicFactors.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const Monitor=()=>React.createElement('section',null,'价格因素体检');
const Component=new Function('React','PriceFactorMonitor',`${declarations};return EconomicFactors;`)(React,Monitor);
const base={productionKg:40,transportKgPerDay:40,salesCapacityKgPerDay:40,demandIndex:105,priceCnyPerKg:15,costPerTapping:1};
const impact=economicImpact(ECONOMIC_SCENARIOS[1],base,{...base,productionKg:24,transportKgPerDay:20,priceCnyPerKg:16.2});
function render(value='typhoon') {return renderToStaticMarkup(React.createElement(Component,{value,onChange(){},onCalculate(){},busy:false,impact}));}

test('saved economic scenarios keep their current choice visible and fold calculations',()=>{
  const html=render(),tree=Component({value:'typhoon',onChange(){},onCalculate(){},busy:false,impact,siteId:'demo-hainan'});
  const children=React.Children.toArray(tree.props.children);
  const settings=children.find(child=>child.type==='details');
  const monitor=children.find(child=>child.type===Monitor);
  assert.equal(monitor.props.siteId,'demo-hainan','price guidance is visible beside the collapsed settings');
  assert.equal(settings.props.open,false);
  const visible=renderToStaticMarkup(React.Children.toArray(settings.props.children).find(child=>child.type==='summary')); 
  for(const scenario of ECONOMIC_SCENARIOS)assert.ok(html.includes(`value="${scenario.id}"`));
  assert.match(visible,/模拟/);
  assert.match(html,/重新测算/);
  assert.match(visible,/经营情景 · 台风影响生产运输/);
  assert.match(html,/可采产量减少 40%/);
  assert.doesNotMatch(visible,/年作业与加工费用|收回机器投入|单次割胶成本|投入 60,000/);
  assert.match(html,/从原始条件到本次情景/);
  assert.match(html,/示例机器投入 60,000 元/);
  assert.match(html,/未计土地、税费与融资成本/);
});

test('a newly selected scenario keeps the old saved calculation identified until recalculation',()=>{
  const html=render('demand_weak');
  assert.match(html,/情景已改变，重新测算后生效/);
  assert.match(html,/当前方案：台风影响生产运输/);
  assert.match(html,/value="demand_weak" selected=""/);
});

test('baseline scenario does not label the whole mixed-source plan as simulated',()=>{
  const tree=Component({value:'baseline',onChange(){},onCalculate(){},busy:false});
  const details=React.Children.toArray(tree.props.children).find(child=>child.type==='details');
  const summary=React.Children.toArray(details.props.children).find(child=>child.type==='summary');
  const html=renderToStaticMarkup(summary);assert.match(html,/不叠加情景假设/);assert.doesNotMatch(html,/模拟/);
});
