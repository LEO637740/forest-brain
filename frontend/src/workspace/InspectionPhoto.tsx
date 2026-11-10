import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
export function InspectionPhoto({marks=false,onMark,active,caption}:{marks?:boolean;onMark:(s:string)=>void;active:string;caption?:string}){
 const [visible,setVisible]=useState(true),[zoom,setZoom]=useState(false);
 return <div className="ws-photo">
  <div className={`ws-photo-stage ${zoom?'zoomed':''}`}>
   <img src="/assets/ui/tree-inspection.png" alt="生成的橡胶树割面示意，非现场实拍"/>
   {marks&&visible&&<>{[{name:'表面附着物',cls:'mud'},{name:'结构隆起',cls:'knot'}].map(m=><button key={m.cls} aria-label={m.name} className={`ws-photo-region ${m.cls} ${active===m.name?'active':''}`} onClick={()=>onMark(m.name)}><span>{m.name}</span></button>)}</>}
  </div>
  {caption&&<span className="ws-photo-caption">{caption}</span>}
  <span className="ws-photo-origin">生成示意图 · 人工演示标注 · 非实拍证据</span>
  <div className="ws-photo-controls">{marks&&<button onClick={()=>setVisible(v=>!v)}>{visible?'隐藏标记':'显示标记'}</button>}<button aria-label={zoom?'还原照片':'放大照片'} onClick={()=>setZoom(v=>!v)}><Maximize2 size={16}/>{zoom?'还原':'放大'}</button></div>
 </div>;
}
