import {useEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, PointerEvent} from 'react';
import {fitMapView, mapScale, mapZoom, MAX_ZOOM, panView, screenPoint, visibleTiles, zoomView} from './geoMapModel';
import type {GeoPoint, GeoView, MapSize, PixelPoint} from './geoMapModel';
import './geo-map.css';

export type {GeoPoint, GeoView} from './geoMapModel';
/** `size` is the bubble diameter in pixels for producer markers; `pinned` keeps the label visible. */
export type GeoMarker = {id: string; position: GeoPoint; label: string; kind: 'site' | 'tree' | 'zone' | 'planned' | 'producer' | 'org'; selected?: boolean; tone?: 'measured' | 'simulated'; detail?: string; size?: number; pinned?: string; labelSide?: 'below' | 'above' | 'left' | 'right'};
export type GeoArea = {id: string; label: string; points: GeoPoint[]; selected?: boolean; tone?: 'measured' | 'simulated'};
export type GeoMapCanvasProps = {center: GeoPoint; zoom: number; markers: GeoMarker[]; onMarker: (id: string) => void; onViewChange?: (view: GeoView) => void; fitPoints?: GeoPoint[]; boundary?: GeoPoint[]; areas?: GeoArea[]; showAreaLabels?:boolean; ariaLabel?: string};

