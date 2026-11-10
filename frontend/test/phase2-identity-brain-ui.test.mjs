import {resolveTreeIdentity} from '../../shared/treeIdentity.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {hasNewStrategy} from '../src/integration/strategyRefreshState.ts';
import {transformWithOxc,parseAst} from 'vite';
import {accountSites,accountTreeIndices,canUseSite,rolePages,parseSignedIn,workbenchLabel,can,roleIntro,roleOrder,IDENTITY_STORAGE_KEY} from '../src/workspace/identityModel.ts';
import {parks} from '../../shared/parkCatalog.ts';
import {treeAlias} from '../src/workspace/model.ts';
import {treePosition} from '../src/workspace/workbenchModel.ts';
import {collectionPointAsOf} from '../src/workspace/collectionPointData.ts';

async function declarations(path){
  const source=readFileSync(new URL(`../src/${path}`,import.meta.url),'utf8');
  const {code}=await transformWithOxc(source,path,{lang:'tsx',jsx:{runtime:'classic'}});
  return parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
}
function text(element){
  if(typeof element==='string'||typeof element==='number')return String(element);
  if(!React.isValidElement(element))return '';
  if(typeof element.type==='function')return text(element.type(element.props));
  return React.Children.toArray(element.props.children).map(text).join('');
}
function walk(element,predicate){
  if(!React.isValidElement(element))return [];
  if(typeof element.type==='function')return walk(element.type(element.props),predicate);
  return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];
}
const stub=()=>null;
const grower={accountId:'grower-hn-wang',name:'王师傅',title:'海南海口园区 · 胶农',role:'grower',roleLabel:'胶农',siteIds:['demo-hainan'],summary:'',permissions:['plot.read','assistant.use','memory.private.write'],
  plot:{siteId:'demo-hainan',zone:'B',label:'B区承包地 1 亩（33 棵）',areaMu:1,treeCount:33,treeIds:Array.from({length:33},(_,i)=>`T-${String(51+i).padStart(4,'0')}`)}};
const manager={accountId:'manager-xs',name:'景洪园区管理',title:'',role:'manager',roleLabel:'农场管理',siteIds:['demo-xsbn'],summary:'',
  permissions:['site.read','park_plan.write','cerebellum.approve','memory.park.write']};
const center={...manager,accountId:'center-hz',role:'executive',siteIds:['demo-hainan','demo-xsbn','demo-xian'],permissions:['site.read','cerebellum.approve','memory.public.write']};

const identityGate=await declarations('workspace/IdentityGate.tsx');
test('selecting an identity opens its workbench before mount while restoring a saved identity preserves the deep link',async()=>{
  const location={hash:'#robots'},requests=[],signedIn=[];
  const saved={token:'demo-session',expiresAt:'2999-01-01T00:00:00Z',account:grower};
  const WorkspaceApp=()=>null;
  const bindings={React,Leaf:stub,LogIn:stub,ShieldCheck:stub,WorkspaceApp,roleIntro,roleOrder,parseSignedIn,IDENTITY_STORAGE_KEY,location,
    useState:initial=>[typeof initial==='function'?initial():initial,stub],useEffect:stub,
    useRead:()=>({data:{items:[grower]},reload:stub}),localStorage:{getItem:()=>JSON.stringify(saved)},
    post:async(path,input)=>{requests.push({path,input});return saved;}};
  const {IdentityGate,IdentityRoot}=new Function(...Object.keys(bindings),identityGate+';return {IdentityGate,IdentityRoot};')(...Object.values(bindings));
  const restored=IdentityRoot();
  assert.equal(restored.type,WorkspaceApp);assert.equal(restored.props.account.accountId,grower.accountId);
  assert.equal(location.hash,'#robots','refreshing an existing login keeps its current deep link');
  const login=IdentityGate({onSignedIn:value=>signedIn.push({value,hash:location.hash})});
  await walk(login,node=>node.type==='button'&&text(node).includes('王师傅'))[0].props.onClick();
  assert.deepEqual(requests,[{path:'/api/auth/login',input:{accountId:grower.accountId}}]);
  assert.deepEqual(signedIn,[{value:saved,hash:'workbench'}]);
});

