import test from 'node:test';
import assert from 'node:assert/strict';
import {createZoneScheduler,fleetBlockReason} from '../src/zoneFleet.ts';

const epoch=Date.parse('2026-10-17T02:00:00.000Z');
const routes=Array.from({length:4},(_,zone)=>({zone,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}],distances:[0,100],stations:Object.fromEntries(Array.from({length:50},(_,i)=>[zone*50+i,i]))}));
const job=(patch={})=>({id:'recovery-one',planVersion:'adopted-v1',angle:28,requestedAt:new Date(epoch).toISOString(),harnessSource:{treeId:'T-0001',strategyId:'strategy-one',runId:'run-one',revision:1,angle:28,expiresAt:new Date(epoch+60000).toISOString(),adoptedAt:new Date(epoch).toISOString(),mode:'simulation',dataMode:'demo',siteId:'demo-hainan'},...patch});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const pendingValidator=()=>{const attempts=[];return {attempts,validate:(_index,input)=>{const next=deferred();attempts.push({...next,input});return next.promise;}};};

for(const staleOutcome of ['success','failure'])test(`a stale ${staleOutcome} cannot settle a newer check after pause and resume`,async()=>{
 const gate=pendingValidator(),scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,gate.validate);
 scheduler.enqueue(0,job());scheduler.update(1);await settle();
 scheduler.pause(0,true);scheduler.pause(0,false);scheduler.update(1);await settle();
 assert.equal(gate.attempts.length,2);
 if(staleOutcome==='success')gate.attempts[0].resolve({notAfter:epoch+10000,weatherBlock:''});
 else gate.attempts[0].reject(Error('旧请求失败'));
 await settle();
 assert.equal(scheduler.jobs[0].validation,'pending');
 assert.equal(scheduler.jobs[0].notAfter,undefined);
 scheduler.update(20);assert.equal(scheduler.zones[0].phase,'moving');
 gate.attempts[1].reject(Error('当前策略已撤回'));await settle();
 assert.equal(scheduler.jobs[0].validation,'invalid');
 assert.match(scheduler.jobs[0].strategyBlock,/当前策略已撤回/);
});

test('a late failure cannot replace the successful replacement validator result',async()=>{
 const old=deferred(),current=deferred();
 const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,()=>old.promise);
 scheduler.enqueue(0,job());scheduler.update(1);await settle();
 scheduler.setValidator(()=>current.promise);scheduler.update(1);await settle();
 current.resolve();await settle();
 assert.equal(scheduler.jobs[0].validation,'valid');
 old.reject(Error('过时的服务错误'));await settle();
 assert.equal(scheduler.jobs[0].validation,'valid');
 assert.equal(scheduler.jobs[0].strategyBlock,'');
 scheduler.update(1);assert.equal(scheduler.zones[0].phase,'working');
});

test('changing weather constraints invalidates an in-flight check on the same queued job',async()=>{
 const gate=pendingValidator(),scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,gate.validate);
 scheduler.pause(0,true);scheduler.enqueue(0,job({weatherBlock:'原天气限制'}));
 assert.equal(scheduler.retryValidation(0),true);await settle();
 assert.equal(scheduler.patchJob(0,{weatherBlock:'新的天气限制',notBefore:epoch+30000}),true);
 assert.equal(scheduler.retryValidation(0),true);await settle();
 assert.equal(gate.attempts.length,2);
 gate.attempts[0].resolve({weatherBlock:'',notBefore:undefined,notAfter:epoch+10000});await settle();
 assert.equal(scheduler.jobs[0].validation,'pending');
 assert.equal(scheduler.jobs[0].weatherBlock,'新的天气限制');
 assert.equal(scheduler.jobs[0].notBefore,epoch+30000);
 gate.attempts[1].resolve({weatherBlock:'',notBefore:undefined,notAfter:epoch+50000});await settle();
 assert.equal(scheduler.jobs[0].validation,'required');
 assert.equal(scheduler.jobs[0].notAfter,epoch+50000);
 assert.equal(scheduler.zones[0].paused,true);
 assert.equal(scheduler.zones[0].active,null);
});

test('a no-op weather patch does not invalidate the current recovery request',async()=>{
 const gate=pendingValidator(),scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,gate.validate);
 scheduler.pause(0,true);scheduler.enqueue(0,job({weatherBlock:'降雨暂缓'}));
 scheduler.retryValidation(0);await settle();
 scheduler.patchJob(0,{weatherBlock:'降雨暂缓'});
 assert.equal(scheduler.jobs[0].validation,'pending');
 gate.attempts[0].resolve({weatherBlock:'',notBefore:undefined,notAfter:epoch+50000});await settle();
 assert.equal(scheduler.jobs[0].validation,'required');
 assert.equal(scheduler.jobs[0].weatherBlock,'');
});

