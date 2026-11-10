import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc, parseAst} from 'vite';
import {sites} from '../src/workspace/model.ts';
import {can} from '../src/workspace/identityModel.ts';
import {catalogTime} from '../src/workspace/dataCatalog.ts';
import {batchStageLabels} from '../../shared/logistics.ts';
import {salesShipmentStatusLabels} from '../../shared/salesShipments.ts';
import {latestIndustryRunId,industryRecordState,industrySourceUrl,industryTime} from '../src/integration/industryBriefData.ts';
import {publicSourceState} from '../src/integration/publicMarketData.ts';

async function declarations(file) {
  const {code} = await transformWithOxc(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),file,{lang:'tsx',jsx:{runtime:'classic'}});
  return parseAst(code).body.filter(node=>node.type!=='ImportDeclaration').map(node=>code.slice(node.start,node.end).replace(/^export /,'')).join('\n');
}
const businessCode=await declarations('workspace/BusinessRecords.tsx');
const recordsCode=await declarations('integration/IndustryRecords.tsx');
const dataCode=await declarations('workspace/DataCenter.tsx');
const noop=()=>{};
const siteIdOf=site=>'demo-'+site;

test('business records request the selected park and keep wet latex, dry stock and separate enterprise samples distinct',()=>{
  for(const site of ['hainan','xsbn']){
    const calls=[];
    const inventory={siteId:siteIdOf(site),stockKg:34,availableKg:34,heldKg:0,inTransitKg:5,soldKg:3,openingStockKg:0,processedKg:42,dispatchedKg:8,salesRevenueCny:48,updatedAt:'2026-10-26T01:00:00Z'};
    const batch={id:`${site}-batch`,stage:'processed',source:{taskTitle:`${site}本园任务`},weighing:{netKg:100},inspections:[{dryRubberPercent:34,decision:'pass',grade:'A'}],transport:{receipt:{receivedKg:99}},processing:{dryKg:33,processLossKg:.66},collection:{at:'2026-10-26T01:00:00Z'}};
    const fixtures={
      [`/api/simulation/sales-inventory?siteId=${siteIdOf(site)}`]:{inventory},
      [`/api/simulation/logistics-batches?siteId=${siteIdOf(site)}`]:{items:[batch]},
      [`/api/simulation/sales-shipments?siteId=${siteIdOf(site)}`]:{items:[{id:'sale',buyer:{name:'买方'},status:'received',plannedKg:3,plannedDepartureAt:'2026-10-26T01:00:00Z',receipt:{receivedKg:3,revenueCny:48}}]},
      '/api/demo/business-data':{asOf:'2026-10-26T01:00:00Z',records:[{topic:'inventory',content:JSON.stringify({totals:{onHandKg:800,availableKg:200,reservedKg:200,heldKg:400},items:[]})}]},
    };
    const useRead=url=>{calls.push(url);return {data:fixtures[url],reload:noop};};
    const Component=new Function('React','useRead','siteIdOf','sites','catalogTime','batchStageLabels','salesShipmentStatusLabels',businessCode+';return BusinessRecords;')(React,useRead,siteIdOf,sites,catalogTime,batchStageLabels,salesShipmentStatusLabels);
    const html=renderToStaticMarkup(React.createElement(Component,{site,onTasks:noop}));
    assert.deepEqual(calls.slice(0,3),Object.keys(fixtures).slice(0,3));
    assert.match(html,new RegExp(site+'本园任务'));
    assert.match(html,/净重 100 公斤鲜胶乳/);assert.match(html,/入库 33 公斤干胶/);
    assert.match(html,/当前库存 34 公斤干胶/);assert.match(html,/在库 800/);
    assert.match(html,/虚构演示企业，与所选园区无对应关系/);
    assert.match(html,/到任务中心办理/);
    assert.ok(calls.every(url=>!url.includes('refresh')&&!url.includes('prepare')));
  }
});

