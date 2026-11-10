// Prepare snapshots explicitly before launching the read-only browser UI.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {connectionConfig, inspectBackend} from './connection.mjs';
import {assertPortAvailable} from './preflight.mjs';
const backend=fileURLToPath(new URL('../../backend/',import.meta.url));
const frontend=fileURLToPath(new URL('../',import.meta.url));

export function backendLaunchArgs(env, config) {
  const args=['start-mh.mjs','--port',String(config.backendPort),'--origins',config.origins.join(',')];
  if(env.HARNESS_OFFLINE==='1')args.push('--offline');
  if(env.HARNESS_RULES_ONLY==='1')args.push('--rules');
  if(env.HARNESS_REQUIRE_IDENTITY==='true')args.push('--require-login');
  args.push(env.HARNESS_AUTOMATIC==='1'?'--automatic':'--no-automatic');
  return args;
}

export async function startHarness(env=process.env, registerClose=()=>{}) {
  const config=connectionConfig(env);
  const childEnv={...env,HARNESS_URL:config.backendUrl,VITE_HARNESS_URL:config.backendUrl};
  let owned,preparing,timer,closed=false,busy=false,launchError;
  async function close(){
    if(closed)return;closed=true;clearInterval(timer);
    for(const child of [preparing,owned]) if(child&&child.exitCode===null&&!child.killed) {
      child.kill();
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
    }
  }
  registerClose(close);
  try {
    await assertPortAvailable(config.frontendPort);
    if(!(await inspectBackend(config)).running){
      const args=backendLaunchArgs(env,config);
      owned=spawn(process.execPath,args,{cwd:backend,env:childEnv,stdio:'inherit',windowsHide:true});
      owned.once('error',error=>{launchError=error;});
      let ready=false;
      for(let n=0;n<60;n++){
        if(closed)throw Error('启动已取消');
        if(launchError)throw launchError;
        if(owned.exitCode!==null)throw Error('后端启动退出，请检查上方日志');
        if((await inspectBackend(config)).running){ready=true;break;}
        await new Promise(r=>setTimeout(r,250));
      }
      if(!ready)throw Error('后端启动超时');
    }
    async function prepare(){
      if(busy||closed)return;busy=true;
      try{await new Promise((resolve,reject)=>{
        preparing=spawn(process.execPath,['scripts/prepare-harness.mjs'],{cwd:frontend,env:childEnv,stdio:'inherit',windowsHide:true});
        preparing.once('error',reject);preparing.once('exit',code=>code===0?resolve():reject(Error('策略准备失败：'+code)));
      });}finally{busy=false;preparing=undefined;}
    }
    await prepare();
    timer=setInterval(()=>prepare().catch(error=>console.error('策略更新失败；旧策略按有效期失效：',error.message)),45*60000);
    console.log(`后端 ${config.backendUrl} 已就绪；演示快照每 45 分钟更新；已生成的大模型树策略保留，需手动重新生成。`);
    return {close,config};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let controller;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await controller?.close();process.exit(0);});
  try{controller=await startHarness();}catch(error){console.error(error.message);process.exitCode=1;}
}
