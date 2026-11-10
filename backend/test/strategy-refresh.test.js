import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {StrategyRefresh} from '../src/strategy-refresh.js';

function fixture(options={}) {
  const store=new Store(':memory:');let now=new Date('2026-10-29T02:00:00.000Z');
  const calls=[];
  const service=new StrategyRefresh({store,clock:()=>now,config:{enabled:true,intervalMinutes:60,startupCatchUp:true,siteIds:['demo-hainan'],...options.config},
    prepareSnapshots:async data=>{calls.push(['snapshots',data.siteId,data.reason]);},
    prepareSiteSnapshots:async data=>{calls.push(['internal',data.siteId,data.reason]);},
    refreshProduction:async(siteId,authorize)=>{authorize();calls.push(['production',siteId]);return {id:'new-plan'};},
    refreshMarket:async siteId=>{calls.push(['market',siteId]);return {id:'new-market'};},
    ...options.dependencies});
  return {store,service,calls,advance:ms=>{now=new Date(+now+ms);},async close(){await service.stop();store.close();}};
}
async function settle(service){for(let n=0;n<20;n++){await service.tick();await new Promise(resolve=>setImmediate(resolve));if(!service.running&&!service.pending.size)return;}throw Error('refresh did not settle');}

test('startup generates in order and hourly work never adopts or writes operational tables',async()=>{
  const f=fixture();try{
    f.service.start();await settle(f.service);
    assert.deepEqual(f.calls.map(row=>row[0]),['snapshots','production','market']);
    assert.equal(f.service.status('demo-hainan').status,'idle');
    assert.equal(f.service.status().nextRunAt,'2026-10-29T03:00:00.000Z');
    f.advance(59*60000);await f.service.tick();assert.equal(f.calls.length,3);
    f.advance(60000);await settle(f.service);assert.equal(f.calls.length,6);
    assert.equal(f.calls[3][2],'scheduled');
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs').get().n,0);
  }finally{await f.close();}
});

test('a fresh saved plan and sales model survive startup without paid regeneration, but refresh on schedule',async()=>{
  const f=fixture({dependencies:{productionFresh:()=>true,marketFresh:()=>true}});try{
    f.service.start();await settle(f.service);assert.deepEqual(f.calls.map(row=>row[0]),['snapshots']);
    assert.equal(f.service.status().items.find(row=>row.kind==='park_plan').status,'current');
    f.advance(3600000);await settle(f.service);assert.deepEqual(f.calls.map(row=>row[0]),['snapshots','snapshots','production','market']);
  }finally{await f.close();}
});

test('overlapping ticks are coalesced and new sites use internal preparation without widening login permissions',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let snapshotCalls=0;
  const f=fixture({dependencies:{prepareSnapshots:async()=>{snapshotCalls++;await gate;}}});try{
    f.service.start();const first=f.service.tick(),second=f.service.tick();assert.equal(snapshotCalls,1);
    f.service.activateSite('demo-guangdong-maoming');f.service.activateSite('demo-guangdong-maoming');
    release();await Promise.all([first,second]);await settle(f.service);
    assert.equal(snapshotCalls,1);assert.equal(f.calls.filter(row=>row[0]==='internal').length,1);
    assert.equal(f.calls.filter(row=>row[0]==='production').length,2);
    assert.deepEqual(f.service.status().scope.siteIds,['demo-hainan','demo-guangdong-maoming']);
  }finally{await f.close();}
});

test('a production failure keeps other updates usable and is retried only on the next hourly cycle',async()=>{
  let attempts=0;const f=fixture({dependencies:{refreshProduction:async()=>{attempts++;throw Object.assign(Error('模型未返回有效 JSON'),{code:'PARK_MODEL_INVALID_PROPOSAL'});}}});try{
    f.service.start();await settle(f.service);
    const status=f.service.status();assert.equal(status.status,'partial');assert.equal(status.lastError.code,'PARK_MODEL_INVALID_PROPOSAL');
    assert.equal(status.items.find(row=>row.kind==='market_sales').status,'succeeded');
    await f.service.tick();assert.equal(attempts,1);
    f.advance(3600000);await settle(f.service);assert.equal(attempts,2);
  }finally{await f.close();}
});

test('automatic pause survives service reconstruction; model pause leaves free snapshots and comparisons available',async()=>{
  const f=fixture();try{
    f.service.setPaused(true);f.service.start();await f.service.tick();assert.equal(f.calls.length,0);
    assert.equal(f.service.status().status,'paused');
    f.store.setModelPaused(true,'2026-10-29T02:00:00.000Z');f.service.setPaused(false);await settle(f.service);
    assert.deepEqual(f.calls.map(row=>row[0]),['snapshots','market']);
    assert.equal(f.service.status().items.find(row=>row.kind==='park_plan').status,'paused');
    f.service.setPaused(true);await f.service.stop();
    const restarted=new StrategyRefresh({store:f.store,config:{enabled:true}});assert.equal(restarted.status().paused,true);await restarted.stop();
  }finally{await f.close();}
});

test('offline demo skips only the model plan and Xi’an remains a trial site without production or sales plans',async()=>{
  const f=fixture({config:{modelsEnabled:false}});try{
    f.service.start();await settle(f.service);
    assert.equal(f.service.status().status,'idle');
    assert.equal(f.service.status().items.find(row=>row.kind==='park_plan').status,'skipped');
    assert.deepEqual(f.calls.map(row=>row[0]),['snapshots','market']);
    f.service.activateSite('demo-xian');await settle(f.service);
    assert.deepEqual(f.calls.at(-1),['internal','demo-xian','site_activated']);
    assert.ok(!f.service.status('demo-xian').items.some(row=>['park_plan','market_sales'].includes(row.kind)));
  }finally{await f.close();}
});

test('a tree model circuit is shown as paused and explicit recovery runs startup catch-up without waiting an hour',async()=>{
  const f=fixture({config:{treeModelsEnabled:true}});try{
    f.service.start();await settle(f.service);
    assert.equal(f.calls.filter(row=>row[0]==='snapshots').length,1);
    assert.equal(f.service.status().nextRunAt,'2026-10-29T03:00:00.000Z');
    const circuitReason={code:'LLM_ACCOUNT_UNAVAILABLE',message:'模型账户暂不可用'};
    f.store.saveAutomaticState({...f.store.getAutomaticState(),circuitReason});
    const blocked=f.service.status('demo-hainan');
    assert.equal(blocked.status,'paused');assert.equal(blocked.paused,true);assert.equal(blocked.nextRunAt,null);
    assert.deepEqual(blocked.lastError,circuitReason);
    await f.service.tick();assert.equal(f.calls.filter(row=>row[0]==='snapshots').length,1);
    f.store.saveAutomaticState({...f.store.getAutomaticState(),circuitReason:null,consecutiveFailures:0});
    f.service.setPaused(false);await settle(f.service);
    const snapshots=f.calls.filter(row=>row[0]==='snapshots');
    assert.equal(snapshots.length,2);assert.equal(snapshots[1][2],'startup','resume rechecks pending/expired work immediately');
    assert.equal(f.service.status().status,'idle');assert.equal(f.service.status().paused,false);
    assert.equal(f.service.status().lastStartedAt,'2026-10-29T02:00:00.000Z','test clock never advanced to the hourly deadline');
  }finally{await f.close();}
});
