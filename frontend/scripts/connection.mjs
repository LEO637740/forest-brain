import { INTEGRATION_VERSION, INTEGRATION_CAPABILITIES } from '../../backend/src/integration-version.js';
import { openServiceSession } from './service-session.mjs';

export function connectionConfig(env = process.env) {
  const port = (value, fallback) => {
    const result = Number(value || fallback);
    if (!Number.isInteger(result) || result < 1 || result > 65535) throw Error('端口必须是 1–65535 的整数');
    return result;
  };
  const backendPort = port(env.HARNESS_PORT, 4188), frontendPort = port(env.FRONTEND_PORT, 4173);
  if (backendPort === frontendPort) throw Error('前后端不能使用相同端口');
  if(env.HARNESS_AUTOMATIC==='1'&&(env.HARNESS_OFFLINE==='1'||env.HARNESS_RULES_ONLY==='1'))throw Error('自动模型分析不能与离线或规则模式同时启用。');
  const dataMode=env.HARNESS_DATA_MODE||'mixed_demo';
  if(!['demo','mixed_demo'].includes(dataMode))throw Error('HARNESS_DATA_MODE 必须为 demo 或 mixed_demo。');
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  for (const key of ['HARNESS_URL', 'VITE_HARNESS_URL']) {
    if (env[key] && env[key].replace(/\/$/, '') !== backendUrl) throw Error(`${key} 与 HARNESS_PORT 不一致，请统一配置`);
  }
  return { backendPort, frontendPort, backendUrl, dataMode, requireDemo: env.HARNESS_DEMO === '1', requireModel: env.HARNESS_OFFLINE !== '1' && env.HARNESS_RULES_ONLY !== '1', requireAutomatic:env.HARNESS_AUTOMATIC==='1', requireIdentity:env.HARNESS_REQUIRE_IDENTITY==='true', origins: [`http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`] };
}

export async function inspectBackend(config, fetchImpl = fetch) {
  let response;
  try { response = await fetchImpl(`${config.backendUrl}/health`, { signal: AbortSignal.timeout(1500) }); }
  catch (error) {
    if (error?.cause?.code === 'ECONNREFUSED') return { running: false };
    throw Error(`后端健康检查失败，请检查 ${config.backendUrl} 的占用或响应：${error.message}`);
  }
  const health = await response.json().catch(() => null);
  if (!response.ok || health?.status !== 'ok' || health.version !== INTEGRATION_VERSION || !INTEGRATION_CAPABILITIES.every(c => health.capabilities?.includes(c))) {
    throw Error(`端口 ${config.backendPort} 已有不兼容服务；需要联调后端 ${INTEGRATION_VERSION}。请停止旧服务或更换 BackendPort。`);
  }
  // A backend that requires a login is inspected as the background service
  // account; one that does not cannot satisfy an explicit --require-login.
  const session = await openServiceSession(config.backendUrl, {fetchImpl});
  try {
    if (config.requireIdentity && !session.required) {
      throw Error('--require-login 需要开启强制登录的后端；已有服务允许未登录访问，请停止旧服务或更换 --backend-port 后重试。');
    }
    return await inspectRunningBackend(config, fetchImpl, health, session.headers);
  } finally { await session.close(); }
}

async function inspectRunningBackend(config, fetchImpl, health, headers) {
  if (config.requireDemo) {
    const metaResponse = await fetchImpl(`${config.backendUrl}/api/meta`, {headers, signal:AbortSignal.timeout(2000)});
    const meta = metaResponse.ok ? await metaResponse.json() : null;
    const automaticResponse = await fetchImpl(`${config.backendUrl}/api/automatic`, {headers, signal:AbortSignal.timeout(2000)});
    const automatic = automaticResponse.ok ? await automaticResponse.json() : null;
    if (meta?.generator !== 'demo_rules' || meta.publicDataEnabled !== false || automatic?.config?.enabled !== false || automatic.dataMode !== config.dataMode) {
      throw Error('--demo 需要离线规则后端并关闭自动分析；已有服务不符合，请更换 --backend-port 或停止旧服务后重试。');
    }
  }
  if (config.requireModel) {
    const metaResponse = await fetchImpl(`${config.backendUrl}/api/meta`, {headers, signal:AbortSignal.timeout(2000)});
    const meta = metaResponse.ok ? await metaResponse.json() : null;
    if (!meta || !['llm', 'candidate_service'].includes(meta.generator)) throw Error('已有后端只支持演示规则；请停止旧服务，再以默认模型模式重新启动。仅演示规则可显式使用 --rules。');
    if (meta.generator === 'llm' && !meta.llm?.configured) throw Error('已有后端尚未配置可用模型；请配置模型后重启，或用 --rules 演示规则。');
    const controlResponse = await fetchImpl(`${config.backendUrl}/api/model/control`, {headers, signal:AbortSignal.timeout(2000)});
    const control = controlResponse.ok ? await controlResponse.json() : null;
    if (typeof control?.paused !== 'boolean') throw Error('已有后端模型调用状态不可读，请检查服务后重试。');
  }
  if(config.requireAutomatic){
    const automaticResponse=await fetchImpl(`${config.backendUrl}/api/automatic`,{headers,signal:AbortSignal.timeout(2000)});
    const automatic=automaticResponse.ok?await automaticResponse.json():null;
    if(automatic?.config?.enabled!==true)throw Error('已有后端未启用自动分析配置；请停止后以 --automatic 重新启动。');
    if(automatic.dataMode!==config.dataMode)throw Error('已有后端自动分析的数据模式不匹配，请统一 HARNESS_DATA_MODE 后重启。');
  }
  for (const origin of config.origins) {
    const preflight = await fetchImpl(`${config.backendUrl}/api/simulation/task-receipts`, {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }, signal: AbortSignal.timeout(1500),
    });
    if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== origin || !preflight.headers.get('access-control-allow-methods')?.includes('POST')) throw Error(`已有后端未允许前端地址 ${origin}，请重启后端并配置 --origins`);
  }
  const manifest = await fetchImpl(`${config.backendUrl}/api/demo/trees/manifest?scope=park`, {headers, signal:AbortSignal.timeout(2000)});
  if (!manifest.ok || (await manifest.json()).items?.length !== 200) throw Error('已有后端缺少 200 棵树联调清单');
  for (const path of ['/api/simulation/tasks', '/api/simulation/constraints', '/api/demo/analytics?site=hainan&days=7']) {
    const result = await fetchImpl(config.backendUrl + path, {headers, signal:AbortSignal.timeout(2000)});
    if (!result.ok) throw Error(`已有后端接口不可用：${path} (${result.status})`);
  }
  return { running: true, health };
}
