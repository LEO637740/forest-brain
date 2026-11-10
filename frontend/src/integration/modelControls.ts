import type {ModelControl,ModelMeta} from './modelGenerationFlow';
import type {StrategyRefreshState} from './strategyRefreshState';

export type AutomaticStatus = {
  status:string;
  paused?:boolean;
  lastTrigger?:{type:string;eventId:string;sourceIds?:string[];at?:string};
  config?:{enabled:boolean;intervalMinutes:number;maxRunsPer24Hours:number;maxModelRequestsPer24Hours:number};
  jobs?:{id:string;kind:string;treeIds:string[]}[];
  budget?:{runs:number;modelRequests:number};
  nextCheckAt?:string|null;
  lastResultStatus?:string;
  lastError?:{code?:string;message?:string;details?:string[]}|null;
  circuitReason?:{code:string;message:string}|null;
};
type Post = <T>(path:string,body:unknown)=>Promise<T>;

export function modelResumeReason(meta?:ModelMeta,control?:ModelControl,error?:string):string {
  if(error)return '模型状态暂不可读，请重新核验。';
  if(!meta||!control)return '正在核验模型状态…';
  if(!['llm','candidate_service'].includes(meta.generator))return '当前为规则演示，未启用模型服务。';
  if(!meta.llm?.configured)return '模型服务尚未配置。';
  return '';
}
export async function changeModelPause(paused:boolean,send:Post):Promise<ModelControl> {
  // Model and scheduler controls remain separate: resuming one never resumes the other.
  return send<ModelControl>('/api/model/control',{paused});
}
export async function changeAutomaticPause(paused:boolean,automatic:AutomaticStatus|undefined,meta:ModelMeta|undefined,control:ModelControl|undefined,send:Post,refresh?:StrategyRefreshState):Promise<AutomaticStatus> {
  if(!paused){
    if(!automatic?.config?.enabled&&!refresh?.enabled)throw Error('本次启动未启用自动分析，请使用默认启动或 node start.mjs --automatic。');
    const reason=modelResumeReason(meta,control);
    if(reason)throw Error(reason);
    if(control?.paused!==false)throw Error('请先明确恢复模型调用，再恢复自动分析。');
  }
  return send<AutomaticStatus>('/api/automatic/control',{paused});
}
