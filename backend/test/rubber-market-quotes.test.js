import test from 'node:test';
import assert from 'node:assert/strict';
import {RubberMarketQuoteService,normalizeRubberQuotes,RUBBER_QUOTE_URL} from '../src/adapters/rubber-market-quotes.js';

// Shape verified against the exchange's public delaymarket_ru.dat response.
const row = (values={}) => ({turnover:'0.0',volume:'',tasvolume:'',openinterest:'131663',
  presettlementprice:'19205',openprice:'',highprice:'',lowerprice:'',contractname:'ru2701',instrumentid:'ru',
  lastprice:'19310',upperdown:'105',updatetime:'2026-11-02 19:00:44',bidprice:'',askprice:'',lastv:'',...values});
const fixture = () => ({delaymarket:[row(),row({contractname:'ru2705',lastprice:'19315',openinterest:'40779'})]});
const fetchedAt='2026-11-02T11:01:00.000Z';

test('official delayed snapshot retains source time and computes change against previous settlement',()=>{
  const result=normalizeRubberQuotes(fixture(),fetchedAt);
  assert.equal(result.status,'available'); assert.equal(result.mode,'delayed');assert.equal(result.delayMinutes,30);
  assert.equal(result.quoteAt,'2026-11-02T19:00:44+08:00');assert.equal(result.fetchedAt,fetchedAt);
  assert.equal(result.tradeDate,null,'snapshot calendar day is not the night-session trading date');
  assert.deepEqual(result.quotes[0],{contract:'RU2701',lastPrice:19310,previousSettlement:19205,
    change:105,changePct:0.55,volumeLots:null,openInterestLots:131663});
});

test('blank fields are not zero and only valid rubber contracts with a real price are shown',()=>{
  const result=normalizeRubberQuotes({delaymarket:[
    row({presettlementprice:'',upperdown:'999',volume:'0',openinterest:null}),
    row({contractname:'ru2705',lastprice:''}),row({contractname:'ru2703',lastprice:'0'}),
    row({contractname:'ru2713'}),row({contractname:'ru小计'}),row({contractname:'cu2701'}),
  ]},fetchedAt);
  assert.equal(result.quotes.length,1);
  assert.equal(result.quotes[0].previousSettlement,null);assert.equal(result.quotes[0].change,null);
  assert.equal(result.quotes[0].changePct,null);assert.equal(result.quotes[0].volumeLots,0);
  assert.equal(result.quotes[0].openInterestLots,null);
  assert.throws(()=>normalizeRubberQuotes({delaymarket:[]},fetchedAt));
  assert.throws(()=>normalizeRubberQuotes({delaymarket:[row({updatetime:''})]},fetchedAt));
});

test('unchanged cached reads do not invent price updates; a new upstream snapshot appears after 30 seconds',async()=>{
  let now=new Date(fetchedAt),calls=0,price='19310';
  const service=new RubberMarketQuoteService({clock:()=>now,fetchImpl:async(url,options)=>{
    assert.equal(url,RUBBER_QUOTE_URL);assert.equal(options.redirect,'error');assert.ok(options.signal);
    calls++;return Response.json({delaymarket:[row({lastprice:price})]});
  }});
  const first=await service.quotes(); price='19330';now=new Date(+now+29999);
  assert.equal((await service.quotes()).quotes[0].lastPrice,19310);assert.equal(calls,1);
  now=new Date(+now+1);const next=await service.quotes();
  assert.equal(next.quotes[0].lastPrice,19330);assert.equal(calls,2);
  assert.equal(next.quoteAt,first.quoteAt);assert.notEqual(next.fetchedAt,first.fetchedAt);
});

test('simultaneous viewers share a single upstream request',async()=>{
  let finish,calls=0;
  const response=new Promise(resolve=>{finish=resolve;});
  const service=new RubberMarketQuoteService({fetchImpl:()=>{calls++;return response;}});
  const a=service.quotes(),b=service.quotes();assert.equal(calls,1);
  finish(Response.json(fixture()));const [first,second]=await Promise.all([a,b]);
  assert.deepEqual(first,second);assert.equal(first.status,'available');
});

test('a failed refresh retains the exact successful quote time and fetch time, then recovers',async()=>{
  let now=new Date(fetchedAt),failed=false,calls=0;
  const service=new RubberMarketQuoteService({clock:()=>now,fetchImpl:async()=>{
    calls++;if(failed)throw new Error('network');return Response.json(fixture());
  }});
  const first=await service.quotes();failed=true;now=new Date(+now+30000);
  const old=await service.quotes();assert.equal(old.status,'stale');assert.equal(old.quoteAt,first.quoteAt);
  assert.equal(old.fetchedAt,first.fetchedAt);assert.deepEqual(old.quotes,first.quotes);
  await service.quotes();assert.equal(calls,2,'outage has the same request cooldown');
  failed=false;now=new Date(+now+30000);assert.equal((await service.quotes()).status,'available');
});

test('first upstream failure yields a quiet unavailable result without fabricated values',async()=>{
  const service=new RubberMarketQuoteService({fetchImpl:async()=>new Response('',{status:503})});
  const result=await service.quotes();assert.equal(result.status,'unavailable');
  assert.deepEqual(result.quotes,[]);assert.equal(result.quoteAt,null);assert.equal(result.fetchedAt,null);
});

test('daily fallback remains explicitly historical and keeps its actual retrieval date',async()=>{
  const source={retrievedAt:'2026-10-30T09:00:00.000Z',sourceUrl:'https://www.shfe.com.cn/data/day.dat',
    data:{tradeDate:'2026-10-30',priceType:'futures',currency:'CNY',priceUnit:'CNY/tonne',contracts:[
      {contract:'RU2701',closeCnyPerTonne:19275,settlementCnyPerTonne:19455,previousSettlementCnyPerTonne:19100,volumeLots:270809,openInterestLots:146176},
      {contract:'RU2705',closeCnyPerTonne:null,settlementCnyPerTonne:19400,previousSettlementCnyPerTonne:19100},
    ]}};
  const service=new RubberMarketQuoteService({fetchImpl:async()=>{throw new Error('offline');},dailySource:()=>source});
  const result=await service.quotes();assert.equal(result.status,'stale');assert.equal(result.mode,'daily');
  assert.equal(result.delayMinutes,null);assert.equal(result.quoteAt,null);assert.equal(result.tradeDate,'2026-10-30');
  assert.equal(result.fetchedAt,source.retrievedAt);assert.equal(result.quotes[0].lastPrice,19275);
  assert.equal(result.quotes.length,1,'a settlement-only price is not labeled as a close');
});

test('offline mode performs no upstream request and does not masquerade as cached live data',async()=>{
  let calls=0;
  const service=new RubberMarketQuoteService({enabled:false,fetchImpl:async()=>{calls++;throw new Error('unexpected');},
    dailySource:()=>{throw new Error('offline does not need a data service');}});
  const result=await service.quotes();assert.equal(calls,0);assert.equal(result.status,'offline');
  assert.equal(result.quoteAt,null);assert.equal(result.fetchedAt,null);assert.deepEqual(result.quotes,[]);
});
