import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc,parseAst} from 'vite';
import {makeParkContext} from '../../backend/src/adapters/park-demo.js';
import {RuleGenerator} from '../../backend/src/capabilities/rules.js';
import {strategyEvidenceRows,evidenceForReferences} from '../src/integration/strategyEvidenceData.ts';
import {recordTime,recordSource} from '../src/integration/treeEvidence.ts';

const now=new Date('2026-10-19T00:00:00Z');
const context=makeParkContext({treeIds:['T-0001','T-0012'],now});
const candidate=await new RuleGenerator().generate({kind:'market_scenario',context,now});
const s={...candidate,kind:'market_scenario'};
const file=new URL('../src/integration/StrategyEvidence.tsx',import.meta.url);
const {code}=await transformWithOxc(readFileSync(file,'utf8'),file.pathname,{lang:'tsx',jsx:{runtime:'classic'}});
const names=['EvidenceTable','StrategyEvidenceContent'];
const body=parseAst(code).body.filter(node=>node.type==='ExportNamedDeclaration'&&names.includes(node.declaration?.id?.name)).map(node=>code.slice(node.declaration.start,node.declaration.end)).join('\n');
const Content=new Function('React','strategyEvidenceRows','evidenceForReferences','recordTime','recordSource',body+';return StrategyEvidenceContent;')(React,strategyEvidenceRows,evidenceForReferences,recordTime,recordSource);

test('market reasons resolve to the frozen price, demand, cost and weather values',()=>{
 const rows=strategyEvidenceRows(context);
 const related=evidenceForReferences(rows,candidate.reasons[1].sourceRefs);
 for(const title of ['干胶价格','需求指数','经营测算假设','现场天气','土壤水分'])assert.ok(related.some(row=>row.title===title),title);
 assert.equal(related.filter(row=>row.title==='干胶价格').length,context.modules.market.prices.length);
 assert.ok(related.some(row=>row.value.includes(`${context.modules.market.prices.at(-1).value} 元/kg 干胶`)));
 assert.ok(related.every(row=>row.provenance.mode==='simulated'));
});

test('evidence view connects each reason to values and shows excluded tree health with source and time',()=>{
 const html=renderToStaticMarkup(React.createElement(Content,{s,context}));
 assert.match(html,/查看关联数据|本轮树木档案（2 棵）|T-0012 树木档案|健康：需关注/);
 assert.ok(html.includes(context.modules.market.demand.observationId));
 assert.ok(html.includes(recordTime(context.modules.market.demand.observedAt)));
 assert.match(html,/模拟记录|每树每次作业成本|元\/kg 干胶/);
});

test('referencing a panel includes its independent latex measurements without duplicating rows',()=>{
 const panel=context.modules.tapping.panels[0];
 const rows=strategyEvidenceRows(context);
 const related=evidenceForReferences(rows,[panel.panelId,panel.provenance.sourceId,panel.panelId]);
 assert.equal(related.filter(row=>row.id===panel.panelId).length,1);
 assert.ok(related.some(row=>row.title.includes('胶乳黏度')));
 assert.ok(related.some(row=>row.title.includes('干胶含量')));
});

test('imported dimensions and original tree status keep separate sources in frozen evidence',()=>{
 const input=structuredClone(context),tree=input.modules.trees[0];
 tree.circumferenceCm=68;
 tree.fieldRecord={recordId:'field-measured-test',sourceTreeId:'现场测试树号',sourceName:'隔离测试表',observedAt:'2026-10-18T03:00:00Z',provenance:{sourceId:'field-measured-test',sourceClass:'farmer_expert',mode:'measured'}};
 const rows=evidenceForReferences(strategyEvidenceRows(input),[tree.treeId]);
 assert.equal(rows.length,2);
 assert.equal(rows[0].provenance.mode,'measured');
 assert.ok(rows[0].value.includes('68 cm'));
 assert.equal(rows[0].at,tree.fieldRecord.observedAt);
 assert.equal(rows[1].provenance.mode,'simulated');
 assert.ok(rows[1].value.includes('健康'));
 const html=renderToStaticMarkup(React.createElement(Content,{s,context:input}));
 assert.match(html,/本轮树木档案（2 棵）/);
 assert.match(html,/实测记录 · 胶农与专家通道/);
});
