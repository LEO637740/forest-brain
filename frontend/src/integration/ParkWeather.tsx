import {useEffect, useState} from 'react';
import {useRead, post, siteIdOf, type EnvironmentSite} from './client';
import {Card, Chart, State} from './Views';

export type WeatherWindow = {
  start:string; end:string; rainfallMm:number|null; rainProbabilityPct:number|null;
  airTemperatureC:number|null; relativeHumidityPct:number|null;
  suitability:'suitable'|'review'|'defer'; reason:string;
};
export type ParkWeatherData = {
  siteId:string; siteName:string; provider:string; sourceUrl:string;
  location:{name:string; latitude:number; longitude:number; confirmed:boolean};
  fetchedAt:string|null; validUntil:string|null; checkedAt:string;
  status:'available'|'refresh_failed'|'stale'|'unavailable'; stale:boolean;
  error:{code:string; message:string}|null;
  current:{at:string; airTemperatureC:number|null; relativeHumidityPct:number|null; precipitationMm:number|null; intervalSeconds:number}|null;
  windows:WeatherWindow[]; summary:string; refreshMinutes:number; limitation:string;
  thresholds:{lightRainMaxMmPerPeriod:number; rainProbabilityDeferPct:number};
};
const weatherTime=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const windowLabels={suitable:'候选作业窗口',review:'需现场复核',defer:'建议暂缓'};

export function ParkWeather({site,compact=false,dataOnly=false,onWeather,onData}:{site:EnvironmentSite|null;compact?:boolean;dataOnly?:boolean;onWeather?:()=>void;onData?:()=>void}) {
  const r=useRead<ParkWeatherData>(site?`/api/weather/window?siteId=${siteIdOf(site)}`:null,{pollMs:60_000});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const refresh=()=>r.reload();
    window.addEventListener('harness-park-weather-changed',refresh);
    window.addEventListener('focus',refresh);
    return()=>{window.removeEventListener('harness-park-weather-changed',refresh);window.removeEventListener('focus',refresh);};
  },[site]);
  async function refreshWeather(){
    if(!site)return;
    setBusy(true);setError('');
    try{await post('/api/weather/window',{siteId:siteIdOf(site)});window.dispatchEvent(new Event('harness-park-weather-changed'));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const title=dataOnly?'园区天气资料':'天气与作业窗口';
  if(!site)return <Card title={title}><p>选择一个园区后，查看当地天气与作业窗口。</p></Card>;
  const data=r.data;
  if(!data)return <Card title={title}><State error={r.error} reload={r.reload}/></Card>;
  const future=data.windows.filter(row=>Date.parse(row.end)>Date.now());
  const candidate=future.find(row=>row.suitability==='suitable')??future.find(row=>row.suitability==='review');
  const current=data.current;
  return <Card title={title}>
    <p className="hb-muted">{data.siteName} · {data.provider} 天气 API</p>
    {!dataOnly&&<><h3>{data.summary}</h3>{!data.stale&&candidate&&<p><strong>{windowLabels[candidate.suitability]}：{weatherTime(candidate.start)} — {weatherTime(candidate.end)}</strong><br/>{candidate.reason}</p>}</>}
    <div className="hb-kpis">
      <div><span>当前气温</span><strong>{current?.airTemperatureC??'—'}<small> ℃</small></strong></div>
      <div><span>当前相对湿度</span><strong>{current?.relativeHumidityPct??'—'}<small> %</small></strong></div>
      <div><span>{current?`近 ${Math.round(current.intervalSeconds/60)} 分钟降水`:'当前降水'}</span><strong>{current?.precipitationMm??'—'}<small> mm</small></strong></div>
    </div>
    <p className="hb-time">获取时间：{data.fetchedAt?weatherTime(data.fetchedAt):'尚未获取'} · 每 {data.refreshMinutes} 分钟更新天气，页面每分钟同步{current&&` · 当前天气时刻 ${weatherTime(current.at)}`}（北京时间）</p>
    {(data.error||data.stale||r.error||error)&&<p role="status">{error||r.error||data.error?.message||'天气数据已过期，请刷新。'}{data.fetchedAt&&' · 保留上次获取的数据供核对。'}</p>}
    <div className="hb-result-actions"><button disabled={busy} onClick={refreshWeather}>{busy?'正在更新天气…':'刷新天气并重算'}</button>{compact&&onWeather&&<button onClick={onWeather}>查看窗口与依据 →</button>}{onData&&<button onClick={onData}>查看天气资料 →</button>}</div>
    {!compact&&<>
      <Chart values={future.slice(0,24).map(row=>row.rainfallMm)} labels={future.slice(0,24).map(row=>weatherTime(row.start))} unit="未来24小时预报降雨 mm" bars/>
      <details className="dc-strategy-evidence"><summary>{dataOnly?'逐小时天气预报':'全部作业窗口与判断依据'} · {future.length} 段</summary>
        <div className="hb-result-table"><table><thead><tr><th>时段（北京时间）</th><th>降雨 mm</th><th>降雨概率</th>{!dataOnly&&<th>作业建议</th>}</tr></thead><tbody>{future.map(row=><tr key={row.start}><td>{weatherTime(row.start)} — {weatherTime(row.end)}</td><td>{row.rainfallMm??'—'}</td><td>{row.rainProbabilityPct==null?'—':`${row.rainProbabilityPct}%`}</td>{!dataOnly&&<td><strong>{data.stale?'数据过期，待更新':windowLabels[row.suitability]}</strong><br/>{row.reason}</td>}</tr>)}</tbody></table></div>
        {!dataOnly&&<p>当前规则：时段降雨超过 {data.thresholds.lightRainMaxMmPerPeriod} mm，或降雨概率达到 {data.thresholds.rainProbabilityDeferPct}% 时建议暂缓；近 7 日累计雨量仅作巡查提示，不单独停割，现场雨情和积水等异常仍需处理。</p>}
      </details>
    </>}
    <p className="hb-muted">{data.limitation}</p>
    {!compact&&<p className="hb-time">查询坐标：{data.location.latitude}, {data.location.longitude} · <a href={data.sourceUrl} target="_blank" rel="noreferrer">核对天气 API 来源 ↗</a></p>}
  </Card>;
}
