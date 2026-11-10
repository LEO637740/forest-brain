import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc,parseAst} from 'vite';
import {projectFieldTrees,groupFieldElevations,elevationGroupKey,fieldMapFrame,fieldElevationColor,elevationColors,elevationContours} from '../src/workspace/fieldSpatialModel.ts';
import {treePosition} from '../src/workspace/workbenchModel.ts';

const record=(treeId,patch={})=>({
  recordId:`demo-hainan:${treeId}`,siteId:'demo-hainan',treeId,sourceTreeId:`现场-${treeId}`,
  longitude:110.001,latitude:19.001,elevationM:80,heightM:12,circumferenceCm:60,
  variety:'热研7-33-97',measurementHeightM:1.3,sourceName:'园区现场测量表',
  observedAt:'2026-10-19T01:30:00Z',importedAt:'2026-10-19T02:00:00Z',
  provenanceMode:'measured',coordinateSystem:'WGS84',elevationDatum:'1985国家高程基准',...patch,
});

test('only records with both supplied coordinates enter the point map; zero is a coordinate',()=>{
  const items=[record('T-0001',{longitude:undefined}),record('T-0002',{latitude:null}),record('T-0003',{longitude:0,latitude:0})];
  const result=projectFieldTrees(items);
  assert.equal(result.missingCoordinates,2);
  assert.deepEqual(result.origin,{longitude:0,latitude:0});
  assert.deepEqual(result.points.map(point=>[point.record.treeId,point.xM,point.northM]),[['T-0003',0,0]]);
  assert.equal(projectFieldTrees(items.slice(0,2)),null);
  assert.equal(projectFieldTrees([]),null);
});

test('local projection preserves measured north/east offsets in meters',()=>{
  const points=projectFieldTrees([
    record('T-0001',{longitude:110,latitude:19}),
    record('T-0002',{longitude:110.001,latitude:19}),
    record('T-0003',{longitude:110,latitude:19.001}),
  ]).points;
  const [origin,east,north]=points;
  assert.ok(Math.abs(east.xM-origin.xM-105.137)<.01);
  assert.ok(Math.abs(north.northM-origin.northM-111.195)<.01);
  assert.equal(east.northM,origin.northM);
  assert.equal(north.xM,origin.xM);
  assert.ok(Math.abs(points.reduce((sum,point)=>sum+point.xM,0))<1e-6);
});

test('the frame uses equal meter scale on both axes and keeps north upward',()=>{
  const points=projectFieldTrees([record('T-0001'),record('T-0002',{longitude:110.002,latitude:19.003})]).points;
  const frame=fieldMapFrame(points);
  assert.ok(Math.abs((frame.x(10)-frame.x(0))-(frame.y(0)-frame.y(10)))<1e-9);
  for(const point of points){
    assert.ok(frame.x(point.xM)>=frame.padding&&frame.x(point.xM)<=frame.width-frame.padding);
    assert.ok(frame.y(point.northM)>=frame.padding-1e-8&&frame.y(point.northM)<=frame.height-frame.padding+1e-8);
  }
  assert.ok(frame.scaleBarM>0);
  assert.equal(frame.scaleBarPixels,frame.scaleBarM*frame.scale);
  const single=fieldMapFrame(projectFieldTrees([record('T-0001')]).points);
  assert.equal(single.x(0),single.width/2);
  assert.equal(single.y(0),single.height/2);
  assert.ok(Number.isFinite(single.scale)&&single.scale>0);
});

