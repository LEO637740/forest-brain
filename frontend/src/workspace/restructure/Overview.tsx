import type {RobotTarget} from '../robotCenterModel';
import {productionSites} from '../../../../shared/parkCatalog.ts';
import {BackendOverview} from '../../integration/StrategyWorkspace';
import {MapInventorySummary} from '../MapInventorySummary';
import type {SalesInventory} from '../../../../shared/salesShipments';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CloudSun,
  FlaskConical,
  MapPin,
  Route,
} from 'lucide-react';
import { getHomeTrend, getRecentLatex } from '../AnalyticsPage';
import type { Site, Task } from '../model';
import { sites } from '../model';
import { buildStationSummary, WEATHER_EVIDENCE } from './demoWeather';
import { OperationsMap } from './OperationsMap';
import type {TreeKind} from '../../integration/modelGenerationFlow';

type OverviewProps = {
  tasks: Task[];
  scope: 'all' | Site;
  allowedSites?: Site[];
  weatherStatus: string;
  weatherProgress: string;
  weatherWindow?: { start: string; end: string };
  salesInventory:SalesInventory|null;
  inventoryError?:string;
  onInventoryRefresh:()=>void;
  onInventoryData?:()=>void;
  onTree: (site: Site, index: number) => void;
  onMapScope: (scope: 'all' | Site) => void;
  onMapStrategy: (site: Site, index: number, kind: TreeKind) => void;
  onMapRobot: (site: Site, robot: RobotTarget) => void;
  onMapData: (site: Site) => void;
  onWeather: () => void;
  onSite: (site: Site) => void;
  onField: (site: Site) => void;
  onAnalysis: (site: Site) => void;
  onTask: (task: Task) => void;
};

type ViewMode = 'status' | 'progress' | 'latex';

const SITE_ORDER: Site[] = [...productionSites, 'xian'];

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function scopedLatex(scope: 'all' | Site) {
  if (scope === 'xian') return null;
  if (scope !== 'all') return getRecentLatex(scope, 7);
  return Number(productionSites.reduce((sum,site)=>sum+(getRecentLatex(site,7)??0),0).toFixed(1));
}

function trendFor(scope: 'all' | Site) {
  if (scope === 'xian') return [];
  if (scope !== 'all') return getHomeTrend(scope, 7);
  const series=productionSites.map(site=>getHomeTrend(site,7));
  return series[0].map((point,index)=>({
    date:point.date,actual:Number(series.reduce((sum,rows)=>sum+rows[index].actual,0).toFixed(1)),
  }));
}

function shortDate(value: string) {
  return value.slice(5).replace('-', '.');
}

function statusClass(status: Task['status']) {
  if (status === '已完成') return 'is-done';
  if (status === '执行中') return 'is-running';
  if (status === '已取消') return 'is-cancelled';
  return 'is-waiting';
}

