import {useEffect,useMemo,useState} from 'react';
import {initialTasks,type Task} from '../model';
import {recoverTasks} from '../railTaskBridge';
import {initialWeatherState,transitionWeather,WEATHER_ACTION_LABELS,type WeatherAction,type WeatherDemoState} from './demoWeather';

const key='rubber-uiux-v03-weather-demo';
// This snapshot reuses an existing demo entity, never mutates the running fleet task.
const baseline={...recoverTasks(initialTasks).find(t=>t.id==='HN-03')!,treeIndices:Array.from({length:28},(_,i)=>100+i)};
function readState():WeatherDemoState {
 try {const v=JSON.parse(localStorage.getItem(key)||'null');
  if(v&&['草案','待复核','已批准','未采纳','待重新复核'].includes(v.status)&&typeof v.start==='string'&&typeof v.end==='string'&&Number.isInteger(v.version)&&typeof v.applied==='boolean'&&typeof v.receipt==='boolean'&&Array.isArray(v.history)&&v.history.every((h:unknown)=>!!h&&typeof (h as {action:string}).action==='string'&&typeof (h as {time:string}).time==='string'))return v;
 }catch{}
 return initialWeatherState(baseline);
}
export function useWeatherSample(tasks:Task[]) {
 const [state,setState]=useState(readState),[error,setError]=useState(''),[notice,setNotice]=useState(''),[failure,setFailure]=useState(false);
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(state));}catch{setError('浏览器未能保存记录。本次修改仅保留在当前会话。');}},[state]);
 const action=(kind:WeatherAction,window?:{start:string;end:string})=>{
  setNotice('');
  if(failure&&kind==='submit'){setFailure(false);setError('演示请求失败，修改内容已保留。可重新提交；未改变方案或任务。');return;}
  const result=transitionWeather(state,kind,new Date().toLocaleString('zh-CN',{hour12:false}),window);
  setError(result.error??'');
  if(result.error)return;
  setState(result.state);setNotice(WEATHER_ACTION_LABELS[kind]+'已记录，仅保存于天气样板。');
 };
 const task:Task={...baseline,start:state.applied?state.start:baseline.start,end:state.applied?state.end:baseline.end,status:state.receipt?'已完成':state.applied?'待开始':'待处理',done:state.receipt?baseline.count:0};
 const projected=useMemo(()=>tasks.some(t=>t.id===baseline.id)?tasks.map(t=>t.id===baseline.id?task:t):[task,...tasks],[tasks,state]);
 return {state,task,tasks:projected,error,notice,failure,action,toggleFailure:()=>setFailure(v=>!v),reset:()=>{setState(initialWeatherState(baseline));setFailure(false);setError('');setNotice('天气样板已重置，原现场任务与机器人状态未改变。');}};
}
