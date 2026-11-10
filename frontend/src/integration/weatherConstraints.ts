export type WeatherAdoption={kind:string;siteId?:string;treeIds:string[];start:string;end:string;expiresAt:string;validity?:{valid:boolean;status:string;reason?:string}};
export type WeatherTiming={notBefore?:number;notAfter?:number;weatherBlock?:string};
export type WeatherTimingOptions={siteId?:string;now?:number;failure?:string};
export type LiveWeatherConstraint={enabled:boolean;allowed?:boolean;reason?:string;checkedAt?:string;windowStart?:string|null;windowEnd?:string|null;validUntil?:string|null};

/** Current API weather is an execution condition even without an adopted weather scenario. */
export function withLiveWeather(timing:WeatherTiming,weather:LiveWeatherConstraint|undefined,now=Date.now()):WeatherTiming{
 if(!weather?.enabled)return timing;
 if(!weather.allowed)return {...timing,weatherBlock:`天气暂缓：${weather.reason||'当前天气不适合作业'}`};
 const end=Math.min(Date.parse(weather.windowEnd??''),Date.parse(weather.validUntil??''));
 if(!Number.isFinite(end)||end<=now)return {...timing,weatherBlock:'天气核验已过期，等待更新后继续'};
 return {...timing,notAfter:Math.min(timing.notAfter??Infinity,end)};
}

/** Constraints arrive newest first. An invalid latest adoption must not revive an older window. */
export function weatherTimingFor(treeId:string,rows:readonly WeatherAdoption[],options:WeatherTimingOptions={}):WeatherTiming{
 const siteId=options.siteId??'demo-hainan',now=options.now??Date.now();
 // Legacy records predate multiple sites and belong only to the Hainan demo.
 const item=rows.find(row=>(row.siteId??'demo-hainan')===siteId&&row.treeIds?.includes(treeId));
 const timing:WeatherTiming=item?{notBefore:Date.parse(item.start),notAfter:Math.min(Date.parse(item.end),Date.parse(item.expiresAt))}:{};
 if(options.failure)return {...timing,weatherBlock:options.failure};
 if(!item)return {};
 if(item.validity?.valid===false)return {...timing,weatherBlock:item.validity.reason||'天气建议已失效，请重新确认'};
 if(!Number.isFinite(timing.notBefore)||!Number.isFinite(timing.notAfter)||timing.notAfter!<=now||timing.notAfter!<=timing.notBefore!)return {...timing,weatherBlock:'已采用天气窗口过期，请重新选择'};
 return {...timing,weatherBlock:''};
}
