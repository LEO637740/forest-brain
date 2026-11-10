import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {AssistantMemory} from '../src/assistant-memory.js';
import {SkillLibrary} from '../src/assistant-skills.js';
import {ACCOUNTS,Identity} from '../src/identity.js';

const clock=()=>new Date('2026-10-27T04:00:00Z');
const identity=id=>new Identity(ACCOUNTS.find(account=>account.accountId===id));
const grower=identity('grower-hn-wang'),operator=identity('operator-hn'),manager=identity('manager-hn'),center=identity('center-hz');
const scope=(user,siteId='demo-hainan')=>({siteId,role:user.role,accountId:user.accountId,identity:user});
const setup=t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  return {store,memory:new AssistantMemory(store,clock),skills:new SkillLibrary({store,clock})};
};

test('public experience reaches all roles while park facts and personal notes keep their scope',t=>{
  const {memory}=setup(t);
  const park=memory.create({scope:'park',siteId:'demo-hainan',content:'库存业务事实 MARKER_PARK'},manager);
  const shared=memory.create({scope:'shared',content:'跨园经营事实 MARKER_SHARED'},center);
  const own=memory.create({scope:'private',siteId:'demo-hainan',content:'我的提醒'},grower);
  memory.rememberExecution('demo-hainan',{taskId:'outside-plot',title:'A区执行 MARKER_OUTSIDE',date:'2026-10-26',zone:'A',status:'已完成',count:50,done:50,completedReceipts:50,cancelledReceipts:0,sourceRefs:[]});
  for (const user of [grower,operator]) {
    const rows=memory.list(scope(user));
    assert.equal(rows.filter(item=>item.id.startsWith('knowledge-')).length,3);
    assert.doesNotMatch(JSON.stringify(rows),/MARKER_PARK|MARKER_OUTSIDE/);
    assert.deepEqual(memory.list({...scope(user),query:'MARKER'}).map(item=>item.id),[shared.id]);
    assert.equal(rows.some(item=>item.id===own.id),user===grower);
  }
  assert.ok(memory.list(scope(manager)).some(item=>item.id===park.id));
  assert.ok(memory.list(scope(manager)).some(item=>item.id===shared.id));
  assert.ok(memory.list(scope(center)).some(item=>item.id===shared.id));
  const otherManager=identity('manager-xs');
  assert.ok(memory.list(scope(otherManager,'demo-xsbn')).some(item=>item.id===shared.id));
  memory.edit(shared.id,{content:'公开经验修改后 MARKER_SHARED'},center);
  assert.equal(memory.list(scope(otherManager,'demo-xsbn')).find(item=>item.id===shared.id).content,'公开经验修改后 MARKER_SHARED');
  memory.archive(shared.id,center,'经验已过期');
  assert.ok(!memory.list(scope(otherManager,'demo-xsbn')).some(item=>item.id===shared.id));
  assert.throws(()=>memory.list(scope(manager,'demo-xsbn')),error=>error.code==='FORBIDDEN_SITE');
  assert.throws(()=>memory.list({...scope(grower),identity:manager}),error=>error.code==='FORBIDDEN_MEMORY');
  assert.throws(()=>memory.list({...scope(grower),identity:null}),error=>error.code==='LOGIN_REQUIRED');
  assert.ok(!memory.list({siteId:'demo-hainan',role:'manager'}).some(item=>item.id===park.id||item.id===shared.id||item.id===own.id));
});

test('private memories and remembered preferences remain within the same account and park',t=>{
  const {memory}=setup(t);
  const hn=memory.rememberPreference(scope(center),'记住海南的提醒','hn-turn',center);
  const xs=memory.rememberPreference(scope(center,'demo-xsbn'),'记住云南的提醒','xs-turn',center);
  assert.notEqual(hn.id,xs.id);
  assert.ok(memory.list(scope(center)).some(item=>item.id===hn.id));
  assert.ok(!memory.list(scope(center)).some(item=>item.id===xs.id));
  assert.ok(!memory.list(scope(manager)).some(item=>item.id===hn.id));
  assert.throws(()=>memory.create({scope:'private',siteId:'demo-xsbn',content:'越园写入'},manager),error=>error.code==='FORBIDDEN_MEMORY');
  assert.throws(()=>memory.rememberPreference(scope(grower),'记住越权身份','bad-turn',manager),error=>error.code==='FORBIDDEN_MEMORY');
});

test('unclassified historical shared content remains stored but cannot be recalled or exposed by editing',t=>{
  const {memory,store}=setup(t);
  for(const kind of ['park','shared']) {
    const item={id:`legacy-${kind}`,siteId:kind==='park'?'demo-hainan':null,role:'manager',scope:kind,topic:'old',title:'历史敏感记录',content:'UNSCOPED_HISTORICAL_SECRET',sourceRefs:[]};
    memory.save(item);
    for(const user of [grower,operator,manager,center]) {
      assert.ok(!memory.list(scope(user)).some(row=>row.id===item.id));
      assert.throws(()=>memory.edit(item.id,{content:'try'},user),error=>error.code==='FORBIDDEN_MEMORY');
    }
    assert.ok(store.db.prepare('SELECT id FROM assistant_memories WHERE id=?').get(item.id));
  }
});

