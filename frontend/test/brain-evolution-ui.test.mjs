import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst,transformWithOxc} from 'vite';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/BrainEvolutionPanel.tsx',import.meta.url),'utf8'),'BrainEvolutionPanel.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const declarations=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
function walk(node,predicate){if(typeof node==='function')return [];if(!React.isValidElement(node))return [];const own=predicate(node)?[node]:[];if(typeof node.type==='function'){return [...own,...walk(node.type(node.props),predicate)];}return [...own,...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];}
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!React.isValidElement(node))return '';if(typeof node.type==='function')return text(node.type(node.props));return React.Children.toArray(node.props.children).map(text).join('');}
const metrics=(patch={})=>({days:53,rainyMornings:7,tappedDays:42,correctTap:0,correctDefer:7,falseDefer:4,miss:0,extraReview:42,cost:12.4,...patch});
const evolution={siteId:'demo-hainan',park:'海口',activeVersion:'default',headline:'回放',
  experience:{source:'measured',sourceNote:'Open-Meteo 历史预报',start:'2026-08-22',end:'2026-10-20',days:60,retrievedAt:'2026-10-21',stale:false,rainyMornings:7},
  costModel:{miss:3,falseDefer:1,extraReview:0.2},truth:{windowMm:1,hourlyMm:0.5},baseline:metrics(),
  explored:[{key:'recentWetSpellMm',label:'近7日连阴雨判定',direction:'up',firstStep:{to:8,cost:12.4},best:{to:14,steps:3,cost:11.2},gain:1.2}],
  recommendation:{label:'近7日连阴雨判定',unit:'mm',from:5,to:8,firstStep:metrics(),best:{to:14,steps:3,metrics:metrics({extraReview:36,cost:11.2})},gain:1.2,summary:'近7日连阴雨判定 5→8mm：回放成本 12.4→12.4；同方向调到 14mm（3 步）可降到 11.2，下一轮复盘后再走。'},
  pendingProposal:null,review:{status:'default',summary:'仍使用默认参数，尚无上线版本需要复盘。'},generations:[],
  routing:{kindLabel:'单树割胶参数',total:200,smallBrain:120,bigBrain:60,blocked:20,bigBrainReasons:[{key:'health_finding',label:'健康记录异常',count:40}],blockedReasons:[{key:'circumference',label:'树围缺失',count:20}]},
  loop:['经验','回放','提案','审批','复盘'],limitations:['只回放三项阈值']};
function mount(data,{canPropose=true}={}){
  const posts=[],changes=[];let cursor=0;const slots=[];
  const bindings={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=value;}];},
    useRead:path=>({data,reload:()=>{},path}),post:async(path,input)=>{posts.push({path,input});return {proposal:{expectedEffect:'近7日连阴雨判定 5→8mm'}};},React};
  const {BrainEvolutionPanel,ProposalReplay}=new Function(...Object.keys(bindings),declarations+';return {BrainEvolutionPanel,ProposalReplay};')(...Object.values(bindings));
  const render=()=>{cursor=0;return BrainEvolutionPanel({siteId:'demo-hainan',canPropose,onChanged:()=>changes.push(1)});};
  return {render,posts,changes,ProposalReplay};
}

test('loop panel shows routing, real-weather replay, one-step recommendation and generations',async()=>{
  const h=mount(evolution);let tree=h.render();const content=text(tree);
  assert.match(content,/小脑直接给出120 棵/);
  assert.match(content,/交给大脑60 棵/);
  assert.match(content,/健康记录异常 40/);
  assert.match(content,/过去 53 个早晨回放小脑规则/);
  assert.match(content,/真实天气/);
  assert.match(content,/同方向调到 14mm（3 步）/);
  assert.match(content,/第 0 代：默认参数/);
  const button=walk(tree,node=>node.type==='button'&&text(node)==='按回放结果生成提案')[0];
  await button.props.onClick();
  assert.deepEqual(h.posts,[{path:'/api/brain/evolution/propose',input:{siteId:'demo-hainan'}}]);
  assert.equal(h.changes.length,1);
  assert.match(text(h.render()),/已生成待审批提案/);
});

test('no button for viewers, pending proposals or when no improvement exists; worse replays warn',()=>{
  assert.equal(walk(mount(evolution,{canPropose:false}).render(),node=>node.type==='button').length,0);
  assert.match(text(mount({...evolution,pendingProposal:{id:'p',expectedEffect:'x',verdict:'better'}}).render()),/已有待审批提案/);
  assert.match(text(mount({...evolution,recommendation:null}).render()),/继续使用当前参数，暂无更优调整/);
  const {ProposalReplay}=mount(evolution);
  const worse=ProposalReplay({replay:{source:'measured',sourceNote:'',from:'2026-08-29',to:'2026-10-20',before:metrics(),after:metrics({falseDefer:6,cost:14.4}),verdict:'worse',
    changedDays:[{date:'2026-10-05',before:'可割',after:'暂缓',rained:false,actualWindowMm:0,effect:'多余复核 → 误停'}]}});
  const content=text(worse);
  assert.match(content,/回放更差/);
  assert.match(content,/须在审批说明中写明理由/);
  assert.match(content,/2026-10-05：可割 → 暂缓/);
});
