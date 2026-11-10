import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {refreshError,refreshStatusLabel,refreshCovers,strategyRefreshPath,hasNewStrategy} from '../src/integration/strategyRefreshState.ts';
import {treeAnalysisState} from '../src/integration/treeAnalysisState.ts';

const {code}=await transformWithOxc(readFileSync(new URL('../src/integration/StrategyRefreshStatus.tsx',import.meta.url),'utf8'),'StrategyRefreshStatus.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const source=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
const state={enabled:true,intervalMinutes:60,startupCatchUp:true,status:'idle',lastStartedAt:'2026-10-29T00:00:00Z',lastFinishedAt:'2026-10-29T00:02:00Z',nextRunAt:'2026-10-29T01:00:00Z',scope:{siteIds:['demo-hainan','demo-xsbn'],kinds:['tapping_angle','park_plan']},items:[{kind:'tapping_angle',label:'割胶角度',status:'succeeded',lastSuccessAt:'2026-10-29T00:01:00Z'}]};
function render({data=state,error,site='hainan',kind,view}={}){
 const reads=[];
 const Component=new Function('React','useRead','siteIdOf','strategyRefreshPath','refreshError','refreshStatusLabel','treeAnalysisState',source+';return StrategyRefreshStatus;')(React,(path,options)=>{reads.push({path,options});return {data,error,reload(){}};},site=>'demo-'+site,strategyRefreshPath,refreshError,refreshStatusLabel,treeAnalysisState);
 return {html:renderToStaticMarkup(React.createElement(Component,{site,kind,view})),reads};
}
test('background status reads only the selected park and distinguishes hourly generation from human adoption',()=>{
 const {html,reads}=render({site:'xsbn',kind:'tapping_angle'});
 assert.deepEqual(reads,[{path:'/api/strategy-refresh/status?siteId=demo-xsbn',options:{pollMs:30000}}]);
 assert.match(html,/每 60 分钟更新；启动时补齐缺失或过期结果/);
 assert.match(html,/采用策略与派单仍需人工确认/);
 assert.match(html,/本类最近成功：.*08:01/);
 assert.match(html,/下次检查：.*09:00/);
 assert.match(html,/割胶角度：已更新/);
});
test('paused, failed and unreadable status cannot claim a fresh successful strategy',()=>{
 const paused=render({data:{...state,status:'paused'}}).html;
 assert.match(paused,/后台策略更新：已暂停/);assert.doesNotMatch(paused,/下次检查/);
 const failed=render({data:{...state,status:'partial',lastError:{message:'生产计划生成超时'}}}).html;
 assert.match(failed,/部分更新未完成/);assert.match(failed,/生产计划生成超时/);assert.match(failed,/后台会继续检查/);
 const unavailable=render({data:null,error:'连接中断'}).html;
 assert.match(unavailable,/状态暂不可读/);assert.match(unavailable,/连接中断/);assert.doesNotMatch(unavailable,/每 60 分钟|等待下次更新/);
});
test('a completed strategy category does not inherit another category missing-data warning',()=>{
 const html=render({kind:'tapping_angle',data:{...state,status:'partial',lastError:{message:'生长策略缺少必要业务数据'}}}).html;
 assert.match(html,/后台策略更新：已更新/);assert.doesNotMatch(html,/生长策略缺少|部分更新未完成/);
});
test('coverage follows enrolled parks and kinds rather than a hard-coded Hainan tree list',()=>{
 assert.equal(refreshCovers(state,'demo-xsbn','tapping_angle'),true);
 assert.equal(refreshCovers(state,'demo-xsbn','pest_risk'),false);
 assert.equal(refreshCovers(state,'demo-guangdong-maoming','tapping_angle'),false);
 assert.equal(refreshCovers({...state,enabled:false},'demo-hainan','park_plan'),false);
});
test('an older polling response is not presented as a newer background result',()=>{
 assert.equal(hasNewStrategy('new','old','2026-10-29T02:00:00Z','2026-10-29T01:00:00Z'),false);
 assert.equal(hasNewStrategy('old','new','2026-10-29T01:00:00Z','2026-10-29T02:00:00Z'),true);
 assert.equal(hasNewStrategy('same','same'),false);
 assert.equal(hasNewStrategy(undefined,'new'),false);
});

const complexView={strategyStatus:'available',strategyRoute:{status:'needs_big_brain',reason:'树表检测发现'},run:{status:'succeeded',generatorMode:'demo_rules'},strategy:{modelVersion:null}};
test('tree scope and a running category do not falsely claim that this tree called the model',()=>{
 const active={...state,status:'running',treeModelsEnabled:true,items:[{kind:'tapping_angle',status:'running',error:{message:'本轮额度已用完，稍后继续'}}]};
 const {html}=render({data:active,kind:'tapping_angle',view:complexView});
 assert.match(html,/本树分析：等待后台自动分析/);
 assert.match(html,/当前显示规则结果，尚未采用大脑结果/);
 assert.match(html,/尚无本树本维度正在调用的记录/);
 assert.match(html,/本轮额度已用完/);
 assert.doesNotMatch(html,/本树分析：大脑正在分析|自动任务已覆盖/);
 const legacy=render({kind:'tapping_angle',view:complexView}).html;
 assert.match(legacy,/自动大脑分析尚未启用/);assert.doesNotMatch(legacy,/等待后台自动分析/);
 const otherPark=render({data:active,kind:'tapping_angle',site:'guangdong-maoming',view:complexView}).html;
 assert.doesNotMatch(otherPark,/等待后台自动分析/);
});
test('tree analysis status follows actual queue, model result, fallback and failure',()=>{
 const result=view=>render({kind:'tapping_angle',data:{...state,treeModelsEnabled:true},view:{...complexView,...view}}).html;
 assert.match(result({strategyStatus:'pending',strategy:null,run:{status:'queued',generatorMode:'configured'}}),/大脑分析正在排队/);
 assert.match(result({strategyStatus:'pending',strategy:null,run:{status:'running',generatorMode:'configured'}}),/本树分析：大脑正在分析/);
 assert.match(result({strategyStatus:'pending',strategy:null,run:{status:'running',generatorMode:'demo_rules'}}),/本树分析：规则建议正在生成/);
 const model=result({strategy:{modelVersion:'model-1',generationMetadata:{provider:'dashscope',model:'model-1'}},run:{status:'succeeded',generatorMode:'configured'}});
 assert.match(model,/本树分析：大脑结果已生成/);assert.match(model,/生成来源：dashscope \/ model-1/);assert.doesNotMatch(model,/等待后台自动分析/);
 const fallback=result({strategy:{modelVersion:null,fallback:{message:'候选结果未通过独立校验'}},run:{status:'succeeded',generatorMode:'configured'}});
 assert.match(fallback,/本树分析：当前为规则保底结果/);assert.match(fallback,/未通过独立校验/);assert.doesNotMatch(fallback,/大脑结果已生成/);
 assert.match(result({strategyStatus:'failed',strategy:null,error:{message:'模型服务超时'},run:{status:'failed',generatorMode:'configured'}}),/本轮大脑分析失败.*模型服务超时/);
 assert.match(result({strategyStatus:'needs_data',strategy:null,strategyRoute:{status:'blocked',reason:'缺少树围'}}),/等待补充资料.*缺少树围/);
});
test('paused and unknown automatic states keep model work and provenance distinct',()=>{
 const paused=render({kind:'tapping_angle',data:{...state,treeModelsEnabled:true,status:'paused'},view:complexView}).html;
 assert.match(paused,/本树分析：大脑自动分析已暂停/);assert.doesNotMatch(paused,/本树分析：等待后台自动分析/);
 const unknown=render({kind:'tapping_angle',data:null,error:'断线',view:complexView}).html;
 assert.match(unknown,/正在核验后台自动分析状态/);assert.doesNotMatch(unknown,/自动大脑分析尚未启用/);
});
test('human adopted, skipped and withdrawn decisions are not presented as waiting for automatic replacement',()=>{
 for(const [automaticSkipReason,label] of [['angle_adopted','人工已处理，后台保留当前决定'],['review_skip','人工已处理，后台保留当前决定'],['withdrawn','建议已人工撤回']]){
   const {html}=render({kind:'tapping_angle',data:{...state,treeModelsEnabled:true},view:{...complexView,automaticSkipReason}});
   assert.ok(html.includes(label));assert.doesNotMatch(html,/等待后台自动分析/);
 }
 const withdrawn=render({kind:'tapping_angle',data:{...state,treeModelsEnabled:true},view:{...complexView,strategyStatus:'withdrawn',strategy:null}}).html;
 assert.match(withdrawn,/建议已人工撤回/);
 const circuit=render({data:{...state,lastError:{message:'模型服务异常，等待在大脑管理中恢复自动分析'}}}).html;
 assert.match(circuit,/请按提示恢复后等待后台检查/);assert.doesNotMatch(circuit,/下一周期重试/);
});
