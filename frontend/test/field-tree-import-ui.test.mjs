import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseAst, transformWithOxc} from 'vite';
import {sites} from '../src/workspace/model.ts';
import * as catalogFunctions from '../src/workspace/dataCatalog.ts';
import * as fieldFunctions from '../src/workspace/fieldImportModel.ts';
import {fieldBoundaryPoints} from '../src/workspace/spatial/spatialCatalog.ts';

async function declarations(filename) {
  const {code} = await transformWithOxc(readFileSync(new URL(`../src/workspace/${filename}.tsx`, import.meta.url), 'utf8'), `${filename}.tsx`, {lang: 'tsx', jsx: {runtime: 'classic'}});
  return parseAst(code).body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
}
const componentCode = await declarations('FieldTreeImport');
const dataCode = await declarations('DataCenter');
const stub = () => null;
const FieldSpatialMap = stub;
const at = '2026-10-20T02:00:00Z';
const input = () => ({...fieldFunctions.fieldTreeTemplate('hainan', at), sourceName: '现场测量表', provenanceMode: 'measured', elevationDatum: '项目水准基准', records: [{treeId: 'T-0001', sourceTreeId: '本地-17', variety: '热研', circumferenceCm: 52, heightM: 9, measurementHeightM: 1.3, latitude: 19.8, longitude: 110.3, elevationM: 31}]});
const record = () => ({...input().records[0], recordId: 'field-1', siteId: 'demo-hainan', sourceName: input().sourceName, observedAt: at, importedAt: at, provenanceMode: 'measured', coordinateSystem: 'WGS84', elevationDatum: input().elevationDatum});
const saved = () => ({siteId: 'demo-hainan', items: [record()], importedCount: 1, savedCount: 1});
const empty = () => ({siteId: 'demo-hainan', items: [], importedCount: 0});

function walk(element, predicate) {
  if (!React.isValidElement(element)) return [];
  if (typeof element.type === 'function' && element.type !== FieldSpatialMap) return walk(element.type(element.props), predicate);
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];
}
function text(element) {return renderToStaticMarkup(element).replace(/<[^>]*>/g, '');}
const named = (tree, label) => walk(tree, node => node.props['aria-label'] === label)[0];
const button = (tree, label) => walk(tree, node => node.type === 'button' && text(node) === label)[0];
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const slots = [], effects = new Set(), calls = {read: [], post: [], events: [], trees: []}; let cursor = 0;
  const useState = initial => {const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => {slots[index] = typeof next === 'function' ? next(slots[index]) : next;}];};
  const useRef = initial => {const index = cursor++; if (!(index in slots)) slots[index] = {current: initial}; return slots[index];};
  const useEffect = callback => {const index = cursor++; if (!effects.has(index)) {effects.add(index);callback();}};
  const bindings = {
    React, useState, useRef, useEffect, sites, ...catalogFunctions, ...fieldFunctions, FieldSpatialMap, fieldBoundaryPoints, GeoMapCanvas: stub,
    siteIdOf: site => `demo-${site}`,
    read: async path => {calls.read.push(path); return options.read ? options.read(path, calls.read.length) : calls.read.length === 1 ? empty() : saved();},
    post: async (path, value) => {calls.post.push({path, value}); return options.post ? options.post(path, value) : saved();},
    window: {dispatchEvent: event => calls.events.push(event)},
    CustomEvent: class {constructor(type, init) {this.type = type; this.detail = init.detail;}},
  };
  const Component = new Function(...Object.keys(bindings), componentCode + ';return FieldTreeImport;')(...Object.values(bindings));
  const props = {site: 'hainan', onTree: index => calls.trees.push(index), readOnly: options.readOnly};
  return {calls, render() {cursor = 0;return Component(props);}};
}
async function choose(h, value = input()) {
  named(h.render(), '选择树木资料文件').props.onChange({target: {files: [{name: 'trees.json', text: async () => JSON.stringify(value)}]}});
  await settle();
}

