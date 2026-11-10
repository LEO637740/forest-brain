import test from 'node:test';
import assert from 'node:assert/strict';
import {zoneFocusCenter,selectedSceneTrees} from '../src/sceneFocus.ts';

const trees=Array.from({length:200},(_,index)=>({x:index,z:index*2}));
test('each zone focuses its own fifty scene positions without renumbering',()=>{
 assert.deepEqual(zoneFocusCenter(trees,0),{x:24.5,z:49});
 assert.deepEqual(zoneFocusCenter(trees,2),{x:124.5,z:249});
});
test('plot scope determines the focus center and an inaccessible zone has no target',()=>{
 assert.deepEqual(zoneFocusCenter(trees,1,[50,51,150]),{x:50.5,z:101});
 assert.equal(zoneFocusCenter(trees,2,[50,51,150]),null);
 assert.equal(zoneFocusCenter(trees,0,[]),null);
 for(const value of [-1,4,.5,NaN])assert.equal(zoneFocusCenter(trees,value),null);
});
test('current park coordinates are used even when another park uses the same indices',()=>{
 const other=trees.map(tree=>({x:tree.x+1000,z:tree.z-1000}));
 assert.deepEqual(zoneFocusCenter(other,1,[50]),{x:1050,z:-900});
});
test('single and batch highlighting respect the same allowed tree scope as picking',()=>{
 const result=selectedSceneTrees(200,50,[50,50,51,99,200,-1,1.5],[50,99]);
 assert.equal(result.selected,50);
 assert.deepEqual([...result.batch],[50,99]);
 assert.equal(selectedSceneTrees(200,51,undefined,[50]).selected,null);
 assert.deepEqual([...selectedSceneTrees(200,null,[50],[]).batch],[]);
 assert.equal(selectedSceneTrees(200,200,[]).selected,null);
});
