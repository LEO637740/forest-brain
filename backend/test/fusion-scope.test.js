import test from 'node:test';
import assert from 'node:assert/strict';
import {parks} from '../../shared/parkCatalog.ts';
import {resolveTreeIdentity,treeDisplayLabel} from '../../shared/treeIdentity.ts';
import {resolveAssistantScope} from '../src/assistant-scope.js';

test('all 2000 tree labels round-trip within their own park',()=>{
  for(const park of Object.values(parks))for(let index=0;index<200;index++){
    const label=treeDisplayLabel(index,park.key);
    assert.equal(resolveTreeIdentity(park.siteId,label)?.index,index);
    assert.equal(resolveTreeIdentity(park.siteId,`T-${String(index+1).padStart(4,'0')}`)?.label,label);
  }
  assert.equal(resolveTreeIdentity('demo-hainan','HN-B-0024').treeId,'T-0074');
  assert.equal(resolveTreeIdentity('demo-xsbn','HN-B-0024'),null);
  for(const invalid of ['T-0000','T-0201','HN-A-0051','HN-A-0000'])assert.equal(resolveTreeIdentity('demo-hainan',invalid),null);
});
const resolve=(message,input={},plot=null)=>resolveAssistantScope({message,siteId:'demo-hainan',input,
  session:{zone:'A',treeId:'T-0017'},plot});
test('browsing selection resolves pronouns but never constrains a new park question',()=>{
  const browsing={treeId:'T-0074',zone:'B'};
  assert.equal(resolve('这棵树为什么要复核？',{browsing}).treeId,'T-0074');
  assert.equal(resolve('最近园区产量怎么样',{browsing}).treeId,null);
  assert.equal(resolve('最近园区产量怎么样',{browsing}).zone,null);
  assert.equal(resolve('本周库存怎么样',{browsing}).treeId,null);
  assert.equal(resolve('查看 HN-B-0024 的树表记录',{browsing}).treeId,'T-0074');
  assert.equal(resolve('那它的树表记录呢').treeId,'T-0017');
  assert.equal(resolve('C区最近情况',{browsing}).zone,'C');
  assert.throws(()=>resolve('查看 XS-B-0024'),/不属于当前园区/);
});
test('explicit comparisons preserve both objects and cannot bypass grower permissions',()=>{
  assert.deepEqual(resolve('比较 HN-B-0024 和 HN-B-0025').queryTrees,['T-0074','T-0075']);
  const plot={zone:'B',treeIds:['T-0074']};
  assert.throws(()=>resolve('比较 HN-B-0024 和 HN-B-0025',{},plot),/不在你的承包范围/);
  assert.equal(resolve('全园产量',{},plot).zone,'B');
});
