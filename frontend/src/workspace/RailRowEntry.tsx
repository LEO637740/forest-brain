import {useEffect,useState} from 'react';
import {Modal} from './Modal';
import {railSegments,segmentForTree,railTreeLabel,segmentDuration} from '../railSegments';

type RowReceipt={id:string;segmentId:string;indices:number[];duration:number;completedAt:string};
export function RailRowEntry({index,onOpen}:{index:number;onOpen:()=>void}){
  const [ready,setReady]=useState(false);
  const segment=segmentForTree(index)??railSegments[0];
  useEffect(()=>{setReady(false);const receive=(e:Event)=>{const d=(e as CustomEvent).detail;if(d?.segmentId===segment.id)setReady(d.ready===true);};
    window.addEventListener('rail-row-ready',receive);window.dispatchEvent(new Event('rail-row-query'));
    return()=>window.removeEventListener('rail-row-ready',receive);
  },[segment.id]);
  const covered=segment.indices.includes(index),count=segment.indices.length,duration=segmentDuration(count);
  return <section aria-label="连续轨道方案"><h3>{covered?(count===1?'这棵树可进行单站预演':'这棵树已接入连续轨道'):'这棵树的轨道连接待核查'}</h3>
    <p>{segment.label} · 独立轨段</p>
    <p>{covered?(count===1?'独立短轨上的接近与收回演示，不与其他轨段互通。':'一次启动，机器人按轨道顺序逐树接近、收回，再返回起点。'):'当前可查看同排三棵树的连续演示，不会执行本树。'}</p>
    <button className="ws-primary ws-full" disabled={!ready} onClick={()=>{window.dispatchEvent(new CustomEvent('rail-row-start',{detail:{index:covered?index:segment.indices[0]}}));onOpen();}}>{ready?(covered?(count===3?'启动三树连续预演':`启动${count}棵分段预演`):'查看已接通的三树演示'):'轨道准备中…'}</button>
    <small>非接触预演 · {duration}秒 · 不计入割胶产量</small>
    <details style={{marginTop:12}}><summary>本排可预演 · {Array.from({length:10},(_,n)=>110+n).filter(i=>segmentForTree(i)).length} / 10棵</summary>
      <dl className="ws-facts">{Array.from({length:10},(_,n)=>110+n).map(i=><div key={i}><dt>{railTreeLabel(i)}</dt><dd>{segmentForTree(i)?(segmentForTree(i)!.indices.length===1?'独立单站预演':'三树连续预演'):[111,112,113,118].includes(i)?'待核查割面接近点':'轨段与道路冲突'}</dd></div>)}</dl>
      <p>整排直轨会穿越主路，且部分树超出机构行程；未连接轨段不能跨段运行。</p>
    </details>
  </section>;
}
export function RailRowResult({onTree,onReplay}:{onTree:(index:number)=>void;onReplay:()=>void}){
  const [receipt,setReceipt]=useState<RowReceipt|null>(null);
  useEffect(()=>{const receive=(e:Event)=>{const r=(e as CustomEvent<RowReceipt>).detail,segment=railSegments.find(s=>s.id===r?.segmentId);if(segment&&r.indices?.join(',')===segment.indices.join(',')&&r.duration===segmentDuration(segment.indices.length))setReceipt(r);};window.addEventListener('rail-row-result',receive);return()=>window.removeEventListener('rail-row-result',receive);},[]);
  if(!receipt)return null;
  return <Modal title={receipt.indices.length===1?'单站预演已完成':'连续预演已完成'} onClose={()=>setReceipt(null)}><h3>{receipt.indices.length}棵已完成接近与收回{receipt.indices.length>1?'，机器人已返回':''}</h3>
    <ol className="ws-rail-receipt">{receipt.indices.map(i=><li key={i}><span aria-hidden="true" style={{flexShrink:0}}>✓</span><div><button className="ws-link" onClick={()=>{setReceipt(null);onTree(i);}}>{railTreeLabel(i)} · 查看档案</button><p style={{margin:'4px 0 0',fontSize:14}}>停靠 → 接近 → 停留 → 收回</p></div></li>)}</ol>
    <p>用时{receipt.duration}秒（不含暂停）。本次未切割，不计入作业完成数和产量。</p>
    <footer className="ws-modal-actions"><button className="ws-secondary" onClick={()=>setReceipt(null)}>返回场景</button><button className="ws-primary" onClick={()=>{const index=receipt.indices[0];setReceipt(null);onReplay();window.dispatchEvent(new CustomEvent('rail-row-start',{detail:{index}}));}}>再演示一次</button></footer>
  </Modal>;
}