test('identity model: parks, pages and permissions follow the signed-in account',()=>{
  assert.deepEqual(accountSites(grower),['hainan']);
  assert.ok(canUseSite(grower,'hainan')&&!canUseSite(grower,'xsbn')&&!canUseSite(grower,'all'));
  assert.ok(canUseSite(center,'all')&&canUseSite(center,'xian'));
  assert.deepEqual(rolePages('grower'),['workbench','analytics','home','operations']);
  assert.ok(!rolePages('operator').includes('analytics')&&rolePages('manager').includes('decisions'));
  assert.ok(rolePages('manager').includes('brain')&&rolePages('executive').includes('brain'));
  assert.ok(!rolePages('grower').includes('brain')&&!rolePages('operator').includes('brain'));
  assert.equal(workbenchLabel('grower'),'我的地块');assert.equal(workbenchLabel('manager'),'生产经营');
  assert.ok(can(manager,'park_plan.write')&&!can(grower,'park_plan.write'));
  const saved={token:'rs-1',expiresAt:'2026-10-21T12:00:00Z',account:grower};
  assert.equal(parseSignedIn(JSON.stringify(saved),Date.parse('2026-10-21T01:00:00Z')).account.accountId,'grower-hn-wang');
  assert.equal(parseSignedIn(JSON.stringify(saved),Date.parse('2026-10-22T01:00:00Z')),null,'expired identity is dropped');
  assert.equal(parseSignedIn('{"token":1}'),null);assert.equal(parseSignedIn('not json'),null);
});

const today=await declarations('workspace/TodayDecisions.tsx');
const growerFocus=await declarations('workspace/GrowerFocus.tsx');
const GrowerFocus=new Function('React','ArrowRight','MapPin','Sprout','collectionPointAsOf','treeAlias','treePosition','FuturesTicker',growerFocus+';return GrowerFocus;')(
  React,stub,stub,stub,collectionPointAsOf,treeAlias,treePosition,stub);
function mountToday(brief,account=grower){
  const actions=[],trees=[];
  const Component=new Function('React','ArrowRight','siteIdOf','useRead','StrategyRefreshStatus','GrowerFocus',today+';return TodayDecisions;')(
    React,stub,site=>'demo-'+site,()=>({data:brief,reload:stub}),stub,GrowerFocus);
  const element=Component({account,site:'hainan',onAction:action=>actions.push(action),onTree:index=>trees.push(index)});
  return {element,actions,trees};
}
test('grower home leads with collection prices and owned tree care, preserving working links and estimate labels',()=>{
  const brief={siteId:'demo-hainan',park:'海南海口模拟园区',role:'grower',generatedAt:'',items:[
    {id:'plot-care',priority:'high',title:'我的 33 棵树',conclusion:'2 棵需要照看',reason:'巡查记录',sourceRefs:[],action:{type:'plot_tree',treeId:'T-0055',label:'查看 T-0055 养护建议'}},
    {id:'plot-income',priority:'info',title:'这亩地卖了多少',conclusion:'约 72 元',reason:'按回执估算',sourceRefs:[],action:{type:'collection',label:'比较收胶点报价'}},
    {id:'plot-tasks',priority:'medium',title:'近期割胶',conclusion:'明天 B 区割胶',reason:'园区统一安排',sourceRefs:[],action:{type:'task',taskId:'plot-task',label:'查看作业'}}],
    plot:{label:'B区承包地 1 亩（33 棵）',zone:'B',treeCount:33,treeIds:grower.plot.treeIds,care:[{treeId:'T-0055',reasons:['健康关注']}],completedTaps:3,estimatedLatexKg:3,estimatedIncomeCny:21.6,basis:'按完成回执与示例报价估算',collectionPoints:[
      {id:'near',name:'本地收胶点',distanceKm:2.1,latexPrice:7.1},{id:'far',name:'远端收胶点',distanceKm:5.2,latexPrice:7.6}]}};
  const page=mountToday(brief);
  const content=text(page.element);
  assert.match(content,/今天我的地块/);assert.match(content,/7\.10–7\.60/);assert.match(content,/示例报价/);assert.ok(content.includes(collectionPointAsOf));
  assert.match(content,/元 \/ 公斤鲜胶乳/);assert.match(content,/干胶含量 30%/);assert.match(content,/本地收胶点.*2\.1 公里/);
  assert.match(content,/承包面积1亩/);assert.match(content,/我的树木33棵/);assert.match(content,/需要照看1棵/);
  assert.match(content,/估算收入21\.6元/);assert.doesNotMatch(content,/这亩地卖了多少|约 72 元|HN-A-/);
  assert.ok(content.indexOf('附近收胶价')<content.indexOf('近期割胶'));
  const focus=walk(page.element,node=>node.props['aria-label']==='承包地重点树木')[0];
  assert.match(text(focus),/HN-B-0005健康关注/);
  walk(focus,node=>node.type==='button')[0].props.onClick();assert.deepEqual(page.trees,[54]);
  walk(page.element,node=>node.type==='button'&&text(node).includes('比较收胶点报价'))[0].props.onClick();
  assert.deepEqual(page.actions.at(-1),{type:'collection',label:'比较收胶点报价'});
  const treeList=walk(page.element,node=>node.props.role==='list')[0];
  const trees=walk(treeList,node=>node.type==='button');
  assert.equal(trees.length,33);assert.ok(trees[4].props['aria-label'].includes('需要照看'));
  trees[32].props.onClick();assert.deepEqual(page.trees,[54,82]);
  walk(page.element,node=>node.type==='button'&&text(node)==='查看作业')[0].props.onClick();
  assert.deepEqual(page.actions.at(-1),{type:'task',taskId:'plot-task',label:'查看作业'});
  assert.match(text(mountToday({...brief,role:'manager',plot:undefined},manager).element),/今天需要你决定的事/);
});
test('today decisions: a saved park plan opens by id, while a plan awaiting recompute keeps its own label and opens the latest',()=>{
  const item=(id,action)=>({id,priority:'high',title:id,conclusion:'结论',reason:'依据',sourceRefs:[],action});
  const page=mountToday({siteId:'demo-hainan',park:'海南海口模拟园区',role:'manager',generatedAt:'',items:[
    item('saved',{type:'park_plan',planId:'park-plan-1',label:'确认并采用'}),item('stale',{type:'park_plan',label:'重新测算'})]},manager);
  const buttons=walk(page.element,node=>node.type==='button');
  assert.deepEqual(buttons.map(text),['查看本周方案','重新测算']);
  const status=walk(page.element,node=>node.type==='details'&&text(node).includes('策略更新状态'))[0];
  assert.ok(status);assert.notEqual(status.props.open,true);
  assert.ok(text(page.element).indexOf('结论')<text(page.element).indexOf('策略更新状态'));
  buttons[1].props.onClick();assert.deepEqual(page.actions,[{type:'park_plan',label:'重新测算'}]);
});

