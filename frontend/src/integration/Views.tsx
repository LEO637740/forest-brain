import {lazy,Suspense,useEffect,useRef,useState,type ReactNode} from 'react';
import type {Strategy,RunResponse,ContextSnapshot} from './contracts';
import {useRead,DATA_MODE,binding,alias,valid,adopt,reviewSurface,adoptWeather,kinds,statuses,type View,type Park,type EnvironmentSite} from './client';
import {TreeModelGeneration} from './TreeModelGeneration';
import {StrategyRefreshStatus} from './StrategyRefreshStatus';
import {IndustryProposal} from './IndustryProposal';
import {StrategyEvidence} from './StrategyEvidence';
import {StrategyRecommendation} from './StrategyRecommendation';
import type {TreeKind} from './modelGenerationFlow';
import {recordTime,recordSource,tappingState,matchesStrategyInput,frozenMeasurements,profileDifference} from './treeEvidence';
import './integration.css';
const GrowthComparison=lazy(()=>import('./GrowthComparison').then(module=>({default:module.GrowthComparison})));
const GrowthReviewDesk=lazy(()=>import('./ReviewDesk').then(module=>({default:module.ReviewDesk})));
export function Card({title,children}:{title:string;children:ReactNode}){return <section className="hb-card"><h2>{title}</h2>{children}</section>;}
export function State({error,reload}:{error?:string;reload?:()=>void}){return <p role="status">{error||'正在读取…'}{error&&reload&&<button onClick={reload}>重试</button>}</p>;}
export const when=(date:string)=>new Date(date).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
export function Chart({values,labels,unit,bars=false}:{values:(number|null)[];labels:string[];unit:string;bars?:boolean}){

 const nums=values.filter((n):n is number=>n!==null&&Number.isFinite(n));if(!nums.length)return <p>暂无测量值</p>;
 const low=bars?0:Math.min(...nums)*.98,high=Math.max(...nums)*1.03||1,range=high-low||1;
 const left=72,right=566,top=45,bottom=200,width=right-left,slot=width/Math.max(1,values.length),barWidth=Math.min(24,slot*.72);
 const x=(i:number)=>bars?left+slot*(i+.5):left+(values.length===1?width/2:i/(values.length-1)*width),y=(n:number)=>bottom-(n-low)/range*(bottom-top);
 return <svg className="hb-chart" viewBox="0 0 610 245" role="img" aria-label={unit+'趋势'}><text x={left} y="20">{unit}</text>{[0,1,2,3].map(i=>{const yy=bottom-i*(bottom-top)/3;return <g key={i}><line x1={left} x2={right} y1={yy} y2={yy}/><text x={left-10} y={yy+4} textAnchor="end">{(low+range*i/3).toFixed(1)}</text></g>;})}{!bars&&<polyline fill="none" stroke="#8eb9aa" strokeWidth="2" points={values.map((v,i)=>v===null?'':x(i)+','+y(v)).join(' ')}/ >}{values.map((v,i)=><g key={i}>{v!==null&&(bars?<rect x={x(i)-barWidth/2} y={y(v)} width={barWidth} height={Math.max(0,bottom-y(v))} fill="#8aa9c2"><title>{`${labels[i]}：${v} ${unit}`}</title></rect>:<circle cx={x(i)} cy={y(v)} r="3" fill="#8eb9aa"><title>{`${labels[i]}：${v} ${unit}`}</title></circle>)}{i%Math.max(1,Math.ceil(values.length/6))===0&&<text x={x(i)} y="226" textAnchor="middle">{labels[i]}</text>}</g>)}</svg>;
}
const surfaceActionLabels:Record<string,string>={
 avoid_with_review:'跳刀 / 避让候选 · 复核后再规划',
 continue_with_review:'清理或确认后正常继续 · 不误跳刀',
 capture:'补拍并重新配准',
 manual_assessment:'人工评估',
 review:'待人工复核',
};
export function StrategyBody({s,allowActions=true,treeId}:{s:Strategy;allowActions?:boolean;treeId?:string}){
 const [message,setMessage]=useState<{strategyId:string;text:string}|null>(null),[evidenceOpen,setEvidenceOpen]=useState(false);
 const [busy,setBusy]=useState(false),[savedAction,setSavedAction]=useState<{strategyId:string;value:string}|null>(null);
 const [selectedSurfaceTree,setSelectedSurfaceTree]=useState(''),[growthOpen,setGrowthOpen]=useState(false);
 const surfaceTargets=s.kind==='surface_action'?[...new Set(s.proposal.findings.map(finding=>finding.treeId))]:[];
 const surfaceTreeId=s.kind==='surface_action'?(treeId??(surfaceTargets.includes(selectedSurfaceTree)?selectedSurfaceTree:surfaceTargets.length===1?surfaceTargets[0]:undefined)):undefined;
 const surfaceFindings=s.kind==='surface_action'?s.proposal.findings.filter(finding=>!surfaceTreeId||finding.treeId===surfaceTreeId):[];
 const displayStrategy=s.kind==='surface_action'&&surfaceTreeId?{...s,proposal:{...s.proposal,findings:surfaceFindings}}:s;
 const submission=useRef({pending:false,strategyId:'',value:''});
 const factorNames:Record<string,string>={variety_prior:'树种先验',tree_age:'树龄',humidity:'相对湿度',soil_moisture:'土壤水分',recent_rainfall:'近7日降雨',latex_viscosity:'胶乳黏度',dry_rubber_content:'干胶含量'};
 const confidenceNames:Record<string,string>={low:'低',medium:'中',high:'高'};
 const AngleModelDetails=({model}:{model:Extract<Strategy,{kind:'tapping_angle'}>['proposal']['angleModel']})=><details className="hb-angle-model"><summary>多因素计算明细</summary><p>状态：{model.optimizationStatus==='validated'?'已验证':'演示先验 / 证据不足'} · 输入完整度 {model.dataCompletenessPct}% · 置信度 {confidenceNames[model.confidence]??'低'}。</p><div className="hb-result-table"><table><thead><tr><th>因素</th><th>输入</th><th>对角度贡献</th><th>来源与说明</th></tr></thead><tbody>{model.factors.map(f=><tr key={f.key}><td>{factorNames[f.key]??f.label}</td><td>{f.inputValue===null?'缺失':`${f.inputValue} ${f.unit}`}</td><td>{f.deltaDeg>0?'+':''}{f.deltaDeg}°</td><td>{f.provenanceMode} · {f.sourceId??'待补充'}<br/><small>{f.note}</small></td></tr>)}</tbody></table></div><p>基准 {model.baselineDeg??'—'}° + 总调整 {model.adjustmentDeg}° = 候选 {model.recommendedCutSlopeDeg??'—'}°{model.clamped?'（已按设备角度边界截断）':''}。</p><p>{model.experimentPlan.join('；')}</p></details>;
 const actionKind=s.kind==='tapping_angle'?'adopt_angle':s.kind==='surface_action'&&surfaceTreeId&&surfaceFindings.length?'surface_review':s.kind==='weather_window'?'adopt_weather':null;
 const actionTreeId=s.kind==='tapping_angle'?s.proposal.treeId:surfaceTreeId;
 const actionKey=`${s.strategyId}:${actionTreeId??''}`;
 const adopted=useRead<{items:{kind:string;treeId?:string;siteId?:string;strategyId:string;start?:string;disposition?:'allow'|'skip'}[]}>(actionKind?`/api/simulation/actions?siteId=${s.siteId??'demo-hainan'}${actionTreeId?`&treeId=${encodeURIComponent(actionTreeId)}`:''}`:null);
 const actionsLoading=Boolean(actionKind&&!adopted.data&&!adopted.error);
 const recorded=adopted.data?.items.find(item=>item.kind===actionKind&&item.strategyId===s.strategyId&&(actionKind!=='surface_review'||item.treeId===actionTreeId&&(item.siteId??'demo-hainan')===(s.siteId??'demo-hainan')));
 const recordedValue=recorded?(actionKind==='adopt_angle'?'adopt':actionKind==='surface_review'?recorded.disposition:recorded.start):'';
 const actionValue=savedAction?.strategyId===actionKey?savedAction.value:recordedValue;
 async function saveAction(value:string,save:()=>Promise<unknown>,success:string){
  if(!allowActions||actionsLoading||!valid(s)||submission.current.pending||actionValue===value||(submission.current.strategyId===actionKey&&submission.current.value===value))return;
  submission.current.pending=true;setBusy(true);setMessage(null);
  try{await save();submission.current.strategyId=actionKey;submission.current.value=value;setSavedAction({strategyId:actionKey,value});setMessage({strategyId:actionKey,text:success});}
  catch(e){setMessage({strategyId:actionKey,text:(e as Error).message});}
  finally{submission.current.pending=false;setBusy(false);}
 }
 if(!valid(s))return <p role="status">{s.qualityReview?.status==='withdrawn'?'建议已撤回':'建议已过期，等待下一次分析'}</p>;
 const preferredWindow=s.kind==='weather_window'?s.proposal.windows.find(w=>w.suitability==='suitable'):undefined;
 const useWindow=(strategy:Extract<Strategy,{kind:'weather_window'}>,start:string)=>saveAction(start,()=>adoptWeather(strategy,start),'已保存时段，用于后续新安排的模拟任务。');
 return <div className="hb-strategy">
 {s.kind!=='industry_brief'&&<StrategyRecommendation strategy={displayStrategy}/>}
 {s.kind==='tapping_angle'&&<>
   {allowActions&&<div className="hb-result-actions"><button disabled={busy||actionsLoading||actionValue==='adopt'} onClick={()=>saveAction('adopt',()=>adopt(s),'已采用，用于该树后续模拟作业。')}>{busy?'正在保存…':actionsLoading?'正在读取…':actionValue==='adopt'?'已采用此角度':'采用此角度'}</button></div>}
   <details><summary>采用前需确认的条件</summary>{s.proposal.conditions.map(t=><p key={t}>{t}</p>)}</details>
   {s.proposal.angleModel&&<AngleModelDetails model={s.proposal.angleModel}/>}
 </>}
 {s.kind==='surface_action'&&<>
   {allowActions&&!treeId&&surfaceTargets.length>1&&<label>树表复核对象<select aria-label="树表复核对象" value={surfaceTreeId??''} disabled={busy} onChange={event=>setSelectedSurfaceTree(event.target.value)}><option value="">选择需要复核的树</option>{surfaceTargets.map(target=><option value={target} key={target}>{alias(target,s.siteId)}</option>)}</select></label>}
   {allowActions&&surfaceTreeId&&surfaceFindings.length>0&&<div className="hb-result-actions"><button disabled={busy||actionsLoading||actionValue==='allow'} onClick={()=>saveAction('allow',()=>reviewSurface(s,'allow',surfaceTreeId),'已保存模拟复核结果：放行。')}>{busy?'正在保存…':actionsLoading?'正在读取…':actionValue==='allow'?'已保存放行结果':'保存放行结果'}</button><button disabled={busy||actionsLoading||actionValue==='skip'} onClick={()=>saveAction('skip',()=>reviewSurface(s,'skip',surfaceTreeId),'已保存模拟复核结果：跳过本次割胶。')}>{busy?'正在保存…':actionsLoading?'正在读取…':actionValue==='skip'?'已保存跳过结果':'保存跳过结果'}</button></div>}
   <details><summary>树表处理明细 · {surfaceFindings.length} 项</summary>{surfaceFindings.map(f=><div className={'hb-row hb-surface-row hb-surface-'+f.action} key={f.detectionId}><strong>{alias(f.treeId,s.siteId)}<small>{surfaceActionLabels[f.action]||f.action}</small></strong><span>{f.reason}</span></div>)}<p>与割线相交的结节、伤痕或疑似病斑需避让复核；临时附着物先清理并确认位置。</p></details>
 </>}
 {s.kind==='growth_plan'&&<><details onToggle={event=>setGrowthOpen(event.currentTarget.open)}><summary>查看当前与预测割面对照</summary>{growthOpen&&<Suspense fallback={<p>正在载入割面对照…</p>}><GrowthComparison strategy={s} treeId={treeId}/></Suspense>}</details><details><summary>树围预测与割面计划</summary><div className="hb-result-table"><table><thead><tr><th>树木</th><th>预测日期</th><th>树围 cm</th></tr></thead><tbody>{s.proposal.predictions.filter(p=>!treeId||p.treeId===treeId).map(p=><tr key={p.treeId+':'+p.at}><td>{alias(p.treeId,s.siteId)}</td><td>{p.at.slice(0,10)}</td><td>{p.value}</td></tr>)}</tbody></table></div>{s.proposal.futurePanelPlan.filter(p=>!treeId||p.treeId===treeId).map(p=><p key={p.treeId}>{p.reason}</p>)}</details></>}
 {s.kind==='weather_window'&&<>
   {allowActions&&preferredWindow&&<div className="hb-result-actions"><button disabled={busy||actionsLoading||actionValue===preferredWindow.start} onClick={()=>useWindow(s,preferredWindow.start)}>{busy?'正在保存…':actionsLoading?'正在读取…':actionValue===preferredWindow.start?'已用于后续作业':'用于后续作业'}</button></div>}
   <details><summary>全部作业时段 · {s.proposal.windows.length} 段</summary>{s.proposal.windows.map(w=><div key={w.start} className={'hb-window '+w.suitability}><strong>{when(w.start)} — {new Date(w.end).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</strong><b>{({suitable:'候选作业窗口',defer:'建议暂缓',review:'需现场复核'})[w.suitability]}</b><span>{w.reason}</span>{allowActions&&w.suitability==='suitable'&&<button disabled={busy||actionsLoading||actionValue===w.start} onClick={()=>useWindow(s,w.start)}>{busy?'正在保存…':actionsLoading?'正在读取…':actionValue===w.start?'已用于后续作业':'采用此时段'}</button>}</div>)}</details>
   {s.proposal.timingAssessment&&<details><summary>天气与干胶联动依据</summary><p>近 7 日降雨 {s.proposal.timingAssessment.recentRainfallTotalMm??'缺失'} mm · 峰值 {s.proposal.timingAssessment.recentRainfallPeakMm??'缺失'} mm。</p><p>当前降雨 {s.proposal.timingAssessment.currentRainfallMm??'缺失'} mm · 土壤水分 {s.proposal.timingAssessment.soilMoisturePct??'缺失'}% · 干胶含量 {s.proposal.timingAssessment.dryRubberContentPct??'缺失'}%。</p><p>{s.proposal.timingAssessment.soilWet?'土壤水分达到偏湿阈值，需现场复核。':s.proposal.timingAssessment.wetSpell&&s.proposal.timingAssessment.dryRubberStatus==='available_low'?'雨史偏湿且干胶含量偏低，暂缓并复核现场条件。':s.proposal.timingAssessment.wetSpell?'累计雨量仅作现场巡查提示，不单独限制晴天或小雨时段。':'雨史与土壤水分未触发偏湿阈值。'} 小雨边界 {s.proposal.timingAssessment.thresholds.lightRainMaxMmPerPeriod} mm/时段，降雨概率 {s.proposal.timingAssessment.thresholds.rainProbabilityDeferPct}% 起暂缓。</p><p>策略版本 {s.proposal.timingAssessment.policyVersion} · 演示阈值。</p></details>}
 </>}
 {s.kind==='market_scenario'&&<>
   <details><summary>比较全部生产方案</summary><p>可作业树 {s.proposal.eligibleTreeCount} 棵，排除 {s.proposal.excludedTreeCount} 棵 · 目标频次 {s.proposal.targetFrequencyPerWeek} 次/周</p><div className="hb-result-table"><table><thead><tr><th>每周割次</th><th>纳入树数</th><th>预计干胶 kg</th><th>经营贡献 元</th><th>建议</th></tr></thead><tbody>{s.proposal.scenarios.map(q=><tr key={q.scenarioId}><td>{q.tappingsPerWeek}</td><td>{q.eligibleTreeCount}</td><td>{q.expectedDryRubberKg??'—'}</td><td>{q.estimatedContributionCny??'—'}</td><td>{s.proposal.recommendedScenarioId===q.scenarioId?'推荐':q.tappingsPerWeek===0?'暂不新增':'备选'}</td></tr>)}</tbody></table></div></details>
   <details><summary>测算假设与未纳入原因</summary><p>需求信号：{s.proposal.demandSignal?.band??'unknown'}（{s.proposal.demandSignal?.value??'缺失'} / 基准 {s.proposal.demandSignal?.baselineValue??'缺失'}）</p>{s.proposal.assumptions.map(a=><p key={a}>{a}</p>)}{(s.proposal.exclusions??[]).map(e=><p key={e.reason}>{e.reason}：{e.count} 棵</p>)}</details>
 </>}
 {s.kind==='pest_risk'&&<>
   <details><summary>逐树巡查与养护建议</summary><p>风险指数用于巡查排序。</p><div className="hb-result-table"><table><thead><tr><th>树木</th><th>关注程度</th><th>趋势</th><th>养护建议</th></tr></thead><tbody>{(s.proposal.riskAssessments??[]).map(a=><tr key={a.treeId}><td>{alias(a.treeId,s.siteId)}</td><td>{a.riskIndex}（{a.riskLevel==='review'?'需复核':a.riskLevel==='watch'?'关注':'低'}）</td><td>{a.trend==='increasing'?'上升':a.trend==='insufficient_history'?'历史不足':'稳定'}</td><td>{a.preventiveActions.join('；')}<br/><small>{a.limitation}</small></td></tr>)}</tbody></table></div></details>
   <details><summary>近期触发记录 · {s.proposal.findings.length} 项</summary>{s.proposal.findings.map(f=><p key={f.treeId}>{alias(f.treeId,s.siteId)}：{f.reason}</p>)}{!s.proposal.findings.length&&<p>本次未触发近七日症状规则。</p>}</details>
 </>}
 {s.kind==='industry_brief'&&<IndustryProposal s={s}/>}
 {message?.strategyId===actionKey&&<p className="hb-result-status" role="status">{message.text}</p>}
 <details onToggle={event=>setEvidenceOpen(event.currentTarget.open)}><summary>为什么这样建议 · 依据与记录</summary><p>{s.summary}</p><p className="hb-time">生成于 {when(s.generatedAt)} · 有效至 {when(s.expiresAt)}</p><p className="hb-time">生成来源：{s.fallback?'保守规则保底 · 大脑候选未采用':s.generationMetadata?`${s.generationMetadata.provider==='candidate_service'?'外部模型服务':'大模型'} · ${s.generationMetadata.provider} / ${s.generationMetadata.model}`:s.modelVersion?`外部模型 / ${s.modelVersion}`:'演示规则（未调用大模型）'}</p>
 {s.fallback&&<div className="hb-analysis-warning"><strong>规则建议需人工复核</strong><p>{s.fallback.reasonCode}：{s.fallback.message}</p>{s.fallback.details.map((detail,index)=><p key={index}>{detail}</p>)}</div>}
 {evidenceOpen?<StrategyEvidence s={s}/>:s.reasons.map((r,i)=><p key={i}>{r.text}</p>)}<p>策略版本 {s.revision} · {s.strategyId}</p>{s.inputSnapshot&&<p style={{overflowWrap:'anywhere'}}>输入记录版本 v{s.inputSnapshot.version} · {s.inputSnapshot.snapshotId}</p>}</details>
 </div>;
}
export function Result({data}:{data:RunResponse}){return data.status==='succeeded'?<StrategyBody s={data.strategy}/>:<div><p>{data.status==='needs_data'?'策略包待补充数据':statuses[data.status]}</p>{data.status==='needs_data'&&data.missingData.map((m,i)=><p key={i}>{m.reason}</p>)}{data.status==='failed'&&<p>{data.error.message}</p>}</div>;}
export function TreeProfile({index,site='hainan'}:{index:number;site?:EnvironmentSite}){
 const siteId=site==='hainan'?undefined:`demo-${site}`,park=useRead<Park>(siteId?`/api/demo/park?siteId=${siteId}`:'/api/demo/park'),id=binding(index)?.treeId,r=park;
 useEffect(()=>{const refresh=()=>r.reload();window.addEventListener('harness-reviews-changed',refresh);return()=>window.removeEventListener('harness-reviews-changed',refresh);},[id]);
 if(!r.data)return <State error={r.error} reload={r.reload}/>;
 const t=r.data.trees.find(tree=>tree.treeId===id);
 if(!t)return <p role="status">当前资料中没有这棵树的档案。</p>;
 const measurement=frozenMeasurements({modules:r.data.modules},t.treeId).filter(row=>row.observedAt===t.measuredAt).at(-1);
 const measurementHeight=t.fieldRecord?t.fieldRecord.measurementHeightM:measurement?.measurementHeightM;
 return <div><p className="hb-time">当前档案 · 资料截至 {recordTime(r.data.asOf)}（北京时间）</p>
 <dl className="hb-profile"><dt>品种</dt><dd>{t.variety??'待补充'}</dd><dt>树高</dt><dd>{t.heightM??'—'} m</dd><dt>树围</dt><dd>{t.circumferenceCm??'—'} cm</dd><dt>测量时间</dt><dd>{recordTime(t.measuredAt)}（北京时间）</dd>{(t.fieldRecord||measurement)&&<><dt>测量高度</dt><dd>{measurementHeight==null?'未提供':`离地 ${measurementHeight} m`}</dd></>}<dt>品种与尺寸来源</dt><dd>{recordSource(t.fieldRecord?.provenance??t.provenance)}{t.fieldRecord&&<> · {t.fieldRecord.sourceName}</>}</dd>
 {t.fieldRecord&&<><dt>现场树号</dt><dd>{t.fieldRecord.sourceTreeId||t.treeId}</dd><dt>经纬度</dt><dd>{t.fieldRecord.longitude!=null&&t.fieldRecord.latitude!=null?`${t.fieldRecord.longitude}, ${t.fieldRecord.latitude}（WGS84）`:'未提供'}</dd><dt>地面高程</dt><dd>{t.fieldRecord.elevationM==null?'未提供':`${t.fieldRecord.elevationM} m · ${t.fieldRecord.elevationDatum||'基准未提供'}`}</dd></>}
 <dt>种植日期</dt><dd>{t.plantedAt||'待补充'}</dd><dt>作业状态</dt><dd>{tappingState(t.tappingStatus)}</dd>{t.fieldRecord&&<><dt>种植与状态来源</dt><dd>{recordSource(t.provenance)} · 本次导入未改动</dd></>}</dl>
 <details><summary>档案来源记录</summary><p className="hb-time" style={{overflowWrap:'anywhere'}}>来源记录：{t.fieldRecord?.recordId??t.provenance.sourceId}</p>{t.fieldRecord&&<p>导入于 {recordTime(t.fieldRecord.importedAt)}；品种、尺寸与坐标来自这份资料。新分析使用当前资料，已有策略保留生成时的输入。</p>}<p className="hb-time">资料截至时间表示这次档案汇总的时间；测量时间表示记录中的观测时间。模拟记录不代表现场实测。</p></details></div>;
}
export function TreeInputEvidence({treeId,view,context,currentTree,error,reload}:{treeId:string;view:View;context?:ContextSnapshot;currentTree?:Park['trees'][number];error?:string;reload:()=>void}){
 const matched=matchesStrategyInput(context,view.strategy?.inputSnapshot),tree=matched?context?.modules.trees?.find(t=>t.treeId===treeId):undefined;
 return <section aria-label="本轮策略输入资料"><p className="hb-time">本轮分析输入 · 资料截至 {recordTime(matched?context?.asOf:view.asOf)}（北京时间）</p>{!matched?<State error={error||(context?'本轮输入记录与策略不一致，请重新读取。':undefined)} reload={reload}/>:<><dl className="hb-profile"><dt>输入版本</dt><dd>v{context!.version}</dd><dt>输入测量时间</dt><dd>{recordTime(tree?.measuredAt)}（北京时间）</dd><dt>输入来源</dt><dd>{recordSource(tree?.fieldRecord?.provenance??tree?.provenance)}</dd>{currentTree&&<><dt>当前测量时间</dt><dd>{recordTime(currentTree.measuredAt)}（北京时间）</dd></>}</dl><p className="hb-time">{profileDifference(currentTree,tree)}</p><details><summary>本轮输入记录</summary><p className="hb-time" style={{overflowWrap:'anywhere'}}>输入记录：{context!.snapshotId} · v{context!.version}</p>{tree&&<p className="hb-time" style={{overflowWrap:'anywhere'}}>树档案来源记录：{tree.fieldRecord?.recordId??tree.provenance.sourceId}{tree.fieldRecord&&` · ${tree.fieldRecord.sourceName}`} </p>}{context!.dataPolicy?.notices.map((notice,i)=><p key={i}>{notice}</p>)}</details></>}</section>;
}
export function TreeDecision({index,site='hainan',initial='tapping_angle',readOnly=false}:{index:number;site?:EnvironmentSite;initial?:TreeKind;readOnly?:boolean}){
 const [growthReviewOpen,setGrowthReviewOpen]=useState(false);
 const [kind,setKind]=useState<TreeKind>(initial),siteId=site==='hainan'?undefined:`demo-${site}`,park=useRead<Park>(siteId?`/api/demo/park?siteId=${siteId}`:'/api/demo/park'),id=binding(index)?.treeId;
 const r=useRead<View>(id?`/api/demo/trees/${id}/view?kind=${kind}&dataMode=${DATA_MODE}${siteId?`&siteId=${siteId}`:''}`:null,{pollMs:30000});
 const runId=r.data?.run?.runId||r.data?.strategy?.runId,context=useRead<ContextSnapshot>(runId?'/internal/harness/runs/'+runId+'/context':null);
 const matched=matchesStrategyInput(context.data,r.data?.strategy?.inputSnapshot),measurements=matched&&id?frozenMeasurements(context.data,id):[];
 const treePackageDimensions:{kind:TreeKind;title:string}[]=[{kind:'tapping_angle',title:'割胶角度'},{kind:'surface_action',title:'树表处理'},{kind:'growth_plan',title:'生长与割面'},{kind:'pest_risk',title:'健康巡查'}];
 useEffect(()=>{const refresh=()=>{r.reload();park.reload();context.reload();};window.addEventListener('harness-reviews-changed',refresh);return()=>window.removeEventListener('harness-reviews-changed',refresh);},[id,kind]);
 return <div className="hb-tree"><section className="hb-package-overview hb-package-compact" aria-label="单树策略包四个树级维度"><div className="hb-package-dimensions">{treePackageDimensions.map(d=><button aria-pressed={d.kind===kind} className={d.kind===kind?'active':''} key={d.kind} onClick={()=>setKind(d.kind)}>{d.title}</button>)}</div></section> {!r.data?<State error={r.error} reload={r.reload}/>:r.data.strategyStatus==='available'&&r.data.strategy?<StrategyBody key={r.data.strategy.strategyId} s={r.data.strategy} treeId={id} allowActions={!readOnly}/>:<><p>{r.data.strategyStatus==='needs_data'?'策略包待补充数据':statuses[r.data.strategyStatus]||r.data.strategyStatus}</p>{r.data.error&&<div className="hb-analysis-error" role="alert"><strong>{r.data.error.message}</strong>{r.data.error.details?.length?<ul>{r.data.error.details.map((detail,i)=><li key={i}>{detail}</li>)}</ul>:null}</div>}{r.data.missingData?.map((m,i)=><p key={i}>{m.reason}</p>)}</>}
 {id&&<StrategyRefreshStatus site={site} kind={kind} view={r.data}/>}
 {id&&!readOnly&&<details open={Boolean(r.data&&r.data.strategyStatus!=='available')}><summary>手动生成或更新建议</summary><TreeModelGeneration key={`${site}-${id}-${kind}`} treeId={id} site={site} kind={kind} view={r.data} onResult={r.reload}/></details>}
 {id&&r.data&&runId&&<details><summary>查看本轮输入资料</summary><TreeInputEvidence treeId={id} view={r.data} context={context.data} currentTree={park.data?.trees.find(t=>t.treeId===id)} error={context.error} reload={context.reload}/></details>}
 {kind==='growth_plan'&&id&&!readOnly&&<details onToggle={event=>setGrowthReviewOpen(event.currentTarget.open)}><summary>安排本树生长复测</summary><p>复测结果保存到现有树档案，更新建议后再对照；本轮输入保持原样。</p>{growthReviewOpen&&<Suspense fallback={<p>正在读取复测记录…</p>}><GrowthReviewDesk key={`${site}:${id}`} site={site} treeIds={[id]} initialKind="measure" openRequest={1}/></Suspense>}</details>}
 {kind==='growth_plan'&&<details><summary>查看本轮历史树围</summary><section aria-label="本轮分析使用的树围历史"><p className="hb-time">以下测量与这次分析使用同一份输入资料，后续补测不会改写此历史图。</p>{!runId?<p>尚无本轮分析输入，请先生成或读取已有结果。</p>:matched?<Chart values={measurements.map(m=>m.circumferenceCm)} labels={measurements.map(m=>m.observedAt.slice(0,10))} unit="本轮输入树围 cm"/>:<p role="status">本轮历史测量尚不可核对，暂不展示其他时间的档案曲线。</p>}</section></details>}
 </div>;
}
export function WeatherChart({context}:{context:ContextSnapshot}){const rows=context.modules.weather?.forecast?.steps||[];return <Chart values={rows.map(r=>r.rainfallMm)} labels={rows.map(r=>new Date(r.validFrom).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}))} unit="预报降雨 mm" bars/>;}
