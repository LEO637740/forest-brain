import {useEffect,useState} from 'react';
import {Modal} from './Modal';
type Receipt={id:string;treeId:string;startedAt:string;completedAt:string;durationSeconds:number};
export function RailPreviewResult({onTree,onReplay}:{onTree:()=>void;onReplay:()=>void}){
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  useEffect(()=>{
    const receive=(event:Event)=>{const r=(event as CustomEvent<Receipt>).detail;if(r?.treeId==='HN-A-0045'&&r.durationSeconds===15)setReceipt(r);};
    window.addEventListener('home-rail-preview-result',receive);
    return ()=>window.removeEventListener('home-rail-preview-result',receive);
  },[]);
  if(!receipt)return null;
  return <Modal title="单树预演结果" onClose={()=>setReceipt(null)}>
    <p>海南 A区 · {receipt.treeId}</p>
    <h3>接近流程已完成，机器人已回到停靠位</h3>
    <ol className="ws-rail-receipt">{['收拢定位','伸出并接近候选点','非接触停留','收回并返回停靠位'].map(text=><li key={text}><span aria-hidden="true">✓</span>{text}</li>)}</ol>
    <dl className="ws-facts"><div><dt>动作时长</dt><dd>15 秒（不含暂停）</dd></div><div><dt>目标端点间距</dt><dd>30 毫米 · 预设值</dd></div><div><dt>结束时间</dt><dd>{new Date(receipt.completedAt).toLocaleTimeString('zh-CN')}</dd></div></dl>
    <p>本次为非接触预演，未切割，不计入割胶完成数和产量。</p>
    <footer className="ws-modal-actions"><button className="ws-secondary" onClick={()=>{setReceipt(null);onTree();}}>返回这棵树</button><button className="ws-primary" onClick={()=>{setReceipt(null);onReplay();window.dispatchEvent(new CustomEvent('home-rail-preview-start',{detail:44}));}}>再演示一次</button></footer>
  </Modal>;
}