const plan=await declarations('integration/ParkTappingPlan.tsx');
const clientCode=(await transformWithOxc(readFileSync(new URL('../src/integration/client.ts',import.meta.url),'utf8'),'client.ts',{lang:'ts'})).code;
const aliasDeclaration=parseAst(clientCode).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node).filter(node=>node?.type==='VariableDeclaration').flatMap(node=>node.declarations).find(node=>node.id.name==='alias');
const treeMapping=JSON.parse(readFileSync(new URL('../src/integration/tree-map.json',import.meta.url),'utf8'));
const planAlias=new Function('resolveTreeIdentity','parks','mapping',`return (${clientCode.slice(aliasDeclaration.init.start,aliasDeclaration.init.end)});`)(resolveTreeIdentity,parks,treeMapping);
const planFactory=new Function('React','useEffect','useState','ArrowRight','CalendarDays','CloudRain','RefreshCw','post','siteIdOf','useRead','when','can','currentAccount','EconomicFactors','alias','hasNewStrategy',
  'const useRef=initial=>({current:initial}); const ParkEconomicEvidence=()=>null,ParkBusinessInputsEditor=()=>null,ParkModelReasoning=()=>null;\n'+plan+';return {ParkTappingPlan,zoneCells,stanceTone};');
const planModule=(...args)=>planFactory(...args,planAlias,hasNewStrategy);
const outlook=['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27'].map((date,i)=>({date,rainProbabilityPct:i===2?70:20,rainMm:i===2?5:0,source:'simulated_outlook',tappable:i!==2,reasons:i===2?['降雨概率 70% ≥ 60%']:[],heldZones:[]}));
const parkPlan={id:'park-plan-abc',siteId:'demo-xsbn',park:'景洪',generatedAt:'2026-10-21T00:00:00Z',validUntil:'2099-01-01T00:00:00Z',stance:'reduce',stanceLabel:'减产',frequencyPerWeek:1,baselineFrequency:2,
  modelProposal:{mode:'llm',provider:'test',model:'test-model',generatedAt:'2026-10-21T00:00:00Z',summary:'模型提议',zones:[],drivers:[],risks:[],inputSnapshot:{},inputFingerprint:'inputs-1'},constraintAdjustments:[],
  readiness:{checkedAt:'2026-10-21T00:00:00Z',readyCount:120,reviewCount:0,totalCount:120,readyTrees:['A','B','C','D'].flatMap((zone,zoneIndex)=>Array.from({length:30},(_,index)=>({treeId:`T-${String(zoneIndex*50+index+1).padStart(4,'0')}`,treeIndex:zoneIndex*50+index,zone}))),reviewTrees:[],exceptionCases:[]},
  headline:'本周全园减产：每区每周 1 次',score:-2,signals:[{key:'inventory',label:'库存与仓容',value:'880 / 900 kg（98%）',score:-1,detail:'仓容紧张',source:'sales'}],outlook,
  zones:['A','B','C','D'].map((zone,i)=>({zone,robot:'R-'+zone,eligibleTrees:30,excluded:[],frequency:i===2?0:1,dates:i===2?[]:['2026-10-21'],expectedDryKg:i===2?0:9,hold:i===2?'设备故障未恢复':null})),
  production:{expectedDryKg:27,baselineDryKg:72,deltaKg:-45},inventory:{stockKg:880,storageKg:900,utilization:.98,plannedSalesKg:40,projectedEndKg:867,overflowKg:0},
  cerebellumVersion:'v1',salesHint:'仓容紧张：配合立即销售',analogy:'像欧佩克',limitations:['模拟展望']};
