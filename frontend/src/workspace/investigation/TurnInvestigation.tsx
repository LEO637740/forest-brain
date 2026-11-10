import {useState} from 'react';
import {assistantApi,type AssistantTurn} from '../../integration/assistantClient';
import {AssistantInvestigation} from './AssistantInvestigation';

export function TurnInvestigation({sessionId,turn}:{sessionId:string;turn:AssistantTurn}) {
  const [saved,setSaved]=useState<AssistantTurn|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[evidenceId,setEvidenceId]=useState<string|null>(null);
  const current=saved??turn,graph=current.investigation;
  const evidence=current.evidence??[];
  const selected=evidence.find(item=>item.id===evidenceId);
  async function create() {
    setBusy(true);setError('');
    try {setSaved(await assistantApi.investigation(sessionId,turn.turnId));}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <div className="ba-turn-investigation">
    {!graph&&<button type="button" className="rb-button" onClick={create} disabled={busy}>{busy?'正在整理…':'整理成依据图'}</button>}
    {graph&&<AssistantInvestigation graph={graph} canvas={current.canvas}
      model={graph.origin==='records'?'业务记录整理 · 无需联网':turn.mode==='configured'?'已配置模型':'规则演示'}
      trace={current.tools.map(item=>({at:evidence.find(entry=>entry.id===item.evidenceId)?.at??turn.createdAt,label:item.label,evidenceId:item.evidenceId}))}
      onEvidence={setEvidenceId}
      onSave={canvas=>assistantApi.saveCanvas(sessionId,turn.turnId,canvas)}
      onReload={async()=>(await assistantApi.canvas(sessionId,turn.turnId)).canvas??undefined}
      onHistory={async()=>(await assistantApi.canvasHistory(sessionId,turn.turnId)).items}/>} 
    {selected&&<div className="ba-graph-evidence" role="region" aria-label="调查图依据">
      <strong>{selected.id} · {selected.label}</strong><p>{selected.summary}</p>
      <small>查询时间：{new Date(selected.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）</small>
      <details><summary>来源记录</summary><p>{selected.sourceRefs.join(' · ')}</p></details>
      <button type="button" className="rb-button" onClick={()=>setEvidenceId(null)}>收起依据</button>
    </div>}
    {error&&<p className="ba-error" role="alert">{error}</p>}
  </div>;
}
