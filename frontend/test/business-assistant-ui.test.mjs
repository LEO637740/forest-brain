import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst,transformWithOxc} from 'vite';
import {sites} from '../src/workspace/model.ts';
import {roleViews,treePosition} from '../src/workspace/workbenchModel.ts';

async function declarations(path) {
  const source = readFileSync(new URL(`../src/${path}`,import.meta.url),'utf8');
  const {code} = await transformWithOxc(source,path,{lang:path.endsWith('tsx')?'tsx':'ts',jsx:{runtime:'classic'}});
  return parseAst(code).body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
}
const clientCode = await declarations('integration/assistantClient.ts');
const componentCode = await declarations('workspace/BusinessAssistant.tsx');
const clientFunctions = new Function('post','read',`${clientCode};return {assistantApi,assistantAnswerParts,assistantIsRunning,assistantScopeQuery,assistantSelectionKey,assistantSessionPath,mergeAssistantTurn};`);
const stub = () => null;
const at = '2026-10-20T02:00:00Z';
const turn = (patch = {}) => ({
  turnId:'turn-1',message:'今天怎么安排？',mode:'demo',status:'completed',answer:'先完成 A 区剩余任务，再安排收胶。',
  tools:[],actions:[],memoriesUsed:[],createdAt:at,...patch,
});
const session = (id = 'session-1',turns = [],siteId = 'demo-hainan',role = 'manager') => ({
  sessionId:id,siteId,role,title:id,createdAt:at,updatedAt:at,turns,
});
function walk(element,predicate) {
  if (!React.isValidElement(element)) return [];
  if (typeof element.type === 'function') return walk(element.type(element.props),predicate);
  return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child => walk(child,predicate))];
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  if (!React.isValidElement(element)) return '';
  if (typeof element.type === 'function') return text(element.type(element.props));
  return React.Children.toArray(element.props.children).map(text).join('');
}
const named = (element,label) => walk(element,node => node.props['aria-label'] === label)[0];
const button = (element,label) => walk(element,node => node.type === 'button' && text(node) === label)[0];
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const records = options.sessions ?? [session()];
  const storage = options.storage ?? new Map();
  const requests = [],posts = [],reloads = [],navigation = [],tasksOpened = [],strategies = [],markets = [],events = [];
  const responses = new Map([
    ['/api/assistant/status',{configured:true,model:'test-model',paused:false}],
    [`/api/assistant/sessions?siteId=demo-${options.site??'hainan'}&role=${options.role??'manager'}`,{items:records}],
    [`/api/assistant/memories?siteId=demo-${options.site??'hainan'}&role=${options.role??'manager'}`,{items:[]}],
    ...records.map(record => [`/api/assistant/sessions/${record.sessionId}`,record]),
  ]);
  for (const [path,value] of options.responses ?? []) responses.set(path,value);
  const helpers = clientFunctions(async (path,input) => {
    posts.push({path,input});
    if (options.post) return options.post(path,input);
    if (path === '/api/assistant/sessions') {
      const created = session('created',[],input.siteId,input.role);
      records.unshift(created);
      responses.set('/api/assistant/sessions/created',created);
      return created;
    }
    return turn({turnId:'submitted',message:input.message,mode:input.mode,status:'queued',answer:undefined});
  },async path => responses.get(path));
  const slots = [],effects = [];
  let cursor = 0,dirty = false,effectQueue = [],element;
  const bindings = {TurnHarness:()=>null,TurnInvestigation:()=>null,
    React,ArrowRight:stub,MessageSquare:stub,Plus:stub,Send:stub,sites,roleViews,treePosition,...helpers,
    currentAccount:()=>({accountId:options.accountId??'test-account'}),
    window:{dispatchEvent:event=>events.push(event)},
    CustomEvent,
    siteIdOf:site => `demo-${site}`,
    localStorage:{getItem:key => storage.get(key)??null,setItem:(key,value) => storage.set(key,value)},
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function'?initial():initial;
      return [slots[index],next => {const value = typeof next === 'function'?next(slots[index]):next;if(value!==slots[index]){slots[index]=value;dirty=true;}}];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = {current:initial};
      return slots[index];
    },
    useEffect(callback,deps) {
      const index = cursor++;
      if (!effects[index] || deps.some((value,i) => value !== effects[index][i])) {
        effects[index] = deps;
        effectQueue.push(callback);
      }
    },
    useRead(path,config) {
      requests.push({path,config});
      return {data:path?responses.get(path):undefined,reload:() => reloads.push(path)};
    },
  };
  Object.assign(bindings,{AssistantVoiceInput:()=>null,AssistantOperation:()=>null,ArrowUp:()=>null});
  const Component = new Function(...Object.keys(bindings),`${componentCode};return BusinessAssistant;`)(...Object.values(bindings));
  const props = {
    site:options.site??'hainan',role:options.role??'manager',zone:options.zone??null,
    tasks:options.tasks??[],onTask:task => tasksOpened.push(task),onNavigate:(...args) => navigation.push(args),
    onMarket:(...args) => markets.push(args),
    onStrategy:(...args) => strategies.push(args),
  };
  const render = (patch = {}) => {
    Object.assign(props,patch);
    let iterations = 0;
    do {
      dirty=false;cursor=0;effectQueue=[];
      element=Component(props);
      effectQueue.forEach(callback => callback());
      assert.ok(++iterations < 15,'component should settle after state updates');
    } while(dirty);
    return element;
  };
  render();
  return {render,requests,posts,reloads,navigation,tasksOpened,strategies,markets,events,responses,storage,get element(){return element;}};
}