test('elevation ranges keep datums and measured/simulated observations separate',()=>{
  const items=[
    record('T-0001',{elevationM:0}),record('T-0002',{elevationM:8}),
    record('T-0003',{elevationM:900,elevationDatum:'园区相对基准'}),
    record('T-0004',{elevationM:300,provenanceMode:'simulated'}),
    record('T-0005',{elevationM:500,elevationDatum:null}),record('T-0006',{elevationM:null}),
  ];
  const groups=groupFieldElevations(projectFieldTrees(items).points);
  assert.deepEqual(groups.map(group=>[group.datum,group.mode,group.points.length,group.min,group.max]),[
    ['1985国家高程基准','measured',2,0,8],['园区相对基准','measured',1,900,900],['1985国家高程基准','simulated',1,300,300],
  ]);
  assert.equal(elevationGroupKey(items[4]),null);
  assert.equal(elevationGroupKey(items[5]),null);
  assert.equal(items[4].elevationM,500);
});

test('elevation colors represent only the selected observed range',()=>{
  assert.equal(fieldElevationColor(0,{min:0,max:8}),'rgb(70, 110, 139)');
  assert.equal(fieldElevationColor(8,{min:0,max:8}),'rgb(225, 193, 135)');
  assert.equal(fieldElevationColor(4,{min:0,max:8}),'rgb(148, 182, 163)');
  assert.equal(fieldElevationColor(80,{min:80,max:80}),'rgb(148, 182, 163)');
});

const {code}=await transformWithOxc(readFileSync(new URL('../src/workspace/FieldSpatialMap.tsx',import.meta.url),'utf8'),'FieldSpatialMap.tsx',{lang:'tsx',jsx:{runtime:'classic'}});
const source=parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
function text(element){
  if(typeof element==='string'||typeof element==='number')return String(element);
  if(!React.isValidElement(element))return '';
  return React.Children.toArray(element.props.children).map(text).join('');
}
function walk(element,predicate){
  if(!React.isValidElement(element))return [];
  return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props.children).flatMap(child=>walk(child,predicate))];
}
function mount(items){
  let cursor=0,element;const slots=[],opened=[];
  const bindings={React,useMemo:fn=>fn(),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value];},treePosition,projectFieldTrees,groupFieldElevations,elevationGroupKey,fieldMapFrame,fieldElevationColor,elevationColors,elevationContours};
  const Component=new Function(...Object.keys(bindings),source+';return FieldSpatialMap;')(...Object.values(bindings));
  const props={items,onTree:index=>opened.push(index)};
  const render=(patch={})=>{Object.assign(props,patch);cursor=0;element=Component(props);return element;};
  render();
  return {opened,render,get element(){return element;},find:label=>walk(element,node=>node.props['aria-label']===label)[0]};
}

test('empty spatial data explains the two required fields without showing a sample location',()=>{
  const page=mount([record('T-0012',{latitude:null})]);
  assert.match(text(page.element),/longitude.*latitude/);
  assert.match(text(page.element),/现有 1 棵树的档案/);
  assert.equal(walk(page.element,node=>node.type==='svg').length,0);
});

test('selected tree details distinguish tree height from ground elevation and open its existing archive',()=>{
  const page=mount([record('T-0012',{elevationM:83.2,heightM:12.4})]);
  const detail=page.find('所选树木空间资料');
  assert.match(text(detail),/地面高程83.2 m高程基准1985国家高程基准树高（离地）12.4 m/);
  assert.match(text(detail),/现场树号：现场-T-0012/);
  assert.match(text(detail),/园区现场测量表.*2026\/10\/19 09:30:00/);
  walk(detail,node=>node.type==='button')[0].props.onClick();
  assert.deepEqual(page.opened,[11]);
});

test('point click, keyboard, and tree selector update details and select the matching elevation group',()=>{
  const items=[record('T-0001'),record('T-0012',{elevationDatum:'园区相对基准',heightM:17}),record('T-0020',{provenanceMode:'simulated'})];
  const page=mount(items);
  page.find('选择 T-0012 空间资料').props.onClick();page.render();
  assert.equal(page.find('选择空间资料树木').props.value,items[1].recordId);
  assert.match(text(page.find('所选树木空间资料')),/树高（离地）17 m/);
  assert.equal(page.find('高程比较基准').props.value,elevationGroupKey(items[1]));
  let prevented=false;
  page.find('选择 T-0020 空间资料').props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});page.render();
  assert.ok(prevented);assert.match(text(page.find('所选树木空间资料')),/模拟资料T-0020/);
  assert.equal(page.find('高程比较基准').props.value,elevationGroupKey(items[2]));
  page.find('选择空间资料树木').props.onChange({target:{value:items[0].recordId}});page.render();
  assert.equal(page.find('高程比较基准').props.value,elevationGroupKey(items[0]));
});

