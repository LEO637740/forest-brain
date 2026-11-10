import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';
import {invariant} from './errors.js';

// Browsing context is a reference aid, not an access boundary. Actual access is
// enforced by the identity service after resolution and on every tool call.
export function resolveAssistantScope({message,siteId,input,session,preferredZone=null,plot=null}) {
  const explicit = [...message.matchAll(/\b(?:T-\d{4}|[A-Z]{2}(?:-[A-Z]{2})?-[A-D]-\d{4})\b/gi)].map(m=>m[0]);
  const named = explicit.map(value=>{
    const tree=resolveTreeIdentity(siteId,value);
    invariant(tree,'INVALID_TREE_REFERENCE',`树号 ${value} 不属于当前园区，请切换园区或核对编号。`,400);
    return tree;
  });
  const ids=[...new Set(named.map(tree=>tree.treeId))];
  const whole=/全园|整个园区|园区.*(?:产量|库存|趋势|情况|收益)|(?:产量|库存|趋势|收益).*园区|宏观|全局/.test(message);
  const namedZone=message.match(/([A-D])\s*区/i)?.[1].toUpperCase();
  const treeReference=/这棵|那棵|该树|本树|选中的树|当前树/.test(message);
  const followup=/^(那|它|继续|刚才|上面|这些|其)/.test(message);
  let treeId=null,zone=null;
  if(ids.length===1) { treeId=ids[0]; zone=named[0].zone; }
  else if(ids.length>1) { /* Explicit comparisons stay broad; the model sees all named objects. */ }
  else if(whole) { /* Never inherit the previously selected tree for a park question. */ }
  else if(namedZone) zone=namedZone;
  else if(treeReference) {
    const candidate=input.browsing?.treeId??input.treeId??session.treeId;
    const tree=candidate?resolveTreeIdentity(siteId,candidate):null;
    if(tree){treeId=tree.treeId;zone=tree.zone;}
  } else if(/这个分区|该分区|当前分区/.test(message))zone=input.browsing?.zone??session.zone??null;
  else if(followup) {treeId=session.treeId??null;zone=session.zone??null;}
  // Legacy callers may explicitly request a query scope. New UI uses `browsing`.
  else if(!input.browsing && input.treeId) {
    const tree=resolveTreeIdentity(siteId,input.treeId);
    invariant(tree,'INVALID_TREE','请选择园区中的单树。');
    treeId=tree.treeId;zone=tree.zone;
  } else if(!input.browsing && input.zone!==undefined) zone=input.zone;
  if(!whole&&!namedZone&&!treeId&&!ids.length&&!treeReference&&zone===null)zone=preferredZone;
  invariant(zone===null||/^[A-D]$/.test(zone),'INVALID_ZONE','请选择 A–D 分区。');
  if(plot){
    invariant(!treeId||plot.treeIds.includes(treeId),'FORBIDDEN_TREE','这棵树不在你的承包范围内。',403);
    invariant(named.every(tree=>plot.treeIds.includes(tree.treeId)),'FORBIDDEN_TREE','部分树不在你的承包范围内。',403);
    zone=plot.zone;
  }
  return {treeId,zone,queryTrees:ids,needsTreeClarification:treeReference&&!treeId};
}
