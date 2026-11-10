const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { meta: null, modelControl: null, kind: 'weather_window', group: false, tab: 'overview', run: null, events: [], context: null, runs: [], history: [], cursor: null, busy: false, token: '', pollId: 0 };
const statusNames = { queued: '排队中', running: '运行中', succeeded: '计算完成', needs_data: '待补数据', failed: '运行失败' };
const stages = { queued: '请求入队', context: '读取业务上下文', snapshot: '固定本次输入', tools: '整理所需证据', generating: '生成候选建议', validating: '独立校验', succeeded: '策略已保存', needs_data: '返回缺项清单', failed: '运行失败', recovered: '重启后恢复', retry_requested: '请求重试' };
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const pill = (status,quality) => `<span class="pill ${esc(quality?.status==='withdrawn'?'failed':status)}">${esc(quality?.status==='withdrawn'?'已撤回':statusNames[status] ?? status)}</span>`;
const cap = kind => state.meta?.capabilities.find(c => c.kind === kind);
const selectedModelPaused=()=>Boolean(state.modelControl?.paused&&$('#engine-mode').value!=='demo_rules'&&state.meta?.generator!=='demo_rules');
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${value.error?.message ?? '请求失败'}${value.error?.details ? `：${value.error.details.join('；')}` : ''}`);
  return value;
}
function notice(message = '') { $('#notice').hidden = !message; $('#notice').textContent = message; }
function view(name) {
  state.currentView = name;
  for (const key of ['workspace', 'live', 'park', 'history', 'integration']) $(`#${key}-view`).hidden = key !== name;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#breadcrumb').textContent = { workspace: '能力联调', park: '数据与场景', live: '真实数据源', history: '运行记录', integration: '接口与接入' }[name];
  if (name === 'live') loadSources().catch(e => notice(e.message));
  if (name === 'park') loadPark().catch(e => notice(e.message));
  if (name === 'history') refreshHistory().catch(e => notice(e.message));
}
function renderCapabilities() {
  $('#capabilities').innerHTML = state.meta.capabilities.map((c, i) => `<button class="capability ${c.kind === state.kind ? 'active' : ''}" data-kind="${esc(c.kind)}" aria-pressed="${c.kind === state.kind}" ${state.busy ? 'disabled' : ''}><span class="number">0${i + 1}</span><strong>${esc(c.name)}</strong></button>`).join('');
  $('#module-tags').innerHTML = cap(state.kind).modules.map(m => `<span class="tag">${esc(m)}</span>`).join('');
  $('#case-note').textContent = cap(state.kind).description;
  $('#group').disabled = state.kind === 'tapping_angle' || state.busy;
  if (state.kind === 'tapping_angle') state.group = false;
  $('#single').classList.toggle('selected', !state.group); $('#group').classList.toggle('selected', state.group);
  const relevant = { normal: true, missing_weather: state.kind === 'weather_window', rainy: state.kind === 'weather_window', unregistered: state.kind === 'surface_action', missing_cost: state.kind === 'market_scenario' };
  const industry = state.kind === 'industry_brief';
  $('#tree-inputs').hidden = industry;
  if(industry) { if($('#data-mode').value==='demo')$('#data-mode').value='mixed_demo';$('#engine-mode').value='configured'; }
  $('#data-mode').options[0].textContent = industry ? '仅真实公共资料（保留企业缺项）' : '严格检查真实缺项（树档案仍为模拟）';
  $('#data-mode').options[1].disabled = industry;
  const mixed = $('#data-mode').value === 'mixed_demo';
  $('#data-mode-note').textContent = mixed ? '真实资料优先；拿不到的输入用标注为 simulated 的数据补齐。园区位置未确认时，作业预报仍用模拟。' : industry ? '只引用真实公开资料，保留企业缺项，不使用模拟企业数据。' : $('#data-mode').value==='public' ? '保留现场与经营数据的真实缺项，不自动补齐。' : '纯模拟演示：天气、行情和树木数据均由代码构造。';
  $('#run').disabled = state.busy || selectedModelPaused() || state.meta.contextMode !== 'demo' || industry && (!state.meta.publicDataEnabled || state.meta.generator !== 'llm');
  $('#industry-run').disabled=state.busy||Boolean(state.modelControl?.paused)||!state.meta.publicDataEnabled||state.meta.generator!=='llm'||state.meta.contextMode!=='demo';
  for(const selector of ['#tree','#single','#group','#engine-mode']) $(selector).disabled=state.busy||industry;
  $('#data-mode').disabled=state.busy;
  $('#group').disabled=state.busy||industry||state.kind==='tapping_angle';
  const publicMode = $('#data-mode').value !== 'demo';
  $('#variant').disabled = state.busy || publicMode;
  if (publicMode) $('#variant').value = 'normal';
  for (const option of $('#variant').options) option.disabled = !relevant[option.value];
  if (!relevant[$('#variant').value]) $('#variant').value = 'normal';
}
function busy(value) {
  state.busy = value;
  $('#run').disabled = value || state.meta?.contextMode !== 'demo' || state.kind==='industry_brief'&&(!state.meta.publicDataEnabled||state.meta.generator!=='llm');
  $('#run').innerHTML = value ? '正在运行 <span class="spinner">◌</span>' : '运行分析 <span>↗</span>';
  for (const selector of ['#tree', '#variant', '#single', '#data-mode', '#engine-mode']) $(selector).disabled = value;
  document.querySelectorAll('[data-kind]').forEach(b => b.disabled = value);
  if ($('#data-mode').value === 'public') $('#variant').disabled = true;
  if (state.meta) renderCapabilities();
}
const card = (title, detail, cls = '') => `<div class="detail-card ${cls}"><strong>${esc(title)}</strong>${detail ? `<p>${esc(detail)}</p>` : ''}</div>`;
function renderDataPolicy(policy) { return policy ? card('混合演示 · 含模拟数据',policy.notices.join(' '),'missing-card')+`<details class="detail-card"><summary>查看模拟替代项</summary>${policy.substitutions.map(x=>card(x.module,x.reason)).join('')}</details>` : ''; }
function renderProposal(s) {
  const p = s.proposal;
  if (s.kind === 'weather_window') return p.windows.map(w => `<div class="detail-card"><div class="detail-top"><strong>${time(w.start)} — ${time(w.end)}</strong><span class="pill ${w.suitability === 'suitable' ? 'succeeded' : 'needs_data'}">${{ suitable: '候选窗口', defer: '建议暂缓', review: '需要复核' }[w.suitability]}</span></div><p>${esc(w.reason)}</p></div>`).join('');
  if (s.kind === 'tapping_angle') return `<div class="metric-pair"><span>原计划 ${esc(p.previousPlannedCutSlopeDeg)}° →</span><b>${esc(p.recommendedCutSlopeDeg)}°</b><span>候选坡角 · 相对水平</span></div>${p.conditions.map(c => card(c)).join('')}`;
  if (s.kind === 'surface_action') return p.findings.length ? p.findings.map(f => card(`${f.treeId} · ${{ capture: '补拍并配准', manual_assessment: '人工评估', avoid_with_review: '跳刀/避让候选（复核后再规划）', review: '复核', continue_with_review: '清理/确认后正常继续（不误跳刀）' }[f.action]}`, f.reason)).join('') : card('没有有效检测标记', '未报告检测不等于无异常，可继续人工巡查。');
  if (s.kind === 'growth_plan') return p.predictions.map(f => card(`${f.treeId} · ${time(f.at)} · 预计树围 ${f.value} cm`, `方法：${f.method}；仅为外推建议，未经农艺效果验证。`)).join('') + p.futurePanelPlan.map(f => card(`${f.treeId} · 割面安排`, f.reason)).join('');
  if (s.kind === 'market_scenario') return p.scenarios.map(x => card(`每周 ${x.tappingsPerWeek} 次${x.scenarioId === p.recommendedScenarioId ? ' · 演示推荐' : ''}`, `干胶 ${x.expectedDryRubberKg === null ? '待估计' : `${x.expectedDryRubberKg} kg`} / 情景贡献 ${x.estimatedContributionCny === null ? '缺假设，未计算' : `¥ ${x.estimatedContributionCny}`}。${x.reason}`)).join('');
  if (s.kind === 'industry_brief') return p.findings.map(f=>card(f.topic,`${f.assessment} 适用边界：${f.limitation} 来源：${f.sourceRefs.join(' / ')}`)).join('')+'<div class="result-label">管理建议 · 需人工复核</div>'+p.recommendations.map(r=>card(`${r.priority} · ${r.action}`,r.reason)).join('')+card('不确定性',p.uncertainty)+p.missingData.map(x=>card('尚缺数据',x,'missing-card')).join('');
  return p.findings.length ? p.findings.map(f => card(`${f.treeId} · ${f.riskLevel === 'review' ? '需要复核' : '关注'}`, f.reason)).join('') : card('当前未触发巡查演示规则', '这不是健康确诊结论。');
}
function renderResult() {
  const r = state.run;
  const withdrawn=r?.strategy?.qualityReview?.status==='withdrawn';
  $('#download').disabled = !r || ['queued', 'running'].includes(r.status) || withdrawn;
  $('#download').textContent = r?.status === 'succeeded' ? '导出策略包 ↓' : '导出结果 ↓';
  $('#result-status').className = `pill ${withdrawn?'failed':r?.status ?? 'neutral'}`;
  $('#result-status').textContent = withdrawn?'已撤回 · 请勿采用':r ? statusNames[r.status] : '等待运行';
  $('#run-meta').textContent = r ? `${r.runId} · ${time(r.updatedAt)}` : '尚未创建运行';
  const el = $('#result-content');
  if (!r) { el.innerHTML = '<div class="empty"><div class="empty-symbol">⌘</div><h3>从一份可信的输入开始</h3><p>选择左侧的数据条件，运行一次分析。建议、依据和需要补充的数据会展示在这里。</p><div class="steps-mini">输入快照 <span>→</span> 候选生成 <span>→</span> 独立校验</div></div>'; return; }
  if (state.tab === 'json') { el.innerHTML = `<pre>${esc(JSON.stringify(r, null, 2))}</pre>`; return; }
  if (state.tab === 'context') {
    if (!state.context) { el.innerHTML = card('尚无已保存输入', '运行开始后可查看本次实际使用的上下文。'); return; }
    const c = state.context;
    el.innerHTML = `${renderDataPolicy(c.dataPolicy)}<div class="result-label">冻结快照 · 版本 ${esc(c.version)}</div>${c.sourceSnapshots?.length ? card('来源快照', c.sourceSnapshots.join(' / ')) : ''}${card(c.snapshotId, `目标 ${c.targetSnapshot.treeIds.join('、')} / 截止 ${time(c.asOf)}`)}${Object.entries(c.modules).map(([name, data]) => `<details class="detail-card"><summary>${esc(name)} · 查看来源与字段</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`).join('')}`; return;
  }
  if (state.tab === 'events') {
    el.innerHTML = state.events.map(e => `<div class="timeline-row"><span class="timeline-dot"></span><div><h3>${esc(stages[e.stage] ?? e.stage)}</h3><p>${esc(e.data.generator ?? e.data.reason ?? (e.data.modules ? e.data.modules.join(' / ') : e.data.code ?? e.data.snapshotId ?? e.data.strategyId ?? e.data.kind ?? ''))}</p><small>${esc(new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false }))} · event ${e.seq}</small>${e.stage === 'validating' ? `<details><summary class="text-button">查看待校验候选</summary><pre>${esc(JSON.stringify(e.data.candidate, null, 2))}</pre></details>` : ''}</div></div>`).join('') || card('正在记录运行事件'); return;
  }
  if (['queued', 'running'].includes(r.status)) { el.innerHTML = `<div class="empty"><div class="empty-symbol spinner">◌</div><h3>${esc(stages[r.stage] ?? '运行中')}</h3><p>运行状态由服务端返回。你可以稍后从运行记录继续查看。</p></div>`; return; }
  if (r.status === 'needs_data') { el.innerHTML = `<div class="result-lead"><h3>还需要 ${r.missingData.length} 项输入</h3><p>此次没有生成可采用的策略。补齐数据并创建新的快照后重新运行。</p></div>${r.missingData.map(m => card(`${m.module} / ${m.field}`, `${m.objectId}：${m.reason}`, 'missing-card')).join('')}`; return; }
  if (r.status === 'failed') { el.innerHTML = card(r.error.message, r.error.code, 'error-card') + (r.error.details ?? []).map(d => card(d, '', 'error-card')).join('') + (r.error.retryable ? '<button id="retry" class="secondary">重试此运行</button>' : card('请修正输入或服务配置后创建新请求')); return; }
  const s = r.strategy;
  const reviews=(s.qualityReview?.notes??state.events.filter(e=>e.stage==='quality_review').map(e=>e.data.reason)).map(reason=>card('历史结果复核 · 请勿采用',reason,'error-card')).join('');
  el.innerHTML = `${reviews}${renderDataPolicy(s.dataPolicy)}<div class="result-lead"><h3>${esc(s.summary)}</h3><p>${s.generationMetadata ? `LLM 候选 · ${esc(s.generationMetadata.model)}` : '规则演示建议'} · 版本 ${s.revision} · 有效至 ${time(s.expiresAt)} · ${Date.parse(s.expiresAt) <= Date.now() ? '已过期，请重新评估' : '待业务侧检查采用条件'}</p></div>${renderProposal(s)}<div class="result-label">建议依据</div>${s.reasons.map((r, i) => `<div class="reason-row"><span>0${i + 1}</span><div>${esc(r.text)}<div>${r.sourceRefs.map(ref => `<span class="tag">${esc(ref)}</span>`).join('')}</div></div></div>`).join('')}<div class="result-label">独立校验</div><div class="checks">${s.constraintsChecked.map(c => `<span class="check ${c.status === 'not_checked' ? 'pending' : ''}" title="${esc(c.message)}">${c.status === 'pass' ? '✓' : '○'} ${esc(c.code)}</span>`).join('')}</div>`;
}
function renderTable(items) {
  if (!items.length) return '<div class="history-empty">暂无运行记录。开始一次分析，结果会持久保存在这里。</div>';
  return `<table><thead><tr><th>能力 / 运行</th><th>状态</th><th>创建时间</th><th>尝试</th><th></th></tr></thead><tbody>${items.map(r => `<tr><td>${esc(cap(r.kind)?.name ?? r.kind)}<br><code>${esc(r.runId.slice(0, 22))}…</code></td><td>${pill(r.status,r.qualityReview)}</td><td>${time(r.createdAt)}</td><td>${r.attempt}</td><td><button data-run="${esc(r.runId)}">查看 ↗</button></td></tr>`).join('')}</tbody></table>`;
}
async function refreshHistory(append = false) {
  const page = await api(`/internal/harness/runs?limit=20${append && state.cursor ? `&cursor=${state.cursor}` : ''}`);
  state.history = append ? [...state.history, ...page.items] : page.items; state.cursor = page.nextCursor;
  if (!append) { state.runs = page.items; $('#recent-runs').innerHTML = renderTable(page.items.slice(0, 5)); }
  $('#all-runs').innerHTML = renderTable(state.history); $('#load-more').hidden = !state.cursor;
}
async function loadDetails(id) {
  const [events, context] = await Promise.allSettled([api(`/internal/harness/runs/${id}/events`), api(`/internal/harness/runs/${id}/context`)]);
  if (state.run?.runId !== id) return;
  state.events = events.status === 'fulfilled' ? events.value.items : [];
  state.context = context.status === 'fulfilled' ? context.value : null;
}
async function poll(id, generation) {
  const started = Date.now();
  while (generation === state.pollId) {
    const run = await api(`/internal/harness/runs/${id}`);
    if (generation !== state.pollId) return;
    state.run = run; renderResult();
    if (!['queued', 'running'].includes(run.status)) { await loadDetails(id); renderResult(); await refreshHistory(); return; }
    if (Date.now() - started > 60000) { notice('本次运行仍在后台处理，可从运行记录继续查看。'); await refreshHistory(); return; }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}
async function run() {
  if(selectedModelPaused()){notice('模型调用已暂停。可选择离线规则演示，或在顶部显式恢复模型调用。');return;}
  notice(); busy(true); state.events = []; state.context = null; state.tab = 'overview';
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const generation = ++state.pollId;
  try {
    const selected = $('#tree').value;
    const treeIds = state.group ? [...new Set([selected, 'T-0007', 'T-0012', 'T-0013'])].slice(0, 3) : [selected];
    const dataMode=$('#data-mode').value;
    const target = state.kind === 'industry_brief' ? await api('/api/sources/industry-context', {dataMode}) : dataMode !== 'demo' ? await api('/api/sources/contexts', { treeIds,dataMode }) : await api('/api/demo/contexts', { treeIds, variant: $('#variant').value });
    const submitted = await api('/internal/harness/runs', { requestId: `ui-${crypto.randomUUID()}`, kind: state.kind, generatorMode:$('#engine-mode').value, siteId: target.siteId, targetSnapshotId: target.targetSnapshotId, inputSnapshot: target.inputSnapshot, executionMode: 'simulation' });
    state.run = submitted; renderResult(); await poll(submitted.runId, generation);
  } catch (error) { notice(error.message); } finally { busy(false); }
}
async function openRun(id) {
  const generation = ++state.pollId; busy(true); state.context = null; state.events = [];
  const saved = [...state.runs, ...state.history].find(r => r.runId === id);
  if (saved) { state.kind = saved.kind; renderCapabilities(); }
  state.tab = 'overview';
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'overview'));
  view('workspace');
  try { await poll(id, generation); } catch (e) { notice(e.message); } finally { busy(false); }
}
async function init() {
  state.meta = await api('/api/meta');
  await loadModelControl();
  $('#connection').textContent = '● 服务已连接';
  if (!state.meta.publicDataEnabled) { $('#data-mode').value = 'demo'; $('#data-mode').options[0].disabled = true; $('#data-mode').options[2].disabled=true; } else $('#data-mode').options[0].disabled = false;
  $('#engine-label').textContent = state.meta.generator === 'llm' ? `LLM · ${state.meta.modelVersion}` : state.meta.generator === 'demo_rules' ? '规则演示引擎' : '外部候选服务';
  $('#engine-mode').options[0].textContent=$('#engine-label').textContent;
  $('#model-note').textContent=state.meta.generator==='llm' ? (state.meta.llm?.configured ? (['ollama','lmstudio','vllm'].includes(state.meta.llm.provider) ? '本地模型配置已载入，不产生云 API 费用；请确认本机模型服务已启动。复杂条件的候选失败会保留审计并生成带告警的规则保底包。' : 'LLM 配置已载入，运行时会消耗所配置服务的 API 额度；配置存在不代表服务已连通。复杂条件的候选失败会保留审计并生成带告警的规则保底包。') : '尚未配置模型凭据，可在 .env.local 配置后重启；复杂条件会显示带告警的规则保底策略，或手动选择离线规则演示。') : '当前使用服务所配置的生成器；离线规则与真实模型分开标识。';
  renderSourceOverview();
  const mode = $('#data-mode').value;
  $('#data-mode-note').textContent = mode === 'public'
    ? '真实来源模式如实返回地点、现场观测和经营数据的缺项，不自动补造。'
    : mode === 'mixed_demo'
      ? '真实资料优先；拿不到的输入用标注为 simulated 的数据补齐。园区位置未确认时，作业预报仍用模拟。'
      : '纯模拟演示：天气、行情和树木数据均由代码构造。';
  $('#integration-status').innerHTML = card('输入上下文', state.meta.contextMode === 'demo' ? (state.meta.publicDataEnabled ? '可选真实公共来源 + 模拟树档案，或纯模拟回放' : '本地模拟快照 / 四类模拟来源') : '远程业务上下文服务') + card('候选生成', `${state.meta.generator} / ${state.meta.modelVersion ?? '未接入真实模型'}`) + card('运行环境', 'simulation / SQLite 持久化 / 仅输出建议');
  if (state.meta.contextMode === 'demo') {
    let cursor, trees = [];
    do { const page = await api(`/api/demo/trees?limit=100${cursor ? `&cursor=${cursor}` : ''}`); trees.push(...page.items); cursor = page.nextCursor; } while (cursor);
    $('#tree').innerHTML = trees.map(t => `<option value="${esc(t.treeId)}" ${t.treeId === 'T-0012' ? 'selected' : ''}>${esc(t.treeId)} · ${esc(t.blockId)} 区${t.healthStatus === 'watch' ? ' · 关注样例' : ''}</option>`).join('');
  } else { $('#tree').innerHTML = '<option>由业务后端提交目标快照</option>'; $('#input-footer').textContent = '远程模式请通过接口提交业务请求，联调台可查看运行记录。'; }
  renderCapabilities(); renderResult(); busy(false); await refreshHistory();await loadAutomatic();
  if (state.meta.publicDataEnabled && !state.currentView) view('live');
}
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]'); if (nav) view(nav.dataset.view);
  const kind = event.target.closest('[data-kind]'); if (kind && !state.busy) { state.kind = kind.dataset.kind; state.run = null; state.context = null; state.events = []; renderCapabilities(); renderResult(); }
  const tab = event.target.closest('[data-tab]'); if (tab) { state.tab = tab.dataset.tab; document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b === tab); b.setAttribute('aria-selected', String(b === tab)); }); renderResult(); }
  const record = event.target.closest('[data-run]'); if (record) openRun(record.dataset.run);
  if (event.target.closest('#retry')) { busy(true); try { await api(`/internal/harness/runs/${state.run.runId}/retry`, {}); await poll(state.run.runId, ++state.pollId); } catch (e) { notice(e.message); } finally { busy(false); } }
});
$('#single').onclick = () => { state.group = false; renderCapabilities(); };
$('#group').onclick = () => { state.group = true; renderCapabilities(); };
$('#run').onclick = run;
$('#refresh').onclick = () => refreshHistory().catch(e => notice(e.message));
$('#load-more').onclick = () => refreshHistory(true).catch(e => notice(e.message));
$('#download').onclick = async () => {
  if (!state.run) return;
  try {
    const value=await api(`/internal/harness/runs/${encodeURIComponent(state.run.runId)}/export`);
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`${value.runId}.json`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  } catch(e) {notice(e.message);}
};
$('#auth-form').onsubmit = async event => { event.preventDefault(); state.token = $('#token').value; $('#token').value = ''; try { await init(); notice(); view('workspace'); } catch (e) { notice(e.message); } };
renderResult(); busy(true);
init().catch(error => { $('#connection').textContent = '○ 尚未连接'; notice(`${error.message}。如已启用服务令牌，请在「接口与接入」中连接。`); });

