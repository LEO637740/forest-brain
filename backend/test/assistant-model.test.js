import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantModel } from '../src/adapters/assistant-model.js';
import { LlmGenerator } from '../src/adapters/llm.js';
import { RuleGenerator } from '../src/capabilities/rules.js';

const tools = [{
  type: 'function',
  function: {
    name: 'read_tasks', description: '查询当前园区任务',
    parameters: { type: 'object', properties: { zoneId: { type: 'string' } }, required: ['zoneId'], additionalProperties: false },
  },
}];
const createModel = (fetchImpl, config = {}) => new AssistantModel({
  generator: new LlmGenerator({
    baseUrl: 'https://model.example/v1', apiKey: 'fixture-only-secret', model: 'fixture-model',
    provider: 'deepseek', fetchImpl, ...config,
  }),
});
const messages = [{ role: 'system', content: '根据园区数据安排作业。' }, { role: 'user', content: 'B 区昨天剩下哪些任务？' }];
const chatResponse = (message, finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message }] });

test('assistant model reuses LLM configuration and describes unavailable generators honestly', async () => {
  for (const generator of [
    new RuleGenerator(),
    { mode: 'llm', describe: () => ({ configured: false, provider: 'deepseek', model: 'deepseek-chat' }) },
    undefined,
  ]) {
    const model = new AssistantModel({ generator });
    assert.equal(model.isConfigured(), false);
    assert.equal(model.describe().configured, false);
    assert.match(model.describe().reason, /未配置/);
    await assert.rejects(model.complete({ messages, tools }), error => error.code === 'LLM_NOT_CONFIGURED');
  }
  const description = createModel(() => { throw new Error('should not request'); }).describe();
  assert.deepEqual(description, { configured: true, provider: 'deepseek', model: 'fixture-model', protocol: 'chat' });
  assert.equal(JSON.stringify(description).includes('fixture-only-secret'), false);
});

test('assistant chat completes a tool round followed by a final answer using the same conversation', async () => {
  const sent = [];
  const call = { id: 'call-tasks', type: 'function', function: { name: 'read_tasks', arguments: '{"zoneId":"B"}' } };
  const model = createModel(async (url, options) => {
    assert.equal(url, 'https://model.example/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fixture-only-secret');
    sent.push(JSON.parse(options.body));
    return sent.length === 1
      ? chatResponse({ content: '先查看 B 区的执行结果。', tool_calls: [call] }, 'tool_calls')
      : chatResponse({ content: 'B 区剩余 8 棵，建议今天优先补做。' });
  });
  const first = await model.complete({ messages, tools });
  assert.deepEqual(first, { content: '先查看 B 区的执行结果。', toolCalls: [{ id: 'call-tasks', name: 'read_tasks', arguments: { zoneId: 'B' } }] });
  const continued = [
    ...messages, { role: 'assistant', content: first.content, tool_calls: [call] },
    { role: 'tool', tool_call_id: 'call-tasks', content: '{"remainingTrees":8}' },
  ];
  const final = await model.complete({ messages: continued, tools });
  assert.deepEqual(final, { content: 'B 区剩余 8 棵，建议今天优先补做。', toolCalls: [] });
  assert.deepEqual(sent[0].tools, tools);
  assert.equal(sent[0].tool_choice, 'auto');
  assert.deepEqual(sent[1].messages, continued);
  assert.equal(sent[0].response_format, undefined, 'conversation output must not inherit strategy JSON output mode');
});