test('park plan: calendar marks tapping, rain and held zones; only planners see the adopt button',()=>{
  const {zoneCells,stanceTone}=planModule(React,stub,stub,stub,stub,stub,stub,stub,s=>'demo-'+s,stub,v=>v,can,stub,stub);
  const cells=zoneCells(parkPlan,parkPlan.zones[0]);
  assert.equal(cells[0].tap,true);assert.equal(cells[2].blocked,true);assert.match(cells[2].reason,/70%/);
  assert.ok(zoneCells(parkPlan,parkPlan.zones[2]).every(cell=>!cell.tap));
  assert.equal(stanceTone.reduce,'pp-down');
  const render=account=>{
    let cursor=0;const slots=[parkPlan,false,'',''];
    const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,stub];},stub,stub,stub,stub,stub,s=>'demo-'+s,()=>({data:{plan:parkPlan},reload:stub}),v=>v,can,()=>account,stub);
    return ParkTappingPlan({site:'xsbn'});
  };
  const forManager=render(manager),content=text(forManager);
  assert.match(content,/本周全园减产/);assert.match(content,/设备故障未恢复/);assert.match(content,/全园产量与库存由系统按可执行排程测算/);
  assert.doesNotMatch(content,/仓容紧张：配合立即销售/);
  assert.ok(walk(forManager,node=>node.type==='button'&&text(node).includes('采用并生成任务')).length===1);
  const forCenter=render({...center,permissions:['site.read']});
  assert.equal(walk(forCenter,node=>node.type==='button'&&text(node).includes('采用并生成任务')).length,0);
  assert.match(text(forCenter),/需由农场管理采用/);
});

test('park plan: changed economic scenario is recomputed before adoption and preserves adopted execution display',async()=>{
  function mount(initialPlan=parkPlan){
    let cursor=0;
    const slots=[initialPlan,false,'','','baseline'],posts=[];
    const selector=props=>React.createElement('div',null,
      React.createElement('select',{value:props.value,onChange:event=>props.onChange(event.target.value)}),
      React.createElement('button',{onClick:props.onCalculate},'按此情景重新计算'));
    const {ParkTappingPlan}=planModule(React,stub,initial=>{const index=cursor++;return [index in slots?slots[index]:initial,value=>{slots[index]=value;}];},stub,stub,stub,stub,
      async(path,input)=>{posts.push({path,input});return {...parkPlan,id:'park-typhoon',economicScenarioId:input.economicScenarioId};},
      site=>'demo-'+site,()=>({data:{plan:initialPlan},reload:stub}),value=>value,can,()=>manager,selector);
    return {posts,render(){cursor=0;return ParkTappingPlan({site:'xsbn',onTasks:stub});}};
  }
  const h=mount();
  let tree=h.render();
  walk(tree,node=>node.type==='select')[0].props.onChange({target:{value:'typhoon'}});
  tree=h.render();
  assert.match(text(tree),/情景已改变，请重新测算后采用/);
  assert.equal(walk(tree,node=>node.type==='button'&&text(node).includes('采用并生成任务'))[0].props.disabled,true);
  await walk(tree,node=>node.type==='button'&&text(node)==='按此情景重新计算')[0].props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/park-plan',input:{siteId:'demo-xsbn',economicScenarioId:'typhoon'}}]);
  tree=h.render();
  assert.doesNotMatch(text(tree),/情景已改变，请重新测算后采用/);
  assert.equal(walk(tree,node=>node.type==='button'&&text(node).includes('采用并生成任务'))[0].props.disabled,false);
  const active=mount({...parkPlan,adoption:{adoptedAt:'2026-10-21',tasks:[{id:'task-a',zone:'A',date:'2026-10-21',status:'running',done:12,count:30}],skipped:[],replacedTaskIds:[]}});
  walk(active.render(),node=>node.type==='select')[0].props.onChange({target:{value:'demand_weak'}});
  assert.match(text(active.render()),/已采用.*生成 1 项分区割胶任务.*12\/30/);
  assert.equal(active.posts.length,0);
});