test('read-only roles can inspect saved trees but are not offered an import that their role cannot save', async () => {
  const h = harness({readOnly:true,read:async()=>saved()});h.render();await settle();
  const tree=h.render();
  assert.equal(named(tree,'树木资料导入'),undefined);
  assert.equal(named(tree,'选择树木资料文件'),undefined);
  assert.match(text(named(tree,'已保存树木档案')),/现场测量 1 棵/);
  button(tree,'T-0001 · 查看档案').props.onClick();assert.deepEqual(h.calls.trees,[0]);
});

test('preview is read-only until explicit save and retains source metadata and units', async () => {
  const h = harness(); await choose(h);
  const tree = h.render(), preview = named(tree, '导入资料预览');
  assert.match(text(preview), /trees.json.*1 棵树/);
  assert.match(text(preview), /52 cm.*1.3 m.*9 m/);
  assert.equal(named(preview, '资料来源类别').props.value, 'measured');
  assert.equal(named(preview, '资料来源').props.value, '现场测量表');
  assert.equal(h.calls.post.length, 0);
});

test('save rereads the server catalog, publishes the change and links saved records to their tree', async () => {
  const h = harness(); await choose(h);
  button(h.render(), '保存本批资料').props.onClick(); await settle();
  assert.deepEqual(h.calls.post, [{path: '/api/field/trees', value: input()}]);
  assert.equal(h.calls.read.length, 2);
  assert.equal(h.calls.read[1], '/api/field/trees?siteId=demo-hainan');
  assert.deepEqual(h.calls.events.map(event => [event.type, event.detail]), [['harness-field-data-changed', {siteId: 'demo-hainan'}]]);
  const tree = h.render();
  assert.equal(named(tree, '导入资料预览'), undefined);
  assert.match(text(named(tree, '已保存树木档案')), /现场测量 1 棵.*模拟导入 0 棵/);
  button(tree, 'T-0001 · 查看档案').props.onClick(); assert.deepEqual(h.calls.trees, [0]);
  assert.deepEqual(walk(tree, node => node.type === FieldSpatialMap)[0].props.items, [record()]);
});

test('a rejected save keeps the preview and does not announce a changed archive', async () => {
  const h = harness({post: async () => {throw Error('第 1 条树号不在当前映射范围');}}); await choose(h);
  button(h.render(), '保存本批资料').props.onClick(); await settle();
  assert.ok(named(h.render(), '导入资料预览'));
  assert.match(text(h.render()), /第 1 条树号不在当前映射范围/);
  assert.equal(h.calls.events.length, 0);
  assert.equal(h.calls.read.length, 1);
});

test('successful persistence is retained when the following refresh fails', async () => {
  const h = harness({read: async (_path, count) => {if (count === 1) return empty(); throw Error('连接中断');}}); await choose(h);
  button(h.render(), '保存本批资料').props.onClick(); await settle();
  assert.equal(named(h.render(), '导入资料预览'), undefined);
  assert.match(text(h.render()), /已保存 1 棵树资料/);
  assert.match(text(h.render()), /资料已保存，重新读取失败：连接中断/);
  assert.match(text(named(h.render(), '已保存树木档案')), /现场测量表/);
  assert.equal(h.calls.events.length, 1);
});

test('template classification remains simulated until the user explicitly changes it', async () => {
  const h = harness(); await choose(h, fieldFunctions.fieldTreeTemplate('hainan', at));
  assert.equal(named(h.render(), '资料来源类别').props.value, 'simulated');
  named(h.render(), '资料来源类别').props.onChange({target: {value: 'measured'}});
  assert.equal(named(h.render(), '资料来源类别').props.value, 'measured');
});

