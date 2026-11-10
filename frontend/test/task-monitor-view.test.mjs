import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { transformWithOxc, parseAst } from 'vite';
import * as model from '../src/workspace/model.ts';
import * as flow from '../src/workspace/taskFlow.ts';
import {makeDemoTasks} from '../../backend/src/adapters/demo-tasks.js';

const epoch = Date.parse('2026-10-18T02:00:00Z');
const stub = () => null;
const icons = new Proxy({}, { get: () => stub });
const Modal = ({ children }) => children;

async function compile(file) {
  const source = readFileSync(new URL(`../src/workspace/${file}`, import.meta.url), 'utf8');
  const { code } = await transformWithOxc(source, file, { lang: 'tsx', jsx: { runtime: 'classic' } });
  const ast = parseAst(code);
  return {
    imports: ast.body.filter(node => node.type === 'ImportDeclaration'),
    declarations: ast.body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n'),
  };
}
const monitorSource = await compile('TaskArrange.tsx');
const incidentSource = await compile('SurfaceIncidentView.tsx');

function bind(source, modules, result) {
  const bindings = { React };
  for (const declaration of source.imports) for (const specifier of declaration.specifiers) {
    const module = modules[declaration.source.value];
    assert.ok(module, `Missing component dependency ${declaration.source.value}`);
    bindings[specifier.local.name] = module[specifier.imported?.name ?? 'default'];
    assert.notEqual(bindings[specifier.local.name], undefined, `Missing binding ${specifier.local.name}`);
  }
  return new Function(...Object.keys(bindings), source.declarations + `;return ${result};`)(...Object.values(bindings));
}
const incident = bind(incidentSource, { 'lucide-react': icons, './Modal': { Modal }, './model': model, './taskFlow': flow }, '{SurfaceIncidentView,incidentResult}');

function task(phase = 'running', overrides = {}) {
  return {
    id: 'JOB-monitor', site: 'hainan', title: 'A区割胶', block: 'A', robot: 'Robot 01', start: '08:00', end: '09:00',
    kind: '割胶', count: 3, done: 0, status: '执行中', treeIndices: [0, 1, 2],
    dispatch: { phase, requestId: 'request-monitor', history: [{ time: '2026-10-18T01:00:00Z', label: '原始记录' }] }, ...overrides,
  };
}
function reviewTask(overrides = {}) {
  const value = task('review', { status: '待处理', ...overrides });
  value.dispatch.incident = { treeIndex: 0, detectedAt: '2026-10-18T01:00:00Z', lastCaptureAt: '2026-10-18T01:00:00Z', status: 'review', category: '结构隆起', captures: 1 };
  return value;
}
function walk(element, predicate) {
  if (!React.isValidElement(element)) return [];
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  return React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join('') : '';
}
function buttons(element, label) { return walk(element, node => node.type === 'button' && text(node) === label); }
function findButton(element, label) {
  const found = buttons(element, label);
  assert.equal(found.length, 1, `Expected one ${label} button`);
  return found[0];
}
function atClock(callback) {
  const old = Date.now;
  try { Date.now = () => epoch; return callback(); } finally { Date.now = old; }
}