test('park plan: opening an expired original reads its ID without generating or replacing it with latest',()=>{
  const original={...parkPlan,validUntil:'2026-01-01T00:00:00Z',economicScenarioId:'baseline',
    adoption:{adoptedAt:'2026-10-21',tasks:[{id:'original-task',zone:'A',date:'2026-10-21',status:'已完成',done:30,count:30}],skipped:[],replacedTaskIds:[]}};
  const paths=[],posts=[],slots=[],effects=[];let cursor=0;
  const {ParkTappingPlan}=planModule(React,fn=>effects.push(fn),initial=>{
    const index=cursor++;if(!(index in slots))slots[index]=initial;
    return [slots[index],value=>{slots[index]=value;}];
  },stub,stub,stub,stub,(...args)=>posts.push(args),site=>'demo-'+site,path=>{paths.push(path);return {data:{plan:original},reload:stub};},value=>value,can,()=>manager,stub);
  const latest=[];
  const render=()=>{cursor=0;return ParkTappingPlan({site:'xsbn',planId:original.id,onLatest:()=>latest.push(true)});};
  render();effects.shift()();
  const tree=render();
  assert.ok(paths.every(path=>path===`/api/park-plan/${original.id}?siteId=demo-xsbn`));
  assert.equal(posts.length,0);
  assert.match(text(tree),/查看已保存的原全园方案/);
  assert.match(text(tree),/已完成（30\/30）/);
  assert.match(text(tree),/park-plan-abc/);
  walk(tree,node=>node.type==='button'&&text(node)==='查看最新方案')[0].props.onClick();
  assert.deepEqual(latest,[true]);
});

test('park plan: opens the next unfinished generated task and keeps completed results directly accessible',async()=>{
  const adopted={...parkPlan,adoption:{adoptedAt:'2026-10-21',skipped:[],replacedTaskIds:[],tasks:[
    {id:'task-d',zone:'D',date:'2026-10-27',status:'待开始',done:0,count:30},
    {id:'task-a',zone:'A',date:'2026-10-27',status:'待开始',done:0,count:29},
    {id:'task-b',zone:'B',date:'2026-10-27',status:'待开始',done:0,count:30},
  ]}};
  const opened=[],slots=[adopted,false,'','','baseline'];let cursor=0;
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,value=>{slots[i]=value;}];},stub,stub,stub,stub,stub,site=>'demo-'+site,()=>({data:{plan:adopted}}),value=>value,can,()=>manager,stub);
  const render=()=>{cursor=0;return ParkTappingPlan({site:'xsbn',onTasks:id=>opened.push(id),tasks:[
    {id:'task-a',site:'xsbn',status:'已完成',done:29,count:29},
    {id:'task-b',site:'maoming',status:'已完成',done:30,count:30},
  ]});};
  const page=render();
  assert.match(text(page),/A区 · 10\/27 · 已完成（29\/29）/);
  assert.deepEqual(walk(page,node=>node.type==='button'&&/^打开[A-D]区任务$/.test(text(node))).map(text),['打开A区任务','打开B区任务','打开D区任务']);
  await walk(page,node=>node.type==='button'&&text(node).trim()==='查看执行与回传')[0].props.onClick();
  assert.deepEqual(opened,['task-b']);
  await walk(render(),node=>node.type==='button'&&text(node)==='打开A区任务')[0].props.onClick();
  assert.deepEqual(opened,['task-b','task-a']);
});

test('park plan: repeated adoption clicks share one pending submission',async t=>{
  const originalWindow=globalThis.window,events=[];
  globalThis.window={dispatchEvent:event=>{events.push(event.type);return true;}};
  t.after(()=>{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});
  let cursor=0,finish;const slots=[parkPlan,false,'','','baseline'],posts=[];
  const pending=new Promise(resolve=>{finish=resolve;});
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,value=>{slots[i]=value;}];},stub,stub,stub,stub,(path,input)=>{posts.push({path,input});return pending;},site=>'demo-'+site,()=>({data:{plan:parkPlan}}),value=>value,can,()=>manager,stub);
  const page=ParkTappingPlan({site:'xsbn'});
  const button=walk(page,node=>node.type==='button'&&text(node).trim()==='采用并生成任务')[0];
  const first=button.props.onClick();await button.props.onClick();
  assert.equal(posts.length,1);
  finish({...parkPlan,adoption:{adoptedAt:'2026-10-21',skipped:[],replacedTaskIds:[],tasks:[]}});
  await first;
  assert.deepEqual(events,['harness-tasks-created']);
});