test('boundary-only file previews, saves and rereads persisted source and geometry through the existing import flow', async () => {
  const input = {...fieldFunctions.fieldBoundaryTemplate('hainan', at), sourceName:'现场边界测绘', provenanceMode:'measured'};
  const boundaryCatalog = {...empty(),savedCount:0,boundaries:{...input.boundaries,siteId:input.siteId,sourceName:input.sourceName,observedAt:at,importedAt:at,recordId:'boundary-1',provenanceMode:'measured',coordinateSystem:'WGS84'}};
  const h = harness({read:async(_path,count)=>count===1?empty():boundaryCatalog,post:async()=>boundaryCatalog});
  await choose(h,input);
  assert.match(text(named(h.render(),'导入资料预览')),/园区与 4 个分区边界/);
  assert.ok(named(h.render(),'园区与分区边界预览'));
  assert.equal(h.calls.post.length,0);
  button(h.render(),'保存本批资料').props.onClick();await settle();
  assert.deepEqual(h.calls.post,[{path:'/api/field/trees',value:input}]);
  assert.match(text(named(h.render(),'已保存园区边界')),/现场测量.*现场边界测绘/);
  assert.match(text(h.render()),/已保存园区及 A–D 分区边界/);
  assert.equal(h.calls.read.length,2);
});

test('source catalog counts saved measured and simulated records separately', () => {
  const mockData = {...saved(), items: [record(), {...record(), treeId: 'T-0002', provenanceMode: 'simulated', latitude: null, longitude: null}], importedCount: 2};
  const bindings = {React, useEffect: stub, sites, ...catalogFunctions, ...fieldFunctions, siteIdOf: site => `demo-${site}`,
    useRead(path) {return {reload: stub, data: path.startsWith('/api/field/trees') ? mockData : path.startsWith('/api/demo/park') ? {trees: [], modules: {}} : path === '/api/sources/coverage' ? {items: [{id: 'trees', requirement: '单树档案', status: 'business_data_required', boundary: '200 棵树仍为模拟', fields: ['treeId', 'rowId']}]} : path === '/api/demo/business-data' ? {records: []} : {sources: []}};}};
  const SourceCatalog = new Function(...Object.keys(bindings), dataCode + ';return SourceCatalog;')(...Object.values(bindings));
  const tree = SourceCatalog({site: 'hainan', onField: stub, onAnalytics: stub, onPublic: stub});
  assert.match(text(tree), /已保存 2 棵 · 现场测量 1 棵 · 模拟导入 1 棵 · 有坐标 1 棵/);
  assert.doesNotMatch(text(tree), /现场实测：待接入/);
  assert.doesNotMatch(text(tree), /200 棵树仍为模拟/);
  assert.match(text(tree), /已导入档案 · 历史待补充/);
  assert.ok(button(tree, '导入与查看资料 →'));
});

test('data center mounts the field import view with the selected park and existing tree navigation', () => {
  const FieldTreeImport = () => null, onTree = stub;
  const Component = new Function('React', 'useState', 'sites', 'FieldTreeImport', dataCode + ';return DataCenter;')(React, initial => [initial, stub], sites, FieldTreeImport);
  const result = Component({site: 'xsbn', initialTab: 'field', onTree, onStory: stub, onNotify: stub});
  const child = React.Children.toArray(result.props.children).find(node => node.type === FieldTreeImport);
  assert.equal(child.props.site, 'xsbn'); assert.equal(child.props.onTree, onTree);
});

function catalogRoleHarness(readPark) {
  const reads=[],reloads=[],opened=[];
  const plotTrees=Array.from({length:33},(_,index)=>({treeId:`T-${String(index+1).padStart(4,'0')}`,provenance:{mode:'simulated'},quality:'valid'}));
  const allowed=['/api/demo/park?siteId=demo-hainan','/api/field/trees?siteId=demo-hainan'];
  const fixtures={
    [allowed[0]]:{trees:plotTrees,modules:{}},[allowed[1]]:empty(),
    '/api/demo/business-data':{records:[]},'/api/sources':{sources:[]},'/api/sources/coverage':{items:[]},
  };
  const bindings={React,useEffect:stub,sites,...catalogFunctions,...fieldFunctions,siteIdOf:site=>`demo-${site}`,
    useRead(path){
      if(path!==null){if(!readPark)assert.ok(allowed.includes(path),`forbidden source request: ${path}`);reads.push(path);}
      return {data:fixtures[path],reload(){assert.notEqual(path,null,'disabled sources must not be refreshed');reloads.push(path);}};
    }};
  const SourceCatalog=new Function(...Object.keys(bindings),dataCode+';return SourceCatalog;')(...Object.values(bindings));
  return {reads,reloads,opened,allowed,tree:SourceCatalog({site:'hainan',readPark,importEnabled:readPark,scopeLabel:readPark?undefined:'我的承包地 · 33 棵',
    onField:()=>opened.push('field'),onAnalytics:()=>opened.push('analytics'),onPublic:()=>opened.push('public')})};
}

