import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LlmGenerator } from './adapters/llm.js';
import { CandidateServiceGenerator } from './adapters/candidate-service.js';
import { RuleGenerator } from './capabilities/rules.js';
import { invariant, AppError } from './errors.js';

export function loadLocalEnv() {
  const path=fileURLToPath(new URL('../.env.local',import.meta.url));
  if(existsSync(path)) process.loadEnvFile(path);
}
export function configuredGenerator(env=process.env) {
  if(env.CANDIDATE_SERVICE_URL) return new CandidateServiceGenerator({url:env.CANDIDATE_SERVICE_URL,token:env.CANDIDATE_SERVICE_TOKEN,modelVersion:env.CANDIDATE_MODEL_VERSION});
  const config=JSON.parse(readFileSync(new URL('../config/llm.json',import.meta.url),'utf8'));
  const engine=env.HARNESS_GENERATOR??config.engine;
  if(engine==='rules') return new RuleGenerator();
  invariant(engine==='llm','INVALID_CONFIG','HARNESS_GENERATOR 只能为 llm 或 rules');
  const provider=env.LLM_PROVIDER??config.provider;
  // Local OpenAI-compatible servers do not incur provider charges. Ollama's
  // OpenAI endpoint is the safe default when no explicit provider is set.
  const defaults={
    ollama:['http://127.0.0.1:11434/v1',env.LLM_API_KEY??'local-no-key'],
    lmstudio:['http://127.0.0.1:1234/v1',env.LLM_API_KEY??'local-no-key'],
    vllm:['http://127.0.0.1:8000/v1',env.LLM_API_KEY??'local-no-key'],
    dashscope:['https://dashscope.aliyuncs.com/compatible-mode/v1',env.DASHSCOPE_API_KEY],
    deepseek:['https://api.deepseek.com',env.DEEPSEEK_API_KEY],
    openai:['https://api.openai.com/v1',env.OPENAI_API_KEY],
    compatible:[null,null],
  };
  invariant(defaults[provider],'INVALID_CONFIG','未知 LLM_PROVIDER');
  const apiKey=env.LLM_API_KEY??defaults[provider][1],model=env.LLM_MODEL??(provider===config.provider?config.model:null);
  if(!apiKey||!model) return { mode:'llm', modelVersion:null, describe:()=>({provider,model:model??null,configured:false}), async generate(){throw new AppError('LLM_NOT_CONFIGURED','请在本机 .env.local 配置对应服务的 API Key 和 LLM_MODEL；数据页面和离线规则演示仍可使用',503);} };
  return new LlmGenerator({provider,baseUrl:env.LLM_BASE_URL??defaults[provider][0],apiKey,model,protocol:env.LLM_PROTOCOL??'chat',outputMode:env.LLM_OUTPUT_MODE??(provider==='ollama'?'json_schema':'json_object'),timeoutMs:Number(env.LLM_TIMEOUT_MS??(['ollama','lmstudio','vllm'].includes(provider)?120000:60000)),maxOutputTokens:Number(env.LLM_MAX_OUTPUT_TOKENS??4096)});
}
