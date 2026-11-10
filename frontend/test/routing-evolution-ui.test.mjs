import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst,transformWithOxc} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/RoutingEvolutionPanel.tsx',import.meta.url),'utf8'),'RoutingEvolutionPanel.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
function walk(node,predicate){if(typeof node==='function')return [];if(!React.isValidElement(node))return [];const own=predicate(node)?[node]:[];if(typeof node.type==='function'){return [...own,...walk(node.type(node.props),predicate)];}return [...own,...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];}
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!React.isValidElement(node))return '';if(typeof node.type==='function')return text(node.type(node.props));return React.Children.toArray(node.props.children).map(text).join('');}
const group=(patch={})=>({kind:'tapping_angle',kindLabel:'单树割胶参数',signature:'health_finding+inspection_finding',signals:['健康记录异常','树表检测发现'],samples:414,compared:219,agree:219,disagree:0,fallback:195,failed:0,
  agreementRate:1,fallbackRate:0.471,llmCalls:600,tokens:1600000,latestAt:'2026-10-20T10:00:00Z',locked:'割线坡角由校验器锁定为后端角度计算值',verdict:'delegate',verdictLabel:'建议下沉给小脑',
  explanation:'大脑通过校验的 219 次里有 219 次与小脑规则结论一致（100%）',eligible:true,delegation:null,examples:{agree:[],disagree:[],fallback:[]},...patch});
const data=(patch={})=>({siteId:'demo-hainan',park:'海口',headline:'对照 867 次大脑记录：可以下沉',auditEvery:5,
  rules:{minSamples:10,minAgreement:0.95,unreliableFallback:0.8,auditMinSamples:5,auditMaxDisagreement:0.05},
  totals:{brainRuns:867,compared:498,agree:488,fallback:246,llmCalls:1263,tokensPerCall:7706},
  groups:[group(),group({kind:'pest_risk',kindLabel:'病虫害风险',signature:'health_finding',signals:['健康记录异常'],agree:37,disagree:5,compared:42,agreementRate:0.881,verdict:'keep_brain',verdictLabel:'保留在大脑',explanation:'大脑有 5 次给出与小脑不同的结论',eligible:false,locked:null})],
  delegations:[],loop:['对照','归类','提案','审批','抽检'],limitations:['一致不等于正确'],...patch});
function mount(value,{canPropose=true,canApprove=true}={}){
  const posts=[];let cursor=0;const slots=[];
  const bindings={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=v;}];},
    useRead:()=>({data:value,reload:()=>{}}),post:async(path,input)=>{posts.push({path,input});return {};},React};
  const {RoutingEvolutionPanel}=new Function(...Object.keys(bindings),declarations+';return {RoutingEvolutionPanel};')(...Object.values(bindings));
  return {render:()=>{cursor=0;return RoutingEvolutionPanel({siteId:'demo-hainan',canPropose,canApprove});},posts};
}
const buttons=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node)===label);

test('routing panel lists evidence per trigger combination and proposes only eligible ones',async()=>{
  const h=mount(data());const tree=h.render(),content=text(tree);
  assert.match(content,/1263 次模型调用（平均每次约 7706 token）/);
  assert.match(content,/219\/219（100%）/);
  assert.match(content,/195（47%）/);
  assert.match(content,/校验器锁定/);
  assert.match(content,/保留在大脑/);
  assert.equal(buttons(tree,'提议下沉').length,1);
  await buttons(tree,'提议下沉')[0].props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/brain/routing/propose',input:{siteId:'demo-hainan',kind:'tapping_angle',signature:'health_finding+inspection_finding'}}]);
  assert.match(text(h.render()),/已提议把“单树割胶参数·健康记录异常\+树表检测发现”下沉给小脑/);
  assert.equal(buttons(mount(data(),{canPropose:false}).render(),'提议下沉').length,0);
});

test('pending hand-downs need an approver; active ones show the audit review and can be revoked',async()=>{
  const pending={id:'route-1',status:'pending',kind:'tapping_angle',signature:'x',label:'单树割胶参数·健康记录异常',summary:'一致',effect:'批准后由小脑处理',safety:'可随时收回',evidence:{},createdAt:'2026-10-21T00:00:00Z'};
  const active={...pending,id:'route-2',status:'active',decidedBy:'manager-hn',decidedAt:'2026-10-21T01:00:00Z',review:{status:'reviewed',verdict:'revoke_suggested',summary:'抽检 6 次，不一致 1 次，建议收回给大脑。',handedDown:20,audits:6}};
  const h=mount(data({delegations:[pending,active],groups:[group({delegation:{id:'route-2',status:'active'}})]}));
  const tree=h.render(),content=text(tree);
  assert.match(content,/待审批 · 单树割胶参数·健康记录异常/);
  assert.match(content,/抽检复盘：抽检 6 次，不一致 1 次，建议收回给大脑/);
  assert.match(content,/已下沉/);
  assert.equal(buttons(tree,'提议下沉').length,0);
  await buttons(tree,'批准下沉')[0].props.onClick();
  await buttons(tree,'收回给大脑')[0].props.onClick();
  assert.deepEqual(h.posts.map(item=>item.path),['/api/brain/routing/route-1/decision','/api/brain/routing/route-2/revoke']);
  assert.deepEqual(h.posts[0].input,{decision:'approve'});
  const viewer=mount(data({delegations:[pending]}),{canApprove:false}).render();
  assert.equal(buttons(viewer,'批准下沉').length,0);
  assert.match(text(viewer),/只有园区管理或中心可以审批/);
});
