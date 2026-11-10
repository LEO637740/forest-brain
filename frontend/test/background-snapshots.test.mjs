import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHarnessSnapshots,preparationSessionName} from '../scripts/prepare-harness.mjs';
import {prepareIndustry} from '../scripts/prepare-industry.mjs';

const now=Date.parse('2026-10-29T00:00:00Z');
function fixture(siteId,{skipTrees=false}={}){
  const calls=[];let n=0;
  const call=async(path,body)=>{
    calls.push({path,body});
    if(path.startsWith('/api/demo/trees/manifest'))return {siteId,items:[{treeId:'T-0001'},{treeId:'T-0002'}]};
    if(path==='/api/demo/trees/prepare')return {items:skipTrees?[]:body.treeIds.map(treeId=>({treeId,runId:'tree-'+ ++n})),skipped:skipTrees?body.treeIds.map(treeId=>({treeId,reason:'current_available'})):[]};
    if(path==='/api/demo/scenarios/run')return {items:[{scenarioId:'morning',runId:'morning-run',siteId}]};
    if(path==='/api/demo/contexts')return {siteId,targetSnapshotId:'target',inputSnapshot:{snapshotId:'input',version:1}};
    if(path==='/internal/harness/runs')return {runId:'run-'+ ++n};
    if(path.startsWith('/internal/harness/runs/'))return {status:'succeeded',request:{siteId,generatorMode:'demo_rules'},result:{strategy:{expiresAt:new Date(now+3600000).toISOString()}}};
    throw Error('Unexpected '+path);
  };
  return {calls,call};
}

test('background snapshot script carries selected park and reason through every scoped write without replacing the Hainan file',async()=>{
  const siteId='demo-xsbn',f=fixture(siteId);
  const result=await prepareHarnessSnapshots(f.call,{siteId,dataMode:'demo',reason:'scheduled',stamp:'test',now:()=>now,sleep:async()=>{}});
  const writes=f.calls.filter(c=>c.body);
  assert.ok(writes.length>0);assert.ok(writes.every(c=>c.body.siteId===siteId));
  assert.ok(f.calls[0].path.includes('siteId=demo-xsbn'));
  const trees=writes.filter(c=>c.path==='/api/demo/trees/prepare');assert.equal(trees.length,4);
  assert.ok(trees.every(c=>c.body.background===true&&c.body.refreshReason==='scheduled'&&c.body.preserveConfigured===true&&c.body.generatorMode==='demo_rules'));
  assert.equal(result.siteId,siteId);assert.equal(result.summary.prepared,8);assert.equal(result.summary.modelRequests,0);
  assert.ok(writes.every(c=>!c.path.includes('adopt')&&!c.path.includes('task-receipts')&&!c.path.includes('control')));
  assert.equal(preparationSessionName('demo-hainan'),'harness-session.json');
  assert.equal(preparationSessionName(siteId),'harness-session-demo-xsbn.json');
});

test('startup reuses current scenario snapshots while the backend fills only missing tree views',async()=>{
  const siteId='demo-xsbn',f=fixture(siteId,{skipTrees:true});
  const previous={siteId,jobs:['morning','market','park-health'].map(key=>({key,runId:key+'-old'}))};
  const result=await prepareHarnessSnapshots(f.call,{siteId,dataMode:'demo',reason:'startup',stamp:'startup',now:()=>now,previous,sleep:async()=>{}});
  assert.equal(result.summary.prepared,0);assert.equal(result.summary.preserved,8);
  assert.deepEqual(result.jobs.map(x=>x.runId),previous.jobs.map(x=>x.runId));
  assert.ok(!f.calls.some(c=>c.path==='/api/demo/scenarios/run'||c.path==='/api/demo/contexts'||c.path==='/internal/harness/runs'));
});

test('fusion delegates tree preparation to the internal routed worker without duplicate script jobs',async()=>{
  const f=fixture('demo-xsbn');
  const result=await prepareHarnessSnapshots(f.call,{siteId:'demo-xsbn',includeTrees:false,dataMode:'demo',now:()=>now,sleep:async()=>{}});
  assert.ok(!f.calls.some(row=>row.path==='/api/demo/trees/prepare'));
  assert.ok(f.calls.some(row=>row.path==='/api/demo/scenarios/run'));
  assert.equal(result.summary.prepared,0);
});

test('failed or cancelled preparation rejects with the real error; expected missing data is reported as partial',async()=>{
  for(const status of ['failed','cancelled','needs_data']){
    const siteId='demo-xsbn',f=fixture(siteId);
    const call=async(path,body)=>path.startsWith('/internal/harness/runs/tree-')?{status,request:{kind:'tapping_angle'},result:{error:{message:'测试真实生成错误'},missingData:[{field:'circumferenceCm'}]}}:f.call(path,body);
    const promise=prepareHarnessSnapshots(call,{siteId,dataMode:'demo',reason:'scheduled',stamp:status,now:()=>now,sleep:async()=>{}});
    if(status==='needs_data'){
      const result=await promise;const item=result.items.find(x=>x.kind==='tapping_angle');assert.equal(item.status,'partial');assert.ok(item.needsData>0);assert.match(item.error,/缺少必要业务数据/);
    }else await assert.rejects(promise,/测试真实生成错误/);
  }
});

test('startup replaces a saved session reference missing from the current database',async()=>{
  const siteId='demo-xsbn',f=fixture(siteId,{skipTrees:true});
  const call=(path,body)=>{if(path==='/internal/harness/runs/missing-run')throw Object.assign(Error('missing run'),{status:404});return f.call(path,body);};
  const result=await prepareHarnessSnapshots(call,{siteId,dataMode:'demo',reason:'startup',stamp:'missing',now:()=>now,previous:{siteId,jobs:[{key:'morning',runId:'missing-run'}]},sleep:async()=>{}});
  assert.equal(result.jobs.find(x=>x.key==='morning').runId,'morning-run');
  assert.ok(f.calls.some(x=>x.path==='/api/demo/scenarios/run'&&x.body.scenarioId==='morning'));
});

test('expired configured industry advice permits labelled rule renewal; withdrawal remains authoritative',async()=>{
  for(const withdrawn of [false,true]){
    const writes=[];
    const result=await prepareIndustry(async(path,body)=>{
      if(body)writes.push({path,body});
      if(path.includes('generatorMode=configured'))return {items:[{runId:'expired-model',status:'succeeded',result:{strategy:{expiresAt:new Date(now-1000).toISOString(),qualityReview:{status:withdrawn?'withdrawn':'pending'}}}}]};
      if(path.includes('generatorMode=demo_rules'))return {items:[]};
      if(path==='/api/sources/industry-context')return {siteId:'public-rubber-industry',targetSnapshotId:'public-target',inputSnapshot:{snapshotId:'public-input',version:1}};
      return {runId:'new-rule'};
    },{dataMode:'mixed_demo',stamp:'industry',now,reason:'scheduled'});
    if(withdrawn){assert.equal(result.runId,'expired-model');assert.equal(writes.length,0);}
    else{assert.equal(result.runId,'new-rule');assert.match(result.title,/规则/);assert.equal(writes.length,2);assert.equal(writes[1].body.generatorMode,'demo_rules');assert.equal(writes[1].body.siteId,'public-rubber-industry');}
  }
});