/** The real monitor and incident components; only React scheduling and icons are replaced. */
function harness(initial, overrides = {}) {
  let cursor = 0, dirty = false, element, effects = [];
  const slots = [], calls = { updates: [], closes: 0, trees: [], portals: [] };
  const props = {
    task: initial,
    onUpdate(next) { calls.updates.push(next); props.task = next; },
    onClose() { calls.closes++; }, onTree(index) { calls.trees.push(index); }, ...overrides,
  };
  const hooks = {
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(slots[index].value, value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index]?.deps;
      if (!previous || previous.length !== deps.length || previous.some((value, i) => !Object.is(value, deps[i]))) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const component = bind(monitorSource, { react: hooks, 'react-dom': {createPortal(child,host){calls.portals.push(host);return child;}}, 'lucide-react': icons, './model': model, './taskFlow': flow, './SurfaceIncidentView': incident }, 'TaskMonitor');
  function render() {
    return atClock(() => {
      let attempts = 0;
      do {
        assert.ok(attempts++ < 10, 'State and effects should settle');
        cursor = 0; dirty = false; effects = [];
        element = component(props);
        for (const effect of effects) effect();
      } while (dirty);
      return element;
    });
  }
  const h = {
    props, calls, render,
    get element() { return element; },
    button(label) { return findButton(element, label); },
    click(label) {
      const button = h.button(label);
      assert.equal(Boolean(button.props.disabled), false, `${label} should be enabled`);
      atClock(() => button.props.onClick()); render();
    },
    surface() {
      const child = walk(element, node => node.type === incident.SurfaceIncidentView);
      assert.equal(child.length, 1);
      return { props: child[0].props, element: incident.SurfaceIncidentView(child[0].props) };
    },
  };
  render(); return h;
}

test('read-only task viewing keeps progress and anomaly records without offering execution controls', () => {
  for(const phase of ['running','paused','failed']){
    const h=harness(task(phase),{embedded:true,readOnly:true});
    h.click('作业详情');
    assert.doesNotMatch(walk(h.element,node=>node.type==='button').map(text).join('|'),/开始模拟作业|暂停|继续模拟作业|重试模拟作业|取消剩余作业/);
    assert.match(text(h.element),/已割 0 \/ 3 棵/);
    assert.equal(h.calls.updates.length,0);
  }
  const h=harness(reviewTask(),{embedded:true,readOnly:true});h.click('查看异常记录');
  assert.equal(h.surface().props.readOnlyReason,'当前身份仅查看作业记录。');
  assert.equal(h.calls.updates.length,0);
});

for (const phase of ['waiting', 'scheduled', 'running', 'review', 'recapturing', 'pause-requested', 'paused', 'resume-requested', 'cancel-requested', 'failed']) {
  test(`viewing a legacy ${phase} task never starts or writes the demo`, () => {
    const original = task(phase), before = structuredClone(original), h = harness(original);
    h.render(); h.click('作业详情');
    assert.deepEqual(original, before);
    assert.deepEqual(h.calls.updates, []);
    assert.match(text(h.element), /模拟任务，等待启动/);
    assert.doesNotMatch(text(h.element), /自动执行中/);
    assert.equal(buttons(h.element, '启用自动演示').length, 1);
  });
}

test('explicitly enabling the demo adds one clock and one history entry without changing the task', () => {
  const original = reviewTask(), before = structuredClone(original), h = harness(original);
  const click = h.button('启用自动演示').props.onClick;
  atClock(() => { click(); click(); });
  h.render(); atClock(click);
  assert.equal(h.calls.updates.length, 1);
  const updated = h.calls.updates[0];
  assert.deepEqual(original, before, 'The historical record must not be mutated in place');
  assert.deepEqual(updated.dispatch.auto, { stage: 'travel', startedAt: epoch, nextAt: epoch + 1000 });
  assert.deepEqual(updated.dispatch.history.slice(0, -1), original.dispatch.history);
  assert.equal(updated.dispatch.history.at(-1).time, new Date(epoch).toISOString());
  assert.match(updated.dispatch.history.at(-1).label, /手动启用自动演示/);
  assert.deepEqual({ ...updated, dispatch: { ...updated.dispatch, auto: undefined, history: original.dispatch.history } }, { ...original, dispatch: { ...original.dispatch, auto: undefined } });
  assert.equal(buttons(h.element, '启用自动演示').length, 0);
});

test('the pending demo plan is adopted by the explicit start button before playback',()=>{
 const original=makeDemoTasks(new Date(epoch)).find(task=>task.site==='hainan'&&task.block==='A');
 const h=harness(original);
 assert.deepEqual(h.calls.updates,[]);
 h.click('采用策略并开始演示');
 assert.equal(h.props.task.demoStrategy.adoptedAt,new Date(epoch).toISOString());
 assert.equal(h.props.task.demoStrategy.adoptedBy,'演示管理员');
 assert.equal(h.props.task.demoStrategy.strategyId,original.demoStrategy.strategyId);
 assert.equal(h.props.task.dispatch.auto.nextAt,epoch+1000);
 assert.equal(h.props.task.done,0);
 assert.deepEqual(h.props.task.demoReceipts,[]);
 assert.equal(original.demoStrategy.adoptedAt,null);
});

for (const phase of ['paused', 'review', 'failed']) test(`enabling the clock preserves the ${phase} hold until an explicit decision`, () => {
  const h = harness(phase === 'review' ? reviewTask() : task(phase, { status: '待处理' }));
  h.click('启用自动演示');
  assert.equal(h.props.task.dispatch.phase, phase);
  assert.equal(h.props.task.status, '待处理');
  assert.equal(flow.advanceDemo(h.props.task, epoch + 5000), h.props.task);
});

for (const [status, phase] of [['已完成', 'running'], ['已取消', 'review'], ['执行中', 'completed'], ['待处理', 'cancelled']]) {
  test(`terminal ${status}/${phase} records cannot enable automatic work`, () => {
    const h = harness(task(phase, { status }));
    assert.equal(buttons(h.element, '启用自动演示').length, 0);
    assert.equal(buttons(h.element, '暂停').length, 0);
    assert.equal(buttons(h.element, '继续作业').length, 0);
    assert.equal(buttons(h.element, '取消剩余作业').length, 0);
    assert.deepEqual(h.calls.updates, []);
    assert.match(text(h.element), status === '已取消' || phase === 'cancelled' ? /剩余作业已取消/ : /本次割胶已完成/);
  });
}

for (const [phase, label, nextPhase] of [['running', '暂停', 'pause-requested'], ['paused', '继续作业', 'resume-requested'], ['failed', '重试', 'waiting']]) {
  test(`${label} waits for explicit clock enablement and then retains the original command`, () => {
    const h = harness(task(phase, { status: phase === 'running' ? '执行中' : '待处理' }));
    assert.equal(h.button(label).props.disabled, true);
    h.button(label).props.onClick();
    assert.deepEqual(h.calls.updates, [], 'The disabled command is also guarded at its handler');
    h.click('启用自动演示'); h.click(label);
    assert.equal(h.props.task.dispatch.phase, nextPhase);
    assert.equal(h.props.task.dispatch.auto.nextAt, epoch + 650);
  });
}

test('existing automatic tasks remain read-only on mount and keep pause and cancel controls', () => {
  const value = task(); value.dispatch.auto = { stage: 'work', startedAt: epoch - 2000, nextAt: epoch + 500 };
  const h = harness(value);
  assert.equal(buttons(h.element, '启用自动演示').length, 0);
  assert.deepEqual(h.calls.updates, []);
  h.click('作业详情'); h.click('取消剩余作业'); h.click('确认取消');
  assert.equal(h.props.task.dispatch.phase, 'cancel-requested');
  assert.equal(h.props.task.dispatch.auto.stage, 'work');
  assert.equal(h.props.task.dispatch.auto.nextAt, epoch + 650);
});

test('cancellation is disabled before clock enablement and cannot strand a task awaiting an acknowledgement', () => {
  const h = harness(task()); h.click('作业详情');
  assert.equal(h.button('取消剩余作业').props.disabled, true);
  h.button('取消剩余作业').props.onClick(); h.render();
  assert.equal(h.button('确认取消').props.disabled, true);
  h.button('确认取消').props.onClick();
  assert.deepEqual(h.calls.updates, []);
});

test('a retained enable button cannot overwrite a newer completed task', () => {
  const h = harness(task()), click = h.button('启用自动演示').props.onClick;
  h.props.task = { ...h.props.task, status: '已完成' }; h.render();
  atClock(click);
  assert.deepEqual(h.calls.updates, []);
});

test('a retained automatic command cannot overwrite a newer task snapshot', () => {
  const value = task(); value.dispatch.auto = { stage: 'work', startedAt: epoch, nextAt: epoch + 1000 };
  const h = harness(value), click = h.button('暂停').props.onClick;
  h.props.task = { ...h.props.task, status: '已取消' }; h.render();
  atClock(click);
  assert.deepEqual(h.calls.updates, []);
});

for (const closed of [false, true]) test(`incident records remain viewable but cannot change a ${closed ? 'closed' : 'clockless'} monitor task`, () => {
  const h = harness(reviewTask(closed ? { status: '已完成' } : {}));
  h.click(closed ? '查看异常处理记录' : '查看异常记录');
  const surface = h.surface();
  assert.match(text(surface.element), closed ? /本任务已结束/ : /请先关闭记录并启用自动演示/);
  for (const label of ['采用模拟避让方案', '生成模拟补拍记录', '跳过这棵，继续其余作业 →']) {
    const action = findButton(surface.element, label);
    assert.equal(action.props.disabled, true);
    action.props.onClick();
  }
  assert.deepEqual(h.calls.updates, []);
  assert.equal(h.surface().props.task, h.props.task, 'The read-only view must preserve the actual phase and evidence');
});

test('incident handling resumes its existing explicit behavior after the user enables the demo', () => {
  const h = harness(reviewTask()); h.click('启用自动演示'); h.click('处理树表异常');
  const surface = h.surface(), action = findButton(surface.element, '采用模拟避让方案');
  assert.equal(action.props.disabled, false);
  action.props.onClick(); h.render();
  assert.equal(h.props.task.dispatch.phase, 'running');
  assert.equal(h.props.task.dispatch.incident.status, 'adopted');
  assert.equal(h.props.task.dispatch.auto.stage, 'work');
});

test('the standalone incident view keeps its original behavior without the optional monitor restriction', () => {
  const updates = [], value = reviewTask();
  const element = incident.SurfaceIncidentView({ task: value, onUpdate: next => updates.push(next), onClose() {} });
  findButton(element, '生成模拟补拍记录').props.onClick();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].dispatch.phase, 'recapturing');
});
test('weather-blocked incident exposes a clearly labelled simulation switch without enabling the action itself',()=>{
 const calls=[], value=reviewTask();
 const element=incident.SurfaceIncidentView({task:value,onUpdate:()=>{},onClose(){},readOnlyReason:'天气暂缓',demoWeather:false,onDemoWeatherChange:next=>calls.push(next)});
 const controls=walk(element,node=>node.type==='input'&&node.props.type==='checkbox');
 assert.equal(controls.length,1);assert.match(text(element),/演示天气：模拟适合作业/);assert.match(text(element),/仅供当前标签页模拟任务/);
 assert.equal(findButton(element,'采用模拟避让方案').props.disabled,true);
 controls[0].props.onChange({target:{checked:true}});assert.deepEqual(calls,[true]);
});
test('demo weather allows the blocked incident decision and simulated receipt, then restores the weather hold when turned off',async()=>{
 const appSource=readFileSync(new URL('../src/workspace/WorkspaceApp.tsx',import.meta.url),'utf8');
 const {code:appCode}=await transformWithOxc(appSource,'WorkspaceApp.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
 const app=parseAst(appCode).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).find(n=>n?.type==='FunctionDeclaration'&&n.id.name==='WorkspaceApp');
 const gate=app.body.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]).find(n=>n.id.name==='executionHold');
 const toggle={current:false},fleet={ready:true,zones:[{active:null,queue:[]}]};
 const hold=new Function('demoWeatherRef','getFleetSnapshot','taskExecutionBlock','siteWeatherBlock',`return (${appCode.slice(gate.init.start,gate.init.end)});`)(toggle,()=>fleet,()=>undefined,()=> '天气暂缓');
 const value=reviewTask();value.dispatch.auto={stage:'work',startedAt:epoch,nextAt:epoch+2500};
 value.demoStrategy=makeDemoTasks(new Date(epoch)).find(task=>task.site==='hainan'&&task.block==='A').demoStrategy;
 const h=harness(value,{demoWeather:false,executionIssue:hold(value),onDemoWeatherChange:enabled=>{toggle.current=enabled;h.props.demoWeather=enabled;h.props.executionIssue=hold(h.props.task);}});
 h.click('查看异常记录');let surface=h.surface();
 assert.equal(findButton(surface.element,'采用模拟避让方案').props.disabled,true);
 walk(surface.element,n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});h.render();
 surface=h.surface();assert.equal(findButton(surface.element,'采用模拟避让方案').props.disabled,false);
 atClock(()=>findButton(surface.element,'采用模拟避让方案').props.onClick());h.render();
 assert.equal(h.props.task.dispatch.phase,'running');assert.equal(h.props.task.dispatch.incident.status,'adopted');
 const completed=flow.advanceDemo(h.props.task,epoch+2500,Boolean(hold(h.props.task)));
 assert.equal(completed.done,1);assert.equal(completed.dispatch.incident.status,'completed');assert.equal(completed.demoReceipts[0].outcome,'completed');
 toggle.current=false;assert.equal(hold(completed),'天气暂缓');
 const held=flow.advanceDemo(completed,epoch+10000,Boolean(hold(completed)));assert.equal(held.done,1);
});


