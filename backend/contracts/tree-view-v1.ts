// 2026-10-03 delivery draft; field baseline for MH, not runtime type enforcement.
import type { ContextSnapshot, Strategy, Failed, NeedsData, RunAccepted } from './harness-v1.ts';
export type TreeKind = 'tapping_angle' | 'surface_action' | 'growth_plan' | 'pest_risk';
export type DataMode = 'demo' | 'mixed_demo';
export type GeneratorMode = 'demo_rules' | 'configured';
export type TreeManifest = {version:'1';kind:'tapping_angle';dataMode:'mixed_demo';items:Array<{objectName:string;treeId:string;label:string}>};
export type PrepareTreesRequest = {preparationId:string;treeIds?:string[];kind?:TreeKind;dataMode?:DataMode;generatorMode:GeneratorMode;preserveConfigured?:boolean};
export type PrepareTreesResponse = {preparationId:string;treeIds:string[];kind:TreeKind;dataMode:DataMode;generatorMode:GeneratorMode;createdAt:string;asOf:string;items:Array<RunAccepted & {treeId:string}>};
export type StrategyRoute = {version:'strategy-route-v1';treeId:string;kind:TreeKind;complexity:'simple'|'complex'|'blocked';executor:'small_brain'|'big_brain'|'blocked';status:'ready'|'needs_big_brain'|'blocked';triggers:string[];blockers:string[];recommendedGenerator:'demo_rules'|'configured'|null;reason:string;checkedAt:string};
export type TreeView = {tree:NonNullable<ContextSnapshot['modules']['trees']>[number] & {profile:'normal'|'scar'|'lesion'|'unregistered'|'resting'|'missing'};strategy:Extract<Strategy,{kind:TreeKind}> | null;strategyStatus:'available'|'needs_generation'|'pending'|'expired'|'withdrawn'|'needs_data'|'failed';status:RunAccepted['status']|'not_generated';run:(RunAccepted & {stage:string;updatedAt:string;generatorMode:GeneratorMode})|null;asOf:string|null;checkedAt:string;strategyRoute:StrategyRoute;dataPolicy:{mode:DataMode;notices:string[];substitutions:Array<{module:string;sourceId:string;reason:string}>};missingData?:NeedsData['missingData'];error?:Failed['error']};