test('weather recovery runs immediately while paused, rejects duplicate clicks and keeps the queue paused',async()=>{
 const gate=pendingValidator(),scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,gate.validate);
 scheduler.pause(0,true);scheduler.enqueue(0,job({weatherBlock:'天气服务暂不可用',notBefore:epoch+30000,notAfter:epoch-1}));
 assert.equal(scheduler.retryValidation(0),true);
 assert.equal(scheduler.retryValidation(0),false);
 await settle();assert.equal(gate.attempts.length,1);
 assert.equal(scheduler.jobs[0].validation,'pending');
 assert.equal(scheduler.jobs[0].weatherBlock,'天气服务暂不可用');
 gate.attempts[0].resolve({weatherBlock:'',notBefore:undefined,notAfter:epoch+50000});await settle();
 assert.equal(scheduler.jobs[0].validation,'required');
 assert.equal(scheduler.jobs[0].notBefore,undefined);
 assert.equal(scheduler.jobs[0].notAfter,epoch+50000);
 assert.equal(scheduler.jobs[0].weatherBlock,'');
 scheduler.update(20);
 assert.equal(scheduler.zones[0].paused,true);
 assert.equal(scheduler.zones[0].active,null);
 assert.deepEqual(scheduler.zones[0].queue,[0]);
});

test('a failed recovery preserves prior weather limits and the adopted cut parameters',async()=>{
 const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch,async()=>{throw Error('连接中断');});
 scheduler.enqueue(0,job({weatherBlock:'尚未核验的天气',notBefore:epoch+20000,notAfter:epoch+40000}));
 assert.equal(scheduler.retryValidation(0),true);await settle();
 assert.equal(scheduler.jobs[0].validation,'invalid');
 assert.match(scheduler.jobs[0].strategyBlock,/连接中断/);
 assert.equal(scheduler.jobs[0].weatherBlock,'尚未核验的天气');
 assert.equal(scheduler.jobs[0].notBefore,epoch+20000);
 assert.equal(scheduler.jobs[0].notAfter,epoch+40000);
 assert.equal(scheduler.jobs[0].angle,28);
 assert.equal(scheduler.jobs[0].planVersion,'adopted-v1');
 scheduler.update(20);assert.equal(scheduler.zones[0].active,null);
});

test('recovery success still checks at the cut boundary and a recovered job completes only once',async()=>{
 let calls=0;const completed=[],scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>epoch,async()=>{
  if(++calls===1)throw Error('暂时断连');
  return {weatherBlock:'',notBefore:undefined,notAfter:epoch+50000};
 });
 scheduler.enqueue(0,job());scheduler.update(1);await settle();
 assert.equal(scheduler.jobs[0].validation,'invalid');
 assert.equal(scheduler.retryValidation(0),true);await settle();
 assert.equal(calls,2);assert.equal(scheduler.jobs[0].validation,'required');
 assert.equal(scheduler.zones[0].phase,'moving');
 scheduler.update(1);await settle();assert.equal(calls,3);
 scheduler.update(1);assert.equal(scheduler.zones[0].phase,'working');
 scheduler.update(2);assert.equal(scheduler.zones[0].elapsed,2);
 assert.equal(scheduler.retryValidation(0),false);
 assert.equal(scheduler.patchJob(0,{angle:45,planVersion:'replacement'}),false);
 scheduler.update(6);scheduler.update(20);await settle();
 assert.equal(calls,3);assert.equal(completed.length,1);
 assert.equal(completed[0].angle,28);assert.equal(completed[0].planVersion,'adopted-v1');
 assert.equal(scheduler.jobs[0],undefined);
});

test('a successful recovery cannot bypass an expired adopted strategy',async()=>{
 let now=epoch,calls=0;const completed=[];
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>now,async()=>{calls++;return {weatherBlock:'',notBefore:undefined,notAfter:epoch+120000};});
 scheduler.pause(0,true);scheduler.enqueue(0,job());now=epoch+60001;
 assert.equal(scheduler.retryValidation(0),true);await settle();
 assert.equal(calls,1);
 scheduler.pause(0,false);scheduler.update(20);
 assert.equal(completed.length,0);assert.equal(scheduler.zones[0].active,null);
 assert.deepEqual(scheduler.zones[0].queue,[0]);
 assert.match(fleetBlockReason(scheduler.jobs[0],now),/策略过期/);
});

