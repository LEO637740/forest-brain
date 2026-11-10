import {post,read} from './client';
import type {Investigation,Canvas} from '../workspace/investigation/investigationLayout';
import type {TreeKind} from './modelGenerationFlow';
import type {RoleView} from '../workspace/workbenchModel';

export type AssistantMode = 'demo' | 'configured';
export type ToolRisk = 'read' | 'compute' | 'memory_write' | 'proposal';
export const toolRiskLabels:Record<ToolRisk,string> = {read:'只读',compute:'测算',memory_write:'写记忆',proposal:'待审批提案'};
export type AssistantMemory = {id:string;title:string;scope:string;content?:string;topic?:string;updatedAt?:string;useCount?:number;history?:{content:string;updatedAt:string}[]};
export const memoryScopeLabels:Record<string,string> = {shared:'公共',park:'园区',private:'个人',role:'角色偏好'};
export type AssistantAction =
  | {type:'execute';operationId:string;label:string}
  | {type:'task';taskId:string;label:string}
  | {type:'market';modelId:string;label:string}
  | {type:'operations';label:string}
  | {type:'sales_shipments';label:string}
  | {type:'logistics';batchId?:string;label:string}
  | {type:'commodity_market';label:string}
  | {type:'eudr_readiness';label:string}
  | {type:'park_plan';planId?:string;label:string}
  | {type:'cerebellum';label:string}
  | {type:'collection';label:string}
  | {type:'review';treeId:string;kind:'capture'|'measure'|'inspect';label:string}
  | {type:'tree_strategy';treeId:string;kind:TreeKind;label:string};
export type ProductionChart={title:string;note:string;rows:{date:string;latexKg:number|null;dryKg:number|null;batchIds:string[]}[]};
export type AssistantTurn = {
  productionCharts?:ProductionChart[];
  turnId:string;message:string;status:'queued'|'running'|'completed'|'failed';mode:AssistantMode;
  answer?:string;tools:{name:string;label:string;summary:string;sourceRefs:string[];risk?:ToolRisk;denied?:boolean;evidenceId?:string}[];
  actions:AssistantAction[];memoriesUsed:AssistantMemory[];error?:string;createdAt:string;
  verification?:{total:number;traced:number;untraced:string[];summary:string};
  skills?:{id:string;title:string;version?:number;how:'question'|'tool'|'requested'|'learned'}[];
  usage?:{modelCalls:number;promptTokens:number;completionTokens:number;cacheHitTokens:number;modelMs:number;promptChars:number[];fullPromptChars:number};
  feedback?:{helpful:boolean;note:string;at:string};
  evidence?:{id:string;tool:string;label:string;summary:string;sourceRefs:string[];at:string}[];
  investigation?:Investigation;canvas?:Canvas;
};
export type AssistantSessionSummary = {
  sessionId:string;siteId:string;role:RoleView;title:string;createdAt:string;updatedAt:string;historyNotice?:string;
};
export type AssistantSession = AssistantSessionSummary & {turns:AssistantTurn[]};
export type AssistantStatus = {configured:boolean;model:string|null;paused:boolean};

export const assistantSessionPath = (sessionId:string) => `/api/assistant/sessions/${encodeURIComponent(sessionId)}`;
export const assistantScopeQuery = (siteId:string, role:RoleView) => new URLSearchParams({siteId,role}).toString();
export const assistantSelectionKey = (siteId:string, role:RoleView, accountId:string) => `harness-assistant-session:${accountId}:${siteId}:${role}`;
export const assistantIsRunning = (turn:AssistantTurn) => turn.status === 'queued' || turn.status === 'running';

export function assistantAnswerParts(answer = '') {
  const [firstParagraph,...remaining] = answer.split('\n\n');
  const nextStepParagraph = remaining[0]?.startsWith('下一步：') ? remaining.shift() : '';
  const mainParagraph = nextStepParagraph ? `${firstParagraph}\n${nextStepParagraph}` : firstParagraph;
  const nextStepAt = mainParagraph.indexOf('\n下一步：');
  const legacyLineAt = nextStepAt < 0 ? answer.indexOf('\n') : -1;
  const conclusion = nextStepAt >= 0 ? mainParagraph.slice(0,nextStepAt)
    : legacyLineAt >= 0 ? answer.slice(0,legacyLineAt) : answer;
  return {
    conclusion:conclusion.startsWith('结论：') ? conclusion.slice('结论：'.length) : conclusion,
    nextStep:nextStepAt < 0 ? '' : mainParagraph.slice(nextStepAt + '\n下一步：'.length),
    details:nextStepAt >= 0 ? remaining.join('\n\n')
      : legacyLineAt >= 0 ? answer.slice(legacyLineAt + (answer[legacyLineAt+1]==='\n' ? 2 : 1)) : '',
  };
}

export function mergeAssistantTurn(turns:AssistantTurn[], update?:AssistantTurn):AssistantTurn[] {
  if (!update) return turns;
  return turns.some(turn => turn.turnId === update.turnId)
    ? turns.map(turn => turn.turnId === update.turnId ? update : turn)
    : [...turns, update];
}

export const assistantApi = {
  createSession: (siteId:string, role:RoleView) => post<AssistantSession>('/api/assistant/sessions', {siteId,role}),
  send: (sessionId:string, input:{message:string;zone?:string|null;treeId?:string;browsing?:{treeId:string|null;zone:string|null};mode:AssistantMode}) =>
    post<AssistantTurn>(`${assistantSessionPath(sessionId)}/turns`, input),
  investigation: (sessionId:string,turnId:string) => post<AssistantTurn>(`${assistantSessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/investigation`,{}),
  saveCanvas: (sessionId:string,turnId:string,canvas:Canvas) => post<Canvas>(`${assistantSessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/canvas`,{revision:canvas.revision,nodes:canvas.nodes,edges:canvas.edges}),
  canvas: (sessionId:string,turnId:string) => read<{canvas:Canvas|null}>(`${assistantSessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/canvas`),
  canvasHistory: (sessionId:string,turnId:string) => read<{items:Canvas[]}>(`${assistantSessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/canvas/history`),
};
