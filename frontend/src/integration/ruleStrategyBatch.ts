import type {TreeKind} from './modelGenerationFlow';

// On-demand rule strategies for parks the launcher does not prepare (it keeps only Haikou
// fresh). Rules only, never a model call. Batches stay within the backend's ten-tree prepare
// limit and each one settles before the next, so the run queue never overflows.
export const RULE_STRATEGY_KINDS:TreeKind[]=['tapping_angle','surface_action','growth_plan','pest_risk'];
type Preparation={items:{treeId:string;runId:string;status:string;preservedConfigured?:boolean}[]};
type Run={status:string};
export type RuleBatchDeps={
  post:(path:string,input:unknown)=>Promise<Preparation>;
  read:(path:string)=>Promise<Run>;
  sleep?:(milliseconds:number)=>Promise<void>;
  newId?:()=>string;
  onProgress?:(done:number,total:number)=>void;
};
export type RuleBatchResult={runs:number;succeeded:number;unsettled:number;other:number};

export async function prepareRuleStrategies(siteId:string,treeIds:string[],deps:RuleBatchDeps,kinds=RULE_STRATEGY_KINDS):Promise<RuleBatchResult>{
  const sleep=deps.sleep??(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
  const newId=deps.newId??(()=>crypto.randomUUID());
  const batches=kinds.flatMap(kind=>Array.from({length:Math.ceil(treeIds.length/10)},(_,index)=>({kind,treeIds:treeIds.slice(index*10,index*10+10)})));
  const result:RuleBatchResult={runs:0,succeeded:0,unsettled:0,other:0};
  for(const [index,batch] of batches.entries()){
    const prepared=await deps.post('/api/demo/trees/prepare',{preparationId:`rules-${newId()}`,treeIds:batch.treeIds,kind:batch.kind,
      dataMode:'mixed_demo',generatorMode:'demo_rules',preserveConfigured:true,siteId});
    for(const item of prepared.items){
      if(item.preservedConfigured)continue;
      result.runs++;
      let status=item.status;
      for(let attempt=0;['queued','running'].includes(status)&&attempt<100;attempt++){await sleep(100);status=(await deps.read(`/internal/harness/runs/${item.runId}`)).status;}
      if(status==='succeeded')result.succeeded++;else if(['queued','running'].includes(status))result.unsettled++;else result.other++;
    }
    deps.onProgress?.(index+1,batches.length);
  }
  return result;
}