test('park plan: all preflight reasons and tree identities are available before adoption',()=>{
  const prechecked={...parkPlan,readiness:{checkedAt:parkPlan.generatedAt,readyCount:1,reviewCount:2,totalCount:3,
    readyTrees:[{treeId:'T-0001',treeIndex:0,zone:'A'}],reviewTrees:[
      {treeId:'T-0004',treeIndex:3,zone:'A',reasons:['存在树表标记','采用的角度建议已过期'],reviewKind:'inspect'},
      {treeId:'T-0051',treeIndex:50,zone:'B',reasons:['缺少树围测量'],reviewKind:'measure'},
    ],exceptionCases:[{treeId:'T-0004',profile:'surface_mark',label:'树表标记复核'}]}};
  let cursor=0,reviewOpened=0;
  const slots=[prechecked,false,'','','baseline'];
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,stub];},stub,stub,stub,stub,stub,site=>'demo-'+site,()=>({data:{plan:prechecked}}),value=>value,can,()=>manager,stub);
  const page=ParkTappingPlan({site:'xsbn',onReview:()=>reviewOpened++});
  const content=text(page);
  assert.match(content,/可执行 1 棵，待核查 2 棵/);
  assert.match(content,/仅可执行树生成割胶任务.*不计为完成/);
  for(const value of ['T-0001','T-0004','T-0051','存在树表标记','采用的角度建议已过期','缺少树围测量'])assert.ok(content.includes(value),value);
  for(const value of ['XS-A-0001','XS-A-0004','XS-B-0001'])assert.ok(content.includes(value),value);
  assert.doesNotMatch(content,/HN-A-0004/);
  assert.match(content,/按当前证据核验；实际开割仍检查天气、设备和策略有效期/);
  assert.ok(content.indexOf('可执行 1 棵，待核查 2 棵')<content.indexOf('采用并生成任务'));
  const open=walk(page,node=>node.type==='button'&&text(node)==='查看异常核查案例')[0];
  open.props.onClick();assert.equal(reviewOpened,1);
  assert.equal(walk(page,node=>node.type==='button'&&text(node).trim()==='采用并生成任务')[0].props.disabled,false);
});

test('park plan: legacy plans cannot claim readiness or submit adoption before recomputation',async()=>{
  const legacy={...parkPlan};delete legacy.readiness;
  let cursor=0;const slots=[legacy,false,'','','baseline'],posts=[];
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,value=>{slots[i]=value;}];},stub,stub,stub,stub,(...args)=>posts.push(args),site=>'demo-'+site,()=>({data:{plan:legacy}}),value=>value,can,()=>manager,stub);
  const render=()=>{cursor=0;return ParkTappingPlan({site:'xsbn'});};
  const page=render();
  assert.match(text(page),/未进行执行预检.*重新测算后采用/);
  assert.doesNotMatch(text(page),/可执行 \d+ 棵，待核查 \d+ 棵/);
  assert.doesNotMatch(text(page),/\d+ 棵可执行/);
  const button=walk(page,node=>node.type==='button'&&text(node).trim()==='采用并生成任务')[0];
  assert.equal(button.props.disabled,true);
  await button.props.onClick();
  assert.equal(posts.length,0);
  assert.match(text(render()),/尚未完成执行预检/);
});

test('park plan: adopted review objects stay separate from tapping tasks and open the review flow',async()=>{
  const adopted={...parkPlan,adoption:{adoptedAt:parkPlan.generatedAt,skipped:[],replacedTaskIds:[],tasks:[{id:'ready-only-task',zone:'A',date:'2026-10-21',status:'待开始',done:0,count:1}],
    reviewTrees:[{treeId:'T-0004',treeIndex:3,zone:'A',reviewKind:'inspect',reasons:['树表标记待复核','角度采用记录已过期']}]}};
  let cursor=0,reviewOpened=0;const slots=[adopted,false,'','','baseline'],opened=[];
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,stub];},stub,stub,stub,stub,stub,site=>'demo-'+site,()=>({data:{plan:adopted}}),value=>value,can,()=>manager,stub);
  const page=ParkTappingPlan({site:'xsbn',onTasks:id=>opened.push(id),onReview:()=>reviewOpened++});
  assert.match(text(page),/单独核查清单 · 1 棵/);
  assert.match(text(page),/未生成割胶任务，不计为割胶完成/);
  assert.match(text(page),/T-0004.*树表标记待复核.*角度采用记录已过期/);
  assert.match(text(page),/本方案任务 · 1 项/);
  walk(page,node=>node.type==='button'&&text(node)==='处理本方案待核查对象')[0].props.onClick();
  assert.equal(reviewOpened,1);assert.deepEqual(opened,[]);
  await walk(page,node=>node.type==='button'&&text(node)==='打开A区任务')[0].props.onClick();
  assert.deepEqual(opened,['ready-only-task']);
});

