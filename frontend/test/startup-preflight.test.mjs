import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseStartOptions} from '../scripts/launcher-options.mjs';
import {assertNodeVersion, assertPortAvailable, formatPreflight, inspectInstallation, inspectLocalConfiguration, preflight} from '../scripts/preflight.mjs';
import {connectionConfig} from '../scripts/connection.mjs';
import {backendLaunchArgs} from '../scripts/serve-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function listener(t) {
  const server = createServer(socket => socket.end());
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}
async function unusedPort(t) {
  const server = await listener(t), port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fingerprint(path) {
  try {const value = await stat(new URL('../../' + path, import.meta.url));return {size:value.size, mtimeMs:value.mtimeMs};}
  catch (error) {if (error.code === 'ENOENT') return null;throw error;}
}

test('default automatic semantics remain explicit, while demo cannot call models', () => {
  const normal = parseStartOptions([], {});
  assert.equal(normal.env.HARNESS_AUTOMATIC, '1');
  assert.ok(backendLaunchArgs(normal.env, connectionConfig(normal.env)).includes('--automatic'));
  const manual = parseStartOptions(['--no-automatic'], {});
  assert.equal(manual.env.HARNESS_AUTOMATIC, undefined);
  assert.ok(backendLaunchArgs(manual.env, connectionConfig(manual.env)).includes('--no-automatic'));
  const inherited = {HARNESS_DATA_MODE:'mixed_demo', HARNESS_AUTOMATIC:'1'};
  const demo = parseStartOptions(['--demo', '--automatic', '--check'], inherited);
  assert.equal(demo.check, true);
  assert.equal(demo.env.HARNESS_DATA_MODE, 'demo');
  assert.equal(demo.env.HARNESS_AUTOMATIC, undefined);
  assert.equal(demo.env.HARNESS_OFFLINE, '1');
  assert.equal(demo.env.HARNESS_RULES_ONLY, '1');
  assert.equal(inherited.HARNESS_DATA_MODE, 'mixed_demo');
  const args = backendLaunchArgs(demo.env, connectionConfig(demo.env));
  for (const flag of ['--offline', '--rules', '--no-automatic']) assert.ok(args.includes(flag));
  assert.throws(() => parseStartOptions(['--frontend-port', '--check'], {}), /缺少参数/);
  assert.throws(() => parseStartOptions(['--unknown'], {}), /未知参数/);
});

test('--require-login reaches the backend launch, the reuse check and the preflight summary', () => {
  assert.equal(normalLogin().HARNESS_REQUIRE_IDENTITY, undefined);
  const strict = parseStartOptions(['--demo', '--require-login'], {});
  assert.equal(strict.env.HARNESS_REQUIRE_IDENTITY, 'true');
  const config = connectionConfig(strict.env);
  assert.equal(config.requireIdentity, true);
  assert.ok(backendLaunchArgs(strict.env, config).includes('--require-login'));
  assert.ok(!backendLaunchArgs(normalLogin(), connectionConfig(normalLogin())).includes('--require-login'));
  const summary = formatPreflight({config, backend:{running:false}, model:{mode:'demo_rules'}});
  assert.match(summary, /强制登录/);
  assert.doesNotMatch(formatPreflight({config:connectionConfig({}), backend:{running:false}, model:{mode:'demo_rules'}}), /强制登录/);
  function normalLogin() { return parseStartOptions([], {}).env; }
});

test('runtime and missing installation errors are actionable', async () => {
  assert.throws(() => assertNodeVersion('24.13.9'), /24.14.0/);
  assert.throws(() => assertNodeVersion('22.20.0'), /24.14.0/);
  assert.doesNotThrow(() => assertNodeVersion('24.14.0'));
  assert.doesNotThrow(() => assertNodeVersion('25.0.0'));
  await assert.rejects(inspectInstallation(new URL('./missing-installation', import.meta.url).pathname), /启动文件缺失/);
});

test('occupied frontend port fails before backend inspection or preparation', async t => {
  const server = await listener(t);
  let inspections = 0;
  const {env} = parseStartOptions(['--demo', '--frontend-port', String(server.address().port)], {});
  await assert.rejects(preflight(env, {inspect:async () => {inspections++; return {running:false};}}), /前端端口.*已被占用/);
  assert.equal(inspections, 0);
  assert.equal(server.listening, true);
});

test('an unused port probe releases its listener immediately', async t => {
  const port = await unusedPort(t);
  await assertPortAvailable(port);
  await assertPortAvailable(port);
});

test('model config inspection never calls the configured endpoint or changes process env', async () => {
  const env = {CANDIDATE_SERVICE_URL:'http://127.0.0.1:1/model', CANDIDATE_MODEL_VERSION:'test-no-call', HARNESS_OFFLINE:undefined, HARNESS_RULES_ONLY:undefined};
  const previous = process.env.CANDIDATE_SERVICE_URL;
  const model = await inspectLocalConfiguration(env, connectionConfig(env));
  assert.deepEqual(model, {mode:'candidate_service', configured:true});
  assert.equal(process.env.CANDIDATE_SERVICE_URL, previous);
});

test('check command exits without starting services or changing data files', async t => {
  const backendPort = await unusedPort(t), frontendPort = await unusedPort(t);
  const paths = ['backend/var/brain.sqlite', 'backend/var/brain.sqlite-wal', 'frontend/public/harness-session.json', 'frontend/dist/harness-session.json'];
  const before = await Promise.all(paths.map(fingerprint));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['start.mjs', '--check', '--demo', '--backend-port', String(backendPort), '--frontend-port', String(frontendPort)], {cwd:root, env:process.env, stdio:['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.once('error', reject);
    child.once('exit', code => resolve({code, output}));
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /预检未启动服务、未生成策略、未调用模型/);
  assert.match(result.output, /数据：demo/);
  assert.deepEqual(await Promise.all(paths.map(fingerprint)), before);
  await assertPortAvailable(backendPort, '后端');
  await assertPortAvailable(frontendPort);
});
