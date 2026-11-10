import assert from 'node:assert/strict';
import test from 'node:test';
import {analyticsSeries} from '../src/analytics.js';
import {ACCOUNTS,Identity} from '../src/identity.js';
import {allocateTreeSamples} from '../../shared/analyticsScope.ts';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

const now=new Date('2026-10-23T02:00:00Z');
test('grower analytics totals equal the same 33 trees from the existing park allocation',()=>{
  for(const accountId of ['grower-hn-wang','grower-xs-yan']) {
    const identity=new Identity(ACCOUNTS.find(account=>account.accountId===accountId));
    const site=identity.plot.siteId.slice(5),park=analyticsSeries(site,now),plot=analyticsSeries(site,now,30,identity);
    const indices=identity.plot.treeIds.map(id=>Number(id.slice(2))-1);
    assert.equal(plot.rows.length,30);
    for(const [day,row] of plot.rows.entries()) {
      const expected=allocateTreeSamples([park.rows[day]],day).filter(tree=>indices.includes(tree.index));
      assert.deepEqual(row.treeSamples,expected);
      assert.equal(row.actual,expected.reduce((sum,tree)=>sum+tree.latex,0));
      assert.equal(row.taps,expected.reduce((sum,tree)=>sum+tree.taps,0));
      assert.equal(row.rain,park.rows[day].rain);
      assert.ok(row.actual<park.rows[day].actual);
    }
    assert.equal(allocateTreeSamples(plot.rows.slice(-7)).length,33);
  }
  assert.deepEqual(analyticsSeries('hainan',now,30,new Identity(ACCOUNTS.find(account=>account.accountId==='manager-hn'))),analyticsSeries('hainan',now));
});

test('analytics HTTP uses the signed-in plot while managers retain the park series',async t=>{
  const app=createApp({dbPath:':memory:',clock:()=>now,generator:new RuleGenerator(),requireIdentity:true});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function login(accountId) {
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId})});
    assert.equal(response.status,201);return (await response.json()).token;
  }
  for(const accountId of ['grower-hn-wang','grower-xs-yan','manager-hn']) {
    const identity=new Identity(ACCOUNTS.find(account=>account.accountId===accountId));
    const token=await login(accountId),site=identity.siteIds[0].slice(5);
    const response=await fetch(`${base}/api/demo/analytics?site=${site}`,{headers:{'X-Rubber-Session':token}});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),analyticsSeries(site,now,30,identity));
    const fieldResponse=await fetch(`${base}/api/field/trees?site=${site}`,{headers:{'X-Rubber-Session':token}});
    assert.equal(fieldResponse.status,200);
    const catalog=await fieldResponse.json();
    assert.equal(catalog.importedCount,identity.plot?33:200);
    assert.equal(catalog.importedCount,catalog.items.length,'source catalogue count matches its visible tree records');
    assert.deepEqual(catalog.items.map(item=>item.treeId),identity.treeIds(identity.siteIds[0]));
    if(identity.plot) {
      const forbidden=await fetch(`${base}/api/demo/analytics?site=${site==='hainan'?'xsbn':'hainan'}`,{headers:{'X-Rubber-Session':token}});
      assert.equal(forbidden.status,403);
    }
  }
});
