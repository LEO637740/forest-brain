import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  CloudRain,
  Droplets,
  Layers3,
  Leaf,
  ListChecks,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
const DigitalTwinScene = lazy(()=>import('./DigitalTwinScene').then(module=>({default:module.DigitalTwinScene})));
import { IdentityRoot } from './workspace/IdentityGate';
import { anomalyData, attentions, layerModes, operations, yieldData } from "./data";

const iconMap = {
  plan: ListChecks,
  done: CheckCircle2,
  attention: AlertTriangle,
  robot: Bot,
  yield: Droplets,
};

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function DualLine({ actual, predicted }: { actual: number[]; predicted: number[] }) {
  const width = 250;
  const height = 72;
  const allValues = [...actual, ...predicted];
  const min = Math.min(...allValues) - 5;
  const max = Math.max(...allValues) + 5;

  const actualPoints = actual
    .map((value, index) => `${(index / (actual.length - 1)) * width},${height - ((value - min) / (max - min)) * height}`)
    .join(" ");

  const predictedPoints = predicted
    .map((value, index) => `${(index / (predicted.length - 1)) * width},${height - ((value - min) / (max - min)) * height}`)
    .join(" ");

  return (
    <svg className="mini-line" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="gradient-yield-actual" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#55d6a2" stopOpacity=".32" />
          <stop offset="1" stopColor="#55d6a2" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[18, 36, 54].map((y) => <line key={y} x1="0" x2={width} y1={y} y2={y} className="chart-grid" />)}
      <polygon points={`0,${height} ${actualPoints} ${width},${height}`} fill="url(#gradient-yield-actual)" />
      <polyline points={actualPoints} fill="none" stroke="#55d6a2" strokeWidth="2.5" />
      {actual.map((value, index) => (
        <circle key={`a-${index}`} cx={(index / (actual.length - 1)) * width} cy={height - ((value - min) / (max - min)) * height} r="3" fill="#55d6a2" />
      ))}
      <polyline points={predictedPoints} fill="none" stroke="#55d6a2" strokeWidth="2.5" strokeDasharray="6 5" opacity="0.7" />
      {predicted.map((value, index) => (
        <circle key={`p-${index}`} cx={(index / (predicted.length - 1)) * width} cy={height - ((value - min) / (max - min)) * height} r="3" fill="#55d6a2" opacity="0.7" />
      ))}
    </svg>
  );
}

