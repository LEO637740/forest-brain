import {useEffect,useRef,useState} from 'react';
import {DATA_MODE,post,read,useRead,type View,type EnvironmentSite} from './client';
import {generateTreeModel,modelBlockReason,type ModelMeta,type ModelControl,type TreeKind} from './modelGenerationFlow';
import {ModelControlPanel} from './ModelControlPanel';
import {refreshCovers,strategyRefreshPath,type StrategyRefreshState} from './strategyRefreshState';

export function TreeModelGeneration({treeId,kind,site='hainan',view,onResult}:{treeId:string;kind:TreeKind;site?:EnvironmentSite;view?:View;onResult:()=>void}){
  const siteId=site==='hainan'?undefined:`demo-${site}`;
  const meta=useRead<ModelMeta>('/api/meta'),control=useRead<ModelControl>('/api/model/control'),automatic=useRead<StrategyRefreshState>(strategyRefreshPath(`demo-${site}`),{pollMs:30000});
  const [running,setRunning]=useState(false),[message,setMessage]=useState('');
  const operation=useRef<AbortController|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[]);
  const route=view?.strategyRoute;
  // Until the read-only route arrives, keep the legacy manual action on the
  // model path; the backend still reclassifies the frozen snapshot safely.
  const bigBrain=route ? route.status==='needs_big_brain' : true;
  const generatorMode=route ? (bigBrain?'configured':'demo_rules') : 'configured';
  const routeBlock=route?.status==='blocked'?route.reason:'';
  const modelReason=bigBrain?modelBlockReason(meta.data,control.data,meta.error||control.error):'';
  // A missing provider is a recoverable complex-run condition: the backend
  // records it and emits a labelled rule fallback. Only an explicit model
  // pause remains a UI block.
  const block=(modelReason.includes('模型调用已暂停')?modelReason:'')||routeBlock;
  const pending=running||view?.strategyStatus==='pending';
  const autoCovered=refreshCovers(automatic.data,`demo-${site}`,kind);
  async function generate(){
    if(block||pending||operation.current)return;
    const controller=new AbortController();operation.current=controller;setRunning(true);setMessage(bigBrain?'正在提交大脑分析…':'正在生成小脑规则策略…');
    try{
      let accepted=false;
      const result=await generateTreeModel(treeId,kind,DATA_MODE,controller.signal,{
        prepare:input=>post('/api/demo/trees/prepare',{...input,siteId}),
        siteId,
        readView:()=>read<View>(`/api/demo/trees/${treeId}/view?kind=${kind}&dataMode=${DATA_MODE}${siteId?`&siteId=${siteId}`:''}`),
        onProgress:next=>{
          setMessage(next.run?.status==='queued'
            ? (generatorMode==='demo_rules'?'规则策略正在排队…':'大脑分析正在排队…')
            : (generatorMode==='demo_rules'?'规则策略正在生成，请稍候…':'大模型正在分析，请稍候…'));
          if(!accepted){accepted=true;onResult();}
        },
      },generatorMode);
      setMessage(result.run?.status==='failed'?`本轮技术服务异常：${result.error?.message||'服务未提供错误详情'}`:result.run?.status==='needs_data'?'策略包待补充数据，请查看下方缺失项。':result.strategy?.fallback?'大脑候选未采用，已生成保守规则策略包，待人工复核。':generatorMode==='demo_rules'?'小脑规则策略已生成。':'本轮大脑策略包已生成。');
      onResult();
    }catch(error){
      if(!controller.signal.aborted){setMessage((error as Error).message||(generatorMode==='demo_rules'?'规则策略生成暂不可用':'大模型分析暂不可用'));onResult();}
    }finally{
      if(!controller.signal.aborted){setRunning(false);operation.current=null;}
    }
  }
  const routeText=route?.status==='blocked'?'先补充现场资料':route?.status==='needs_big_brain'?'大脑综合分析':'小脑规则分析';
  const automaticText=automatic.error?'后台更新状态暂不可读，可重新读取或手动生成。':!automatic.data?'正在读取自动任务范围…':!automatic.data.enabled?'后台周期更新未启用，可手动生成。':autoCovered?automatic.data.status==='paused'?'后台周期更新已暂停；已有结果仍按有效期核验。':`本园区本维度已纳入每 ${automatic.data.intervalMinutes} 分钟后台更新；${automatic.data.treeModelsEnabled?'判定需要大脑时自动调用，完成后回填结果。':'自动大脑分析尚未启用，可手动提交。'}`:'本园区本维度尚未纳入当前后台范围，可手动生成。';
  const buttonText=pending?(running||view?.run?.generatorMode==='configured'?(route?'大脑分析中…':'大模型分析中…'):'建议生成中…'):route?.status==='blocked'?'等待补充数据':route?.status==='needs_big_brain'?view?.strategyStatus==='failed'||view?.strategy?.fallback?'手动重试大脑分析':'手动立即分析':route?'小脑直接生成':view?.run?.generatorMode==='configured'?'大模型重新生成':'大模型生成';
  return <div className="hb-model-generation" aria-busy={pending}>
    {route&&<p className="hb-route-note" data-route={route.status}><strong>{routeText}</strong> · {route.reason}</p>}
    <div className="hb-generation-action"><button disabled={Boolean(block)||pending} onClick={generate}>{buttonText}</button><span className="hb-time">模拟现场数据</span></div>
    {(message||block||modelReason)&&<p role="status">{message||block||modelReason}</p>}
    {meta.error||control.error?<button onClick={()=>{meta.reload();control.reload();}}>重新核验模型状态</button>:null}
    <details className="hb-generation-settings" open={modelReason.includes('模型调用已暂停')}>
      <summary>分析设置与自动任务</summary>
      <ModelControlPanel compact/>
      <p className="hb-auto-note"><strong>自动分析：</strong>{automaticText}</p>
      <p className="hb-time">{meta.data&&['llm','candidate_service'].includes(meta.data.generator)&&meta.data.llm?.configured?`${meta.data.generator==='candidate_service'?'可用外部候选服务':'可用大模型'}：${meta.data.llm.provider} / ${meta.data.llm.model||meta.data.modelVersion||'待提供版本'}`:'大模型策略生成'}</p>
    </details>
  </div>;
}
