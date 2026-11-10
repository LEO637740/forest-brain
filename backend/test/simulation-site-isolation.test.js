import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { SimulationService } from '../src/simulation.js';
import { HarnessRuntime } from '../src/runtime.js';
import { LocalContextProvider } from '../src/adapters/context.js';
import { makeParkContext } from '../src/adapters/park-demo.js';

function setup(){
  const now=new Date('2026-10-17T02:00:00.000Z'),clock=()=>now,store=new Store();
  const simulation=new SimulationService(store,clock),runtime=new HarnessRuntime({store,contextProvider:new LocalContextProvider(store),clock});
  let sequence=0;
  return {store,simulation,now,
    async strategy(siteId,kind='tapping_angle'){
      const c=makeParkContext({treeIds:['T-0001'],siteId,now});store.saveContext(c);
      const requestId=`site-${++sequence}`,run=runtime.submit({requestId,kind,siteId:c.siteId,targetSnapshotId:c.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:c.snapshotId,version:1},executionMode:'simulation',generatorMode:'demo_rules'});
      if(kind!=='weather_window')store.bindTreeView({treeId:'T-0001',kind,dataMode:'demo',siteId:c.siteId,preparationId:requestId,requestId,runId:run.runId,contextSnapshotId:c.snapshotId,asOf:c.asOf});
      await runtime.idle();const result=store.getRun(run.runId).result;assert.equal(result.status,'succeeded');return result.strategy;
    },async close(){await runtime.stop();store.close();}
  };
}
const reference=(strategy,siteId)=>({treeId:'T-0001',strategyId:strategy.strategyId,runId:strategy.runId,revision:strategy.revision,dataMode:'demo',siteId});
const task=(id,site,extra={})=>({id,site,status:'待开始',count:1,done:0,treeIndices:[0],kind:'割胶',date:'2026-10-17',...extra});

