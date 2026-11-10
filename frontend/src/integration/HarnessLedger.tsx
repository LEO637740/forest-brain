import {useState} from 'react';
import {post, useRead} from './client';
import {can, currentAccount} from '../workspace/identityModel';

export type Ledger = {days:number;turns:{total:number;completed:number;failed:number;model:number;rules:number};
  model:{metered:number;calls:number;promptTokens:number;completionTokens:number;cacheHitTokens:number;avgSeconds:number|null;promptCharsSaved:number|null};
  tools:{key:string;count:number}[];deniedTools:number;skills:{title:string;how:string;count:number}[];
  verification:{answers:number;numbers:number;traced:number};feedback:{helpful:number;unhelpful:number};
  learnedSkills:{active:number;pending:number;needsReview:number}};
export type LearnedSkill = {id:string;siteId:string|null;scope:'park'|'shared';title:string;triggers:string[];tools:string[];instruction:string;
  status:'pending'|'active'|'needs_review'|'rejected'|'archived';version:number;uses:number;helpful:number;unhelpful:number;source:{message:string};createdBy:string};
const statusLabels = {pending:'待审批', active:'使用中', needs_review:'反馈不佳，已暂停待修订', rejected:'已驳回', archived:'已停用'} as const;
const howLabels:Record<string,string> = {question:'按问题', tool:'用到工具', requested:'模型读取', learned:'经验技能'};

/** The conversation brain's run ledger and its learned-skill library for one park. */
export function HarnessLedger({siteId}:{siteId:string}) {
  const account = currentAccount();
  const ledger = useRead<Ledger>(`/api/brain/harness?siteId=${siteId}`);
  const library = useRead<{items:LearnedSkill[]}>(`/api/assistant/skills?siteId=${siteId}`);
  const [editing, setEditing] = useState<{id:string;instruction:string;triggers:string}|null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mayApprove = (skill:LearnedSkill) => !account || (skill.siteId ? can(account, 'memory.park.write') : can(account, 'memory.public.write'));
  async function run(task:() => Promise<unknown>) {
    setBusy(true); setError('');
    try { await task(); library.reload(); ledger.reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const data = ledger.data, skills = library.data?.items.filter(skill => skill.status !== 'rejected') ?? [];
  const traced = data && data.verification.numbers ? Math.round(data.verification.traced / data.verification.numbers * 100) : null;
  return <section className="pp-card hl-panel" aria-label="Harness 运行台账">
    <h3>园区经验技能</h3>
    {ledger.error && <p role="alert">{ledger.error}</p>}
    {data && <details className="be-more"><summary>对话运行记录 · 近 {data.days} 天</summary>
      <dl className="hl-stats">
        <div><dt>对话轮次</dt><dd>{data.turns.completed}<small>模型 {data.turns.model} · 规则 {data.turns.rules}{data.turns.failed ? ` · 失败 ${data.turns.failed}` : ''}</small></dd></div>
        <div><dt>模型调用</dt><dd>{data.model.calls}<small>{data.model.metered ? `${data.model.metered} 轮有用量记录，平均每轮 ${data.model.avgSeconds} 秒` : '尚无用量记录'}</small></dd></div>
        <div><dt>tokens</dt><dd>{(data.model.promptTokens + data.model.completionTokens).toLocaleString('zh-CN')}<small>{data.model.cacheHitTokens ? `缓存命中 ${data.model.cacheHitTokens.toLocaleString('zh-CN')}` : '输入 + 输出'}</small></dd></div>
        <div><dt>按需加载</dt><dd>{data.model.promptCharsSaved !== null ? `省 ${data.model.promptCharsSaved}%` : '—'}<small>首轮提示词比全量规则</small></dd></div>
        <div><dt>数字来源匹配</dt><dd>{traced !== null ? `${traced}%` : '—'}<small>{data.verification.numbers} 个数字 / {data.verification.answers} 个回答</small></dd></div>
        <div><dt>用户反馈</dt><dd>{data.feedback.helpful} / {data.feedback.unhelpful}<small>有用 / 不准确</small></dd></div>
      </dl>
      {data.skills.length > 0 && <p className="pp-note">常用技能：{data.skills.slice(0, 6).map(item => `${item.title}（${howLabels[item.how] ?? item.how} ${item.count}）`).join('、')}</p>}
      {data.tools.length > 0 && <p className="pp-note">常用工具：{data.tools.slice(0, 6).map(item => `${item.key} ${item.count}`).join('、')}{data.deniedTools ? `；越权调用被拒 ${data.deniedTools} 次` : ''}</p>}
    </details>}
    <p className="pp-note">{skills.filter(skill => skill.status === 'active').length} 项使用中 · {skills.filter(skill => ['pending','needs_review'].includes(skill.status)).length} 项待处理</p>
    <p className="pp-note">对话中的经验可“沉淀为技能”，批准后用于后续回答。</p>
    {library.error && <p role="alert">{library.error}</p>}
    {skills.length ? <ul className="hl-skills">{skills.map(skill => <li key={skill.id} className={`hl-skill-${skill.status}`}>
      <div className="hl-skill-head"><strong>{skill.title}</strong><span>v{skill.version} · {statusLabels[skill.status]} · {skill.scope === 'shared' ? '全部园区' : '本园区'}</span></div>
      <small>触发词：{skill.triggers.join('、')} · 使用 {skill.uses} 次 · 有用 {skill.helpful} / 不准确 {skill.unhelpful}</small>
      {editing?.id === skill.id ? <div className="hl-skill-edit">
          <input aria-label="触发词" value={editing.triggers} onChange={event => setEditing({...editing, triggers:event.target.value})}/>
          <textarea aria-label="技能说明" value={editing.instruction} onChange={event => setEditing({...editing, instruction:event.target.value})}/>
          <span><button type="button" className="rb-button rb-primary" disabled={busy} onClick={() => run(async () => { await post(`/api/assistant/skills/${skill.id}/revise`, {instruction:editing.instruction, triggers:editing.triggers.split(/[，,、\s]+/).filter(Boolean)}); setEditing(null); })}>保存修订（重新审批）</button>
          <button type="button" className="rb-button" onClick={() => setEditing(null)}>取消</button></span></div>
        : <p>{skill.instruction}</p>}
      {mayApprove(skill) && editing?.id !== skill.id && <span className="hl-skill-actions">
        {['pending','needs_review'].includes(skill.status) && <button type="button" className="rb-button rb-primary" disabled={busy} onClick={() => run(() => post(`/api/assistant/skills/${skill.id}/decision`, {decision:'approve'}))}>批准</button>}
        {skill.status === 'pending' && <button type="button" className="rb-button" disabled={busy} onClick={() => run(() => post(`/api/assistant/skills/${skill.id}/decision`, {decision:'reject'}))}>驳回</button>}
        {skill.status !== 'archived' && <button type="button" className="rb-button" disabled={busy} onClick={() => setEditing({id:skill.id, instruction:skill.instruction, triggers:skill.triggers.join('，')})}>修订</button>}
        {skill.status === 'active' && <button type="button" className="rb-button" disabled={busy} onClick={() => run(() => post(`/api/assistant/skills/${skill.id}/decision`, {decision:'archive'}))}>停用</button>}
      </span>}
    </li>)}</ul> : <p className="pp-note">还没有沉淀的技能。</p>}
    {error && <p className="pp-error" role="alert">{error}</p>}
  </section>;
}
