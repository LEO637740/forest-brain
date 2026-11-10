import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transformWithOxc,parseAst} from 'vite';

const source=await readFile(new URL('../src/integration/client.ts',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'client.ts',{lang:'ts'});
const names=new Set(['sessionToken','sessionHeaders','sessionLost','requireCurrentSession','write','post','put','pending','read','useRead']);
const nodes=parseAst(compiled.code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
  .filter(Boolean).filter(node=>node.type==='FunctionDeclaration'?names.has(node.id?.name):node.type==='VariableDeclaration'&&node.declarations.some(item=>names.has(item.id.name)));
const code=nodes.map(node=>compiled.code.slice(node.start,node.end)).join('\n');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture() {
  let token='manager-token',cursor=0,dirty=false,output;
  const requests=[],events=[],states=[],effects=[],queue=[];
  const window=new EventTarget();
  window.addEventListener('harness-login-required',()=>events.push('login-required'));
  const bindings={BASE:'http://local.test',IDENTITY_STORAGE_KEY:'identity',window,Event,
    localStorage:{getItem:()=>token?JSON.stringify({token}):null},
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,respond:(body,status=200)=>resolve({ok:status<400,status,json:async()=>body})})),
    useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],next=>{const value=typeof next==='function'?next(states[i]):next;if(value!==states[i]){states[i]=value;dirty=true;}}];},
    useEffect(callback,deps){const i=cursor++,previous=effects[i];if(!previous||deps.some((item,index)=>item!==previous.deps[index])){effects[i]={deps,cleanup:previous?.cleanup};queue.push(()=>{effects[i].cleanup?.();effects[i].cleanup=callback();});}},
  };
  const api=new Function(...Object.keys(bindings),`${code};return {read,post,put,useRead};`)(...Object.values(bindings));
  return {api,requests,events,setToken:value=>{token=value;},
    render(path='/api/assistant/sessions?siteId=demo-hainan') {let passes=0;do{cursor=0;dirty=false;output=api.useRead(path);queue.splice(0).forEach(effect=>effect());assert.ok(++passes<10);}while(dirty);return output;},
  };
}

test('identical requests deduplicate within an identity, never across identities',async()=>{
  const app=fixture(),path='/api/assistant/memories?siteId=demo-hainan';
  const manager=app.api.read(path),sameManager=app.api.read(path);
  assert.equal(manager,sameManager);
  const oldRejected=assert.rejects(manager,/身份已变更/);
  app.setToken('grower-token');
  const grower=app.api.read(path);
  assert.notEqual(manager,grower);
  assert.equal(app.requests.length,2);
  assert.equal(app.requests[0].options.headers['X-Rubber-Session'],'manager-token');
  assert.equal(app.requests[1].options.headers['X-Rubber-Session'],'grower-token');
  app.requests[0].respond({private:'manager-only'});
  app.requests[1].respond({plot:'grower-plot'});
  await oldRejected;
  assert.deepEqual(await grower,{plot:'grower-plot'});
});

test('an expired old request cannot sign out a newly selected identity',async()=>{
  for(const method of ['read','post','put']) {
    const app=fixture(),request=app.api[method]('/api/assistant/sessions',{});
    const rejected=assert.rejects(request);
    app.setToken('grower-token');
    app.requests[0].respond({error:{message:'expired'}},401);
    await rejected;
    assert.deepEqual(app.events,[]);
    const current=app.api.read('/api/auth/me'),currentRejected=assert.rejects(current);
    app.requests[1].respond({error:{message:'expired'}},401);
    await currentRejected;
    assert.deepEqual(app.events,['login-required']);
  }
});

test('successful responses from an earlier account are discarded for both reads and submissions',async()=>{
  for(const method of ['read','post','put']) {
    const app=fixture(),request=app.api[method]('/api/assistant/sessions',{});
    const rejected=assert.rejects(request,/身份已变更/);
    app.setToken('grower-token');
    app.requests[0].respond({account:'manager',answer:'manager-only'});
    await rejected;
  }
});

test('the read hook hides previously loaded data immediately when identity changes',async()=>{
  const app=fixture();
  assert.equal(app.render().data,undefined);
  app.requests[0].respond({answer:'manager-only'});
  await settle();
  assert.equal(app.render().data.answer,'manager-only');
  app.setToken('grower-token');
  assert.equal(app.render().data,undefined);
  app.requests[1].respond({answer:'grower-plot-only'});
  await settle();
  assert.equal(app.render().data.answer,'grower-plot-only');
});
