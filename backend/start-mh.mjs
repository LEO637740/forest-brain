import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Package-only entry point. Business API implementation remains src/server.js.
// The demo launcher starts with scheduled analysis enabled; use --no-automatic
// for a read-only/manual session.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 14)) {
  console.error('请使用 Node.js 24.14.0 或以上版本。当前版本：' + process.version);
  process.exit(1);
}
const args = process.argv.slice(2);
const valueFlags = new Set(['--port', '--host', '--origins']);
const options = { port: 4188, host: '127.0.0.1', origins: 'http://localhost:4173,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173', offline: false, rules: false, automatic:true, requireLogin:process.env.HARNESS_REQUIRE_IDENTITY === 'true' };
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === '--help') {
    console.log('node start-mh.mjs [--port 4188] [--host 127.0.0.1] [--origins http://localhost:5173] [--rules] [--offline] [--automatic|--no-automatic] [--require-login]');
    process.exit(0);
  }
  if (flag === '--offline') { options.offline = true; continue; }
  if (flag === '--require-login') { options.requireLogin = true; continue; }
  if (flag === '--rules') { options.rules = true; options.automatic = false; continue; }
  if (flag === '--no-automatic') { options.automatic = false; continue; }
  if (flag === '--automatic') { options.automatic = true; continue; }
  if (!valueFlags.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error('未知参数或缺少参数值：' + flag); process.exit(1);
  }
  options[flag.slice(2)] = args[++i];
}
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('--port 必须是 1–65535 的整数。'); process.exit(1);
}
if (options.offline) options.automatic = false;
const local = ['localhost', '127.0.0.1', '::1'].includes(options.host);
const { mhGenerator } = await import('./src/mh-generator.js');
const generator = mhGenerator({ rules: options.rules || options.offline });
const dataMode=process.env.HARNESS_DATA_MODE??'mixed_demo';
if(!['demo','mixed_demo'].includes(dataMode)){console.error('HARNESS_DATA_MODE 必须为 demo 或 mixed_demo。');process.exit(1);}
const token = process.env.HARNESS_API_TOKEN || undefined;
if (!local && (!token || token.length < 24)) {
  console.error('跨机监听须先设置至少 24 字符的 HARNESS_API_TOKEN。具体命令见 README.md。');
  process.exit(1);
}
const root = fileURLToPath(new URL('./', import.meta.url));
const [{ createMhApp }, { PublicDataService }] = await Promise.all([
  import('./src/mh-app.js'), import('./src/adapters/public-data.js'),
]);
const readConfig = name => JSON.parse(readFileSync(resolve(root, 'config', name), 'utf8'));
const service = options.offline ? null : new PublicDataService({
  directory: resolve(root, 'data/real-sources'), config: readConfig('data-sources.json'),
});
const app = createMhApp({
  dbPath: process.env.HARNESS_DB_PATH ?? resolve(root, 'var/brain.sqlite'),
  generator, publicDataService: service,
  automaticConfig: readConfig('automatic.json'),enableAutomatic:options.automatic,dataMode,
  automaticOutputDir: resolve(root, 'data/automatic'),
  token, allowedOrigins: options.origins.split(',').map(x => x.trim()).filter(Boolean),
  allowRemoteHost: !local, requireIdentity: options.requireLogin,
});
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  await service?.stop();
  await app.close();
  process.exit(code);
}
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
app.server.on('error', error => { console.error(error.message); close(1); });
app.server.listen(port, options.host, () => {
  service?.start();
  if(options.automatic)app.automatic?.start();
  const displayHost = options.host.includes(':') ? `[${options.host}]` : options.host;
  console.log(`MH 后端联调：http://${displayHost}:${port}/blender-preview`);
  const model = generator.describe?.();
  console.log((generator.mode === 'demo_rules' ? '生成器：演示规则；模型不可用' : `生成器：${model?.provider ?? generator.mode} / ${model?.model ?? generator.modelVersion ?? '待配置'}；模型调用随自动调度恢复`) + (options.automatic?'；自动分析已启用（启动即检查，按周期或重要数据源变化触发）':'；自动模型分析关闭') + '；' + (options.offline ? '公开采集关闭' : '公开采集开启') + (options.requireLogin ? '；强制登录：未登录的业务请求一律拒绝' : ''));
  console.log('另开终端执行 npm run demo:prepare，再由前端点击 GET view。');
});