for(const [site,prefix] of [['xsbn','XS'],['xian','XA']])test(`${site} task monitor uses its own tree aliases in progress and completion views`,()=>{
 const running=harness(reviewTask({site}));
 assert.match(text(running.element),new RegExp(`${prefix}-A-0001`));
 assert.doesNotMatch(text(running.element),/HN-A-0001/);
 const original=reviewTask({site,status:'已完成',done:3});
 original.dispatch.phase='completed';original.dispatch.incident.status='completed';
 const finished=harness(original);
 assert.match(text(finished.element),new RegExp(`${prefix}-A-0001`));
 assert.match(text(finished.element),/模拟避让作业已完成 · 无真实设备回执/);
 assert.doesNotMatch(text(finished.element),/HN-A-0001|等待模拟执行/);
});

test('an event-held monitor presents suspended work and still accepts a separate manual pause', () => {
  const value = task();value.dispatch.auto = {stage: 'work', startedAt: epoch - 2000, nextAt: epoch + 500, eventHeldAt: epoch - 3600000};
  const h = harness(value);h.props.holdReason = 'A区降雨已解除，待确认恢复';h.render();
  assert.match(text(h.element), /事件暂缓/);assert.match(text(h.element), /等待解除并确认恢复/);
  assert.doesNotMatch(text(h.element), /正在割胶|自动执行中/);
  h.click('暂停');
  assert.equal(h.props.task.dispatch.phase, 'pause-requested');assert.equal(h.props.task.status, '待处理');
  assert.equal(h.props.task.done, 0);assert.equal(h.props.task.dispatch.auto.nextAt, epoch + 650);
  const acknowledged = flow.advanceDemo(h.props.task, epoch + 650, true);
  assert.equal(acknowledged.dispatch.phase, 'paused');assert.equal(acknowledged.done, 0);
  h.props.task = acknowledged;h.render();
  assert.equal(h.button('继续作业').props.disabled, true);
  h.props.holdReason = null;h.render();
  assert.equal(h.props.task.dispatch.phase, 'paused', 'event recovery does not release the user pause');
  assert.equal(Boolean(h.button('继续作业').props.disabled), false);
});