test('same-numbered trees keep independent weather choices, including withdrawal and legacy Hainan records',async()=>{
  const f=setup();try{
    const hn=await f.strategy('hainan','weather_window'),xb=await f.strategy('xsbn','weather_window');
    const adopt=(s,id)=>f.simulation.record({requestId:id,kind:'adopt_weather',treeId:'T-0001',siteId:s.siteId,strategyId:s.strategyId,start:s.proposal.windows.find(w=>w.suitability==='suitable').start});
    const old=adopt(hn,'hn-weather'),other=adopt(xb,'xb-weather');
    assert.equal(f.simulation.effectiveConstraints().constraints[0].requestId,old.requestId);
    assert.equal(f.simulation.effectiveConstraints('xsbn').constraints[0].requestId,other.requestId);
    assert.deepEqual(f.simulation.effectiveConstraints('xian').constraints,[]);
    f.store.withdrawStrategy(xb.runId,'只撤回版纳建议',f.now.toISOString());
    assert.equal(f.simulation.effectiveConstraints('xsbn').constraints[0].validity.status,'withdrawn');
    assert.equal(f.simulation.effectiveConstraints('hainan').constraints[0].validity.valid,true);
    const legacy={...old,requestId:'legacy-weather'};delete legacy.siteId;
    f.store.db.prepare('INSERT INTO simulation_actions(request_id,tree_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(legacy.requestId,legacy.treeId,legacy.kind,JSON.stringify(legacy),f.now.toISOString());
    assert.equal(f.simulation.effectiveConstraints().constraints[0].requestId,'legacy-weather');
    assert.equal(f.simulation.effectiveConstraints('xsbn').constraints[0].requestId,other.requestId);
  }finally{await f.close();}
});

test('another park cannot crowd a local adoption out of the 200-record audit window',async()=>{
  const f=setup();try{
    const hn=await f.strategy('hainan'),xb=await f.strategy('xsbn');
    const write=(s,id)=>f.simulation.record({requestId:id,kind:'adopt_angle',treeId:'T-0001',strategyId:s.strategyId,siteId:s.siteId});
    const local=write(hn,'local');
    for(let i=0;i<205;i++)write(xb,`other-${i}`);
    assert.deepEqual(f.simulation.list('T-0001','hainan'),[local]);
    assert.equal(f.simulation.list('T-0001','xsbn').length,200);
    assert.ok(f.simulation.list(null,'xsbn').every(a=>a.siteId==='demo-xsbn'));
  }finally{await f.close();}
});

test('market plans reserve tree indices only within their own park',async()=>{
  const f=setup();try{
    for(const site of ['hainan','xsbn'])await f.strategy(site,'surface_action');
    const h=f.simulation.market({siteId:'hainan',treeCount:1,storageKg:2000,stockKg:100,heldKg:0,transportKgPerDay:40});
    const x=f.simulation.market({siteId:'xsbn',treeCount:1,storageKg:2000,stockKg:100,heldKg:0,transportKgPerDay:40});
    assert.ok(h.recommendedFrequency>0&&x.recommendedFrequency>0);
    const hn=f.simulation.createMarketTasks({modelId:h.id,siteId:'hainan'});
    const xb=f.simulation.createMarketTasks({modelId:x.id,siteId:'xsbn'});
    assert.equal(hn.eligibleTrees,1);assert.equal(xb.eligibleTrees,1);
    assert.ok(xb.tasks.length>0&&xb.tasks.every(t=>t.site==='xsbn'));
    assert.equal(f.simulation.latestMarket().model.id,h.id);
    assert.equal(f.simulation.latestMarket('xsbn').model.id,x.id);
    assert.equal(f.simulation.latestMarket('xian').model,null);
    const next=f.simulation.market({siteId:'hainan',treeCount:1,storageKg:2100,stockKg:100,heldKg:0,transportKgPerDay:40});
    const blocked=f.simulation.createMarketTasks({modelId:next.id});
    assert.deepEqual(blocked.tasks,[]);assert.deepEqual(blocked.exclusions,[{reason:'已在近期计划中',count:1}]);
  }finally{await f.close();}
});

test('explicit strategy scope rejects a same-numbered tree from another park before writing',async()=>{
  const f=setup();try{
    const s=await f.strategy('xsbn');
    assert.equal(f.simulation.validateStrategies({strategies:[reference(s,'xsbn')]}).items[0].valid,true);
    const rejected=f.simulation.validateStrategies({strategies:[reference(s,'hainan')]}).items[0];
    assert.equal(rejected.valid,false);assert.equal(rejected.status,'site_mismatch');assert.equal(rejected.siteId,'demo-xsbn');
    assert.throws(()=>f.simulation.record({requestId:'cross-adopt',kind:'adopt_angle',treeId:'T-0001',siteId:'hainan',strategyId:s.strategyId}),e=>e.code==='STRATEGY_CHANGED'&&e.details.status==='site_mismatch');
    assert.deepEqual(f.simulation.list(null),[]);
  }finally{await f.close();}
});

test('task scope uses site, preserves global synchronization and rejects contradictory site/source tags',async()=>{
  const f=setup();try{
    const accepted=f.simulation.tasks({tasks:[task('hn','hainan'),task('xb','xsbn',{siteId:'demo-xsbn'}),task('xa','xian')]});
    assert.equal(accepted.accepted,3);assert.equal(f.simulation.latestTasks().length,3);
    assert.deepEqual(f.simulation.latestTasks('xsbn').map(t=>t.id),['xb']);
    assert.deepEqual(f.simulation.tasks(undefined,'hainan').map(r=>r.task.id),['hn']);
    for(const bad of [task('bad','hainan',{siteId:'demo-xsbn'}),task('bad','hainan',{siteId:'unknown'}),task('bad','hainan',{railJob:{harnessSource:{siteId:'demo-xsbn'}}}),task('bad','xsbn',{railResult:{job:{harnessSource:{}}}})]){
      const result=f.simulation.tasks({tasks:[bad]});
      assert.equal(result.accepted,0);assert.equal(result.conflicts[0].code,'TASK_SITE_MISMATCH');
    }
    assert.equal(f.simulation.latestTasks().length,3);
  }finally{await f.close();}
});
