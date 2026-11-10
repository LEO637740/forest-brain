import { createTreeViewClient, TreeViewError } from './tree-view-client.js';

const $ = selector => document.querySelector(selector);
const state = {
  manifest: [],
  selectedTreeId: '',
  requestSerial: 0,
  controller: null,
  expiryTimer: null,
};
const client = createTreeViewClient({ baseUrl: '' });

const STATUS_LABELS = {
  available: '策略可用',
  needs_generation: '等待预生成',
  pending: '策略处理中',
  expired: '策略已过期',
  withdrawn: '策略已撤回',
  needs_data: '缺少必要数据',
  failed: '生成失败',
  succeeded: '运行完成',
  not_generated: '尚未生成',
  queued: '排队中',
  running: '运行中',
};
const PROFILE_LABELS = {
  normal: '正常对照', scar: '割线伤痕', lesion: '疑似病斑', unregistered: '需要补拍',
  resting: '休割养护', missing: '尺寸缺失',
  available: '可割胶', immature: '未达割胶条件', blocked: '已阻断', unknown: '未知',
  watch: '需要关注', confirmed_issue: '已确认异常',
};
const DIRECTION_LABELS = { left_to_right: '从左向右', right_to_left: '从右向左' };
const DATA_MODE_LABELS = { demo: '模拟数据', mixed_demo: '真实优先 · 缺项用模拟补齐' };

function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}
function value(value, fallback = '—') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}
function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleString('zh-CN', { hour12: false });
}
function statusLabel(status) { return STATUS_LABELS[status] ?? value(status, '未知状态'); }
function addDefinition(container, label, content) {
  const item = node('div', 'profile-cell');
  item.append(node('dt', '', label), node('dd', '', value(content)));
  container.append(item);
}
function addProvenance(container, label, content) {
  const item = node('div', 'provenance-cell');
  item.append(node('dt', '', label), node('dd', '', value(content)));
  container.append(item);
}
function setConnection(message, kind = '') {
  const element = $('#connection-state');
  element.textContent = message;
  element.className = `header-state ${kind}`.trim();
}
function setStatus(status, kind = status) {
  const element = $('#view-status');
  element.textContent = statusLabel(status);
  element.className = `status-chip ${kind}`.trim();
}
function setBusy(busy) {
  $('#loading').hidden = !busy;
  $('#tree-list').setAttribute('aria-busy', String(busy));
  $('#tree-list').querySelectorAll('button').forEach(button => { button.disabled = busy; });
}
function resetExpiryTimer() {
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  state.expiryTimer = null;
}
function abortCurrentRequest() {
  state.controller?.abort();
  state.controller = null;
}
function manifestItem(treeId) {
  return state.manifest.find(item => item.treeId === treeId);
}
function treeObjectName(treeId) {
  return manifestItem(treeId)?.objectName ?? `Tree_${treeId}`;
}

function renderManifest(items) {
  const list = $('#tree-list');
  clear(list);
  state.manifest = Array.isArray(items) ? items.filter(item => item && /^T-\d{4}$/.test(item.treeId)) : [];
  $('#tree-count').textContent = `${state.manifest.length} 棵`;
  if (!state.manifest.length) {
    const empty = node('p', 'panel-hint', '服务没有返回可绑定的树。请检查 manifest 接口。');
    list.append(empty);
    return;
  }
  for (const item of state.manifest) {
    const button = node('button', 'tree-item');
    button.type = 'button';
    button.dataset.treeId = item.treeId;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.title = item.objectName ? `${item.objectName} · ${item.treeId}` : item.treeId;
    const label = node('span', 'tree-label', value(item.label, item.treeId));
    label.append(node('span', 'tree-id', item.treeId));
    button.append(label, node('span', 'tree-arrow', '›'));
    button.addEventListener('click', () => selectTree(item.treeId));
    list.append(button);
  }
}
function selectActiveButton(treeId) {
  $('#tree-list').querySelectorAll('button[data-tree-id]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.treeId === treeId));
  });
}

