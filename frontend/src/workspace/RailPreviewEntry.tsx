import {useEffect,useState} from 'react';

/** UI-only bridge to the existing imperative scene. Never dispatches a business task. */
export function RailPreviewEntry({onOpen}:{onOpen:()=>void}){
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const status=(event:Event)=>setReady((event as CustomEvent).detail===true);
    window.addEventListener('home-rail-preview-status',status);
    window.dispatchEvent(new Event('home-rail-preview-query'));
    return ()=>window.removeEventListener('home-rail-preview-status',status);
  },[]);
  return <section aria-label="机器人接近方案"><h3>让机器人接近这棵树</h3>
    <p>定位 → 伸出接近 → 停留 → 自动收回</p>
    <dl className="ws-facts"><div><dt>演示对象</dt><dd>HN-A-0045</dd></div><div><dt>动作时长</dt><dd>15 秒</dd></div><div><dt>终点</dt><dd>距候选点 30 毫米</dd></div></dl>
    <p>本次只演示接近与收回，不执行切割。结束后自动查看结果。</p>
    <button className="ws-primary ws-full" disabled={!ready} onClick={()=>{
    window.dispatchEvent(new CustomEvent('home-rail-preview-start',{detail:44}));onOpen();
  }}>{ready?'开始机器人演示':'机器人准备中…'}</button></section>;
}
