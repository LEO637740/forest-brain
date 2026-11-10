import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE_SCENARIOS, runAcceptance } from './acceptance-scenarios.mjs';
import { renderAcceptanceReport } from './acceptance-report.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
let ids,selectionProvided=false,output=join(root,'verification','acceptance');
try {
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--help'||arg==='--list'){
      console.log('离线验收：node scripts/run-acceptance.mjs [--scenario 编号] [--output-dir 报告父目录]\n每次创建独立内存数据库和新的报告目录；不加载密钥，不访问网络或实际设备。');
      console.log(ACCEPTANCE_SCENARIOS.map(s=>`${s.id}\t${s.title}`).join('\n'));
      process.exit(0);
    }
    if(!['--scenario','--output-dir'].includes(arg)||!args[i+1]||args[i+1].startsWith('--'))throw Error(`参数无效：${arg}`);
    const value=args[++i];
    if(arg==='--scenario'){
      if(selectionProvided)throw Error('--scenario 只能指定一次');
      selectionProvided=true;
      ids=value==='all'?undefined:value.split(',');
    } else output=resolve(value);
  }
  const report=await runAcceptance(ids);
  await mkdir(output,{recursive:true});
  const directory=await mkdtemp(join(output,'run-'));
  await writeFile(join(directory,'acceptance.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(join(directory,'acceptance.html'),renderAcceptanceReport(report),{flag:'wx'});
  for(const scenario of report.scenarios)console.log(`${scenario.passed?'通过':'失败'} · ${scenario.title} · ${scenario.checks.filter(c=>c.passed).length}/${scenario.checks.length} 项检查${scenario.error?' · '+scenario.error:''}`);
  console.log(`报告：${join(directory,'acceptance.html')}\n完整证据：${join(directory,'acceptance.json')}\n配置模型调用：${report.modelRequests}；结果指纹：${report.repeatabilityDigest}`);
  if(!report.passed)process.exitCode=1;
} catch(error) { console.error(`验收未完成：${error.message}`);process.exitCode=1; }
