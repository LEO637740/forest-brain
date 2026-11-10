import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoleView,scopedTasks,treePosition,treeZone} from '../src/workspace/workbenchModel.ts';

test('unknown persisted role falls back without inheriting object prototype members',()=>{
  assert.equal(parseRoleView('operator'),'operator');
  for(const value of [null,'admin','toString','__proto__'])assert.equal(parseRoleView(value),'manager');
});
test('tree IDs stay within the scene mapping and cross zones at the correct boundary',()=>{
  assert.equal(treePosition('T-0001'),0);
  assert.equal(treeZone('T-0050'),'A');
  assert.equal(treeZone('T-0051'),'B');
  assert.equal(treeZone('T-0200'),'D');
  for(const id of ['T-0000','T-0201','HN-A-0001','T-01','T-0012suffix'])assert.equal(treePosition(id),null);
});
test('identical tree/zone labels in different sites cannot leak task counts',()=>{
  const tasks=[{id:'hn',site:'hainan',block:'A'},{id:'xs',site:'xsbn',block:'A'},{id:'xa',site:'xian',block:'B'}];
  assert.deepEqual(scopedTasks(tasks,'hainan','A').map(t=>t.id),['hn']);
  assert.deepEqual(scopedTasks(tasks,'xian','A'),[]);
  assert.equal(scopedTasks(tasks,'all').length,3);
});
