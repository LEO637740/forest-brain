import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyExperience,replayDecisions,searchImprovement,WeatherExperience,simulatedExperience} from '../src/brain-evolution.js';
import {WEATHER_THRESHOLDS,clearCerebellumThresholds} from '../src/weather-policy.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
import {RuleGenerator} from '../src/capabilities/rules.js';
import {PARK_SITES} from '../src/adapters/park-demo.js';

const DAY=86400000;
const isoDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
// Every 5th morning: a 65% forecast that stays dry (false defer at 60%, tapped at 70%).
// Every 7th morning: a dry-looking forecast with real rain (a miss).
// A few 55% mornings stay dry: lowering the threshold to 50% would add false defers.
const pattern=date=>{const n=Number(date.slice(8,10))+Number(date.slice(5,7))*31;
  if(n%7===0)return {prob:20,fmm:0,act:1.2};if(n%5===0)return {prob:65,fmm:0.2,act:0};if(n%4===0)return {prob:55,fmm:0,act:0};return {prob:10,fmm:0,act:0};};
function hourlyJson(start,end,withProbability){
  const time=[],precipitation=[],precipitation_probability=[];
  for(let ms=Date.parse(`${start}T00:00:00Z`);ms<=Date.parse(`${end}T00:00:00Z`);ms+=DAY){
    const date=new Date(ms).toISOString().slice(0,10),p=pattern(date);
    for(let hour=0;hour<24;hour++){time.push(`${date}T${String(hour).padStart(2,'0')}:00`);
      const window=hour>=5&&hour<9;
      precipitation.push(withProbability?(window?p.fmm:0):(window?p.act/4:0));
      if(withProbability)precipitation_probability.push(window?p.prob:0);}
  }
  return {hourly:{time,precipitation,...(withProbability?{precipitation_probability}:{})}};
}
function fakeFetch(calls=[]){return async url=>{calls.push(url);const q=new URL(url).searchParams;return hourlyJson(q.get('start_date'),q.get('end_date'),url.includes('historical-forecast'));};}

test('simulated weather has nonnegative rain in every park before it enters replay',()=>{
  for(const siteId of Object.keys(PARK_SITES)){
    const days=simulatedExperience(siteId,'2026-10-21');
    assert.equal(days.length,60);
    assert.deepEqual(days,simulatedExperience(siteId,'2026-10-21'));
    assert.ok(days.some(day=>day.actualWindowMm>0));
    assert.ok(days.some(day=>day.actualWindowMm===0));
    for(const day of days){
      assert.ok(day.forecastMaxProbPct>=0&&day.forecastMaxProbPct<=100);
      for(const key of ['forecastMaxHourlyMm','actualWindowMm','actualMaxHourlyMm','actualDayMm','preWindowMm'])
        assert.ok(day[key]>=0,`${siteId} ${day.date} ${key}: ${day[key]}`);
      assert.ok(day.actualDayMm>=day.actualWindowMm);
    }
  }
});

test('daily experience keeps the 05-09 tapping window, the hour before it and complete days only',()=>{
  const forecast=hourlyJson('2026-10-01','2026-10-02',true),archive=hourlyJson('2026-10-01','2026-10-02',false);
  archive.hourly.precipitation[4]=0.7;archive.hourly.precipitation[30]=null;
  const days=dailyExperience(forecast,archive);
  assert.deepEqual(days.map(day=>day.date),['2026-10-01']);
  assert.equal(days[0].preWindowMm,0.7);
  assert.equal(days[0].forecastMaxProbPct,pattern('2026-10-01').prob);
});

test('replay runs the real small-brain rule and scores against fixed field truth',()=>{
  const days=dailyExperience(hourlyJson('2026-08-01','2026-09-30',true),hourlyJson('2026-08-01','2026-09-30',false));
  const {metrics,rows}=replayDecisions(days,WEATHER_THRESHOLDS);
  assert.equal(metrics.days,days.length-7);
  assert.ok(rows.filter(row=>pattern(row.date).prob===65).every(row=>row.outcome==='false_defer'));
  assert.ok(rows.filter(row=>pattern(row.date).act>=1).every(row=>row.outcome==='miss'||row.outcome==='correct_defer'));
  assert.equal(metrics.cost,Math.round((metrics.miss*3+metrics.falseDefer+metrics.extraReview*0.2)*10)/10);
  const stricter=replayDecisions(days,{...WEATHER_THRESHOLDS,rainProbabilityDeferPct:50}).metrics;
  assert.ok(stricter.falseDefer>metrics.falseDefer);
});

