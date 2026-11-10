import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {assertNodeVersion,inspectInstallation,assertPortAvailable} from './frontend/scripts/preflight.mjs';

const projectRoot=fileURLToPath(new URL('./',import.meta.url));
export const FUSION_USAGE='node start-fusion.mjs [--check] [--demo-data | --demo] [--frontend-port 4298] [--backend-port 4498]';

export function parseFusionOptions(args,inheritedEnv=process.env,root=projectRoot){
  const env={...inheritedEnv};
  let check=false,help=false,demo=false,demoData=false;
  for(let i=0;i<args.length;i++){
    const flag=args[i];
    if(flag==='--help'){help=true;continue;}
    if(flag==='--check'){check=true;continue;}
    if(flag==='--demo'){demo=true;continue;}
    if(flag==='--demo-data'){demoData=true;continue;}
    const key={'--frontend-port':'FRONTEND_PORT','--backend-port':'HARNESS_PORT'}[flag];
    if(!key||!args[i+1]||args[i+1].startsWith('--'))throw Error('未知参数或缺少参数值：'+flag+'\n用法：'+FUSION_USAGE);
    env[key]=args[++i];
  }
  if(demo&&demoData)throw Error('--demo 与 --demo-data 不能同时使用。');
  const port=(value,fallback)=>{
    const parsed=Number(value??fallback);
    if(!Number.isInteger(parsed)||parsed<1||parsed>65535)throw Error('端口必须是 1–65535 的整数。');
    return parsed;
  };
  const frontendPort=port(env.FRONTEND_PORT,4298),backendPort=port(env.HARNESS_PORT,4498);
  if(frontendPort===backendPort)throw Error('前后端不能使用相同端口。');
  const dataMode=demo||demoData?'demo':'mixed_demo',backendUrl=`http://127.0.0.1:${backendPort}`;
  const maxTreeModelRequestsPer24Hours=Number(env.HARNESS_TREE_MODEL_REQUESTS_PER_24H??1566);
  if(!Number.isInteger(maxTreeModelRequestsPer24Hours)||maxTreeModelRequestsPer24Hours<1)throw Error('HARNESS_TREE_MODEL_REQUESTS_PER_24H 必须为正整数。');
  Object.assign(env,{FRONTEND_PORT:String(frontendPort),HARNESS_PORT:String(backendPort),HARNESS_URL:backendUrl,VITE_HARNESS_URL:backendUrl,
    HARNESS_DATA_MODE:dataMode,VITE_HARNESS_DATA_MODE:dataMode,HARNESS_AUTOMATIC:'0',HARNESS_REQUIRE_IDENTITY:'true',
    HARNESS_OFFLINE:demo||demoData?'1':'0',HARNESS_RULES_ONLY:demo?'1':'0',HARNESS_DEMO:demo?'1':'0'});
  return {root,env,check,help,demo,demoData,frontendPort,backendPort,backendUrl,dataMode,publicData:!demo&&!demoData,
    strategyRefreshConfig:{enabled:true,intervalMinutes:60,startupCatchUp:true,siteIds:['demo-hainan'],modelsEnabled:!demo,treeModelsEnabled:!demo,maxTreeModelRequestsPer24Hours},
    dbPath:resolve(root,env.HARNESS_DB_PATH||'backend/var/fusion.sqlite'),
    origins:[`http://127.0.0.1:${frontendPort}`,`http://localhost:${frontendPort}`]};
}

export function assistantEnvironment(env){
  const assistant={...env,HARNESS_GENERATOR:'llm',CANDIDATE_SERVICE_URL:undefined};
  for(const field of ['PROVIDER','MODEL','BASE_URL','API_KEY','TIMEOUT_MS','PROTOCOL','OUTPUT_MODE','MAX_OUTPUT_TOKENS']){
    if(env[`ASSISTANT_${field}`]!==undefined)assistant[`LLM_${field}`]=env[`ASSISTANT_${field}`];
  }
  // A separately selected provider uses its own provider key unless explicitly overridden.
  if(env.ASSISTANT_PROVIDER&&env.ASSISTANT_PROVIDER!==env.LLM_PROVIDER&&!env.ASSISTANT_API_KEY)delete assistant.LLM_API_KEY;
  return assistant;
}

