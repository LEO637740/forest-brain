import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {AssistantMemory,explicitPreference,marketParameters} from '../src/assistant-memory.js';

const siteId = 'demo-guangdong-maoming';
const session = {siteId,role:'manager'};
const clock = ()=>new Date('2026-10-20T02:00:00Z');

test('market quantities preserve kilograms and convert tonnes before saving parameters',()=>{
  assert.deepEqual(marketParameters('假设库存1吨，冻结库存0.2吨，仓容1.5吨，每天运力0.03吨，每周最多2次'),
    {stockKg:1000,heldKg:200,storageKg:1500,transportKgPerDay:30,careLimit:2});
  assert.deepEqual(marketParameters('库存650公斤，冻结库存0kg，每天运力20千克'),
    {stockKg:650,heldKg:0,transportKgPerDay:20});
});

test('explicit preference updates one topic and stays scoped to its park and demo role',()=>{
  const store = new Store(),memory = new AssistantMemory(store,clock);
  try {
    const first = memory.rememberPreference(session,'记住，本园每天运力20公斤','turn-first');
    const next = memory.rememberPreference(session,'把我的偏好改为每天运力30公斤','turn-next');
    assert.equal(first.id,next.id);
    assert.equal(next.content,'每天运力30公斤');
    assert.deepEqual(next.sourceRefs,['turn:turn-next']);
    assert.equal(memory.list(session).filter(item=>item.scope==='role').length,1);
    assert.equal(memory.list({siteId,role:'grower'}).filter(item=>item.scope==='role').length,0);
    assert.equal(memory.list({siteId:'demo-xsbn',role:'manager'}).filter(item=>item.scope==='role').length,0);
    assert.equal(memory.list({siteId,role:'grower'}).filter(item=>item.scope==='shared').length,3);
    assert.equal(memory.list({...session,query:'运力'})[0].content,'每天运力30公斤');
  } finally {store.close();}
});

test('ordinary requests and a model claim do not become preferences',()=>{
  const store = new Store(),memory = new AssistantMemory(store,clock);
  try {
    assert.equal(explicitPreference('今天需要怎么安排？'),null);
    assert.equal(explicitPreference('不要记住这个临时方案'),null);
    assert.equal(explicitPreference('按记住的运力做经营测算'),null);
    assert.throws(()=>memory.rememberPreference(session,'预计今天会丰产','turn-first'),error=>error.code==='MEMORY_INSTRUCTION_REQUIRED');
    assert.equal(memory.list(session).filter(item=>item.scope==='role').length,0);
  } finally {store.close();}
});

test('editing preference text replaces its structured numbers and removes deleted conditions',()=>{
  const store = new Store(),memory = new AssistantMemory(store,clock);
  try {
    const original = memory.rememberPreference(session,'记住每天运力20公斤，仓容1200公斤','turn-original');
    const edited = memory.edit(original.id,{content:'每天运力30公斤'},null);
    assert.deepEqual(edited.marketParams,{transportKgPerDay:30});
    assert.equal(edited.history[0].content,original.content);
    const textOnly = memory.edit(original.id,{content:'以后优先分批销售'},null);
    assert.deepEqual(textOnly.marketParams,{});
    const next = memory.rememberPreference(session,'记住仓容1500公斤','turn-next');
    assert.deepEqual(next.marketParams,{storageKg:1500});
    assert.doesNotMatch(next.content,/运力|1200/);
  } finally {store.close();}
});

test('independent market preferences merge with legacy sales memory and update only supplied conditions',()=>{
  const store = new Store(),memory = new AssistantMemory(store,clock);
  try {
    memory.save({id:'legacy-sales',...session,scope:'role',topic:'sales',title:'演示角色偏好 · 经营',
      content:'每天运力20公斤',sourceRefs:['turn:legacy']});
    const warehouse = memory.rememberPreference(session,'记住仓容1200公斤','turn-warehouse');
    assert.equal(warehouse.id,'legacy-sales');
    assert.deepEqual(warehouse.marketParams,{transportKgPerDay:20,storageKg:1200});
    assert.match(warehouse.content,/运力20公斤/);
    assert.match(warehouse.content,/仓容1200公斤/);
    assert.deepEqual(warehouse.sourceRefs,['turn:legacy','turn:turn-warehouse']);
    const update = memory.rememberPreference(session,'记住仓容1500公斤，库存650公斤','turn-update');
    assert.deepEqual(update.marketParams,{transportKgPerDay:20,storageKg:1500,stockKg:650});
    assert.match(update.content,/运力20公斤/);
    assert.match(update.content,/仓容1500公斤/);
    assert.doesNotMatch(update.content,/1200/);
    assert.equal(memory.list(session).filter(item=>item.scope==='role').length,1);
  } finally {store.close();}
});

test('park experience records terminal execution facts and is shared across demo roles',()=>{
  const store = new Store(),memory = new AssistantMemory(store,clock);
  try {
    const task = {taskId:'task-a',title:'B区任务',date:'2026-10-20',zone:'B',status:'执行中',
      done:17,count:36,completedReceipts:17,cancelledReceipts:0,lastEvent:'进行中',sourceRefs:['receipt-1']};
    assert.equal(memory.rememberExecution(siteId,task),null);
    memory.rememberExecution(siteId,{...task,status:'已取消',cancelledReceipts:19,lastEvent:'取消剩余作业'});
    const rows = memory.list({siteId,role:'grower'});
    assert.equal(rows.filter(item=>item.scope==='park').length,1);
    assert.match(rows.find(item=>item.scope==='park').content,/17\/36/);
    assert.match(rows.find(item=>item.scope==='park').content,/取消回执 19/);
    assert.equal(memory.list({siteId:'demo-hainan',role:'manager'}).filter(item=>item.scope==='park').length,0);
  } finally {store.close();}
});
