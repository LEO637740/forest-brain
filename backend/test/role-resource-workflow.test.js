import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

test('saved market and review links retain their owning park when another manager opens them', async t=>{
 const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),requireIdentity:true});
 t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,token,input,status=200)=>{
  const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Rubber-Session':token}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify({path,data}));return data;
 };
 const hn=(await call('/api/auth/login',null,{accountId:'manager-hn'},201)).token;
 const xs=(await call('/api/auth/login',null,{accountId:'manager-xs'},201)).token;
 const market=await call('/api/simulation/market',xs,{siteId:'demo-xsbn'});
 assert.equal((await call(`/api/simulation/market/${market.id}`,xs)).siteId,'demo-xsbn');
 await call(`/api/simulation/market/${market.id}`,hn,undefined,403);
 const job=(await call('/api/simulation/reviews',xs,{siteId:'demo-xsbn',treeIds:['T-0042'],kind:'measure',assignee:'robot'},201)).items[0];
 await call(`/api/simulation/reviews/${job.id}/events`,xs);
 await call(`/api/simulation/reviews/${job.id}/events`,hn,undefined,403);
 await call(`/api/simulation/reviews/${job.id}/collect`,hn,{},403);
 assert.equal((await call('/api/simulation/reviews?siteId=demo-xsbn',xs)).items.find(item=>item.id===job.id).status,'queued');
 assert.equal((await call(`/api/simulation/reviews/${job.id}/collect`,xs,{siteId:'demo-xsbn'})).status,'collected');
});