test('data center links business records and mounts one public reference topic at a time',()=>{
  const PublicMarket=()=>null,PublicWeather=()=>null,IndustryRecords=()=>null,BusinessRecords=()=>null,AnalyticsPage=()=>null;
  function mount(props){
    let cursor=0;const slots=[];
    const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>slots[index]=value];};
    const Component=new Function('React','useState','sites','can','PublicMarket','PublicWeather','IndustryRecords','BusinessRecords','AnalyticsPage',dataCode+';return DataCenter;')(React,useState,sites,can,PublicMarket,PublicWeather,IndustryRecords,BusinessRecords,AnalyticsPage);
    return {render(){cursor=0;return Component({site:'xsbn',initialTab:'public',initialReference:'industry',...props});}};
  }
  const page=mount({});
  const walk=element=>!React.isValidElement(element)?[]:[element,...React.Children.toArray(element.props.children).flatMap(walk)];
  let nodes=walk(page.render());
  assert.equal(nodes.filter(node=>node.type===IndustryRecords).length,1);
  assert.equal(nodes.filter(node=>node.type===PublicWeather||node.type===PublicMarket).length,0);
  const text=element=>React.Children.toArray(element.props.children).filter(child=>typeof child==='string').join('');
  nodes.find(node=>node.type==='button'&&text(node)==='天气').props.onClick();
  nodes=walk(page.render());
  assert.equal(nodes.filter(node=>node.type===PublicWeather).length,1);
  assert.equal(nodes.filter(node=>node.type===IndustryRecords||node.type===PublicMarket).length,0);
  nodes.find(node=>node.type==='button'&&text(node)==='库存与流转').props.onClick();
  nodes=walk(page.render());
  assert.equal(nodes.find(node=>node.type===BusinessRecords).props.site,'xsbn');
  const growerNodes=walk(mount({account:{permissions:['plot.read']},initialTab:'business'}).render());
  assert.equal(growerNodes.filter(node=>node.type===BusinessRecords).length,0);
  assert.equal(growerNodes.filter(node=>node.type==='button'&&text(node)==='库存与流转').length,0);
  const analysis=walk(mount({initialTab:'analytics',initialAnalysis:'health',onTree:noop}).render()).find(node=>node.type===AnalyticsPage);
  assert.equal(analysis.props.initialTopic,'health');assert.equal(analysis.props.site,'xsbn');assert.equal(analysis.props.onTree,noop);
  const trend=walk(mount({initialTab:'analytics',initialAnalysis:'trend'}).render()).find(node=>node.type===AnalyticsPage);
  assert.notEqual(analysis.key,trend.key);
});

test('industry data preserves the saved reporting period and raw source apart from current collector status',()=>{
  const calls=[];
  const record={observationId:'annual',title:'年度产量',period:'2025 年度',scope:'全国',retrievedAt:'2026-10-20T01:00:00Z',expiresAt:'2099-01-01T00:00:00Z',sourceUrl:'https://example.org/annual',quality:'valid',content:'{"annualTonnes":100}',provenance:{mode:'measured'}};
  const useRead=url=>{if(url)calls.push(url);return {reload:noop,data:url?.includes('generatorMode=configured')?{items:[]}:url?.includes('generatorMode=demo_rules')?{items:[{runId:'saved-input',kind:'industry_brief',status:'succeeded'}]}:url?.endsWith('/context')?{asOf:'2026-10-21T01:00:00Z',modules:{industry:{records:[record],gaps:[]}}}:url==='/api/sources'?{sources:[]}:undefined};};
  const Component=new Function('React','useRead','DATA_MODE','latestIndustryRunId','industryRecordState','industrySourceUrl','industryTime','publicSourceState',recordsCode+';return IndustryRecords;')(React,useRead,'demo',latestIndustryRunId,industryRecordState,industrySourceUrl,industryTime,publicSourceState);
  const html=renderToStaticMarkup(React.createElement(Component));
  assert.match(html,/2025 年度/);assert.match(html,/全国/);assert.match(html,/annualTonnes/);
  assert.match(html,/https:\/\/example.org\/annual/);assert.match(html,/当前公开来源状态/);
  assert.ok(calls.includes('/internal/harness/runs/saved-input/context'));
  assert.ok(calls.every(url=>!url.includes('refresh')&&!url.includes('prepare')));
});