export function GeoMapCanvas({center, zoom, markers, onMarker, onViewChange, fitPoints, boundary, areas = [], showAreaLabels=true, ariaLabel = '地理地图'}: GeoMapCanvasProps) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapSize>({width: 0, height: 0});
  const [view, setView] = useState<GeoView>({center, zoom: mapZoom(zoom)});
  const [offset, setOffset] = useState<PixelPoint>({x: 0, y: 0});
  const [tileStates, setTileStates] = useState<Record<string, 'loaded' | 'error'>>({});
  const drag = useRef<{pointerId: number; x: number; y: number; areaId: string | null} | null>(null);
  const live = useRef({view, size, onViewChange});
  live.current = {view, size, onViewChange};
  const fitKey = fitPoints?.map(point => `${point.longitude},${point.latitude}`).join(';') ?? '';

  const updateView = (next: GeoView) => {setView(next); live.current.view = next; onViewChange?.(next);};

  useEffect(() => {
    const element = root.current!;
    const resize = () => setSize({width: element.clientWidth, height: element.clientHeight});
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {setView({center: {longitude: center.longitude, latitude: center.latitude}, zoom: mapZoom(zoom)});}, [center.longitude, center.latitude, zoom]);

  useEffect(() => {
    const next = fitMapView(fitPoints ?? [], size);
    if (next) {setView(next); live.current.view = next; live.current.onViewChange?.(next);}
  }, [fitKey, size.width, size.height]);

  useEffect(() => {
    const element = root.current!;
    let lastWheelAt = -Infinity;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0 || performance.now() - lastWheelAt < 160) return;
      lastWheelAt = performance.now();
      const rect = element.getBoundingClientRect(), current = live.current;
      const next = zoomView(current.view, current.view.zoom + (event.deltaY < 0 ? 1 : -1), {x: event.clientX - rect.left, y: event.clientY - rect.top}, current.size);
      setView(next); live.current.view = next; current.onViewChange?.(next);
    };
    element.addEventListener('wheel', wheel, {passive: false});
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const tiles = useMemo(() => size.width > 0 && size.height > 0 ? visibleTiles(view, size) : [], [view, size]);
  const loading = tiles.some(tile => !tileStates[tile.id]), failed = tiles.some(tile => tileStates[tile.id] === 'error');
  const scale = mapScale(view);
  const boundaryPath = boundary && boundary.length > 2 ? boundary.map((point, index) => {const pixel = screenPoint(point, view, size);return `${index ? 'L' : 'M'}${pixel.x},${pixel.y}`;}).join(' ') + ' Z' : null;
  const projectedAreas = areas.map(area => {
    const points = area.points.map(point => screenPoint(point, view, size));
    const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x));
    const top = Math.min(...points.map(point => point.y));
    return {...area, path: points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') + ' Z', labelPosition: {x: (left + right) / 2, y: top - 14}};
  });
  const layerStyle = {transform: `translate(${offset.x}px, ${offset.y}px)`};

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('button, a')) return;
    drag.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, areaId: target.closest('[data-map-area]')?.getAttribute('data-map-area') ?? null};
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    setOffset({x: event.clientX - drag.current.x, y: event.clientY - drag.current.y});
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const delta = {x: event.clientX - drag.current.x, y: event.clientY - drag.current.y};
    const areaId = drag.current.areaId;
    drag.current = null; setOffset({x: 0, y: 0});
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (areaId && Math.hypot(delta.x, delta.y) < 4) onMarker(areaId);
    else updateView(panView(view, delta));
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const directions: Record<string, PixelPoint> = {ArrowLeft: {x: 100, y: 0}, ArrowRight: {x: -100, y: 0}, ArrowUp: {x: 0, y: 100}, ArrowDown: {x: 0, y: -100}};
    if (directions[event.key]) {event.preventDefault();updateView(panView(view, directions[event.key]));}
    else if (['+', '=', '-'].includes(event.key)) {event.preventDefault();changeZoom(view.zoom + (event.key === '-' ? -1 : 1));}
  }
  function changeZoom(nextZoom: number) {updateView(zoomView(view, nextZoom, {x: size.width / 2, y: size.height / 2}, size));}

  return <div ref={root} className={`gm-canvas${offset.x || offset.y ? ' gm-dragging' : ''}${markers.some(marker=>marker.kind==='tree'&&marker.selected)?' gm-has-selected-tree':''}`} role="region" aria-label={ariaLabel} tabIndex={0}
    onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => {drag.current = null;setOffset({x: 0, y: 0});}} onKeyDown={keyboard}>
    <div className="gm-tiles" style={layerStyle} aria-hidden="true">{tiles.map(tile => <img key={tile.id} src={tile.url} alt="" draggable={false} referrerPolicy="strict-origin-when-cross-origin" width={tile.size} height={tile.size} style={{left: tile.left, top: tile.top, width: tile.size, height: tile.size}}
      onLoad={() => setTileStates(states => ({...states, [tile.id]: 'loaded'}))} onError={() => setTileStates(states => ({...states, [tile.id]: 'error'}))}/>)}</div>
    <div className="gm-overlays" style={layerStyle}>
      {boundaryPath && <svg className="gm-boundary" width={size.width} height={size.height} aria-hidden="true"><path d={boundaryPath}/></svg>}
      {projectedAreas.length > 0 && <svg className="gm-areas" width={size.width} height={size.height} aria-hidden="true">{projectedAreas.map(area => <path key={area.id} className={`gm-area${area.selected ? ' gm-area-selected' : ''}`} d={area.path} data-map-area={area.id}/>)}</svg>}
      {showAreaLabels&&projectedAreas.map(area => <button key={area.id} type="button" className={`gm-area-label${area.selected ? ' gm-area-selected' : ''}`} style={{left: area.labelPosition.x, top: area.labelPosition.y}} aria-label={`查看${area.label}`} aria-pressed={Boolean(area.selected)} onClick={() => onMarker(area.id)}>{area.label}<span aria-hidden="true">›</span></button>)}
      {markers.map(marker => {const point = screenPoint(marker.position, view, size);return <button key={marker.id} type="button" className={`gm-marker gm-marker-${marker.kind}${marker.selected ? ' gm-selected' : ''}${marker.tone ? ` gm-${marker.tone}` : ''}${marker.pinned ? ' gm-pinned' : ''}${marker.labelSide ? ` gm-label-${marker.labelSide}` : ''}`}
        style={{left: point.x, top: point.y, ...(marker.size ? {'--gm-bubble': `${marker.size}px`} : {})} as CSSProperties} aria-label={marker.detail ? `${marker.label}，${marker.detail}` : marker.label} aria-pressed={Boolean(marker.selected)} title={marker.detail ? `${marker.label} · ${marker.detail}` : marker.label} onClick={() => onMarker(marker.id)}>
        <span className="gm-marker-dot" aria-hidden="true"/><span className="gm-marker-label">{marker.pinned && <span className="gm-pinned-text">{marker.pinned}</span>}<span className="gm-full-text">{marker.label}</span>{marker.kind !== 'tree' && marker.kind !== 'producer' && <span className="gm-marker-arrow" aria-hidden="true">›</span>}</span></button>;})}
    </div>
    <div className="gm-controls" aria-label="地图缩放"><button type="button" aria-label="放大地图" onClick={() => changeZoom(view.zoom + 1)} disabled={view.zoom === MAX_ZOOM}>+</button><button type="button" aria-label="缩小地图" onClick={() => changeZoom(view.zoom - 1)} disabled={view.zoom === 0}>−</button>
      {fitPoints && fitPoints.length > 0 && <button type="button" className="gm-fit" onClick={() => {const next = fitMapView(fitPoints, size);if (next) updateView(next);}}>适配</button>}</div>
    <span className="gm-navigation-hint">拖动移动 · 滚轮缩放</span>
    {(failed || loading) && <span className={`gm-tile-status${failed ? ' gm-tile-failed' : ''}`} role="status">{failed ? '部分底图未加载，可继续查看点位' : '底图加载中…'}</span>}
    <div className="gm-scale" aria-label={`地图比例尺 ${scale.label}`}><span style={{width: scale.pixels}}/>{scale.label}</div>
    <a className="gm-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
  </div>;
}