function StackedBar({ data }: { data: typeof anomalyData }) {
  const width = 250;
  const height = 72;
  const barWidth = width / data.dates.length;
  const padding = barWidth * 0.25;

  const totals = data.dates.map((_, i) =>
    data.categories.reduce((sum, cat) => sum + cat.values[i], 0)
  );
  const maxTotal = Math.max(...totals);

  return (
    <svg className="mini-line" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {[18, 36, 54].map((y) => <line key={y} x1="0" x2={width} y1={y} y2={y} className="chart-grid" />)}
      {data.dates.map((_, dateIndex) => {
        let yOffset = height;
        const x = dateIndex * barWidth + padding;
        const w = barWidth - padding * 2;
        return (
          <g key={dateIndex}>
            {data.categories.map((cat, catIndex) => {
              const barHeight = (cat.values[dateIndex] / maxTotal) * height;
              const y = yOffset - barHeight;
              yOffset = y;
              return (
                <rect
                  key={catIndex}
                  x={x}
                  y={y}
                  width={w}
                  height={barHeight}
                  fill={cat.color}
                  opacity={0.85}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function TopBar({ onHome }: { onHome: () => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="恢复首页默认状态">
        <span className="brand-mark"><Leaf size={23} /></span>
        <span className="brand-copy"><strong>橡胶大脑运营中心</strong><small>RUBBER FOREST INTELLIGENCE</small></span>
      </button>
      <nav className="region-tabs" aria-label="地区选择">
        <button className="active">海南</button>
        <button>西双版纳</button>
        <button>西安</button>
      </nav>
      <div className="topbar-spacer" />
      <time>{formatClock(now)}</time>
      <label className="search-box"><Search size={15} /><input placeholder="搜索林区、设备或任务" /></label>
      <span className="system-state"><i />系统正常</span>
      <button className="icon-button" aria-label="通知"><Bell size={18} /><b>2</b></button>
      <button className="profile"><span><UserRound size={17} /></span><em>林场管理员</em></button>
    </header>
  );
}

function TodayOperations() {
  return (
    <aside className="panel today-panel">
      <div className="panel-heading"><div><span className="eyebrow">TODAY</span><h2>今日运营</h2></div><span className="sim-badge">模拟</span></div>
      <p className="panel-intro">海南示范胶园 · 今日作业概览</p>
      <div className="operations-list">
        {operations.map((item) => {
          const Icon = iconMap[item.key];
          return (
            <button className="operation-row" key={item.key}>
              <span className={`metric-icon ${item.tone}`}><Icon size={19} /></span>
              <span className="metric-copy"><small>{item.label}</small><strong>{item.value}<em>{item.unit}</em></strong><span className={item.tone}>{item.meta}</span></span>
              <ChevronRight size={15} className="row-chevron" />
            </button>
          );
        })}
      </div>
      <div className="operations-footer"><ShieldCheck size={15} /><span>最近同步</span><strong>10 秒前</strong></div>
    </aside>
  );
}

function IntelligentAttention() {
  const typeIcon = [CloudRain, AlertTriangle, TrendingUp, Sparkles];
  return (
    <aside className="panel attention-panel">
      <div className="panel-heading"><div><span className="eyebrow">INTELLIGENCE</span><h2>智能关注</h2></div><button className="text-button">全部 <ChevronRight size={14} /></button></div>
      <p className="panel-intro">按风险与影响范围排序</p>
      <div className="attention-list">
        {attentions.map((item, index) => {
          const Icon = typeIcon[index];
          return (
            <button className="attention-card" key={item.title}>
              <span className={`attention-icon ${item.tone}`}><Icon size={18} /></span>
              <span className="attention-body">
                <span className="attention-meta"><em>{item.kind}</em><i className={item.tone}>{item.level}</i></span>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <small>{item.meta}</small>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function Analytics() {
  return (
    <section className="bottom-analytics">
      <article className="analytics-card weather-card">
        <header><span><CloudRain size={17} />天气与作业窗口</span><small>海南</small></header>
        <div className="weather-main"><strong>27°</strong><span>多云，午后短时阵雨</span><dl><div><dt>湿度</dt><dd>82%</dd></div><div><dt>风速</dt><dd>2.4 m/s</dd></div></dl></div>
        <div className="work-window"><span className="safe" /><span className="safe" /><span className="safe" /><span className="caution" /><span className="caution" /><span className="rain" /></div>
        <div className="window-labels"><span>06</span><span>10</span><span>14</span><span>18</span><span>22</span></div>
      </article>
      <article className="analytics-card progress-card">
        <header><span><ListChecks size={17} />今日作业进度</span><small>148 项</small></header>
        <div className="progress-content">
          <div className="donut"><span><strong>58.1%</strong><small>完成率</small></span></div>
          <ul><li><i className="green" />已完成 <strong>86</strong></li><li><i className="blue" />进行中 <strong>31</strong></li><li><i className="muted" />待开始 <strong>22</strong></li><li><i className="amber" />需关注 <strong>9</strong></li></ul>
        </div>
      </article>
      <article className="analytics-card trend-card">
        <header><span><Droplets size={17} />产胶趋势 <em>kg</em></span><div className="range-tabs"><button className="active">近7天</button><button>近30天</button></div></header>
        <div className="trend-summary"><strong>54</strong><span>今日实际</span><em>+8.0%</em></div>
        <DualLine actual={yieldData.actual} predicted={yieldData.predicted} />
        <div className="chart-days"><span>06.08</span><span>06.10</span><span>06.12</span><span>今天</span></div>
        <div className="legend"><span><i className="green" />实际产量</span><span><i className="green-dashed" />预计产量</span></div>
      </article>
      <article className="analytics-card trend-card anomaly-card">
        <header><span><AlertTriangle size={17} />异常趋势</span><div className="range-tabs"><button className="active">近7天</button><button>近30天</button></div></header>
        <div className="trend-summary"><strong>11</strong><span>今日累计</span><em className="amber-text">-2</em></div>
        <StackedBar data={anomalyData} />
        <div className="chart-days"><span>06.08</span><span>06.10</span><span>06.12</span><span>今天</span></div>
        <div className="legend">
          <span><i className="red" />异常累积</span>
          <span><i className="blue" />防治异常</span>
          <span><i className="green" />设备异常</span>
          <span><i className="muted" />其他</span>
        </div>
      </article>
    </section>
  );
}

function LegacySceneApp() {
  const [activeLayer, setActiveLayer] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const reset = () => { setActiveLayer(0); setResetKey((key) => key + 1); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "r") reset(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const sceneLabel = useMemo(() => activeLayer === 0 ? "海南 · 标准化生产胶园" : `海南 · ${layerModes[activeLayer]}图层`, [activeLayer]);
  return (
    <main className="app-shell">
      <Suspense fallback={<div role="status">正在加载胶园空间…</div>}><DigitalTwinScene resetKey={resetKey} activeLayer={activeLayer} /></Suspense>
      <div className="scene-vignette" />
      <TopBar onHome={reset} />
      <section className="scene-title">
        <span><MapPin size={14} />海南 / HN-01</span>
        <h1>{sceneLabel}</h1>
        <p>气温18°-20° · 热带季风气候 · 总面积12,800㎡</p>
      </section>
      <TodayOperations />
      <IntelligentAttention />
      <div className="map-tools" aria-label="场景工具"><button className="active">3D</button><button disabled>2D</button><button onClick={reset} title="恢复默认镜头">R</button></div>
      <nav className="layer-switcher" aria-label="场景图层">
        <span className="layers-symbol"><Layers3 size={18} /></span>
        {layerModes.map((label, index) => <button className={index === activeLayer ? "active" : ""} key={label} onClick={() => setActiveLayer(index)}>{label}</button>)}
        <span className="scale-bar"><span>500</span><span>1,000</span><span>2,000米</span></span>
      </nav>
      <Analytics />
    </main>
  );
}

export function App() {
  const params = new URLSearchParams(location.search);
  return params.has('sample') || params.has('sceneOnly') ? <LegacySceneApp /> : <IdentityRoot />;
}
