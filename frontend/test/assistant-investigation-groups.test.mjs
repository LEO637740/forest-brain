import test from 'node:test';
import assert from 'node:assert/strict';
import {initialCanvas} from '../src/workspace/investigation/investigationLayout.ts';
test('comparison uses model business groups, not semantic node types',()=>{
 const g={title:'Compare',layout:'comparison',nodes:[{id:'a',group:'Tree 1',kind:'fact',text:'A',evidenceIds:['E1']},{id:'b',group:'Tree 2',kind:'fact',text:'B',evidenceIds:['E1']},{id:'c',group:'Tree 1',kind:'gap',text:'C',evidenceIds:['E1']}],edges:[]};const c=initialCanvas(g);assert.equal(c.nodes[0].x,c.nodes[2].x);assert.notEqual(c.nodes[0].x,c.nodes[1].x);assert.ok(c.nodes[2].y>c.nodes[0].y);
});
