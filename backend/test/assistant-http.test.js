import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { RuleGenerator } from '../src/capabilities/rules.js';

async function fixture(t, options = {}) {
  const {accountId='manager-gd',...appOptions}=options;
  const app = createApp({
    dbPath: ':memory:', generator: new RuleGenerator(), seedTasks: true,
    clock: () => new Date('2026-10-20T02:00:00Z'), ...appOptions,
  });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let token;
  const call = async (path, input, status = 200) => {
    const headers=token?{'X-Rubber-Session':token}:{};
    const response = await fetch(base + path, input === undefined ? {headers} : {
      method: 'POST', headers: {...headers,'Content-Type': 'application/json'}, body: JSON.stringify(input),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  token=(await call('/api/auth/login',{accountId},201)).token;
  const turn = async (sessionId, input) => {
    const accepted = await call(`/api/assistant/sessions/${sessionId}/turns`, input, 202);
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = await call(`/api/assistant/sessions/${sessionId}/turns/${accepted.turnId}`);
      if (['completed', 'failed'].includes(result.status)) return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('offline assistant turn did not finish');
  };
  return {app, call, turn};
}

test('assistant HTTP: demo answers use saved park tasks and retain the conversation', async t => {
  const {call, turn} = await fixture(t, {pauseModelsOnStart: true});
  const session = await call('/api/assistant/sessions', {siteId: 'demo-guangdong-maoming', role: 'manager'}, 201);
  const result = await turn(session.sessionId, {message: '查看 B 区昨天的执行结果和今天剩余任务', zone: 'B', mode: 'demo'});
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.mode, 'demo');
  assert.ok(result.answer.length > 0);
  assert.ok(result.tools.some(tool => tool.name === 'read_tasks'));
  const saved = await call(`/api/assistant/sessions/${session.sessionId}`);
  assert.equal(saved.siteId, 'demo-guangdong-maoming');
  assert.equal(saved.turns[0].turnId, result.turnId);
  assert.equal((await call('/api/assistant/sessions?siteId=demo-guangdong-maoming&role=manager')).items.length, 1);
  await call('/api/assistant/sessions?siteId=demo-hainan&role=manager',undefined,403);
  assert.equal((await call('/api/assistant/sessions?siteId=demo-guangdong-maoming&role=grower')).items.length, 1,'query role cannot replace the signed-in account');
  const tasks = await call('/api/simulation/tasks?siteId=demo-guangdong-maoming');
  assert.equal(tasks.items.length, 4, 'asking for advice does not create extra tasks');
});

test('assistant HTTP: configured model receives tool results and prior conversation', async t => {
  const requests = [];
  const assistantModel = {
    describe: () => ({configured: true, model: 'fixture-model'}),
    async complete(input) {
      requests.push(structuredClone(input));
      if (requests.length === 1) return {content: '', toolCalls: [{id: 'tasks-1', name: 'read_tasks', arguments: {zone: 'B'}}]};
      return {content: '建议先查看 B 区未完成任务，再调整作业安排。', toolCalls: []};
    },
  };
  const {call, turn} = await fixture(t, {assistantModel});
  const session = await call('/api/assistant/sessions', {siteId: 'demo-guangdong-maoming', role: 'manager'}, 201);
  const first = await turn(session.sessionId, {message: '今天 B 区怎么安排？', zone: 'B', mode: 'configured'});
  assert.equal(first.status, 'completed', JSON.stringify(first));
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'tasks-1'));
  assert.ok(first.tools.some(tool => tool.name === 'read_tasks'));
  const second = await turn(session.sessionId, {message: '继续按这个方案说明原因', mode: 'configured'});
  assert.equal(second.status, 'completed', JSON.stringify(second));
  assert.ok(requests.at(-1).messages.some(message => message.role === 'user' && message.content.includes('今天 B 区怎么安排')));
  assert.ok(requests.at(-1).messages.some(message => message.role === 'assistant' && message.content?.includes('建议先查看 B 区')));
});

test('assistant HTTP: existing model pause also applies to conversation requests', async t => {
  let requests = 0;
  const assistantModel = {
    describe: () => ({configured: true, model: 'fixture-model'}),
    async complete() { requests++; return {content: '模型回答', toolCalls: []}; },
  };
  const {call, turn} = await fixture(t, {assistantModel, pauseModelsOnStart: true});
  const status = await call('/api/assistant/status');
  assert.equal(status.configured, true);
  assert.equal(status.paused, true);
  const session = await call('/api/assistant/sessions', {siteId: 'demo-guangdong-maoming', role: 'manager'}, 201);
  const stopped = await turn(session.sessionId, {message: '生成今天的安排', mode: 'configured'});
  assert.equal(stopped.status, 'failed');
  assert.match(stopped.error, /暂停/);
  assert.equal(requests, 0);
  const demo = await turn(session.sessionId, {message: '看看今天的任务', mode: 'demo'});
  assert.equal(demo.status, 'completed', JSON.stringify(demo));
  assert.equal(requests, 0);
});
