import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldTreeTemplate, fieldBoundaryTemplate, parseFieldTreeFile, fieldRecordSummary, fieldTreeIndex} from '../src/workspace/fieldImportModel.ts';

test('download template is scoped, explicitly simulated, and keeps unmeasured values empty', () => {
  const input = fieldTreeTemplate('xsbn', '2026-10-20T02:00:00Z');
  assert.equal(input.siteId, 'demo-xsbn');
  assert.equal(input.provenanceMode, 'simulated');
  assert.match(input.sourceName, /测试模板.*模拟/);
  assert.equal(input.coordinateSystem, 'WGS84');
  assert.equal(input.elevationDatum, '');
  assert.equal(input.records[0].circumferenceCm, null);
  assert.equal(input.records[0].latitude, null);
  const {elevationDatum, ...expected} = input;
  assert.deepEqual(parseFieldTreeFile(JSON.stringify(input), 'xsbn'), expected);
});

test('preview preserves actual values, source tree identifiers and missing measurements', () => {
  const input = {...fieldTreeTemplate('hainan'), sourceName: '现场树号表', provenanceMode: 'measured', elevationDatum: '项目水准基准', records: [{treeId: 'T-0051', sourceTreeId: 'B-原树07', variety: '热研', circumferenceCm: 54.2, heightM: null, measurementHeightM: 1.3, latitude: 19.8, longitude: 110.3, elevationM: 46}]};
  const parsed = parseFieldTreeFile('\uFEFF' + JSON.stringify(input), 'hainan');
  assert.deepEqual(parsed, input);
  assert.equal(fieldTreeIndex(parsed.records[0].treeId), 50);
});

test('bad files and another park cannot become a preview for the current park', () => {
  assert.throws(() => parseFieldTreeFile('{bad', 'hainan'), /JSON/);
  assert.throws(() => parseFieldTreeFile(JSON.stringify(fieldTreeTemplate('xsbn')), 'hainan'), /园区不一致/);
  const input = fieldTreeTemplate('hainan'); input.records[0].heightM = 'unknown';
  assert.throws(() => parseFieldTreeFile(JSON.stringify(input), 'hainan'), /第 1 条 heightM/);
  input.records = [];
  assert.throws(() => parseFieldTreeFile(JSON.stringify(input), 'hainan'), /至少需要一棵/);
});

test('source counts distinguish measurements from simulated imports and incomplete coordinates', () => {
  const result = fieldRecordSummary([
    {provenanceMode: 'measured', observedAt: '2026-10-19T01:00:00Z', latitude: 19.8, longitude: 110.3},
    {provenanceMode: 'simulated', observedAt: '2026-10-20T01:00:00Z', latitude: null, longitude: null},
    {provenanceMode: 'measured', observedAt: '2026-10-18T01:00:00Z', latitude: null, longitude: 110.3},
  ]);
  assert.deepEqual(result, {measured: 2, simulated: 1, positioned: 1, latest: '2026-10-20T01:00:00Z'});
});

test('boundary template previews an explicitly simulated park and four closed polygons without tree records', () => {
  const input = fieldBoundaryTemplate('xsbn', '2026-10-20T02:00:00Z');
  assert.equal(input.provenanceMode, 'simulated');
  assert.deepEqual(input.records, []);
  assert.deepEqual(input.boundaries.zones.map(zone => zone.zoneId), ['A','B','C','D']);
  assert.deepEqual(parseFieldTreeFile(JSON.stringify(input), 'xsbn'), input);
  input.boundaries.park.coordinates[0].pop();
  assert.throws(() => parseFieldTreeFile(JSON.stringify(input), 'xsbn'), /末点须与首点相同/);
});
