import test from 'node:test';
import assert from 'node:assert/strict';
import {taskExecutionWindow,taskExecutionBlock,mergeExecutionWindow} from '../src/workspace/taskExecutionWindow.ts';

const task={kind:'割胶',date:'2026-10-30',start:'06:30',end:'07:52',sourceParkPlanId:'plan-a'};
const start=Date.parse('2026-10-30T06:30:00+08:00'),end=Date.parse('2026-10-30T07:52:00+08:00');

test('task schedule uses China business time and blocks both early and expired plan execution',()=>{
 assert.deepEqual(taskExecutionWindow(task),{notBefore:start,notAfter:end});
 assert.match(taskExecutionBlock(task,start-1),/不能提前执行/);
 assert.equal(taskExecutionBlock(task,start),undefined);
 assert.equal(taskExecutionBlock(task,end-1),undefined);
 assert.match(taskExecutionBlock(task,end),/窗口已结束/);
});

test('legacy undated or open-ended schedules remain compatible and ordinary end is not a plan expiry',()=>{
 assert.deepEqual(taskExecutionWindow({...task,date:undefined}),{});
 assert.deepEqual(taskExecutionWindow({...task,end:'—'}),{notBefore:start});
 assert.equal(taskExecutionBlock({...task,end:'—'},end+60000),undefined);
 assert.deepEqual(taskExecutionWindow({...task,sourceParkPlanId:undefined}),{notBefore:start});
 assert.equal(taskExecutionBlock({...task,sourceParkPlanId:undefined},end+60000),undefined);
 assert.deepEqual(taskExecutionWindow({...task,kind:'集胶'}),{});
});

test('fresh weather narrows a task window without discarding or extending its schedule',()=>{
 const planned=taskExecutionWindow(task);
 assert.deepEqual(mergeExecutionWindow({weatherBlock:''},planned),{weatherBlock:'',notBefore:start,notAfter:end});
 assert.deepEqual(mergeExecutionWindow({notBefore:start-60000,notAfter:end+60000},planned),planned);
 assert.deepEqual(mergeExecutionWindow({notBefore:start+60000,notAfter:end-60000},planned),{notBefore:start+60000,notAfter:end-60000});
});