test('an earlier whole-park action keeps its saved plan ID after a newer scenario is discussed',()=>{
  const h=harness({sessions:[session('history',[
    turn({turnId:'baseline',actions:[{type:'park_plan',planId:'park-plan-baseline',label:'查看基线全园方案'}]}),
    turn({turnId:'typhoon',actions:[{type:'park_plan',planId:'park-plan-typhoon',label:'查看台风全园方案'}]}),
  ])]});
  const opened=[];
  h.render({onBrainAction:(...args)=>opened.push(args)});
  button(h.element,'查看基线全园方案').props.onClick();
  button(h.element,'查看台风全园方案').props.onClick();
  assert.deepEqual(opened,[['park_plan','park-plan-baseline'],['park_plan','park-plan-typhoon']]);
});

test('assistant quick questions match each role and operators do not receive sales prompts',()=>{
  for(const [role,expected] of [
    ['grower',['胶价与收胶点','哪些树要照看','今天割不割','产胶与收益']],
    ['manager',['今日生产安排','本周割几次','库存怎么卖','收胶储运进度']],
    ['operator',['设备异常','执行队列','天气调整','回执复盘']],
    ['executive',['园区重点问题','生产经营分析','执行复盘','小脑参数复盘']],
  ]){
    const page=harness({role});
    const groups=walk(page.element,node=>node.props.className==='ba-quick');
    assert.deepEqual(groups.flatMap(group=>walk(group,node=>node.type==='button').map(text)),expected);
    if(role==='operator')assert.doesNotMatch(groups.map(text).join(''),/销售|交易|库存|收胶/);
  }
});

test('first question creates a scoped session and defaults to the configured model',async () => {
  const h = harness({sessions:[],site:'maoming',role:'operator',zone:'B'});
  assert.equal(named(h.element,'业务助手分析方式').props.value,'configured');
  button(h.element,'设备异常').props.onClick();
  await settle();h.render();
  assert.deepEqual(h.posts[0],{path:'/api/assistant/sessions',input:{siteId:'demo-maoming',role:'operator'}});
  assert.equal(h.posts[1].path,'/api/assistant/sessions/created/turns');
  assert.deepEqual(h.posts[1].input,{message:'查看当前园区的设备和天气异常，说明影响哪些机器人、任务，以及下一步怎么处理。',browsing:{treeId:null,zone:'B'},mode:'configured'});
  assert.match(text(h.element),/已提交，正在准备分析/);
  assert.equal(named(h.element,'业务问题').props.disabled,true);
  assert.equal(h.storage.get('harness-assistant-session:test-account:demo-maoming:operator'),'created');
});

test('a default whole-park question does not silently select the workbench first tree',async () => {
  const h = harness();
  named(h.element,'业务问题').props.onChange({target:{value:'查看 B 区未完成任务，给我今天的安排。'}});
  h.render();
  walk(h.element,node => node.type==='form')[0].props.onSubmit({preventDefault(){}});
  await settle();h.render();
  assert.deepEqual(h.posts[0].input,{message:'查看 B 区未完成任务，给我今天的安排。',browsing:{treeId:null,zone:null},mode:'configured'});
  assert.equal('treeId' in h.posts[0].input,false);
  assert.equal(h.posts[0].input.browsing.zone,null);
});

