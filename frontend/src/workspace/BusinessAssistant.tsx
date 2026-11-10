import '../fusion/floatingWindow.css';
import {AssistantProductionChart} from './AssistantProductionChart';
import {AssistantVoiceInput} from '../fusion/AssistantVoiceInput';
import {AssistantOperation} from './AssistantOperation';
import {useEffect, useRef, useState} from 'react';
import {ArrowRight, MessageSquare, Plus, Send} from 'lucide-react';
import {siteIdOf, useRead} from '../integration/client';
import {
  assistantApi, assistantAnswerParts, assistantIsRunning, assistantScopeQuery, assistantSelectionKey, assistantSessionPath,
  memoryScopeLabels, mergeAssistantTurn, toolRiskLabels, type AssistantAction, type AssistantMemory, type AssistantMode, type AssistantSession,
  type AssistantSessionSummary, type AssistantStatus, type AssistantTurn,
} from '../integration/assistantClient';
import type {TreeKind} from '../integration/modelGenerationFlow';
import {sites, type Page, type Site, type Task} from './model';
import {roleViews, treePosition, type RoleView} from './workbenchModel';
import {TurnHarness} from './TurnHarness';
import {TurnInvestigation} from './investigation/TurnInvestigation';
import {currentAccount} from './identityModel';
import './businessAssistant.css';

type Props = {
  contextLabel?:string;onReturnToTree?:()=>void;onClearTree?:()=>void;site:Site;role:RoleView;zone:string|null;treeId?:string|null;tasks:Task[];
  onTask:(task:Task)=>void;onNavigate:(page:Page,scope?:'all'|Site)=>void;
  onMarket:(site:Site,modelId:string)=>void;
  onStrategy:(site:Site,index:number,kind:TreeKind)=>void;
  prompt?:{message:string;id:number}|null;
  onBrainAction?:(type:'park_plan'|'cerebellum'|'collection',planId?:string)=>void;
};
const roleQuestions:Record<RoleView,{label:string;message:string}[]> = {
  grower:[
    {label:'胶价与收胶点',message:'附近收胶点的胶价是多少？比较报价和距离，并注明报价日期。'},
    {label:'哪些树要照看',message:'我的承包树现在长得怎么样？先列出需要养护或巡查的树和下一步。'},
    {label:'今天割不割',message:'结合天气和树木状态，我的承包地今天能不能割胶？'},
    {label:'产胶与收益',message:'我的地块近期产胶情况怎么样？按现有产胶记录和报价估算收益，说明估算口径，和实际销售收入分开。'},
  ],
  manager:[
    {label:'今日生产安排',message:'查看全园任务、天气和待办，列出今天优先处理的生产事项。'},
    {label:'本周割几次',message:'结合胶价、库存仓容和天气，这周全园割胶要增产、维持还是减产？'},
    {label:'库存怎么卖',message:'结合当前胶价、库存和运力，比较本园的销售安排，说明收益和出货计划。'},
    {label:'收胶储运进度',message:'查看收胶、称重、质检和运输进度，列出需要跟进的批次和下一步。'},
  ],
  operator:[
    {label:'设备异常',message:'查看当前园区的设备和天气异常，说明影响哪些机器人、任务，以及下一步怎么处理。'},
    {label:'执行队列',message:'列出我负责的执行中、待处理和待开始任务，说明当前进度和优先处理顺序。'},
    {label:'天气调整',message:'查看天气和未完成作业，说明哪些任务需要调整、何时可以恢复。'},
    {label:'回执复盘',message:'核对最近的执行回执，列出未完成、跳过和需复核的树木及原因。'},
  ],
  executive:[
    {label:'园区重点问题',message:'汇总当前园区的生产进度和异常，指出需要中心协调的重点问题。'},
    {label:'生产经营分析',message:'结合当前园区的胶价、库存和生产计划，说明本周经营重点和调整建议。'},
    {label:'执行复盘',message:'复盘当前园区最近的任务执行和结果回传，说明影响生产的主要问题。'},
    {label:'小脑参数复盘',message:'根据最近的执行反馈，哪些小脑参数或经验需要审批、调整或推广？'},
  ],
};
const modeLabels = {demo:'规则演示',configured:'已配置模型'};

