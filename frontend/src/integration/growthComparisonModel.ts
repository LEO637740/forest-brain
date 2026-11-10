import type {ContextSnapshot,Strategy} from './contracts';

export type GrowthStrategy=Extract<Strategy,{kind:'growth_plan'}>;

/** Compare one tree against the same frozen inputs that produced its forecast. */
export function growthComparisonInput(strategy:GrowthStrategy,context:ContextSnapshot|undefined,treeId:string){
 if(!context||context.siteId!==strategy.siteId||context.snapshotId!==strategy.inputSnapshot.snapshotId||context.version!==strategy.inputSnapshot.version||!context.targetSnapshot.treeIds.includes(treeId))return null;
 const tree=context.modules.trees?.find(item=>item.treeId===treeId);
 if(!tree||(tree.siteId&&tree.siteId!==strategy.siteId))return null;
 const predictions=strategy.proposal.predictions.filter(item=>item.treeId===treeId&&Number.isFinite(item.value)&&item.value>0&&Number.isFinite(Date.parse(item.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const panel=context.modules.tapping?.panels.find(item=>item.treeId===treeId);
 const rawAngle=panel?.actualCutSlopeDeg??panel?.plannedCutSlopeDeg;
 return {tree,predictions,panel,angle:rawAngle!=null&&Number.isFinite(rawAngle)?rawAngle:null,plan:strategy.proposal.futurePanelPlan.find(item=>item.treeId===treeId)};
}
