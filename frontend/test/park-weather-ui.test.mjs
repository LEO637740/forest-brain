import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseAst, transformWithOxc} from 'vite';

async function declarations(file, names) {
  const {code}=await transformWithOxc(readFileSync(new URL(`../src/integration/${file}`,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
  return parseAst(code).body.map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
    .filter(node=>node&&(node.type==='FunctionDeclaration'?names.includes(node.id.name):node.type==='VariableDeclaration'&&node.declarations.some(item=>names.includes(item.id.name))))
    .map(node=>code.slice(node.start,node.end)).join('\n');
}
const code=await declarations('ParkWeather.tsx',['weatherTime','windowLabels','ParkWeather']);
const wrappers=[await declarations('StrategyWorkspace.tsx',['Weather','BackendOverview']),await declarations('PublicWeather.tsx',['PublicWeather'])].join('\n');
const noop=()=>{};
const Card=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);
const text=node=>renderToStaticMarkup(node).replace(/<[^>]*>/g,'');
function walk(node,predicate) {
  if(!React.isValidElement(node))return [];
  if(typeof node.type==='function')return walk(node.type(node.props),predicate);
  return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>walk(child,predicate))];
}
const button=(tree,label)=>walk(tree,node=>node.type==='button'&&text(node)===label)[0];
const now=Date.now(),at=offset=>new Date(now+offset*60_000).toISOString();
const weather={siteId:'demo-xsbn',siteName:'云南景洪模拟园区',provider:'Open-Meteo',sourceUrl:'https://api.open-meteo.com/v1/forecast',
  location:{name:'景洪园区配置点',latitude:22,longitude:100.8,confirmed:false},fetchedAt:at(-2),validUntil:at(118),checkedAt:at(0),
  status:'available',stale:false,error:null,current:{at:at(-5),airTemperatureC:25,relativeHumidityPct:78,precipitationMm:0,intervalSeconds:900},
  windows:[{start:at(10),end:at(70),rainfallMm:0,rainProbabilityPct:10,airTemperatureC:25,relativeHumidityPct:78,suitability:'suitable',reason:'天气信号允许，开工前核对割面。'},
    {start:at(70),end:at(130),rainfallMm:2,rainProbabilityPct:80,airTemperatureC:24,relativeHumidityPct:90,suitability:'defer',reason:'预报降雨，建议暂缓。'}],
  summary:'未来存在候选作业窗口',refreshMinutes:60,limitation:'区域模型预报，园区坐标为演示配置，不是现场传感器实测。',thresholds:{lightRainMaxMmPerPeriod:.5,rainProbabilityDeferPct:60}};
function harness(props={site:'xsbn'},options={}) {
  const slots=[],listeners=new Map(),calls={reads:[],posts:[],reloads:0,events:[]};let cursor=0;
  const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];};
  const bindings={React,useState,useEffect:fn=>fn(),siteIdOf:site=>`demo-${site}`,Card,
    Chart:({unit})=>React.createElement('div',null,unit),State:({error})=>React.createElement('p',{role:'status'},error||'正在读取…'),
    useRead:(path,readOptions)=>{calls.reads.push({path,options:readOptions});return {data:options.data===undefined?weather:options.data,error:options.error,reload:()=>calls.reloads++};},
    post:async(path,input)=>{calls.posts.push({path,input});if(options.postError)throw Error(options.postError);return options.data??weather;},
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name),dispatchEvent:event=>{calls.events.push(event.type);listeners.get(event.type)?.();}},
  };
  const Component=new Function(...Object.keys(bindings),code+';return ParkWeather;')(...Object.values(bindings));
  return {calls,listeners,render:()=>{cursor=0;return Component(props);}};
}

