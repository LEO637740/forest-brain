import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {parseAst, transformWithOxc} from 'vite';
import * as map from '../src/workspace/spatial/geoMapModel.ts';

const size = {width: 900, height: 520};
const initial = {center: {longitude: 110.3, latitude: 19.8}, zoom: 11};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≈ ${expected}`);

test('WGS84 points round-trip through the OSM pixel grid and keep north upward', () => {
  for (const point of [{longitude: 0, latitude: 0}, initial.center, {longitude: -73.98, latitude: 40.75}]) {
    const result = map.unprojectPoint(map.projectPoint(point, 18), 18);
    near(result.longitude, point.longitude); near(result.latitude, point.latitude);
  }
  assert.deepEqual(map.projectPoint({longitude: 0, latitude: 0}, 0), {x: 128, y: 128});
  const origin = map.screenPoint(initial.center, initial, size);
  assert.deepEqual(origin, {x: 450, y: 260});
  assert.ok(map.screenPoint({...initial.center, latitude: 19.9}, initial, size).y < origin.y);
  assert.ok(map.screenPoint({...initial.center, longitude: 110.4}, initial, size).x > origin.x);
});

test('only tiles intersecting the current viewport are requested, with canonical HTTPS URLs', () => {
  const tiles = map.visibleTiles(initial, size);
  assert.ok(tiles.length <= 20);
  for (const tile of tiles) {
    assert.match(tile.url, /^https:\/\/tile\.openstreetmap\.org\/11\/\d+\/\d+\.png$/);
    assert.ok(tile.left < size.width && tile.left + 256 > 0);
    assert.ok(tile.top < size.height && tile.top + 256 > 0);
  }
  const worldEdge = map.visibleTiles({center: {longitude: -179.99, latitude: 85}, zoom: 2}, size);
  assert.ok(worldEdge.every(tile => {const [, x, y] = new URL(tile.url).pathname.slice(1).replace('.png', '').split('/').map(Number);return x >= 0 && x < 4 && y >= 0 && y < 4;}));
});

test('views past z19 enlarge z19 tiles so 3 m plantation rows stay readable', () => {
  assert.equal(map.MAX_ZOOM, 21);assert.equal(map.TILE_MAX_ZOOM, 19);
  const close = {center: {longitude: 110.3, latitude: 19.8}, zoom: 21};
  const tiles = map.visibleTiles(close, size);
  assert.ok(tiles.length > 0 && tiles.length <= 6);
  assert.ok(tiles.every(tile => /^https:\/\/tile\.openstreetmap\.org\/19\//.test(tile.url) && tile.size === 1024));
  // The enlarged z19 tile still sits under the same coordinates as an exact z21 projection.
  const tile = tiles[0], [, x, y] = new URL(tile.url).pathname.slice(1).replace('.png', '').split('/').map(Number);
  const corner = map.unprojectPoint({x: x * 256, y: y * 256}, 19), pixel = map.screenPoint(corner, close, size);
  near(pixel.x, tile.left); near(pixel.y, tile.top);
  const metresPerPixel = 40075016.68557849 * Math.cos(19.8 * Math.PI / 180) / (256 * 2 ** 21);
  assert.ok(3 / metresPerPixel > 40, 'trees 3 m apart are more than 40 px apart at z21');
});

test('fitting a park includes all coordinates at equal pixel scale and fits the antimeridian locally', () => {
  const points = [{longitude: 110.3001, latitude: 19.8002}, {longitude: 110.302, latitude: 19.8018}, {longitude: 110.3011, latitude: 19.8009}];
  const view = map.fitMapView(points, size);
  assert.ok(view.zoom >= 17 && view.zoom <= 19);
  for (const point of points) {
    const pixel = map.screenPoint(point, view, size);
    assert.ok(pixel.x >= 64 && pixel.x <= size.width - 64);
    assert.ok(pixel.y >= 64 && pixel.y <= size.height - 64);
  }
  assert.equal(map.fitMapView([points[0]], size).zoom, 18);
  assert.equal(map.fitMapView([], size), null);
  assert.ok(map.fitMapView([{longitude: 179.9, latitude: 0}, {longitude: -179.9, latitude: 0}], size).zoom > 10);
});

test('dragging preserves the point under the cursor and zooming preserves its anchor', () => {
  const point = {longitude: 110.32, latitude: 19.79}, before = map.screenPoint(point, initial, size);
  const afterPan = map.screenPoint(point, map.panView(initial, {x: 70, y: -35}), size);
  near(afterPan.x, before.x + 70); near(afterPan.y, before.y - 35);
  const anchor = {x: 150, y: 120}, center = map.projectPoint(initial.center, initial.zoom);
  const underPointer = map.unprojectPoint({x: center.x + anchor.x - size.width / 2, y: center.y + anchor.y - size.height / 2}, initial.zoom);
  const zoomed = map.zoomView(initial, 12, anchor, size), anchored = map.screenPoint(underPointer, zoomed, size);
  near(anchored.x, anchor.x); near(anchored.y, anchor.y);
  assert.equal(map.zoomView(initial, 30, anchor, size).zoom, map.MAX_ZOOM);
  assert.equal(map.zoomView(initial, -5, anchor, size).zoom, 0);
});

const {code} = await transformWithOxc(readFileSync(new URL('../src/workspace/spatial/GeoMapCanvas.tsx', import.meta.url), 'utf8'), 'GeoMapCanvas.tsx', {lang: 'tsx', jsx: {runtime: 'classic'}});
const declarations = parseAst(code).body.filter(node => node.type !== 'ImportDeclaration').map(node => code.slice(node.start, node.end).replace(/^export /, '')).join('\n');
function walk(element, predicate) {if (!React.isValidElement(element)) return [];return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => walk(child, predicate))];}
function mount(patch = {}) {
  let cursor = 0, element;const slots = [], changes = [], clicked = [];
  const bindings = {React, ...map, useEffect() {}, useMemo: fn => fn(),
    useState(initialValue) {const index = cursor++;if (!(index in slots)) slots[index] = initialValue?.width === 0 ? size : initialValue;return [slots[index], next => {slots[index] = typeof next === 'function' ? next(slots[index]) : next;}];},
    useRef(initialValue) {const index = cursor++;if (!(index in slots)) slots[index] = {current: initialValue};return slots[index];},
  };
  const Component = new Function(...Object.keys(bindings), declarations + ';return GeoMapCanvas;')(...Object.values(bindings));
  const props = {...initial, markers: [{id: 'T-0001', position: initial.center, label: 'T-0001', kind: 'tree', tone: 'measured'}], onMarker: id => clicked.push(id), onViewChange: view => changes.push(view), ...patch};
  function render() {cursor = 0;element = Component(props);return element;}
  render();return {render, changes, clicked, get element() {return element;}, find: label => walk(element, node => node.props['aria-label'] === label)[0]};
}

test('markers open their IDs, controls and keyboard emit the changed view, attribution stays visible', () => {
  const h = mount();
  h.find('T-0001').props.onClick();assert.deepEqual(h.clicked, ['T-0001']);
  h.find('放大地图').props.onClick();h.render();assert.equal(h.changes.at(-1).zoom, 12);
  h.find('缩小地图').props.onClick();h.render();assert.equal(h.changes.at(-1).zoom, 11);
  const currentTarget = {};let prevented = false;
  h.element.props.onKeyDown({target: currentTarget, currentTarget, key: 'ArrowRight', preventDefault() {prevented = true;}});h.render();
  assert.ok(prevented);assert.ok(h.changes.at(-1).center.longitude > initial.center.longitude);
  const attribution = walk(h.element, node => node.type === 'a')[0];
  assert.equal(attribution.props.href, 'https://www.openstreetmap.org/copyright');
  assert.equal(attribution.props.children, '© OpenStreetMap contributors');
});

test('nearby trees keep their own coordinates and remain individually selectable', () => {
  const center={longitude:110.3,latitude:19.8};
  const markers=[{id:'a',label:'树 A',kind:'tree',position:center},{id:'b',label:'树 B',kind:'tree',position:{...center,longitude:center.longitude+.00001}}];
  const h=mount({center,zoom:19,markers});
  assert.ok(h.find('树 A'));assert.ok(h.find('树 B'));
  h.find('树 A').props.onClick();h.find('树 B').props.onClick();
  assert.deepEqual(h.clicked,['a','b']);
  const a=map.screenPoint(markers[0].position,{center,zoom:19},size);
  const b=map.screenPoint(markers[1].position,{center,zoom:19},size);
  assert.equal(h.find('树 A').props.style.left,a.x);assert.equal(h.find('树 B').props.style.left,b.x);
});

test('selected tree keeps priority while other trees remain individually selectable', () => {
  const markers=[{id:'a',label:'树 A',kind:'tree',position:initial.center,selected:true},{id:'b',label:'树 B',kind:'tree',position:initial.center}];
  const h=mount({markers});
  assert.match(h.element.props.className,/gm-has-selected-tree/);
  h.find('树 A').props.onClick();h.find('树 B').props.onClick();
  assert.deepEqual(h.clicked,['a','b']);
});

test('drag movement shifts overlays without requesting more tiles until release', () => {
  const h = mount(), before = walk(h.element, node => node.type === 'img').map(node => node.props.src);
  const currentTarget = {setPointerCapture() {}, releasePointerCapture() {}, focus() {}}, target = {closest() {return null;}};
  h.element.props.onPointerDown({button: 0, pointerId: 1, clientX: 10, clientY: 10, currentTarget, target});
  h.element.props.onPointerMove({pointerId: 1, clientX: 310, clientY: 10});h.render();
  assert.deepEqual(walk(h.element, node => node.type === 'img').map(node => node.props.src), before);
  assert.equal(h.changes.length, 0);
  h.element.props.onPointerUp({pointerId: 1, clientX: 310, clientY: 10, currentTarget});h.render();
  assert.equal(h.changes.length, 1);assert.ok(h.changes[0].center.longitude < initial.center.longitude);
});

test('a failed tile keeps point selection usable and boundaries render only when supplied', () => {
  const h = mount();
  assert.equal(walk(h.element, node => node.type === 'path').length, 0);
  walk(h.element, node => node.type === 'img')[0].props.onError();h.render();
  assert.equal(walk(h.element, node => node.props.role === 'status')[0].props.children, '部分底图未加载，可继续查看点位');
  h.find('T-0001').props.onClick();assert.deepEqual(h.clicked, ['T-0001']);
  const boundary = mount({boundary: [initial.center, {longitude: 110.31, latitude: 19.8}, {longitude: 110.3, latitude: 19.81}]});
  assert.match(walk(boundary.element, node => node.type === 'path')[0].props.d, /^M.* L.* L.* Z$/);
});

test('all park areas stay labelled and selectable with the selected area highlighted', () => {
  const areas = [...'ABCD'].map((id, index) => ({id: `zone:${id}`, label: `${id}区`, selected: id === 'B', tone: 'simulated', points: [
    {longitude: 110.30 + index * .003, latitude: 19.8}, {longitude: 110.302 + index * .003, latitude: 19.8},
    {longitude: 110.302 + index * .003, latitude: 19.802}, {longitude: 110.30 + index * .003, latitude: 19.802},
  ]}));
  const h = mount({areas});
  assert.equal(walk(h.element, node => node.type === 'path').length, 4);
  for (const id of 'ABCD') {
    const label = h.find(`查看${id}区`);
    assert.equal(label.props['aria-pressed'], id === 'B');
    label.props.onClick();
  }
  assert.deepEqual(h.clicked, ['zone:A', 'zone:B', 'zone:C', 'zone:D']);
  assert.match(walk(h.element, node => node.props['data-map-area'] === 'zone:B')[0].props.className, /gm-area-selected/);
  h.find('T-0001').props.onClick();
  assert.equal(h.clicked.at(-1), 'T-0001');
});

test('a click inside a park area selects it while dragging inside it still pans the map', () => {
  const h = mount();
  const currentTarget = {setPointerCapture() {}, releasePointerCapture() {}, focus() {}};
  const target = {closest(selector) {return selector === '[data-map-area]' ? {getAttribute() {return 'zone:C';}} : null;}};
  const down = {button: 0, pointerId: 1, clientX: 100, clientY: 100, currentTarget, target};
  h.element.props.onPointerDown(down);
  h.element.props.onPointerUp({...down, clientX: 101});h.render();
  assert.deepEqual(h.clicked, ['zone:C']);
  assert.equal(h.changes.length, 0);
  h.element.props.onPointerDown(down);
  h.element.props.onPointerMove({...down, clientX: 220});h.render();
  h.element.props.onPointerUp({...down, clientX: 220});h.render();
  assert.deepEqual(h.clicked, ['zone:C']);
  assert.equal(h.changes.length, 1);
  assert.ok(h.changes[0].center.longitude < initial.center.longitude);
});
