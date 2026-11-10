import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionConfig, inspectBackend } from '../scripts/connection.mjs';
import { INTEGRATION_VERSION, INTEGRATION_CAPABILITIES } from '../../backend/src/integration-version.js';
const health={status:'ok',version:INTEGRATION_VERSION,capabilities:INTEGRATION_CAPABILITIES};
const response=(body,status=200,headers={})=>new Response(status===204?null:JSON.stringify(body),{status,headers});
function fake(options={}){return async(url,init={})=>{
 if(url.endsWith('/health'))return response(options.health||health);
 if(url.endsWith('/api/meta'))return response({generator: options.generator || 'llm', llm: {configured: options.configured !== false},publicDataEnabled:options.publicDataEnabled!==false});
 if(url.endsWith('/api/model/control'))return response(options.invalidControl?{}:{paused: options.paused === true});
 if(url.endsWith('/api/automatic'))return response({config:{enabled:options.automatic===true},paused:true,dataMode:options.dataMode||'mixed_demo'});
 if(init.method==='OPTIONS')return response(null,204,options.cors===false?{}:{'access-control-allow-origin':init.headers.Origin,'access-control-allow-methods':'GET, POST, OPTIONS'});
 if(url.includes('/manifest'))return response({items:Array(options.trees??200).fill({})});
 return response({items:[]});
};}
test('custom ports drive a single preparation/frontend/backend URL',()=>{
 const config=connectionConfig({HARNESS_PORT:'4278',FRONTEND_PORT:'4273'});
 assert.equal(config.backendUrl,'http://127.0.0.1:4278');assert.ok(config.origins.includes('http://localhost:4273'));
 assert.throws(()=>connectionConfig({HARNESS_PORT:'4278',HARNESS_URL:'http://127.0.0.1:4188'}),/不一致/);
 assert.throws(()=>connectionConfig({HARNESS_PORT:'4173'}),/相同/);
});
test('same version without required APIs cannot be silently reused',async()=>{
 const config=connectionConfig({});
 await assert.rejects(inspectBackend(config,fake({health:{...health,capabilities:[]}})),/不兼容/);
 await assert.rejects(inspectBackend(config,fake({health:{...health,capabilities:health.capabilities.filter(c=>c!=='site-scoped-simulation')}})),/不兼容/);
 const calls=[],withoutEvents=fake({health:{...health,capabilities:health.capabilities.filter(c=>c!=='operational-event-linkage')}});
 await assert.rejects(inspectBackend(config,async(url,init)=>{calls.push(url);return withoutEvents(url,init);}),/不兼容/);
 assert.deepEqual(calls,[config.backendUrl+'/health'],'missing event linkage must fail before preparation or task synchronization');
 const fieldCalls=[],withoutFieldImport=fake({health:{...health,capabilities:health.capabilities.filter(c=>c!=='field-tree-import')}});
 await assert.rejects(inspectBackend(config,async(url,init)=>{fieldCalls.push(url);return withoutFieldImport(url,init);}),/不兼容/);
 assert.deepEqual(fieldCalls,[config.backendUrl+'/health'],'missing field import must fail before preparation or task synchronization');
 await assert.rejects(inspectBackend(config,fake({health:{...health,version:'2.3.3'}})),/不兼容/);
 await assert.rejects(inspectBackend(config,fake({health:{...health,version:'2.3.1'}})),/不兼容/);
 await assert.rejects(inspectBackend(config,fake({health:{...health,version:'2.1.0'}})),/不兼容/);
 await assert.rejects(inspectBackend(config,fake({trees:10})),/200/);
 await assert.rejects(inspectBackend(config,fake({cors:false})),/未允许/);
 assert.equal((await inspectBackend(config,fake())).running,true);
});
test('only connection refused permits launch; timeouts do not hide port occupants',async()=>{
 assert.equal((await inspectBackend(connectionConfig({}),async()=>{throw Object.assign(Error('refused'),{cause:{code:'ECONNREFUSED'}});})).running,false);
 await assert.rejects(inspectBackend(connectionConfig({}),async()=>{throw Error('timeout');}),/健康检查失败/);
});
test('default startup never reuses a rule-only backend as the configured model service',async()=>{
 await assert.rejects(inspectBackend(connectionConfig({}),fake({generator:'demo_rules'})),/只支持演示规则/);
 await assert.rejects(inspectBackend(connectionConfig({}),fake({configured:false})),/尚未配置/);
 await assert.rejects(inspectBackend(connectionConfig({}),fake({invalidControl:true})),/状态不可读/);
 assert.equal((await inspectBackend(connectionConfig({HARNESS_RULES_ONLY:'1'}),fake({generator:'demo_rules'}))).running,true);
 assert.equal(connectionConfig({HARNESS_OFFLINE:'1'}).requireModel,false);
});
test('startup accepts a paused configured backend without resuming model or automatic calls',async()=>{
 const calls=[];
 const mock=fake({paused:true});
 const result=await inspectBackend(connectionConfig({}),async(url,init)=>{calls.push({url,method:init?.method||'GET'});return mock(url,init);});
 assert.equal(result.running,true);
 assert.ok(calls.some(c=>c.url.endsWith('/api/model/control')));
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
});
test('automatic opt-in requires a compatible enabled scheduler without implicitly resuming it',async()=>{
 assert.throws(()=>connectionConfig({HARNESS_AUTOMATIC:'1',HARNESS_OFFLINE:'1'}),/不能与/);
 assert.throws(()=>connectionConfig({HARNESS_AUTOMATIC:'1',HARNESS_RULES_ONLY:'1'}),/不能与/);
 assert.throws(()=>connectionConfig({HARNESS_DATA_MODE:'unknown'}),/HARNESS_DATA_MODE/);
 const config=connectionConfig({HARNESS_AUTOMATIC:'1'});
 await assert.rejects(inspectBackend(config,fake({paused:true})),/未启用自动/);
 const calls=[],mock=fake({paused:true,automatic:true});
 assert.equal((await inspectBackend(config,async(url,init)=>{calls.push({url,method:init?.method||'GET'});return mock(url,init);})).running,true);
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
 const demoConfig=connectionConfig({HARNESS_AUTOMATIC:'1',HARNESS_DATA_MODE:'demo'});
 await assert.rejects(inspectBackend(demoConfig,fake({paused:true,automatic:true})),/数据模式不匹配/);
 assert.equal((await inspectBackend(demoConfig,fake({paused:true,automatic:true,dataMode:'demo'}))).running,true);
});
test('offline demo refuses to reuse a model, public collector or automatic backend',async()=>{
 const config=connectionConfig({HARNESS_DEMO:'1',HARNESS_OFFLINE:'1',HARNESS_RULES_ONLY:'1',HARNESS_DATA_MODE:'demo'});
 const allowed={generator:'demo_rules',publicDataEnabled:false,dataMode:'demo'};
 assert.equal((await inspectBackend(config,fake(allowed))).running,true);
 for(const mismatch of [{generator:'llm'},{publicDataEnabled:true},{automatic:true},{dataMode:'mixed_demo'}]) {
  await assert.rejects(inspectBackend(config,fake({...allowed,...mismatch})),/离线规则后端/);
 }
});
test('a login-required backend is inspected as the background service account, which signs out afterwards',async()=>{
 const calls=[],mock=fake({paused:true});
 const loginBackend=async(url,init={})=>{
  const path=url.slice(url.indexOf('/',8)),session=init.headers?.['X-Rubber-Session'];
  calls.push({path,method:init.method||'GET',session,body:init.body});
  if(path==='/api/auth/accounts')return response({items:[],requireIdentity:true});
  if(path==='/api/auth/login')return response({token:'service-token',account:JSON.parse(init.body)},201);
  if(path==='/api/auth/logout')return response({loggedOut:true});
  if(!['/health','/api/meta'].includes(path)&&init.method!=='OPTIONS'&&session!=='service-token')return response({error:{code:'LOGIN_REQUIRED'}},401);
  return mock(url,init);
 };
 for(const env of [{},{HARNESS_REQUIRE_IDENTITY:'true'}]){
  calls.length=0;
  assert.equal((await inspectBackend(connectionConfig(env),loginBackend)).running,true);
  assert.deepEqual(JSON.parse(calls.find(call=>call.path==='/api/auth/login').body),{accountId:'operator-hn'});
  assert.equal(calls.at(-1).path,'/api/auth/logout','the inspection session is closed');
  const business=calls.filter(call=>!call.path.startsWith('/api/auth/')&&!['/health','/api/meta'].includes(call.path)&&call.method!=='OPTIONS');
  assert.ok(business.length>=4);assert.ok(business.every(call=>call.session==='service-token'));
 }
});
test('--require-login refuses to reuse a backend that still allows anonymous access, without signing in',async()=>{
 const calls=[],mock=fake({paused:true});
 await assert.rejects(inspectBackend(connectionConfig({HARNESS_REQUIRE_IDENTITY:'true'}),async(url,init={})=>{calls.push(url);return mock(url,init);}),/--require-login/);
 assert.ok(!calls.some(url=>url.endsWith('/api/auth/login')));
 assert.ok(!calls.some(url=>url.includes('/api/simulation/')),'refusal happens before business checks');
});