test('assistant Responses converts tool definitions, calls and outputs while preserving conversation order', async () => {
  const sent = [];
  const model = createModel(async (url, options) => {
    assert.equal(url, 'https://model.example/v1/responses');
    sent.push(JSON.parse(options.body));
    return sent.length === 1
      ? Response.json({ status: 'completed', output: [{ type: 'function_call', id: 'fc-tasks', call_id: 'call-tasks', name: 'read_tasks', arguments: '{"zoneId":"B"}', status: 'completed' }] })
      : Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'B 区剩余 8 棵。' }, { type: 'output_text', text: '今天优先补做。' }] }] });
  }, { protocol: 'responses' });
  const first = await model.complete({ messages, tools });
  assert.deepEqual(first, { content: '', toolCalls: [{ id: 'call-tasks', name: 'read_tasks', arguments: { zoneId: 'B' } }] });
  const final = await model.complete({
    messages: [
      ...messages,
      { role: 'assistant', content: '', tool_calls: [{ id: first.toolCalls[0].id, type: 'function', function: { name: 'read_tasks', arguments: '{"zoneId":"B"}' } }] },
      { role: 'tool', tool_call_id: 'call-tasks', content: '{"remainingTrees":8}' },
      { role: 'assistant', content: 'B 区剩余 8 棵。' },
      { role: 'user', content: '那今天先补做。' },
    ], tools,
  });
  assert.equal(sent[0].store, false);
  assert.deepEqual(sent[0].tools, [{ type: 'function', strict: false, ...tools[0].function }]);
  assert.deepEqual(sent[1].input, [
    ...messages,
    { type: 'function_call', call_id: 'call-tasks', name: 'read_tasks', arguments: '{"zoneId":"B"}' },
    { type: 'function_call_output', call_id: 'call-tasks', output: '{"remainingTrees":8}' },
    { role: 'assistant', content: 'B 区剩余 8 棵。' },
    { role: 'user', content: '那今天先补做。' },
  ]);
  assert.deepEqual(final, { content: 'B 区剩余 8 棵。今天优先补做。', toolCalls: [] });
});

test('assistant does not treat truncated, refused, empty or malformed tool responses as successful answers', async () => {
  const cases = [
    [() => chatResponse({ content: '未完成的计划' }, 'length'), 'LLM_INCOMPLETE'],
    [() => chatResponse({ refusal: 'refused' }), 'LLM_REFUSED'],
    [() => chatResponse({ content: '' }), 'LLM_EMPTY_RESPONSE'],
    [() => chatResponse({ content: '' }, 'tool_calls'), 'LLM_INVALID_RESPONSE'],
    [() => chatResponse({ tool_calls: [{ id: 'call-1', function: { name: 'read_tasks', arguments: '{broken' } }] }, 'tool_calls'), 'LLM_INVALID_TOOL_CALL'],
    [() => chatResponse({ tool_calls: [{ id: 'call-1', function: { name: 'read_tasks', arguments: 'null' } }] }, 'tool_calls'), 'LLM_INVALID_TOOL_CALL'],
  ];
  for (const [response, code] of cases) {
    await assert.rejects(createModel(async () => response()).complete({ messages, tools }), error => error.code === code);
  }
  for (const raw of [
    { status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: '部分计划' }] }] },
    { status: 'completed', output: [{ type: 'function_call', status: 'in_progress', call_id: 'call-1', name: 'read_tasks', arguments: '{}' }] },
  ]) {
    await assert.rejects(createModel(async () => Response.json(raw), { protocol: 'responses' }).complete({ messages, tools }), error => error.code === 'LLM_INCOMPLETE');
  }
});

test('assistant reports service and timeout errors without provider payloads or local fallbacks', async () => {
  const cases = [
    [async () => new Response('fixture-only-secret upstream details', { status: 429 }), 'LLM_REQUEST_REJECTED', 502],
    [async () => new Response('{invalid'), 'LLM_INVALID_RESPONSE', 502],
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, 'LLM_TIMEOUT', 504],
    [async () => { throw new TypeError('network failed'); }, 'LLM_SERVICE_UNAVAILABLE', 503],
  ];
  for (const [fetchImpl, code, status] of cases) {
    let calls = 0;
    const model = createModel((...args) => { calls++; return fetchImpl(...args); });
    await assert.rejects(model.complete({ messages, tools }), error => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.message.includes('fixture-only-secret'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});
