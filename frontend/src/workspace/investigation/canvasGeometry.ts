import {endpoint,type CanvasNode,type CanvasEdge,type Port} from './investigationLayout.ts';
type Point={x:number;y:number};
export function fitBounds(nodes:CanvasNode[],w:number,h:number){
 const left=Math.min(...nodes.map(n=>n.x)),top=Math.min(...nodes.map(n=>n.y));
 const width=Math.max(...nodes.map(n=>n.x+n.width))-left,height=Math.max(...nodes.map(n=>n.y+n.height))-top;
 const zoom=Math.max(.08,Math.min(1,(w-72)/width,(h-72)/height));
 return {zoom,x:(w-width*zoom)/2-left*zoom,y:(h-height*zoom)/2-top*zoom};
}
export function nearestPorts(a:CanvasNode,b:CanvasNode):{fromPort:Port;toPort:Port}{
 const dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;
 return Math.abs(dx)/((a.width+b.width)/2)>Math.abs(dy)/((a.height+b.height)/2)?{fromPort:dx>0?'right':'left',toPort:dx>0?'left':'right'}:{fromPort:dy>0?'bottom':'top',toPort:dy>0?'top':'bottom'};
}
const offset=(p:Point,port:Port):Point=>({x:p.x+(port==='right'?22:port==='left'?-22:0),y:p.y+(port==='bottom'?22:port==='top'?-22:0)});
export function routeEdge(nodes:CanvasNode[],edge:CanvasEdge):{points:Point[];blocked:boolean}{
 const a=endpoint(nodes.find(n=>n.id===edge.from)!,edge.fromPort),b=endpoint(nodes.find(n=>n.id===edge.to)!,edge.toPort),s=offset(a,edge.fromPort),t=offset(b,edge.toPort);
 const boxes=nodes.map(n=>({l:n.x-10,r:n.x+n.width+10,t:n.y-10,b:n.y+n.height+10}));
 const xs=[...new Set([s.x,t.x,...boxes.flatMap(r=>[r.l-1,r.r+1])])].sort((a,b)=>a-b),ys=[...new Set([s.y,t.y,...boxes.flatMap(r=>[r.t-1,r.b+1])])].sort((a,b)=>a-b);
 const clear=(p:Point,q:Point)=>!boxes.some(r=>p.x===q.x?p.x>r.l&&p.x<r.r&&Math.max(p.y,q.y)>r.t&&Math.min(p.y,q.y)<r.b:p.y>r.t&&p.y<r.b&&Math.max(p.x,q.x)>r.l&&Math.min(p.x,q.x)<r.r);
 // Orthogonal visibility grid; A* cost includes bends to avoid zigzags.
 type Entry={x:number;y:number;dir:number;cost:number;score:number;key:string};
 const heap:Entry[]=[];
 const push=(v:Entry)=>{heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].score<=v.score)break;heap[i]=heap[p];i=p;}heap[i]=v;};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
 const start={x:xs.indexOf(s.x),y:ys.indexOf(s.y),dir:0,cost:0,score:0,key:'start'};
 push(start);const dist=new Map<string,number>([['start',0]]),prev=new Map<string,string>(),states=new Map<string,Entry>([['start',start]]);let end:string|undefined;
 while(heap.length){const u=pop();if(u.cost!==dist.get(u.key))continue;if(xs[u.x]===t.x&&ys[u.y]===t.y){end=u.key;break;}
  for(const [dx,dy,dir] of [[1,0,1],[-1,0,1],[0,1,2],[0,-1,2]]){const x=u.x+dx,y=u.y+dy;if(x<0||y<0||x>=xs.length||y>=ys.length)continue;const p={x:xs[u.x],y:ys[u.y]},q={x:xs[x],y:ys[y]};if(!clear(p,q))continue;const cost=u.cost+Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+(u.dir&&u.dir!==dir?32:0),key=`${x},${y},${dir}`;if(cost>=(dist.get(key)??Infinity))continue;const v={x,y,dir,cost,score:cost+Math.abs(q.x-t.x)+Math.abs(q.y-t.y),key};dist.set(key,cost);prev.set(key,u.key);states.set(key,v);push(v);}
 }
 if(!end)return {points:[a,s,t,b],blocked:true};
 const path:Point[]=[];for(let k:string|undefined=end;k;k=prev.get(k)){const n=states.get(k)!;path.unshift({x:xs[n.x],y:ys[n.y]});}
 const points=[a,...path,b].filter((p,i,all)=>i===0||i===all.length-1||!((all[i-1].x===p.x&&p.x===all[i+1].x)||(all[i-1].y===p.y&&p.y===all[i+1].y)));
 return {points,blocked:false};
}
