import { makeParkContext } from '../src/adapters/park-demo.js';
import { makeMixedContext, makePublicContext, makeIndustryContext } from '../src/adapters/public-context.js';
import { digest } from '../src/util.js';

// Nine bounded live-model cases and two preflight rejections (zero model calls).
// Reuse the same public/mixed adapters as the UI and automatic runner.
export const FOLLOWUP_CASES = [
  {id:'mixed-weather',kind:'weather_window',treeIds:['T-0012']},
  {id:'mixed-angle',kind:'tapping_angle',treeIds:['T-0012']},
  {id:'mixed-surface-group',kind:'surface_action',treeIds:['T-0001','T-0012','T-0005','T-0006']},
  {id:'mixed-growth-group',kind:'growth_plan',treeIds:['T-0001','T-0002','T-0003']},
  {id:'mixed-market',kind:'market_scenario',treeIds:['T-0012']},
  {id:'mixed-pest-group',kind:'pest_risk',treeIds:['T-0001','T-0005','T-0015']},
  {id:'mixed-industry',kind:'industry_brief'},
  {id:'rain-observed',kind:'weather_window',treeIds:['T-0012'],variant:'rainy'},
  {id:'missing-cost',kind:'market_scenario',treeIds:['T-0012'],variant:'missing_cost'},
  {id:'strict-missing-weather',kind:'weather_window',treeIds:['T-0012'],mode:'public',expectedStatus:'needs_data'},
  {id:'resting-tree',kind:'tapping_angle',treeIds:['T-0031'],expectedStatus:'needs_data'},
];

export function validationContext(spec,service,now) {
  const c=spec.kind==='industry_brief'?makeIndustryContext({service,now,supplementSimulated:spec.mode!=='public'}):
    spec.mode==='public'?makePublicContext({treeIds:spec.treeIds,service,now}):
    spec.mode==='demo'?makeParkContext({treeIds:spec.treeIds,now}):makeMixedContext({treeIds:spec.treeIds,service,now});
  if(spec.variant==='rainy')c.modules.weather.observed.rainfallMm=4.2;
  if(spec.variant==='missing_cost')c.modules.market.costAssumptions=null;
  c.snapshotId=`input-${digest({...c,snapshotId:'pending'}).slice(0,24)}`;
  return c;
}

export function acceptanceErrors(spec,result,events) {
  const expected=spec.expectedStatus??'succeeded', errors=[];
  if(result.status!==expected)return [`Expected ${expected}, got ${result.status}: ${result.error?.code??''}`];
  if(expected==='needs_data'){
    if(events.some(e=>e.stage==='llm_request'))errors.push('Preflight missing data must not call the model');
    return errors;
  }
  const p=result.strategy.proposal;
  if(spec.variant==='rainy'&&p.windows.some(w=>w.suitability==='suitable'))errors.push('Observed rain cannot produce suitable windows');
  if(spec.variant==='missing_cost'&&(p.recommendedScenarioId!==null||p.scenarios.some(s=>s.expectedDryRubberKg!==null||s.estimatedContributionCny!==null)))errors.push('Missing cost/production assumptions cannot yield quantities, contribution or a selected scenario');
  if(spec.id==='mixed-pest-group'&&['T-0005','T-0015'].some(id=>!p.inspectionTargets.includes(id)))errors.push('Both trees with recent symptoms must be retained');
  if(spec.id==='mixed-surface-group'&&p.findings.find(f=>f.treeId==='T-0006')?.affectsCut!=='unknown')errors.push('Unregistered image geometry must stay unknown');
  return errors;
}
