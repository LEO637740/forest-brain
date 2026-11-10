import { useEffect, useRef } from 'react';
import { CloudRain, Droplets, ListChecks, AlertTriangle } from 'lucide-react';
import { getHomeTrend, getRecentLatex } from './AnalyticsPage';
import type { Site, Task, Story, Page } from './model';

function Trend({site}:{site:Site}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return;
  const draw=()=>{
   const box=canvas.getBoundingClientRect();if(box.width<1||box.height<1)return;
   const dpr=Math.min(devicePixelRatio,2);canvas.width=box.width*dpr;canvas.height=box.height*dpr;
   const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);
   const data=getHomeTrend(site);if(!data.length)return;
   const max=Math.ceil(Math.max(...data.map(d=>d.forecast))/20)*20;
   const x=(i:number)=>26+i*(box.width-32)/6;
   const y=(n:number)=>5+(box.height-22)*(1-n/max);
   ctx.font='10px sans-serif';ctx.fillStyle='#9ab6a5';
   for(const n of [0,max/2,max]){ctx.fillText(String(n),0,y(n)+3);ctx.strokeStyle='#284333';ctx.beginPath();ctx.moveTo(24,y(n));ctx.lineTo(box.width,y(n));ctx.stroke();}
   for(const key of ['actual','forecast'] as const){ctx.strokeStyle=key==='actual'?'#55d6a2':'#a8d2be';ctx.lineWidth=1.7;ctx.setLineDash(key==='actual'?[]:[4,4]);ctx.beginPath();data.forEach((d,i)=>i?ctx.lineTo(x(i),y(d[key])):ctx.moveTo(x(i),y(d[key])));ctx.stroke();}
   ctx.fillText(data[0].date.slice(5),26,box.height-1);ctx.fillText(data[6].date.slice(5),box.width-34,box.height-1);
  };
  draw();const observer=new ResizeObserver(draw);observer.observe(canvas);return()=>observer.disconnect();
 },[site]);
 return <canvas className="ws-summary-chart" ref={ref} aria-label="近7日胶乳：实线为实际，虚线为预计，单位千克"/>;
}
export function HomeSummary({site,tasks,navigate,onStory}:{site:Site;tasks:Task[];navigate:(p:Page)=>void;onStory:(s:Story)=>void}){
 const done=tasks.filter(t=>t.status==='已完成').length;
 const busy=tasks.filter(t=>t.status==='执行中').length;
 const pending=tasks.filter(t=>t.status==='待处理').length;
 const latex=getRecentLatex(site);
 return <section className="ws-home-bottom">
  <button className="ws-panel" onClick={()=>onStory('weather')}><h3><CloudRain size={18}/>天气与作业窗口</h3><strong>27° <small>多云，短时阵雨</small></strong><div className="ws-window-strip"><i/><i/><i/><i/><i/><i/></div><div className="ws-chart-caption"><span>06时</span><span>12时</span><span>18时</span></div><p>黄色：建议调整 · 绿色：适作窗口（模拟）</p></button>
  <button className="ws-panel" onClick={()=>navigate('operations')}><h3><ListChecks size={18}/>今日作业进度</h3><strong>{done} / {tasks.length}<small>项已完成</small></strong><progress value={done} max={tasks.length||1}/><div className="ws-chart-caption"><span>执行中 {busy}</span><span>待处理 {pending}</span><span>待开始 {tasks.filter(t=>t.status==='待开始').length}</span></div><p>展开任务、设备与排程</p></button>
  <button className="ws-panel" onClick={()=>navigate('analytics')}><h3><Droplets size={18}/>产胶趋势 <small className="ws-muted">{latex===null?'联调不计产量':latex+' kg / 7日'}</small></h3>{latex===null?<p>西安试验记录不纳入生产统计。</p>:<><Trend site={site}/><div className="ws-chart-caption"><span>实线：实际胶乳</span><span>虚线：预计胶乳</span></div></>}</button>
  <button className="ws-panel" onClick={()=>onStory('health')}><h3><AlertTriangle size={18}/>异常与巡查</h3><strong>{pending}<small>项作业待处理</small></strong><p>识别记录 → 现场核实 → 回访记录</p><span className="ws-link">查看处理过程 →</span></button>
 </section>;
}
