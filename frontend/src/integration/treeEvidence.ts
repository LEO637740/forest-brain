import type {ContextSnapshot,StrategyHeader} from './contracts';

type TreeRecord = NonNullable<ContextSnapshot['modules']['trees']>[number];
type Provenance = TreeRecord['provenance'];

export function recordTime(value:string|null|undefined):string {
  if(!value||!Number.isFinite(Date.parse(value)))return '未提供';
  return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}

export function recordSource(source:Provenance|undefined):string {
  if(!source)return '来源待补充';
  const modes:Record<string,string>={measured:'实测记录',estimated:'估计值',forecast:'预测值',simulated:'模拟记录'};
  const classes:Record<string,string>={sensor_device:'设备通道',web_service:'公开数据服务',research_partner:'研究伙伴通道',farmer_expert:'胶农与专家通道'};
  return (modes[source.mode]||'来源模式待确认')+' · '+(classes[source.sourceClass]||'来源类型待确认');
}

export function tappingState(status:TreeRecord['tappingStatus']):string {
  return ({immature:'未达开割条件',available:'可安排复核',resting:'休割养护',blocked:'暂不安排作业',unknown:'作业状态待确认'})[status];
}

export function matchesStrategyInput(context:ContextSnapshot|undefined,input:StrategyHeader['inputSnapshot']|undefined):boolean {
  return Boolean(context&&(!input||context.snapshotId===input.snapshotId&&context.version===input.version));
}

export function frozenMeasurements(context:Pick<ContextSnapshot,'modules'>|undefined,treeId:string){
  return [...(context?.modules.growth?.measurements||[])].filter(row=>row.treeId===treeId).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
}

export function profileDifference(current:TreeRecord|undefined,frozen:TreeRecord|undefined):string {
  if(!current||!frozen)return '当前档案与本轮分析输入分别读取；后续记录不会改写这份已生成的建议。';
  if(current.measuredAt&&frozen.measuredAt&&Date.parse(current.measuredAt)>Date.parse(frozen.measuredAt)){
    return '当前档案记录时间晚于本轮输入；这份建议仍依据生成时保存的资料，请结合较新的记录复核。';
  }
  if(current.heightM!==frozen.heightM||current.circumferenceCm!==frozen.circumferenceCm||current.measuredAt!==frozen.measuredAt){
    return '当前档案与本轮输入存在差异；这份建议仍依据生成时保存的资料，请核对后使用。';
  }
  return '当前档案的尺寸和测量时间与本轮输入一致；后续记录不会改写这份已生成的建议。';
}