test('continuing from B to C does not resend an old workbench zone; a changed view supplies new context',async () => {
  const h = harness({zone:'B',post:async (_path,input) => turn({turnId:'turn-'+input.message,message:input.message})});
  const send = async message => {
    named(h.element,'业务问题').props.onChange({target:{value:message}});
    h.render();
    walk(h.element,node => node.type==='form')[0].props.onSubmit({preventDefault(){}});
    await settle();h.render();
  };
  await send('查看 B 区任务');
  assert.equal(h.posts[0].input.browsing.zone,'B');
  await send('改看 C 区，怎么安排？');
  assert.deepEqual(h.posts[1].input,{message:'改看 C 区，怎么安排？',browsing:{treeId:null,zone:'B'},mode:'configured'});
  h.render({zone:'D'});
  await send('这个分区今天怎么安排？');
  assert.equal(h.posts[2].input.browsing.zone,'D');
  h.render({zone:null});
  await send('再看一下整个园区。');
  assert.equal(h.posts[3].input.browsing.zone,null);
  assert.equal(h.posts.some(item => 'treeId' in item.input),false);
});

test('refresh restores only the selected account, park and role session',() => {
  const storage = new Map([
    ['harness-assistant-session:test-account:demo-hainan:manager','older'],
    ['harness-assistant-session:test-account:demo-xsbn:manager','foreign'],
    ['harness-assistant-session:test-account:demo-hainan:grower','grower-history'],
  ]);
  const manager = harness({storage,sessions:[session('latest'),session('older',[turn({answer:'海南原有安排'})])]});
  assert.equal(named(manager.element,'业务对话记录').props.value,'older');
  assert.match(text(manager.element),/海南原有安排/);
  const grower = harness({storage,role:'grower',sessions:[session('grower-history',[turn({answer:'胶农养护建议'})],'demo-hainan','grower')]});
  assert.match(text(grower.element),/胶农养护建议/);
  assert.doesNotMatch(text(grower.element),/海南原有安排/);
  const xsbn = harness({storage,site:'xsbn',sessions:[session('xsbn-new',[],'demo-xsbn')]});
  assert.equal(named(xsbn.element,'业务对话记录').props.value,'xsbn-new');
  assert.equal(xsbn.requests.some(item => item.path?.includes('/foreign')),false);
});

test('accounts sharing a role and park keep independent remembered conversations',()=>{
  const storage=new Map([
    ['harness-assistant-session:manager-a:demo-hainan:manager','a-older'],
    ['harness-assistant-session:manager-b:demo-hainan:manager','b-older'],
  ]);
  const first=harness({storage,accountId:'manager-a',sessions:[session('a-latest'),session('a-older')]});
  const second=harness({storage,accountId:'manager-b',sessions:[session('b-latest'),session('b-older')]});
  assert.equal(named(first.element,'业务对话记录').props.value,'a-older');
  assert.equal(named(second.element,'业务对话记录').props.value,'b-older');
  assert.equal(second.requests.some(item=>item.path?.includes('/a-older')),false);
});

test('a running persisted turn resumes polling after refresh and refreshes experience on completion',() => {
  const pending = turn({status:'running',answer:undefined});
  const progressPath = '/api/assistant/sessions/session-1/turns/turn-1';
  const h = harness({sessions:[session('session-1',[pending])],responses:[[progressPath,pending]]});
  assert.ok(h.requests.some(item => item.path===progressPath && item.config.pollMs===1000));
  assert.equal(button(h.element,'今日生产安排').props.disabled,true);
  const completed = turn({answer:'B 区改至下午，先完成 A 区。',memoriesUsed:[{id:'m-1',title:'B 区昨次降雨中断',scope:'park'}]});
  h.responses.set(progressPath,completed);
  h.render();
  assert.match(text(h.element),/B 区改至下午，先完成 A 区/);
  assert.match(text(h.element),/参考经验：B 区昨次降雨中断/);
  assert.ok(h.reloads.includes('/api/assistant/memories?siteId=demo-hainan&role=manager'));
  assert.ok(h.reloads.includes('/api/assistant/sessions/session-1'));
  assert.equal(button(h.element,'今日生产安排').props.disabled,false);
  assert.equal(h.requests.at(-1).path,null);
});

test('a failed send leaves the draft available for correction or retry',async () => {
  const h = harness({post:async () => {throw Error('模型暂不可用');}});
  named(h.element,'业务问题').props.onChange({target:{value:'B 区先不割，运输只安排一车。'}});
  h.render();
  walk(h.element,node => node.type==='form')[0].props.onSubmit({preventDefault(){}});
  await settle();h.render();
  assert.equal(named(h.element,'业务问题').props.value,'B 区先不割，运输只安排一车。');
  assert.match(text(h.element),/模型暂不可用/);
  assert.equal(named(h.element,'发送').props.disabled,false);
});

