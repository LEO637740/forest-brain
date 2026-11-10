import { configuredGenerator, loadLocalEnv } from './generator-config.js';
import { RuleGenerator } from './capabilities/rules.js';

export function mhGenerator({ rules = false, env = process.env, loadEnv = loadLocalEnv } = {}) {
  if (rules) return new RuleGenerator();
  loadEnv();
  return configuredGenerator(env);
}
