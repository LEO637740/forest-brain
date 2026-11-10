import test from 'node:test';
import assert from 'node:assert/strict';
import {planModel} from './helpers/park-plan-model.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

test('saved park plan endpoint returns the original adopted baseline after a newer typhoon plan',async t=>{
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),assistantModel:planModel(2),clock:()=>new Date('2026-10-23T00:00:00Z')});
  t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const token=app.identities.login({accountId:'manager-xs'}).token;
  const request=async(path,input)=>{
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Rubber-Session':token},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const data=await response.json();
    assert.ok(response.ok,`${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const siteId='demo-xsbn';
  const baseline=await request('/api/park-plan',{siteId,economicScenarioId:'baseline'});
  const adopted=await request(`/api/park-plan/${baseline.id}/adopt`,{siteId});
  assert.ok(adopted.adoption.tasks.length>0);
  const typhoon=await request('/api/park-plan',{siteId,economicScenarioId:'typhoon'});
  assert.notEqual(typhoon.id,baseline.id);
  assert.equal((await request(`/api/park-plan/latest?siteId=${siteId}`)).plan.id,typhoon.id);
  const original=(await request(`/api/park-plan/${baseline.id}?siteId=${siteId}`)).plan;
  assert.equal(original.id,baseline.id);
  assert.equal(original.economicScenarioId,'baseline');
  assert.deepEqual(original.signals,baseline.signals);
  assert.deepEqual(original.production,baseline.production);
  assert.deepEqual(original.adoption,adopted.adoption);
  assert.equal((await request(`/api/park-plan/${typhoon.id}?siteId=${siteId}`)).plan.economicScenarioId,'typhoon');
});