function showManifestError(error) {
  const target = $('#manifest-error');
  clear(target);
  const message = error instanceof TreeViewError ? `${error.message}${error.code ? `（${error.code}）` : ''}` : '树清单读取失败';
  target.append(node('strong', '', '无法读取树清单'), node('br'), node('span', '', message));
  target.hidden = false;
  setConnection('服务不可用', 'error');
}
function renderTreeProfile(tree, objectName) {
  $('#detail-title').textContent = `${value(tree.treeId)} · ${value(tree.profile, '树档案')}`;
  $('#tree-object-name').textContent = objectName;
  const profile = $('#profile-grid');
  clear(profile);
  addDefinition(profile, '树 ID', tree.treeId);
  addDefinition(profile, '分区 / 行', `${value(tree.blockId)} / ${value(tree.rowId)}`);
  addDefinition(profile, '品种', tree.variety);
  addDefinition(profile, '树况标签', PROFILE_LABELS[tree.profile] ?? tree.profile);
  addDefinition(profile, '割胶状态', PROFILE_LABELS[tree.tappingStatus] ?? tree.tappingStatus);
  addDefinition(profile, '健康状态', PROFILE_LABELS[tree.healthStatus] ?? tree.healthStatus);
  addDefinition(profile, '树高', tree.heightM === null || tree.heightM === undefined ? '缺失' : `${tree.heightM} m`);
  addDefinition(profile, '胸围 / 测量时间', tree.circumferenceCm === null || tree.circumferenceCm === undefined ? `缺失 / ${date(tree.measuredAt)}` : `${tree.circumferenceCm} cm / ${date(tree.measuredAt)}`);
  addDefinition(profile, '种植时间', tree.plantedAt);
}
function strategyEngine(strategy, run) {
  const generatorMode = run?.generatorMode;
  const modelVersion = strategy?.modelVersion;
  const provider = strategy?.generationMetadata?.provider ?? '';
  if (generatorMode === 'configured' || modelVersion || (provider && !/rule|demo|offline/i.test(provider))) return '配置模型';
  return '离线规则演示';
}
function strategySource(strategy, run) {
  const mode = strategy?.dataPolicy?.mode ?? 'demo';
  return `${strategyEngine(strategy, run)} · ${DATA_MODE_LABELS[mode] ?? mode}`;
}
function renderMissingData(data) {
  const wrap = node('div', 'strategy-empty');
  const title = data.strategyStatus === 'needs_data' ? '这棵树暂时不能形成可采用的割线策略。' : '当前没有可展示的有效策略。';
  wrap.append(node('strong', '', title));
  if (data.missingData?.length) {
    const details = data.missingData.map(item => [item.module, item.field, item.objectId, item.reason].filter(Boolean).join(' · ')).join('；');
    wrap.append(node('p', '', `缺项：${details}`));
  } else if (data.strategyStatus === 'needs_generation') {
    wrap.append(node('p', '', '请由运维先运行 npm run demo:prepare，再点击刷新或重新选择这棵树。'));
  } else if (data.strategyStatus === 'pending') {
    wrap.append(node('p', '', '策略正在准备中，请稍后重新读取。'));
  } else if (data.strategyStatus === 'expired') {
    wrap.append(node('p', '', '策略已超过有效期，等待下一份预生成结果。'));
  } else if (data.strategyStatus === 'withdrawn') {
    wrap.append(node('p', '', '该策略已经撤回，不再展示其建议内容。'));
  } else if (data.error?.message) {
    wrap.append(node('p', '', data.error.message));
  } else {
    wrap.append(node('p', '', `状态：${statusLabel(data.strategyStatus ?? data.status)}`));
  }
  return wrap;
}
function renderStrategy(data) {
  const container = $('#strategy-content');
  clear(container);
  const strategy = data.strategy;
  const locallyExpired = strategy?.expiresAt && Date.parse(strategy.expiresAt) <= Date.now();
  if (!strategy || data.strategyStatus !== 'available' || locallyExpired) {
    container.append(renderMissingData({ ...data, strategyStatus: locallyExpired ? 'expired' : data.strategyStatus }));
    return locallyExpired ? 'expired' : (data.strategyStatus ?? 'needs_generation');
  }
  const proposal = strategy.proposal ?? {};
  const card = node('div', 'strategy-card');
  const lead = node('div', 'strategy-lead');
  lead.append(node('strong', 'strategy-angle', `${value(proposal.recommendedCutSlopeDeg)}°`), node('span', 'strategy-angle-label', '候选割线坡角 · 相对水平'));
  card.append(lead);
  const meta = node('div', 'strategy-meta');
  const previous = proposal.previousPlannedCutSlopeDeg === null || proposal.previousPlannedCutSlopeDeg === undefined ? '无历史计划' : `${proposal.previousPlannedCutSlopeDeg}°`;
  const direction = DIRECTION_LABELS[proposal.cutDirection] ?? proposal.cutDirection;
  for (const [label, text] of [['原计划', previous], ['割线方向', direction], ['策略引擎', strategyEngine(strategy, data.run)], ['有效期至', date(strategy.expiresAt)]]) {
    const item = node('div', 'strategy-meta-item');
    item.append(node('b', '', label), node('span', '', value(text)));
    meta.append(item);
  }
  card.append(meta);
  if (strategy.summary) card.append(node('p', 'strategy-summary', strategy.summary));
  if (Array.isArray(proposal.conditions) && proposal.conditions.length) {
    const title = node('h4', '', '采用条件');
    const list = node('ul', 'strategy-list');
    proposal.conditions.forEach(condition => list.append(node('li', '', condition)));
    card.append(title, list);
  }
  if (Array.isArray(strategy.reasons) && strategy.reasons.length) {
    const reasons = node('div', 'strategy-reasons');
    reasons.append(node('h4', '', '判断理由'));
    strategy.reasons.forEach(reason => {
      const text = reason?.text ?? reason;
      if (text) reasons.append(node('p', '', text));
    });
    card.append(reasons);
  }
  container.append(card);
  return 'available';
}
function renderProvenance(data, strategy) {
  const grid = $('#provenance-grid');
  clear(grid);
  const policy = data.dataPolicy ?? strategy?.dataPolicy;
  addProvenance(grid, '输入快照时间', date(data.asOf));
  addProvenance(grid, '本次检查时间', date(data.checkedAt));
  addProvenance(grid, '数据策略', DATA_MODE_LABELS[policy?.mode] ?? value(policy?.mode));
  const treeMode = data.tree?.provenance?.mode;
  const strategyMode = strategy?.provenance?.mode;
  addProvenance(grid, '树档案来源', treeMode === 'simulated' ? '模拟树档案' : value(treeMode));
  addProvenance(grid, '策略证据模式', strategyMode === 'simulated' ? '模拟规则证据' : value(strategyMode));
  addProvenance(grid, '规则版本', strategy?.ruleVersion);
  addProvenance(grid, '策略生成时间', date(strategy?.generatedAt));
  const notices = $('#policy-notices');
  clear(notices);
  if (policy?.notices?.length) {
    const title = node('strong', '', '数据边界：');
    notices.append(title, node('span', '', policy.notices.join(' ')));
  }
  if (policy?.substitutions?.length) {
    const substitution = policy.substitutions.map(item => `${item.module}：${item.reason}`).join('；');
    const line = node('div', '', `模拟补齐：${substitution}`);
    notices.append(node('br'), line);
  }
}
function renderView(data, objectName) {
  const tree = data?.tree;
  if (!tree) throw new TreeViewError('响应缺少 tree 档案', { code: 'INVALID_TREE_VIEW_RESPONSE' });
  $('#detail-empty').hidden = true;
  $('#detail-error').hidden = true;
  $('#tree-detail').hidden = false;
  renderTreeProfile(tree, objectName);
  const visibleStatus = renderStrategy(data);
  setStatus(visibleStatus, visibleStatus);
  const strategy = visibleStatus === 'available' ? data.strategy : null;
  $('#strategy-source').textContent = strategy ? strategySource(strategy, data.run) : statusLabel(data.strategyStatus ?? data.status);
  renderProvenance(data, strategy);
  $('#raw-json').textContent = JSON.stringify(data, null, 2);
  resetExpiryTimer();
  if (visibleStatus === 'available' && data.strategy?.expiresAt) {
    const delay = Date.parse(data.strategy.expiresAt) - Date.now();
    if (Number.isFinite(delay) && delay > 0) {
      state.expiryTimer = setTimeout(() => {
        if (state.selectedTreeId) loadTree(state.selectedTreeId, { refreshAfterExpiry: true });
      }, Math.min(delay + 50, 2_147_000_000));
    }
  }
}
function showRequestError(error) {
  $('#detail-empty').hidden = true;
  $('#tree-detail').hidden = true;
  $('#detail-error').hidden = false;
  $('#detail-error-message').textContent = error instanceof TreeViewError ? error.message : '读取树视图失败';
  $('#detail-error-code').textContent = error instanceof TreeViewError ? `${error.code}${error.status ? ` · HTTP ${error.status}` : ''}` : '';
  setStatus('failed', 'failed');
}
async function loadTree(treeId, { refreshAfterExpiry = false } = {}) {
  state.selectedTreeId = treeId;
  state.requestSerial += 1;
  const serial = state.requestSerial;
  abortCurrentRequest();
  resetExpiryTimer();
  state.controller = new AbortController();
  selectActiveButton(treeId);
  $('#detail-title').textContent = `${treeId} · 读取中`;
  $('#tree-detail').hidden = true;
  $('#detail-error').hidden = true;
  $('#detail-empty').hidden = true;
  setStatus(refreshAfterExpiry ? 'pending' : 'running', refreshAfterExpiry ? 'pending' : 'running');
  setBusy(true);
  try {
    const data = await client.readTree({ treeId, kind: 'tapping_angle', dataMode: 'mixed_demo', signal: state.controller.signal });
    if (serial !== state.requestSerial || treeId !== state.selectedTreeId) return;
    renderView(data, treeObjectName(treeId));
    setConnection('服务已连接', 'success');
  } catch (error) {
    if (serial !== state.requestSerial || treeId !== state.selectedTreeId) return;
    if (error?.code === 'ABORTED') return;
    showRequestError(error);
    setConnection('读取失败', 'error');
  } finally {
    if (serial === state.requestSerial) {
      state.controller = null;
      setBusy(false);
    }
  }
}
function selectTree(treeId) {
  if (!manifestItem(treeId)) return;
  loadTree(treeId);
}
async function loadManifest() {
  $('#manifest-error').hidden = true;
  $('#tree-list').setAttribute('aria-busy', 'true');
  try {
    const result = await client.readManifest();
    renderManifest(result.items);
    if (!state.manifest.length) throw new TreeViewError('manifest 没有树项目', { code: 'EMPTY_MANIFEST' });
    setConnection('服务已连接', 'success');
  } catch (error) {
    renderManifest([]);
    showManifestError(error);
  } finally {
    $('#tree-list').setAttribute('aria-busy', 'false');
  }
}
$('#retry-button').addEventListener('click', () => { if (state.selectedTreeId) loadTree(state.selectedTreeId); });
$('#token-form').addEventListener('submit', event => {
  event.preventDefault();
  client.setToken($('#token-input').value);
  loadManifest().then(() => { if (state.selectedTreeId) loadTree(state.selectedTreeId); });
});
$('#clear-token').addEventListener('click', () => {
  $('#token-input').value = '';
  client.clearToken();
  loadManifest().then(() => { if (state.selectedTreeId) loadTree(state.selectedTreeId); });
});
loadManifest();
