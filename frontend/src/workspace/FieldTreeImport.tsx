import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {post, read, siteIdOf} from '../integration/client';
import type {FieldTreeCatalog, FieldTreeImport as FieldTreeImportData, FieldTreeInput, FieldTreeRecord, FieldBoundaries} from '../../../shared/fieldTrees';
import {sites, type Site} from './model';
import {catalogTime} from './dataCatalog';
import {fieldTreeChangedEvent, fieldTreeIndex, fieldTreeTemplate, fieldBoundaryTemplate, fieldRecordSummary, parseFieldTreeFile} from './fieldImportModel';
import {FieldSpatialMap} from './FieldSpatialMap';
import {GeoMapCanvas} from './spatial/GeoMapCanvas';
import {fieldBoundaryPoints} from './spatial/spatialCatalog';
import './fieldTreeImport.css';

export function downloadFieldTreeTemplate(site: Site, boundaries = false) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(boundaries ? fieldBoundaryTemplate(site) : fieldTreeTemplate(site), null, 2)], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `${site}-${boundaries ? '园区分区边界' : '树木资料'}导入模板.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FieldTreeImport({site, onTree, readOnly = false}: {site: Site; onTree: (index: number) => void; readOnly?: boolean}) {
  const [catalog, setCatalog] = useState<FieldTreeCatalog | null>(null);
  const [draft, setDraft] = useState<FieldTreeImportData | null>(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRead = useRef(0);
  const path = `/api/field/trees?siteId=${siteIdOf(site)}`;
  const reload = async () => {
    try {const data = await read<FieldTreeCatalog>(path); setCatalog(data); setReadError('');}
    catch (failure) {setReadError((failure as Error).message);}
  };
  useEffect(() => {
    let active = true;
    read<FieldTreeCatalog>(path).then(data => {if (active) {setCatalog(data); setReadError('');}}, failure => {if (active) setReadError(failure.message);});
    return () => {active = false; fileRead.current++;};
  }, [path]);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const revision = ++fileRead.current;
    setDraft(null); setError(''); setMessage(''); setFilename(file?.name ?? '');
    if (!file) return;
    try {
      const next = parseFieldTreeFile(await file.text(), site);
      if (revision === fileRead.current) setDraft(next);
    } catch (failure) {if (revision === fileRead.current) setError((failure as Error).message);}
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await post<FieldTreeCatalog>('/api/field/trees', draft);
      setCatalog(saved); setReadError(''); setDraft(null);
      setMessage(`${draft.boundaries ? '已保存园区及 A–D 分区边界。' : ''}已保存 ${saved.savedCount ?? draft.records.length} 棵树资料，当前园区共有 ${saved.importedCount} 棵已导入档案。`);
      window.dispatchEvent(new CustomEvent(fieldTreeChangedEvent, {detail: {siteId: siteIdOf(site)}}));
      try {setCatalog(await read<FieldTreeCatalog>(path));}
      catch (failure) {setReadError(`资料已保存，重新读取失败：${(failure as Error).message}`);}
    } catch (failure) {setError((failure as Error).message);}
    finally {setBusy(false);}
  }

  const items = catalog?.items ?? [], summary = fieldRecordSummary(items);
  return <div className="fi-page">
    {readError && <p className="fi-error" role="status">档案读取失败：{readError} <button type="button" disabled={busy} onClick={() => void reload()}>重试</button></p>}
    {!readOnly && <section className="dc-panel fi-import" aria-label="树木资料导入">
      <header><div><h2>导入树木与边界</h2><p>{sites[site]} · 选择 JSON 文件，预览后保存</p></div><button type="button" onClick={() => downloadFieldTreeTemplate(site)}>下载 JSON 模板</button><button type="button" onClick={() => downloadFieldTreeTemplate(site, true)}>下载边界 JSON 模板</button></header>
      <details className="fi-format"><summary>文件格式与填写说明</summary><p>将现场原树号填写到 sourceTreeId，并映射到现有 T-0001—T-0200。树围单位 cm，树高和测量高度单位 m；未知字段填 null。经纬度使用 WGS84，地面高程请同时注明基准。</p>
      <p>边界模板包含园区及 A–D 四个分区的 Polygon，坐标顺序为 [经度, 纬度]，外环首尾相同。请替换模板模拟坐标；可单独导入边界，也可与树木资料一并保存。新观测边界替换地图显示，原导入记录保留。</p>
      <p>同树较新的观测会更新当前档案，原始记录保留。</p></details>
      <p className="fi-note">模板为模拟资料；导入实际测量时，请在预览中选择“现场测量”并核对来源与采集时间。</p>
      <label className="fi-file">选择 JSON 资料文件<input aria-label="选择树木资料文件" type="file" accept=".json,application/json" disabled={busy} onChange={event => void selectFile(event)}/></label>
      {error && <p className="fi-error" role="alert">{error}</p>}
      {message && <p className="fi-success" role="status">{message}</p>}
      {draft && <section className="fi-preview" aria-label="导入资料预览">
        <h3>预览 · {filename} · {draft.records.length} 棵树{draft.boundaries?' · 园区与 4 个分区边界':''}</h3>
        <div className="fi-fields"><label>资料来源<input aria-label="资料来源" value={draft.sourceName} disabled={busy} onChange={event => setDraft({...draft, sourceName: event.target.value})}/></label><label>来源类别<select aria-label="资料来源类别" value={draft.provenanceMode} disabled={busy} onChange={event => setDraft({...draft, provenanceMode: event.target.value as FieldTreeImportData['provenanceMode']})}><option value="simulated">模拟资料 / 测试导入</option><option value="measured">现场测量</option></select></label></div>
        <p>采集时间：{catalogTime(draft.observedAt)}（北京时间） · 坐标系：{draft.coordinateSystem} · 高程基准：{draft.elevationDatum || '未提供'}</p>
        <button type="button" disabled={busy || !draft.sourceName.trim()} onClick={() => void save()}>{busy ? '正在保存…' : '保存本批资料'}</button>
        {draft.boundaries&&<FieldBoundaryPreview boundaries={draft.boundaries} mode={draft.provenanceMode}/>}
        {draft.records.length>0&&<FieldTreeTable records={draft.records}/>}
      </section>}
    </section>}
    {catalog?.boundaries&&<section className="dc-panel" aria-label="已保存园区边界"><h2>当前园区与分区边界</h2><p>{catalog.boundaries.provenanceMode==='measured'?'现场测量':'模拟资料'} · {catalog.boundaries.sourceName} · 采集 {catalogTime(catalog.boundaries.observedAt)} · 保存 {catalogTime(catalog.boundaries.importedAt)}（北京时间）</p><FieldBoundaryPreview boundaries={catalog.boundaries} mode={catalog.boundaries.provenanceMode}/></section>}
    <FieldSpatialMap items={items} onTree={onTree}/>
    <section className="dc-panel" aria-label="已保存树木档案">
      <header><div><h2>当前园区导入档案</h2><p>现场测量 {summary.measured} 棵 · 模拟导入 {summary.simulated} 棵 · 已提供坐标 {summary.positioned} 棵</p></div><button type="button" disabled={busy} onClick={() => void reload()}>重新读取档案</button></header>
      {!catalog && !readError ? <p role="status">正在读取已保存资料…</p> : items.length ? <FieldTreeTable records={items} onTree={onTree}/> : <p className="fi-note">当前园区尚未导入资料，可从上方下载模板。</p>}
    </section>

  </div>;
}

function FieldBoundaryPreview({boundaries,mode}:{boundaries:FieldBoundaries;mode:'measured'|'simulated'}){
  const boundary=fieldBoundaryPoints(boundaries.park);
  const areas=boundaries.zones.map(zone=>({id:`zone:${zone.zoneId}`,label:`${zone.zoneId}区`,points:fieldBoundaryPoints(zone.polygon),tone:mode}));
  return <div aria-label="园区与分区边界预览"><p>园区外环 {boundary.length} 个顶点 · {areas.map(area=>`${area.label} ${area.points.length} 个顶点`).join(' · ')} · WGS84</p><div style={{height:320}}><GeoMapCanvas center={boundary[0]} zoom={17} markers={[]} boundary={boundary} areas={areas} fitPoints={[...boundary,...areas.flatMap(area=>area.points)]} onMarker={()=>{}} ariaLabel="导入边界预览地图"/></div></div>;
}

function FieldTreeTable({records, onTree}: {records: (FieldTreeInput | FieldTreeRecord)[]; onTree?: (index: number) => void}) {
  const value = (input: number | null | undefined, unit: string) => input == null ? '未提供' : `${input} ${unit}`;
  return <div className="dc-table fi-table"><table><thead><tr><th>映射树号 / 原树号</th><th>品种</th><th>树围 / 测量高度</th><th>树高</th><th>经纬度 / 地面高程</th>{onTree && <th>来源与采集时间</th>}</tr></thead><tbody>{records.map((record, index) => <tr key={`${record.treeId}:${index}`}><td>{onTree ? <button type="button" onClick={() => onTree(fieldTreeIndex(record.treeId))}>{record.treeId} · 查看档案</button> : <strong>{record.treeId}</strong>}<small>{record.sourceTreeId || '原树号未提供'}</small></td><td>{record.variety || '未提供'}</td><td>{value(record.circumferenceCm, 'cm')}<small>测量高度 {value(record.measurementHeightM, 'm')}</small></td><td>{value(record.heightM, 'm')}</td><td>{record.longitude == null || record.latitude == null ? '坐标未提供' : `${record.longitude}, ${record.latitude}`}<small>地面高程 {value(record.elevationM, 'm')}</small></td>{onTree && 'recordId' in record && <td>{record.provenanceMode === 'measured' ? '现场测量' : '模拟导入'}<small>{record.sourceName}</small><small>采集 {catalogTime(record.observedAt)}</small><small>保存 {catalogTime(record.importedAt)}</small></td>}</tr>)}</tbody></table></div>;
}