test('changing the elevation basis colors only its observations and shows that group range',()=>{
  const items=[record('T-0001',{elevationM:80}),record('T-0002',{elevationM:84}),record('T-0003',{elevationM:10,elevationDatum:'园区相对基准'})];
  const page=mount(items);
  assert.match(text(page.find('当前高程色带')),/80 m高差 4 m84 m/);
  assert.equal(walk(page.find('选择 T-0003 空间资料'),node=>node.type==='circle')[0].props.fill,'#73838b');
  page.find('高程比较基准').props.onChange({target:{value:elevationGroupKey(items[2])}});page.render();
  assert.match(text(page.find('当前高程色带')),/园区相对基准.*10 m同一高程10 m/);
  assert.equal(walk(page.find('选择 T-0001 空间资料'),node=>node.type==='circle')[0].props.fill,'#73838b');
  assert.equal(page.find('选择空间资料树木').props.value,items[2].recordId);
});

test('unlabelled elevation stays visible in details but does not become a comparable elevation layer',()=>{
  const page=mount([record('T-0001',{elevationM:16,elevationDatum:null})]);
  assert.match(text(page.find('所选树木空间资料')),/地面高程16 m高程基准未提供/);
  assert.match(text(page.element),/补充基准后参与色带比较/);
  assert.equal(page.find('高程比较基准'),undefined);
  assert.equal(page.find('当前高程色带'),undefined);
});

test('switching imported site data does not retain a previous tree selection',()=>{
  const page=mount([record('T-0001'),record('T-0012')]);
  page.find('选择 T-0012 空间资料').props.onClick();page.render();
  const replacement=record('T-0051',{recordId:'demo-xsbn:T-0051',siteId:'demo-xsbn',sourceName:'版纳测量表'});
  page.render({items:[replacement]});
  assert.equal(page.find('选择空间资料树木').props.value,replacement.recordId);
  assert.match(text(page.find('所选树木空间资料')),/T-0051.*版纳测量表/);
  assert.doesNotMatch(text(page.find('所选树木空间资料')),/T-0012/);
});

test('contours interpolate tree ground elevations at a nice interval and need enough points with relief',()=>{
  const grid=[];
  for(let i=0;i<5;i++)for(let j=0;j<5;j++)grid.push(record(`T-${String(i*5+j+1).padStart(4,'0')}`,{longitude:110+i*0.0002,latitude:19+j*0.0002,elevationM:80+i*2+j}));
  const points=projectFieldTrees(grid).points;
  const contours=elevationContours(points);
  assert.equal(contours.pointCount,25);
  assert.equal(contours.interval,2);
  assert.deepEqual(contours.levels.map(level=>level.level),[82,84,86,88,90]);
  assert.ok(contours.levels.every(level=>level.segments.length>0));
  const xs=points.map(point=>point.xM),ys=points.map(point=>point.northM);
  for(const [x1,y1,x2,y2] of contours.levels.flatMap(level=>level.segments))for(const [x,y] of [[x1,y1],[x2,y2]]){
    assert.ok(x>=Math.min(...xs)-1e-6&&x<=Math.max(...xs)+1e-6&&y>=Math.min(...ys)-1e-6&&y<=Math.max(...ys)+1e-6);
  }
  assert.equal(elevationContours(points.slice(0,3)),null);
  assert.equal(elevationContours(projectFieldTrees(grid.map(item=>({...item,elevationM:80}))).points),null);
});
