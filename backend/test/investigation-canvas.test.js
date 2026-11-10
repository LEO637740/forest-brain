import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {makeParkContext} from '../src/adapters/park-demo.js';
import {seedDemoTasks} from '../src/adapters/demo-tasks.js';
import {BusinessAssistantService} from '../src/assistant-service.js';
import {Identity,ACCOUNTS} from '../src/identity.js';
import {modelInvestigation} from '../src/investigation-canvas.js';

function setup(model=null) {
  const clock=()=>new Date('2026-10-26T02:00:00Z'),store=new Store(),simulation=new SimulationService(store,clock,{contextFactory:makeParkContext});
  seedDemoTasks(simulation,clock());
  const options={store,simulation,makeParkContext,clock,model},service=new BusinessAssistantService(options);
  const identity=new Identity(ACCOUNTS.find(item=>item.accountId==='manager-hn'));
  const session=service.createSession({siteId:'demo-hainan'},identity);
  return {store,simulation,service,identity,session,options,
    async send(message,mode='demo'){const turn=service.submitTurn(session.sessionId,{message,mode},identity);await service.queue;return service.getTurn(session.sessionId,turn.turnId,identity);},
    async close(){await service.stop();store.close();}};
}
const draftFor=graph=>({revision:0,nodes:graph.nodes.map((node,i)=>({id:node.id,x:24+i*280,y:24,width:250,height:145,text:node.text})),edges:[]});

test('offline investigation edits persist without changing original evidence or conversation messages',async()=>{
  const app=setup();
  try {
    const turn=await app.send('查看今天的任务和天气，整理成调查图');
    assert.equal(turn.status,'completed',turn.error);
    assert.equal(turn.investigation.origin,'records');
    assert.ok(turn.investigation.nodes.every(node=>node.evidenceIds.every(id=>turn.evidence.some(item=>item.id===id))));
    const messages=app.store.db.prepare('SELECT messages FROM assistant_turns WHERE id=?').get(turn.turnId).messages;
    const draft=draftFor(turn.investigation);draft.nodes[0].text='人工整理的核查线索';
    draft.edges=[{from:draft.nodes[0].id,to:draft.nodes[1].id,fromPort:'right',toPort:'left'}];
    const first=app.service.saveCanvas(app.session.sessionId,turn.turnId,draft,app.identity);
    assert.equal(first.revision,1);
    assert.throws(()=>app.service.saveCanvas(app.session.sessionId,turn.turnId,draft,app.identity),{code:'CANVAS_CONFLICT'});
    const restored=new BusinessAssistantService(app.options);
    assert.deepEqual(restored.getCanvas(app.session.sessionId,turn.turnId,app.identity).canvas,first);
    assert.equal(restored.canvasHistory(app.session.sessionId,turn.turnId,app.identity).items.length,1);
    const saved=restored.getTurn(app.session.sessionId,turn.turnId,app.identity);
    assert.deepEqual(saved.investigation,turn.investigation);
    assert.deepEqual(saved.evidence,turn.evidence);
    assert.equal(app.store.db.prepare('SELECT messages FROM assistant_turns WHERE id=?').get(turn.turnId).messages,messages);
    const other=new Identity(ACCOUNTS.find(item=>item.accountId==='operator-hn'));
    assert.throws(()=>restored.getCanvas(app.session.sessionId,turn.turnId,other),{code:'SESSION_NOT_FOUND'});
    assert.throws(()=>restored.saveCanvas(app.session.sessionId,turn.turnId,{...first,nodes:first.nodes.map(node=>({...node,evidenceIds:['fake']}))},app.identity),{code:'INVALID_CANVAS'});
    await restored.stop();
  } finally {await app.close();}
});

test('configured assistant can organize freshly queried evidence through the existing tool loop',async()=>{
  let count=0;
  const model={async complete({messages,tools}){
    assert.ok(tools.some(item=>item.function.name==='investigation_graph'));
    if(++count===1)return {toolCalls:[{id:'tasks',name:'read_tasks',arguments:{}}]};
    if(count===2){
      const evidence=JSON.parse(messages.findLast(item=>item.role==='tool').content).evidenceId;
      return {toolCalls:[{id:'graph',name:'investigation_graph',arguments:{title:'作业核查',layout:'flow',nodes:[
        {id:'record',kind:'fact',text:'已查询当前任务记录',evidenceIds:[evidence]},
        {id:'next',kind:'next',text:'打开任务查看未完成作业',evidenceIds:[evidence]},
      ],edges:[{from:'record',to:'next'}]}}]};
    }
    return {content:'结论：已按任务记录整理核查图。\n下一步：打开关联任务。'};
  }};
  const app=setup(model);
  try {
    const turn=await app.send('把任务整理成调查图','configured');
    assert.equal(turn.status,'completed',turn.error);
    assert.equal(turn.investigation.origin,'model');assert.equal(turn.investigation.title,'作业核查');
    assert.ok(turn.actions.some(action=>action.type==='task'));
    assert.throws(()=>modelInvestigation({title:'伪造',nodes:[{id:'a',kind:'fact',text:'无依据',evidenceIds:['not-found']},{id:'b',kind:'next',text:'核查',evidenceIds:['not-found']}],edges:[]},turn.evidence,new Date()),{code:'INVALID_GRAPH'});
  } finally {await app.close();}
});

test('single-tree observation creates existing strategy and review navigation without dispatching work',async()=>{
  const app=setup();
  try {
    const before=JSON.stringify(app.simulation.latestTasks());
    const turn=await app.send('查看 T-0001 树表记录，补拍核查这棵树');
    assert.equal(turn.status,'completed',turn.error);
    assert.ok(turn.actions.some(action=>action.type==='review'&&action.treeId==='T-0001'&&action.kind==='capture'));
    assert.ok(turn.actions.some(action=>action.type==='tree_strategy'&&action.treeId==='T-0001'));
    assert.equal(JSON.stringify(app.simulation.latestTasks()),before);
    const grower=new Identity(ACCOUNTS.find(item=>item.accountId==='grower-hn-wang'));
    const session=app.service.createSession({siteId:'demo-hainan'},grower);
    assert.throws(()=>app.service.toolkit.execute('read_tree_observations',{treeId:'T-0001'},{session,turn:{zone:'B',treeId:null},identity:grower}),{code:'FORBIDDEN_TREE'});
  } finally {await app.close();}
});
