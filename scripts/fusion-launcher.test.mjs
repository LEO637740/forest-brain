import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseFusionOptions,assistantEnvironment,preflightFusion,prepareFusionSnapshots} from '../start-fusion.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
test('fusion always runs the routed tree worker and preserves its outcome if auxiliary references fail',async()=>{
  const calls=[],data={siteId:'demo-hainan',modelsEnabled:true,reason:'startup'};
  const result=await prepareFusionSnapshots(async input=>{calls.push(input);return {modelRequests:1,items:[{kind:'pest_risk',status:'partial',fallbacks:1}]};},
    async()=>{throw Error('reference unavailable');},data);
  assert.deepEqual(calls,[data]);assert.equal(result.modelRequests,1);
  assert.equal(result.items.find(x=>x.kind==='pest_risk').fallbacks,1);
  assert.equal(result.items.find(x=>x.kind==='industry_brief').status,'failed');
});
async function listen(handler=(_req,res)=>res.end('kept')){
  const server=createServer(handler);
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  return {server,port:server.address().port,close:()=>new Promise(ok=>server.close(ok))};
}
async function freePort(){const listener=await listen();const port=listener.port;await listener.close();return port;}
async function ports(){const a=await listen(),b=await listen();const result={frontend:a.port,backend:b.port};await a.close();await b.close();return result;}
function invoke(args,env){
  return new Promise((ok,fail)=>{
    const child=spawn(process.execPath,['start-fusion.mjs',...args],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    child.once('error',fail);child.once('exit',(code,signal)=>ok({code,signal,output}));
  });
}
const argumentsFor=p=>['--frontend-port',String(p.frontend),'--backend-port',String(p.backend)];
async function stamp(path){try{const s=await stat(path);return {size:s.size,mtimeMs:s.mtimeMs};}catch(error){if(error.code==='ENOENT')return null;throw error;}}

test('fusion schedules hourly strategies while keeping offline modes and the legacy bulk runner distinct',()=>{
  const defaults=parseFusionOptions([],{},root);
  assert.equal(defaults.frontendPort,4298);assert.equal(defaults.backendPort,4498);
  assert.equal(defaults.publicData,true);assert.equal(defaults.dataMode,'mixed_demo');assert.equal(defaults.demo,false);
  assert.equal(defaults.dbPath,resolve(root,'backend/var/fusion.sqlite'));
  assert.deepEqual(defaults.strategyRefreshConfig,{enabled:true,intervalMinutes:60,startupCatchUp:true,siteIds:['demo-hainan'],modelsEnabled:true,treeModelsEnabled:true,maxTreeModelRequestsPer24Hours:1566});
  const data=parseFusionOptions(['--demo-data'],{HARNESS_AUTOMATIC:'1',HARNESS_DATA_MODE:'mixed_demo'},root);
  assert.equal(data.publicData,false);assert.equal(data.dataMode,'demo');assert.equal(data.demo,false);assert.equal(data.env.HARNESS_RULES_ONLY,'0');
  const demo=parseFusionOptions(['--demo'],{},root);
  assert.equal(demo.publicData,false);assert.equal(demo.demo,true);assert.equal(demo.env.HARNESS_RULES_ONLY,'1');
  assert.equal(demo.strategyRefreshConfig.modelsEnabled,false);
  assert.equal(demo.strategyRefreshConfig.treeModelsEnabled,false);
  assert.equal(data.strategyRefreshConfig.treeModelsEnabled,true);
  assert.equal(parseFusionOptions([],{HARNESS_TREE_MODEL_REQUESTS_PER_24H:'12'},root).strategyRefreshConfig.maxTreeModelRequestsPer24Hours,12);
  assert.throws(()=>parseFusionOptions([],{HARNESS_TREE_MODEL_REQUESTS_PER_24H:'0'},root));
  assert.equal(data.strategyRefreshConfig.modelsEnabled,true);
  assert.equal(demo.strategyRefreshConfig.enabled,true);
  for(const item of [defaults,data,demo]){assert.equal(item.env.HARNESS_AUTOMATIC,'0');assert.equal(item.env.HARNESS_REQUIRE_IDENTITY,'true');}
});

test('ports and database override remain local, synchronized and explicit',()=>{
  const env={FRONTEND_PORT:'5001',HARNESS_PORT:'5002',HARNESS_DB_PATH:'verification/isolation.sqlite',VITE_HARNESS_URL:'http://127.0.0.1:1111'};
  const options=parseFusionOptions(['--check','--frontend-port','5101','--backend-port','5102'],env,root);
  assert.equal(options.check,true);assert.equal(options.frontendPort,5101);assert.equal(options.backendPort,5102);
  assert.equal(options.env.HARNESS_URL,'http://127.0.0.1:5102');assert.equal(options.env.VITE_HARNESS_URL,options.env.HARNESS_URL);
  assert.deepEqual(options.origins,['http://127.0.0.1:5101','http://localhost:5101']);
  assert.equal(options.dbPath,resolve(root,env.HARNESS_DB_PATH));assert.equal(env.FRONTEND_PORT,'5001');
});

test('unknown, conflicting and invalid flags fail before startup',()=>{
  for(const args of [['--demo','--demo-data'],['--frontend-port'],['--backend-port','0'],['--frontend-port','65536'],['--backend-port','2.5'],['--backend-port','bad'],['--frontend-port','4498'],['--automatic']]){
    assert.throws(()=>parseFusionOptions(args,{},root));
  }
});

test('assistant provider and credentials remain independent from the strategy model and candidate gateway',()=>{
  const env={CANDIDATE_SERVICE_URL:'http://127.0.0.1:5000',LLM_PROVIDER:'deepseek',LLM_MODEL:'strategy',LLM_API_KEY:'strategy-key',ASSISTANT_PROVIDER:'dashscope',ASSISTANT_MODEL:'conversation',DASHSCOPE_API_KEY:'assistant-provider-key'};
  const own=assistantEnvironment(env);
  assert.equal(own.CANDIDATE_SERVICE_URL,undefined);assert.equal(own.HARNESS_GENERATOR,'llm');assert.equal(own.LLM_PROVIDER,'dashscope');assert.equal(own.LLM_MODEL,'conversation');assert.equal(own.LLM_API_KEY,undefined);
  assert.equal(own.DASHSCOPE_API_KEY,'assistant-provider-key');assert.equal(env.LLM_API_KEY,'strategy-key');
  assert.equal(assistantEnvironment({...env,ASSISTANT_API_KEY:'dedicated-key'}).LLM_API_KEY,'dedicated-key');
});

test('--demo --check creates no database, data snapshots or frontend session',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fusion-check-')),p=await ports();
  const watched=['backend/var/fusion.sqlite','backend/data/real-sources/latest.json','frontend/public/harness-session.json'].map(path=>resolve(root,path));
  const before=await Promise.all(watched.map(stamp));
  const result=await invoke(['--demo','--check',...argumentsFor(p)],{HARNESS_DB_PATH:join(dir,'must-not-exist.sqlite')});
  assert.equal(result.code,0,result.output);assert.match(result.output,/未创建数据库/);assert.match(result.output,/离线规则模式/);assert.match(result.output,/每 60 分钟更新/);
  assert.deepEqual(await readdir(dir),[]);assert.deepEqual(await Promise.all(watched.map(stamp)),before);
});

