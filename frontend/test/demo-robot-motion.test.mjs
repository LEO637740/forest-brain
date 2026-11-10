import test from 'node:test';
import assert from 'node:assert/strict';
import {demoRobotMotions} from '../src/workspace/demoRobotMotion.ts';
const task={id:'demo-a',site:'hainan',kind:'割胶',block:'A',status:'执行中',count:3,done:1,treeIndices:[0,1,2],dispatch:{phase:'running',history:[],auto:{startedAt:1000,nextAt:4000,stage:'travel'}}};
test('scene derives target, travel and cut pose from the same task clock without advancing it',()=>{
 const before=JSON.stringify(task),m=demoRobotMotions([task],2500)[0];
 assert.equal(m.treeIndex,1);assert.equal(m.previousTree,0);assert.equal(m.progress,.5);assert.equal(m.done,1);assert.equal(JSON.stringify(task),before);
 const work={...task,dispatch:{...task.dispatch,auto:{startedAt:4000,nextAt:6500,stage:'work'}}};
 assert.equal(demoRobotMotions([work],5250)[0].progress,.5);
 assert.equal(demoRobotMotions([work],5250)[0].stage,'work');
});
test('held clock freezes scene and closed task retains final tree with arm retracted',()=>{
 const held={...task,dispatch:{...task.dispatch,auto:{...task.dispatch.auto,eventHeldAt:2500}}};
 assert.equal(demoRobotMotions([held],9000,()=>true)[0].progress,.5);
 const done={...task,status:'已完成',done:3,dispatch:{...task.dispatch,phase:'completed'}};
 const m=demoRobotMotions([done],9000)[0];assert.equal(m.treeIndex,2);assert.equal(m.progress,1);assert.equal(m.done,3);
});