export function BusinessAssistant({contextLabel,onReturnToTree,onClearTree,site,role,zone,treeId=null,tasks,onTask,onNavigate,onMarket,onStrategy,prompt,onBrainAction}:Props) {
  const siteId = siteIdOf(site), query = assistantScopeQuery(siteId,role),accountId=currentAccount()?.accountId??'anonymous';
  const sessions = useRead<{items:AssistantSessionSummary[]}>(`/api/assistant/sessions?${query}`);
  const memories = useRead<{items:AssistantMemory[]}>(`/api/assistant/memories?${query}`);
  const model = useRead<AssistantStatus>('/api/assistant/status');
  const [sessionId,setSessionId] = useState<string|null>(null);
  const [draft,setDraft] = useState('');
  const [mode,setMode] = useState<AssistantMode>('configured');
  const [sending,setSending] = useState(false);
  const [recording,setRecording] = useState(false);
  const [error,setError] = useState('');
  const [operationId,setOperationId] = useState<string|null>(null);
  useEffect(()=>setOperationId(null),[sessionId]);
  const [submitted,setSubmitted] = useState<{sessionId:string;turn:AssistantTurn}|null>(null);
  const current = useRead<AssistantSession>(sessionId ? assistantSessionPath(sessionId) : null);

  useEffect(() => {
    if (!sessions.data || sessionId !== null) return;
    const remembered = localStorage.getItem(assistantSelectionKey(siteId,role,accountId));
    setSessionId(sessions.data.items.find(item => item.sessionId === remembered)?.sessionId ?? sessions.data.items[0]?.sessionId ?? '');
  }, [sessions.data,sessionId,siteId,role,accountId]);
  useEffect(() => {
    if (sessionId) localStorage.setItem(assistantSelectionKey(siteId,role,accountId),sessionId);
  }, [sessionId,siteId,role,accountId]);

  const localTurn = submitted?.sessionId === sessionId ? submitted.turn : undefined;
  const savedTurns = mergeAssistantTurn(current.data?.turns ?? [],localTurn);
  const pending = [...savedTurns].reverse().find(assistantIsRunning);
  const progress = useRead<AssistantTurn>(
    sessionId && pending ? `${assistantSessionPath(sessionId)}/turns/${encodeURIComponent(pending.turnId)}` : null,
    {pollMs:1000},
  );
  const turns = mergeAssistantTurn(savedTurns,progress.data);
  const latest = turns.at(-1), history = turns.slice(0,-1);
  const questions = roleQuestions[role];
  const running = turns.some(assistantIsRunning);
  const configuredUnavailable = mode === 'configured' && (!model.data?.configured || model.data.paused);
  const loading = sessionId === null || Boolean(sessionId && !current.data && !localTurn);
  const busy = sending || running;

  // A decision card can hand the brain a question; send it once per click.
  const lastPrompt = useRef<number|null>(null);
  useEffect(() => {
    if (!prompt || lastPrompt.current === prompt.id || loading) return;
    lastPrompt.current = prompt.id;
    void send(prompt.message);
  }, [prompt,loading]);
  useEffect(() => {
    if (!progress.data || assistantIsRunning(progress.data)) return;
    setSubmitted({sessionId:sessionId!,turn:progress.data});
    current.reload();
    sessions.reload();
    memories.reload();
  }, [progress.data]);

  async function newConversation() {
    setSending(true);
    setError('');
    try {
      const created = await assistantApi.createSession(siteId,role);
      setSessionId(created.sessionId);
      setSubmitted(null);
      setDraft('');
      sessions.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function send(message = draft) {
    const trimmed = message.trim();
    if (!trimmed || busy || loading || configuredUnavailable) return;
    setSending(true);
    setError('');
    try {
      let target = sessionId;
      if (!target) {
        const created = await assistantApi.createSession(siteId,role);
        target = created.sessionId;
        setSessionId(target);
      }
      const turn = await assistantApi.send(target,{message:trimmed,browsing:{treeId,zone},mode});
      setSubmitted({sessionId:target,turn});
      setDraft('');
      sessions.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function openAction(action:AssistantAction) {
    if(action.type==='execute'){setOperationId(action.operationId);return;}
    if (action.type === 'task') {
      const task = tasks.find(item => item.site === site && item.id === action.taskId);
      if (task) onTask(task);
      else onNavigate('operations',site);
    } else if (action.type === 'tree_strategy') {
      const index = treePosition(action.treeId);
      if (index !== null) onStrategy(site,index,action.kind);
    } else if (action.type === 'review') {
      window.dispatchEvent(new CustomEvent('harness-open-review',{detail:{siteId,treeId:action.treeId,kind:action.kind}}));
    } else if (action.type === 'market') {
      onMarket(site,action.modelId);
    } else if (action.type === 'sales_shipments') {
      window.dispatchEvent(new CustomEvent('harness-open-sales-shipments',{detail:{site}}));
    } else if (action.type === 'logistics') {
      window.dispatchEvent(new CustomEvent('harness-open-logistics',{detail:{site,id:action.batchId}}));
    } else if (action.type === 'commodity_market') {
      window.dispatchEvent(new CustomEvent('harness-open-commodity-market',{detail:{site}}));
    } else if (action.type === 'eudr_readiness') {
      window.dispatchEvent(new CustomEvent('harness-open-commodity-market',{detail:{site,focus:'eudr-readiness'}}));
    } else if (action.type === 'park_plan' || action.type === 'cerebellum' || action.type === 'collection') {
      onBrainAction?.(action.type,action.type==='park_plan'?action.planId:undefined);
    } else {
      onNavigate('operations',site);
    }
  }

  function renderTurn(turn:AssistantTurn) {
    const answer = assistantAnswerParts(turn.answer);
    return <article className="ba-turn" key={turn.turnId}>
      <p className="ba-question"><MessageSquare size={15}/><span>{turn.message}</span></p>
      <div className="ba-answer" aria-live="polite">
        {turn.answer && <div className="ba-conclusion"><span className="ba-answer-label">结论</span><p>{answer.conclusion}</p></div>}
        {answer.nextStep && <div className="ba-next-step"><span className="ba-answer-label">下一步</span><p>{answer.nextStep}</p></div>}
        {assistantIsRunning(turn) && <p className="ba-working" role="status">{turn.status === 'queued' ? '已提交，正在准备分析…' : '正在查询园区资料并整理安排…'}</p>}
        {turn.status === 'failed' && <p role="alert">{turn.error || '本轮分析未完成，请重新提问。'}</p>}
      </div>
      {turn.status === 'completed' && turn.actions.length > 0 && <div className="ba-actions" aria-label="下一步操作">{turn.actions.map((action,index) => <button type="button" className="rb-button" key={`${action.type}:${index}`} onClick={() => openAction(action)}>{action.label}<ArrowRight size={15}/></button>)}</div>}
      {turn.productionCharts?.map((chart,i)=><AssistantProductionChart key={i} chart={chart}/>)}
      {turn.status === 'completed' && sessionId && <TurnHarness key={turn.turnId} sessionId={sessionId} turn={turn}/>}
      {turn.status === 'completed' && sessionId && <TurnInvestigation key={`graph-${turn.turnId}`} sessionId={sessionId} turn={turn}/>}
      <details className="ba-details">
        <summary>分析依据与工具记录</summary>
        {answer.details && <p className="ba-analysis">{answer.details}</p>}
        <div className="ba-answer-meta"><span>分析方式：{modeLabels[turn.mode]}</span>{turn.memoriesUsed.length > 0 && <span>参考经验：{turn.memoriesUsed.map(memory => memory.title).join('；')}</span>}</div>
        {turn.tools.length > 0 && <ol className="ba-tools">{turn.tools.map((tool,index) => <li key={`${tool.name}:${index}`}><strong>{tool.label}{tool.risk && <span className={`ba-risk ba-risk-${tool.denied ? 'denied' : tool.risk}`}>{tool.denied ? '已拒绝' : toolRiskLabels[tool.risk]}</span>}</strong><p>{tool.summary}</p>{tool.sourceRefs.length > 0 && <small>依据：{tool.sourceRefs.join(' · ')}</small>}</li>)}</ol>}
      </details>
    </article>;
  }

  return <section className="ba-panel" aria-label="园区业务助手">
    <header className="ba-header"><div><h2><MessageSquare size={21}/>问橡胶大脑</h2><p>{sites[site]}{zone ? ` · ${zone}区` : ''} · {roleViews[role].label}</p></div><span className="ba-mode">{modeLabels[mode]}</span></header>
    {contextLabel&&<div className="ba-tree-context" aria-label="助理关联对象"><strong>{contextLabel}</strong><button type="button" className="rb-button" onClick={onReturnToTree}>返回这棵树</button><button type="button" className="rb-button" onClick={onClearTree}>取消关联</button></div>}
    <div className="ba-toolbar">
      <label>对话<select aria-label="业务对话记录" value={sessionId ?? ''} disabled={sending || !sessions.data} onChange={event => {setSessionId(event.target.value);setSubmitted(null);setError('');setDraft('');}}>
        {!sessions.data?.items.length && <option value="">新对话</option>}
        {sessionId && !sessions.data?.items.some(item => item.sessionId === sessionId) && <option value={sessionId}>新对话</option>}
        {sessions.data?.items.map(item => <option value={item.sessionId} key={item.sessionId}>{item.title}</option>)}
      </select></label>
      <button type="button" className="rb-button" onClick={newConversation} disabled={sending || !sessions.data}><Plus size={15}/>新对话</button>
      <details className="ba-settings"><summary>分析设置</summary><label className="ba-model-select">分析方式<select aria-label="业务助手分析方式" value={mode} onChange={event => setMode(event.target.value as AssistantMode)} disabled={busy}>
        <option value="demo">规则演示 · 无需联网</option>
        <option value="configured" disabled={!model.data?.configured || model.data.paused}>{model.data?.paused ? '已配置模型 · 已暂停' : `已配置模型${model.data?.model ? ` · ${model.data.model}` : ''}`}</option>
      </select></label></details>
    </div>
    <div className="ba-quick" aria-label="业务快捷提问">{questions.slice(0,3).map(question => <button type="button" key={question.label} disabled={busy || loading || configuredUnavailable} onClick={() => send(question.message)}>{question.label}<ArrowRight size={14}/></button>)}</div>
    {questions.length > 3 && <details className="ba-more-questions"><summary>更多提问</summary><div className="ba-quick">{questions.slice(3).map(question => <button type="button" key={question.label} disabled={busy || loading || configuredUnavailable} onClick={() => send(question.message)}>{question.label}<ArrowRight size={14}/></button>)}</div></details>}
    {sessions.error && <p className="ba-error" role="alert">对话读取失败：{sessions.error} <button type="button" className="rb-button" onClick={sessions.reload}>重新读取</button></p>}
    {current.error && <p className="ba-error" role="alert">当前对话读取失败：{current.error} <button type="button" className="rb-button" onClick={current.reload}>重新读取</button></p>}
    {history.length > 0 && <details className="ba-history"><summary>前 {history.length} 轮对话</summary>{history.map(renderTurn)}</details>}
    {latest ? renderTurn(latest) : <p className="ba-empty">{loading ? '正在读取对话…' : current.data?.historyNotice ?? '说说你想怎么安排今天的工作。'}</p>}
    {progress.error && <p className="ba-error" role="alert">进度暂未更新：{progress.error} <button type="button" className="rb-button" onClick={progress.reload}>重新读取</button></p>}
    <form className="ba-compose" onSubmit={event => {event.preventDefault();send();}}>
      <label htmlFor={`assistant-message-${site}-${role}`} className="ba-input-label">继续提问或调整安排</label>
      <textarea id={`assistant-message-${site}-${role}`} aria-label="业务问题" rows={2} placeholder="输入消息" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy}/>
      <div><AssistantVoiceInput disabled={busy} onText={text=>setDraft(d=>d+(d?' ':'')+text)} onActive={setRecording}/><button aria-label="发送" title="发送" className="rb-button rb-primary" type="submit" disabled={busy || recording || loading || !draft.trim() || configuredUnavailable}><Send size={20}/></button></div>
    </form>
    {operationId&&sessionId&&<AssistantOperation key={`${sessionId}:${operationId}`} sessionId={sessionId} operationId={operationId} onClose={()=>setOperationId(null)}/>}
    {error && <p className="ba-error" role="alert">{error}</p>}
    {configuredUnavailable && model.data && <p className="ba-error" role="status">模型当前不可用，可切换到规则演示继续。</p>}
    {(memories.data?.items.length ?? 0) > 0 && <details className="ba-memories"><summary>大脑记得的事 · {memories.data!.items.length} 条</summary><ul>{memories.data!.items.map(memory => <li key={memory.id}><span className="ba-memory-scope">{memoryScopeLabels[memory.scope] ?? memory.scope}</span>{memory.title}{memory.content && <small>{memory.content}</small>}</li>)}</ul></details>}
  </section>;
}