test('continuation uses the same session and the configured model without switching modes',async () => {
  const h = harness({sessions:[session('session-1',[turn()])],zone:'D'});
  named(h.element,'业务问题').props.onChange({target:{value:'运输只安排一车，重新计算。'}});
  h.render();
  walk(h.element,node => node.type==='form')[0].props.onSubmit({preventDefault(){}});
  await settle();h.render();
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].path,'/api/assistant/sessions/session-1/turns');
  assert.equal(h.posts[0].input.mode,'configured');
  assert.equal(h.posts[0].input.message,'运输只安排一车，重新计算。');
  assert.equal(walk(h.element,node => node.type==='details'&&text(node).startsWith('前 1 轮对话')).length,1);
});

test('answer actions open the selected park task, strategy and existing business pages',() => {
  const own={id:'shared',site:'hainan'},foreign={id:'shared',site:'xsbn'};
  const h = harness({tasks:[foreign,own],sessions:[session('session-1',[turn({actions:[
    {type:'task',taskId:'shared',label:'打开该任务'},
    {type:'market',modelId:'scenario',label:'查看生产与销售'},
    {type:'operations',label:'查看任务中心'},
    {type:'sales_shipments',label:'查看销售出货'},
    {type:'logistics',batchId:'processed-batch',label:'查看加工入库'},
    {type:'commodity_market',label:'查看橡胶交易资料'},
    {type:'tree_strategy',treeId:'T-0051',kind:'growth_plan',label:'查看单树养护'},
    {type:'review',treeId:'T-0051',kind:'capture',label:'打开单树补拍'},
  ]})])]});
  button(h.element,'打开该任务').props.onClick();
  button(h.element,'查看生产与销售').props.onClick();
  button(h.element,'查看任务中心').props.onClick();
  button(h.element,'查看单树养护').props.onClick();
  button(h.element,'查看销售出货').props.onClick();
  button(h.element,'查看加工入库').props.onClick();
  button(h.element,'查看橡胶交易资料').props.onClick();
  button(h.element,'打开单树补拍').props.onClick();
  assert.deepEqual(h.tasksOpened,[own]);
  assert.deepEqual(h.navigation,[['operations','hainan']]);
  assert.deepEqual(h.markets,[['hainan','scenario']]);
  assert.deepEqual(h.strategies,[['hainan',50,'growth_plan']]);
  assert.equal(h.events[0].type,'harness-open-sales-shipments');
  assert.deepEqual(h.events[0].detail,{site:'hainan'});
  assert.equal(h.events[1].type,'harness-open-logistics');
  assert.deepEqual(h.events[1].detail,{site:'hainan',id:'processed-batch'});
  assert.equal(h.events[2].type,'harness-open-commodity-market');
  assert.deepEqual(h.events[2].detail,{site:'hainan'});
  assert.equal(h.events[3].type,'harness-open-review');
  assert.deepEqual(h.events[3].detail,{siteId:'demo-hainan',treeId:'T-0051',kind:'capture'});
});

test('market actions in historical and current turns retain each saved model identity',() => {
  const h = harness({site:'guangdong-maoming',sessions:[session('session-1',[
    turn({turnId:'older',actions:[{type:'market',modelId:'market-old',label:'打开上一轮方案'}]}),
    turn({turnId:'newer',actions:[{type:'market',modelId:'market-new',label:'打开本轮方案'}]}),
  ],'demo-guangdong-maoming')]});
  button(h.element,'打开上一轮方案').props.onClick();
  button(h.element,'打开本轮方案').props.onClick();
  assert.deepEqual(h.markets,[['guangdong-maoming','market-old'],['guangdong-maoming','market-new']]);
});

test('the latest recommendation precedes folded details while earlier conversation stays folded',() => {
  const h = harness({sessions:[session('session-1',[turn({turnId:'older',answer:'旧安排'}),turn({answer:'今天优先 A 区，下午收胶。',tools:[
    {name:'tasks',label:'读取任务回执',summary:'B 区昨天完成 17 棵后暂停。',sourceRefs:['task:demo-hainan:17']},
  ]})])]});
  const latest = walk(h.element,node => node.type==='article' && text(node).includes('今天优先 A 区'))[0];
  const details = walk(latest,node => node.type==='details')[0];
  assert.notEqual(details.props.open,true);
  assert.ok(text(latest).indexOf('今天优先 A 区') < text(latest).indexOf('分析依据与工具记录'));
  const history = walk(h.element,node => node.type==='details' && node.props.className==='ba-history')[0];
  assert.notEqual(history.props.open,true);
  assert.match(text(history),/旧安排/);
});

