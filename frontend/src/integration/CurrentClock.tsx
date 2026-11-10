import {useState,useEffect} from 'react';
export function CurrentClock(){const [now,setNow]=useState(()=>new Date());useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(timer);},[]);return <span>{now.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</span>;}
