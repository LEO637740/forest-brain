import {useEffect, useState} from 'react';
import {useRead, siteIdOf, type Park} from '../integration/client';
import {PublicMarket} from '../integration/PublicMarket';
import {PublicWeather} from '../integration/PublicWeather';
import {IndustryRecords} from '../integration/IndustryRecords';
import {BusinessRecords} from './BusinessRecords';
import {officialSourceUrl, type PublicSources} from '../integration/publicMarketData';
import {AnalyticsPage, type AnalyticsTopic} from './AnalyticsPage';
import {CollectionPoints} from './CollectionPoints';
import {FieldTreeImport} from './FieldTreeImport';
import {fieldRecordSummary, fieldTreeChangedEvent} from './fieldImportModel';
import type {FieldTreeCatalog} from '../../../shared/fieldTrees';
import {sites, type Site, type Story} from './model';
import {catalogSourceState, catalogTime, recordSummary, sourcePeriod, type CatalogRecord} from './dataCatalog';
import {can, type DemoAccount} from './identityModel';
import './dataCenter.css';

type Props = {account?: DemoAccount|null; site: Site; initialTab?: DataTab; initialReference?: PublicReferenceTab; initialAnalysis?: AnalyticsTopic; onTasks?: () => void; onStory: (story: Story, index?: number) => void; onTree: (index: number) => void; onNotify: (message: string) => void};
type Sources = PublicSources & {location?: {name?: string; confirmed?: boolean}};
type Coverage = {items: {id: string; category: string; requirement: string; boundary: string; fields: string[]; status: string}[]};
type BusinessData = {mode?: string; asOf?: string; records: (CatalogRecord & {topic: string; title?: string})[]};
export type DataTab = 'catalog' | 'field' | 'analytics' | 'business' | 'collection' | 'public';
export type PublicReferenceTab = 'market' | 'weather' | 'industry';

