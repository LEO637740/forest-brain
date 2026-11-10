import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst,transformWithOxc} from 'vite';

async function load(file,name){
  const {code}=await transformWithOxc(readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
  return parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n')+`;return ${name};`;
}
function walk(node,predicate){if(!React.isValidElement(node))return [];return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];}
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!React.isValidElement(node))return '';return React.Children.toArray(node.props.children).map(text).join('');}
const button=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node)===label)[0];
const manager={accountId:'manager-hn',role:'manager',permissions:['site.read','memory.park.write','market_events.propose','cerebellum.approve']};
const center={accountId:'center-hz',role:'executive',permissions:['site.read','memory.park.write','memory.public.write','market_events.propose','market_events.approve']};
function harness(source,{account,data={},reply={}}){
  const slots=[],posts=[],reads=[];let cursor=0;
  const bindings={React,useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=value;}];},
    useRead:path=>({data:typeof data==='function'?data(path):data,reload(){},error:undefined}),
    post:async(path,input)=>{posts.push({path,input});return reply[path.split('/').at(-1)]??{};},read:async path=>{reads.push(path);return reply.read??{};},
    can:(who,permission)=>who.permissions.includes(permission),currentAccount:()=>account,assistantSessionPath:id=>`/api/assistant/sessions/${id}`};
  const Component=new Function(...Object.keys(bindings),source)(...Object.values(bindings));
  return {posts,reads,render:props=>{cursor=0;return Component(props);}};
}

const turnSource=await load('workspace/TurnHarness.tsx','TurnHarness');
const turn={turnId:'turn-1',message:'台风来了怎么卖',status:'completed',mode:'configured',answer:'结论：分两批卖。\n下一步：查看经营方案。',
  tools:[{name:'recall_memory',label:'读取经验',summary:'',sourceRefs:[]},{name:'compare_market',label:'比较销售方案',summary:'',sourceRefs:[]}],actions:[],memoriesUsed:[],createdAt:'2026-10-21',
  verification:{total:4,traced:3,untraced:['66'],summary:'回答中 4 个数字，3 个与本轮工具数值对应；66 未找到对应数值，请核对计算或依据。仅对照数字来源，不核验业务含义。'},
  skills:[{id:'sales',title:'销售方案',how:'tool'},{id:'skill-1',title:'台风天销售',version:2,how:'learned'}],
  usage:{modelCalls:2,promptTokens:3000,completionTokens:200,cacheHitTokens:1500,modelMs:4000,promptChars:[3100,4200],fullPromptChars:11000}};

test('each answer shows figure tracing, skills and cost, takes feedback and can become a pending skill',async()=>{
  const h=harness(turnSource,{account:manager,reply:{read:{title:'台风来了怎么卖',triggers:['台风','卖']},skill:{title:'台风天销售'}}});
  let tree=h.render({sessionId:'s1',turn});
  const content=text(tree);
  assert.match(content,/数字来源对照.*66 未找到对应数值/);
  assert.match(content,/仅对照数字来源，不核验业务含义/);
  assert.match(content,/销售方案（用到工具时加载）、台风天销售 v2（园区经验技能）/);
  assert.match(content,/模型调用 2 次.*缓存命中 1500.*首轮提示词 3100 字，按需加载前约 11000 字/);
  await button(tree,'不准确').props.onClick();
  assert.deepEqual(h.posts[0],{path:'/api/assistant/sessions/s1/turns/turn-1/feedback',input:{helpful:false}});
  tree=h.render({sessionId:'s1',turn});assert.match(text(tree),/已评价：不准确/);
  await button(tree,'沉淀为技能').props.onClick();
  assert.deepEqual(h.reads,['/api/assistant/sessions/s1/turns/turn-1/skill-suggestion']);
  tree=h.render({sessionId:'s1',turn});
  const form=walk(tree,node=>node.type==='form')[0];
  form.props.onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.posts[1],{path:'/api/assistant/sessions/s1/turns/turn-1/skill',input:{title:'台风来了怎么卖',scope:'park',triggers:['台风','卖']}});
  assert.match(text(h.render({sessionId:'s1',turn})),/已沉淀为待审批技能“台风天销售”/);
  const grower=harness(turnSource,{account:{accountId:'g',role:'grower',permissions:[]}});
  assert.equal(button(grower.render({sessionId:'s1',turn}),'沉淀为技能'),undefined);
});

