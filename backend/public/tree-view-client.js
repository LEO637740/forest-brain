/**
 * Read-only browser client for the single-tree Blender/MH handoff.
 *
 * The client deliberately exposes GETs only. Preparing a demo strategy is a
 * separate operator action (`npm run demo:prepare`); a tree click never
 * creates a run or calls a model.
 */

const DEFAULT_TIMEOUT_MS = 12_000;

function trimBaseUrl(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

function makeUrl(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function abortError(message = '请求已取消') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

/** Error whose fields can be rendered without parsing a server-specific string. */
export class TreeViewError extends Error {
  constructor(message, { code = 'TREE_VIEW_REQUEST_FAILED', status = 0, details = [], path = '' } = {}) {
    super(message);
    this.name = 'TreeViewError';
    this.code = code;
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
    this.path = path;
  }
}

function normalizeTimeout(value) {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('timeoutMs must be a positive number');
  return Math.min(Math.floor(timeout), 120_000);
}

async function parseResponse(response, path) {
  const contentType = response.headers?.get?.('content-type') ?? '';
  let payload;
  try {
    payload = contentType.includes('json') ? await response.json() : JSON.parse(await response.text());
  } catch {
    throw new TreeViewError('服务返回了无法读取的响应', { code: 'INVALID_SERVER_RESPONSE', status: response.status, path });
  }
  if (!response.ok) {
    const serverError = payload?.error ?? payload;
    throw new TreeViewError(serverError?.message ?? `请求失败（HTTP ${response.status}）`, {
      code: serverError?.code ?? 'TREE_VIEW_REQUEST_FAILED',
      status: response.status,
      details: serverError?.details,
      path,
    });
  }
  return payload;
}

/**
 * @param {{baseUrl?: string, token?: string, fetchImpl?: typeof fetch}} options
 */
export function createTreeViewClient({ baseUrl = '', token = '', fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const root = trimBaseUrl(baseUrl);
  let memoryToken = String(token ?? '');

  const request = async (path, { signal, timeoutMs } = {}) => {
    const timeout = normalizeTimeout(timeoutMs);
    const controller = new AbortController();
    let timer;
    let callerAborted = false;
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort();
    };
    if (signal) {
      if (signal.aborted) throw abortError();
      signal.addEventListener('abort', abortFromCaller, { once: true });
    }
    timer = setTimeout(() => controller.abort(), timeout);
    const headers = { Accept: 'application/json' };
    if (memoryToken) headers.Authorization = `Bearer ${memoryToken}`;
    try {
      const response = await fetchImpl(makeUrl(root, path), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      return await parseResponse(response, path);
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        if (callerAborted) throw abortError();
        throw new TreeViewError(`请求超时（${timeout} ms）`, { code: 'TIMEOUT', path });
      }
      if (error instanceof TreeViewError) throw error;
      throw new TreeViewError('无法连接到橡胶大脑服务', { code: 'NETWORK_ERROR', path });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortFromCaller);
    }
  };

  return {
    /** Replace the in-memory bearer token. It is never persisted or logged. */
    setToken(nextToken = '') { memoryToken = String(nextToken ?? ''); },
    clearToken() { memoryToken = ''; },
    async readManifest(options = {}) {
      return request('/api/demo/trees/manifest', options);
    },
    async readTree({ treeId, kind = 'tapping_angle', dataMode = 'mixed_demo', signal, timeoutMs } = {}) {
      if (!/^T-\d{4}$/.test(String(treeId ?? ''))) {
        throw new TreeViewError('treeId 格式不正确', { code: 'INVALID_TREE_ID', path: '/api/demo/trees/{treeId}/view' });
      }
      const query = new URLSearchParams({ kind, dataMode });
      return request(`/api/demo/trees/${encodeURIComponent(treeId)}/view?${query}`, { signal, timeoutMs });
    },
  };
}

export const TREE_VIEW_DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
