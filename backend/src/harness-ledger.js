import {normalizeSiteId} from './adapters/park-demo.js';
import {builtInSkill} from './assistant-skills.js';

// Run ledger of the conversation brain for one park: how often it ran, what it
// cost, which skills and tools it used, how many answer figures were traced
// and what people thought of the answers.  Read-only, from stored turns.
export function harnessLedger({store, skills, identity=null, siteId, now, days = 7}) {
  siteId = normalizeSiteId(siteId);
  const since = new Date(+now - days * 86400000).toISOString();
  const turns = store.db.prepare(`SELECT t.body FROM assistant_turns t JOIN assistant_sessions s ON s.id=t.session_id
    WHERE s.site_id=? AND json_extract(t.body,'$.createdAt')>=? ORDER BY t.rowid`).all(siteId, since).map(row => JSON.parse(row.body))
    .filter(turn=>!identity || (()=>{try{return JSON.parse(turn.accessScope).version===2;}catch{return false;}})());
  const done = turns.filter(turn => turn.status === 'completed'), model = done.filter(turn => turn.mode === 'configured' && turn.usage);
  const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) ?? 0), 0);
  const count = (items, keyOf) => Object.entries(items.reduce((acc, item) => { const key = keyOf(item); if (key) acc[key] = (acc[key] ?? 0) + 1; return acc; }, {}))
    .map(([key, n]) => ({key, count:n})).sort((a, b) => b.count - a.count);
  const firstChars = sum(model, turn => turn.usage.promptChars?.[0]), fullChars = sum(model, turn => turn.usage.fullPromptChars);
  const checked = done.filter(turn => turn.verification?.total);
  const library = skills?.list(siteId,identity) ?? [];
  const visibleSkill=skill=>{
    if(!identity)return skill;
    const permitted=builtInSkill(skill.id)??library.find(item=>item.id===skill.id);
    return permitted?{...skill,title:permitted.title}:null;
  };
  return {siteId, days, since, generatedAt:now.toISOString(),
    turns:{total:turns.length, completed:done.length, failed:turns.filter(turn => turn.status === 'failed').length,
      model:done.filter(turn => turn.mode === 'configured').length, rules:done.filter(turn => turn.mode === 'demo').length},
    model:{metered:model.length, calls:sum(model, turn => turn.usage.modelCalls), promptTokens:sum(model, turn => turn.usage.promptTokens), completionTokens:sum(model, turn => turn.usage.completionTokens),
      cacheHitTokens:sum(model, turn => turn.usage.cacheHitTokens), avgSeconds:model.length ? Math.round(sum(model, turn => turn.usage.modelMs) / model.length / 100) / 10 : null,
      promptCharsSaved:fullChars ? Math.round((1 - firstChars / fullChars) * 100) : null},
    tools:count(done.flatMap(turn => turn.tools ?? []), tool => tool.name).slice(0, 8),
    deniedTools:sum(done, turn => (turn.tools ?? []).filter(tool => tool.denied).length),
    skills:count(done.flatMap(turn => turn.skills ?? []).map(visibleSkill).filter(Boolean), skill => `${skill.title}|${skill.how}`).slice(0, 10)
      .map(item => ({title:item.key.split('|')[0], how:item.key.split('|')[1], count:item.count})),
    verification:{answers:checked.length, numbers:sum(checked, turn => turn.verification.total), traced:sum(checked, turn => turn.verification.traced)},
    feedback:{helpful:done.filter(turn => turn.feedback?.helpful === true).length, unhelpful:done.filter(turn => turn.feedback?.helpful === false).length},
    learnedSkills:{active:library.filter(skill => skill.status === 'active').length, pending:library.filter(skill => skill.status === 'pending').length,
      needsReview:library.filter(skill => skill.status === 'needs_review').length}};
}
