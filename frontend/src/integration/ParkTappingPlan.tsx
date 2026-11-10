import {useEffect, useRef, useState} from 'react';
import {ArrowRight, CalendarDays, CloudRain, RefreshCw} from 'lucide-react';
import {alias, post, siteIdOf, useRead, type EnvironmentSite} from './client';
import {hasNewStrategy} from './strategyRefreshState';
import {when} from './Views';
import {can, currentAccount} from '../workspace/identityModel';
import {EconomicFactors,type EconomicImpact,type EconomicScenarioId} from './EconomicFactors';
import {ParkEconomicEvidence,ParkBusinessInputsEditor,ParkModelReasoning,type ParkEconomics,type ParkModelProposal,type ParkConstraintAdjustment} from './ParkEconomics';
import type {Task} from '../workspace/model';
import './strategyBrain.css';

export type ParkSignal = {key:string;label:string;value:string;score:number;detail:string;source:string};
export type OutlookDay = {date:string;rainProbabilityPct:number|null;rainMm:number|null;source:string;tappable:boolean;reasons:string[];heldZones:string[];blockReason?:'rain'|'review'|'missing_weather'|'event'|'short_window'|'elapsed';workWindows?:{start:string;end:string}[]};
export type ParkZone = {zone:string;robot:string;eligibleTrees:number;excluded:{reason:string;count:number}[];frequency:number;existingFrequency?:number;totalFrequency?:number;dates:string[];expectedDryKg:number;hold:string|null;existingTasks?:{id:string;date:string;status:string;done:number;count:number}[];schedule?:{date:string;start:string;end:string;windowStart:string;windowEnd:string}[]};
export type ParkReadyTree = {treeId:string;treeIndex:number;zone:string};
export type ParkReviewTree = ParkReadyTree & {reasons:string[];reviewKind:'capture'|'inspect'|'measure'|'refresh'|'rest'};
export type ParkReadiness = {checkedAt:string;readyCount:number;reviewCount:number;totalCount:number;readyTrees:ParkReadyTree[];reviewTrees:ParkReviewTree[];exceptionCases:{treeId:string;profile:string;label:string}[]};
export type ParkPlan = {id:string;siteId:string;park:string;generatedAt:string;validUntil:string;stance:'increase'|'hold'|'reduce'|'pause';stanceLabel:string;
  readiness?:ParkReadiness;
  weather?:{mode:'live';provider:string;fetchedAt:string|null;validUntil:string|null;decisionFingerprint:string;status:string;summary:string;workingHours:string;minutesPerTree:number};
  weatherCheck?:{needsRecompute:boolean;reason:string|null;currentFetchedAt:string|null};
  economicScenarioId?:EconomicScenarioId;economicImpact?:EconomicImpact;
  modelProposal?:ParkModelProposal;constraintAdjustments?:ParkConstraintAdjustment[];
  economics?:ParkEconomics;economicCheck?:{needsRecompute:boolean;reason?:string|null};
  frequencyPerWeek:number;marketTargetFrequency?:number;baselineFrequency:number;headline:string;score:number|null;signals:ParkSignal[];outlook:OutlookDay[];zones:ParkZone[];
  production:{expectedDryKg:number;baselineDryKg:number;deltaKg:number};
  inventory:{stockKg:number;storageKg:number;utilization:number;plannedSalesKg:number;projectedEndKg:number;overflowKg:number};
  cerebellumVersion:string;salesHint:string;analogy:string;limitations:string[];
  adoption?:{adoptedAt:string;adoptedBy:string;skipped:{zone:string;date:string;reason:string;taskIds?:string[]}[];replacedTaskIds:string[];
    reviewTrees?:ParkReviewTree[];
    existingTasks?:{id:string;zone:string;date:string;status:string;done:number;count:number}[];
    tasks:{id:string;zone:string;date:string;status:string;done:number;count:number}[]}};

