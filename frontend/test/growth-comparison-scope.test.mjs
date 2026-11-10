import test from 'node:test';
import assert from 'node:assert/strict';
import {growthComparisonInput} from '../src/integration/growthComparisonModel.ts';

const prediction=(treeId,at,value)=>({treeId,at,value,method:'demo',sourceRefs:[]});
const strategy={siteId:'demo-guangdong-maoming',inputSnapshot:{snapshotId:'frozen-1',version:2},proposal:{predictions:[prediction('T-0001','2026-12-01',67),prediction('T-0002','2026-11-01',80),prediction('T-0001','2026-11-01',66.5)],futurePanelPlan:[{treeId:'T-0001',reason:'复测后核对'}]}};
const context={siteId:strategy.siteId,snapshotId:'frozen-1',version:2,targetSnapshot:{treeIds:['T-0001','T-0002']},modules:{trees:[{treeId:'T-0001',siteId:strategy.siteId,circumferenceCm:66}],tapping:{panels:[{treeId:'T-0001',actualCutSlopeDeg:0,plannedCutSlopeDeg:30}]}}};

test('comparison uses the selected park and tree, keeps dates ordered and preserves a measured zero angle',()=>{
 const result=growthComparisonInput(strategy,context,'T-0001');
 assert.equal(result.tree.circumferenceCm,66);
 assert.deepEqual(result.predictions.map(item=>[item.treeId,item.value]),[['T-0001',66.5],['T-0001',67]]);
 assert.equal(result.angle,0);
 assert.equal(result.plan.reason,'复测后核对');
 assert.equal(strategy.proposal.predictions[0].value,67);
});
test('same tree number in another park or a newer input snapshot cannot replace the frozen comparison',()=>{
 for(const patch of [{siteId:'demo-hainan'},{snapshotId:'frozen-2'},{version:3},{targetSnapshot:{treeIds:['T-0002']}}]){
  assert.equal(growthComparisonInput(strategy,{...context,...patch},'T-0001'),null);
 }
 assert.equal(growthComparisonInput(strategy,{...context,modules:{...context.modules,trees:[{...context.modules.trees[0],siteId:'demo-hainan'}]}},'T-0001'),null);
 assert.equal(growthComparisonInput(strategy,context,'T-0099'),null);
});
test('invalid forecasts and absent angles are not turned into visible predictions or invented cut lines',()=>{
 const invalid={...strategy,proposal:{...strategy.proposal,predictions:[prediction('T-0001','bad-date',68),prediction('T-0001','2026-11-01',-1),prediction('T-0001','2026-11-01',NaN)]}};
 const result=growthComparisonInput(invalid,{...context,modules:{trees:context.modules.trees}},'T-0001');
 assert.deepEqual(result.predictions,[]);
 assert.equal(result.angle,null);
});