const eventsSource=await load('integration/MarketEvents.tsx','MarketEvents');
const events={kinds:{reserve_release:{label:'国家储备投放（抛储）'},demand_drop:{label:'下游需求下滑'}},items:[
  {id:'mevent-1',kind:'reserve_release',kindLabel:'国家储备投放（抛储）',title:'国储投放 5 万吨',siteIds:['demo-hainan'],parkNames:'海南海口模拟园区',effectiveFrom:'2026-10-20',effectiveTo:'2026-11-10',source:'',status:'pending',proposedBy:'manager-hn',direction:'bearish'},
  {id:'mevent-2',kind:'demand_drop',kindLabel:'下游需求下滑',title:'汽车减产',siteIds:'all',parkNames:'全部园区',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-30',source:'中汽协',status:'active',proposedBy:'center-hz',direction:'bearish'}]};

test('parks propose market events and only the center approves or withdraws them',async()=>{
  const park=harness(eventsSource,{account:manager,data:events});let tree=park.render({siteId:'demo-hainan',onChanged(){}});
  assert.match(text(tree),/国储投放 5 万吨.*待中心审批/);
  assert.equal(button(tree,'批准'),undefined);
  button(tree,'登记事件').props.onClick();tree=park.render({siteId:'demo-hainan',onChanged(){}});
  const inputs=walk(tree,node=>node.type==='input');
  inputs[0].props.onChange({target:{value:'国家收储 3 万吨天然橡胶'}});
  tree=park.render({siteId:'demo-hainan',onChanged(){}});
  walk(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(park.posts[0],{path:'/api/market-events',input:{kind:'reserve_release',title:'国家收储 3 万吨天然橡胶',siteIds:['demo-hainan']}});
  const hub=harness(eventsSource,{account:center,data:events});tree=hub.render({siteId:'demo-hainan',onChanged(){}});
  walk(tree,node=>node.type==='input'&&node.props['aria-label']==='审批说明')[0].props.onChange({target:{value:'储备局公告'}});
  tree=hub.render({siteId:'demo-hainan',onChanged(){}});
  await button(tree,'批准').props.onClick();
  await button(tree,'撤销').props.onClick();
  assert.deepEqual(hub.posts,[{path:'/api/market-events/mevent-1/decision',input:{decision:'approve',note:'储备局公告'}},{path:'/api/market-events/mevent-2/decision',input:{decision:'withdraw',note:'储备局公告'}}]);
});

const ledgerSource=await load('integration/HarnessLedger.tsx','HarnessLedger');
const ledger={days:7,turns:{total:6,completed:5,failed:1,model:3,rules:2},model:{calls:7,promptTokens:21000,completionTokens:1500,cacheHitTokens:9000,avgSeconds:6.2,promptCharsSaved:64},
  tools:[{key:'compare_market',count:3}],deniedTools:1,skills:[{title:'销售方案',how:'tool',count:3}],verification:{answers:5,numbers:40,traced:36},feedback:{helpful:2,unhelpful:1},learnedSkills:{active:1,pending:1,needsReview:0}};
const library={items:[
  {id:'skill-a',siteId:'demo-hainan',scope:'park',title:'台风天销售',triggers:['台风','运力'],tools:['compare_market'],instruction:'先按台风情景重算。',status:'pending',version:1,uses:0,helpful:0,unhelpful:0,source:{message:'台风'},createdBy:'manager-hn'},
  {id:'skill-b',siteId:null,scope:'shared',title:'公共技能',triggers:['欧盟'],tools:['read_eudr_readiness'],instruction:'先查批次。',status:'needs_review',version:2,uses:5,helpful:1,unhelpful:3,source:{message:'欧盟'},createdBy:'center-hz'}]};

test('ledger shows runs, cost, prompt savings, tracing and feedback; park managers approve only park skills',async()=>{
  const h=harness(ledgerSource,{account:manager,data:path=>path.startsWith('/api/brain/harness')?ledger:library});
  let tree=h.render({siteId:'demo-hainan'});const content=text(tree);
  assert.match(content,/对话轮次5模型 3 · 规则 2 · 失败 1/);
  assert.match(content,/省 64%/);
  assert.match(content,/90%40 个数字 \/ 5 个回答/);
  assert.match(content,/越权调用被拒 1 次/);
  assert.match(content,/反馈不佳，已暂停待修订/);
  assert.equal(walk(tree,node=>node.type==='button'&&text(node)==='批准').length,1,'the shared skill needs the center');
  await button(tree,'批准').props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/assistant/skills/skill-a/decision',input:{decision:'approve'}}]);
  button(tree,'修订').props.onClick();tree=h.render({siteId:'demo-hainan'});
  walk(tree,node=>node.type==='textarea')[0].props.onChange({target:{value:'台风预警先减产，运力减半分两批出货。'}});
  tree=h.render({siteId:'demo-hainan'});
  await button(tree,'保存修订（重新审批）').props.onClick();
  assert.deepEqual(h.posts[1],{path:'/api/assistant/skills/skill-a/revise',input:{instruction:'台风预警先减产，运力减半分两批出货。',triggers:['台风','运力']}});
});
