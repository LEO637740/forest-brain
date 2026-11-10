import type {FieldTreeImport, FieldTreeRecord, FieldPolygon, FieldBoundaries} from '../../../shared/fieldTrees';
import {demoParkBoundary, demoZoneBoundary} from '../../../shared/demoSpatial.ts';
import type {Site} from './model';

export const fieldTreeChangedEvent = 'harness-field-data-changed';

export function fieldTreeTemplate(site: Site, observedAt = new Date().toISOString()): FieldTreeImport {
  return {
    siteId: `demo-${site}`, sourceName: '导入测试模板（模拟资料，请替换来源名称）', observedAt,
    provenanceMode: 'simulated', coordinateSystem: 'WGS84', elevationDatum: '',
    records: [{treeId: 'T-0001', sourceTreeId: '现场原树号示例', variety: null,
      circumferenceCm: null, heightM: null, measurementHeightM: null,
      latitude: null, longitude: null, elevationM: null}],
  };
}

export function fieldBoundaryTemplate(site: Site, observedAt = new Date().toISOString()): FieldTreeImport {
  const polygon = (points: {longitude: number; latitude: number}[]): FieldPolygon => {
    const ring: [number, number][] = points.map(point => [point.longitude, point.latitude]);
    return {type: 'Polygon', coordinates: [[...ring, ring[0]]]};
  };
  const template = fieldTreeTemplate(site, observedAt);
  delete template.elevationDatum;
  return {...template, sourceName: '边界导入模板（内置模拟坐标，请替换）', records: [], boundaries: {
    park: polygon(demoParkBoundary(site)),
    zones: (['A', 'B', 'C', 'D'] as const).map(zoneId => ({zoneId, polygon: polygon(demoZoneBoundary(site, zoneId))})),
  }};
}

function validateBoundaryPreview(value: unknown): asserts value is FieldBoundaries {
  const boundaries = value as FieldBoundaries;
  if (!boundaries || !Array.isArray(boundaries.zones) || boundaries.zones.length !== 4 ||
    new Set(boundaries.zones.map(zone => zone?.zoneId)).size !== 4 || boundaries.zones.some(zone => !['A','B','C','D'].includes(zone?.zoneId))) throw Error('边界需包含园区和 A、B、C、D 四个不同分区。');
  for (const polygon of [boundaries.park, ...boundaries.zones.map(zone => zone.polygon)]) {
    if (polygon?.type !== 'Polygon' || !Array.isArray(polygon.coordinates) || polygon.coordinates.length !== 1) throw Error('边界请使用单个闭合外环的 Polygon。');
    const ring = polygon.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 4 || ring.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) throw Error('边界坐标须为 WGS84 [经度, 纬度]，闭合外环至少需要四个点。');
    if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1] || new Set(ring.map(point => point.join(','))).size < 3) throw Error('边界至少需要三个不同顶点，末点须与首点相同。');
  }
}

/** Read a usable preview; business ranges are checked again by the save API. */
export function parseFieldTreeFile(content: string, site: Site): FieldTreeImport {
  let value: unknown;
  try {value = JSON.parse(content.replace(/^\uFEFF/, ''));}
  catch {throw Error('文件不是有效的 JSON，请按模板检查逗号、引号和括号。');}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('请导入模板格式的 JSON 资料包。');
  const input = value as Record<string, unknown>;
  if (input.siteId !== `demo-${site}`) throw Error('文件所属园区与当前园区不一致，请切换园区或修改文件中的 siteId。');
  if (typeof input.sourceName !== 'string' || !input.sourceName.trim()) throw Error('请填写资料来源 sourceName。');
  if (typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt))) throw Error('请填写有效的采集时间 observedAt。');
  if (!['measured', 'simulated'].includes(String(input.provenanceMode))) throw Error('provenanceMode 须为 measured（现场测量）或 simulated（模拟）。');
  if (input.coordinateSystem !== 'WGS84') throw Error('本模板使用 WGS84 经纬度，请在文件中明确 coordinateSystem 为 WGS84。');
  if (input.elevationDatum !== undefined && typeof input.elevationDatum !== 'string') throw Error('高程基准 elevationDatum 须填写文字说明。');
  if (typeof input.elevationDatum === 'string' && !input.elevationDatum.trim()) delete input.elevationDatum;
  if (input.boundaries !== undefined) validateBoundaryPreview(input.boundaries);
  if (!Array.isArray(input.records) || (!input.records.length && !input.boundaries)) throw Error('records 中至少需要一棵树的资料，或提供园区与分区 boundaries。');
  input.records.forEach((item, index) => {
    const row = index + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error(`第 ${row} 条记录须为树木资料对象。`);
    const record = item as Record<string, unknown>;
    if (typeof record.treeId !== 'string' || !/^T-\d{4}$/.test(record.treeId)) throw Error(`第 ${row} 条请填写映射树号，如 T-0001。`);
    if (record.variety !== null && typeof record.variety !== 'string') throw Error(`第 ${row} 条品种 variety 须为文字，未知时填 null。`);
    if (record.sourceTreeId !== undefined && typeof record.sourceTreeId !== 'string') throw Error(`第 ${row} 条原树号 sourceTreeId 须为文字。`);
    for (const key of ['circumferenceCm', 'heightM', 'measurementHeightM']) {
      if (record[key] !== null && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) throw Error(`第 ${row} 条 ${key} 须为数值，缺失时填 null。`);
    }
    for (const key of ['latitude', 'longitude', 'elevationM']) {
      if (record[key] !== undefined && record[key] !== null && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) throw Error(`第 ${row} 条 ${key} 须为数值，缺失时填 null。`);
    }
  });
  return input as unknown as FieldTreeImport;
}

export function fieldRecordSummary(items: readonly FieldTreeRecord[]) {
  return {
    measured: items.filter(item => item.provenanceMode === 'measured').length,
    simulated: items.filter(item => item.provenanceMode === 'simulated').length,
    positioned: items.filter(item => item.latitude != null && item.longitude != null).length,
    latest: items.map(item => item.observedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0],
  };
}

export function fieldTreeIndex(treeId: string) {return Number(treeId.slice(2)) - 1;}