test('grower source catalog reads and refreshes only scoped tree data, keeping 33-tree provenance and navigation',()=>{
  const h=catalogRoleHarness(false),visible=text(h.tree);
  assert.deepEqual(h.reads,h.allowed);
  assert.match(visible,/承包地块资料/);assert.match(visible,/我的承包地 · 33 棵/);assert.match(visible,/33 条记录/);
  assert.doesNotMatch(visible,/库存、加工与运输|公开来源目录|待补资料|读取失败|导入与查看资料/);
  button(h.tree,'重新读取目录').props.onClick();assert.deepEqual(h.reloads,h.allowed);
  button(h.tree,'查看现场资料 →').props.onClick();button(h.tree,'查看生产分析 →').props.onClick();
  assert.deepEqual(h.opened,['field','analytics']);
});

test('park readers retain business, public-source and coverage catalog requests and refresh',()=>{
  const h=catalogRoleHarness(true),expected=[...h.allowed,'/api/demo/business-data','/api/sources','/api/sources/coverage'].sort();
  assert.deepEqual([...h.reads].sort(),expected);
  const visible=text(h.tree);assert.match(visible,/园区与业务数据/);assert.match(visible,/库存、加工与运输/);assert.match(visible,/公开来源目录/);assert.match(visible,/待补资料/);
  button(h.tree,'重新读取目录').props.onClick();assert.deepEqual([...h.reloads].sort(),expected);
  button(h.tree,'导入与查看资料 →').props.onClick();button(h.tree,'查看公开参考 →').props.onClick();assert.deepEqual(h.opened,['field','public']);
});

test('grower tabs reject saved business/public destinations while retaining read-only field, plot analytics and collection views',()=>{
  const FieldTreeImport=()=>null,AnalyticsPage=()=>null,CollectionPoints=()=>null;
  const bindings={React,useState:initial=>[initial,stub],sites,can:(account,permission)=>account.permissions.includes(permission),FieldTreeImport,AnalyticsPage,CollectionPoints};
  const {DataCenter,SourceCatalog}=new Function(...Object.keys(bindings),dataCode+';return {DataCenter,SourceCatalog};')(...Object.values(bindings));
  const account={role:'grower',permissions:['plot.read'],plot:{label:'我的承包地',treeCount:33}};
  const props={account,site:'hainan',onTree:stub,onStory:stub,onNotify:stub};
  for(const initialTab of ['catalog','business','public']){
    const result=DataCenter({...props,initialTab}),children=React.Children.toArray(result.props.children);
    const nav=children.find(node=>node.type==='nav');assert.doesNotMatch(text(nav),/库存与流转|公开参考/);
    assert.match(text(nav),/胶价与收胶点.*地块产胶.*树木资料.*数据来源/);
    const catalog=children.find(node=>node.type===SourceCatalog);assert.ok(catalog);assert.equal(catalog.props.readPark,false);assert.equal(catalog.props.importEnabled,false);assert.equal(catalog.props.scopeLabel,'我的承包地 · 33 棵');
    assert.equal(button(nav,'数据来源').props['aria-pressed'],true);
  }
  for(const [initialTab,type] of [['field',FieldTreeImport],['analytics',AnalyticsPage],['collection',CollectionPoints]]){
    const child=React.Children.toArray(DataCenter({...props,initialTab}).props.children).find(node=>node.type===type);
    assert.ok(child);assert.equal(child.props.site,'hainan');
    if(initialTab==='field')assert.equal(child.props.readOnly,true);
    if(initialTab==='analytics')assert.equal(child.props.account,account);
  }
});
