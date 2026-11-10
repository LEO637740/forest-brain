import assert from 'node:assert/strict';
import test from 'node:test';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';

/** @type {import('../../shared/marketQuotes.ts').RubberMarketQuotes} */
const snapshot = {
  status:'available', mode:'delayed', provider:'期货行情测试源',
  sourceUrl:'https://example.test/rubber-quotes', delayMinutes:15,
  quoteAt:'2026-11-02T06:45:00.000Z', fetchedAt:'2026-11-02T07:00:00.000Z', tradeDate:'2026-11-02',
  quotes:[
    {contract:'RU2701',lastPrice:15385,previousSettlement:15320,change:65,changePct:0.42,volumeLots:2168,openInterestLots:12580},
    {contract:'RU2705',lastPrice:15420,previousSettlement:15480,change:-60,changePct:-0.39,volumeLots:1520,openInterestLots:10240},
  ],
};

async function fixture(t, options = {}) {
  const app = createApp({dbPath:':memory:',requireIdentity:true,generator:new RuleGenerator(),
    clock:()=>new Date('2026-11-02T07:00:00.000Z'),...options});
  t.after(()=>app.close());
  await new Promise((resolve,reject)=>{
    app.server.once('error',reject);
    app.server.listen(0,'127.0.0.1',resolve);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(path,{token,input,status=200}={}) {
    const response = await fetch(base+path,{
      method:input===undefined?'GET':'POST',
      headers:{...(token?{'X-Rubber-Session':token}:{}),...(input===undefined?{}:{'Content-Type':'application/json'})},
      ...(input===undefined?{}:{body:JSON.stringify(input)}),
      signal:AbortSignal.timeout(10000),
    });
    const data = await response.json();
    assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const login = async ()=>(await call('/api/auth/login',{input:{accountId:'grower-hn-wang'},status:201})).token;
  return {call,login};
}

test('market quotes HTTP: a signed-in grower can read public futures quotes with their source and timing',async t=>{
  let reads = 0;
  const h = await fixture(t,{marketQuoteService:{async quotes(){reads++;return snapshot;}}});
  const token = await h.login();
  const result = await h.call('/api/market/quotes',{token});
  assert.deepEqual(result,snapshot);
  assert.equal(reads,1);
});

test('market quotes HTTP: requireIdentity rejects anonymous access before reading the quote provider',async t=>{
  let reads = 0;
  const h = await fixture(t,{marketQuoteService:{async quotes(){reads++;return snapshot;}}});
  const result = await h.call('/api/market/quotes',{status:401});
  assert.equal(result.error.code,'LOGIN_REQUIRED');
  assert.equal(reads,0);
});

test('market quotes HTTP: public quotes do not grant a grower access to the source catalogue',async t=>{
  const h = await fixture(t,{marketQuoteService:{async quotes(){return snapshot;}}});
  const token = await h.login();
  await h.call('/api/market/quotes',{token});
  const result = await h.call('/api/sources',{token,status:403});
  assert.equal(result.error.code,'FORBIDDEN');
});

test('market quotes HTTP: the default offline application returns no invented market prices',async t=>{
  const h = await fixture(t);
  const token = await h.login();
  const result = await h.call('/api/market/quotes',{token});
  assert.equal(result.status,'offline');
  assert.deepEqual(result.quotes,[]);
});
