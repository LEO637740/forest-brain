import {useState,type ReactNode} from 'react';
import {Maximize,Minimize,X} from 'lucide-react';
import {FloatingWindow} from './FloatingWindow';
export function FusionWindow({id,title,hidden,order=0,onClose,children}:{id:string;title:string;hidden:boolean;order?:number;onClose:()=>void;children:ReactNode}){
  const [full,setFull]=useState(false);
  return <FloatingWindow windowId={id} order={order} hidden={hidden} full={full} onToggleFull={()=>setFull(!full)}>
    <section className="fusion-window" aria-label={title}>
      <header className="window-titlebar"><strong>{title}</strong><span className="window-controls">
        <button aria-label={full?`还原${title}`:`最大化${title}`} title={full?'还原':'最大化'} onClick={()=>setFull(!full)}>{full?<Minimize size={18}/>:<Maximize size={18}/>}</button>
        <button aria-label={`关闭${title}`} title="关闭" onClick={onClose}><X size={18}/></button>
      </span></header>
      <div className="window-content">{children}</div>
    </section>
  </FloatingWindow>;
}