export function Overview({
  tasks,
  scope,
  allowedSites,
  weatherStatus,
  weatherProgress,
  weatherWindow = { start: '08:00', end: '09:30' },
  salesInventory,
  inventoryError,
  onInventoryRefresh,
  onInventoryData,
  onTree,
  onMapScope,
  onMapStrategy,
  onMapRobot,
  onMapData,
  onWeather,
  onSite,
  onField,
  onAnalysis,
  onTask,
}: OverviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('status');
  const [showAllResults, setShowAllResults] = useState(false);
  const summary = useMemo(() => buildStationSummary(tasks, scope), [tasks, scope]);
  const visibleSites = scope === 'all' ? SITE_ORDER : [scope];
  const latex = useMemo(() => scopedLatex(scope), [scope]);
  const trend = useMemo(() => trendFor(scope), [scope]);
  const finished = useMemo(
    () => (scope === 'all' ? tasks : tasks.filter((task) => task.site === scope))
      .filter((task) => task.status === '已完成'),
    [tasks, scope],
  );

  const chart = useMemo(() => {
    if (!trend.length) return null;
    const width = 720;
    const height = 238;
    const pad = { left: 52, right: 20, top: 20, bottom: 40 };
    const values = trend.map((point) => point.actual);
    const min = Math.floor((Math.min(...values) - 5) / 10) * 10;
    const max = Math.ceil((Math.max(...values) + 5) / 10) * 10;
    const range = Math.max(1, max - min);
    const x = (index: number) => pad.left + (index / Math.max(1, trend.length - 1)) * (width - pad.left - pad.right);
    const y = (value: number) => pad.top + (1 - (value - min) / range) * (height - pad.top - pad.bottom);
    const path = trend.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.actual)}`).join(' ');
    const ticks = Array.from({ length: 4 }, (_, index) => Math.round(max - (index * range) / 3));
    return { width, height, pad, x, y, path, ticks };
  }, [trend]);

  return (
    <section className="rb-overview sx-overview" aria-labelledby="rb-overview-title">
      <header className="rb-overview-head">
        <div className="rb-overview-title-group">
          <h1 id="rb-overview-title">园区地图</h1>
          
        </div>
        {scope !== 'all' && (
          <button className="rb-weather-trigger" type="button" onClick={onWeather}>
            <CloudSun size={20} />
            <span><small>{sites[scope]}</small><strong>天气与作业窗口</strong></span>
            <ArrowRight size={18} />
          </button>
        )}
      </header>

      <OperationsMap tasks={tasks} scope={scope} allowedSites={allowedSites} onScope={onMapScope} onTree={onTree} onStrategy={onMapStrategy} onRobot={onMapRobot} onData={onMapData} onTask={onTask} onField={onField}/>
      <details className="sx-stats-disclosure"><summary>运营统计与执行记录</summary>
      <section className="rb-metric-strip" aria-label="当前范围关键指标">
        <article className="rb-metric">
          <span>当前任务</span>
          <strong>{summary.total}<small> 项</small></strong>
          <em>生产 {summary.production.length} · 试验 {summary.trial.length}</em>
        </article>
        <article className="rb-metric">
          <span>已完成</span>
          <strong>{summary.done}<small> 项</small></strong>
          <em>当前范围 · 任务状态</em>
        </article>
        <article className="rb-metric">
          <span>待安排与处理</span>
          <strong>{summary.waiting}<small> 项</small></strong>
          <em>含待开始与待处理</em>
        </article>
        <article className="rb-metric">
          <span>近 7 日胶乳</span>
          <strong>{latex === null ? '不可用' : <>{latex}<small> kg</small></>}</strong>
          <em>{scope === 'all' ? '云南、海南、广东 · 9 个模拟园区' : scope === 'xian' ? '现场试验无产量记录' : `${sites[scope]} · 记录值`}</em>
        </article>
      </section>

      <div className="rb-overview-grid">
        <div className="rb-overview-primary">
          <section className="rb-section rb-station-section" aria-labelledby="rb-station-title">
            <header className="rb-section-head">
              <div>
                <p>当前范围 · {scope === 'all' ? '全部站点' : sites[scope]}</p>
                <h2 id="rb-station-title">站点运行矩阵</h2>
              </div>
              <div className="rb-view-tabs" role="group" aria-label="站点矩阵显示内容">
                <button type="button" className={viewMode === 'status' ? 'is-active' : ''} aria-pressed={viewMode === 'status'} onClick={() => setViewMode('status')}>运行状态</button>
                <button type="button" className={viewMode === 'progress' ? 'is-active' : ''} aria-pressed={viewMode === 'progress'} onClick={() => setViewMode('progress')}>作业进度</button>
                <button type="button" className={viewMode === 'latex' ? 'is-active' : ''} aria-pressed={viewMode === 'latex'} onClick={() => setViewMode('latex')}>胶乳产量</button>
              </div>
            </header>

            <div className="rb-table-wrap">
              <table className="rb-station-table">
                <thead>
                  <tr><th scope="col">站点</th><th scope="col">类型</th><th scope="col">{viewMode === 'status' ? '任务状态' : viewMode === 'progress' ? '树次进度' : '近 7 日胶乳'}</th><th scope="col">入口</th></tr>
                </thead>
                <tbody>
                  {visibleSites.map((site) => {
                    const siteTasks = tasks.filter((task) => task.site === site);
                    const station = buildStationSummary(tasks, site);
                    const assigned = siteTasks.reduce((sum, task) => sum + task.count, 0);
                    const completed = siteTasks.reduce((sum, task) => sum + task.done, 0);
                    const siteLatex = getRecentLatex(site, 7);
                    return (
                      <tr key={site}>
                        <th scope="row">
                          <button className="rb-site-name" type="button" onClick={() => onSite(site)}><MapPin size={17} />{sites[site]}</button>
                        </th>
                        <td><span className={`rb-site-kind ${site === 'xian' ? 'is-trial' : ''}`}>{site === 'xian' && <FlaskConical size={14} />}{site==='xian'?'现场试验':'生产园区'}</span></td>
                        <td>
                          {viewMode === 'status' && (
                            <div className="rb-state-cell">
                              <div className="rb-state-bar" aria-label={`共 ${station.total} 项：完成 ${station.done}，执行中 ${station.running}，待安排与处理 ${station.waiting}，取消 ${station.cancelled}`}>
                                <i className="is-done" style={{ width: `${percent(station.done, station.total)}%` }} />
                                <i className="is-running" style={{ width: `${percent(station.running, station.total)}%` }} />
                                <i className="is-waiting" style={{ width: `${percent(station.waiting, station.total)}%` }} />
                                <i className="is-cancelled" style={{ width: `${percent(station.cancelled, station.total)}%` }} />
                              </div>
                              <p><span>完成 {station.done}</span><span>执行中 {station.running}</span><span>待安排与处理 {station.waiting}</span>{station.cancelled > 0 && <span>取消 {station.cancelled}</span>}</p>
                            </div>
                          )}
                          {viewMode === 'progress' && (
                            <div className="rb-progress-cell">
                              <div className="rb-progress-bar" aria-label={`已记录 ${completed} 树次，共安排 ${assigned} 树次`}><i style={{ width: `${percent(completed, assigned)}%` }} /></div>
                              <p><strong>{completed}</strong> / {assigned} 树次</p>
                            </div>
                          )}
                          {viewMode === 'latex' && (
                            <div className="rb-latex-cell">
                              {siteLatex === null ? <><strong>不可用</strong><span>现场试验无生产记录</span></> : <><strong>{siteLatex} kg</strong><span>2026-09-16 至 2026-09-22 · 记录值</span></>}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="rb-row-actions">
                            <button type="button" onClick={() => onField(site)}><Route size={15} />现场</button>
                            <button type="button" onClick={() => onAnalysis(site)}><BarChart3 size={15} />分析</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="rb-coverage-note"><summary>演示范围</summary><p>云南、海南、广东各 3 个园区，每园 200 棵树、A–D 四个分区；西安试验站单列。</p></details>
          </section>

          <section className="rb-section rb-trend-section" aria-labelledby="rb-trend-title">
            <header className="rb-section-head">
              <div><p>{scope === 'all' ? '9 个生产园区模拟合计' : scope === 'xian' ? '现场试验' : sites[scope]}</p><h2 id="rb-trend-title">近 7 日胶乳记录</h2></div>
              <span className="rb-data-badge">现有演示记录 · kg</span>
            </header>
            {chart ? (
              <>
                <div className="rb-chart-scroll">
                  <svg className="rb-line-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-labelledby="rb-chart-title rb-chart-desc">
                    <title id="rb-chart-title">近 7 日胶乳记录折线图</title>
                    <desc id="rb-chart-desc">{trend.map((point) => `${point.date} ${point.actual} 千克`).join('；')}</desc>
                    {chart.ticks.map((tick, index) => {
                      const y = chart.pad.top + index * (chart.height - chart.pad.top - chart.pad.bottom) / 3;
                      return <g key={tick}><line className="rb-chart-gridline" x1={chart.pad.left} y1={y} x2={chart.width - chart.pad.right} y2={y} /><text className="rb-chart-axis" x={chart.pad.left - 10} y={y + 4} textAnchor="end">{tick}</text></g>;
                    })}
                    <path className="rb-chart-line" d={chart.path} />
                    {trend.map((point, index) => <g key={point.date}><circle className="rb-chart-point" cx={chart.x(index)} cy={chart.y(point.actual)} r="4" /><text className="rb-chart-axis" x={chart.x(index)} y={chart.height - 14} textAnchor="middle">{shortDate(point.date)}</text></g>)}
                  </svg>
                </div>
                <details className="rb-chart-details">
                  <summary>查看图表明细</summary>
                  <table><thead><tr><th scope="col">日期</th><th scope="col">胶乳记录</th></tr></thead><tbody>{trend.map((point) => <tr key={point.date}><th scope="row">{point.date}</th><td>{point.actual} kg</td></tr>)}</tbody></table>
                </details>
              </>
            ) : (
              <div className="rb-empty-state"><FlaskConical size={24} /><strong>暂无生产记录</strong><p>西安为现场试验站点，不参与胶乳产量汇总。</p></div>
            )}
          </section>
        </div>

        <aside className="rb-decision-column" aria-label="决策与近期结果">
          <BackendOverview site={scope==='all'?null:scope} onWeather={onWeather}/>
          <MapInventorySummary site={scope==='all'?null:scope} inventory={salesInventory} error={inventoryError} onRefresh={onInventoryRefresh} onData={onInventoryData}/>
          <section className="rb-section rb-results-section" aria-labelledby="rb-results-title">
            <header className="rb-section-head"><div><p>来自当前任务记录</p><h2 id="rb-results-title">近期执行结果</h2></div><span>{finished.length} 项</span></header>
            {finished.length ? (
              <>
                <ul className="rb-result-list">
                  {(showAllResults ? finished : finished.slice(0, 4)).map((task) => (
                    <li key={task.id}>
                      <button type="button" onClick={() => onTask(task)}>
                        <CheckCircle2 size={18} />
                        <span><strong>{task.title}</strong><small>{sites[task.site]} · {task.block.endsWith('区') ? task.block : `${task.block}区`} · {task.done}/{task.count} 树次 · {task.end} 结束</small></span>
                        <span className={`rb-task-status ${statusClass(task.status)}`}>{task.status}</span>
                        <ArrowRight size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                {finished.length > 4 && <button className="rb-button rb-results-toggle" type="button" aria-expanded={showAllResults} onClick={() => setShowAllResults((value) => !value)}>{showAllResults ? '收起结果' : `查看全部 ${finished.length} 项结果`}</button>}
              </>
            ) : (
              <div className="rb-empty-state"><CheckCircle2 size={24} /><strong>暂无已完成记录</strong><p>当前范围内的任务尚未产生完成结果。</p></div>
            )}
          </section>
        </aside>
      </div>
      </details>
    </section>
  );
}


