import {access, readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {connectionConfig, inspectBackend} from './connection.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function assertNodeVersion(version = process.versions.node) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 24 || major === 24 && minor < 14) {
    throw Error('请安装 Node.js 24.14.0 或以上版本，当前为 ' + version);
  }
}

// Binding and immediately releasing checks the same IPv4 address Vite uses.
// It never kills an occupant or picks a different port silently.
export async function assertPortAvailable(port, label = '前端') {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(Error(error.code === 'EADDRINUSE'
      ? `${label}端口 ${port} 已被占用；请停止对应服务或通过 --${label === '前端' ? 'frontend' : 'backend'}-port 更换端口。`
      : `${label}端口 ${port} 无法监听 (${error.code || 'unknown'})。`)));
    probe.listen({host:'127.0.0.1', port, exclusive:true}, () => probe.close(error => error ? reject(error) : resolve()));
  });
}

export async function inspectInstallation(root = projectRoot) {
  for (const path of ['backend/start-mh.mjs', 'frontend/scripts/prepare-harness.mjs', 'frontend/node_modules/vite/bin/vite.js']) {
    try { await access(resolve(root, path)); }
    catch { throw Error(`启动文件缺失：${path}；前端依赖请在 frontend 目录执行 npm ci。`); }
  }
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(root, 'frontend/package.json'), 'utf8')); }
  catch { throw Error('frontend/package.json 缺失或 JSON 格式错误。'); }
  const require = createRequire(resolve(root, 'frontend/package.json'));
  for (const dependency of Object.keys({...pkg.dependencies, ...pkg.devDependencies})) {
    try { require.resolve(dependency + '/package.json'); }
    catch {
      try { require.resolve(dependency); }
      catch { throw Error(`前端依赖 ${dependency} 不完整；请在 frontend 目录执行 npm ci。`); }
    }
  }
}

async function readConfig(name) {
  try { return JSON.parse(await readFile(resolve(projectRoot, 'backend/config', name), 'utf8')); }
  catch { throw Error(`backend/config/${name} 缺失或 JSON 格式错误。`); }
}

export async function inspectLocalConfiguration(env, config) {
  const automatic = await readConfig('automatic.json');
  if (!automatic || typeof automatic.enabled !== 'boolean' || !Array.isArray(automatic.jobs) || !automatic.jobs.length) {
    throw Error('backend/config/automatic.json 缺少有效的 enabled 和 jobs 配置。');
  }
  if (env.HARNESS_OFFLINE !== '1') {
    const {validateConfig} = await import('../../backend/src/adapters/public-data.js');
    validateConfig(await readConfig('data-sources.json'));
  }
  if (!config.requireModel) return {mode:'demo_rules', configured:true};
  let local = {};
  try { local = parseEnv(await readFile(resolve(projectRoot, 'backend/.env.local'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('backend/.env.local 无法读取或格式错误。'); }
  // Match process.loadEnvFile: exported environment values take precedence.
  // Constructing the adapter validates configuration; generate() is never called.
  const {configuredGenerator} = await import('../../backend/src/generator-config.js');
  const generator = configuredGenerator({...local, ...env});
  if (!['llm', 'candidate_service'].includes(generator.mode) || generator.describe?.().configured !== true) {
    throw Error('模型尚未配置完整；请检查 backend/.env.local，或使用 --demo 运行离线规则演示。');
  }
  return {mode:generator.mode, configured:true};
}

export async function preflight(env = process.env, {inspect = inspectBackend} = {}) {
  assertNodeVersion();
  const config = connectionConfig(env);
  await inspectInstallation();
  // Fail before any backend launch, strategy preparation or model scheduling.
  await assertPortAvailable(config.frontendPort);
  const backend = await inspect(config);
  let model = {mode:'existing_backend', configured:true};
  if (!backend.running) {
    await assertPortAvailable(config.backendPort, '后端');
    model = await inspectLocalConfiguration(env, config);
  }
  return {config, backend, model};
}

export function formatPreflight({config, backend, model}) {
  return [
    `预检通过 · Node.js ${process.versions.node} · 前端依赖可用`,
    `前端：http://127.0.0.1:${config.frontendPort}/（端口空闲）`,
    `后端：${config.backendUrl}（${backend.running ? '已有兼容服务' : '端口空闲，启动配置可读'}）`,
    `数据：${config.dataMode} · ${model.mode === 'demo_rules' ? '离线/规则模式' : '模型配置已核对，未验证模型联网可用性'}`,
    ...(config.requireIdentity ? ['登录：强制登录，未登录的业务请求一律拒绝；启动器与策略准备使用“海口机器人运营”身份'] : []),
    '预检未启动服务、未生成策略、未调用模型。',
  ].join('\n');
}
