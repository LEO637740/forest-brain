// Background callers (launcher checks, strategy preparation) sign in only when
// the backend requires a login. They use the least-privileged demo account that
// may prepare Hainan strategies: the Haikou robot operator, who cannot sell,
// approve parameters or see other parks.
export const SERVICE_ACCOUNT = 'operator-hn';

/** `headers` carries an optional service token (Authorization) on every call, including sign-in. */
export async function openServiceSession(baseUrl, {fetchImpl = fetch, accountId = process.env.HARNESS_SERVICE_ACCOUNT || SERVICE_ACCOUNT, headers:extra = {}} = {}) {
  const accounts = await fetchImpl(`${baseUrl}/api/auth/accounts`, {headers:extra, signal:AbortSignal.timeout(2000)});
  const required = accounts.ok && (await accounts.json().catch(() => null))?.requireIdentity === true;
  if (!required) return {required:false, headers:{}, close:async () => {}};
  const login = await fetchImpl(`${baseUrl}/api/auth/login`, {method:'POST', headers:{...extra, 'Content-Type':'application/json'},
    body:JSON.stringify({accountId}), signal:AbortSignal.timeout(2000)});
  const data = await login.json().catch(() => null);
  if (!login.ok || !data?.token) throw Error(`后端要求登录，后台服务身份 ${accountId} 登录失败：${data?.error?.message ?? login.status}`);
  const headers = {'X-Rubber-Session':data.token};
  return {required:true, accountId, headers, close:async () => {
    await fetchImpl(`${baseUrl}/api/auth/logout`, {method:'POST', headers:{...extra, ...headers, 'Content-Type':'application/json'}, body:'{}',
      signal:AbortSignal.timeout(2000)}).catch(() => {});
  }};
}