test('a weather window expiring after successful recovery still prevents execution',async()=>{
 let now=epoch;const completed=[];
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>now,async()=>({weatherBlock:'',notBefore:undefined,notAfter:epoch+1000}));
 scheduler.pause(0,true);scheduler.enqueue(0,job({weatherBlock:'天气服务断连'}));
 scheduler.retryValidation(0);await settle();now+=1001;
 scheduler.pause(0,false);scheduler.update(20);
 assert.equal(completed.length,0);assert.equal(scheduler.zones[0].active,null);
 assert.match(fleetBlockReason(scheduler.jobs[0],now),/天气窗口/);
});

test('cancelling a paused cut retracts once and leaves the next tree queued until explicit resume',async()=>{
 const completed=[],cancelled=[];
 const scheduler=createZoneScheduler(routes,(index,value)=>completed.push({index,value}),(index,value)=>cancelled.push({index,value}),()=>epoch,async()=>{});
 scheduler.enqueue(0,job());scheduler.enqueue(1,job({id:'recovery-two'}));
 scheduler.update(1);await settle();scheduler.update(1);scheduler.update(2);
 scheduler.pause(0,true);assert.equal(scheduler.cancel(0),true);
 assert.equal(scheduler.zones[0].phase,'retracting');
 assert.equal(scheduler.zones[0].paused,true);
 assert.equal(scheduler.zones[0].retractFrom,2);
 assert.equal(scheduler.retryValidation(0),false);
 assert.equal(scheduler.cancel(0),false);
 scheduler.update(.5);assert.equal(cancelled.length,0);
 scheduler.update(.5);scheduler.update(20);
 assert.equal(cancelled.length,1);assert.equal(cancelled[0].index,0);
 assert.equal(completed.length,0);
 assert.equal(scheduler.zones[0].paused,true);
 assert.equal(scheduler.zones[0].active,null);
 assert.deepEqual(scheduler.zones[0].queue,[1]);
 scheduler.pause(0,false);scheduler.update(1);await settle();scheduler.update(1);scheduler.update(8);scheduler.update(20);
 assert.equal(cancelled.length,1);assert.equal(completed.length,1);assert.equal(completed[0].index,1);
});

test('cancellation invalidates pending weather recovery before the cancellation receipt',async()=>{
 const gate=pendingValidator(),cancelled=[],scheduler=createZoneScheduler(routes,()=>{},(_index,value)=>cancelled.push(value),()=>epoch,gate.validate);
 scheduler.enqueue(0,job());scheduler.update(1);await settle();
 assert.equal(scheduler.cancel(0),true);
 gate.attempts[0].resolve({weatherBlock:'',notAfter:epoch+40000});await settle();
 assert.notEqual(scheduler.jobs[0].validation,'valid');
 assert.equal(scheduler.jobs[0].notAfter,undefined);
 scheduler.update(1);scheduler.update(20);
 assert.equal(cancelled.length,1);assert.equal(cancelled[0].id,'recovery-one');
});

test('a failed resumed cut retains elapsed work and completes once after explicit recovery',async()=>{
 let calls=0;const completed=[];
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>epoch,async()=>{if(++calls===2)throw Error('恢复核验暂时断连');});
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.update(1);scheduler.update(3);
 scheduler.pause(0,true);scheduler.pause(0,false);scheduler.update(1);await settle();
 assert.equal(scheduler.jobs[0].validation,'invalid');assert.equal(scheduler.zones[0].elapsed,3);
 assert.equal(scheduler.retryValidation(0),true);await settle();
 assert.equal(scheduler.jobs[0].validation,'required');assert.equal(scheduler.zones[0].elapsed,3);
 scheduler.update(1);await settle();assert.equal(calls,4);
 scheduler.update(1);assert.equal(scheduler.zones[0].elapsed,4);
 scheduler.update(4);scheduler.update(20);
 assert.equal(completed.length,1);assert.equal(completed[0].angle,28);
});

