type Entry = {data: unknown; expiresAt: number};
type Pending = {generation: number; promise: Promise<unknown>};

/** Short-lived map metadata, isolated by login and park URL. Never used for strategy adoption. */
export function createSpatialReadCache(load: (path: string) => Promise<unknown>, currentToken: () => string | null, now = Date.now) {
  const values = new Map<string, Entry>(), pending = new Map<string, Pending>();
  let generation = 0;
  const keyOf = (token: string | null, path: string) => JSON.stringify([token, path]);
  function cached<T>(token: string | null, path: string): T | undefined {
    if (token !== currentToken()) return undefined;
    const entry = values.get(keyOf(token, path));
    return entry && entry.expiresAt > now() ? entry.data as T : undefined;
  }
  function read<T>(token: string | null, path: string): Promise<T> {
    if (token !== currentToken()) return Promise.reject(Error('登录身份已变更，请重新读取。'));
    const value = cached<T>(token, path);
    if (value !== undefined) return Promise.resolve(value);
    const key = keyOf(token, path), previous = pending.get(key), requestedGeneration = generation;
    if (previous?.generation === generation) return previous.promise as Promise<T>;
    // An import may finish while an older GET is pending; wait for it before asking the shared client again.
    const request = (previous ? previous.promise.catch(() => undefined).then(() => {
      if (token !== currentToken()) throw Error('登录身份已变更，请重新读取。');
      return load(path);
    }) : load(path)).then(data => {
      if (token !== currentToken()) throw Error('登录身份已变更，请重新读取。');
      if (generation === requestedGeneration) values.set(key, {data, expiresAt: now() + 30_000});
      return data as T;
    }).finally(() => {if (pending.get(key)?.promise === request) pending.delete(key);});
    pending.set(key, {generation: requestedGeneration, promise: request});
    return request;
  }
  return {cached, read, invalidate: () => {generation++; values.clear();}};
}
