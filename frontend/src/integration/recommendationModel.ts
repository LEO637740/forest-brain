import {parks} from '../../../shared/parkCatalog.ts';
import type {Strategy} from './contracts';
import {treeAlias,type Site} from '../workspace/model.ts';

export type Recommendation={title:string;target:string;timing:string;reason?:string;tone:'ready'|'review'|'defer';note?:string};
const dateTime=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const date=(at:string)=>new Date(at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'});
const siteNames:Record<string,string>=Object.fromEntries(Object.values(parks).map(park=>[park.siteId,park.name]));
export function recommendationTrees(ids:string[],siteId:string){
  const unique=[...new Set(ids)];
  return unique.slice(0,2).map(id=>treeAlias(Number(id.slice(2))-1,siteId.replace('demo-','') as Site)).join('、')+(unique.length>2?` 等 ${unique.length} 棵树`:'');
}

// Summarize the saved proposal without recalculating or changing its decision.
export function strategyRecommendation(s:Strategy):Recommendation{
  const site=siteNames[s.siteId]||s.siteId;
  switch(s.kind){
    case 'tapping_angle':{
      const p=s.proposal,same=p.previousPlannedCutSlopeDeg===p.recommendedCutSlopeDeg;
      return {title:`${same?'保持':'割胶坡角调整为'}${p.recommendedCutSlopeDeg}°${same?'割胶坡角':''}`,target:recommendationTrees([p.treeId],s.siteId),timing:'下次割胶前确认',tone:'review',note:`${p.previousPlannedCutSlopeDeg==null?'':`原坡角 ${p.previousPlannedCutSlopeDeg}° · `}相对水平面 · 复核后采用`};
    }
    case 'surface_action':{
      const f=s.proposal.findings;
      const capture=f.find(item=>item.action==='capture'),avoid=f.find(item=>item.action==='avoid_with_review'),manual=f.find(item=>['manual_assessment','review'].includes(item.action));
      const first=capture||avoid||manual||f[0];
      return {title:capture?'先补拍树表，再重新配准':avoid?'先复核异常位置，再规划避让':manual?'先人工检查，再决定是否割胶':f.length?'清理并确认后正常割胶':'本次未发现需处理的树表标记',target:recommendationTrees(f.map(item=>item.treeId),s.siteId)||`${site}当前观测对象`,timing:'本次割胶前',tone:f.length?'review':'ready',reason:first?.reason,note:avoid?'避让候选须人工复核':'确认树表与割线的位置关系'};
    }
    case 'weather_window':{
      const windows=s.proposal.windows;
      const candidate=windows.find(w=>w.suitability==='suitable'),review=windows.find(w=>w.suitability==='review'),next=candidate||review||windows[0];
      const prior=candidate?windows.slice(0,windows.indexOf(candidate)):[];
      const deferFirst=prior.find(w=>w.suitability==='defer'),reviewFirst=prior.find(w=>w.suitability==='review');
      return {title:candidate?deferFirst?'先暂缓割胶，待以下时段再安排':reviewFirst?'先复核现场，再安排候选时段':'建议在以下时段安排割胶':review?'先复核现场，再确认割胶时段':'暂缓割胶，等待合适天气',target:`${site}当前作业范围`,timing:next?`${dateTime(next.start)} — ${dateTime(next.end)}（北京时间）`:'等待更新作业窗口',tone:deferFirst?'defer':reviewFirst?'review':candidate?'ready':review?'review':'defer',reason:(deferFirst||reviewFirst||next)?.reason,note:s.proposal.excludedTreeIds.length?`${s.proposal.excludedTreeIds.length} 棵排除对象不参与本次安排`:undefined};
    }
    case 'growth_plan':{
      const p=s.proposal,ids=[...p.futurePanelPlan.map(item=>item.treeId),...p.predictions.map(item=>item.treeId)];
      return {title:p.futurePanelPlan.length?'换面前先复核割面':'关注树围变化，再确认割面安排',target:recommendationTrees(ids,s.siteId)||`${site}当前树木`,timing:p.futurePanelPlan.length?'下次换面前':p.predictions[0]?`预测截至 ${date(p.predictions[0].at)}`:'按后续测量更新',tone:'review',reason:p.futurePanelPlan[0]?.reason,note:p.predictions.length===1?`${date(p.predictions[0].at)} 预测树围 ${p.predictions[0].value} cm`:undefined};
    }
    case 'market_scenario':{
      const p=s.proposal,selected=p.scenarios.find(item=>item.scenarioId===p.recommendedScenarioId);
      return {title:!selected?'先补齐经营条件，再确定生产频次':selected.tappingsPerWeek===0?'本周暂不新增割胶':`建议每周割胶 ${selected.tappingsPerWeek} 次`,target:`${site} · ${p.eligibleTreeCount} 棵可作业树`,timing:'未来一周',tone:!selected?'review':selected.tappingsPerWeek===0?'defer':'ready',reason:selected?.reason,note:p.excludedTreeCount?`${p.excludedTreeCount} 棵因作业条件未纳入`:undefined};
    }
    case 'pest_risk':{
      const p=s.proposal,targets=p.inspectionTargets??p.findings.map(item=>item.treeId),first=(p.riskAssessments??[]).filter(item=>item.riskLevel!=='low').sort((a,b)=>b.riskIndex-a.riskIndex)[0];
      return {title:targets.length?`优先巡查 ${targets.length} 棵重点树`:'保持日常巡查',target:recommendationTrees(targets,s.siteId)||`${site}本轮巡查范围`,timing:`${date(p.horizon.start)} — ${date(p.horizon.end)}`,tone:targets.length?'review':'ready',reason:first?.preventiveActions[0]||p.findings[0]?.reason,note:targets.length?'现场复核后确认处理方式':undefined};
    }
    case 'industry_brief':{
      const p=s.proposal,priorities={high:0,medium:1,low:2},first=[...p.recommendations].sort((a,b)=>priorities[a.priority]-priorities[b.priority])[0];
      return {title:first?.action||s.summary,target:`${site}经营安排`,timing:`${date(p.horizon.start)} — ${date(p.horizon.end)}`,tone:'review',reason:first?.reason};
    }
  }
}
