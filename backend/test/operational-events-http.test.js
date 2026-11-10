import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';
import { INTEGRATION_VERSION } from '../src/integration-version.js';

async function fixture(t) {
  const app = createApp({dbPath:':memory:',clock:()=>new Date('2026-10-19T02:00:00Z'),generator:new RuleGenerator()});
  t.after(() => app.close());
  await new Promise((resolve,reject) => {app.server.once('error',reject); app.server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return async (path, input, expected = 200) => {
    const response = await fetch(base + path,{method:input === undefined ? 'GET' : 'POST',
      headers:input === undefined ? {} : {'Content-Type':'application/json'},body:input === undefined ? undefined : JSON.stringify(input)});
    const data = await response.json();
    assert.equal(response.status,expected,JSON.stringify(data)); return data;
  };
}

test('operational event API exposes the same site facts through existing task and weather synchronization', async t => {
  const call = await fixture(t);
  const health = await call('/health'), meta = await call('/api/meta');
  assert.equal(health.version,INTEGRATION_VERSION);
  assert.ok(health.capabilities.includes('operational-event-linkage'));
  assert.equal(meta.version,health.version);
  assert.ok(meta.integrationCapabilities.includes('operational-event-linkage'));
  const path = '/api/simulation/operational-events';
  const rain = await call(path,{requestId:'rain',siteId:'hainan',kind:'rain',zone:null,note:'人工登记模拟降雨'});
  const fault = await call(path,{requestId:'fault',siteId:'xsbn',kind:'device_fault',zone:2,note:'C区设备模拟故障'});
  const global = await call(path);
  assert.equal(global.siteId,null); assert.deepEqual(global.items,[fault,rain]);
  assert.equal(global.checkedAt,'2026-10-19T02:00:00.000Z');
  const local = await call(path+'?siteId=hainan');
  assert.equal(local.siteId,'demo-hainan'); assert.deepEqual(local.items,[rain]);
  assert.deepEqual((await call('/api/simulation/tasks')).operationalEvents,[fault,rain]);
  assert.deepEqual((await call('/api/simulation/tasks?siteId=xsbn')).operationalEvents,[fault]);
  assert.deepEqual((await call('/api/simulation/constraints?siteId=hainan')).operationalEvents,[rain]);
  assert.deepEqual((await call('/api/simulation/constraints?siteId=xian')).operationalEvents,[]);
  assert.equal((await call(path+'?siteId=invalid',undefined,400)).error.code,'INVALID_QUERY');
});

test('operational event API enforces resolve then resume and retains scoped, idempotent audit evidence', async t => {
  const call = await fixture(t), path = '/api/simulation/operational-events';
  const input = {requestId:'fault-once',siteId:'hainan',kind:'device_fault',zone:0,note:'A区割胶头故障'};
  const event = await call(path,input), resource = `${path}/${event.id}`;
  assert.equal((await call(resource+'/resume',{siteId:'hainan',note:'restart'},409)).error.code,'EVENT_STATE_CONFLICT');
  assert.equal((await call(resource+'/resolve',{siteId:'xsbn',note:'wrong park'},404)).error.code,'NOT_FOUND');
  const resolution = {siteId:'hainan',note:'维修完成，等待空载测试'};
  const resolved = await call(resource+'/resolve',resolution);
  assert.equal(resolved.status,'resolved');
  assert.deepEqual((await call('/api/simulation/tasks?siteId=hainan')).operationalEvents,[resolved]);
  const resume = {siteId:'hainan',note:'已核对设备、地表及储运条件'};
  const closed = await call(resource+'/resume',resume);
  assert.equal(closed.status,'closed'); assert.equal(closed.resolutionNote,resolution.note);
  assert.deepEqual(await call(resource+'/resume',resume),closed);
  assert.deepEqual(await call(resource+'/resolve',resolution),closed);
  assert.deepEqual(await call(path,input),closed);
  assert.deepEqual((await call('/api/simulation/tasks?siteId=hainan')).items,[]);
  assert.equal((await call(path,{...input,note:'replace'},409)).error.code,'EVENT_CONFLICT');
});