test('model and demo-data configuration checks never call either configured endpoint',async()=>{
  let calls=0;
  const endpoint=await listen((_req,res)=>{calls++;res.end('{}');});
  try{
    const dir=await mkdtemp(join(tmpdir(),'fusion-model-check-'));
    const env={...process.env,HARNESS_DB_PATH:join(dir,'unused.sqlite'),CANDIDATE_SERVICE_URL:'',HARNESS_GENERATOR:'llm',
      LLM_PROVIDER:'compatible',LLM_MODEL:'strategy-check',LLM_API_KEY:'do-not-print-check-key',LLM_BASE_URL:`http://127.0.0.1:${endpoint.port}/v1`,
      ASSISTANT_PROVIDER:'compatible',ASSISTANT_MODEL:'assistant-check',ASSISTANT_API_KEY:'do-not-print-assistant-key',ASSISTANT_BASE_URL:`http://127.0.0.1:${endpoint.port}/assistant/v1`};
    for(const mode of [[],['--demo-data']]){
      const p=await ports(),args=['--check',...mode,...argumentsFor(p)];
      const checked=await preflightFusion(args,env);
      assert.equal(checked.generator.describe().model,'strategy-check');assert.equal(checked.assistantGenerator.describe().model,'assistant-check');
      const result=await invoke(args,env);
      assert.equal(result.code,0,result.output);assert.doesNotMatch(result.output,/do-not-print/);
      assert.equal(checked.publicData,mode.length===0);assert.equal(checked.env.HARNESS_AUTOMATIC,'0');
    }
    assert.equal(calls,0);assert.deepEqual(await readdir(dir),[]);
  }finally{await endpoint.close();}
});

for(const side of ['frontend','backend'])test(`${side} occupied port fails before database creation and leaves its owner running`,async()=>{
  const occupied=await listen(),other=await freePort(),dir=await mkdtemp(join(tmpdir(),'fusion-port-'));
  try{
    const p=side==='frontend'?{frontend:occupied.port,backend:other}:{frontend:other,backend:occupied.port};
    const result=await invoke(['--demo',...argumentsFor(p)],{HARNESS_DB_PATH:join(dir,'must-not-exist.sqlite')});
    assert.equal(result.code,1,result.output);assert.match(result.output,/已被占用/);assert.deepEqual(await readdir(dir),[]);
    const response=await fetch(`http://127.0.0.1:${occupied.port}`);assert.equal(await response.text(),'kept');
  }finally{await occupied.close();}
});
