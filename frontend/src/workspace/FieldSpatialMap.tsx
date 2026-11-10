import {useMemo,useState} from 'react';
import type {FieldTreeRecord} from '../../../shared/fieldTrees.ts';
import {treePosition} from './workbenchModel';
import {elevationColors,elevationContours,elevationGroupKey,fieldElevationColor,fieldMapFrame,groupFieldElevations,projectFieldTrees,type FieldMapPoint} from './fieldSpatialModel';
import './fieldSpatialMap.css';

type Props={items:FieldTreeRecord[];onTree:(index:number)=>void};
const modeLabel={measured:'实测资料',simulated:'模拟资料'};
const number=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:2});
const coordinate=(value:number)=>value.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:8});
const measuredValue=(value:number|null|undefined)=>typeof value==='number'?`${number(value)} m`:'未提供';
const observedTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});

export function FieldSpatialMap({items,onTree}:Props){
  const [selectedId,setSelectedId]=useState(''),[requestedGroup,setRequestedGroup]=useState(''),[showContours,setShowContours]=useState(true);
  const projection=useMemo(()=>projectFieldTrees(items),[items]);
  const groups=useMemo(()=>groupFieldElevations(projection?.points||[]),[projection]);
  const group=groups.find(item=>item.key===requestedGroup)||groups[0];
  const selected=projection?.points.find(point=>point.record.recordId===selectedId)||projection?.points[0];
  const frame=useMemo(()=>projection?fieldMapFrame(projection.points):null,[projection]);
  const contours=useMemo(()=>group?elevationContours(group.points):null,[group]);
  const selectPoint=(point:FieldMapPoint)=>{setSelectedId(point.record.recordId);const key=elevationGroupKey(point.record);if(key)setRequestedGroup(key);};
  if(!projection||!frame||!selected)return <section className="fsm-panel dc-panel" aria-label="现场树位与高程"><header><div><h2>树位与地面高程</h2><p>根据导入资料的 WGS84 坐标显示园区局部点位。</p></div></header><div className="fsm-empty"><strong>暂无可定位的树木资料</strong><p>为树木填写 <code>longitude</code>（经度）和 <code>latitude</code>（纬度）后，这里会显示对应点位。</p>{items.length>0&&<p>现有 {items.length} 棵树的档案仍可在资料列表中查看。</p>}</div></section>;
  const record=selected.record,index=treePosition(record.treeId);
  const missingDatum=projection.points.filter(point=>typeof point.record.elevationM==='number'&&!point.record.elevationDatum).length;
  return <section className="fsm-panel dc-panel" aria-label="现场树位与高程">
    <header><div><h2>树位与地面高程</h2><p>{projection.points.length} 棵有坐标 · {projection.missingCoordinates?`${projection.missingCoordinates} 棵未提供完整坐标`:'全部已定位'} · WGS84 局部米制投影</p></div><label className="fsm-tree-select">选择树木<select aria-label="选择空间资料树木" value={record.recordId} onChange={event=>selectPoint(projection.points.find(point=>point.record.recordId===event.target.value)!)}>{projection.points.map(point=><option key={point.record.recordId} value={point.record.recordId}>{point.record.treeId}{point.record.sourceTreeId?` · ${point.record.sourceTreeId}`:''}</option>)}</select></label></header>
    <div className="fsm-toolbar"><span>北向上 · 东向右 · 横纵方向使用相同米制比例</span>{groups.length>0&&<label>高程比较<select aria-label="高程比较基准" value={group.key} onChange={event=>{setRequestedGroup(event.target.value);const next=groups.find(item=>item.key===event.target.value)!;setSelectedId(next.points[0].record.recordId);}}>{groups.map(item=><option key={item.key} value={item.key}>{item.datum} · {modeLabel[item.mode]} · {item.points.length} 棵</option>)}</select></label>}{contours&&<label className="fsm-contour-toggle"><input type="checkbox" checked={showContours} onChange={event=>setShowContours(event.target.checked)}/>显示等高线</label>}</div>
    <div className="fsm-layout"><div className="fsm-map-wrap">
      <svg className="fsm-map" viewBox={`0 0 ${frame.width} ${frame.height}`} role="group" aria-label="WGS84树木坐标局部点位图">
        <title>树木点位与已有地面高程</title><rect className="fsm-ground" x="1" y="1" width={frame.width-2} height={frame.height-2} rx="8"/>
        {frame.xTicks.map((value,i)=><g key={`x-${i}`}><line className="fsm-grid" x1={frame.x(value)} x2={frame.x(value)} y1={frame.padding} y2={frame.height-frame.padding}/><text className="fsm-tick" x={frame.x(value)} y={frame.height-frame.padding+19} textAnchor="middle">{number(value)}</text></g>)}
        {frame.yTicks.map((value,i)=><g key={`y-${i}`}><line className="fsm-grid" x1={frame.padding} x2={frame.width-frame.padding} y1={frame.y(value)} y2={frame.y(value)}/><text className="fsm-tick" x={frame.padding-9} y={frame.y(value)+4} textAnchor="end">{number(value)}</text></g>)}
        <text className="fsm-axis-title" x={frame.padding} y="25">北向偏移 / m</text><text className="fsm-axis-title" x={frame.width-frame.padding} y={frame.height-17} textAnchor="end">东向偏移 / m</text><text className="fsm-north" x={frame.width-30} y="30" textAnchor="middle">N ↑</text>
        {showContours&&contours&&<g className="fsm-contours" aria-label={`等高线，等高距 ${number(contours.interval)} 米`}>{contours.levels.map(level=>{
          const label=level.segments[Math.floor(level.segments.length/2)];
          return <g key={level.level}><path d={level.segments.map(([x1,y1,x2,y2])=>`M${frame.x(x1).toFixed(1)} ${frame.y(y1).toFixed(1)}L${frame.x(x2).toFixed(1)} ${frame.y(y2).toFixed(1)}`).join('')}/><text className="fsm-contour-label" x={frame.x(label[0])} y={frame.y(label[1])-3} textAnchor="middle">{number(level.level)}</text></g>;
        })}</g>}
        {projection.points.map(point=>{
          const active=record.recordId===point.record.recordId,sameGroup=group&&elevationGroupKey(point.record)===group.key;
          const color=sameGroup?fieldElevationColor(point.record.elevationM!,group):'#73838b';
          return <g className={`fsm-point ${active?'selected':''} ${point.record.provenanceMode==='simulated'?'is-simulated':''}`} key={point.record.recordId} role="button" tabIndex={0} aria-label={`选择 ${point.record.treeId} 空间资料`} aria-pressed={active} onClick={()=>selectPoint(point)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectPoint(point);}}}>
            <circle cx={frame.x(point.xM)} cy={frame.y(point.northM)} r={active?8:6} fill={color}/><title>{point.record.treeId} · {modeLabel[point.record.provenanceMode]} · 地面高程 {measuredValue(point.record.elevationM)} · {point.record.elevationDatum||'基准未提供'}</title>
          </g>;
        })}
        <path className="fsm-scale" d={`M ${frame.padding} ${frame.height-25} v 5 h ${frame.scaleBarPixels} v -5`}/><text className="fsm-axis-title" x={frame.padding+frame.scaleBarPixels/2} y={frame.height-31} textAnchor="middle">{number(frame.scaleBarM)} m</text>
      </svg>
      {group?<div className="fsm-elevation-legend" aria-label="当前高程色带"><div><strong>地面高程 · {group.datum}</strong><span>{modeLabel[group.mode]} · {group.points.length} 个有值点</span></div><div className="fsm-color-scale" style={{background:`linear-gradient(90deg,${elevationColors.join(',')})`}}/><div className="fsm-elevation-range"><span>{number(group.min)} m</span><span>{group.min===group.max?'同一高程':`高差 ${number(group.max-group.min)} m`}</span><span>{number(group.max)} m</span></div><details><summary>高程计算说明</summary><p>按高程基准及资料类型分组比较；灰色点不参与当前组比较。{contours?`等高线由本组 ${contours.pointCount} 个树点的地面高程按反距离加权插值生成，等高距 ${number(contours.interval)} m；树点之间是估计值，${group.mode==='simulated'?'资料为模拟，等高线同样是模拟':'资料为实测'}。`:'有值点不足 4 个或没有高差，暂不生成等高线。'}</p></details></div>:<p className="fsm-note">当前没有注明基准的地面高程，图中先展示树木位置。</p>}
      {missingDatum>0&&<p className="fsm-note">{missingDatum} 个点提供了高程但未填写基准；可选择查看原值，补充基准后参与色带比较。</p>}
      <p className="fsm-note">局部投影原点：{coordinate(projection.origin.longitude)}° E，{coordinate(projection.origin.latitude)}° N。点位来自导入资料。</p>
    </div><aside className="fsm-details" aria-label="所选树木空间资料" aria-live="polite">
      <span className={`fsm-source-tag ${record.provenanceMode}`}>{modeLabel[record.provenanceMode]}</span><h3>{record.treeId}</h3>{record.sourceTreeId&&<p className="fsm-source-id">现场树号：{record.sourceTreeId}</p>}
      <dl><dt>经度</dt><dd>{coordinate(record.longitude!)}°</dd><dt>纬度</dt><dd>{coordinate(record.latitude!)}°</dd><dt>坐标系</dt><dd>{record.coordinateSystem}</dd><dt>地面高程</dt><dd>{measuredValue(record.elevationM)}</dd><dt>高程基准</dt><dd>{record.elevationDatum||'未提供'}</dd><dt>树高（离地）</dt><dd>{measuredValue(record.heightM)}</dd><dt>树围</dt><dd>{record.circumferenceCm===null?'未提供':`${number(record.circumferenceCm)} cm`}</dd><dt>测量高度</dt><dd>{measuredValue(record.measurementHeightM)}</dd><dt>资料来源</dt><dd>{record.sourceName}</dd><dt>观测时间</dt><dd>{observedTime(record.observedAt)}<small>北京时间</small></dd></dl>
      <button className="fsm-open-tree" disabled={index===null} onClick={()=>{if(index!==null)onTree(index);}}>打开对应单树档案 →</button>
    </aside></div>
  </section>;
}