test('search proposes only one guarded step toward the best direction and never a worse first step',()=>{
  const days=dailyExperience(hourlyJson('2026-08-01','2026-09-30',true),hourlyJson('2026-08-01','2026-09-30',false));
  const result=searchImprovement(days,WEATHER_THRESHOLDS);
  const rec=result.recommendation;
  assert.equal(rec.key,'rainProbabilityDeferPct');
  assert.equal(rec.firstStep.to,70);
  assert.ok(rec.firstStep.metrics.cost<result.baseline.cost);
  assert.ok(rec.firstStep.metrics.miss<=result.baseline.miss);
  assert.ok(result.explored.every(item=>Math.abs(item.firstStep.to-WEATHER_THRESHOLDS[item.key])<=({rainProbabilityDeferPct:10,lightRainMaxMmPerPeriod:0.3,recentWetSpellMm:3})[item.key]+1e-9));
  const optimum={...WEATHER_THRESHOLDS,rainProbabilityDeferPct:80,recentWetSpellMm:15};
  const settled=searchImprovement(days,optimum);
  assert.ok(!settled.recommendation||settled.recommendation.firstStep.metrics.cost<settled.baseline.cost||settled.recommendation.best.metrics.cost<settled.baseline.cost);
});

test('experience store fetches once, reuses the cache, falls back to stale cache and to labelled simulation offline',async()=>{
  const store=new Store(':memory:'),calls=[];let now=new Date('2026-10-21T02:00:00Z');
  const experience=new WeatherExperience({store,clock:()=>now,fetchJson:fakeFetch(calls)});
  const first=await experience.load('demo-hainan');
  assert.equal(first.source,'measured');
  assert.equal(calls.length,2);
  assert.ok(calls[0].includes('latitude=19.8')&&calls[0].includes('end_date=2026-10-20'));
  assert.equal((await experience.load('hainan')).days.length,first.days.length);
  assert.equal(calls.length,2);
  now=new Date(+now+3*DAY);
  const failing=new WeatherExperience({store,clock:()=>now,fetchJson:async()=>{throw new Error('offline');}});
  const stale=await failing.load('demo-hainan');
  assert.equal(stale.stale,true);assert.equal(stale.source,'measured');
  const offline=await new WeatherExperience({store:new Store(':memory:'),clock:()=>now,offline:true}).load('demo-xsbn');
  assert.equal(offline.source,'simulated');
  assert.deepEqual(simulatedExperience('demo-xsbn','2026-10-23'),simulatedExperience('demo-xsbn','2026-10-23'));
});

async function fixture(t,clock){
  const app=createApp({dbPath:':memory:',generator:new RuleGenerator(),clock:()=>clock.now,pauseModelsOnStart:true,
    weatherExperience:null});
  t.after(()=>{clearCerebellumThresholds();return app.close();});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=async(path,{input,token,status=200}={})=>{
    const response=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Rubber-Session':token}:{})},body:input===undefined?undefined:JSON.stringify(input)});
    const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);return data;};
  const login=async accountId=>(await call('/api/auth/login',{input:{accountId},status:201})).token;
  return {app,call,login};
}

