import type {Site,Task} from '../model';
import type {AnalyticsTopic} from '../AnalyticsPage';
import type {DataTab,PublicReferenceTab} from '../DataCenter';
import {BackendStrategyWorkspace} from '../../integration/StrategyWorkspace';
import './strategy.css';
import '../dataCenter.css';

export type StrategyTab='park'|'market'|'industry'|'health'|'reviews'|'tree'|'weather'|'records';
export type StrategyCenterProps={site:Site;tasks:Task[];tab:StrategyTab;onTab:(t:StrategyTab)=>void;onTree:(i:number)=>void;onData?:(tab?:DataTab,reference?:PublicReferenceTab,analysis?:AnalyticsTopic)=>void;onTasks?:(taskId?:string)=>void|Promise<void>;onTask?:(task:Task)=>void;marketModelId?:string|null;onLatestMarket?:()=>void;parkPlanId?:string|null;onLatestParkPlan?:()=>void;allowBusiness?:boolean};
export function StrategyCenter(props:StrategyCenterProps){
 return <BackendStrategyWorkspace {...props}/>;
}
