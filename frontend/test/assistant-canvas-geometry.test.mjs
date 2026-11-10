import test from 'node:test';
import assert from 'node:assert/strict';
import {fitBounds,routeEdge,nearestPorts} from '../src/workspace/investigation/canvasGeometry.ts';
const n=(id,x,y,width=250,height=145)=>({id,x,y,width,height,text:''});
test('fit centers actual translated content bounds horizontally and vertically',()=>{
 const nodes=[n('a',1000,800),n('b',1500,1200)],v=fitBounds(nodes,1200,650);
 assert.ok(Math.abs((1000+1750)/2*v.zoom+v.x-600)<.001);
 assert.ok(Math.abs((800+1345)/2*v.zoom+v.y-325)<.001);
 assert.ok(1000*v.zoom+v.x>=35);assert.ok(1345*v.zoom+v.y<=615);
});
test('routing detours around an obstructing node rather than drawing through it',()=>{
 const nodes=[n('a',40,150),n('block',350,100),n('b',700,150)];
 const r=routeEdge(nodes,{from:'a',to:'b',fromPort:'right',toPort:'left'});
 assert.equal(r.blocked,false);assert.ok(r.points.length>4);
 for(let i=1;i<r.points.length;i++){const p=r.points[i-1],q=r.points[i];assert.ok(p.x===q.x||p.y===q.y);for(const b of nodes){const crosses=p.x===q.x?p.x>b.x&&p.x<b.x+b.width&&Math.max(p.y,q.y)>b.y&&Math.min(p.y,q.y)<b.y+b.height:p.y>b.y&&p.y<b.y+b.height&&Math.max(p.x,q.x)>b.x&&Math.min(p.x,q.x)<b.x+b.width;assert.equal(crosses,false,'intersect '+b.id)}}
});
test('port choice reflects vertical/horizontal spatial relationship',()=>{
 assert.deepEqual(nearestPorts(n('a',0,0),n('b',0,400)),{fromPort:'bottom',toPort:'top'});
 assert.deepEqual(nearestPorts(n('a',700,0),n('b',0,0)),{fromPort:'left',toPort:'right'});
});
test('overlapping nodes produce an explicit blocked status',()=>{
 assert.equal(routeEdge([n('a',0,0),n('b',20,0)],{from:'a',to:'b',fromPort:'right',toPort:'left'}).blocked,true);
});
