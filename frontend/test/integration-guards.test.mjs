import test from 'node:test';
import assert from 'node:assert/strict';
import {createZoneScheduler,fleetBlockReason} from '../src/zoneFleet.ts';
import {TaskSync} from '../src/workspace/taskSync.ts';

const task=(extra={})=>({id:'rail-one',site:'hainan',status:'待开始',done:0,count:1,...extra});
const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
const epoch=Date.parse('2026-10-07T00:00:00Z');
const job=(extra={})=>({id:'rail-one',planVersion:'harness-1',angle:28,requestedAt:new Date(epoch).toISOString(),harnessSource:{treeId:'T-0001',strategyId:'strategy-1',runId:'run-1',revision:1,angle:28,expiresAt:new Date(epoch+60000).toISOString(),adoptedAt:new Date(epoch).toISOString(),mode:'simulation',dataMode:'mixed_demo'},...extra});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a newer server revision replaces the same local ID; completed receipt cannot regress',()=>{
 const sync=new TaskSync(),old=task({revision:1});
 sync.receive([old],[old]);
 const completed=task({revision:2,status:'已完成',done:1,railResult:{outcome:'completed'}});
 const merged=sync.receive([old],[completed]);
 assert.deepEqual(merged,[completed]);assert.deepEqual(sync.changes(merged),[]);
 assert.equal(sync.receive(merged,[old])[0],completed);
});
test('only changed tasks are submitted; acknowledgements preserve edits made in flight',()=>{
 const sync=new TaskSync(),original=task({revision:1}),second=task({id:'other',revision:1});
 sync.receive([original,second],[original,second]);
 const sent=task({revision:1,status:'执行中'});
 assert.deepEqual(sync.changes([sent,second]),[sent]);
 const during=task({revision:1,status:'已完成',done:1});
 const merged=sync.receive([during,second],[{...sent,revision:2},second],[sent]);
 assert.equal(merged[0].status,'已完成');assert.equal(merged[0].revision,2);
 assert.deepEqual(sync.changes(merged),[merged[0]]);
});
test('conflicting stale writes adopt authoritative task instead of retrying old state',()=>{
 const sync=new TaskSync(),stale=task({revision:1}),server=task({revision:3,status:'已完成',done:1});
 const merged=sync.receive([stale],[server],[stale],[{taskId:stale.id,message:'版本冲突',task:server}]);
 assert.deepEqual(merged,[server]);assert.deepEqual(sync.changes(merged),[]);
});
test('a persisted edit survives the first refresh and remains a compare-and-set write',()=>{
 const sync=new TaskSync(),server=task({revision:1}),local=task({revision:1,status:'执行中'});
 const merged=sync.receive([local],[server]);
 assert.equal(merged[0].status,'执行中');
 assert.deepEqual(sync.changes(merged),[local]);
});
test('a queued strategy expiring while paused never starts cutting',()=>{
 let now=epoch;const results=[];
 const scheduler=createZoneScheduler(routes,(_,j)=>results.push(j),()=>{},()=>now);
 scheduler.pause(0,true);scheduler.enqueue(0,job());now+=60001;scheduler.pause(0,false);
 for(let i=0;i<20;i++)scheduler.update(1);
 assert.equal(results.length,0);assert.deepEqual(scheduler.zones[0].queue,[0]);
 assert.match(fleetBlockReason(scheduler.jobs[0],now),/过期/);
});
for(const reason of ['策略已撤回','策略版本已更换'])test(`${reason} is checked at the cut boundary and blocks execution`,async()=>{
 let calls=0;const results=[];
 const scheduler=createZoneScheduler(routes,(_,j)=>results.push(j),()=>{},()=>epoch,async()=>{calls++;throw Error(reason);});
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.update(20);
 assert.equal(calls,1);assert.equal(results.length,0);assert.equal(scheduler.zones[0].phase,'moving');
 assert.equal(scheduler.jobs[0].validation,'invalid');assert.match(scheduler.jobs[0].strategyBlock,new RegExp(reason));
});
test('an uninterrupted cut freezes parameters; pause/resume forces another validity check',async()=>{
 let calls=0;const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,async()=>{if(++calls===2)throw Error('策略已撤回');});
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.update(1);scheduler.update(2);
 assert.equal(scheduler.zones[0].elapsed,2);
 assert.equal(scheduler.patchJob(0,{angle:50,planVersion:'changed'}),false);
 assert.equal(scheduler.jobs[0].angle,28);
 scheduler.pause(0,true);scheduler.pause(0,false);scheduler.update(1);await settle();scheduler.update(20);
 assert.equal(calls,2);assert.equal(scheduler.zones[0].elapsed,2);assert.equal(scheduler.jobs[0].angle,28);
});
test('expiry during an uninterrupted cut does not replace frozen parameters, but resume is blocked',()=>{
 let now=epoch;const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>now);
 scheduler.enqueue(0,job());scheduler.update(1);scheduler.update(1);now+=60001;scheduler.update(1);
 assert.equal(scheduler.zones[0].elapsed,2);
 scheduler.pause(0,true);scheduler.pause(0,false);scheduler.update(1);
 assert.equal(scheduler.zones[0].elapsed,2);
});
test('recovering a checkpoint invalidates prior permission before more cutting',async()=>{
 const old=createZoneScheduler(routes,()=>{},()=>{},()=>epoch);old.enqueue(0,job());old.update(1);old.update(2);
 let calls=0;const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,async()=>{calls++;throw Error('服务暂不可用');});
 assert.equal(scheduler.restore(JSON.parse(JSON.stringify({zones:old.zones,jobs:old.jobs}))),true);
 scheduler.update(1);await settle();scheduler.update(20);
 assert.equal(calls,1);assert.equal(scheduler.zones[0].elapsed,2);
});
test('a late validation response cannot authorize a replacement job',async()=>{
 let finish;const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,()=>new Promise(resolve=>{finish=resolve;}));
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.retire(0);
 scheduler.enqueue(0,job({id:'replacement'}));finish();await settle();
 assert.equal(scheduler.jobs[0].id,'replacement');assert.equal(scheduler.jobs[0].validation,'required');
});
test('remote terminal task retires local work silently without another execution receipt',()=>{
 let results=0;const scheduler=createZoneScheduler(routes,()=>results++,()=>results++,()=>epoch);
 scheduler.enqueue(0,job());scheduler.update(1);scheduler.retire(0);scheduler.update(20);
 assert.equal(results,0);assert.equal(scheduler.jobs[0],undefined);assert.equal(scheduler.zones[0].active,null);
});
