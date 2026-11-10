import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc,parseAst} from 'vite';
import {TaskSyncController} from '../src/workspace/taskSyncController.ts';
import {Store} from '../../backend/src/store.js';
import {SimulationService} from '../../backend/src/simulation.js';

// Use the actual workspace setter with a deferred renderer to reproduce React
// batching: the controller must see a receipt before its render is committed.
const source=readFileSync(new URL('../src/workspace/WorkspaceApp.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'WorkspaceApp.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const component=parseAst(compiled.code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node).find(node=>node?.type==='FunctionDeclaration'&&node.id.name==='WorkspaceApp');
const setter=component.body.body.find(node=>node.type==='VariableDeclaration'&&node.declarations.some(item=>item.id.name==='setSaved'));
assert.ok(setter,'Workspace must expose its shared saved-state setter');
const code=compiled.code.slice(setter.start,setter.end);

test('a completion arriving before React renders survives the pending server acknowledgement',async()=>{
 const store=new Store(':memory:'),service=new SimulationService(store,()=>new Date('2026-10-17T02:00:00Z'));
 try{
  const initial={id:'rail-render-race',site:'hainan',count:1,done:0,status:'待开始',kind:'割胶',treeIndices:[0]};
  const original=service.tasks({tasks:[initial]}).tasks[0];
  const savedRef={current:{tasks:[original],activities:[],decisions:{}}},renderQueue=[];
  const setSaved=new Function('useCallback','savedRef','setSavedState',`${code};return setSaved;`)(fn=>fn,savedRef,value=>renderQueue.push(value));
  let release;
  const controller=new TaskSyncController({
   getTasks:()=>savedRef.current.tasks,applyTasks:tasks=>setSaved(s=>({...s,tasks})),
   readTasks:async()=>service.latestTasks(),persistJournal:()=>{},onState:()=>{},
   writeTasks:tasks=>{const accepted=service.tasks({tasks});return new Promise(resolve=>{release=()=>resolve(accepted);});},
  });
  await controller.refresh(true);
  setSaved(s=>({...s,tasks:[{...s.tasks[0],status:'执行中'}]}));
  const writing=controller.refresh();await new Promise(resolve=>setImmediate(resolve));
  const receipt={index:0,outcome:'completed',finishedAt:'2026-10-17T02:00:10Z',job:{id:initial.id,angle:30}};
  setSaved(s=>({...s,tasks:[{...s.tasks[0],status:'已完成',done:1,railResult:receipt}]}));
  release();await writing;
  assert.equal(savedRef.current.tasks[0].status,'已完成');
  assert.equal(savedRef.current.tasks[0].revision,2);
  assert.deepEqual(savedRef.current.tasks[0].railResult,receipt);
  assert.equal(renderQueue.at(-1).tasks[0].done,1);
  const completing=controller.refresh();await new Promise(resolve=>setImmediate(resolve));release();await completing;
  assert.equal(service.latestTasks()[0].status,'已完成');
  assert.deepEqual(service.latestTasks()[0].railResult,receipt);
  controller.dispose();
 }finally{store.close();}
});
