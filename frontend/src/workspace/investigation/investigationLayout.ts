import {nearestPorts} from './canvasGeometry.ts';
export type GraphNode={id:string;group?:string;kind:'fact'|'hypothesis'|'gap'|'next';text:string;evidenceIds:string[]};
export type Investigation={origin?:'model'|'records';title:string;nodes:GraphNode[];edges:{from:string;to:string}[];boundary:string;layout?:'flow'|'radial'|'comparison';organizationNote?:string;generatedAt?:string};
export type Port='left'|'right'|'top'|'bottom';
export type CanvasNode={id:string;x:number;y:number;width:number;height:number;text:string};
export type CanvasEdge={from:string;to:string;fromPort:Port;toPort:Port};
export type Canvas={revision:number;nodes:CanvasNode[];edges:CanvasEdge[];savedAt?:string;author?:string};
export function initialCanvas(g:Investigation):Canvas{
 const ids=g.nodes.map(n=>n.id),levels=new Map(ids.map(id=>[id,0]));
 const indegree=new Map(ids.map(id=>[id,g.edges.filter(e=>e.to===id).length]));
 const queue=ids.filter(id=>!indegree.get(id));let visited=0;
 while(queue.length){const id=queue.shift()!;visited++;for(const e of g.edges.filter(e=>e.from===id)){levels.set(e.to,Math.max(levels.get(e.to)!,levels.get(id)!+1));indegree.set(e.to,indegree.get(e.to)!-1);if(!indegree.get(e.to))queue.push(e.to);}}
 const radial=g.layout==='radial'||visited<ids.length;
 const counts=new Map<number,number>();
 const groups=[...new Set(g.nodes.map(n=>n.group??'未分组'))];
 const comparisonColumns=Math.min(3,Math.max(2,ids.filter(id=>!g.edges.some(e=>e.to===id)).length));
 let radiusX=Math.max(550,ids.length*55),radiusY=Math.max(250,ids.length*24);
 const root=[...ids].sort((a,b)=>g.edges.filter(e=>e.from===b).length-g.edges.filter(e=>e.from===a).length)[0];
 const others=ids.filter(id=>id!==root);
 const polar=(id:string)=>{const a=others.indexOf(id)/Math.max(1,others.length)*Math.PI*2;return {x:radiusX+30+(id===root?0:Math.cos(a)*radiusX),y:radiusY+30+(id===root?0:Math.sin(a)*radiusY)}};
 for(let attempt=0;attempt<16;attempt++){const p=ids.map(polar);if(!p.some((a,i)=>p.some((b,j)=>i!==j&&Math.abs(a.x-b.x)<275&&Math.abs(a.y-b.y)<170)))break;radiusX*=1.1;radiusY*=1.1;}
 const nodes=g.nodes.map(n=>{let x:number,y:number;
 if(radial){const point=polar(n.id);x=point.x;y=point.y;}
 else if(g.layout==='comparison'&&groups.length>1){const col=groups.indexOf(n.group??'未分组');x=24+col*300;y=24+g.nodes.filter(a=>(a.group??'未分组')===(n.group??'未分组')).findIndex(a=>a.id===n.id)*190;}
 else if(g.layout==='comparison'){const col=ids.indexOf(n.id)%comparisonColumns;x=24+col*300;y=24+Math.floor(ids.indexOf(n.id)/comparisonColumns)*190;}
 else{const level=levels.get(n.id)!,row=counts.get(level)??0;counts.set(level,row+1);x=24+level*300;y=24+row*190;}
 return {id:n.id,x:Math.round(x),y:Math.round(y),width:250,height:145,text:n.text};});
 return {revision:0,nodes,edges:g.edges.map(e=>({...e,...nearestPorts(nodes.find(n=>n.id===e.from)!,nodes.find(n=>n.id===e.to)!)}))};
}
export function endpoint(n:CanvasNode,p:Port){return {x:n.x+(p==='left'?0:p==='right'?n.width:n.width/2),y:n.y+(p==='top'?0:p==='bottom'?n.height:n.height/2)};}