export const stanceTone:Record<ParkPlan['stance'],string> = {increase:'pp-up',hold:'pp-hold',reduce:'pp-down',pause:'pp-stop'};
const day = (date:string) => `${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;

/** Calendar cells for one zone: whether it taps on each outlook day, and why not. */
export function zoneCells(plan:ParkPlan, zone:ParkZone) {
  return plan.outlook.map(item => {
    const existing=zone.existingTasks?.filter(task=>task.date===item.date)??[];
    const eventHeld=item.heldZones.includes(zone.zone),zonePaused=Boolean(zone.hold)&&zone.frequency===0, reason=zonePaused?zone.hold!:(item.reasons.join('；')||zone.hold||'');
    const kind=item.blockReason??(item.rainProbabilityPct===null||item.rainMm===null?'missing_weather':/复核|恢复/.test(reason)?'review':'rain');
    return {date:item.date,tap:zone.dates.includes(item.date),blocked:zonePaused||!item.tappable||eventHeld||existing.length>0,reason:existing.length?'该区当天已有割胶任务，保留原任务与进度':reason,
      label:existing.length?'已排':zonePaused?(zone.hold!.includes('窗口')?'窗口短':'暂停'):eventHeld?'事件':({rain:'雨',review:'待核',missing_weather:'缺天气',event:'事件',short_window:'窗口短',elapsed:'已过'})[kind],
      schedule:zone.schedule?.find(row=>row.date===item.date)};
  });
}

function ReviewTreeList({trees,siteId}:{trees:ParkReviewTree[];siteId:string}) {
  return <ul>{trees.map(tree => <li key={tree.treeId}>
    <strong>{alias(tree.treeId,siteId)}</strong> <small>（{tree.treeId}）</small><ul>{tree.reasons.map((reason,index) => <li key={`${tree.treeId}:${index}`}>{reason}</li>)}</ul>
  </li>)}</ul>;
}

export function ParkTappingPlan({site,onTasks,onReview,planId,onLatest,tasks=[]}:{site:EnvironmentSite;onTasks?:(taskId?:string)=>void|Promise<void>;onReview?:()=>void;planId?:string|null;onLatest?:()=>void;tasks?:Task[]}) {
  const siteId = siteIdOf(site), account = currentAccount();
  const [plan, setPlan] = useState<ParkPlan|null>(null);
  const sourceId=planId?(plan?.id??planId):null;
  const latest = useRead<{plan:ParkPlan|null}>(sourceId?`/api/park-plan/${encodeURIComponent(sourceId)}?siteId=${siteId}`:`/api/park-plan/latest?siteId=${siteId}`,{pollMs:60_000});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState('');
  const actionLock=useRef(false);
  const generatedTasks=(plan?.adoption?.tasks??[]).map(summary=>{const current=tasks.find(task=>task.id===summary.id&&`demo-${task.site}`===siteId);return current?{...summary,status:current.status,done:current.done,count:current.count}:summary;}).sort((a,b)=>a.date.localeCompare(b.date)||a.zone.localeCompare(b.zone));
  const existingTasks=(plan?.adoption?.existingTasks??[]).map(summary=>{const current=tasks.find(task=>task.id===summary.id&&`demo-${task.site}`===siteId);return current?{...summary,status:current.status,done:current.done,count:current.count}:summary;});
  const relatedTasks=[...generatedTasks,...existingTasks];
  const nextTask=relatedTasks.find(task=>!['已完成','已取消'].includes(task.status))??relatedTasks[0];
  async function openTasks(taskId?:string){
    if(opening||!onTasks)return;
    setOpening(true);setError('');
    try{await onTasks(taskId);}catch(e){setError((e as Error).message);}finally{setOpening(false);}
  }
  const [economicScenarioId,setEconomicScenarioId]=useState<EconomicScenarioId>('baseline');
  const [opening,setOpening]=useState(false);
  const [pendingAction,setPendingAction]=useState<'compute'|'adopt'|null>(null);
  const [weatherChanged,setWeatherChanged]=useState(false);
  const [economicChanged,setEconomicChanged]=useState(false);
  const [generationFailed,setGenerationFailed]=useState(false);
  const legacyPlan=Boolean(plan&&!plan.modelProposal);
  const scenarioChanged=Boolean(plan&&economicScenarioId!==(plan.economicScenarioId??'baseline'));
  const weatherExpired=Boolean(plan?.weather?.mode==='live'&&(!plan.weather.validUntil||Date.parse(plan.weather.validUntil)<=Date.now()));
  const weatherNeedsRecompute=weatherChanged||Boolean(plan?.weatherCheck?.needsRecompute)||weatherExpired;
  const weatherReason=weatherChanged?'天气已更新，正在核验本方案。':plan?.weatherCheck?.reason||(weatherExpired?'本方案使用的天气已过期，请按最新天气重新测算。':'');
  const economicNeedsRecompute=economicChanged||Boolean(plan?.economicCheck?.needsRecompute);
  const economicReason=plan?.economicCheck?.reason||'经营输入已更新，请重新测算后采用。';
  const recomputeLabel=legacyPlan?'请大模型生成策略':weatherNeedsRecompute?'按最新天气请模型重算':economicNeedsRecompute?'按最新经营数据请模型重算':null;
  const readiness=plan?.readiness;
  const pausePlan=Boolean(plan&&plan.zones.every(zone=>(zone.schedule?.length??zone.dates.length)===0));
  const retainedPlan=pausePlan&&Boolean(plan?.zones.some(zone=>(zone.existingFrequency??0)>0));
  const noNewLabel=retainedPlan?'保留现有安排':'暂停安排';
  const canAdopt = !account || can(account, 'park_plan.write');
  const incomingPlan=latest.data?.plan;
  const hasUpdate=hasNewStrategy(plan?.id,incomingPlan?.id,plan?.generatedAt,incomingPlan?.generatedAt);
  const showUpdate=hasUpdate&&(Boolean(plan?.adoption)||scenarioChanged||economicChanged||Boolean(planId));
  function loadNewPlan(){if(!incomingPlan)return;setPlan(incomingPlan);setEconomicScenarioId(incomingPlan.economicScenarioId??'baseline');setEconomicChanged(false);setWeatherChanged(false);setGenerationFailed(false);setConflict('');}
  async function compute() {
    if(actionLock.current)return;actionLock.current=true;
    setBusy(true); setPendingAction('compute'); setError('');setGenerationFailed(false);
    // Recompute first refreshes lapsed hour-long tree strategies; with all 200
    // lapsed that took about 23 s locally, so allow well beyond the 12 s default.
    try { setPlan(await post<ParkPlan>('/api/park-plan', {siteId,economicScenarioId}, {timeoutMs:180_000})); setConflict('');setWeatherChanged(false);setEconomicChanged(false); }
    catch (e) { setError(`本次模型未生成新策略：${(e as Error).message}`);setGenerationFailed(true); }
    finally { actionLock.current=false;setBusy(false);setPendingAction(null); }
  }
  useEffect(() => {
    if (!latest.data) return;
    const fresh = latest.data.plan;
    if (fresh) {
      if(!busy&&(!plan||fresh.id===plan.id||(hasUpdate&&!planId&&!plan.adoption&&!scenarioChanged&&!economicChanged))){setPlan(fresh);if(fresh.id!==plan?.id){setEconomicScenarioId(fresh.economicScenarioId??'baseline');setEconomicChanged(false);setGenerationFailed(false);}setWeatherChanged(false);}
    }
  }, [latest.data]);
  useEffect(()=>{
    const refresh=()=>{setWeatherChanged(true);latest.reload();};
    window.addEventListener('harness-park-weather-changed',refresh);
    return()=>window.removeEventListener('harness-park-weather-changed',refresh);
  },[siteId,sourceId]);
  async function adopt(replace = false) {
    if (!plan||actionLock.current) return;
    if(!plan.modelProposal||generationFailed){setError('请先由大模型成功生成新策略，再确认采用。');return;}
    if (!plan.readiness) {setError('此方案尚未完成执行预检，请重新测算后采用。');return;}
    if(weatherNeedsRecompute){setError(weatherReason||'天气已改变，请重新测算后采用。');return;}
    if(economicNeedsRecompute){setError(economicReason);return;}
    actionLock.current=true;
    setBusy(true); setPendingAction('adopt'); setError('');
    try {
      setPlan(await post<ParkPlan>(`/api/park-plan/${plan.id}/adopt`, {siteId, replace}));
      setConflict('');
      window.dispatchEvent(new Event('harness-tasks-created'));
    } catch (e) {
      const message = (e as Error).message;
      if (/已有采用中的全园策略/.test(message)) setConflict(message); else setError(message);
    } finally { actionLock.current=false;setBusy(false);setPendingAction(null); }
  }
  if (site === 'xian') return <section className="pp-page"><p>西安试验站不安排生产割胶强度策略。</p></section>;
  return <section className="pp-page" aria-labelledby="pp-title">
    {planId&&<p className="pp-note">{plan&&plan.id!==planId?'已基于所选方案重新测算':'查看已保存的原全园方案'} {onLatest&&<button className="rb-button" onClick={onLatest}>查看最新方案</button>}</p>}
    <header className="pp-head">
      <div><span className="pp-eyebrow">全园割胶策略 · 本周</span><h2 id="pp-title">{plan ? plan.headline : '由大模型提出本周割胶策略'}</h2>
        <p>{plan?.modelProposal?'大模型综合分析行情、成本、需求与库存 · 硬约束核验排程':plan?'历史规则方案':'先读取经营数据，再请模型提出割次建议'} · {pausePlan?'本方案暂不新增割胶任务':'采用后生成分区任务'}</p></div>
      {plan && <strong className={`pp-stance ${stanceTone[plan.stance]}`}>{plan.stanceLabel}<small>各区单树本周最多 {plan.frequencyPerWeek} 次</small></strong>}
    </header>
    {latest.error && <p role="alert">读取失败：{latest.error} <button className="rb-button" onClick={latest.reload}>重试</button></p>}
    {showUpdate&&<p className="pp-note" role="status">后台已有新方案，当前条件与已采用任务仍保留。 <button className="rb-button" disabled={busy} onClick={loadNewPlan}>{scenarioChanged||economicChanged?'查看新方案并重置本页选择':'查看后台新方案'}</button></p>}
    {error && <p className="pp-error" role="alert">{error}{generationFailed&&plan?' 下方保留的是上次方案，并非本次生成结果。':''}</p>}
    {busy&&pendingAction==='compute'&&<p className="pp-note" role="status">正在请大模型分析经营数据并提出割次建议，随后核验硬约束；通常需要数十秒。</p>}
    {legacyPlan&&<p className="pp-note" role="status">这是历史规则方案，需由大模型重新生成后才能采用。已采用方案的任务与回传仍可查看。</p>}
    {!plan&&<div className="pp-actions"><button className="rb-button rb-primary" disabled={busy} onClick={compute}>{busy?'模型正在分析…':'请大模型生成策略'}</button></div>}
    {scenarioChanged&&<p className="pp-note" role="status">情景已改变，请重新测算后采用。</p>}
    {plan&&weatherNeedsRecompute&&<p className="pp-error" role="status">{weatherReason} {plan.adoption?'原任务与回传仍可查看，重新测算不会自动替换任务。':'重新测算后才能采用此方案。'}</p>}
    {plan&&economicNeedsRecompute&&<p className="pp-note" role="status">{economicReason} {plan.adoption?'已采用任务保持原方案，重新测算不会自动替换任务。':'下方仍为原方案的数据快照。'}</p>}
    {plan && <>
      {plan.modelProposal&&<ParkModelReasoning proposal={plan.modelProposal} adjustments={plan.constraintAdjustments??[]} zones={plan.zones} inputs={plan.economics?.inputs??[]}/>}
      {plan.economics&&<ParkEconomicEvidence economics={plan.economics} modelGenerated={Boolean(plan.modelProposal)} scenarioLabel={plan.economicScenarioId&&plan.economicScenarioId!=='baseline'?plan.economicImpact?.label:undefined}/>}
      {plan.weather&&<section className="pp-card" aria-label="天气对本方案的影响"><h3>天气已纳入分区安排</h3>
        <p>{plan.weather.provider} · 获取于 {plan.weather.fetchedAt?when(plan.weather.fetchedAt):'尚未获取'} · 有效至 {plan.weather.validUntil?when(plan.weather.validUntil):'待更新'}</p>
        <p>{plan.weather.summary}</p>
        <p><strong>此次新增 {plan.zones.reduce((sum,zone)=>sum+zone.frequency,0)} 项分区作业，{plan.zones.reduce((sum,zone)=>sum+zone.eligibleTrees*zone.frequency,0)} 树次，预计 {plan.production.expectedDryKg} kg 干胶。</strong></p>
        <p className="pp-note">{plan.modelProposal?'模型的各区建议经硬约束核验后，':'原方案记录中，'}实际每区最多 {plan.frequencyPerWeek} 次 / 周；{plan.modelProposal?'具体增减原因见上方对照。':''}只在 {plan.weather.workingHours} 内排程，并预留每树 {plan.weather.minutesPerTree} 分钟；具体时间见分区日历。</p>
      </section>}
      <div className="pp-grid">
        <section className="pp-card" aria-label="产量与仓容"><h3>产量与仓容</h3>
          <dl className="pp-facts">
            <dt>此次新增预计产出</dt><dd>{plan.production.expectedDryKg} kg 干胶<small>较本周2次目标的新增参考产量 {plan.production.deltaKg >= 0 ? '+' : ''}{plan.production.deltaKg} kg</small></dd>
            <dt>当前库存</dt><dd>{plan.inventory.stockKg} / {plan.inventory.storageKg} kg<small>占仓容 {Math.round(plan.inventory.utilization * 100)}%</small></dd>
            <dt>本周计划出货</dt><dd>{plan.inventory.plannedSalesKg} kg</dd>
            <dt>周末库存约</dt><dd className={plan.inventory.overflowKg > 0 ? 'pp-down' : ''}>{plan.inventory.projectedEndKg} kg{plan.inventory.overflowKg > 0 && <small>超出仓容 {plan.inventory.overflowKg} kg</small>}</dd>
          </dl>
          <p className="pp-hint">{plan.modelProposal?'全园产量与库存由系统按可执行排程测算；经营取舍和分区依据见模型理由。':plan.salesHint}</p>
        </section>
      <section className="pp-card pp-adopt" aria-label="采用与执行">
        {readiness ? <section className="pp-readiness" aria-label="采用前执行预检">
          <h3>执行前预检</h3>
          <strong className="pp-readiness-count">可执行 {readiness.readyCount} 棵，待核查 {readiness.reviewCount} 棵</strong>
          <p>仅可执行树生成割胶任务；待核查树单独处理，不混入割胶任务，也不计为完成。</p>
          <p>按当前证据核验；实际开割仍检查天气、设备和策略有效期。</p>
          <small>共 {readiness.totalCount} 棵 · 检查于 {when(readiness.checkedAt)}</small>
          <details className="pp-readiness-list"><summary>查看完整树木清单与待核查原因</summary>
            <h4>待核查 · {readiness.reviewCount} 棵</h4>
            {readiness.reviewTrees.length ? <ReviewTreeList trees={readiness.reviewTrees} siteId={siteId}/> : <p>本次预检没有待核查对象。</p>}
            {readiness.reviewTrees.length > 0 && onReview && <button className="rb-button" onClick={onReview}>打开核查处理</button>}
            <h4>可执行 · {readiness.readyCount} 棵</h4>
            <p className="pp-ready-tree-list">{readiness.readyTrees.length ? readiness.readyTrees.map(tree => `${alias(tree.treeId,siteId)}（${tree.treeId}）`).join('；') : '本次没有可直接执行的树。'}</p>
          </details>
          {readiness.exceptionCases.length > 0 && <details className="pp-demo-cases"><summary>单独演示异常案例 · {Math.min(readiness.exceptionCases.length,9)} 棵</summary>
            <p>这些案例保留在核查流程中，可单独体验补拍、复核或养护。</p>
            <ul>{readiness.exceptionCases.slice(0,9).map(item => <li key={item.treeId}><strong>{alias(item.treeId,siteId)}</strong> <small>（{item.treeId}）</small><span>{item.label}</span></li>)}</ul>
            {onReview && <button className="rb-button" onClick={onReview}>查看异常核查案例</button>}
          </details>}
        </section> : <p className="pp-preflight-missing" role="status">{plan.adoption ? '原方案未保存执行预检结果，可继续查看原任务与回传。' : '此方案未进行执行预检，不能据此确认可执行数量。请重新测算后采用。'}</p>}
        {plan.zones.some(zone => zone.hold) && <p className="pp-down" role="status">分区限制：{plan.zones.filter(zone => zone.hold).map(zone => `${zone.zone}区 · ${zone.hold}`).join('；')}</p>}
        {plan.adoption ? <>
          <h3>{pausePlan?`已采用${noNewLabel}`:'已采用'} · {when(plan.adoption.adoptedAt)}</h3>
          {pausePlan?<p>本方案不新增割胶任务{plan.adoption.replacedTaskIds.length?`；已处理旧策略未开始任务 ${plan.adoption.replacedTaskIds.length} 项`:''}，已完成记录保留。</p>:<p>生成 {plan.adoption.tasks.length} 项分区割胶任务{plan.adoption.skipped.length ? `，${plan.adoption.skipped.length} 项因当天已有任务跳过` : ''}{plan.adoption.replacedTaskIds.length ? `，替换旧策略未开始任务 ${plan.adoption.replacedTaskIds.length} 项` : ''}。</p>}
          <div className="pp-actions">{onTasks&&nextTask&&<button className="rb-button rb-primary" disabled={opening} onClick={()=>void openTasks(nextTask.id)}>{opening?'正在定位任务…':'查看执行与回传'} <ArrowRight size={15}/></button>}<button className="rb-button" disabled={busy} onClick={compute}><RefreshCw size={14}/>{busy?'模型正在分析…':recomputeLabel??'请大模型重新生成'}</button></div>
          <details className="pp-limits"><summary>本方案任务 · {generatedTasks.length} 项</summary><ul className="pp-tasks">{generatedTasks.map(task => <li key={task.id}>{task.zone}区 · {day(task.date)} · {task.status}（{task.done}/{task.count}）{onTasks&&<button className="rb-button" disabled={opening} onClick={()=>void openTasks(task.id)}>打开{task.zone}区任务</button>}</li>)}</ul></details>
          {existingTasks.length>0&&<section className="pp-existing-tasks" aria-label="本周已计入的已有任务"><h4>查看本周已有任务</h4><p>这些任务保留各自的原方案、树木范围和进度；本次未重复创建，可打开继续执行或查看回传。部分树已作业不表示整区已完成。</p><ul className="pp-tasks">{existingTasks.map(task=><li key={task.id}>{task.zone}区 · {day(task.date)} · {task.status}（{task.done}/{task.count}）{onTasks&&<button className="rb-button" disabled={opening} onClick={()=>void openTasks(task.id)}>打开已有{task.zone}区任务</button>}</li>)}</ul></section>}
          {plan.adoption.reviewTrees ? <details className="pp-readiness-list pp-adoption-reviews"><summary>单独核查清单 · {plan.adoption.reviewTrees.length} 棵</summary>
            <p>以下对象未生成割胶任务，不计为割胶完成。核查通过后重新测算，再纳入后续作业。</p>
            {plan.adoption.reviewTrees.length ? <><ReviewTreeList trees={plan.adoption.reviewTrees} siteId={siteId}/>{onReview&&<button className="rb-button" onClick={onReview}>处理本方案待核查对象</button>}</> : <p>本方案没有单独待核查对象。</p>}
          </details> : <p className="pp-note">原采用记录未保存单独核查清单；原任务与回传仍可查看。</p>}
        </> : <>
          <h3>{pausePlan?`采用${noNewLabel}`:'采用并生成分区任务'}</h3>
          <p>{pausePlan?'本方案不新增割胶任务；采用时按冲突确认处理未开始任务，已完成记录保留。':canAdopt?'生成模拟割胶任务，开割前核验天气与设备。':'需由农场管理采用。'}</p>
          {pausePlan&&!canAdopt&&<p>需由农场管理采用。</p>}
          {conflict && <p className="pp-error" role="alert">{conflict}</p>}
          <div className="pp-actions">
            {canAdopt && (conflict
              ? <button className="rb-button rb-primary" disabled={busy||scenarioChanged||weatherNeedsRecompute||economicNeedsRecompute||!readiness||legacyPlan||generationFailed} onClick={() => adopt(true)}>{busy?pendingAction==='compute'?'模型正在分析…':'正在采用…':pausePlan?`确认替换旧策略并采用${noNewLabel}`:'确认替换旧策略并采用'}</button>
              : <button className="rb-button rb-primary" disabled={busy||scenarioChanged||weatherNeedsRecompute||economicNeedsRecompute||!readiness||legacyPlan||generationFailed} onClick={() => adopt(false)}>{busy?pendingAction==='compute'?'模型正在分析…':'正在采用…':pausePlan?`采用${noNewLabel}`:'采用并生成任务'} <ArrowRight size={15}/></button>)}
            <button className="rb-button" disabled={busy} onClick={compute}><RefreshCw size={14}/> {busy?pendingAction==='adopt'?'正在采用…':'模型正在分析…':recomputeLabel??'请大模型重新生成'}</button>
          </div>
        </>}
      </section>
      </div>
      <details className="pp-card pp-disclosure" aria-label="分区割胶日历"><summary><CalendarDays size={17}/>分区日历 · {plan.outlook[0].date} 至 {plan.outlook.at(-1)!.date}</summary>
        <div className="pp-calendar" role="table" aria-label="各区每日安排">
          <div role="row" className="pp-row pp-row-head"><span role="columnheader">分区</span>{plan.outlook.map(item => <span role="columnheader" key={item.date} className={item.tappable ? '' : 'pp-rain'} title={item.reasons.join('；') || '可割'}>
            {day(item.date)}<small>{!item.tappable&&(item.blockReason==='rain'||!item.blockReason&&item.rainProbabilityPct!==null) && <CloudRain size={12}/>}{item.rainProbabilityPct===null?'缺天气':`${item.rainProbabilityPct}%`}</small></span>)}<span role="columnheader">本周</span></div>
          {plan.zones.map(zone => <div role="row" key={zone.zone} className="pp-row">
            <span role="rowheader"><strong>{zone.zone}区</strong><small>{zone.robot} · {zone.eligibleTrees} 棵{readiness ? '可执行' : '原计划范围（未预检）'}</small></span>
            {zoneCells(plan, zone).map(cell => <span role="cell" key={cell.date} className={cell.tap ? 'pp-tap' : cell.blocked ? 'pp-blocked' : ''} title={cell.tap ? cell.schedule?`割胶 ${cell.schedule.start}–${cell.schedule.end}`:'割胶' : cell.reason || '休息'}>{cell.tap ? <>割{cell.schedule&&<small>{cell.schedule.start}–{cell.schedule.end}</small>}</> : cell.blocked ? cell.label : '·'}</span>)}
            <span role="cell" className="pp-sum">单树最多 {zone.totalFrequency??zone.frequency} 次<small>此次新增 {zone.frequency} 次 · {zone.expectedDryKg} kg</small>{Boolean(zone.existingFrequency)&&<small>部分树已有最多 {zone.existingFrequency} 次，进度见原任务</small>}{zone.hold && <small>{zone.hold}</small>}</span>
          </div>)}
        </div>
        <p className="pp-note">“雨”为降雨限制，“待核”为雨后或现场条件需复核，“缺天气”为尚无有效预报，“事件 / 暂停”为设备或现场限制。参数 {plan.cerebellumVersion}；同一区尽量隔天割。</p>
      </details>
      <details className="pp-card pp-disclosure" aria-label="决策依据"><summary>方案口径与记录</summary>
        {plan.modelProposal?<p className="pp-note">经营建议来自 {plan.modelProposal.provider??'已配置模型'} / {plan.modelProposal.model??'模型'}。保存了模型原始建议、所用数据与硬约束核验结果，模型未生成时不提供规则替代方案。</p>:<p className="pp-note">本记录来自历史规则计算，仅保留供复查。</p>}
        <ul className="pp-note">{plan.limitations.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="pp-note">策略编号 {plan.id} · 生成 {when(plan.generatedAt)} · 有效至 {when(plan.validUntil)}</p></details>
    </>}
    <ParkBusinessInputsEditor siteId={siteId} canEdit={canAdopt} onSaved={()=>{setEconomicChanged(true);latest.reload();}}/>
    <EconomicFactors value={economicScenarioId} onChange={setEconomicScenarioId} onCalculate={compute} busy={busy} impact={plan?.economicImpact} siteId={siteId}/>
  </section>;
}