test('HTTP loop: replay evaluation, guarded proposal with evidence, approval gate, review and decision item',async t=>{
  const clock={now:new Date('2026-10-21T02:00:00Z')};
  const {app,call,login}=await fixture(t,clock);
  // Swap in an experience store backed by the deterministic archive.
  const {WeatherExperience:Experience}=await import('../src/brain-evolution.js');
  const experience=new Experience({store:app.store,clock:()=>clock.now,fetchJson:fakeFetch()});
  app.assistant.toolkit.evolution.experience=experience;
  const manager=await login('manager-hn'),grower=await login('grower-hn-wang'),operator=await login('operator-hn');
  await call('/api/brain/evolution?siteId=demo-hainan',{token:grower,status:403});
  const view=await call('/api/brain/evolution?siteId=demo-hainan',{token:operator});
  assert.equal(view.experience.source,'measured');
  assert.equal(view.routing.total,200);
  assert.equal(view.routing.smallBrain+view.routing.bigBrain+view.routing.blocked,200);
  assert.equal(view.recommendation.key,'rainProbabilityDeferPct');
  assert.equal(view.review.status,'default');
  const brief=await call('/api/workspace/brief?siteId=demo-hainan',{token:manager});
  assert.ok(brief.items.some(item=>item.id==='brain-learn'&&item.action.type==='cerebellum'));
  await call('/api/brain/evolution/propose',{token:operator,input:{siteId:'demo-hainan'},status:403});
  const {proposal}=await call('/api/brain/evolution/propose',{token:manager,input:{siteId:'demo-hainan'},status:201});
  assert.equal(proposal.origin,'rsi_replay');
  assert.deepEqual(proposal.changes.map(change=>[change.key,change.from,change.to]),[['rainProbabilityDeferPct',60,70]]);
  assert.equal(proposal.replay.verdict,'better');
  assert.ok(proposal.replay.changedDays.length>0&&proposal.replay.changedDays.every(day=>day.before!==day.after));
  assert.ok(!(await call('/api/workspace/brief?siteId=demo-hainan',{token:manager})).items.some(item=>item.id==='brain-learn'));
  await call(`/api/cerebellum/proposals/${proposal.id}/decision`,{token:manager,input:{decision:'approve'}});
  // A model proposal that replays worse needs a written reason before approval.
  const worse=app.assistant.toolkit.cerebellum.proposeFromModel('demo-hainan',{changes:[{key:'rainProbabilityDeferPct',to:60,reason:'试探'}],rationale:'回到原阈值'},'assistant:test');
  assert.equal(worse.replay.verdict,'worse');
  const refused=await call(`/api/cerebellum/proposals/${worse.id}/decision`,{token:manager,input:{decision:'approve'},status:409});
  assert.equal(refused.error.code,'REPLAY_WORSE_NEEDS_NOTE');
  await call(`/api/cerebellum/proposals/${worse.id}/decision`,{token:manager,input:{decision:'reject'}});
  clock.now=new Date(+clock.now+3*DAY);
  assert.equal((await call('/api/brain/evolution?siteId=demo-hainan',{token:await login('manager-hn')})).review.status,'collecting');
  clock.now=new Date(+clock.now+9*DAY);
  const reviewed=await call('/api/brain/evolution?siteId=demo-hainan',{token:await login('manager-hn')});
  assert.equal(reviewed.review.status,'reviewed');
  assert.equal(reviewed.review.verdict,'keep');
  assert.ok(reviewed.review.collectedDays>=7);
  assert.deepEqual(reviewed.generations.map(item=>[item.version,item.source]),[[1,'proposal']]);
  assert.ok(reviewed.generations[0].replay.after<reviewed.generations[0].replay.before);
  assert.equal(reviewed.activeVersion,'v1');
});

test('assistant reads the loop without proposing, and an explicit tuning request uses the cached replay',async t=>{
  const clock={now:new Date('2026-10-21T02:00:00Z')};
  const {app,call,login}=await fixture(t,clock);
  const {WeatherExperience:Experience}=await import('../src/brain-evolution.js');
  const evolution=app.assistant.toolkit.evolution;
  evolution.experience=new Experience({store:app.store,clock:()=>clock.now,fetchJson:fakeFetch()});
  await evolution.evaluate('demo-hainan');
  const token=await login('manager-hn');
  const session=await call('/api/assistant/sessions',{token,input:{siteId:'demo-hainan',role:'manager'},status:201});
  const send=async message=>{
    const accepted=await call(`/api/assistant/sessions/${session.sessionId}/turns`,{token,input:{message,mode:'demo'},status:202});
    for(let attempt=0;attempt<100;attempt++){const turn=await call(`/api/assistant/sessions/${session.sessionId}/turns/${accepted.turnId}`,{token});if(['completed','failed'].includes(turn.status))return turn;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.fail('assistant turn did not finish');};
  const read=await send('大脑最近学到了什么？今天分流情况怎样？');
  assert.equal(read.status,'completed',read.error);
  assert.ok(read.tools.some(tool=>tool.name==='read_brain_evolution'));
  assert.ok(!read.tools.some(tool=>tool.name==='propose_cerebellum_tuning'));
  assert.match(read.answer,/今日分流/);
  assert.equal(app.cerebellum.proposals('demo-hainan').length,0);
  const propose=await send('小脑参数要不要调整一下？');
  assert.ok(propose.tools.some(tool=>tool.name==='propose_cerebellum_tuning'));
  const created=app.cerebellum.proposals('demo-hainan')[0];
  assert.equal(created.origin,'rsi_replay');
  assert.match(propose.answer,/沙箱回放/);
});
