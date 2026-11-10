import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {fitWindow,initialWindow,type WindowRect} from './windowGeometry';
import './floatingWindow.css';
let front=100;
const focusEvent='spatial-focus-window';
function focusNextWindow(exclude:string){const next=Array.from(document.querySelectorAll<HTMLElement>('[data-window-id]')).filter(el=>el.dataset.windowId!==exclude&&!el.hidden).sort((a,b)=>Number(b.style.zIndex)-Number(a.style.zIndex))[0];window.dispatchEvent(new CustomEvent(focusEvent,{detail:next?.dataset.windowId??null}));}
function workArea(assistant:boolean){const nav=document.querySelector('.ws-navigation')?.getBoundingClientRect();return {width:innerWidth,height:innerHeight,top:assistant?8:(nav?.bottom??168)+8};}
export function FloatingWindow({children,full=false,onToggleFull,assistant=false,hidden=false,windowId,order=0}:{children:ReactNode;full?:boolean;onToggleFull:()=>void;assistant?:boolean;hidden?:boolean;windowId?:string;order?:number}){
 const slot=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null);
 const id=windowId??'assistant';
 const [base,setBase]=useState<WindowRect|null>(null),[moved,setMoved]=useState<WindowRect|null>(null),[z,setZ]=useState(()=>++front),[active,setActive]=useState(false);
 const drag=useRef<{x:number;y:number;rect:WindowRect}|null>(null);
 const bringForward=()=>window.dispatchEvent(new CustomEvent(focusEvent,{detail:id}));
 useLayoutEffect(()=>{const focus=(event:Event)=>{const mine=(event as CustomEvent).detail===id;setActive(mine);if(mine)setZ(++front)};window.addEventListener(focusEvent,focus);return()=>window.removeEventListener(focusEvent,focus)},[id]);
 useLayoutEffect(()=>{
  const el=slot.current;if(!el)return;
  const measure=()=>{if(assistant){const r=el.getBoundingClientRect();if(r.width&&r.height)setBase({left:r.left,top:r.top,width:r.width,height:r.height});}else setBase(initialWindow(workArea(false),order));};
  const observer=new ResizeObserver(measure);observer.observe(el);window.addEventListener('resize',measure);window.addEventListener('spatial-layout-changed',measure);measure();
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('spatial-layout-changed',measure)};
 },[assistant,order]);
 useLayoutEffect(()=>{if(!hidden)bringForward();else setActive(false);return()=>{if(host.current?.dataset.active==='true')focusNextWindow(id)}},[hidden,full,id]);
 useLayoutEffect(()=>{const resize=()=>setMoved(r=>r?fitWindow(r,workArea(assistant)):r);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[assistant]);
 const r=moved??base;
 const top=workArea(assistant).top;
 const style=full?{left:8,right:8,top,bottom:8,zIndex:z}:r?{left:r.left,width:r.width,...(assistant&&!moved?{bottom:Math.max(8,innerHeight-r.top-r.height)}:{top:r.top}),...(!assistant?{height:r.height}:{maxHeight:Math.max(70,innerHeight-(moved?r.top:16)-8)}),zIndex:z}:{};
 return <><div ref={slot} className={assistant?'assistant-window-slot':'module-window-slot'} hidden={hidden}/>{base&&createPortal(<div ref={host} data-window-id={id} data-active={active} data-moved={!!moved} className={'rb-shell desktop-window-host '+(assistant?'assistant-host ':'')+(full?'desktop-maximized':'')} style={style} hidden={hidden}
 onPointerDownCapture={bringForward} onFocusCapture={()=>{if(!active)bringForward()}}
 onPointerDown={e=>{const target=e.target as HTMLElement;if(full||e.button!==0||!target.closest('.window-titlebar,.assistant-heading')||target.closest('button,input,select,a'))return;const box=host.current!.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,rect:{left:box.left,top:box.top,width:box.width,height:box.height}};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}}
 onPointerMove={e=>{const d=drag.current;if(!d)return;setMoved(fitWindow({...d.rect,left:d.rect.left+e.clientX-d.x,top:d.rect.top+e.clientY-d.y},workArea(assistant)));}}
 onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{drag.current=null}}
 onDoubleClick={e=>{const t=e.target as HTMLElement;if(t.closest('.window-titlebar,.assistant-heading')&&!t.closest('button,input,select'))onToggleFull();}}>{children}</div>,document.body)}</>;
}