for (const [phase, label] of [['paused', '继续作业'], ['failed', '重试']]) test(`event influence disables ${label} in both the monitor UI and its handler`, () => {
  const value = task(phase, {status: '待处理'});value.dispatch.auto = {stage: 'work', startedAt: epoch, nextAt: epoch + 500};
  const h = harness(value);h.props.holdReason = 'R-A故障影响中';h.render();
  assert.equal(h.button(label).props.disabled, true);
  h.button(label).props.onClick();
  assert.deepEqual(h.calls.updates, []);assert.equal(h.props.task.dispatch.phase, phase);
});

test('event influence prevents enabling a legacy demo while preserving its original task', () => {
  const value = task(), before = structuredClone(value), h = harness(value);
  h.props.holdReason = 'A区降雨影响中';h.render();
  assert.equal(h.button('启用自动演示').props.disabled, true);
  h.button('启用自动演示').props.onClick();
  assert.deepEqual(h.calls.updates, []);assert.deepEqual(value, before);
});

test('an event-held automatic task can still cancel its remaining work', () => {
  const value = task();value.dispatch.auto = {stage: 'work', startedAt: epoch - 1000, nextAt: epoch + 500, eventHeldAt: epoch - 500};
  const h = harness(value);h.props.holdReason = 'R-A故障影响中';h.render();
  h.click('作业详情');h.click('取消剩余作业');h.click('确认取消');
  assert.equal(h.props.task.dispatch.phase, 'cancel-requested');assert.equal(h.props.task.done, 0);
  const acknowledged = flow.advanceDemo(h.props.task, epoch + 650, true);
  assert.equal(acknowledged.dispatch.phase, 'cancelled');assert.equal(acknowledged.status, '已取消');assert.equal(acknowledged.done, 0);
});

