import {AssistantActions} from './assistant-actions.js';
import {analyticsSeries} from './analytics.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { HarnessRuntime } from './runtime.js';
import { LocalContextProvider, HttpContextProvider } from './adapters/context.js';
import { makeTree, SOURCE_CATALOG } from './adapters/demo-sources.js';
import { CATALOG, schemaBundle, contextSchema } from './contracts.js';
import { s, id, validate } from './schema.js';
import { projectContext } from './validation.js';
import { AppError, invariant } from './errors.js';
import { parkOverview, SCENARIOS, scenarioContext, makeParkContext as baseParkContext, profileOf, TREE_IDS, PARK_SITES, normalizeSiteId, parkSite } from './adapters/park-demo.js';
import { randomUUID } from 'node:crypto';
import { PublicDataService } from './adapters/public-data.js';
import { ParkWeatherWindows } from './park-weather.js';
import { makePublicContext, makeIndustryContext, makeMixedContext } from './adapters/public-context.js';
import { makeBusinessDemo } from './adapters/business-demo.js';
import { sourceCoverage } from './source-coverage.js';
import { configuredGenerator, loadLocalEnv } from './generator-config.js';
import { AutomaticRunner } from './automatic.js';
import { StrategyRefresh } from './strategy-refresh.js';
import { digest } from './util.js';
import { ReviewWorkflow } from './review-workflow.js';
import { RobotObservation } from './robot-observation.js';
import { SimulationService } from './simulation.js';
import { integrationContext } from './tree-context.js';
import { INTEGRATION_VERSION, INTEGRATION_CAPABILITIES } from './integration-version.js';
import { classifyStrategyRoute } from './strategy-routing.js';
import { RuleGenerator } from './capabilities/rules.js';
import { FieldTreeRecords } from './field-trees.js';
import { seedDemoSpatialRecords } from './adapters/demo-spatial.js';
import { seedDemoTasks } from './adapters/demo-tasks.js';
import { BusinessAssistantService } from './assistant-service.js';
import { rubberMarketContext, networkInventory } from './commodity-reference.js';
import { AssistantModel } from './adapters/assistant-model.js';
import { IdentityService } from './identity.js';
import { checkRead, writePermission, writeSites, parkScoped, OPEN_PATHS } from './access.js';
import { ParkPlanService } from './park-plan.js';
import { prepareParkPlanSurface } from './park-plan-preparation.js';
import { treePreparationSkipReason } from './tree-preparation-policy.js';
import { prepareStrategySnapshots } from './strategy-snapshot-preparation.js';
import { CerebellumTuning } from './cerebellum.js';
import { workspaceBrief, plotSummary } from './workspace-brief.js';
import { EudrReadinessService } from './eudr-readiness.js';
import { ECONOMIC_SCENARIOS } from './economic-scenario.js';
import { PriceFactorService } from './price-factors.js';
import { BrainEvolution, WeatherExperience } from './brain-evolution.js';
import { RoutingEvolution } from './routing-evolution.js';
import { MarketEventService, MARKET_EVENT_KINDS } from './market-events.js';
import { SkillLibrary } from './assistant-skills.js';
import { harnessLedger } from './harness-ledger.js';
import {scopeTaskForIdentity,scopeOperationalEvent} from './assistant-access.js';
import {RubberMarketQuoteService} from './adapters/rubber-market-quotes.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/blender-preview', ['blender-preview.html', 'text/html; charset=utf-8']], ['/blender-preview.html', ['blender-preview.html', 'text/html; charset=utf-8']], ['/blender-preview.js', ['blender-preview.js', 'text/javascript; charset=utf-8']], ['/blender-preview.css', ['blender-preview.css', 'text/css; charset=utf-8']], ['/tree-view-client.js', ['tree-view-client.js', 'text/javascript; charset=utf-8']]]);
const localHosts = ['127.0.0.1', 'localhost', '[::1]'];
function equalsSecret(a, b) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
async function readBody(req, maxBytes=65536) {
  invariant(req.headers['content-type']?.split(';')[0] === 'application/json', 'CONTENT_TYPE_REQUIRED', '请求体需要 application/json', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; invariant(size <= maxBytes, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${maxBytes} 字节`, 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_JSON', '请求体不是合法 JSON', 400); }
}
function numberQuery(url, key, fallback, max) {
  const value = url.searchParams.get(key);
  if (value === null) return fallback;
  invariant(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max, 'INVALID_QUERY', `${key} 超出允许范围`);
  return Number(value);
}
function baseRequestedSite(url, fallback = 'demo-hainan') {
  const raw = url.searchParams.get('siteId') ?? url.searchParams.get('site') ?? fallback;
  try { return normalizeSiteId(raw); }
  catch { throw new AppError('INVALID_QUERY', '园区标识无效，请选择目录中的园区', 400); }
}
export function createApp({ dbPath = resolve(ROOT, 'var/brain.sqlite'), weatherExperience = null, token, contextProvider, generator, assistantModel, contextBaseUrl, contextToken, publicDataService = null, marketQuoteService = null, automaticConfig=null, automaticOutputDir=null, strategyRefreshConfig=null, allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'], clock = () => new Date(), allowRemoteHost = false, pauseModelsOnStart=false, pauseAutomaticOnStart=false, resumeModelsOnStart=false, resumeAutomaticOnStart=false, automaticDataMode='mixed_demo', seedTasks=false, requireIdentity=false } = {}) {
  const store = new Store(dbPath);
  const marketQuotes = marketQuoteService ?? new RubberMarketQuoteService({clock, enabled:Boolean(publicDataService),
    dailySource:()=>publicDataService?.status().sources.find(source=>source.id==='market')});
  // MH startup applies this before recovery can dispatch a queued model call.
  if(pauseModelsOnStart)store.setModelPaused(true,clock().toISOString());
  else if(resumeModelsOnStart)store.setModelPaused(false,clock().toISOString());
  const provider = contextProvider ?? (contextBaseUrl ? new HttpContextProvider({ baseUrl: contextBaseUrl, token: contextToken }) : new LocalContextProvider(store));
  const runtime = new HarnessRuntime({ store, contextProvider: provider, generator, clock });
  const fieldTrees=new FieldTreeRecords(store,clock);
  if(provider.mode==='demo')seedDemoSpatialRecords(fieldTrees,clock());
  const reviews=new ReviewWorkflow(store,clock,runtime,publicDataService,fieldTrees);
  const observations=new RobotObservation(reviews);
  const makeParkContext=(options)=>reviews.apply(baseParkContext(options));
  const simulation = new SimulationService(store, clock, {contextFactory:makeParkContext});
  const parkWeather = new ParkWeatherWindows({service:publicDataService, clock});
  if(provider.mode==='demo'&&seedTasks)seedDemoTasks(simulation,clock());
  const conversationModel = assistantModel ?? new AssistantModel({generator:runtime.generator});
  const identities = new IdentityService(store, clock);
  const parkPlans = new ParkPlanService({store, simulation, makeParkContext, clock, publicDataService,
    model:conversationModel,modelInfo:conversationModel.describe?.()??runtime.generator.describe?.(),
    dispatchDataMode:automaticDataMode, weather:publicDataService?parkWeather:null});
  // Background, assistant and explicit page requests share one model computation per park.
  const computeParkPlan=parkPlans.compute.bind(parkPlans),activeParkPlans=new Map();
  parkPlans.compute=async(siteId,options={})=>{
    siteId=normalizeSiteId(siteId);const scenario=options.economicScenarioId??'baseline';
    options.authorize?.();
    const active=activeParkPlans.get(siteId);
    if(active){
      if(active.scenario===scenario){const plan=await active.promise;options.authorize?.();return plan;}
      try{await active.promise;}catch{/* A different scenario may still succeed. */}
      return parkPlans.compute(siteId,options);
    }
    const promise=computeParkPlan(siteId,options);activeParkPlans.set(siteId,{scenario,promise});
    try{return await promise;}finally{if(activeParkPlans.get(siteId)?.promise===promise)activeParkPlans.delete(siteId);}
  };
  reviews.simulation=simulation;
  const eudr = new EudrReadinessService({store, simulation, clock});
  const marketEvents = new MarketEventService({store, clock});
  const skills = new SkillLibrary({store, clock});
  const priceFactors = new PriceFactorService({simulation, makeParkContext, publicDataService, marketEvents, clock});
  let assistant;
  const cerebellum = new CerebellumTuning({store, simulation, clock, onApproved:({proposal,set})=>assistant?.memory.rememberCerebellum(proposal,set)});
  // Without the public data service (offline demo, tests) the experience store never reaches the network.
  const routingEvolution = new RoutingEvolution({store, clock});
  const evolution = new BrainEvolution({cerebellum, makeParkContext, clock, routingEvolution,
    experience:weatherExperience ?? new WeatherExperience({store, clock, offline:!publicDataService})});
  const refreshIntervalMs=(strategyRefreshConfig?.intervalMinutes??60)*60000;
  const strategyRefresh=new StrategyRefresh({store,clock,config:strategyRefreshConfig??{},
    prepareSiteSnapshots:({siteId,reason,cycleId,modelsEnabled,authorize})=>prepareStrategySnapshots({siteId,reason,cycleId,modelsEnabled,authorize,store,runtime,dataMode:automaticDataMode,clock,
      modelLimits:{maxRunsPer24Hours:automaticConfig?.maxRunsPer24Hours??783,maxRequestsPerRun:automaticConfig?.maxRequestsPerRun??2,
        maxModelRequestsPer24Hours:strategyRefreshConfig?.maxTreeModelRequestsPer24Hours??1566},
      makeContext:options=>integrationContext({...options,service:publicDataService,reviews})}),
    productionFresh:async(siteId,now)=>{
      // A restarted weather service has no in-memory record yet. Load it before
      // judging the persisted plan, otherwise every restart looks like stale weather.
      if(publicDataService)await parkWeather.read(siteId);
      const plan=parkPlans.latest(siteId,{baselineOnly:true});return Boolean(plan?.modelProposal?.mode==='llm'
        && +now-Date.parse(plan.generatedAt)<refreshIntervalMs&&!plan.weatherCheck?.needsRecompute&&!plan.economicCheck?.needsRecompute);
    },
    refreshProduction:async(siteId,authorize)=>{
      if(publicDataService){
        const weather=await parkWeather.read(siteId);
        invariant(weather.status==='available'&&!weather.stale,'STRATEGY_WEATHER_UNAVAILABLE',
          `后台天气资料不可用，已保留原全园方案，本轮未调用模型。${weather.error?.message??'等待天气更新后重试。'}`,503,
          {siteId,status:weather.status,sourceError:weather.error?.code??null});
      }
      authorize();return parkPlans.compute(siteId,{economicScenarioId:'baseline',authorize});
    },
    marketFresh:(siteId,now)=>{const model=simulation.latestMarket(siteId).model,inventory=simulation.salesInventory(siteId);return Boolean(model
      && (model.economicScenarioId??'baseline')==='baseline'&&+now-Date.parse(model.generatedAt)<refreshIntervalMs
      && model.params.stockKg===inventory.stockKg&&model.params.heldKg===inventory.heldKg);},
    refreshMarket:siteId=>{
      const previous=simulation.latestMarket(siteId).model?.params??{},inventory=simulation.salesInventory(siteId);
      // Reuse business assumptions, but never carry a conversation's hypothetical stock into the actual inventory refresh.
      const keys=['storageKg','transportKgPerDay','treeCount','dryKgPerTapping','costPerTapping','demandIndex','demandBaseline'];
      const params=Object.fromEntries(keys.filter(key=>Number.isFinite(previous[key])).map(key=>[key,previous[key]]));
      return simulation.market({...params,siteId,economicScenarioId:'baseline',stockKg:inventory.stockKg,heldKg:inventory.heldKg});
    }});
  const assistantActions=new AssistantActions({store,simulation,reviews,observations,parkPlans,clock,
    recompute:async(siteId,authorize)=>{
      await prepareParkPlanSurface({siteId,dataMode:automaticDataMode,store,runtime,makeParkContext,clock});
      if(publicDataService)await parkWeather.read(siteId);
      return parkPlans.compute(siteId,{authorize});
    }});
  assistant = new BusinessAssistantService({actions:assistantActions,store,simulation,makeParkContext,clock,publicDataService,parkPlans,cerebellum,eudr,priceFactors,evolution,marketEvents,skills,resolveIdentity:token=>identities.resolve(token),model:{
    complete(input) {
      invariant(!store.getModelControl().paused,'MODEL_PAUSED','模型调用已暂停，可使用离线演示或在模型设置中恢复',409);
      return conversationModel.complete(input);
    },
  }});
  const automatic=automaticConfig?new AutomaticRunner({store,runtime,service:publicDataService,config:automaticConfig,clock,outputDirectory:automaticOutputDir,
    dataMode:automaticDataMode,treeContext:options=>integrationContext({...options,reviews})}):null;
  if (publicDataService && automatic) {
    const previousSourceChange = publicDataService.onChange;
    publicDataService.onChange = change => {
      previousSourceChange?.(change);
      automatic.notifyDataChange(change);
    };
  }
  if(pauseAutomaticOnStart)automatic?.setPaused(true);
  else if(resumeAutomaticOnStart)automatic?.resumeOnStart();
  const send = (res, status, data, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    try {
      const host = new URL(`http://${req.headers.host ?? ''}`).hostname;
      invariant(allowRemoteHost || localHosts.includes(host), 'HOST_NOT_ALLOWED', '此开发服务仅允许本机 Host', 403);
      const origin = req.headers.origin;
      const ownOrigin = `http://${req.headers.host}`;
      if (origin && origin !== ownOrigin) {
        invariant(allowedOrigins.includes(origin), 'ORIGIN_NOT_ALLOWED', '此 Origin 未列入允许列表', 403);
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Rubber-Session', 'Access-Control-Max-Age': '600' }); res.end(); return;
      }
      const url = new URL(req.url, 'http://localhost'), path = decodeURIComponent(url.pathname);
      // One parsed body per request so access checks and the route read the same input.
      let parsedBody = null;
      const body = (request, maxBytes) => parsedBody ??= readBody(request, maxBytes);
      const identity = identities.resolve(req.headers['x-rubber-session']);
      const open = OPEN_PATHS.some(pattern => pattern.test(path)) || req.method === 'GET' && assets.has(path);
      invariant(identity || !requireIdentity || open, 'LOGIN_REQUIRED', '请先选择登录身份。', 401);
      // Conversation data and mutations never use the anonymous legacy demo path.
      if((path.startsWith('/api/assistant/')&&path!=='/api/assistant/status')||path==='/api/brain/harness') {
        invariant(identity,'LOGIN_REQUIRED','请先选择登录身份。',401);
        identity.require('assistant.use');
      }
      const requestedSite = (url, fallback) => { const siteId = baseRequestedSite(url, fallback); identity?.requireSite(siteId); return siteId; };
      const optionalSite = () => url.searchParams.has('siteId') || url.searchParams.has('site') ? requestedSite(url) : null;
      if (identity) {
        checkRead(identity, path);
        const permission = req.method === 'POST' ? writePermission(path) : null;
        if (permission) {
          identity.require(permission);
          const input = await body(req, 2*1024*1024);
          const runMatch = path.match(/^\/internal\/harness\/runs\/([A-Za-z0-9_.:-]+)\//);
          const sites = runMatch ? [store.getRun(runMatch[1])?.request.siteId ?? 'demo-hainan'] : writeSites(path, input);
          for (const siteId of sites.filter(parkScoped)) identity.requireSite(siteId);
        }
      }
      const visibleTask = task => !identity || identity.seesTask(task);
      const visibleSite = item => !identity || identity.seesSite(item.siteId ?? 'demo-hainan');
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(readFileSync(resolve(ROOT, 'public', file))); return;
      }
      if (path === '/health' && req.method === 'GET') return send(res, 200, { status: 'ok', version: INTEGRATION_VERSION, capabilities: INTEGRATION_CAPABILITIES, executionMode: 'simulation' });
      if (token) invariant(equalsSecret(req.headers.authorization ?? '', `Bearer ${token}`), 'UNAUTHORIZED', '需要有效的服务访问令牌', 401);
      if (path === '/api/auth/accounts' && req.method === 'GET') return send(res, 200, {items:identities.accounts(), authentication:'demo_identity_without_password', requireIdentity});
      if (path === '/api/auth/login' && req.method === 'POST') return send(res, 201, identities.login(validate(s.obj({accountId:s.str()}), await body(req))));
      if (path === '/api/auth/logout' && req.method === 'POST') { await body(req); return send(res, 200, identities.logout(req.headers['x-rubber-session'])); }
      if (path === '/api/auth/me' && req.method === 'GET') { invariant(identity, 'LOGIN_REQUIRED', '请先选择登录身份。', 401); return send(res, 200, {account:identity.publicAccount}); }
      if (path === '/api/workspace/brief' && req.method === 'GET') {
        invariant(identity, 'LOGIN_REQUIRED', '请先选择登录身份。', 401);
        const siteId=requestedSite(url, identity.siteIds[0]);
        strategyRefresh.activateSite(siteId);
        if(publicDataService)await parkWeather.read(siteId);
        return send(res, 200, workspaceBrief({identity, siteId, simulation, makeParkContext, parkPlans, cerebellum, priceFactors, evolution, strategyRefresh:strategyRefresh.status(siteId), now:clock()}));
      }
      if (path === '/api/plot' && req.method === 'GET') {
        invariant(identity?.plot, 'PLOT_NOT_FOUND', '当前身份没有承包地块。', 404);
        return send(res, 200, plotSummary({identity, siteId:requestedSite(url, identity.plot.siteId), simulation, makeParkContext, now:clock()}));
      }
      if(path==='/api/strategy-refresh/status'&&req.method==='GET'){
        invariant(identity,'LOGIN_REQUIRED','请先选择登录身份。',401);
        const siteId=requestedSite(url,identity.siteIds[0]);
        strategyRefresh.activateSite(siteId);
        return send(res,200,strategyRefresh.status(siteId));
      }
      if(path.startsWith('/api/park-plan')) {
        invariant(identity,'LOGIN_REQUIRED','请先选择登录身份。',401);
        invariant(['manager','executive'].includes(identity.role),'FORBIDDEN','经营策略及其成本、订单和库存只对园区管理与中心管理开放。',403);
      }
      if(path==='/api/park-plan/inputs'&&req.method==='GET')return send(res,200,parkPlans.economicInputs.read(requestedSite(url)));
      if(path==='/api/park-plan/inputs'&&req.method==='PUT')return send(res,200,parkPlans.economicInputs.save(await body(req),identity));
      if (path === '/api/park-plan/latest' && req.method === 'GET') { identity?.require('site.read'); const siteId=requestedSite(url); strategyRefresh.activateSite(siteId); if(publicDataService)await parkWeather.read(siteId); return send(res, 200, {plan:parkPlans.latest(siteId)}); }
      const savedParkPlan = path.match(/^\/api\/park-plan\/(park-plan-[a-f0-9]+)$/);
      if (savedParkPlan && req.method === 'GET') {
        identity?.require('site.read');
        const plan=parkPlans.get(savedParkPlan[1]),siteId=requestedSite(url);
        invariant(plan.siteId===siteId,'SITE_MISMATCH','策略不属于当前园区。',409);
        identity?.requireSite(plan.siteId);
        if(publicDataService)await parkWeather.read(siteId);
        return send(res,200,{plan:parkPlans.withAdoption(plan)});
      }
      if (path === '/api/park-plan' && req.method === 'POST') {
        identity?.require('site.read');
        const input = validate(s.obj({siteId:s.str(),economicScenarioId:s.enum(...ECONOMIC_SCENARIOS.map(item=>item.id))},['economicScenarioId']), await body(req));
        identity?.requireSite(input.siteId);
        // Explicit calculation refreshes only unresolved normal demo inputs. GETs stay read-only.
        await prepareParkPlanSurface({siteId:input.siteId,dataMode:automaticDataMode,store,runtime,makeParkContext,clock});
        if(publicDataService)await parkWeather.read(input.siteId);
        const authorize=()=>{
          const current=identities.resolve(req.headers['x-rubber-session']);
          invariant(current,'SESSION_EXPIRED','登录身份已失效，请重新登录。',401);
          current.requireSite(input.siteId);
        };
        return send(res, 201, await parkPlans.compute(input.siteId,{economicScenarioId:input.economicScenarioId,authorize}));
      }
      const parkPlanRoute = path.match(/^\/api\/park-plan\/(park-plan-[a-f0-9]+)\/adopt$/);
      if (parkPlanRoute && req.method === 'POST') {
        const input = validate(s.obj({siteId:s.str(), replace:s.bool()}, ['siteId','replace']), await body(req));
        const siteId=parkPlans.get(parkPlanRoute[1]).siteId;identity?.requireSite(siteId);
        if(publicDataService)await parkWeather.read(siteId,{maxAgeMs:5*60000});
        return send(res, 200, parkPlans.adopt({planId:parkPlanRoute[1], siteId:input.siteId, replace:input.replace ?? false}, identity));
      }
      if (path === '/api/brain/evolution' && req.method === 'GET') { identity?.require('site.read'); return send(res, 200, await evolution.evaluate(requestedSite(url))); }
      if (path === '/api/brain/evolution/propose' && req.method === 'POST') {
        identity?.require('cerebellum.propose', '只有园区管理或中心可以发起参数提案。');
        const input = validate(s.obj({siteId:s.str()}), await body(req));
        identity?.requireSite(input.siteId);
        return send(res, 201, await evolution.propose(input.siteId, identity?.accountId ?? 'local-tool'));
      }
      if (path === '/api/brain/routing' && req.method === 'GET') { identity?.require('site.read'); return send(res, 200, routingEvolution.evaluate(requestedSite(url))); }
      if (path === '/api/brain/routing/propose' && req.method === 'POST') {
        identity?.require('cerebellum.propose', '只有园区管理或中心可以发起分流下沉提案。');
        const input = validate(s.obj({siteId:s.str(), kind:s.str(), signature:s.str()}), await body(req));
        identity?.requireSite(input.siteId);
        return send(res, 201, routingEvolution.propose(input.siteId, input, identity?.accountId ?? 'local-tool'));
      }
      const delegationRoute = path.match(/^\/api\/brain\/routing\/(route-[a-f0-9-]+)\/(decision|revoke)$/);
      if (delegationRoute && req.method === 'POST') {
        if (delegationRoute[2] === 'revoke') return send(res, 200, routingEvolution.revoke(delegationRoute[1], validate(s.obj({note:s.str()}, ['note']), await body(req)), identity));
        const input = validate(s.obj({decision:s.enum('approve','reject'), note:s.str()}, ['note']), await body(req));
        return send(res, 200, routingEvolution.decide(delegationRoute[1], input, identity));
      }
      if (path === '/api/cerebellum' && req.method === 'GET') { identity?.require('site.read'); return send(res, 200, cerebellum.status(requestedSite(url))); }
      if (path === '/api/cerebellum/reflect' && req.method === 'POST') {
        identity?.require('cerebellum.propose', '只有园区管理或中心可以发起参数反思。');
        const input = validate(s.obj({siteId:s.str()}), await body(req));
        identity?.requireSite(input.siteId);
        return send(res, 201, cerebellum.reflect(input.siteId, {createdBy:identity?.accountId ?? 'local-tool'}));
      }
      const cerebellumRoute = path.match(/^\/api\/cerebellum\/proposals\/(cereb-[a-f0-9-]+)\/decision$/);
      if (cerebellumRoute && req.method === 'POST') {
        const input = validate(s.obj({decision:s.enum('approve','reject'), note:s.str()}, ['note']), await body(req));
        return send(res, 200, cerebellum.decide(cerebellumRoute[1], input, identity));
      }
      if (path === '/api/cerebellum/rollback' && req.method === 'POST') {
        const input = validate(s.obj({siteId:s.str(), toVersion:s.int({minimum:0}), note:s.str()}, ['note']), await body(req));
        return send(res, 200, cerebellum.rollback(input.siteId, input, identity));
      }
      if(path==='/api/assistant/status'&&req.method==='GET')return send(res,200,{...conversationModel.describe(),paused:store.getModelControl().paused});
      if(path==='/api/assistant/sessions'&&req.method==='GET')return send(res,200,{items:assistant.listSessions({siteId:requestedSite(url),role:url.searchParams.get('role')??'manager',identity})});
      if(path==='/api/assistant/sessions'&&req.method==='POST')return send(res,201,assistant.createSession(await body(req),identity));
      if(path==='/api/assistant/memories'&&req.method==='GET')return send(res,200,{items:assistant.listMemories({siteId:requestedSite(url),role:url.searchParams.get('role')??'manager',identity})});
      if(path==='/api/assistant/memories'&&req.method==='POST'){
        invariant(identity,'LOGIN_REQUIRED','请先选择登录身份。',401);
        const input=validate(s.obj({scope:s.enum('private','park','shared'),title:s.str(),content:s.str(),topic:s.str(),siteId:s.str()},['title','topic']),await body(req));
        if(input.scope!=='shared')identity.requireSite(input.siteId);
        return send(res,201,assistant.memory.create({...input,siteId:input.scope==='shared'?null:baseRequestedSite(new URL(`http://x/?siteId=${encodeURIComponent(input.siteId)}`))},identity));
      }
      const memoryRoute=path.match(/^\/api\/assistant\/memories\/([A-Za-z0-9_.:-]+)(\/archive)?$/);
      if(memoryRoute&&req.method==='POST'){
        invariant(identity,'LOGIN_REQUIRED','请先选择登录身份。',401);
        if(memoryRoute[2])return send(res,200,assistant.memory.archive(memoryRoute[1],identity,validate(s.obj({reason:s.str()},['reason']),await body(req)).reason??''));
        const input=validate(s.obj({content:s.str(),title:s.str()},['title']),await body(req));
        return send(res,200,assistant.memory.edit(memoryRoute[1],input,identity));
      }
      const turnActionRoute=path.match(/^\/api\/assistant\/sessions\/([^/]+)\/turns\/([^/]+)\/(feedback|skill|skill-suggestion)$/);
      if(turnActionRoute){
        const [,sessionId,turnId,action]=turnActionRoute;
        if(action==='skill-suggestion'&&req.method==='GET')return send(res,200,assistant.skillSuggestion(sessionId,turnId,identity));
        if(action==='feedback'&&req.method==='POST')return send(res,200,assistant.feedback(sessionId,turnId,validate(s.obj({helpful:s.bool(),note:s.str()},['note']),await body(req)),identity));
        if(action==='skill'&&req.method==='POST')return send(res,201,assistant.draftSkill(sessionId,turnId,validate(s.obj({title:s.str(),triggers:s.arr(s.str()),instruction:s.str(),scope:s.enum('park','shared')},['title','triggers','instruction','scope']),await body(req)),identity));
      }
      if(path==='/api/assistant/skills'&&req.method==='GET'){return send(res,200,{items:skills.list(requestedSite(url),identity)});}
      const skillRoute=path.match(/^\/api\/assistant\/skills\/(skill-[a-f0-9-]+)\/(decision|revise)$/);
      if(skillRoute&&req.method==='POST'){
        if(skillRoute[2]==='decision')return send(res,200,skills.decide(skillRoute[1],validate(s.obj({decision:s.str(),note:s.str()},['note']),await body(req)),identity));
        return send(res,200,skills.revise(skillRoute[1],validate(s.obj({title:s.str(),triggers:s.arr(s.str()),instruction:s.str()},['title','triggers','instruction']),await body(req)),identity));
      }
      if(path==='/api/brain/harness'&&req.method==='GET'){identity.require('memory.park.write');return send(res,200,harnessLedger({store,skills,identity,siteId:requestedSite(url),now:clock()}));}
      const canvasRoute=path.match(/^\/api\/assistant\/sessions\/([^/]+)\/turns\/([^/]+)\/(investigation|canvas)(\/history)?$/);
      if(canvasRoute){
        const [,sessionId,turnId,action,history]=canvasRoute;
        if(action==='investigation'&&req.method==='POST')return send(res,200,assistant.createInvestigation(sessionId,turnId,identity));
        if(action==='canvas'&&history&&req.method==='GET')return send(res,200,assistant.canvasHistory(sessionId,turnId,identity));
        if(action==='canvas'&&!history&&req.method==='GET')return send(res,200,assistant.getCanvas(sessionId,turnId,identity));
        if(action==='canvas'&&!history&&req.method==='POST')return send(res,200,assistant.saveCanvas(sessionId,turnId,await body(req),identity));
      }
      const operationRoute=path.match(/^\/api\/assistant\/sessions\/([^/]+)\/operations\/([^/]+)(?:\/(confirm))?$/);
      if(operationRoute){
        const session=assistant.owned(assistant.session(operationRoute[1]),identity);
        if(req.method==='GET'&&!operationRoute[3])return send(res,200,assistantActions.get(operationRoute[2],session,identity));
        if(req.method==='POST'&&operationRoute[3]){
          const authorize=()=>{const current=identities.resolve(req.headers['x-rubber-session']);assistant.owned(session,current);return current;};
          return send(res,200,await assistantActions.confirm(operationRoute[2],session,identity,authorize));
        }
      }
      const assistantRoute=path.match(/^\/api\/assistant\/sessions\/([^/]+)(?:\/turns(?:\/([^/]+))?)?$/);
      if(assistantRoute&&req.method==='GET')return send(res,200,assistantRoute[2]?assistant.getTurn(assistantRoute[1],assistantRoute[2],identity):assistant.getSession(assistantRoute[1],identity));
      if(assistantRoute&&path.endsWith('/turns')&&req.method==='POST')return send(res,202,assistant.submitTurn(assistantRoute[1],await body(req),identity));
      if(path==='/api/simulation/reviews'&&req.method==='GET'){const siteId=requestedSite(url);return send(res,200,{siteId,items:reviews.jobs(siteId),issues:reviews.issues(url.searchParams.get('dataMode')??'demo',siteId)});}
      if(path==='/api/simulation/reviews'&&req.method==='POST')return send(res,201,{items:reviews.create(await body(req))});
      if(path==='/api/simulation/reviews/refresh'&&req.method==='POST'){const input=await body(req);return send(res,202,{items:await reviews.refresh(input.treeId,input.siteId??'demo-hainan')});}
      const photoRoute=path.match(/^\/api\/simulation\/reviews\/(review-[a-zA-Z0-9-]+)\/photo\/(start|verify|collect|fail|capture-[a-zA-Z0-9-]+)$/);
      if(photoRoute){
        const [,id,action]=photoRoute,job=reviews.get(id),scope=optionalSite();
        identity?.require('site.read');identity?.requireTree(job.siteId??'demo-hainan',job.treeId);
        invariant(scope===null||scope===(job.siteId??'demo-hainan'),'NOT_FOUND','当前园区没有该核查任务',404);
        if(req.method==='GET'&&action.startsWith('capture-'))return send(res,200,observations.image(id,action));
        if(req.method==='POST'){
          const input=await body(req,1024*1024);
          return send(res,200,action==='start'?observations.start(id,input):action==='verify'?observations.verify(id,input.captureId):action==='collect'?observations.collect(id,input):observations.fail(id,input));
        }
      }
      const reviewRoute=path.match(/^\/api\/simulation\/reviews\/(review-[a-zA-Z0-9-]+)\/(collect|complete|regenerate|events)$/);
      if(reviewRoute){const scope=optionalSite(),job=reviews.get(reviewRoute[1]);identity?.requireTree(job.siteId??'demo-hainan',job.treeId);invariant(scope===null||normalizeSiteId(job.siteId??'demo-hainan')===scope,'NOT_FOUND','当前园区没有该核查任务',404);}
      if(reviewRoute&&req.method==='GET'&&reviewRoute[2]==='events'){reviews.get(reviewRoute[1]);return send(res,200,{items:store.db.prepare('SELECT body FROM review_events WHERE job_id=? ORDER BY seq').all(reviewRoute[1]).map(r=>JSON.parse(r.body))});}
      if(reviewRoute&&req.method==='POST'){const input=await body(req);return send(res,200,reviewRoute[2]==='collect'?reviews.collect(reviewRoute[1],input):reviewRoute[2]==='complete'?await reviews.complete(reviewRoute[1],input):await reviews.regenerate(reviewRoute[1]));}
      if (path === '/api/simulation/constraints' && req.method === 'GET') {
        const siteId=requestedSite(url), weather=publicDataService?await parkWeather.read(siteId,{maxAgeMs:5*60000}):null;
        return send(res,200,{...simulation.effectiveConstraints(siteId),liveWeather:weather?{enabled:true,...weather.execution,fetchedAt:weather.fetchedAt,validUntil:weather.validUntil}:{enabled:false}});
      }
      if (path === '/api/simulation/operational-events' && req.method === 'GET') {
        const siteId = optionalSite();
        return send(res, 200, {siteId,items:simulation.operationalEvents.list(siteId).filter(visibleSite),checkedAt:clock().toISOString()});
      }
      if (path === '/api/simulation/operational-events' && req.method === 'POST') return send(res, 200, simulation.operationalEvents.create(await body(req)));
      const operationalEventRoute = path.match(/^\/api\/simulation\/operational-events\/(event-[a-zA-Z0-9_-]+)\/(resolve|resume)$/);
      if (operationalEventRoute && req.method === 'POST') return send(res, 200, simulation.operationalEvents.transition(operationalEventRoute[1], operationalEventRoute[2], await body(req)));
      if (path === '/api/simulation/logistics-batches' && req.method === 'GET') {
        const siteId = optionalSite();
        return send(res, 200, {siteId,items:simulation.logistics.list(siteId).filter(visibleSite),checkedAt:clock().toISOString()});
      }
      if (path === '/api/simulation/logistics-batches' && req.method === 'POST') return send(res, 200, simulation.logistics.create(await body(req)));
      const logisticsRoute = path.match(/^\/api\/simulation\/logistics-batches\/([^/]+)\/(weigh|inspect|plan|dispatch|receive|process|pause|resume|cancel|hold|start-processing)$/);
      if (logisticsRoute && req.method === 'POST') return send(res, 200, simulation.logistics.transition(logisticsRoute[1], logisticsRoute[2], await body(req)));
      if (path === '/api/simulation/sales-inventory' && req.method === 'GET') return send(res, 200, {inventory:simulation.salesInventory(requestedSite(url))});
      if (path === '/api/economics/scenarios' && req.method === 'GET') return send(res,200,{items:ECONOMIC_SCENARIOS});
      if (path === '/api/market-events' && req.method === 'GET') {
        identity?.require('site.read');
        return send(res,200,{kinds:MARKET_EVENT_KINDS,items:marketEvents.list(url.searchParams.get('siteId') ? requestedSite(url) : null)
          .filter(event => !identity || event.siteIds === 'all' || event.siteIds.some(siteId => identity.seesSite(siteId)))});
      }
      if (path === '/api/market-events' && req.method === 'POST') {
        const input = validate(s.obj({kind:s.str(),title:s.str(),siteIds:{anyOf:[s.str(),s.arr(s.str())]},effectiveFrom:s.str(),effectiveTo:s.str(),source:s.str(),note:s.str()},['siteIds','effectiveFrom','effectiveTo','source','note']), await body(req));
        return send(res,201,marketEvents.propose(input, identity));
      }
      const marketEventRoute = path.match(/^\/api\/market-events\/(mevent-[a-f0-9-]+)\/decision$/);
      if (marketEventRoute && req.method === 'POST') {
        const input = validate(s.obj({decision:s.str(),note:s.str()},['note']), await body(req));
        return send(res,200,marketEvents.decide(marketEventRoute[1], input, identity));
      }
      if (path === '/api/economics/price-factors' && req.method === 'GET') {
        identity?.require('site.read');
        return send(res,200,priceFactors.read(requestedSite(url)));
      }
      if (path === '/api/eudr/readiness' && req.method === 'GET') {
        identity?.require('site.read');
        return send(res,200,eudr.read(requestedSite(url)));
      }
      if (path === '/api/eudr/demo-prepare' && req.method === 'POST') {
        identity?.require('sales.write');
        const input=validate(s.obj({siteId:s.str(),batchId:s.str()}),await body(req));
        identity?.requireSite(input.siteId);
        return send(res,200,eudr.prepareDemo(input));
      }
      if (path === '/api/eudr/allocate' && req.method === 'POST') {
        identity?.require('sales.write');
        const input=validate(s.obj({siteId:s.str(),shipmentId:s.str(),batchIds:s.arr(s.str())}),await body(req));
        identity?.requireSite(input.siteId);
        return send(res,200,eudr.allocate(input,identity));
      }
      if (path === '/api/eudr/release' && req.method === 'POST') {
        identity?.require('sales.write');
        const input=validate(s.obj({siteId:s.str(),shipmentId:s.str()}),await body(req));
        identity?.requireSite(input.siteId);
        return send(res,200,eudr.release(input));
      }
      if (path === '/api/eudr/shipment-package' && req.method === 'GET') {
        identity?.require('site.read');
        return send(res,200,eudr.exportShipmentPack(requestedSite(url),url.searchParams.get('shipmentId')));
      }
      if (path === '/api/eudr/package' && req.method === 'GET') {
        identity?.require('site.read');
        return send(res,200,eudr.exportPack(requestedSite(url),url.searchParams.get('batchId')));
      }
      if (path === '/api/commodity/rubber' && req.method === 'GET') {
        const siteId = requestedSite(url);
        return send(res,200,rubberMarketContext({publicDataService,inventory:simulation.salesInventory(siteId),parkName:parkSite(siteId).name,now:clock(),network:networkInventory(simulation,PARK_SITES)}));
      }
      if (path === '/api/simulation/sales-shipments' && req.method === 'GET') {
        const siteId = optionalSite();
        return send(res, 200, {siteId,items:simulation.salesShipments.list(siteId,url.searchParams.get('modelId')).filter(visibleSite)});
      }
      const salesShipmentRoute = path.match(/^\/api\/simulation\/sales-shipments\/([^/]+)\/advance$/);
      if (salesShipmentRoute && req.method === 'POST') return send(res, 200, simulation.salesShipments.advance(salesShipmentRoute[1], await body(req)));
      if (path === '/api/simulation/strategy-validity' && req.method === 'POST') return send(res, 200, simulation.validateStrategies(await body(req)));
      if (path === '/api/simulation/actions' && req.method === 'GET') return send(res, 200, {items: simulation.list(url.searchParams.get('treeId'), requestedSite(url))});
      if (path === '/api/simulation/actions' && req.method === 'POST') return send(res, 200, simulation.record(await body(req)));
      if (path === '/api/simulation/task-receipts' && req.method === 'GET') return send(res, 200, {items:simulation.tasks(undefined,optionalSite()).filter(row=>visibleTask(row.task))});
      if (path === '/api/simulation/task-receipts' && req.method === 'POST') return send(res, 200, simulation.tasks(await body(req, 2*1024*1024)));
      if (path === '/api/simulation/market' && req.method === 'POST') return send(res, 200, simulation.market(await body(req)));
      if (path === '/api/simulation/market/latest' && req.method === 'GET') return send(res,200,simulation.latestMarket(requestedSite(url)));
      if (path === '/api/simulation/tasks' && req.method === 'GET') {
        const siteId=optionalSite(),items=simulation.latestTasks(siteId).filter(visibleTask).map(task=>scopeTaskForIdentity(task,identity));
        return send(res,200,{items,operationalEvents:simulation.operationalEvents.list(siteId).filter(visibleSite).map(event=>scopeOperationalEvent(event,identity)).filter(Boolean),
          logisticsBatches:identity?.plot?[]:simulation.logistics.list(siteId).filter(visibleSite)});
      }
      if (path === '/api/simulation/market-plan' && req.method === 'POST') {
        const input=await body(req);
        const row=store.db.prepare('SELECT body FROM simulation_models WHERE id=?').get(input.modelId);
        invariant(row,'NOT_FOUND','经营情景不存在。',404);
        invariant(!input.siteId||normalizeSiteId(input.siteId)===normalizeSiteId(JSON.parse(row.body).siteId??'demo-hainan'),'SITE_MISMATCH','情景不属于当前园区。',409);
        throw new AppError('USE_PARK_PLAN','经营测算仅用于比较；请在生产计划中生成并采用方案，统一安排作业。',409);
      }
      if (path === '/api/simulation/market-sales-plan' && req.method === 'POST') return send(res,200,simulation.adoptMarketSales(await body(req)));
      if (path === '/api/simulation/market-sales-plan' && req.method === 'GET') return send(res,200,{salesPlan:simulation.marketSalesPlan(url.searchParams.get('modelId'),requestedSite(url))});
      if (path.startsWith('/api/simulation/market/') && req.method === 'GET') {const scope=optionalSite(),row=store.db.prepare('SELECT body FROM simulation_models WHERE id=?').get(path.slice('/api/simulation/market/'.length));invariant(row,'NOT_FOUND','情景不存在',404);const model=JSON.parse(row.body);identity?.requireSite(model.siteId??'demo-hainan');invariant(scope===null||normalizeSiteId(model.siteId??'demo-hainan')===scope,'NOT_FOUND','当前园区没有该情景',404);return send(res,200,model);}
      if (path === '/contracts/harness-v1.schema.json' && req.method === 'GET') return send(res, 200, schemaBundle);
      if(path==='/api/model/control'&&req.method==='GET')return send(res,200,store.getModelControl());
      if(path==='/api/model/control'&&req.method==='POST') {
        const input=validate(s.obj({paused:s.bool()}),await body(req));
        return send(res,200,store.setModelPaused(input.paused,clock().toISOString()));
      }
      if(path==='/api/automatic'&&req.method==='GET')return send(res,200,automatic?.status()??{status:'unconfigured'});
      if(path==='/api/automatic/control'&&req.method==='POST') {
        invariant(automatic||strategyRefresh.config.enabled,'AUTOMATIC_NOT_CONFIGURED','未配置自动运行',409);
        const input=validate(s.obj({paused:s.bool()}),await body(req));
        const automaticStatus=automatic?.setPaused(input.paused);
        if(!automatic&&!input.paused)store.saveAutomaticState({...store.getAutomaticState(),circuitReason:null,consecutiveFailures:0});
        strategyRefresh.setPaused(input.paused);
        return send(res,200,{...(automaticStatus??{status:input.paused?'paused':'waiting'}),strategyRefresh:strategyRefresh.status()});
      }
      if (path === '/api/meta' && req.method === 'GET') return send(res, 200, {
        name: '橡胶大脑 · Harness 联调台', version: INTEGRATION_VERSION, integrationCapabilities: INTEGRATION_CAPABILITIES, contractStatus: 'draft-awaiting-MH-confirmation', executionMode: 'simulation',
        generator: runtime.generator.mode, modelVersion: runtime.generator.modelVersion, llm: runtime.generator.describe?.()??null, contextMode: provider.mode,
        publicDataEnabled: Boolean(publicDataService), capabilities: CATALOG, sources: SOURCE_CATALOG.map(s => ({ ...s, mode: provider.mode === 'demo' ? 'simulated' : 'provided_by_business_backend' })),
      });
      if (path === '/api/field/trees' && req.method === 'GET') {
        const siteId=requestedSite(url),catalog=fieldTrees.catalog(siteId);
        const items=identity?.plot?catalog.items.filter(item=>identity.seesTree(siteId,item.treeId)):catalog.items;
        return send(res,200,{...catalog,items,importedCount:items.length});
      }
      if (path === '/api/field/trees' && req.method === 'POST') return send(res,201,fieldTrees.import(await body(req,2*1024*1024)));
      if(path === '/api/contexts' && req.method === 'POST') {
        invariant(provider.mode==='demo','LOCAL_CONTEXT_DISABLED','远程模式请在业务服务保存快照',409);
        const context=validate(contextSchema,await body(req,2*1024*1024),'INVALID_CONTEXT');store.saveContext(context);
        return send(res,201,{siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:context.executionMode});
      }
      if (path === '/api/weather/window' && req.method === 'GET') return send(res,200,await parkWeather.read(requestedSite(url)));
      if (path === '/api/weather/window' && req.method === 'POST') {
        const input = validate(s.obj({siteId:s.enum(...Object.keys(PARK_SITES))}), await body(req));
        const siteId = input.siteId;
        identity?.requireSite(siteId);
        return send(res,200,await parkWeather.read(siteId,{force:true}));
      }
      if (path === '/api/sources/industry-context' && req.method === 'POST') {
          invariant(provider.mode==='demo','LOCAL_CONTEXT_DISABLED','远程模式请由业务服务创建行业快照',409);
          const input=validate(s.obj({dataMode:s.enum('demo','public','mixed_demo')},['dataMode']),await body(req));
          const dataMode=input.dataMode??'public';
          invariant(dataMode!=='public'||publicDataService,'PUBLIC_SOURCES_DISABLED','当前进程未启用公开资料服务；可选择明确的模拟演示',503);
          const service=publicDataService??{status:()=>({location:{confirmed:false},sources:[]})};
          const context=makeIndustryContext({service,now:clock(),dataMode});store.saveContext(context);
          return send(res,201,{siteId:context.siteId,targetSnapshotId:context.targetSnapshot.targetSnapshotId,inputSnapshot:{snapshotId:context.snapshotId,version:context.version},executionMode:'simulation'});
      }
      // Exchange quotes are public reference data, with no park or account records.
      if (path === '/api/market/quotes' && req.method === 'GET') return send(res,200,await marketQuotes.quotes());
      if (path.startsWith('/api/sources')) {
        invariant(publicDataService, 'PUBLIC_SOURCES_DISABLED', '当前进程未启用公开数据采集', 503);
        if (path === '/api/sources' && req.method === 'GET') return send(res, 200, publicDataService.status());
        if (path === '/api/sources/coverage' && req.method === 'GET') return send(res,200,{items:sourceCoverage(publicDataService.status())});
        if (path === '/api/sources/refresh' && req.method === 'POST') {
          validate(s.obj({}), await body(req));
          publicDataService.refresh({ force: true }).catch(e => console.error('Source refresh failed:',e.code ?? e.name));
          return send(res, 202, { status: 'refreshing' });
        }
        const sourceMatch = path.match(/^\/api\/sources\/snapshots\/([A-Za-z0-9_-]+)$/);
        if (sourceMatch && req.method === 'GET') return send(res, 200, publicDataService.archive(sourceMatch[1]), { 'Content-Disposition': `attachment; filename="${sourceMatch[1]}.json"` });
        if (path === '/api/sources/contexts' && req.method === 'POST') {
          invariant(provider.mode === 'demo', 'DEMO_DISABLED', '真实业务上下文请由 MH 服务提供', 409);
          const input = validate(s.obj({ treeIds: s.arr(id, { minItems: 1, maxItems: 200, uniqueItems: true }),dataMode:s.enum('public','mixed_demo'),siteId:s.str() },['dataMode','siteId']), await body(req));
          invariant(input.treeIds.every(t => /^T-\d{4}$/.test(t) && Number(t.slice(2)) >= 1 && Number(t.slice(2)) <= 200), 'TREE_NOT_FOUND', '未知模拟树编号', 404);
          const context = input.dataMode === 'mixed_demo' ? integrationContext({...input, siteId:normalizeSiteId(input.siteId??'demo-hainan'), service:publicDataService, now:clock(), reviews}) : fieldTrees.apply(makePublicContext({...input, siteId:normalizeSiteId(input.siteId??'demo-hainan'), service:publicDataService, now:clock()})); store.saveContext(context);
          return send(res, 201, { siteId: context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version }, executionMode: 'simulation', asOf: context.asOf, targetCount: context.targetSnapshot.treeIds.length });
        }
      }
      if (path.startsWith('/api/demo/')) invariant(provider.mode === 'demo', 'DEMO_DISABLED', '远程上下文模式不提供本地模拟档案', 404);
      if(path==='/api/demo/business-data'&&req.method==='GET')return send(res,200,{mode:'simulated',asOf:clock().toISOString(),records:makeBusinessDemo(clock())});
      if (path === '/api/demo/health' && req.method === 'GET') {
        const siteId = requestedSite(url), now = clock();
        const context = makeParkContext({ now, siteId });
        const candidate = await new RuleGenerator().generate({ kind: 'pest_risk', context, now });
        const runId = `demo-health-${parkSite(siteId).key}`;
        const inputSnapshot = { snapshotId: context.snapshotId, version: context.version };
        const strategy = {
          strategyId: `strategy-${runId}`, revision: 1, runId, kind: 'pest_risk', siteId,
          targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot,
          generatedAt: now.toISOString(), expiresAt: new Date(+now + 3600000).toISOString(), executionMode: 'simulation',
          provenance: { sourceId: 'harness-brain', sourceClass: 'research_partner', mode: 'simulated' },
          schemaVersion: '2.1.0', modelVersion: null,
          qualityReview: { status: 'pending', reviewRequired: true, reviewedAt: null, notes: [] },
          ruleBindings: context.modules.knowledge.rules.map(r => ({ ruleId: r.ruleId, version: r.version, contentHash: digest(r) })),
          ruleVersion: context.constraints.ruleSetId,
          constraintsChecked: [{ code: 'DEMO_SIMULATION', status: 'not_checked', message: '规则演示结果需现场复核，不构成病虫害诊断' }],
          dataPolicy: context.dataPolicy, ...candidate,
        };
        return send(res, 200, { result: { runId, requestId: `demo-health-request-${parkSite(siteId).key}`, status: 'succeeded', updatedAt: now.toISOString(), strategy }, context });
      }
      if (path === '/api/demo/park' && req.method === 'GET') {const now=clock(),siteId=requestedSite(url),overview=parkOverview(now,siteId),context=makeParkContext({now,siteId,...(identity?.plot?{treeIds:identity.treeIds(siteId)}:{})});return send(res,200,{...overview,trees:context.modules.trees.map(t=>({...t,profile:profileOf(t.treeId)})),modules:context.modules,...(identity?.plot?{plot:{label:identity.plot.label,treeIds:identity.plot.treeIds}}:{})});}
      if (path === '/api/demo/analytics' && req.method === 'GET') {const siteId=requestedSite(url),site=parkSite(siteId).key,days=Number(url.searchParams.get('days')||30);invariant(Number.isInteger(days)&&days>=7&&days<=90,'INVALID_QUERY','分析范围无效',400);return send(res,200,analyticsSeries(site,clock(),days,identity));}
      if (path === '/api/demo/scenarios/run' && req.method === 'POST') {
        const input = validate(s.obj({ scenarioId: s.enum('all', ...SCENARIOS.map(x => x.id)), dataMode: s.enum('demo', 'mixed_demo'), siteId: s.str() }, ['dataMode', 'siteId']), await body(req));
        const siteId = normalizeSiteId(input.siteId ?? 'demo-hainan');
        const now = clock(), batchId = `demo-${randomUUID()}`;
        const items = (input.scenarioId === 'all' ? SCENARIOS : SCENARIOS.filter(x => x.id === input.scenarioId)).map(scenario => {
          const context = input.dataMode === 'mixed_demo' ? integrationContext({treeIds:scenario.treeIds, dataMode:input.dataMode, siteId, now, service:publicDataService, reviews}) : reviews.apply(scenarioContext(scenario, now, siteId)); store.saveContext(context);
          const accepted = runtime.submit({ requestId: `${batchId}-${scenario.id}`, kind: scenario.kind, siteId: context.siteId,
            targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version },
            executionMode: 'simulation', generatorMode:'demo_rules', trigger: { type: 'user', eventId: batchId } });
          return { scenarioId: scenario.id, title: scenario.title, siteId, dataMode: input.dataMode, ...accepted };
        });
        return send(res, 202, { batchId, items });
      }
      const treeKinds = new Set(['tapping_angle', 'surface_action', 'growth_plan', 'pest_risk']);
      // Keep the default Blender manifest small but make the surface-action
      // contrast ready out of the box: normal, scar/lesion, unregistered,
      // nodule, bird dropping, mud, resting and missing-data examples.
      const treeViewIds = ['T-0001', 'T-0002', 'T-0005', 'T-0006', 'T-0012', 'T-0018', 'T-0027', 'T-0031', 'T-0038', 'T-0042'];
      const treePolicy = (context, dataMode) => context.dataPolicy ?? {
        mode: dataMode,
        notices: [`${parkSite(context.siteId).name}树木档案和策略输入为可重复的模拟数据，仅用于演示联调。`],
        substitutions: [{ module: 'trees', sourceId: `demo-tree-register-${parkSite(context.siteId).key}`, reason: '尚未接入园区真实树木档案，使用标注的模拟树号。' }],
      };
      const treeContext = (treeId, dataMode, now, siteId = 'demo-hainan') => integrationContext({treeIds:[treeId], dataMode, siteId, now, service:publicDataService, reviews});
      if (path === '/api/demo/trees/manifest' && req.method === 'GET') {
        const siteId = requestedSite(url);
        return send(res, 200, { version: '1', kind: 'tapping_angle', siteId, site: parkSite(siteId).key, dataMode: 'mixed_demo', items: (url.searchParams.get('scope') === 'park' ? TREE_IDS : treeViewIds).map(treeId => ({ objectName: `Tree_${treeId}`, treeId, siteId, label: `${treeId} · ${profileOf(treeId)}` })) });
      }
      if (path === '/api/demo/trees/prepare' && req.method === 'POST') {
        const raw = await body(req);
        const input = validate(s.obj({ preparationId: id, treeIds: s.arr(id, { minItems: 1, maxItems: 200, uniqueItems: true }), kind: s.enum(...treeKinds), dataMode: s.enum('demo', 'mixed_demo'), generatorMode: s.enum('demo_rules', 'configured'), preserveConfigured: s.bool(), siteId: s.str(), background:s.bool(), refreshReason:s.enum('startup','scheduled','site_activated','manual') }, ['treeIds', 'kind', 'dataMode', 'preserveConfigured', 'siteId','background','refreshReason']), raw);
        const treeIds = input.treeIds ?? treeViewIds;
        const siteId = normalizeSiteId(input.siteId ?? 'demo-hainan');
        const normalized = { preparationId: input.preparationId, treeIds, siteId, kind: input.kind ?? 'tapping_angle', dataMode: input.dataMode ?? 'mixed_demo', generatorMode: input.generatorMode ?? 'demo_rules', preserveConfigured: input.preserveConfigured ?? false,background:input.background??false,refreshReason:input.refreshReason??'manual' };
        const requestHash = digest(normalized);
        const prior = store.getTreePreparation(normalized.preparationId);
        if (prior) {
          invariant(digest({ preparationId: prior.preparationId, treeIds: prior.treeIds, siteId: prior.siteId ?? 'demo-hainan', kind: prior.kind, dataMode: prior.dataMode, generatorMode: prior.generatorMode, preserveConfigured: prior.preserveConfigured ?? false,background:prior.background??false,refreshReason:prior.refreshReason??'manual' }) === requestHash, 'PREPARATION_CONFLICT', 'preparationId 已用于不同的准备参数；请使用新的准备参数', 409);
          return send(res, 202, prior);
        }
        invariant(treeIds.every(treeId => TREE_IDS.includes(treeId)), 'TREE_NOT_FOUND', '树编号不在园区内', 404);
        const now = clock();
        const items = [],skipped=[];
        for (const treeId of treeIds) {
          const reason=treePreparationSkipReason({store,treeId,siteId,kind:normalized.kind,dataMode:normalized.dataMode,now,
            background:normalized.background,refreshReason:normalized.refreshReason,preserveConfigured:normalized.preserveConfigured});
          if(reason){skipped.push({treeId,siteId,kind:normalized.kind,reason});continue;}
          const context = treeContext(treeId, normalized.dataMode, now, normalized.siteId);
          store.saveContext(context);
          const requestId = `tree-prepare-${normalized.preparationId}-${normalized.kind}-${normalized.dataMode}-${treeId}`;
          const accepted = runtime.submit({ requestId, kind: normalized.kind, siteId: context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version }, executionMode: 'simulation', generatorMode: normalized.generatorMode, trigger: { type: 'user', eventId: normalized.preparationId } });
          store.bindTreeView({ treeId, siteId: normalized.siteId, kind: normalized.kind, dataMode: normalized.dataMode, preparationId: normalized.preparationId, requestId, runId: accepted.runId, contextSnapshotId: context.snapshotId, asOf: context.asOf });
          items.push({ treeId, siteId: normalized.siteId, runId: accepted.runId, requestId, status: accepted.status });
        }
        const preparation = { ...normalized, createdAt: now.toISOString(), asOf: now.toISOString(), items,skipped };
        store.saveTreePreparation(preparation, requestHash);
        return send(res, 202, preparation);
      }
      const treeViewMatch = path.match(/^\/api\/demo\/trees\/(T-\d{4})\/view$/);
      if (treeViewMatch && req.method === 'GET') {
        const treeId = treeViewMatch[1];
        const siteId = requestedSite(url);
        invariant(TREE_IDS.includes(treeId), 'TREE_NOT_FOUND', '未知模拟树编号', 404);
        identity?.requireTree(siteId, treeId);
        const kind = url.searchParams.get('kind') ?? 'tapping_angle';
        const dataMode = url.searchParams.get('dataMode') ?? 'mixed_demo';
        invariant(treeKinds.has(kind), 'INVALID_QUERY', '树视图只支持单树策略能力 kind', 400);
        invariant(dataMode === 'demo' || dataMode === 'mixed_demo', 'INVALID_QUERY', 'dataMode 必须为 demo 或 mixed_demo', 400);
        const binding = store.getTreeViewBinding(treeId, kind, dataMode, siteId);
        const run = binding ? store.getRun(binding.runId) : null;
        invariant(!binding||run,'RUN_NOT_FOUND','策略视图绑定的运行不存在，请重新准备',409);
        const fallback = makeParkContext({ treeIds: [treeId], siteId, now: clock() });
        const context = binding ? store.getContext(binding.contextSnapshotId, run.request.inputSnapshot.version) : fallback;
        invariant(context,'CONTEXT_NOT_FOUND','策略视图绑定的输入版本不可用，请重新准备',409);
        const tree = context.modules.trees.find(item => item.treeId === treeId);
        invariant(tree,'TREE_PROFILE_NOT_FOUND','策略输入中没有该树档案，请重新准备',409);
        const result = run?.result;
        const strategy = result?.status === 'succeeded' ? result.strategy : null;
        const now = clock();
        const strategyRoute = { ...classifyStrategyRoute(context, { treeId, kind }), checkedAt: now.toISOString() };
        const automaticSkipReason=treePreparationSkipReason({store,treeId,siteId,kind,dataMode,now,background:true,
          preserveConfigured:true,refreshReason:'startup',requireBrain:strategyRoute.status==='needs_big_brain'});
        const expired = Boolean(strategy && Date.parse(strategy.expiresAt) <= +now);
        const withdrawn = Boolean(strategy?.qualityReview?.status === 'withdrawn');
        const strategyStatus = !binding ? 'needs_generation' : run?.status === 'queued' || run?.status === 'running' ? 'pending' : run?.status === 'needs_data' ? 'needs_data' : run?.status === 'failed' ? 'failed' : withdrawn ? 'withdrawn' : expired ? 'expired' : strategy ? 'available' : 'needs_generation';
        return send(res, 200, { tree: { ...tree, profile: profileOf(treeId) }, siteId, site: parkSite(siteId).key, strategy: strategyStatus === 'available' ? strategy : null, strategyStatus, status: run?.status ?? 'not_generated', run: run ? { runId: run.runId, requestId: run.requestId, status: run.status, stage: run.stage, updatedAt: run.updatedAt, generatorMode: run.request.generatorMode } : null, asOf: binding?.asOf ?? null, checkedAt: now.toISOString(), strategyRoute, automaticSkipReason, dataPolicy: treePolicy(context, dataMode), ...(result?.missingData ? { missingData: result.missingData } : {}), ...(result?.error ? { error: result.error } : {}) });
      }
      if (path === '/api/demo/trees' && req.method === 'GET') {
        const siteId = requestedSite(url);
        const query = (url.searchParams.get('q') ?? '').toLowerCase();
        const cursor = numberQuery(url, 'cursor', 1, 201), limit = numberQuery(url, 'limit', 20, 100);
        const all = makeParkContext({ now: clock(), siteId }).modules.trees.filter(t => `${t.treeId} ${t.blockId}`.toLowerCase().includes(query) && (!identity || identity.seesTree(siteId, t.treeId)));
        return send(res, 200, { siteId, site: parkSite(siteId).key, items: all.slice(cursor - 1, cursor - 1 + limit), nextCursor: cursor - 1 + limit < all.length ? String(cursor + limit) : null, total: all.length, asOf: clock().toISOString() });
      }
      if (path === '/api/demo/contexts' && req.method === 'POST') {
        const input = validate(s.obj({ treeIds: s.arr(id, { minItems: 1, maxItems: 200, uniqueItems: true }), variant: s.enum('normal', 'missing_weather', 'rainy', 'unregistered', 'missing_cost'), siteId: s.str() }, ['siteId']), await body(req));
        const existing = new Set(Array.from({ length: 200 }, (_, i) => makeTree(i + 1, clock()).treeId));
        invariant(input.treeIds.every(id => existing.has(id)), 'TREE_NOT_FOUND', '只能选择已有模拟树 ID', 404);
        const context = makeParkContext({ ...input, siteId: normalizeSiteId(input.siteId ?? 'demo-hainan'), now: clock() }); store.saveContext(context);
        return send(res, 201, { siteId: context.siteId, targetSnapshotId: context.targetSnapshot.targetSnapshotId, inputSnapshot: { snapshotId: context.snapshotId, version: context.version }, executionMode: 'simulation', asOf: context.asOf, targetCount: context.targetSnapshot.treeIds.length });
      }
      if (path === '/internal/harness/runs' && req.method === 'POST') {
        const result = runtime.submit(await body(req));
        return send(res, result.created || ['queued', 'running'].includes(result.status) ? 202 : 200, { runId: result.runId, requestId: result.requestId, status: result.status }, { Location: `/internal/harness/runs/${result.runId}` });
      }
      if (path === '/internal/harness/runs' && req.method === 'GET') {
        const limit = numberQuery(url, 'limit', 20, 100), cursor = numberQuery(url, 'cursor', undefined, Number.MAX_SAFE_INTEGER);
        const kind=url.searchParams.get('kind'),dataMode=url.searchParams.get('dataMode'),generatorMode=url.searchParams.get('generatorMode');
        invariant(kind===null||CATALOG.some(item=>item.kind===kind),'INVALID_QUERY','kind 无效',400);
        invariant(dataMode===null||['demo','mixed_demo'].includes(dataMode),'INVALID_QUERY','dataMode 必须为 demo 或 mixed_demo',400);
        invariant(generatorMode===null||['demo_rules','configured'].includes(generatorMode),'INVALID_QUERY','generatorMode 无效',400);
        const page = store.listRuns({ limit, cursor, kind, dataMode, generatorMode, siteId: optionalSite() });
        return send(res, 200, { items: page.items.map(r => ({ runId: r.runId, requestId: r.requestId, kind: r.request.kind, generatorMode:r.request.generatorMode??'configured', siteId: r.request.siteId, status: r.status, stage: r.stage, createdAt: r.createdAt, updatedAt: r.updatedAt, attempt: r.attempt, qualityReview:r.result?.strategy?.qualityReview??null, summary: r.result?.strategy?.summary ?? r.result?.error?.message ?? null })), nextCursor: page.nextCursor });
      }
      const match = path.match(/^\/internal\/harness\/runs\/([A-Za-z0-9_.:-]+)(?:\/(events|context|retry|export|review))?$/);
      if (match) {
        const run = store.getRun(match[1]); invariant(run, 'RUN_NOT_FOUND', '运行不存在', 404);
        if (!match[2] && req.method === 'GET') return send(res, 200, run.result ?? { runId: run.runId, requestId: run.requestId, status: run.status, stage: run.stage, updatedAt: run.updatedAt });
        if (match[2] === 'export' && req.method === 'GET') {
          invariant(run.result, 'RESULT_NOT_READY', '运行尚未结束，暂不能导出', 409);
          invariant(run.result.strategy?.qualityReview?.status!=='withdrawn','STRATEGY_WITHDRAWN','该策略已因内容问题撤回，不能导出为策略包；可查询运行及轨迹作审计',409,run.result.strategy?.qualityReview?.notes);
          return send(res, 200, run.result, { 'Content-Disposition': `attachment; filename="${run.runId}.json"` });
        }
        if (match[2] === 'events' && req.method === 'GET') {
          const events = store.events(run.runId, numberQuery(url, 'after', 0, Number.MAX_SAFE_INTEGER));
          return send(res, 200, { items: events, nextCursor: events.at(-1)?.seq ?? null });
        }
        if (match[2] === 'context' && req.method === 'GET') {
          const context = store.getRunContext(run.runId) ?? store.getContext(run.request.inputSnapshot.snapshotId, run.request.inputSnapshot.version); invariant(context, 'CONTEXT_NOT_READY', '上下文尚未载入', 409);
          return send(res, 200, projectContext(context, run.request.kind));
        }
        if (match[2] === 'retry' && req.method === 'POST') { validate(s.obj({}), await body(req)); return send(res, 202, runtime.retry(run.runId)); }
        if (match[2] === 'review' && req.method === 'POST') {
          const input = validate(s.obj({ status: s.enum('withdrawn'), reason: s.str() }), await body(req));
          return send(res, 200, { runId: run.runId, qualityReview: store.withdrawStrategy(run.runId, input.reason, clock().toISOString()) });
        }
      }
      const strategyMatch = path.match(/^\/internal\/harness\/strategies\/([A-Za-z0-9_.:-]+)$/);
      if (strategyMatch && req.method === 'GET') { const strategy = store.getStrategy(strategyMatch[1]); invariant(strategy, 'STRATEGY_NOT_FOUND', '策略不存在', 404);invariant(strategy.qualityReview.status!=='withdrawn','STRATEGY_WITHDRAWN','策略已撤回，请查询原运行及复核轨迹',409,strategy.qualityReview.notes);return send(res, 200, strategy); }
      throw new AppError('NOT_FOUND', '路由不存在', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const known = error instanceof AppError;
      if (!known) console.error('HTTP error:', error.name);
      send(res, known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务内部错误', ...(known && error.details ? { details: error.details } : {}) } });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  runtime.start();
  return { server, runtime, store, automatic, strategyRefresh, assistant, identities, parkPlans, cerebellum, routingEvolution, async close() { await strategyRefresh.stop();await automatic?.stop();await assistant.stop();await runtime.stop(); if (server.listening) await new Promise(resolve => server.close(resolve)); cerebellum.close(); routingEvolution.close(); store.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadLocalEnv();
  const token = process.env.HARNESS_API_TOKEN;
  const host = process.env.HOST ?? '127.0.0.1';
  invariant(localHosts.includes(host) || token?.length >= 24, 'INVALID_CONFIG', '监听非本机地址前，必须设置至少 24 字符的 HARNESS_API_TOKEN');
  const generator = configuredGenerator();
  const publicDataService = process.env.PUBLIC_DATA_ENABLED === 'false' ? null : new PublicDataService({
    directory: resolve(ROOT, 'data/real-sources'), config: JSON.parse(readFileSync(resolve(ROOT, 'config/data-sources.json'), 'utf8')),
  });
  const app = createApp({
    publicDataService,
    automaticConfig:{...JSON.parse(readFileSync(resolve(ROOT,'config/automatic.json'),'utf8')),...(process.env.AUTOMATIC_ENABLED==='false'?{enabled:false}:{})},
    automaticOutputDir:resolve(ROOT,'data/automatic'),
    dbPath: process.env.HARNESS_DB_PATH ?? resolve(ROOT, 'var/brain.sqlite'), token, generator,
    contextBaseUrl: process.env.CONTEXT_API_URL, contextToken: process.env.CONTEXT_API_TOKEN,
    allowedOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').filter(Boolean), allowRemoteHost: !localHosts.includes(host),
    requireIdentity: process.env.HARNESS_REQUIRE_IDENTITY === 'true',
  });
  const port = Number(process.env.PORT ?? 4188);
  invariant(Number.isInteger(port) && port >= 1 && port <= 65535, 'INVALID_CONFIG', 'PORT 需要有效端口');
  app.server.listen(port, host, () => {publicDataService?.start();app.automatic?.start();console.log(`橡胶大脑 Harness v2: http://${host}:${port} · simulation · ${app.runtime.generator.mode}`);});
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await app.automatic?.stop();await publicDataService?.stop(); await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  app.server.on('error', async error => { console.error(error.message); await publicDataService?.stop(); await app.close(); process.exit(1); });
}
