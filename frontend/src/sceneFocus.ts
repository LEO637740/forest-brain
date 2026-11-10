/** Scene indices remain stable across parks; an account may only inspect a subset. */
export function zoneFocusCenter(trees:{x:number;z:number}[],zone:number,selectableTrees?:number[]){
 if(!Number.isInteger(zone)||zone<0||zone>3)return null;
 const allowed=selectableTrees?new Set(selectableTrees):null;
 const group=trees.slice(zone*50,zone*50+50).filter((_,offset)=>!allowed||allowed.has(zone*50+offset));
 if(!group.length)return null;
 return {x:group.reduce((sum,tree)=>sum+tree.x,0)/group.length,z:group.reduce((sum,tree)=>sum+tree.z,0)/group.length};
}

export function selectedSceneTrees(total:number,selected:number|null,batch:number[]|undefined,selectableTrees?:number[]){
 const allowed=selectableTrees?new Set(selectableTrees):null;
 const available=(index:number)=>Number.isInteger(index)&&index>=0&&index<total&&(!allowed||allowed.has(index));
 return {selected:selected!==null&&available(selected)?selected:null,batch:new Set((batch??[]).filter(available))};
}