for(const expires of ['strategy','weather'])test(`${expires} expiry between resumed validation and the next work step blocks further cutting`,async()=>{
 let now=epoch;const completed=[];
 let timing=expires==='weather'?{notAfter:epoch+1000,weatherBlock:''}:undefined;
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>now,async()=>timing);
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.update(1);scheduler.update(3);
 assert.equal(scheduler.zones[0].elapsed,3);
 scheduler.pause(0,true);scheduler.pause(0,false);scheduler.update(1);await settle();
 assert.equal(scheduler.jobs[0].validation,'valid');
 now=epoch+(expires==='weather'?1001:60001);
 scheduler.update(1);scheduler.update(20);
 assert.equal(scheduler.zones[0].elapsed,3);
 assert.equal(completed.length,0);
 assert.match(fleetBlockReason(scheduler.jobs[0],now),expires==='weather'?/天气窗口/:/策略过期/);
 if(expires==='weather'){
  assert.equal(scheduler.jobs[0].validation,'invalid');
  timing={notAfter:now+50000,weatherBlock:''};
  assert.equal(scheduler.retryValidation(0),true);await settle();
  assert.equal(scheduler.jobs[0].validation,'required');
  assert.equal(scheduler.zones[0].elapsed,3);
  scheduler.update(1);await settle();scheduler.update(1);scheduler.update(4);scheduler.update(20);
  assert.equal(completed.length,1);assert.equal(completed[0].angle,28);
 }
});

test('expiry during an uninterrupted cut preserves its frozen parameters and permits one completion',async()=>{
 let now=epoch;const completed=[];
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>now,async()=>({notAfter:epoch+1000,weatherBlock:''}));
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.update(1);scheduler.update(3);
 now=epoch+60001;
 assert.equal(scheduler.patchJob(0,{angle:45,planVersion:'changed',weatherBlock:'新天气限制'}),false);
 scheduler.update(5);scheduler.update(20);
 assert.equal(completed.length,1);
 assert.equal(completed[0].angle,28);assert.equal(completed[0].planVersion,'adopted-v1');
});

test('task plan window survives refreshed weather and freezes an active cut at its deadline',async()=>{
 let now=epoch;const completed=[];
 const taskWindow={notBefore:epoch-1000,notAfter:epoch+1000};
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>now,async()=>({notAfter:epoch+60000,weatherBlock:''}));
 scheduler.enqueue(0,job({taskWindow}));
 scheduler.update(1);await settle();scheduler.update(1);scheduler.update(3);
 assert.equal(scheduler.zones[0].elapsed,3);
 assert.equal(scheduler.jobs[0].notAfter,taskWindow.notAfter);
 assert.equal(scheduler.jobs[0].notBefore,taskWindow.notBefore);
 now=taskWindow.notAfter;
 scheduler.update(5);scheduler.update(20);
 assert.equal(scheduler.zones[0].elapsed,3);
 assert.equal(completed.length,0);
 assert.match(fleetBlockReason(scheduler.jobs[0],now),/任务计划作业窗口已结束/);
 assert.equal(scheduler.retryValidation(0),true);await settle();scheduler.update(20);
 assert.equal(completed.length,0);
 assert.equal(scheduler.zones[0].elapsed,3);
});

test('independent task window prevents early motion even if a weather patch clears its effective time',()=>{
 const scheduler=createZoneScheduler(routes,()=>{},()=>{},()=>epoch);
 scheduler.enqueue(0,job({taskWindow:{notBefore:epoch+60000}}));
 assert.equal(scheduler.patchJob(0,{notBefore:undefined,weatherBlock:''}),true);
 scheduler.update(20);
 assert.equal(scheduler.zones[0].active,null);
 assert.match(fleetBlockReason(scheduler.jobs[0],epoch),/不能提前执行/);
});

test('historical working jobs receive a task window once without changing cutting parameters',async()=>{
 let now=epoch;const completed=[];
 const scheduler=createZoneScheduler(routes,(_index,value)=>completed.push(value),()=>{},()=>now,async()=>({weatherBlock:''}));
 scheduler.enqueue(0,job());scheduler.update(1);await settle();scheduler.update(1);scheduler.update(3);
 assert.equal(scheduler.zones[0].elapsed,3);
 const taskWindow={notBefore:epoch-1000,notAfter:epoch+1000};
 assert.equal(scheduler.patchJob(0,{taskWindow,angle:45,planVersion:'changed'}),true);
 assert.deepEqual(scheduler.jobs[0].taskWindow,taskWindow);
 assert.equal(scheduler.jobs[0].angle,28);
 assert.equal(scheduler.jobs[0].planVersion,'adopted-v1');
 assert.equal(scheduler.patchJob(0,{taskWindow:{notAfter:epoch+60000}}),false);
 now=epoch+1000;scheduler.update(20);
 assert.equal(scheduler.zones[0].elapsed,3);
 assert.equal(completed.length,0);
 assert.match(fleetBlockReason(scheduler.jobs[0],now),/任务计划作业窗口已结束/);
});