test('incident evidence stays viewable during an event but cannot adopt, recapture or skip', () => {
  const value = reviewTask();value.dispatch.auto = {stage: 'work', startedAt: epoch, nextAt: epoch + 500};
  const before = structuredClone(value), h = harness(value);
  h.props.holdReason = 'A区降雨已解除，待确认恢复';h.render();h.click('查看异常记录');
  const surface = h.surface();
  assert.match(text(surface.element), /A区降雨已解除，待确认恢复/);
  for (const label of ['采用模拟避让方案', '生成模拟补拍记录', '跳过这棵，继续其余作业 →']) {
    const action = findButton(surface.element, label);assert.equal(action.props.disabled, true);action.props.onClick();
  }
  surface.props.onUpdate(flow.resolveSurface(value, 'adopt', epoch));
  assert.deepEqual(h.calls.updates, []);assert.deepEqual(value, before);
});


for(const [phase,label,nextPhase] of [['paused','继续模拟作业','resume-requested'],['failed','重试模拟作业','waiting']])test(`embedded ${phase} uses one explicit command and retains the transition acknowledgement`,()=>{
 const h=harness(task(phase,{status:'待处理'}),{embedded:true});
 assert.equal(buttons(h.element,'启用自动演示').length,0);
 assert.deepEqual(h.calls.updates,[]);
 h.click(label);
 assert.equal(h.calls.updates.length,1);
 assert.equal(h.props.task.dispatch.phase,nextPhase);
 assert.ok(h.props.task.dispatch.auto);
 assert.equal(h.props.task.done,0);
});