export function DataCenter(props: Props) {
  const isGrower = props.account?.role === 'grower';
  const [tab, setTab] = useState<DataTab>(props.initialTab ?? (isGrower ? 'collection' : 'catalog'));
  const [reference, setReference] = useState<PublicReferenceTab>(props.initialReference ?? 'market');
  const canReadPark = !props.account || can(props.account, 'site.read');
  const canImportField = !props.account || can(props.account, 'field.import');
  const activeTab = !canReadPark && (tab === 'business' || tab === 'public') ? 'catalog' : tab;
  const catalogScope = props.account?.plot ? `${props.account.plot.label} · ${props.account.plot.treeCount} 棵` : undefined;
  const tabs:[DataTab,string][] = isGrower
    ? [['collection', '胶价与收胶点'], ['analytics', '地块产胶'], ['field', '树木资料'], ['catalog', '数据来源'], ['business', '库存与流转'], ['public', '公开参考']]
    : [['catalog', '数据来源'], ['field', '现场资料'], ['analytics', '生产分析'], ['business', '库存与流转'], ['collection', '收胶点与加工厂'], ['public', '公开参考']];
  return <div className="dc-page"><header className="dc-heading"><div><h1>{isGrower ? '胶价与收益' : '数据中心'}</h1><p>{catalogScope ? `${sites[props.site]} · ${catalogScope}` : sites[props.site]}</p></div></header>
    <nav className="dc-tabs" aria-label="数据中心视图">{tabs.filter(([id]) => !['business', 'public'].includes(id) || canReadPark).map(([id, label]) => <button key={id} aria-pressed={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {activeTab === 'catalog' ? <SourceCatalog site={props.site} readPark={canReadPark} importEnabled={canImportField} scopeLabel={catalogScope} onField={() => setTab('field')} onAnalytics={() => setTab('analytics')} onPublic={() => setTab('public')}/> : activeTab === 'field' ? <FieldTreeImport readOnly={!canImportField} key={props.site} site={props.site} onTree={props.onTree}/> : activeTab === 'analytics' ? <AnalyticsPage key={`${props.site}:${props.initialAnalysis??'trend'}`} {...props} initialTopic={props.initialAnalysis}/> : activeTab === 'business' ? canReadPark ? <BusinessRecords key={props.site} site={props.site} onTasks={props.onTasks}/> : <p>当前身份可在生产分析中查看承包地块记录。</p> : activeTab === 'collection' ? <CollectionPoints site={props.site}/> : <div className="dc-public"><nav className="dc-subtabs" aria-label="公开参考主题">{([['market','行情与政策'],['weather','天气'],['industry','行业资料']] as const).map(([id,label]) => <button key={id} aria-pressed={reference === id} onClick={() => setReference(id)}>{label}</button>)}</nav>{reference === 'market' ? <><p className="dc-reference-note">公开行情按交易日或统计期展示，来源与适用条件随记录保留。</p><PublicMarket site={props.site}/></> : reference === 'weather' ? <><p className="dc-reference-note">按当前园区配置坐标获取的区域预报，来源与更新时间见下方。</p><PublicWeather site={props.site}/></> : <IndustryRecords/>}</div>}
  </div>;
}

function SourceCatalog({site, readPark=true, importEnabled=true, scopeLabel, onField, onAnalytics, onPublic}: {site: Site; readPark?:boolean; importEnabled?:boolean; scopeLabel?:string; onField: () => void; onAnalytics: () => void; onPublic: () => void}) {
  const sources = useRead<Sources>(readPark ? '/api/sources' : null);
  const park = useRead<Park>(`/api/demo/park?siteId=${siteIdOf(site)}`);
  const business = useRead<BusinessData>(readPark ? '/api/demo/business-data' : null);
  const coverage = useRead<Coverage>(readPark ? '/api/sources/coverage' : null);
  const field = useRead<FieldTreeCatalog>(`/api/field/trees?siteId=${siteIdOf(site)}`);
  const imported = fieldRecordSummary(field.data?.items ?? []);
  useEffect(() => {
    const reload = () => {field.reload(); park.reload();};
    window.addEventListener(fieldTreeChangedEvent, reload);
    return () => window.removeEventListener(fieldTreeChangedEvent, reload);
  }, [site]);
  const modules = park.data?.modules;
  const visibleScope = scopeLabel ?? `${sites[site]}演示园区`;
  const groups: {name: string; records: CatalogRecord[]; scope: string; note: string}[] = [
    {name: '单树档案', records: park.data?.trees || [], scope: scopeLabel ?? sites[site], note: field.data?.importedCount ? `已导入 ${field.data.importedCount} 棵：现场测量 ${imported.measured} 棵、模拟导入 ${imported.simulated} 棵。` : field.error ? '现场资料目录读取失败，见逐条来源。' : '尚未导入现场资料，当前为模拟档案。'},
    {name: '现场环境', records: modules?.weather?.observed ? [modules.weather.observed] : [], scope: visibleScope, note: '温湿度与雨量按记录来源标注，空值为缺失。'},
    {name: '生长测量', records: modules?.growth?.measurements || [], scope: visibleScope, note: '历史测量与预测分别展示。'},
    {name: '树表与巡查', records: [...(modules?.inspection?.evidence || []), ...(modules?.health?.records || [])], scope: visibleScope, note: '巡查影像与健康标记，需结合人工核查。'},
    ...(readPark ? [{name: '库存、加工与运输', records: business.data?.records || [], scope: '虚构演示企业 · 非所选园区实况', note: '独立企业样例，用于展示加工与运输数据。'}] : []),
  ];
  const refresh = () => {park.reload(); field.reload(); if(readPark){sources.reload(); business.reload(); coverage.reload();}};
  return <div className="dc-catalog"><section className="dc-intro"><div><h2>数据来源概览</h2></div><button onClick={refresh}>重新读取目录</button></section>
    
    <section className="dc-panel"><header><div><h2>现场树木资料</h2></div><button onClick={onField}>{importEnabled ? '导入与查看资料 →' : '查看现场资料 →'}</button></header>{field.error ? <p className="dc-warning" role="status">现场资料目录读取失败：{field.error}</p> : !field.data ? <p role="status">正在读取现场资料目录…</p> : <p>已保存 {field.data.importedCount} 棵 · 现场测量 {imported.measured} 棵 · 模拟导入 {imported.simulated} 棵 · 有坐标 {imported.positioned} 棵。最近采集：{catalogTime(imported.latest)}。</p>}</section>
    <section className="dc-panel"><header><div><h2>{readPark ? '园区与业务数据' : '承包地块资料'}</h2></div><button onClick={onAnalytics}>查看生产分析 →</button></header>
      <div className="dc-table"><table><thead><tr><th>数据范围</th><th>来源类别 / 数量</th><th>最近记录时间</th><th>当前状态</th></tr></thead><tbody>{groups.map(group => {const info = recordSummary(group.records); const service = group.name === '库存、加工与运输' ? business : park; return <tr key={group.name}><td><strong>{group.name}</strong><small>{group.scope}</small></td><td>{info.label}<small>{info.count ? `${info.count} 条记录` : '尚无可确认记录'}</small></td><td>{catalogTime(info.latest)}</td><td><span className={service.error || !info.count || info.issues ? 'dc-warning' : ''}>{service.error ? `读取失败：${service.error}` : !service.data ? '正在读取' : !info.count ? '未提供' : info.issues ? `${info.issues} 条质量待核验` : '已读取'}</span><details><summary>来源说明</summary><p>{group.note}</p></details></td></tr>;})}</tbody></table></div>
    </section>
    {readPark&&<><section className="dc-panel"><header><div><h2>公开来源目录</h2><p>天气参考点：{sources.data?.location?.name || '待配置'}{sources.data?.location?.confirmed ? ' · 区域预报' : ' · 待确认'}</p></div><button onClick={onPublic}>查看公开参考 →</button></header>
      {!sources.data ? <p role="status">{sources.error ? `公开来源读取失败：${sources.error}` : '正在读取公开来源…'}</p> : sources.data.sources.length ? <div className="dc-source-grid">{sources.data.sources.map(source => {const state = catalogSourceState(source); const url = officialSourceUrl(source); return <article key={source.id}><div className="dc-source-title"><strong>{source.title || source.id}</strong><span className={state.warning ? 'dc-warning' : 'dc-available'}>{state.label}</span></div><p>{source.id === 'weather' ? '预测数据 · 区域模型预报' : '公开资料 · 保留原统计口径'}</p><dl><dt>提供方</dt><dd>{source.provider || '未提供'}</dd><dt>统计期 / 预报期</dt><dd>{sourcePeriod(source.data)}</dd><dt>获取时间</dt><dd>{catalogTime(source.retrievedAt)}</dd><dt>有效期至</dt><dd>{catalogTime(source.validUntil)}</dd></dl>{source.lastError && <p className="dc-warning">最近更新异常：{source.lastError.message || source.lastError.code || '原因未提供'}</p>}{url && <a href={url} target="_blank" rel="noreferrer">核对原始来源 ↗</a>}</article>;})}</div> : <p role="status">尚无公开来源记录。</p>}
      {sources.data && sources.error && <p className="dc-warning" role="status">重新读取失败，保留上次目录：{sources.error}</p>}
    </section>
    <section className="dc-panel"><header><div><h2>待补资料</h2></div></header>
      <details className="dc-collection-guide"><summary>资料准备建议</summary><ol className="dc-confirm"><li><strong>确认对象与责任人</strong><span>园区 / 地块 / 树号、机器人编号、审核人与任务执行人。</span></li><li><strong>提供一条完整业务样例</strong><span>观测 → 策略审核 → 割胶任务 → 产量回执 → 运输安排，附时间、单位与来源。</span></li><li><strong>远程核对异常场景</strong><span>降雨、设备故障、数据缺失和人工驳回；确认任务与运输如何暂停或恢复。</span></li></ol></details>
      {coverage.data ? <div className="dc-gap-list">{coverage.data.items.filter(item => item.status !== 'public_reference_available').map(item => {
        const hasTreeImports = item.id === 'trees' && Boolean(field.data?.importedCount);
        return <details key={item.id}><summary>{item.requirement} <span>{hasTreeImports ? '已导入档案 · 历史待补充' : item.status === 'business_data_required' ? '待业务资料' : item.status === 'partial' ? '公开参考不完整' : '公开来源不可用'}</span></summary><p>{hasTreeImports ? `已保存 ${field.data!.importedCount} 棵树的导入档案，现场测量与模拟导入分别标注；真实行、地块映射和作业历史仍需补充。` : item.boundary}</p><p>远程确认字段：{item.fields.join('、')}</p></details>;
      })}</div> : <p role="status">{coverage.error ? `来源覆盖清单读取失败：${coverage.error}` : '正在读取资料清单…'}</p>}
    </section></>}
  </div>;
}
