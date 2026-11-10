import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseAst, transformWithOxc} from 'vite';
import {createSpatialReadCache} from '../src/workspace/spatial/spatialReadCache.ts';

function fixture() {
  let token = 'manager', now = 1_000;
  const requests = [];
  const cache = createSpatialReadCache(path => new Promise((resolve, reject) => requests.push({path, token, resolve, reject})), () => token, () => now);
  return {cache, requests, setToken: value => {token = value;}, advance: value => {now += value;}};
}
const park = '/api/demo/park?siteId=demo-hainan';

test('map drill-down reuses a completed read for 30 seconds and deduplicates pending reads', async () => {
  const app = fixture(), first = app.cache.read('manager', park);
  assert.equal(app.cache.read('manager', park), first);
  app.requests[0].resolve({trees: ['HN-A-0001']});
  const data = await first;
  assert.equal(app.cache.cached('manager', park), data);
  assert.equal(await app.cache.read('manager', park), data);
  assert.equal(app.requests.length, 1);
  app.advance(30_000);
  assert.equal(app.cache.cached('manager', park), undefined);
  const next = app.cache.read('manager', park);
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve({trees: ['HN-A-0002']});
  assert.deepEqual(await next, {trees: ['HN-A-0002']});
});

test('park and identity changes cannot reuse another scope’s map data', async () => {
  const app = fixture(), first = app.cache.read('manager', park);
  app.requests[0].resolve({trees: ['manager-only']});
  await first;
  assert.equal(app.cache.cached('manager', '/api/demo/park?siteId=demo-xsbn'), undefined);
  app.setToken('grower');
  assert.equal(app.cache.cached('manager', park), undefined);
  assert.equal(app.cache.cached('grower', park), undefined);
  const grower = app.cache.read('grower', park);
  app.requests[1].resolve({trees: ['grower-only']});
  assert.deepEqual(await grower, {trees: ['grower-only']});
});

test('an import invalidates cached and pending map data before re-reading', async () => {
  const app = fixture(), old = app.cache.read('manager', park);
  app.cache.invalidate();
  const fresh = app.cache.read('manager', park);
  assert.notEqual(old, fresh);
  assert.equal(app.requests.length, 1, 'wait for the shared client’s old GET to settle');
  app.requests[0].resolve({trees: ['old-position']});
  await old;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.cache.cached('manager', park), undefined);
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve({trees: ['imported-position']});
  assert.deepEqual(await fresh, {trees: ['imported-position']});
  assert.deepEqual(app.cache.cached('manager', park), {trees: ['imported-position']});
  app.cache.invalidate();
  assert.equal(app.cache.cached('manager', park), undefined);
});

test('a late response from a previous login is discarded', async () => {
  const app = fixture(), pending = app.cache.read('manager', park);
  const rejected = assert.rejects(pending, /登录身份已变更/);
  app.setToken('grower');
  app.requests[0].resolve({trees: ['manager-only']});
  await rejected;
  assert.equal(app.cache.cached('grower', park), undefined);
  await assert.rejects(app.cache.read('manager', park), /登录身份已变更/);
});

test('failed requests are not cached and remain retryable', async () => {
  const app = fixture(), pending = app.cache.read('manager', park);
  const rejected = assert.rejects(pending, /offline/);
  app.requests[0].reject(Error('offline'));
  await rejected;
  const retry = app.cache.read('manager', park);
  app.requests[1].resolve({trees: []});
  assert.deepEqual(await retry, {trees: []});
});

const hookSource = await readFile(new URL('../src/workspace/spatial/useSpatialRead.ts', import.meta.url), 'utf8');
const transformed = await transformWithOxc(hookSource, 'useSpatialRead.ts', {lang: 'ts'});
const hookCode = parseAst(transformed.code).body.filter(node => node.type !== 'ImportDeclaration').map(node => transformed.code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
function hookFixture() {
  let token = 'manager', cursor = 0, dirty = false, output;
  const requests = [], states = [], effects = [], queue = [], window = new EventTarget();
  const bindings = {createSpatialReadCache, window, IDENTITY_STORAGE_KEY: 'identity', sessionToken: () => token,
    read: path => new Promise(resolve => requests.push({path, resolve})),
    useState(initial) {const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], next => {const value = typeof next === 'function' ? next(states[i]) : next; if (value !== states[i]) {states[i] = value; dirty = true;}}];},
    useEffect(callback, deps) {const i = cursor++, previous = effects[i]; if (!previous || deps.some((value, index) => value !== previous.deps[index])) {effects[i] = {deps, cleanup: previous?.cleanup}; queue.push(() => {effects[i].cleanup?.(); effects[i].cleanup = callback();});}},
  };
  const useRead = new Function(...Object.keys(bindings), `${hookCode}; return useSpatialRead;`)(...Object.values(bindings));
  return {requests, window, setToken: value => {token = value;},
    render(path = park) {let passes = 0; do {cursor = 0; dirty = false; output = useRead(path); queue.splice(0).forEach(callback => callback()); assert.ok(++passes < 10);} while (dirty); return output;},
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('map hook renders cached park immediately after returning and refreshes on field imports', async () => {
  const app = hookFixture();
  app.render();
  app.requests[0].resolve({trees: ['old-coordinate']});
  await settle();
  assert.deepEqual(app.render().data, {trees: ['old-coordinate']});
  app.render(null);
  assert.deepEqual(app.render().data, {trees: ['old-coordinate']});
  assert.equal(app.requests.length, 1, 'returning to the park does not fetch again');
  app.window.dispatchEvent(new Event('harness-field-data-changed'));
  app.render();
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve({trees: ['imported-coordinate']});
  await settle();
  assert.deepEqual(app.render().data, {trees: ['imported-coordinate']});
});

test('map hook hides cached data immediately when the signed-in identity changes', async () => {
  const app = hookFixture();
  app.render();
  app.requests[0].resolve({trees: ['manager-only']});
  await settle();
  assert.deepEqual(app.render().data, {trees: ['manager-only']});
  app.setToken('grower');
  assert.equal(app.render().data, undefined);
  app.requests[1].resolve({trees: ['grower-plot-only']});
  await settle();
  assert.deepEqual(app.render().data, {trees: ['grower-plot-only']});
});
