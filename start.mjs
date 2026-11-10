import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startHarness} from './frontend/scripts/serve-harness.mjs';
import {parseStartOptions, START_USAGE} from './frontend/scripts/launcher-options.mjs';
import {preflight, formatPreflight} from './frontend/scripts/preflight.mjs';
const frontend=fileURLToPath(new URL('./frontend/',import.meta.url));
let controller,stopHarness,ui,closing=false;
async function close(code=0){if(closing)return;closing=true;ui?.kill();await stopHarness?.();process.exit(code);}
// Register before preparation so interrupted startup also shuts down its child processes.
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{close();});
try{
  const {env,check,help}=parseStartOptions(process.argv.slice(2));
  if(help){console.log(START_USAGE);process.exit(0);}
  const checked=await preflight(env);
  console.log(formatPreflight(checked));
  if(check)process.exit(0);
  controller=await startHarness(env, close=>{stopHarness=close;});
  if(closing){await controller.close();process.exit(0);}
  ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(controller.config.frontendPort),'--strictPort'],{cwd:frontend,env:{...env,VITE_HARNESS_URL:controller.config.backendUrl,VITE_HARNESS_DATA_MODE:env.HARNESS_DATA_MODE||'mixed_demo'},stdio:'inherit'});
  ui.once('error',error=>{console.error(error.message);close(1);});
  ui.once('exit',code=>close(code??1));
  console.log(`前端：http://127.0.0.1:${controller.config.frontendPort}/ · Ctrl+C 停止本次启动的服务`);
}catch(error){console.error(error.message);await close(1);}
