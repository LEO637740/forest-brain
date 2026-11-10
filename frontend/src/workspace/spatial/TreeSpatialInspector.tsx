import {useState} from 'react';
import {DATA_MODE,kinds,post,read,siteIdOf,statuses,useRead,type Park,type View} from '../../integration/client';
import {prepareRuleStrategies} from '../../integration/ruleStrategyBatch';
import {can,currentAccount} from '../identityModel';
import type {TreeKind} from '../../integration/modelGenerationFlow';
import {StrategyRecommendation} from '../../integration/StrategyRecommendation';
import {treeAlias,type Site,type Task} from '../model';
import {treeWorkRecords} from '../treeWorkModel';
import {taskDate} from '../operationsModel';
import {treePosition,treeZone} from '../workbenchModel';
import {taskRobotTarget,type RobotTarget} from '../robotCenterModel';
import './treeSpatialInspector.css';

type Props={
  site:Site;
  treeId:string;
  tasks:Task[];
  onTree:(index:number)=>void;
  onStrategy:(index:number,kind:TreeKind)=>void;
  onRobot:(robot:RobotTarget)=>void;
  onTask:(task:Task)=>void;
};
const treeKinds:TreeKind[]=['tapping_angle','surface_action','growth_plan','pest_risk'];

function TreeSpatialDetails({site,treeId,tasks,onTree,onStrategy,onRobot,onTask}:Props){
  const [kind,setKind]=useState<TreeKind>('tapping_angle');
  const [generating,setGenerating]=useState(''),[generated,setGenerated]=useState('');
  const account=currentAccount(),mayGenerate=!account||can(account,'strategy.adopt');
  const park=useRead<Park>(`/api/demo/park?siteId=${siteIdOf(site)}`);
  const view=useRead<View>(`/api/demo/trees/${treeId}/view?kind=${kind}&dataMode=${DATA_MODE}&siteId=${siteIdOf(site)}`);
  const index=treePosition(treeId),zone=treeZone(treeId);
  const tree=park.data?.trees.find(item=>item.treeId===treeId);
  const field=tree?.fieldRecord;
  const work=index===null?[]:treeWorkRecords(tasks,index,site);
  const needsAttention=(record:typeof work[number])=>/待核对|待复查|等待本树/.test(record.status);
  const activeWork=work.filter(record=>!['已完成','已取消'].includes(record.task.status)||needsAttention(record));
  const historyWork=work.filter(record=>['已完成','已取消'].includes(record.task.status)&&!needsAttention(record));
  const devices=Array.from(new Map(work.filter(item=>item.task.kind==='割胶').map(item=>{
    const target=taskRobotTarget(item.task,index!);
    return [`${target.source}:${target.zone}`,{...target,name:item.task.robot}];
  })).values());
  if(!devices.length&&site==='hainan'&&zone)devices.push({source:'fleet',zone:'ABCD'.indexOf(zone),name:`R-${zone}`});
  const label=index===null?treeId:treeAlias(index,site);
  // Only Haikou is kept fresh by the launcher; elsewhere a manager or operator asks for rule advice.
  async function generate(scope:'tree'|'zone'){
    if(generating||index===null||!zone)return;
    const treeIds=scope==='tree'?[treeId]:Array.from({length:50},(_,offset)=>`T-${String('ABCD'.indexOf(zone)*50+offset+1).padStart(4,'0')}`);
    setGenerated('');setGenerating(scope==='tree'?'正在用规则生成本树四类建议…':`正在用规则生成${zone}区 50 棵的建议…`);
    try{
      const result=await prepareRuleStrategies(siteIdOf(site),treeIds,{post:(path,input)=>post(path,input),read:path=>read(path),
        onProgress:(done,total)=>setGenerating(`正在用规则生成建议… ${done}/${total} 批`)});
      setGenerated(result.unsettled||result.other?`已生成 ${result.succeeded} 项，${result.unsettled+result.other} 项未完成，可稍后重试。`:`已生成 ${result.succeeded} 项规则建议（未调用模型，有效期 1 小时）。`);
      view.reload();
    }catch(error){setGenerated(`生成失败：${(error as Error).message}`);}
    finally{setGenerating('');}
  }
  const missing=view.data&&(!view.data.strategy||['expired','needs_generation'].includes(view.data.strategyStatus));
  function taskLink(record:typeof work[number]){
    return <button className="tsi-task" key={record.task.id} onClick={()=>onTask(record.task)}><span><strong>{record.task.title}</strong><small title={record.task.robot}>{taskDate(record.task)??'日期待核对'} · {record.task.start}–{record.task.end}</small></span><span>{needsAttention(record)?record.status:record.task.status} →</span></button>;
  }
  const source=field?`${field.provenanceMode==='measured'?'导入实测':'导入模拟'} · ${field.sourceName}`:tree?.provenance.mode==='simulated'?'模拟档案':'现场档案';
  return <aside className="tsi-inspector" aria-label="地图单树详情">
    <header className="tsi-tree-head"><p>所选单树{zone?` · ${zone}区模拟分组`:''}</p><h2>{field?.sourceTreeId||label}</h2>{field?.sourceTreeId&&field.sourceTreeId!==label&&<small>{label}</small>}</header>
    {park.error?<p className="tsi-message" role="alert">档案读取失败 <button onClick={park.reload}>重试</button></p>:!park.data?<p className="tsi-message">正在读取树档案…</p>:tree?<>
      <div className="tsi-dimensions"><span><strong>{tree.circumferenceCm??'—'}</strong> cm<small>树围</small></span><span><strong>{tree.heightM??'—'}</strong> m<small>树高</small></span></div>
      <p className="tsi-source">{source}</p>
    </>:<p className="tsi-message">当前园区未找到这棵树的档案。</p>}
    <section className="tsi-strategy" aria-label="地图单树策略"><header><h3>这棵树怎么处理</h3><select aria-label="地图单树策略类型" value={kind} onChange={event=>setKind(event.target.value as TreeKind)}>{treeKinds.map(item=><option key={item} value={item}>{kinds[item]}</option>)}</select></header>
      {view.error?<p className="tsi-message" role="alert">策略读取失败 <button onClick={view.reload}>重试</button></p>:!view.data?<p className="tsi-message">正在读取策略…</p>:view.data.strategy?<><StrategyRecommendation strategy={view.data.strategy}/>{view.data.strategyStatus!=='available'&&<p className="tsi-message">{statuses[view.data.strategyStatus]||view.data.strategyStatus}</p>}</>:<p className="tsi-message">暂无{kinds[kind]}建议。</p>}
      {missing&&mayGenerate&&index!==null&&<div className="tsi-generate"><button disabled={Boolean(generating)} onClick={()=>generate('tree')}>生成本树建议</button><button disabled={Boolean(generating)} onClick={()=>generate('zone')}>生成本区 50 棵</button></div>}
      {(generating||generated)&&<p className="tsi-message" role="status">{generating||generated}</p>}
      <div className="tsi-actions"><button disabled={index===null} onClick={()=>onTree(index!)}>单树档案</button><button className="tsi-primary" disabled={index===null} onClick={()=>onStrategy(index!,kind)}>完整策略 →</button></div>
    </section>
    <section className="tsi-device" aria-label="本树关联设备"><header><h3>负责设备</h3></header>{devices.length?devices.map(device=><div key={`${device.source}:${device.zone}`}><strong>{device.name}</strong><small>{work.some(item=>item.task.kind==='割胶')?'来自本树关联任务记录':'分区模拟设备'}</small><button onClick={()=>onRobot({source:device.source,zone:device.zone})}>查看设备 →</button></div>):<p className="tsi-message">暂无本树关联设备记录。</p>}</section>
    <section className="tsi-work" aria-label="地图本树任务"><header><h3>本树任务</h3><span>{work.length} 项</span></header>{work.length?<><div>{activeWork.map(taskLink)}</div>{historyWork.length>0&&<details className="tsi-history"><summary>历史任务 · {historyWork.length} 项</summary><div>{historyWork.map(taskLink)}</div></details>}</>:<p className="tsi-message">暂无任务。</p>}</section>
  </aside>;
}

export function TreeSpatialInspector(props:Props){
  return <TreeSpatialDetails key={`${props.site}:${props.treeId}`} {...props}/>;
}