test('old private model memories are retained but never recalled or merged into a new explicit preference',t=>{
  const {memory,store}=setup(t);
  const old={id:'legacy-private-model',siteId:'demo-hainan',role:'grower',accountId:grower.accountId,scope:'private',topic:'sales',
    title:'旧模型保存内容',content:'全园库存76543公斤 LEGACY_PRIVATE_SECRET',marketParams:{stockKg:76543},sourceRefs:['turn:before-permission-fix'],
    history:[{content:'OTHER_PLOT_HISTORY'}]};
  memory.save(old);
  assert.ok(!memory.list(scope(grower)).some(item=>item.id===old.id));
  assert.deepEqual(memory.list({...scope(grower),query:'LEGACY_PRIVATE_SECRET'}),[]);
  assert.throws(()=>memory.edit(old.id,{content:'update'},grower),error=>error.code==='FORBIDDEN_MEMORY');
  assert.throws(()=>memory.archive(old.id,grower),error=>error.code==='FORBIDDEN_MEMORY');
  const next=memory.rememberPreference(scope(grower),'记住库存2公斤','new-preference',grower);
  assert.notEqual(next.id,old.id);
  assert.deepEqual(next.marketParams,{stockKg:2});
  assert.doesNotMatch(JSON.stringify(memory.list(scope(grower))),/76543|LEGACY_PRIVATE_SECRET|OTHER_PLOT_HISTORY/);
  assert.ok(store.db.prepare('SELECT id FROM assistant_memories WHERE id=?').get(old.id));
});

test('private memory scope is invalidated when the account role or contracted trees change',t=>{
  const {memory}=setup(t);
  const item=memory.create({scope:'private',siteId:'demo-hainan',content:'承包范围内提醒'},grower);
  const smallerPlot=new Identity({...grower.account,plot:{...grower.account.plot,treeIds:grower.plot.treeIds.slice(0,10)}});
  assert.ok(memory.list(scope(grower)).some(row=>row.id===item.id));
  assert.ok(!memory.list(scope(smallerPlot)).some(row=>row.id===item.id));
  const changedRole=new Identity({...grower.account,role:'operator',plot:undefined});
  assert.ok(!memory.list(scope(changedRole)).some(row=>row.id===item.id));
});

test('a knowledge-like identifier or modified built-in row does not make arbitrary stored content public',t=>{
  const {memory}=setup(t);
  memory.save({id:'knowledge-forged',siteId:null,role:null,scope:'shared',topic:'daily_plan',title:'伪造知识',content:'FORGED_SECRET',sourceRefs:[]});
  const original=memory.get('knowledge-daily_plan');
  memory.save({...original,title:'PRIVATE_TITLE_SECRET'});
  assert.doesNotMatch(JSON.stringify(memory.list(scope(grower))),/FORGED_SECRET|PRIVATE_TITLE_SECRET/);
  memory.save({...original,history:[{content:'PRIVATE_HISTORY_SECRET'}],extra:'PRIVATE_EXTRA_SECRET'});
  const rows=memory.list(scope(grower));
  assert.ok(rows.some(row=>row.id===original.id));
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_HISTORY_SECRET|PRIVATE_EXTRA_SECRET/);
});

function learned(skills,user,siteId='demo-hainan',kind='park') {
  const session={sessionId:`session-${user.accountId}`,siteId,accountId:user.accountId,role:user.role};
  const turn={turnId:'turn-source',status:'completed',message:'库存查询',answer:'下一步：查看库存',tools:[{name:'read_sales_inventory',label:'库存事实'}]};
  const draft=skills.draftFromTurn({session,turn,scope:kind,title:'库存经验',triggers:['库存'],instruction:'先读库存；权限内的业务经验。'},user);
  return skills.decide(draft.id,{decision:'approve'},user);
}

test('learned skill instructions, source questions, and historical revisions follow the reader role and park',t=>{
  const {skills}=setup(t);
  const park=learned(skills,manager),shared=learned(skills,center,'demo-hainan','shared');
  const other=learned(skills,identity('manager-xs'),'demo-xsbn');
  for(const user of [grower,operator]) {
    assert.deepEqual(skills.list('demo-hainan',user),[]);
    assert.deepEqual(skills.matching('demo-hainan','库存',user),[]);
  }
  assert.deepEqual(skills.matching('demo-hainan','库存',manager).map(item=>item.id),[park.id]);
  assert.ok(skills.matching('demo-hainan','库存',center).some(item=>item.id===shared.id));
  assert.ok(!skills.list(null,manager).some(item=>item.id===other.id));
  assert.throws(()=>skills.list('demo-xsbn',manager),error=>error.code==='FORBIDDEN_SITE');
  assert.deepEqual(skills.list('demo-hainan'),[]);
  assert.throws(()=>skills.revise(park.id,{instruction:'anonymous edit'}),error=>error.code==='FORBIDDEN');
  assert.throws(()=>skills.decide(park.id,{decision:'archive'}),error=>error.code==='FORBIDDEN');
  assert.throws(()=>learned(skills,manager,'demo-hainan','shared'),error=>error.code==='FORBIDDEN');
  assert.throws(()=>learned(skills,manager,'demo-xsbn'),error=>error.code==='FORBIDDEN_SITE');
});

test('legacy learned skills without a proven data scope never enter signed-in prompts',t=>{
  const {skills,store}=setup(t);
  skills.save({id:'legacy-skill',siteId:'demo-hainan',status:'active',createdAt:clock().toISOString(),triggers:['库存'],instruction:'UNKNOWN_ORIGIN_SECRET',title:'历史经验'});
  for(const user of [grower,operator,manager,center]) {
    assert.deepEqual(skills.matching('demo-hainan','库存',user),[]);
    assert.throws(()=>skills.revise('legacy-skill',{instruction:'try'},user),error=>error.code==='FORBIDDEN');
  }
  assert.ok(store.db.prepare('SELECT id FROM assistant_skills WHERE id=?').get('legacy-skill'));
});
