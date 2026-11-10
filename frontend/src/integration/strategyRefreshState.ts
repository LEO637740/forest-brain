export type StrategyRefreshState = {
  enabled:boolean;
  intervalMinutes:number;
  startupCatchUp:boolean;
  treeModelsEnabled?:boolean;
  status:'idle'|'running'|'paused'|'partial'|'failed'|'disabled';
  lastStartedAt?:string|null;
  lastFinishedAt?:string|null;
  nextRunAt?:string|null;
  lastError?:string|{message?:string;code?:string}|null;
  scope:{siteIds:string[];kinds:string[]};
  items:{kind:string;label:string;status:string;lastSuccessAt?:string|null;deferred?:number;fallbacks?:number;failed?:number;error?:string|{message?:string;code?:string}|null}[];
};

export const strategyRefreshPath=(siteId:string)=>`/api/strategy-refresh/status?siteId=${encodeURIComponent(siteId)}`;
export const refreshError=(error:StrategyRefreshState['lastError'])=>typeof error==='string'?error:error?.message||error?.code||'';
export const refreshStatusLabel=(status:string)=>({idle:'等待下次更新',running:'正在更新',paused:'已暂停',partial:'部分更新未完成',failed:'本轮更新失败',disabled:'未启用',queued:'等待更新',succeeded:'已更新',available:'已更新',pending:'等待更新',skipped:'本轮已跳过',current:'已有有效结果',needs_data:'待补充资料'}[status]??status);
export function refreshCovers(state:StrategyRefreshState|undefined,siteId:string,kind:string):boolean {
  return Boolean(state?.enabled&&state.scope.siteIds.includes(siteId)&&state.scope.kinds.includes(kind));
}
export function hasNewStrategy(currentId:string|undefined,incomingId:string|undefined,currentAt?:string,incomingAt?:string):boolean {
  return Boolean(currentId&&incomingId&&currentId!==incomingId&&(!currentAt||!incomingAt||Date.parse(incomingAt)>=Date.parse(currentAt)));
}
