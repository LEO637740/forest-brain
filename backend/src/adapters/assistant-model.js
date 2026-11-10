import { AppError, invariant } from '../errors.js';

function toolCall(id, name, serializedArguments) {
  let args;
  try { args = JSON.parse(serializedArguments); }
  catch { throw new AppError('LLM_INVALID_TOOL_CALL', `模型工具 ${name ?? ''} 的参数不是有效 JSON`, 502); }
  invariant(typeof id === 'string' && id && typeof name === 'string' && name
    && args !== null && typeof args === 'object' && !Array.isArray(args),
  'LLM_INVALID_TOOL_CALL', '模型工具调用需要调用标识、工具名和 JSON 对象参数', 502);
  return { id, name, arguments: args };
}

function responseInput(messages) {
  return messages.flatMap(message => {
    if (message.role === 'tool') {
      return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    }
    if (message.role !== 'assistant') return [{ role: message.role, content: message.content }];
    return [
      ...(message.content ? [{ role: 'assistant', content: message.content }] : []),
      ...(message.tool_calls ?? []).map(call => ({
        type: 'function_call', call_id: call.id,
        name: call.function.name, arguments: call.function.arguments,
      })),
    ];
  });
}

function chatResult(raw) {
  const choice = raw.choices?.[0];
  invariant(!choice?.message?.refusal, 'LLM_REFUSED', '模型拒绝回答此次请求', 422);
  invariant(['stop', 'tool_calls'].includes(choice?.finish_reason),
    'LLM_INCOMPLETE', '模型响应未正常结束，请重试本次对话', 502);
  const calls = choice.message?.tool_calls ?? [];
  invariant((choice.finish_reason === 'tool_calls') === (calls.length > 0),
    'LLM_INVALID_RESPONSE', '模型结束状态与工具调用不一致', 502);
  return {
    content: choice.message?.content ?? '',
    toolCalls: calls.map(call => toolCall(call.id, call.function?.name, call.function?.arguments)),
    ...usageOf(raw.usage, 'prompt_tokens', 'completion_tokens'),
  };
}

// Token counts for the run ledger; DeepSeek also reports prompt-cache hits.
function usageOf(usage, input, output) {
  if (!usage) return {};
  return {usage:{promptTokens:usage[input] ?? 0, completionTokens:usage[output] ?? 0,
    cacheHitTokens:usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0}};
}

function responsesResult(raw) {
  invariant(raw.status === 'completed', 'LLM_INCOMPLETE', '模型响应未完成，请重试本次对话', 502);
  const output = raw.output ?? [];
  const parts = output.filter(item => item.type === 'message').flatMap(item => item.content ?? []);
  invariant(!parts.some(part => part.type === 'refusal'), 'LLM_REFUSED', '模型拒绝回答此次请求', 422);
  const calls = output.filter(item => item.type === 'function_call');
  invariant(calls.every(call => !call.status || call.status === 'completed'),
    'LLM_INCOMPLETE', '模型工具调用尚未完成', 502);
  return {
    content: parts.filter(part => part.type === 'output_text').map(part => part.text).join(''),
    toolCalls: calls.map(call => toolCall(call.call_id, call.name, call.arguments)),
    ...usageOf(raw.usage, 'input_tokens', 'output_tokens'),
  };
}

export class AssistantModel {
  constructor({ generator }) { this.generator = generator; }

  isConfigured() {
    const g = this.generator;
    return Boolean(g?.mode === 'llm' && g.apiKey?.trim() && g.model && g.baseUrl && typeof g.fetchImpl === 'function');
  }

  describe() {
    const description = this.generator?.describe?.() ?? {};
    return {
      configured: this.isConfigured(),
      model: this.generator?.model ?? description.model ?? null,
      provider: this.generator?.provider ?? description.provider ?? null,
      protocol: this.generator?.protocol ?? null,
      ...(!this.isConfigured() ? { reason: '当前未配置可调用工具的对话模型，请使用已有 LLM 配置；规则演示仍可使用。' } : {}),
    };
  }

  async complete({ messages, tools = [] }) {
    invariant(this.isConfigured(), 'LLM_NOT_CONFIGURED', this.describe().reason, 503);
    const g = this.generator;
    const usesResponses = g.protocol === 'responses';
    const payload = usesResponses
      ? {
          model: g.model, store: false, input: responseInput(messages), max_output_tokens: g.maxOutputTokens,
          ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', strict: false, ...tool.function })), tool_choice: 'auto' } : {}),
        }
      : {
          model: g.model, messages, max_tokens: g.maxOutputTokens,
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          ...(g.provider === 'dashscope' ? { enable_thinking: false } : {}),
        };
    let raw;
    try {
      const response = await g.fetchImpl(`${g.baseUrl}/${usesResponses ? 'responses' : 'chat/completions'}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(g.timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${g.apiKey}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new AppError('LLM_REQUEST_REJECTED', `对话模型返回 HTTP ${response.status}，请检查模型配置或服务额度`, 502);
      raw = await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (['TimeoutError', 'AbortError'].includes(error.name)) throw new AppError('LLM_TIMEOUT', '对话模型响应超时，请重试', 504);
      if (error instanceof SyntaxError) throw new AppError('LLM_INVALID_RESPONSE', '对话模型返回了无法解析的响应', 502);
      throw new AppError('LLM_SERVICE_UNAVAILABLE', '暂时无法连接对话模型，请稍后重试', 503);
    }
    const result = usesResponses ? responsesResult(raw) : chatResult(raw);
    invariant(typeof result.content === 'string' && (result.content.trim() || result.toolCalls.length),
      'LLM_EMPTY_RESPONSE', '模型没有返回回答或工具调用，请重试', 502);
    return result;
  }
}