test('a clear conclusion and next step remain visible while technical evidence and memory stay folded',() => {
  for (const separator of ['\n','\n\n']) {
    const h = harness({sessions:[session('session-1',[turn({
      mode:'configured',
      answer:`结论：今日 B 区割胶已完成 36 棵，可以登记收胶。${separator}下一步：打开今日 B 区任务，核对回执后登记收胶批次。\n\n依据：demo-task-2026-10-20-hainan-B 的 collection.canCollect=true，已收到 36 条回执。\n\n称重前尚无实际产胶重量。`,
      tools:[{name:'read_tasks',label:'读取任务安排',summary:'今日 B 区任务完成 36/36 棵。',sourceRefs:['demo-task-2026-10-20-hainan-B']}],
      memoriesUsed:[{id:'memory-1',title:'任务 HN-01 的执行经验',scope:'park'}],
      actions:[{type:'task',taskId:'demo-task-2026-10-20-hainan-B',label:'查看今日 B 区任务'}],
    })])]});
    const main = walk(h.element,node => node.props.className==='ba-answer')[0];
    assert.equal(text(walk(main,node => node.props.className==='ba-conclusion')[0]),'结论今日 B 区割胶已完成 36 棵，可以登记收胶。');
    assert.equal(text(walk(main,node => node.props.className==='ba-next-step')[0]),'下一步打开今日 B 区任务，核对回执后登记收胶批次。');
    assert.doesNotMatch(text(main),/canCollect|demo-task|HN-01|参考经验|已配置模型/);
    const details = walk(h.element,node => node.props.className==='ba-details')[0];
    assert.notEqual(details.props.open,true);
    assert.match(text(details),/collection\.canCollect=true/);
    assert.match(text(details),/demo-task-2026-10-20-hainan-B/);
    assert.match(text(details),/分析方式：已配置模型/);
    assert.match(text(details),/参考经验：任务 HN-01 的执行经验/);
    assert.equal(walk(details,node => node.type==='button').length,0);
    assert.ok(button(named(h.element,'下一步操作'),'查看今日 B 区任务'));
    assert.equal(text(walk(details,node => node.props.className==='ba-analysis')[0]),'依据：demo-task-2026-10-20-hainan-B 的 collection.canCollect=true，已收到 36 条回执。\n\n称重前尚无实际产胶重量。');
  }
});

test('older plain-text answers show their opening line and retain every detail line without rewriting',() => {
  const first = '结论：B 区今日任务已全部完成，下一步登记收胶。';
  const remaining = '要点：\n一、任务 demo-task-2026-10-20-hainan-B 的 canCollect 为 true。\n二、昨日任务仍剩余 24 棵。\n\n后续：确认称重后登记实际重量。';
  const h = harness({sessions:[session('session-1',[turn({answer:`${first}\n\n${remaining}`})])]});
  const main = walk(h.element,node => node.props.className==='ba-answer')[0];
  assert.equal(text(walk(main,node => node.type==='p')[0]),first.slice('结论：'.length));
  assert.equal(walk(main,node => node.props.className==='ba-next-step').length,0);
  assert.doesNotMatch(text(main),/demo-task|canCollect/);
  const details = walk(h.element,node => node.props.className==='ba-details')[0];
  assert.equal(text(walk(details,node => node.props.className==='ba-analysis')[0]),remaining);

  const oldListIntro = '分批销售按当前全园7天测算，主要指标如下：';
  const oldListDetails = '1. soldKg：120 公斤。\n2. endingAvailableKg：315.7 公斤。\n\n上述指标使用干胶口径。';
  const oldList = harness({sessions:[session('session-1',[turn({answer:`${oldListIntro}\n${oldListDetails}`})])]});
  const oldListMain = walk(oldList.element,node => node.props.className==='ba-answer')[0];
  assert.equal(text(walk(oldListMain,node => node.type==='p')[0]),oldListIntro);
  assert.doesNotMatch(text(oldListMain),/soldKg|endingAvailableKg/);
  assert.equal(text(walk(oldList.element,node => node.props.className==='ba-analysis')[0]),oldListDetails);
});

test('selecting another historical session removes an in-flight local answer from view',async () => {
  const h = harness({sessions:[session('session-1'),session('other',[turn({turnId:'other-turn',answer:'另一个会话的安排'})])]});
  button(h.element,'收胶储运进度').props.onClick();await settle();h.render();
  assert.match(text(h.element),/已提交，正在准备分析/);
  named(h.element,'业务对话记录').props.onChange({target:{value:'other'}});h.render();
  assert.match(text(h.element),/另一个会话的安排/);
  assert.doesNotMatch(text(h.element),/已提交，正在准备分析/);
  assert.equal(named(h.element,'业务问题').props.disabled,false);
});
