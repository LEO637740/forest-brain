import type { HarnessRequest, RunAccepted, RunResponse, HarnessResult, Strategy } from './harness-v1.ts';

/** Intended for the business backend/BFF. Do not ship service tokens into MH's production browser. */
export function createHarnessClient(options: { baseUrl: string; token?: string; fetch?: typeof fetch }) {
  const fetcher = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(15000);
    const response = await fetcher(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error?.message ?? `HTTP ${response.status}`), { code: value.error?.code, status: response.status, details: value.error?.details });
    return value as T;
  }
  return {
    submit(request: HarnessRequest, signal?: AbortSignal) { return call<RunAccepted>('/internal/harness/runs', request, signal); },
    getRun(runId: string, signal?: AbortSignal) { return call<RunResponse>(`/internal/harness/runs/${encodeURIComponent(runId)}`, undefined, signal); },
    getStrategy(strategyId: string, signal?: AbortSignal) { return call<Strategy>(`/internal/harness/strategies/${encodeURIComponent(strategyId)}`, undefined, signal); },
    retry(runId: string, signal?: AbortSignal) { return call<RunAccepted>(`/internal/harness/runs/${encodeURIComponent(runId)}/retry`, {}, signal); },
    async wait(runId: string, options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<HarnessResult> {
      const deadline = Date.now() + (options.timeoutMs ?? 60000);
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const result = await call<RunResponse>(`/internal/harness/runs/${encodeURIComponent(runId)}`, undefined, options.signal);
        if (result.status === 'succeeded' && result.strategy.qualityReview?.status === 'withdrawn') throw Object.assign(new Error('策略已撤回，请查询复核原因，不得采用'),{code:'STRATEGY_WITHDRAWN',runId,details:result.strategy.qualityReview.notes});
        if (result.status !== 'queued' && result.status !== 'running') return result;
        await new Promise<void>((resolve, reject) => {
          const signal = options.signal;
          const cleanup = () => signal?.removeEventListener('abort', abort);
          const timer = setTimeout(() => { cleanup(); resolve(); }, options.intervalMs ?? 500);
          const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason ?? new Error('Aborted')); };
          if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
        });
      }
      throw Object.assign(new Error('等待超时；运行仍可能在后台继续，请用同一 runId 查询'), { code: 'POLL_TIMEOUT', runId });
    },
  };
}
