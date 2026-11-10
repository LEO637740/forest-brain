import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.js';
import {SimulationService} from '../src/simulation.js';
import {isBuiltInDemoTask,seedDemoTasks} from '../src/adapters/demo-tasks.js';

// This local preparation only writes task snapshots; it starts no services or model runs.
const dbPath = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)),'../var/brain.sqlite');
const store = new Store(dbPath), now = new Date();
try {
  const simulation = new SimulationService(store,()=>now);
  const updated = seedDemoTasks(simulation,now);
  const tasks = simulation.latestTasks().filter(isBuiltInDemoTask);
  console.log(JSON.stringify({updated,tasks:tasks.length,linked:tasks.filter(task=>task.demoStrategy).length,
    receipts:tasks.reduce((sum,task)=>sum+(task.demoReceipts?.length ?? 0),0),dbPath},null,2));
} finally {
  store.close();
}