test('park plan: legacy adopted plans keep their original task and receipt navigation',async()=>{
  const legacy={...parkPlan,adoption:{adoptedAt:parkPlan.generatedAt,skipped:[],replacedTaskIds:[],tasks:[{id:'historical-task',zone:'A',date:'2026-10-21',status:'已完成',done:30,count:30}]}};
  delete legacy.readiness;
  let cursor=0;const slots=[legacy,false,'','','baseline'],opened=[];
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,stub];},stub,stub,stub,stub,stub,site=>'demo-'+site,()=>({data:{plan:legacy}}),value=>value,can,()=>manager,stub);
  const page=ParkTappingPlan({site:'xsbn',onTasks:id=>opened.push(id)});
  assert.match(text(page),/原方案未保存执行预检结果，可继续查看原任务与回传/);
  assert.match(text(page),/原采用记录未保存单独核查清单/);
  assert.doesNotMatch(text(page),/单独核查清单 · 0 棵|可执行 \d+ 棵/);
  await walk(page,node=>node.type==='button'&&text(node).trim()==='查看执行与回传')[0].props.onClick();
  assert.deepEqual(opened,['historical-task']);
});

test('park plan: pending recomputation is described as measurement and preflight, not adoption',async()=>{
  let cursor=0,finish;const slots=[parkPlan,false,'','','baseline'];
  const pending=new Promise(resolve=>{finish=resolve;});
  const {ParkTappingPlan}=planModule(React,stub,initial=>{const i=cursor++;return [i in slots?slots[i]:initial,value=>{slots[i]=value;}];},stub,stub,stub,stub,()=>pending,site=>'demo-'+site,()=>({data:{plan:parkPlan}}),value=>value,can,()=>manager,stub);
  const render=()=>{cursor=0;return ParkTappingPlan({site:'xsbn'});};
  const submitted=walk(render(),node=>node.type==='button'&&text(node).trim()==='请大模型重新生成')[0].props.onClick();
  const busyPage=render();
  assert.match(text(busyPage),/模型正在分析…/);
  assert.doesNotMatch(text(busyPage),/正在采用/);
  finish(parkPlan);await submitted;
  assert.doesNotMatch(text(render()),/模型正在分析/);
});

const brain=await declarations('integration/BrainLearning.tsx');
const brainModule=new Function('React','useState','Brain','Check','History','RotateCcw','X','post','siteIdOf','useRead','when','memoryScopeLabels','can','currentAccount','BrainEvolutionPanel','ProposalReplay','HarnessLedger','RoutingEvolutionPanel',
  brain+';return {BrainLearning,memoryEditable,proposalStatus};');
test('brain learning: pending proposals need an approver; memory edit rights mirror the server',()=>{
  const {memoryEditable}=brainModule(React,stub,stub,stub,stub,stub,stub,stub,stub,stub,stub,{},can,stub);
  assert.equal(memoryEditable({id:'m1',scope:'private',accountId:'grower-hn-wang',title:''},grower),true);
  assert.equal(memoryEditable({id:'m2',scope:'private',accountId:'someone-else',title:''},grower),false);
  assert.equal(memoryEditable({id:'m3',scope:'park',title:''},grower),false);
  assert.equal(memoryEditable({id:'m3',scope:'park',title:''},manager),true);
  assert.equal(memoryEditable({id:'execution-HN-01',scope:'park',title:''},manager),false,'execution records are generated, not edited');
  assert.equal(memoryEditable({id:'knowledge-daily_plan',scope:'shared',title:''},center),false);
  const status={siteId:'demo-xsbn',park:'景洪',climateLabel:'热带高原',activeVersion:'default',thresholds:{soilWetPct:65},defaults:{soilWetPct:65},
    specs:{soilWetPct:{label:'土壤偏湿阈值',unit:'%',min:55,max:80,step:5}},history:[],note:'批准前不生效',
    proposals:[{id:'cereb-1',status:'pending',changes:[{key:'soilWetPct',label:'土壤偏湿阈值',unit:'%',from:65,to:70,reason:'晨雾'}],summary:'高原气候',expectedEffect:'土壤偏湿阈值 65→70%',
      origin:'brain_reflection',createdBy:'x',createdAt:'',safety:'仅改变规则阈值',feedback:{windowDays:14,fieldRainEvents:{count:0},weatherHeldTasks:{count:0},adoptedWeatherWindows:{count:0},completedTasks:{count:2},cancelledTasks:{count:0}}}]};
  const render=account=>{
    const {BrainLearning}=brainModule(React,initial=>[initial,stub],stub,stub,stub,stub,stub,stub,s=>'demo-'+s,
      path=>({data:path.startsWith('/api/cerebellum')?status:{items:[]},reload:stub}),v=>v,{private:'个人'},can,()=>account);
    return BrainLearning({site:'xsbn'});
  };
  const approver=render(manager);
  assert.match(text(approver),/待审批：土壤偏湿阈值 65→70%/);
  assert.equal(walk(approver,node=>node.type==='button'&&text(node).includes('批准生效')).length,1);
  const viewer=render({...grower,siteIds:['demo-xsbn']});
  assert.equal(walk(viewer,node=>node.type==='button'&&text(node).includes('批准生效')).length,0);
  assert.match(text(viewer),/只有园区管理或中心可以审批/);
});