test('embedded anomaly handling enables only the clock and still requires a human decision',()=>{
 const h=harness(reviewTask(),{embedded:true});
 h.click('处理模拟异常');
 assert.equal(h.props.task.dispatch.phase,'review');
 assert.equal(h.props.task.dispatch.incident.status,'review');
 assert.equal(h.props.task.done,0);
 assert.ok(h.props.task.dispatch.auto);
 assert.equal(h.surface().props.readOnlyReason,undefined);
});

for(const field of ['holdReason','executionIssue'])test(`embedded actions retain the ${field} guard even when a disabled handler is called`,()=>{
 for(const [phase,label] of [['paused','继续模拟作业'],['failed','重试模拟作业'],['review','处理模拟异常'],['scheduled','开始模拟作业']]){
  const h=harness(phase==='review'?reviewTask():task(phase),{embedded:true,[field]:'需处理当前条件'});
  assert.equal(h.button(label).props.disabled,true);
  h.button(label).props.onClick();
  assert.deepEqual(h.calls.updates,[]);
 }
});

for(const source of ['sourceParkPlanId','sourceScenarioId'])test(`an adopted production source ${source} starts without asking the user to adopt again`,()=>{
 const original=makeDemoTasks(new Date(epoch)).find(value=>value.site==='hainan'&&value.block==='A');
 const h=harness({...original,[source]:'accepted-plan'},{embedded:true});
 assert.equal(buttons(h.element,'采用并开始模拟作业').length,0);
 h.click('开始模拟作业');
 assert.equal(h.calls.updates.length,1);
 assert.equal(h.props.task.demoStrategy.adoptedAt,new Date(epoch).toISOString());
 assert.deepEqual(h.props.task.demoReceipts,[]);
});

test('embedded finished work shows its result without a mandatory return action',()=>{
 const h=harness(task('completed',{status:'已完成',done:3}),{embedded:true});
 assert.match(text(h.element),/本次割胶已完成/);
 assert.equal(buttons(h.element,'完成，返回总览').length,0);
 assert.equal(buttons(h.element,'返回总览').length,0);
 assert.deepEqual(h.calls.updates,[]);
});

test('the monitor keeps one tree list, one execution log and an optional scene entry in active and finished views',()=>{
 for(const phase of ['running','completed']){
  let scenes=0;
  const h=harness(task(phase,{status:phase==='completed'?'已完成':'执行中'}),{embedded:true,sessionNotes:['已调整模拟排程'],onOpenScene(){scenes++;}});
  if(phase==='running')h.click('作业详情');
  assert.equal(walk(h.element,node=>node.type==='summary'&&text(node)==='执行记录').length,1);
  assert.equal(walk(h.element,node=>node.type==='summary'&&text(node).startsWith('本次树木')).length,1);
  assert.match(text(h.element),/已调整模拟排程/);
  assert.equal(scenes,0);
  h.click('查看三维场景');
  assert.equal(scenes,1);
  const treeButton=walk(h.element,node=>node.type==='button'&&text(node).includes(model.treeAlias(0,h.props.task.site)))[0];
  assert.ok(treeButton);
  treeButton.props.onClick();
  assert.deepEqual(h.calls.trees,[0]);
 }
});

test('an embedded incident dialog uses the app overlay host and remains open until a human closes it',()=>{
 const prior=globalThis.document,host={id:'workspace-overlay-host'};
 globalThis.document={querySelector(selector){assert.equal(selector,'.workspace-app');return host;}};
 try{
  const h=harness(reviewTask(),{embedded:true});
  h.click('处理模拟异常');
  assert.equal(h.calls.portals.at(-1),host);
  assert.equal(h.props.task.dispatch.phase,'review');
  h.surface().props.onClose();h.render();
  assert.equal(walk(h.element,node=>node.type===incident.SurfaceIncidentView).length,0);
  assert.equal(h.props.task.dispatch.phase,'review');
 }finally{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}
});
