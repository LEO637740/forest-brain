import type {FieldTreeRecord,FieldPolygon} from '../../../../shared/fieldTrees.ts';
import type {Park} from '../../integration/client';
import type {Site,Task} from '../model';
import {treePosition,treeZone} from '../workbenchModel.ts';

export type SpatialPosition={longitude:number;latitude:number};
export function fieldBoundaryPoints(polygon:FieldPolygon):SpatialPosition[]{
  return polygon.coordinates[0].slice(0,-1).map(([longitude,latitude])=>({longitude,latitude}));
}
export type SpatialTree={
  treeId:string;
  index:number;
  zone:string;
  position:SpatialPosition|null;
  record?:FieldTreeRecord;
  tree?:Park['trees'][number];
};
export type SpatialZone={
  id:string;
  name:string;
  treeCount:number;
  locatedCount:number;
  measuredCount:number;
  position:SpatialPosition|null;
  robotLabel:string;
};

const positionOf=(record:FieldTreeRecord|undefined):SpatialPosition|null=>
  record?.longitude!=null&&record.latitude!=null?{longitude:record.longitude,latitude:record.latitude}:null;

function centerOf(positions:SpatialPosition[]):SpatialPosition|null{
  if(!positions.length)return null;
  return {
    longitude:positions.reduce((sum,position)=>sum+position.longitude,0)/positions.length,
    latitude:positions.reduce((sum,position)=>sum+position.latitude,0)/positions.length,
  };
}

/** Keep every business tree available for drill-down; only imported coordinates place it on the map. */
export function buildSpatialTrees(trees:Park['trees'],items:FieldTreeRecord[]):SpatialTree[]{
  const treesById=new Map(trees.map(tree=>[tree.treeId,tree]));
  const recordsById=new Map(items.map(record=>[record.treeId,record]));
  const ids=new Set([...treesById.keys(),...recordsById.keys()]);
  return [...ids].flatMap(treeId=>{
    const index=treePosition(treeId),zone=treeZone(treeId);
    if(index===null||zone===null)return [];
    const tree=treesById.get(treeId),record=recordsById.get(treeId)??tree?.fieldRecord;
    return [{treeId,index,zone,tree,record,position:positionOf(record)}];
  }).sort((a,b)=>a.index-b.index);
}

/** Zone centers describe the available points; they do not represent surveyed zone boundaries. */
export function spatialZones(entries:SpatialTree[],tasks:Task[],site:Site):SpatialZone[]{
  return [...'ABCD'].map(id=>{
    const trees=entries.filter(entry=>entry.zone===id);
    const located=trees.filter((entry):entry is SpatialTree&{position:SpatialPosition}=>entry.position!==null);
    const assignments=[...new Set(tasks.filter(task=>task.site===site&&task.block===id&&!['已完成','已取消'].includes(task.status)).map(task=>task.robot).filter(Boolean))];
    return {
      id,name:`${id}区`,treeCount:trees.length,locatedCount:located.length,
      measuredCount:located.filter(entry=>entry.record?.provenanceMode==='measured').length,
      position:centerOf(located.map(entry=>entry.position)),
      robotLabel:site==='hainan'?`R-${id}（模拟）`:assignments.join('、')||'暂无设备安排',
    };
  });
}

export function spatialSitePosition(items:FieldTreeRecord[]):SpatialPosition|null{
  return centerOf(items.flatMap(record=>{const position=positionOf(record);return position?[position]:[];}));
}