test('live-weather reads the selected park and polls; map, strategy and data use the same component',()=>{
  const Marker=()=>null;
  const exported=new Function('React','ParkWeather',wrappers+';return {Weather,BackendOverview,PublicWeather};')(React,Marker);
  for(const site of ['hainan','xsbn','guangdong-maoming']) {
    for(const Component of Object.values(exported)) {
      const element=Component({site,onWeather:noop,onData:noop});
      assert.equal(element.type,Marker);assert.equal(element.props.site,site);
    }
    const h=harness({site});h.render();
    assert.deepEqual(h.calls.reads,[{path:`/api/weather/window?siteId=demo-${site}`,options:{pollMs:60_000}}]);
  }
});

test('all-parks view asks for a park and does not request a weather endpoint',()=>{
  const h=harness({site:null});const html=text(h.render());
  assert.equal(h.calls.reads[0].path,null);
  assert.match(html,/选择一个园区/);assert.doesNotMatch(html,/Open-Meteo|云南景洪|候选作业窗口/);
});

test('unavailable API weather does not turn into a simulated candidate',()=>{
  const h=harness({site:'xsbn'},{data:{...weather,status:'unavailable',stale:true,error:{code:'SOURCE_UNAVAILABLE',message:'天气源暂不可用'},fetchedAt:null,validUntil:null,current:null,windows:[],summary:'尚未取得天气，请稍后刷新'}});
  const html=text(h.render());assert.match(html,/天气源暂不可用/);assert.match(html,/尚未获取/);
  assert.doesNotMatch(html,/候选作业窗口|模拟早间|25 ℃/);
  const failed=harness({site:'xsbn'},{data:null,error:'读取失败 (503)'});
  assert.match(text(failed.render()),/读取失败/);assert.doesNotMatch(text(failed.render()),/候选作业窗口/);
});

test('stale forecasts remain auditable but cannot be presented as an active window',()=>{
  const h=harness({site:'xsbn'},{data:{...weather,status:'stale',stale:true,summary:'天气数据已过期，请更新'}});
  const html=text(h.render());assert.match(html,/数据过期，待更新/);assert.match(html,/保留上次获取的数据供核对/);
  assert.doesNotMatch(html,/候选作业窗口/);
});

test('live values preserve zero precipitation, source and update period; elapsed windows are excluded',()=>{
  const past={...weather.windows[0],start:'2000-01-01T00:00:00Z',end:'2000-01-01T01:00:00Z',reason:'已过去的窗口'};
  const h=harness({site:'xsbn'},{data:{...weather,windows:[past,...weather.windows]}});
  const html=text(h.render());assert.match(html,/近 15 分钟降水0 mm/);assert.match(html,/Open-Meteo 天气 API/);
  assert.match(html,/每 60 分钟更新天气，页面每分钟同步/);assert.match(html,/不是现场传感器实测/);
  assert.match(html,/候选作业窗口/);assert.doesNotMatch(html,/已过去的窗口/);
});

test('manual refresh sends the selected park and notifies both open views',async()=>{
  const h=harness({site:'guangdong-maoming'});const tree=h.render();
  await button(tree,'刷新天气并重算').props.onClick();
  assert.deepEqual(h.calls.posts,[{path:'/api/weather/window',input:{siteId:'demo-guangdong-maoming'}}]);
  assert.deepEqual(h.calls.events,['harness-park-weather-changed']);assert.equal(h.calls.reloads,1);
  h.listeners.get('focus')();assert.equal(h.calls.reloads,2);
  assert.equal(button(h.render(),'刷新天气并重算').props.disabled,false);
});

test('refresh failure is visible and does not fabricate a new weather result',async()=>{
  const h=harness({site:'xsbn'},{postError:'天气 API 超时'});
  await button(h.render(),'刷新天气并重算').props.onClick();
  assert.match(text(h.render()),/天气 API 超时/);assert.deepEqual(h.calls.events,[]);
  assert.equal(button(h.render(),'刷新天气并重算').props.disabled,false);
});

test('data center shows forecasts without duplicating strategy decisions',()=>{
  const h=harness({site:'xsbn',dataOnly:true});const html=text(h.render());
  assert.match(html,/园区天气资料/);assert.match(html,/逐小时天气预报/);
  assert.doesNotMatch(html,/候选作业窗口|作业建议|当前规则/);
});
