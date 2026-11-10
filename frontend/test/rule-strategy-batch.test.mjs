import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRuleStrategies,RULE_STRATEGY_KINDS} from '../src/integration/ruleStrategyBatch.ts';

test('rule advice for a zone goes out in batches of at most ten trees, each settled before the next, without any model call',async()=>{
  const posts=[],reads=new Map(),log=[];let pending=0;
  const deps={
    post:async(path,input)=>{assert.equal(path,'/api/demo/trees/prepare');assert.equal(pending,0,'previous batch settled first');posts.push(input);log.push('post');
      pending=input.treeIds.length;return {items:input.treeIds.map((treeId,index)=>({treeId,runId:`${input.preparationId}-${treeId}`,status:'queued',...(treeId==='T-0003'&&input.kind==='tapping_angle'?{preservedConfigured:true}:{} )}))};},
    read:async path=>{const seen=(reads.get(path)??0)+1;reads.set(path,seen);if(seen<2)return {status:'running'};pending--;return {status:path.endsWith('T-0007')?'needs_data':'succeeded'};},
    sleep:async()=>{},newId:(()=>{let n=0;return()=>String(++n);})(),onProgress:(done,total)=>log.push(`${done}/${total}`),
  };
  const treeIds=Array.from({length:50},(_,index)=>`T-${String(index+1).padStart(4,'0')}`);
  // The preserved configured result never enters the pending count.
  const result=await prepareRuleStrategies('demo-guangdong-maoming',treeIds,{...deps,post:async(path,input)=>{const r=await deps.post(path,input);pending-=r.items.filter(item=>item.preservedConfigured).length;return r;}});
  assert.equal(posts.length,20);
  assert.ok(posts.every(input=>input.treeIds.length<=10&&input.generatorMode==='demo_rules'&&input.siteId==='demo-guangdong-maoming'&&input.preserveConfigured===true));
  assert.deepEqual([...new Set(posts.map(input=>input.kind))],RULE_STRATEGY_KINDS);
  assert.equal(new Set(posts.map(input=>input.preparationId)).size,20);
  assert.deepEqual(result,{runs:199,succeeded:195,unsettled:0,other:4});
  assert.equal(log.at(-1),'20/20');
});