let parkData, storyBusy = false;
async function loadPark() {
  if (state.meta?.contextMode !== 'demo') { $('#scenario-cards').innerHTML = card('远程模式不提供模拟园区'); $('#play-story').disabled = true; $('#export-park').disabled = true; return; }
  if (!parkData) parkData = await api('/api/demo/park');
  const c = parkData.counts;
    $('#park-counts').innerHTML = [[`${c.trees} 棵树 / ${c.blocks} 分区`, '六种模拟情况，品种、尺寸和计划角度不同'], [`${c.growth} 条生长记录`, '每树 4 个时点，覆盖 90 天'], [`${c.health} 条巡查记录`, '每树 3 个时点，覆盖 30 日风险窗口'], [`${c.marketPrices} 条行情 / ${c.forecastSteps} 段预报`, '园区共用天气；检测记录无真实图片']].map(([a,b]) => `<div class="source-card"><h3>${a}</h3><p>${b}</p></div>`).join('');
  $('#scenario-cards').innerHTML = parkData.scenarios.map(s => `<div class="panel info-card"><h2>${esc(s.title)}</h2><p>${esc(s.description)}</p><span class="tag">${s.treeIds.length} 棵目标树</span><button class="text-button" data-scenario="${s.id}">运行此场景 ↗</button></div>`).join('');
  const selected = $('#park-profile').value;
  $('#park-profile').innerHTML = '<option value="">全部情况</option>' + Object.entries(parkData.profiles).map(([k,v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#park-profile').value = selected;
  renderParkTrees();
  $('#play-story').disabled = storyBusy;
  document.querySelectorAll('[data-scenario]').forEach(b => b.disabled = storyBusy);
}
function renderParkTrees() {
  if (!parkData) return;
  const rows = parkData.trees.filter(t => (!$('#park-block').value || t.blockId === $('#park-block').value) && (!$('#park-profile').value || t.profile === $('#park-profile').value));
  $('#park-filter-count').textContent = `显示 ${rows.length} / 200 棵`;
  $('#park-trees').innerHTML = `<table><thead><tr><th>树号 / 分区</th><th>模拟情况</th><th>树围</th><th>种植日期</th><th></th></tr></thead><tbody>${rows.map(t => `<tr><td>${t.treeId} / ${t.blockId}</td><td>${esc(parkData.profiles[t.profile])}</td><td>${t.circumferenceCm ?? '缺失'}${t.circumferenceCm === null ? '' : ' cm'}</td><td>${t.plantedAt}</td><td><button data-park-tree="${t.treeId}">查看档案与历史 ↗</button></td></tr>`).join('')}</tbody></table>`;
}
function showParkTree(id) {
  const t = parkData.trees.find(t => t.treeId === id), m = parkData.modules;
  const measurements = m.growth.measurements.filter(x => x.treeId === id), health = m.health.records.filter(x => x.treeId === id);
  const detail = $('#park-detail'); detail.hidden = false;
  detail.innerHTML = `<h2>${id} · ${esc(parkData.profiles[t.profile])}</h2><p>${esc(t.variety)} · 高 ${t.heightM} m · ${t.tappingStatus === 'resting' ? '休割养护' : '档案状态：可开割'} · 所有记录为模拟。</p><div class="scenario-grid"><div><h3>树围历史 · 测量高度 1.3 m</h3>${measurements.map(x => card(`${time(x.observedAt)} · ${x.circumferenceCm ?? '缺失'}${x.circumferenceCm === null ? '' : ' cm'}`)).join('')}</div><div><h3>巡查历史</h3>${health.map(x => card(time(x.observedAt), x.symptomCodes.length ? '记录到叶斑症状，未确诊' : '未记录症状，不等于确诊健康')).join('')}</div></div><details><summary>查看该树完整原始 JSON</summary><pre>${esc(JSON.stringify({ tree: t, growth: measurements, health, panel: m.tapping.panels.find(x => x.treeId === id), inspection: m.inspection.evidence.find(x => x.treeId === id) }, null, 2))}</pre></details>`;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderStory(items, runs) {
  $('#story-results').innerHTML = '<div class="section-title history-title"><h2>本轮演示结果</h2><span>输入 → 规则分析 → 校验 → 保存</span></div>' + items.map((item, i) => {
    const r = runs[i], s = r?.strategy;
    const summary = s?.kind === 'weather_window' ? `候选窗口 ${s.proposal.windows.filter(w => w.suitability === 'suitable').length} 个 / 暂缓 ${s.proposal.windows.filter(w => w.suitability === 'defer').length} 个（只评估天气）` : s?.summary ?? r?.missingData?.map(x => `${x.objectId}：${x.reason}`).join('；') ?? r?.error?.message ?? '正在分析';
    return `<div class="detail-card"><div class="detail-top"><strong>${esc(item.title)}</strong>${pill(r?.status ?? 'queued')}</div><p>${esc(summary)}</p><button class="text-button" data-run="${item.runId}">查看结果、输入与运行轨迹 ↗</button></div>`;
  }).join('');
}
async function playStory(scenarioId = 'all') {
  if (storyBusy) return;
  storyBusy = true; notice();
  $('#play-story').disabled = true;
  document.querySelectorAll('[data-scenario]').forEach(b => b.disabled = true);
  try {
    const batch = await api('/api/demo/scenarios/run', { scenarioId });
    renderStory(batch.items, []);
    const deadline = Date.now() + 60000;
    while (true) {
      const runs = await Promise.all(batch.items.map(x => api(`/internal/harness/runs/${x.runId}`)));
      renderStory(batch.items, runs);
      if (runs.every(r => !['queued', 'running'].includes(r.status))) break;
      if (Date.now() > deadline) { notice('运行仍在后台继续，请从运行记录查看。'); break; }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    await refreshHistory();
  } catch(e) { notice(e.message); }
  finally { storyBusy = false; $('#play-story').disabled = false; document.querySelectorAll('[data-scenario]').forEach(b => b.disabled = false); }
}
$('#play-story').onclick = () => playStory();
$('#park-block').onchange = renderParkTrees;
$('#park-profile').onchange = renderParkTrees;
$('#export-park').onclick = () => {
  if (!parkData) return;
  const data = { description: '园区合成输入数据，不包含分析结果；天气为园区共享。', asOf: parkData.asOf, counts: parkData.counts, modules: parkData.modules };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'simulated-park-inputs.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
document.addEventListener('click', e => {
  const tree = e.target.closest('[data-park-tree]'); if (tree) showParkTree(tree.dataset.parkTree);
  const scene = e.target.closest('[data-scenario]'); if (scene) playStory(scene.dataset.scenario);
});

let sourcesBusy = false;
function renderSourceOverview() {
  const publicMode = state.meta?.contextMode === 'demo' && $('#data-mode').value !== 'demo';
  const icons = ['⌁', '↗', '◇', '◎'];
  const descriptions = [
    [$('#data-mode').value==='mixed_demo'?'模拟补齐':'保留缺项', '树档案、现场观测和图像检测使用模拟记录演示'],
    ['公开服务', '参考点天气进入快照；期货和月报可供行业研判'],
    ['公开资料', '年度与最新病虫害公告可供行业研判，单树仍需现场证据'],
    [$('#data-mode').value==='mixed_demo'?'模拟补齐':'保留缺项', '成本、产量及经营记录可用明确标注的模拟数据补齐'],
  ];
  $('#sources').innerHTML = state.meta.sources.map((s,i) => `<div class="source-card"><div class="source-top"><span class="source-icon">${icons[i]}</span><span class="source-mode">${publicMode ? descriptions[i][0] : s.mode === 'simulated' ? '模拟适配器' : '由业务后端提供'}</span></div><h3>${esc(s.name)}</h3><p>${esc(publicMode ? descriptions[i][1] : s.supplies.join(' / '))}</p></div>`).join('');
}
const sourceState = { available: '已获取', unavailable: '暂不可用', stale: '已过期', refresh_failed: '更新失败 · 保留历史' };
async function loadSources() {
  const data = await api('/api/sources');
  $('#live-location').textContent = `天气地点：${data.location.name}（${data.location.latitude}, ${data.location.longitude}）。${data.location.confirmed ? '已配置确认地点；仍需现场观测。' : '园区位置未确认，仅作为参考点展示，不用于园区作业结论。'}`;
  $('#live-sources').innerHTML = data.sources.map(s => {
    const d = s.data; let detail = '';
    if (d && s.id === 'weather') {
      const current = d.currentEstimate;
      detail = card('区域模型估计 · 非实测', current ? `${time(current.at)} · ${current.airTemperatureC ?? '缺失'} °C · 湿度 ${current.relativeHumidityPct ?? '缺失'}%` : '当前模型值缺失') + card('预报与历史', `${d.forecast.length} 个未来小时段，${d.recentModelHistory.length} 条历史模型值；含土壤体积含水率（m³/m³）。`);
      detail += d.forecast.filter(x => Date.parse(x.validFrom) >= Date.now()).slice(0,4).map(x => card(`${time(x.validFrom)} — ${time(x.validTo)}`, `预报雨量 ${x.rainfallMm ?? '缺失'} mm · 降水概率 ${x.rainProbabilityPct ?? '缺失'}%`)).join('');
    }
    if (d && s.id === 'market') detail = card(`最近已结算交易日 ${d.tradeDate}`, '当日未结算、周末或节假日自动回查；逐合约报价，未合成“现货价”。') + `<div class="history-table"><table><thead><tr><th>合约</th><th>收盘 元/吨</th><th>结算 元/吨</th></tr></thead><tbody>${d.contracts.map(x => `<tr><td>${esc(x.contract)}</td><td>${x.closeCnyPerTonne ?? '缺失'}</td><td>${x.settlementCnyPerTonne ?? '缺失'}</td></tr>`).join('')}</tbody></table></div>`;
    if (d && s.id === 'warehouse') detail = card(`${d.reportDate} · 注册仓单`, `${d.quantityTonnes} 吨 · 较前日 ${d.changeTonnes >= 0 ? '+' : ''}${d.changeTonnes} 吨`);
    if (d && ['monthly_report','production_national','production_hainan','pest_updates'].includes(s.id)) detail=card(d.title,`统计/适用期 ${d.period} · 发布 ${time(d.publishedAt)}`)+(d.metrics??[]).map(m=>card(m.name,`${m.value} ${m.unit} · ${m.scope} · ${m.period}`)).join('')+card('原文要点',(d.paragraphs??[]).slice(0,2).join('\n'));
    if (d && s.id === 'bulletin') detail = card(d.title, `${d.period} · 发布于 ${time(d.publishedAt)}`) + card('宏观背景',d.summary);
    return `<section class="panel info-card"><div class="detail-top"><h2>${esc(s.title)}</h2><span class="pill ${s.status === 'available' ? 'succeeded' : 'needs_data'}">${esc(sourceState[s.status])}</span></div><p>${esc(s.provider)} · 获取 ${s.retrievedAt ? time(s.retrievedAt) : '尚未成功'}</p>${s.lastError ? card('最近更新异常',s.lastError.message,'missing-card') : ''}${detail}<p>${esc(s.note)}</p><a class="text-button" href="${esc(s.sourceUrl??s.url)}" target="_blank" rel="noreferrer">官方来源 ↗</a>${s.snapshotId ? `<button class="text-button" data-source-export="${esc(s.snapshotId)}"> 下载来源快照 ↓</button>` : ''}</section>`;
  }).join('');
  const coverage=await api('/api/sources/coverage');
  const coverageState={business_data_required:'待接业务数据',public_reference_available:'公开参考已接入',partial:'部分公开参考可用',unavailable:'公开来源暂不可用'};
  $('#source-coverage').innerHTML=coverage.items.map(x=>card(x.requirement,`${coverageState[x.status]} · ${x.sources.length ? '不可用时可在混合演示中用模拟替代。' : '演示阶段使用模拟输入；真实接入仍待完成。'} ${x.boundary} 待提供：${x.fields.join('、')}`)).join('');
  if(state.meta.contextMode==='demo') { const business=await api('/api/demo/business-data');$('#business-demo').innerHTML=business.records.map(r=>`<details class="detail-card"><summary>${esc(r.title)}</summary><p>${esc(r.scope)}</p><pre>${esc(JSON.stringify(JSON.parse(r.content),null,2))}</pre></details>`).join(''); }
  return data;
}
$('#data-mode').onchange = () => {
  const mode = $('#data-mode').value;
  $('#data-mode-note').textContent = mode === 'public'
    ? '真实来源模式如实返回地点、现场观测和经营数据的缺项，不自动补造。'
    : mode === 'mixed_demo'
      ? '真实资料优先；拿不到的输入用标注为 simulated 的数据补齐。园区位置未确认时，作业预报仍用模拟。'
      : '纯模拟演示：天气、行情和树木数据均由代码构造。';
  renderCapabilities();
  renderSourceOverview();
};
$('#refresh-sources').onclick = async () => {
  if (sourcesBusy) return;
  sourcesBusy = true; $('#refresh-sources').disabled = true; $('#refresh-sources').textContent = '正在获取…';
  try {
    await api('/api/sources/refresh', {});
    const deadline = Date.now() + 90000;
    while (true) { const d = await loadSources(); if (!d.refreshing) break; if(Date.now() > deadline) { notice('采集仍在后台进行，可稍后重新查看。'); break; } await new Promise(r => setTimeout(r,1500)); }
  } catch(e) { notice(e.message); }
  finally { sourcesBusy = false; $('#refresh-sources').disabled = false; $('#refresh-sources').textContent = '更新公开数据 ↻'; }
};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-source-export]'); if (!el) return;
  try {
    const data = await api(`/api/sources/snapshots/${el.dataset.sourceExport}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a = document.createElement('a');a.href=url;a.download=`${el.dataset.sourceExport}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  } catch(error) { notice(error.message); }
});

$('#engine-mode').onchange=()=>renderCapabilities();
$('#industry-run').onclick=()=>{ $('#data-mode').value='mixed_demo';state.kind='industry_brief';view('workspace');renderCapabilities();run(); };

let modelControlLoading=false;
function renderModelControl(control) {
  state.modelControl=control;$('#model-control-panel').hidden=false;
  $('#model-control-title').textContent=control.paused?'模型调用已暂停':'模型调用已开启';
  $('#model-control-summary').textContent=control.paused?'当前不会发送新的模型请求。需要分析时，可选择“离线规则演示”；只有点击“恢复模型调用”才会重新允许模型请求。':'手动或自动模型分析会消耗 API 额度。暂停后阻止所有新的模型请求，恢复自动运行不会改变此开关。';
  $('#model-control-toggle').textContent=control.paused?'恢复模型调用':'暂停全部模型调用';
  if(state.meta)renderCapabilities();
}
async function loadModelControl() {
  if(modelControlLoading)return;modelControlLoading=true;
  try{renderModelControl(await api('/api/model/control'));}finally{modelControlLoading=false;}
}
$('#model-control-toggle').onclick=async()=>{
  if(!state.modelControl)return;$('#model-control-toggle').disabled=true;
  try{renderModelControl(await api('/api/model/control',{paused:!state.modelControl.paused}));}catch(error){notice(error.message);}finally{$('#model-control-toggle').disabled=false;}
};

let automaticState=null,automaticLoading=false,automaticRunSignature=null;
async function loadAutomatic() {
  if(automaticLoading)return;automaticLoading=true;
  try {
    const a=await api('/api/automatic');automaticState=a;
    $('#automatic-panel').hidden=a.status==='unconfigured';if(a.status==='unconfigured')return;
    const labels={waiting:'已开启，等待下一轮',running:'正在自动采集与分析',paused:'已手动暂停',error_paused:'异常暂停，等待处理',budget_wait:'已达到系统自动任务上限（非 API 余额），等待窗口恢复',disabled:'配置中已关闭'};
    $('#automatic-summary').textContent=`${labels[a.status]}。${a.nextCheckAt?`下次检查：${time(a.nextCheckAt)}。`:''}${a.circuitReason?`原因：${a.circuitReason.message}`:''}`;
    $('#automatic-budget').textContent=`每 ${a.config.intervalMinutes} 分钟检查；滚动 24 小时分析 ${a.budget.runs}/${a.config.maxRunsPer24Hours} 项，模型请求 ${a.budget.modelRequests}/${a.config.maxModelRequestsPer24Hours} 次（含修正与结果不明的请求）。任务：${a.jobs.map(j=>cap(j.kind)?.name??j.kind).join('、')}。`;
    const paused=['paused','error_paused'].includes(a.status);$('#automatic-toggle').textContent=paused?'恢复自动运行':'暂停自动运行';$('#automatic-toggle').disabled=a.status==='disabled';
    const signature=JSON.stringify(a.runs);
    if(signature!==automaticRunSignature){
      $('#automatic-runs').innerHTML=a.runs.slice(0,2).map(r=>`<div class="detail-top"><span>${esc(cap(r.kind)?.name??r.kind)} · ${esc(r.qualityReview?.status==='withdrawn'?'已撤回':statusNames[r.status])} · ${time(r.createdAt)}</span><button class="text-button" data-run="${esc(r.runId)}">查看自动结果 ↗</button></div>`).join('');
      automaticRunSignature=signature;await refreshHistory();
    }
  } finally {automaticLoading=false;}
}
$('#automatic-toggle').onclick=async()=>{
  if(!automaticState)return;$('#automatic-toggle').disabled=true;
  try{await api('/api/automatic/control',{paused:!['paused','error_paused'].includes(automaticState.status)});await loadAutomatic();}catch(e){notice(e.message);$('#automatic-toggle').disabled=false;}
};
setInterval(()=>{if(state.meta&&!document.hidden){loadAutomatic().catch(()=>{});loadModelControl().catch(()=>{});}},5000);
