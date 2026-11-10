import {useState} from 'react';
import {post, read} from '../integration/client';
import {assistantSessionPath, type AssistantTurn} from '../integration/assistantClient';
import {can, currentAccount} from './identityModel';

const howLabels = {question:'按问题加载', tool:'用到工具时加载', requested:'模型主动读取', learned:'园区经验技能'} as const;

/** Under one answer: figure tracing, the skills it used, feedback, and turning it into a reusable skill. */
export function TurnHarness({sessionId, turn}:{sessionId:string;turn:AssistantTurn}) {
  const account = currentAccount();
  const [feedback, setFeedback] = useState<boolean|null>(turn.feedback?.helpful ?? null);
  const [form, setForm] = useState<{title:string;triggers:string;scope:'park'|'shared'}|null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const base = `${assistantSessionPath(sessionId)}/turns/${encodeURIComponent(turn.turnId)}`;
  const mayDraft = !account || can(account, 'memory.park.write') || can(account, 'memory.public.write');
  const business = turn.tools.some(tool => !tool.denied && !['recall_memory','load_skill'].includes(tool.name));
  async function run(task:() => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const rate = (helpful:boolean) => run(async () => { await post(`${base}/feedback`, {helpful}); setFeedback(helpful); });
  const openForm = () => run(async () => { const hint = await read<{title:string;triggers:string[]}>(`${base}/skill-suggestion`); setForm({title:hint.title, triggers:hint.triggers.join('，'), scope:'park'}); });
  const save = () => run(async () => {
    const triggers = form!.triggers.split(/[，,、\s]+/).filter(Boolean);
    const skill = await post<{title:string}>(`${base}/skill`, {title:form!.title, scope:form!.scope, ...(triggers.length ? {triggers} : {})});
    setForm(null); setMessage(`已沉淀为待审批技能“${skill.title}”，可在“页面右上角 → 大脑管理”审批。`);
  });
  return <div className="ba-harness">
    {!!turn.verification?.untraced.length && <p className="ba-trace ba-trace-check"><span>{turn.verification.untraced.length} 个数字待核对</span></p>}
    <div className="ba-harness-actions">
      {feedback === null ? <><button type="button" className="rb-button" disabled={busy} onClick={() => rate(true)}>有用</button>
        <button type="button" className="rb-button" disabled={busy} onClick={() => rate(false)}>不准确</button></>
        : <span className="ba-rated">已评价：{feedback ? '有用' : '不准确'}</span>}
      {mayDraft && business && !form && <button type="button" className="rb-button" disabled={busy} onClick={openForm}>沉淀为技能</button>}
    </div>
    {form && <form className="ba-skill-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>技能名称<input value={form.title} onChange={event => setForm({...form, title:event.target.value})}/></label>
      <label>触发词（用逗号分隔）<input value={form.triggers} onChange={event => setForm({...form, triggers:event.target.value})}/></label>
      {(!account || can(account, 'memory.public.write')) && <label>范围<select value={form.scope} onChange={event => setForm({...form, scope:event.target.value as 'park'|'shared'})}><option value="park">本园区</option><option value="shared">全部园区</option></select></label>}
      <div><button type="submit" className="rb-button rb-primary" disabled={busy || !form.title.trim()}>生成待审批技能</button><button type="button" className="rb-button" onClick={() => setForm(null)}>取消</button></div>
    </form>}
    {message && <p className="ba-harness-note" role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {(turn.verification?.total || turn.skills?.length || turn.usage) && <details className="ba-harness-more"><summary>数字来源、技能与用量</summary>{!!turn.verification?.total && <p className="ba-harness-note">数字来源对照：{turn.verification.summary}</p>}<p className="ba-harness-note">
      {turn.skills?.length ? `本轮技能：${turn.skills.map(skill => `${skill.title}${skill.version ? ` v${skill.version}` : ''}（${howLabels[skill.how]}）`).join('、')}。` : ''}
      {turn.usage ? `模型调用 ${turn.usage.modelCalls} 次，输入 ${turn.usage.promptTokens} / 输出 ${turn.usage.completionTokens} tokens${turn.usage.cacheHitTokens ? `（缓存命中 ${turn.usage.cacheHitTokens}）` : ''}；首轮提示词 ${turn.usage.promptChars[0]} 字，按需加载前约 ${turn.usage.fullPromptChars} 字。` : ''}</p></details>}
  </div>;
}