export async function prepareFusionSnapshots(prepareTrees,prepareReferences,data){
  const trees=await prepareTrees(data);
  let references;
  try{references=await prepareReferences(data);}
  catch(error){references={items:['industry_brief','scenarios'].map(kind=>({kind,status:'failed',error:error.message}))};}
  return {...trees,items:[...(references.items??[]).filter(row=>!trees.items.some(tree=>tree.kind===row.kind)),...trees.items]};
}

async function readJson(root,name){
  try{return JSON.parse(await readFile(resolve(root,'backend/config',name),'utf8'));}
  catch{throw Error(`backend/config/${name} 缺失或 JSON 格式错误。`);}
}

export async function preflightFusion(args=[],inheritedEnv=process.env,root=projectRoot){
  assertNodeVersion();
  await inspectInstallation(root);
  let local={};
  try{local=parseEnv(await readFile(resolve(root,'backend/.env.local'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw Error('backend/.env.local 无法读取或格式错误。');}
  const options=parseFusionOptions(args,{...local,...inheritedEnv},root);
  // Probe both ports before constructing the app, preparing snapshots or starting collectors.
  await assertPortAvailable(options.frontendPort);
  await assertPortAvailable(options.backendPort,'后端');
  const automaticConfig=await readJson(root,'automatic.json');
  if(typeof automaticConfig?.enabled!=='boolean'||!Array.isArray(automaticConfig.jobs)||!automaticConfig.jobs.length)throw Error('backend/config/automatic.json 缺少有效的 enabled 和 jobs 配置。');
  let sourceConfig=null;
  if(options.publicData){
    const {validateConfig}=await import('./backend/src/adapters/public-data.js');
    sourceConfig=validateConfig(await readJson(root,'data-sources.json'));
  }
  const [{mhGenerator},{configuredGenerator}]=await Promise.all([import('./backend/src/mh-generator.js'),import('./backend/src/generator-config.js')]);
  const generator=mhGenerator({rules:options.demo,env:options.env,loadEnv:()=>{}});
  const assistantGenerator=options.demo?generator:configuredGenerator(assistantEnvironment(options.env));
  if(!options.demo){
    if(!['llm','candidate_service'].includes(generator.mode)||generator.describe?.().configured!==true)throw Error('策略模型配置不完整；请检查 backend/.env.local，或使用 --demo 运行离线规则演示。');
    if(assistantGenerator.mode!=='llm'||assistantGenerator.describe?.().configured!==true)throw Error('助理模型配置不完整；请检查 ASSISTANT_* / LLM_* 配置，或使用 --demo。');
  }
  return {...options,automaticConfig,sourceConfig,generator,assistantGenerator};
}

export function formatFusionCheck(options){
  return [`融合主版本预检通过 · Node.js ${process.versions.node} · 前端依赖可用`,
    `前端：http://127.0.0.1:${options.frontendPort}/（端口空闲）`,
    `后端：${options.backendUrl}（端口空闲）`,
    `数据：${options.dataMode} · ${options.publicData?'公开资料采集开启':'公开资料采集关闭'} · ${options.demo?'离线规则模式':'策略与助理模型配置已核对，未验证联网可用性'}`,
    `策略后台每 ${options.strategyRefreshConfig.intervalMinutes} 分钟更新，启动时补齐；${options.demo?'离线规则模式':'复杂单树与全园生产自动使用已配置模型'}；采用和派单仍需人工确认。`,
    '预检未启动服务、未创建数据库、未生成策略、未调用模型。'].join('\n');
}

async function stopChild(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolveStop=>{
    let timer;
    const finish=()=>{clearTimeout(timer);resolveStop();};
    child.once('exit',finish);child.once('error',finish);child.kill();
    timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');finish();},3000);
  });
}

export async function launchFusion(options,registerClose=()=>{}){
  let app,service,preparing,ui,closing=false,closePromise,finish;
  const sourceAbort=new AbortController();
  const done=new Promise(resolveDone=>{finish=resolveDone;});
  const controller={config:options,done,close};
  function close(code=0){
    if(closePromise)return closePromise;
    closing=true;sourceAbort.abort();
    closePromise=(async()=>{
      try{await Promise.all([stopChild(preparing),stopChild(ui)]);await service?.stop();await app?.close();}
      finally{finish(code);}
    })();
    return closePromise;
  }
  registerClose(close);
  const fail=error=>{console.error('融合版服务退出：'+error.message);void close(1);};
  async function prepare({siteId='demo-hainan',reason='startup'}={}){
    if(closing)throw Error('服务正在停止，已停止本轮策略准备。');
    try{return await new Promise((resolvePrepare,reject)=>{
      let output='';
      preparing=spawn(process.execPath,['scripts/prepare-harness.mjs'],{cwd:resolve(options.root,'frontend'),env:{...options.env,HARNESS_SITE_ID:siteId,HARNESS_PREPARE_REASON:reason,HARNESS_PREPARE_TREES:'0'},stdio:['ignore','pipe','inherit'],windowsHide:true});
      preparing.stdout.setEncoding('utf8');
      preparing.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
      preparing.once('error',reject);
      preparing.once('close',(code,signal)=>{
        if(code!==0){reject(Error(`规则快照准备失败（${code??signal}）。`));return;}
        const report=output.trim().split('\n').reverse().map(line=>{try{return JSON.parse(line);}catch{return null;}})
          .find(row=>row?.type==='strategy-snapshots'&&row.siteId===siteId);
        if(!report){reject(Error('规则快照准备未返回完成状态。'));return;}
        resolvePrepare(report);
      });
    });}finally{preparing=undefined;}
  }
  try{
    const [{createMhApp},{AssistantModel},{PublicDataService}]=await Promise.all([
      import('./backend/src/mh-app.js'),import('./backend/src/adapters/assistant-model.js'),import('./backend/src/adapters/public-data.js')]);
    if(closing)return controller;
    if(options.publicData)service=new PublicDataService({directory:resolve(options.root,'backend/data/real-sources'),config:options.sourceConfig,
      fetchImpl:(url,init={})=>fetch(url,{...init,signal:AbortSignal.any([sourceAbort.signal,...(init.signal?[init.signal]:[])])})});
    app=createMhApp({dbPath:options.dbPath,generator:options.generator,assistantModel:new AssistantModel({generator:options.assistantGenerator}),
      publicDataService:service??null,dataMode:options.dataMode,automaticConfig:options.automaticConfig,enableAutomatic:false,
      strategyRefreshConfig:options.strategyRefreshConfig,
      allowedOrigins:options.origins,requireIdentity:true});
    await new Promise((resolveListen,reject)=>{
      const failed=error=>reject(error);
      app.server.once('error',failed);
      app.server.listen(options.backendPort,'127.0.0.1',()=>{app.server.off('error',failed);resolveListen();});
    });
    if(closing)return controller;
    app.server.on('error',fail);service?.start();
    console.log(`融合主版本后端 ${options.backendUrl} · 策略后台每60分钟更新`);
    // All parks share the routed worker, budget and pending bindings. Auxiliary
    // scenario/industry preparation cannot prevent automatic tree analysis.
    app.strategyRefresh.setPrepareSnapshots(data=>prepareFusionSnapshots(
      input=>app.strategyRefresh.prepareSiteSnapshots(input),prepare,data));
    ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(options.frontendPort),'--strictPort'],{
      cwd:resolve(options.root,'frontend'),env:options.env,stdio:'inherit',windowsHide:true});
    ui.once('error',fail);
    ui.once('exit',(code,signal)=>{if(!closing){if(code!==0)console.error(`前端退出（${code??signal}）。`);void close(code??1);}});
    app.strategyRefresh.start();
    console.log('正在后台补齐单树、场景、行业、生产与销售策略；可先打开页面查看更新进度。');
    console.log(`融合主版本前端：http://127.0.0.1:${options.frontendPort}/ · Ctrl+C 停止本次启动的服务`);
    return controller;
  }catch(error){
    if(closing){await closePromise;return controller;}
    await close(1);throw error;
  }
}

export async function runFusion(args=process.argv.slice(2),env=process.env){
  if(parseFusionOptions(args,env).help){console.log(FUSION_USAGE);return 0;}
  const checked=await preflightFusion(args,env);
  console.log(formatFusionCheck(checked));
  if(checked.check)return 0;
  let close;
  const stop=()=>{void close?.();};
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  try{const controller=await launchFusion(checked,value=>{close=value;});return await controller.done;}
  finally{for(const signal of ['SIGINT','SIGTERM'])process.off(signal,stop);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=await runFusion();}
  catch(error){console.error(error.message);process.exitCode=1;}
}
