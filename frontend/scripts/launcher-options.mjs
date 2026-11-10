export const START_USAGE = 'node start.mjs [--check] [--demo] [--require-login] [--backend-port 4188] [--frontend-port 4173] [--rules] [--offline] [--automatic|--no-automatic]';

export function parseStartOptions(args, inheritedEnv = process.env) {
  const env = {...inheritedEnv};
  let automatic = true, check = false, help = false, demo = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') { help = true; continue; }
    if (flag === '--check') { check = true; continue; }
    if (flag === '--demo') { demo = true; continue; }
    if (flag === '--require-login') { env.HARNESS_REQUIRE_IDENTITY = 'true'; continue; }
    if (flag === '--offline') { env.HARNESS_OFFLINE = '1'; continue; }
    if (flag === '--rules') { env.HARNESS_RULES_ONLY = '1'; continue; }
    if (flag === '--automatic') { automatic = true; continue; }
    if (flag === '--no-automatic') { automatic = false; continue; }
    const key = {'--backend-port':'HARNESS_PORT', '--frontend-port':'FRONTEND_PORT'}[flag];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('未知参数或缺少参数值：' + flag + '\n用法：' + START_USAGE);
    env[key] = args[++i];
  }
  if (demo) Object.assign(env, {HARNESS_DEMO:'1', HARNESS_OFFLINE:'1', HARNESS_RULES_ONLY:'1', HARNESS_DATA_MODE:'demo'});
  if (env.HARNESS_OFFLINE === '1' || env.HARNESS_RULES_ONLY === '1') automatic = false;
  if (automatic) env.HARNESS_AUTOMATIC = '1'; else delete env.HARNESS_AUTOMATIC;
  return {env, check, help};
}