const workbench=await declarations('workspace/DecisionWorkbench.tsx');
test('workbench: role highlights and task summary precede decisions and the conversation',()=>{
  const calls=[];
  const bindings={React,useState:initial=>[initial,stub],useEffect:stub,ArrowRight:stub,Bot:stub,Database:stub,GitBranch:stub,ListChecks:stub,MapPin:stub,Sprout:stub,
    BusinessAssistant:()=>null,TodayDecisions:()=>null,RoleHighlights:()=>null,accountSites,DATA_MODE:'demo',kinds:{},statuses:{},StrategyRecommendation:stub,siteIdOf:s=>'demo-'+s,when:v=>v,
    sites:{hainan:'海南'},treeAlias:i=>String(i),roleViews:{manager:{label:'农场管理',title:'t',focus:'f',primary:'decisions'},grower:{label:'胶农',title:'t',focus:'f',primary:'home'}},
    scopedTasks:()=>[],siteHierarchy:{hainan:{center:'c',region:'r',park:'p',note:'n'}},treePosition:id=>Number(id.slice(2))-1,treeZone:()=>'A',getRecentLatex:()=>0,
    eventKindLabels:{},eventScopeLabel:()=>'',eventStatusLabels:{},useRead:()=>({reload:stub})};
  const Component=new Function(...Object.keys(bindings),workbench+';return DecisionWorkbench;')(...Object.values(bindings));
  const props=account=>({role:account?.role??'manager',scope:'hainan',tasks:[],events:[],synced:true,account,
    onParkPlan:planId=>calls.push(['park',planId]),onCerebellum:()=>calls.push('brain'),...Object.fromEntries(['onScope','onNavigate','onTree','onStrategy','onMarket','onData','onTask','onEvents'].map(name=>[name,(...args)=>calls.push([name,...args])]))});
  const signedIn=Component(props({...grower,role:'manager'}));
  const children=React.Children.toArray(signedIn.props.children);
  const order=children.map(node=>node.type===bindings.RoleHighlights?'highlights':node.type===bindings.TodayDecisions?'today':node.type===bindings.BusinessAssistant?'assistant':node.props['aria-label']==='作业概况'?'summary':null).filter(Boolean);
  assert.deepEqual(order,['highlights','summary','today','assistant']);
  assert.equal(walk(signedIn,node=>node.type==='details'||node.props['aria-label']==='组织与园区下钻'||node.props['aria-label']==='单树决策依据').length,0);
  const today=children.find(node=>node.type===bindings.TodayDecisions);
  today.props.onAction({type:'park_plan',planId:'p',label:''});today.props.onAction({type:'cerebellum',label:''});today.props.onAction({type:'collection',label:''});
  assert.deepEqual(calls.slice(0,3),[['park','p'],'brain',['onData','collection']]);
  today.props.onTree(54);assert.deepEqual(calls.at(-1),['onTree','hainan',54]);
  assert.equal(children.some(node=>node.type===bindings.BusinessAssistant),true,'conversation is embedded in the workbench');
  const legacy=React.Children.toArray(Component(props(undefined)).props.children);
  assert.ok(!legacy.some(node=>node.type===bindings.TodayDecisions),'without an account the legacy layout is unchanged');
});


test('grower scene and search positions stay at their stable plot indices',()=>{
  assert.deepEqual(accountTreeIndices(grower,'hainan'),Array.from({length:33},(_,i)=>50+i));
  assert.deepEqual(accountTreeIndices(grower,'xsbn'),[]);
  const yan={...grower,siteIds:['demo-xsbn'],plot:{...grower.plot,siteId:'demo-xsbn',treeIds:Array.from({length:33},(_,i)=>`T-${String(i+1).padStart(4,'0')}`)}};
  assert.deepEqual(accountTreeIndices(yan,'xsbn'),Array.from({length:33},(_,i)=>i));
  assert.equal(accountTreeIndices(manager,'xsbn').length,200);
  assert.equal(accountTreeIndices(undefined,'hainan').length,200);
});


