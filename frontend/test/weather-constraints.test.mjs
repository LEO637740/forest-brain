import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherTimingFor,withLiveWeather} from '../src/integration/weatherConstraints.ts';

const now=Date.parse('2026-10-17T00:00:00.000Z');
const iso=offset=>new Date(now+offset).toISOString();
const row=(patch={})=>({kind:'adopt_weather',siteId:'demo-hainan',treeIds:['T-0001'],start:iso(-60000),end:iso(120000),expiresAt:iso(180000),validity:{valid:true,status:'available'},...patch});

test('same tree IDs in different sites retain independent weather windows',()=>{
 const rows=[row({siteId:'demo-xsbn',start:iso(30000),end:iso(60000)}),row()];
 assert.deepEqual(weatherTimingFor('T-0001',rows,{now}),{notBefore:now-60000,notAfter:now+120000,weatherBlock:''});
 assert.deepEqual(weatherTimingFor('T-0001',rows,{now,siteId:'demo-xsbn'}),{notBefore:now+30000,notAfter:now+60000,weatherBlock:''});
 assert.deepEqual(weatherTimingFor('T-0002',rows,{now}),{});
 assert.deepEqual(weatherTimingFor('T-0001',rows,{now,siteId:'demo-xian'}),{});
});

test('weather rows without a site belong only to the historical Hainan demo',()=>{
 const rows=[row({siteId:undefined})];
 assert.equal(weatherTimingFor('T-0001',rows,{now}).notAfter,now+120000);
 assert.deepEqual(weatherTimingFor('T-0001',rows,{now,siteId:'demo-xsbn'}),{});
});

test('latest expired Hainan window stays blocked even if another site and an older window are valid',()=>{
 const rows=[row({siteId:'demo-xsbn'}),row({end:iso(0)}),row()];
 assert.match(weatherTimingFor('T-0001',rows,{now}).weatherBlock,/过期/);
 assert.equal(weatherTimingFor('T-0001',rows,{now}).notAfter,now);
 assert.equal(weatherTimingFor('T-0001',rows,{now,siteId:'demo-xsbn'}).weatherBlock,'');
});

test('latest withdrawn window stays authoritative for its site and does not block another site',()=>{
 const rows=[row({siteId:'demo-xsbn',validity:{valid:false,status:'withdrawn',reason:'原策略已撤回'}}),row(),row({siteId:'demo-xsbn'})];
 assert.equal(weatherTimingFor('T-0001',rows,{now}).weatherBlock,'');
 assert.equal(weatherTimingFor('T-0001',rows,{now,siteId:'demo-xsbn'}).weatherBlock,'原策略已撤回');
});

test('expiry is the earlier of the adopted window and strategy lifetime',()=>{
 assert.equal(weatherTimingFor('T-0001',[row({expiresAt:iso(60000)})],{now}).notAfter,now+60000);
 assert.match(weatherTimingFor('T-0001',[row({expiresAt:iso(0)})],{now}).weatherBlock,/过期/);
});

test('malformed and inverted windows cannot authorize cutting',()=>{
 for(const patch of [{start:'invalid'},{end:'invalid'},{expiresAt:'invalid'},{start:iso(120000),end:iso(60000)}]){
  assert.match(weatherTimingFor('T-0001',[row(patch)],{now}).weatherBlock,/过期/);
 }
});

test('refresh failure blocks execution while retaining only the current site timing',()=>{
 const rows=[row({siteId:'demo-xsbn',end:iso(30000)}),row()];
 assert.deepEqual(weatherTimingFor('T-0001',rows,{now,failure:'天气约束核验失败'}),{notBefore:now-60000,notAfter:now+120000,weatherBlock:'天气约束核验失败'});
 assert.deepEqual(weatherTimingFor('T-0002',rows,{now,failure:'天气约束核验失败'}),{weatherBlock:'天气约束核验失败'});
});


test('current heavy rain overrides a valid adopted weather window',()=>{
 const allowed=weatherTimingFor('T-0001',[row()],{now});
 const blocked=withLiveWeather(allowed,{enabled:true,allowed:false,reason:'当前降雨超过阈值'},now);
 assert.match(blocked.weatherBlock,/当前降雨超过阈值/);
 assert.equal(blocked.notAfter,allowed.notAfter);
});
test('live weather limits execution to current valid hour and cannot relax another deadline',()=>{
 const live={enabled:true,allowed:true,windowEnd:iso(60000),validUntil:iso(90000)};
 assert.equal(withLiveWeather({},live,now).notAfter,now+60000);
 assert.equal(withLiveWeather({notAfter:now+30000},live,now).notAfter,now+30000);
 assert.match(withLiveWeather({},live,now+60000).weatherBlock,/过期/);
 assert.match(withLiveWeather({}, {...live,validUntil:null},now).weatherBlock,/过期/);
 assert.deepEqual(withLiveWeather({notAfter:now+30000},{enabled:false},now),{notAfter:now+30000});
});
