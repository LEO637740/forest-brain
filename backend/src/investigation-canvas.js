import {invariant} from './errors.js';

const text = {type:'string'};
export const investigationTool = {type:'function',function:{name:'investigation_graph',
  description:'把本轮工具依据整理成可编辑调查图。节点引用工具返回的 evidenceId；区分事实、待验证解释、缺项和下一步。连线只表示调查关联，不证明因果。先查业务资料，再出图。',
  parameters:{type:'object',additionalProperties:false,required:['title','nodes','edges'],properties:{
    title:text,layout:{type:'string',enum:['flow','radial','comparison']},organizationNote:text,
    nodes:{type:'array',minItems:2,maxItems:20,items:{type:'object',additionalProperties:false,required:['id','kind','text','evidenceIds'],properties:{
      id:text,group:text,kind:{type:'string',enum:['fact','hypothesis','gap','next']},text,evidenceIds:{type:'array',minItems:1,items:text}}}},
    edges:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['from','to'],properties:{from:text,to:text}}},
  }}}};

export function turnEvidence(turn) {
  if (turn.evidence?.length) return turn.evidence;
  // Historical conversations already contain immutable tool summaries and source IDs.
  return turn.tools.filter(item=>!item.denied && item.sourceRefs?.length && item.name!=='investigation_graph')
    .map((item,index)=>({id:`E${index+1}`,tool:item.name,label:item.label,summary:item.summary,
      sourceRefs:item.sourceRefs,at:turn.createdAt}));
}

export function modelInvestigation(input,evidence,now) {
  invariant(typeof input.title==='string'&&input.title.trim()&&input.title.length<=120&&
    Array.isArray(input.nodes)&&input.nodes.length>=2&&input.nodes.length<=20&&
    Array.isArray(input.edges)&&input.edges.length<=40,'INVALID_GRAPH','调查图需要标题、2至20个节点和有效连线。');
  const ids=new Set(input.nodes.map(node=>node.id));
  invariant(ids.size===input.nodes.length,'INVALID_GRAPH','调查节点编号不能重复。');
  for(const node of input.nodes) invariant(typeof node.id==='string'&&node.id.length>0&&node.id.length<=40&&
    ['fact','hypothesis','gap','next'].includes(node.kind)&&typeof node.text==='string'&&node.text.trim()&&node.text.length<=1000&&
    (node.group===undefined||typeof node.group==='string'&&node.group.length<=60)&&
    Array.isArray(node.evidenceIds)&&node.evidenceIds.length>0&&node.evidenceIds.every(id=>evidence.some(item=>item.id===id)),
  'INVALID_GRAPH','每个节点必须引用本轮已查询的依据。');
  invariant(input.edges.every(edge=>ids.has(edge.from)&&ids.has(edge.to)&&edge.from!==edge.to)&&
    new Set(input.edges.map(edge=>edge.from+'>'+edge.to)).size===input.edges.length,'INVALID_GRAPH','调查图连线端点无效或重复。');
  invariant(input.layout===undefined||['flow','radial','comparison'].includes(input.layout),'INVALID_GRAPH','未知调查图布局。');
  invariant(input.organizationNote===undefined||typeof input.organizationNote==='string'&&input.organizationNote.length<=1000,'INVALID_GRAPH','调查图说明过长。');
  return {title:input.title.trim(),nodes:input.nodes.map(({id,group,kind,text,evidenceIds})=>({id,...(group?{group}:{}),kind,text,evidenceIds})),
    edges:input.edges.map(({from,to})=>({from,to})),layout:input.layout??'flow',organizationNote:input.organizationNote??'根据本轮业务依据整理。',
    origin:'model',generatedAt:now.toISOString(),boundary:'连线表示调查关联；待验证解释不是已证实的原因。'};
}

export function recordsInvestigation(turn,now) {
  const evidence=turnEvidence(turn).filter(item=>item.tool!=='recall_memory').slice(0,12);
  invariant(evidence.length,'NO_GRAPH_EVIDENCE','本轮暂无可整理的业务依据，请先查询任务、天气或库存。',409);
  const nodes=evidence.map((item,index)=>({id:`N${index+1}`,kind:'fact',text:item.summary,evidenceIds:[item.id]}));
  nodes.push({id:'followup',kind:'next',text:'通过本轮回答的关联入口查看原始任务、方案或资料；需要最新状态时继续提问。',evidenceIds:evidence.map(item=>item.id)});
  return {title:'本轮业务依据',nodes,edges:[],layout:'comparison',origin:'records',generatedAt:now.toISOString(),
    organizationNote:'直接整理本轮已保存的工具摘要，无需联网。各项并列展示，可手动添加调查关系。',
    boundary:'记录整理，不是因果归因；后续新状态请重新查询。'};
}

export function editedCanvas(turn,input,now) {
  const graph=turn.investigation;
  invariant(turn.status==='completed'&&graph,'NO_GRAPH','当前回答没有调查图。',409);
  invariant(input&&Number.isInteger(input.revision)&&input.revision===(turn.canvas?.revision??0),'CANVAS_CONFLICT','画布已在其他页面修改，请先读取已保存版本。',409);
  invariant(Array.isArray(input.nodes)&&input.nodes.length===graph.nodes.length&&new Set(input.nodes.map(node=>node.id)).size===graph.nodes.length,'INVALID_CANVAS','画布节点须与原图一一对应。');
  const bounded=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  for(const node of input.nodes) invariant(graph.nodes.some(item=>item.id===node.id)&&
    Object.keys(node).every(key=>['id','x','y','width','height','text'].includes(key))&&
    bounded(node.x,0,6000)&&bounded(node.y,0,6000)&&bounded(node.width,180,650)&&bounded(node.height,100,450)&&
    typeof node.text==='string'&&node.text.trim()&&node.text.length<=1000,'INVALID_CANVAS','节点位置、尺寸或文字无效；依据和节点类型保留原始记录。');
  const ports=['left','right','top','bottom'],ids=new Set(graph.nodes.map(node=>node.id));
  invariant(Array.isArray(input.edges)&&input.edges.length<=40&&input.edges.every(edge=>ids.has(edge.from)&&ids.has(edge.to)&&edge.from!==edge.to&&ports.includes(edge.fromPort)&&ports.includes(edge.toPort))&&new Set(input.edges.map(edge=>edge.from+'>'+edge.to)).size===input.edges.length,'INVALID_CANVAS','连线须连接两个不同的有效节点。');
  return {revision:input.revision+1,nodes:structuredClone(input.nodes),edges:input.edges.map(({from,to,fromPort,toPort})=>({from,to,fromPort,toPort})),savedAt:now.toISOString(),author:'user'};
}
