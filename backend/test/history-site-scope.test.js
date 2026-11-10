import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const now='2026-10-19T02:00:00.000Z';
function seed(store){
 return ['demo-hainan','demo-xsbn','demo-xian','demo-xsbn','demo-hainan'].map((siteId,index)=>{
  const run=store.submit({requestId:`scope-run-${index}`,siteId,kind:'growth_plan',generatorMode:'demo_rules'},now).run;
  store.finish(run.runId,{runId:run.runId,requestId:run.requestId,status:'failed',updatedAt:now,error:{code:'FIXTURE',message:'历史读取测试记录',retryable:false}});
  return run;
 });
}

test('analysis history filters the requested park before cursor pagination',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const runs=seed(store),siteId='demo-xsbn';
 const first=store.listRuns({siteId,limit:1});
 assert.deepEqual(first.items.map(run=>run.runId),[runs[3].runId]);assert.ok(first.nextCursor);
 const last=store.listRuns({siteId,limit:1,cursor:first.nextCursor});
 assert.deepEqual(last.items.map(run=>run.runId),[runs[1].runId]);assert.equal(last.nextCursor,null);
 assert.equal(store.listRuns().items.length,5);
 assert.equal(store.listRuns({siteId:'demo-xian'}).items.length,1);
});

test('analysis history HTTP accepts normalized park scope while omitted scope stays all parks',async t=>{
 const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),clock:()=>new Date(now)});
 t.after(()=>app.close());
 seed(app.store);
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const get=async(path,status=200)=>{const response=await fetch(base+path);assert.equal(response.status,status);return response.json();};
 const page=await get('/internal/harness/runs?siteId=xsbn&limit=1');
 assert.deepEqual(page.items.map(item=>item.siteId),['demo-xsbn']);assert.ok(page.nextCursor);
 const second=await get(`/internal/harness/runs?siteId=demo-xsbn&limit=1&cursor=${page.nextCursor}`);
 assert.deepEqual(second.items.map(item=>item.siteId),['demo-xsbn']);assert.equal(second.nextCursor,null);
 assert.notEqual(page.items[0].runId,second.items[0].runId);
 assert.equal((await get('/internal/harness/runs')).items.length,5);
 assert.equal((await get('/internal/harness/runs?siteId=unknown',400)).error.code,'INVALID_QUERY');
});
