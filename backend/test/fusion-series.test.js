import test from 'node:test';
import assert from 'node:assert/strict';
import {ledgerSeries} from '../src/assistant-ledger-series.js';
test('ledger chart separates fresh and dry weights with Beijing date and missing records',()=>{
 const chart=ledgerSeries([{id:'b1',stage:'processed',weighing:{at:'2026-10-26T18:00:00Z',netKg:10.3},processing:{at:'2026-10-28T01:00:00Z',dryKg:3.03}},{id:'b2',stage:'cancelled',weighing:{at:'2026-10-27T01:00:00Z',netKg:100}}],{startDate:'2026-10-26',endDate:'2026-10-28'});
 assert.equal(chart.rows[0].latexKg,null);assert.equal(chart.rows[1].latexKg,10.3);assert.equal(chart.rows[1].dryKg,null);assert.equal(chart.rows[2].dryKg,3.03);assert.deepEqual(chart.sourceRefs,['b1']);
});
test('ledger chart rejects invalid and excessive date ranges',()=>{
 for(const range of [{startDate:'2026-02-30',endDate:'2026-03-01'},{startDate:'2026-10-28',endDate:'2026-10-27'},{startDate:'2026-01-01',endDate:'2026-10-27'}])assert.throws(()=>ledgerSeries([],range));
});
