import {landscapeSurround,surroundHeight} from './landscapeSurround';
import {createTerraceWorkPaths} from './terraceWorkPaths';
import {terracedTerrainHeight} from './terracedTerrain';
import type {DemoRobotMotion} from './workspace/demoRobotMotion';
import {parks, sites, type Site} from '../../shared/parkCatalog.ts';
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createGroundVisuals } from "./groundVisuals";
import { installGroundSample } from "./groundSample";
import { createSampleGroundCover } from "./sampleGroundCover";
import { prepareTreeGeometry, prepareTreeMaterial, chooseTreeLOD } from "./treeVisuals";
import {railViewLOD} from './railViewBudget';
import { addMorningLighting } from "./morningLighting";
import { addSampleLighting } from "./sampleLighting";
import { addHomeTidewaterLighting } from "./homeTidewaterLighting";
import { HOME_VISUAL_PROFILE, useHomeVisualProfile, useEnvironmentRelease, useNaturalRelease } from "./homeVisualProfile";
import { upgradeNaturalEnvironment } from "./environmentVegetation";
import { createEnvironmentLayout } from "./environmentLayout";
import type { EnvironmentLayout } from "./environmentLayout";
import { mountEnvironmentAssetRegistry, ENVIRONMENT_SITE_CONFIG, type EnvironmentSite } from "./environmentAssetRegistry";
import { installHomeRailPilot } from './homeRailPilot';
import { jointSampleYaw, RAIL_JOINT_SAMPLE } from './railJointSample';
import {installZoneFleet} from './zoneFleetScene';
import {installObservationCamera} from './observation/observationCamera';
import {zoneFocusCenter,selectedSceneTrees} from './sceneFocus';
import {ALLEY_CAMERA_OFFSET,sceneTreeLayout,sceneZoneBox,treeScale,type TreeProfile} from './sceneTreeLayout';
const alleyCamera=()=>new THREE.Vector3(ALLEY_CAMERA_OFFSET.x,ALLEY_CAMERA_OFFSET.y,ALLEY_CAMERA_OFFSET.z);

type DemoMotion = {treeIndex:number|null;stage:'travel'|'work';phase:string};
type Props = { getDemoMotions?:()=>DemoRobotMotion[]; selectableTrees?:number[]; demoMotion?:DemoMotion; resetKey: number; activeLayer: number; visible?: boolean; selectedTree?: number | null; focusKey?:number; focusZone?:number|null; onTreeSelect?: (index:number)=>void; selectedTrees?:number[]; selectionMode?:'point'|'box'|'off'; onTreesSelect?:(indices:number[])=>void; site?: Site ; treeProfiles?: TreeProfile[] };
type Archetype = "A" | "B" | "C";
type LODLevel = 0 | 1 | 2 | 3;
type TreeRecord = {
  x: number;
  z: number;
  scale: number;
  rotation: number;
  archetype: Archetype;
  lod: LODLevel;
};
type SourcePart = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  nodeMatrix: THREE.Matrix4;
};
type AssetArchetype = Archetype | "V20";
type TreeBatch = { archetype: AssetArchetype; lod: LODLevel; part: number; mesh: THREE.InstancedMesh };

type RuntimeSnapshot = {
  viewport: [number, number];
  renderBuffer: [number, number];
  pixelRatio: number;
  frameSamples: number;
  gpuSamples: number;
  treeCount: number;
  businessTreeCount: number;
  environmentTreeCount: number;
  naturalVegetationCount: number;
  smallTreeCount: number;
  shrubCount: number;
  distantProxyCount: number;
  totalVisualTreeCount: number;
  fps: number;
  frameMsP95: number;
  gpuMsMedian: number | null;
  gpuMsP95: number | null;
  drawCalls: number;
  triangles: number;
  lodCounts: [number, number, number, number];
  environmentLodCounts: [number, number, number, number];
  firstGroveFrameMs: number | null;
  allAssetsReadyMs: number | null;
  loadedLods: number[];
};

declare global {
  interface Window {
    __HAINAN_RUNTIME__?: {
      getMetrics: () => RuntimeSnapshot;
      benchmarkCounts: (counts?: number[], sampleMs?: number) => Promise<RuntimeSnapshot[]>;
      setTreeLimit: (count: number) => void;
      focusArchetype: (archetype: Archetype) => void;
      resetCamera: () => void;
    };
  }
}

const TREE_ASSET_ROOT = "/assets/trees/mature-family-v1";
const ARCHETYPES: Archetype[] = ["A", "B", "C"];
const LOD_LEVELS: LODLevel[] = [3, 2, 1, 0];

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const terrainHeight = terracedTerrainHeight;

function baseLandscapeHeight(x: number, z: number) {
  const base = terrainHeight(x, z);
  const sideBlend = THREE.MathUtils.smoothstep(Math.abs(x), 116, 218);
  const farBlend = THREE.MathUtils.smoothstep(-z, 72, 208);
  const nearBlend = THREE.MathUtils.smoothstep(z, 105, 180);
  const distantHills = farBlend * (
    9.5 +
    Math.sin(x * 0.018) * 5.2 +
    Math.cos((x - z) * 0.012) * 2.6
  );
  const sideShoulders = sideBlend * (2.6 + Math.sin(z * 0.024) * 1.8);
  const nearShoulder = nearBlend * (1.4 + Math.cos(x * 0.016) * 1.2);
  return base + distantHills + sideShoulders + nearShoulder;
}
const landscapeHeight = baseLandscapeHeight;

// Visual-only swale in the sample, following the existing drainage alignment.
// The tree placement height, road centerlines and business coordinates stay untouched.
const SAMPLE_DRAIN = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-65,0,-74), new THREE.Vector3(-51,0,-34),
  new THREE.Vector3(-45,0,8), new THREE.Vector3(-39,0,61),
]).getSpacedPoints(180);
function sampleSwaleDepth(x: number, z: number) {
  if (x < -59 || x > -35 || z < -18 || z > 45) return 0;
  let distanceSquared = Infinity;
  for (const p of SAMPLE_DRAIN) distanceSquared = Math.min(distanceSquared,(p.x-x)**2+(p.z-z)**2);
  const taper = THREE.MathUtils.smoothstep(z,-18,-8)*(1-THREE.MathUtils.smoothstep(z,35,45));
  return .26*Math.exp(-distanceSquared/1.7)*taper;
}

function createEnvironmentTrees() {
  const random = seededRandom(20260919);
  const trees: TreeRecord[] = [];
  const addTree = (baseX: number, baseZ: number) => {
    const archetypePick = random();
    trees.push({
      x: baseX + (random() - 0.5) * 3.4,
      z: baseZ + (random() - 0.5) * 2.6,
      scale: 0.9 + random() * 0.14,
      rotation: random() * Math.PI * 2,
      archetype: archetypePick < 0.3 ? "A" : archetypePick < 0.8 ? "B" : "C",
      lod: 3,
    });
  };

  // 252 trees form the continuous production belt behind the managed plots.
  for (let row = 0; row < 9; row += 1) {
    const z = -142 + row * 11;
    for (let column = 0; column < 28; column += 1) {
      addTree(-172 + column * 12.74, z);
    }
  }

  // 72 trees maintain side continuity without extending the existing forest boundary.
  [-182, -164, 164, 182].forEach((x) => {
    for (let row = 0; row < 18; row += 1) {
      addTree(x, -52 + row * 6.4);
    }
  });

  // 36 trees loosely frame the foreground; the central approach remains open.
  [73, 94].forEach((z) => {
    for (let column = 0; column < 9; column += 1) {
      addTree(-184 + column * 10.5, z);
      addTree(100 + column * 10.5, z);
    }
  });

  return trees;
}


function addNaturalEnvironment(scene: THREE.Scene, upgrade = false, heightAt?: (x: number,z: number) => number, layout?: EnvironmentLayout) {
  const random = seededRandom(20260921);
  const group = new THREE.Group();
  group.name = "Hainan_Natural_Vegetation";
  const dummy = new THREE.Object3D();
  const smallTreeCount = 80;
  const shrubCount = 320;
  const distantProxyCount = 96;

  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.34, 0.46, 1, 7),
    new THREE.MeshStandardMaterial({ color: "#665744", roughness: 1 }),
    smallTreeCount,
  );
  trunk.name = "Natural_Small_Tree_Trunks";
  const crownGeometryA = new THREE.DodecahedronGeometry(1, 0);
  const crownGeometryB = new THREE.IcosahedronGeometry(1, 1);
  const crownMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.96 });
  const crownA = new THREE.InstancedMesh(crownGeometryA, crownMaterial, smallTreeCount);
  const crownB = new THREE.InstancedMesh(crownGeometryB, crownMaterial, smallTreeCount);
  const crownLobes = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), crownMaterial, smallTreeCount);
  crownA.name = "Natural_Small_Tree_Crowns_A";
  crownB.name = "Natural_Small_Tree_Crowns_B";
  crownLobes.name = "Natural_Small_Tree_Crown_Lobes";
  const naturalGreens = ["#3f6539", "#507542", "#617f49", "#355a37"].map((color) => new THREE.Color(color));
  let crownACount = 0;
  let crownBCount = 0;

  for (let index = 0; index < smallTreeCount; index += 1) {
    const inFarEdge = index < 42;
    const side = index % 2 === 0 ? -1 : 1;
    const oldX = inFarEdge
      ? -205 + random() * 410
      : side * (124 + random() * 91);
    const oldZ = inFarEdge
      ? -160 + random() * 72
      : -96 + random() * 205;
    const x=layout?.smallTrees[index].x ?? oldX;
    const z=layout?.smallTrees[index].z ?? oldZ;
    const ground = landscapeHeight(x, z);
    const height = 3.4 + random() * 3.6;
    const crownWidth = 2.2 + random() * 2.3;
    const crownDepth = 2 + random() * 2.1;
    const crownHeight = 1.6 + random() * 1.5;
    const rotation = random() * Math.PI * 2;
    const green = naturalGreens[Math.floor(random() * naturalGreens.length)];

    dummy.position.set(x, ground + height * 0.5, z);
    dummy.rotation.set(0, rotation, 0);
    dummy.scale.set(0.8 + random() * 0.35, height, 0.8 + random() * 0.35);
    dummy.updateMatrix();
    trunk.setMatrixAt(index, dummy.matrix);

    dummy.position.set(x, ground + height * 0.9, z);
    dummy.rotation.set(0, rotation, 0);
    dummy.scale.set(crownWidth, crownHeight, crownDepth);
    dummy.updateMatrix();
    if (index % 2 === 0) {
      crownA.setMatrixAt(crownACount, dummy.matrix);
      crownA.setColorAt(crownACount, green);
      crownACount += 1;
    } else {
      crownB.setMatrixAt(crownBCount, dummy.matrix);
      crownB.setColorAt(crownBCount, green);
      crownBCount += 1;
    }

    const lobeAngle = rotation + (random() - 0.5) * 1.2;
    dummy.position.set(
      x + Math.cos(lobeAngle) * crownWidth * 0.5,
      ground + height * (0.82 + random() * 0.16),
      z + Math.sin(lobeAngle) * crownDepth * 0.48,
    );
    dummy.rotation.set(0, rotation * 0.7, 0);
    dummy.scale.set(crownWidth * 0.62, crownHeight * 0.72, crownDepth * 0.64);
    dummy.updateMatrix();
    crownLobes.setMatrixAt(index, dummy.matrix);
    crownLobes.setColorAt(index, green.clone().multiplyScalar(0.9 + random() * 0.12));
  }
  crownA.count = crownACount;
  crownB.count = crownBCount;
  [trunk, crownA, crownB, crownLobes].forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  const shrubTextureCanvas = document.createElement("canvas");
  shrubTextureCanvas.width = 128;
  shrubTextureCanvas.height = 96;
  const shrubTextureContext = shrubTextureCanvas.getContext("2d")!;
  shrubTextureContext.clearRect(0, 0, 128, 96);
  const shrubTextureRandom = seededRandom(20818);
  for (let leaf = 0; leaf < 36; leaf += 1) {
    const x = 18 + shrubTextureRandom() * 92;
    const y = 24 + shrubTextureRandom() * 56;
    const radiusX = 8 + shrubTextureRandom() * 15;
    const radiusY = 6 + shrubTextureRandom() * 11;
    shrubTextureContext.fillStyle = `rgba(255,255,255,${0.7 + shrubTextureRandom() * 0.3})`;
    shrubTextureContext.beginPath();
    shrubTextureContext.ellipse(x, y, radiusX, radiusY, (shrubTextureRandom() - 0.5) * 1.1, 0, Math.PI * 2);
    shrubTextureContext.fill();
  }
  const shrubTexture = new THREE.CanvasTexture(shrubTextureCanvas);
  shrubTexture.colorSpace = THREE.SRGBColorSpace;
  const shrubGeometry = new THREE.BufferGeometry();
  shrubGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0,
    0, 0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1,
  ], 3));
  shrubGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  shrubGeometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  shrubGeometry.computeVertexNormals();
  const shrubMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    map: shrubTexture,
    alphaTest: 0.34,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  shrubMaterial.forceSinglePass = true;
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  shrubs.name = "Forest_Edge_Crosscard_Shrubs";
  const shrubGreens = ["#547542", "#66834a", "#466b40", "#7a8751", "#5a7445"].map((color) => new THREE.Color(color));
  const shrubClusters = [
    { x: -114, z: -5, rx: 24, rz: 50 }, { x: -96, z: 59, rx: 36, rz: 15 },
    { x: 126, z: 44, rx: 27, rz: 24 }, { x: 134, z: -55, rx: 28, rz: 30 },
    { x: -58, z: -82, rx: 50, rz: 14 }, { x: 38, z: -76, rx: 38, rz: 13 },
    { x: 4, z: 67, rx: 60, rz: 11 },
  ];
  for (let index = 0; index < shrubCount; index += 1) {
    const cluster = shrubClusters[index % shrubClusters.length];
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random());
    const oldX = cluster.x + Math.cos(angle) * cluster.rx * distance + (random() - 0.5) * 2;
    const oldZ = cluster.z + Math.sin(angle) * cluster.rz * distance + (random() - 0.5) * 2;
    const x=layout?.shrubs[index].x ?? oldX;
    const z=layout?.shrubs[index].z ?? oldZ;
    const ground = landscapeHeight(x, z);
    const width = 0.65 + random() * 1.35;
    const height = (0.55 + random() * 1.15) * (layout ? .60+layout.shrubs[index].vigor*.40 : 1);
    const depth = 0.7 + random() * 1.25;
    dummy.position.set(x, ground + 0.035, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    shrubs.setMatrixAt(index, dummy.matrix);
    shrubs.setColorAt(index, shrubGreens[Math.floor(random() * shrubGreens.length)]);
  }
  shrubs.instanceMatrix.needsUpdate = true;
  if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
  shrubs.frustumCulled = false;
  shrubs.receiveShadow = true;
  group.add(shrubs);

  const proxyGeometry = new THREE.SphereGeometry(1, 8, 5);
  const proxyMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 });
  const proxies = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, distantProxyCount);
  proxies.name = "Distant_Forest_Canopy_Proxies";
  const proxyGreens = ["#2e5437", "#365d3a", "#40653d", "#31583a"].map((color) => new THREE.Color(color));
  for (let index = 0; index < distantProxyCount; index += 1) {
    const row = Math.floor(index / 24);
    const column = index % 24;
    const oldX = -220 + column * 19.2 + (random() - 0.5) * 8;
    const oldZ = -184 - row * 12 + (random() - 0.5) * 5;
    const x=layout?.proxies[index].x ?? oldX;
    const z=layout?.proxies[index].z ?? oldZ;
    const ground = landscapeHeight(x, z);
    const width = 7 + random() * 5.5;
    const height = 0.9 + random() * 1.25;
    const depth = 4.2 + random() * 4.8;
    dummy.position.set(x, ground + height * 0.34, z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    proxies.setMatrixAt(index, dummy.matrix);
    proxies.setColorAt(index, proxyGreens[Math.floor(random() * proxyGreens.length)]);
  }
  proxies.instanceMatrix.needsUpdate = true;
  if (proxies.instanceColor) proxies.instanceColor.needsUpdate = true;
  proxies.frustumCulled = false;
  proxies.receiveShadow = true;
  group.add(proxies);
  scene.add(group);
  if(upgrade) document.documentElement.dataset.naturalEnvironment=JSON.stringify(upgradeNaturalEnvironment(group,heightAt));

  return { smallTreeCount, shrubCount, naturalVegetationCount: smallTreeCount + shrubCount, distantProxyCount };
}

function makeLabel(title: string, subtitle: string, accent = "#55d6a2") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(8, 20, 15, .88)";
  context.beginPath();
  context.roundRect(8, 8, 496, 164, 26);
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.20)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = accent;
  context.fillRect(10, 36, 6, 108);
  context.fillStyle = "rgba(255,255,255,.96)";
  context.font = "600 48px 'Microsoft YaHei', sans-serif";
  context.fillText(title, 42, 76);
  context.fillStyle = "rgba(255,255,255,.66)";
  context.font = "400 28px 'Microsoft YaHei', sans-serif";
  context.fillText(subtitle, 42, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(18, 6.3, 1);
  sprite.userData.labelText=title;
  sprite.renderOrder = 4;
  return sprite;
}

function addRoad(scene: THREE.Scene, points: THREE.Vector2[], width: number, material: THREE.Material, heightOffset = 0.16, swale = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(point.x, 0, point.y)));
  const samples = curve.getSpacedPoints(180);
  const vertices: number[] = [];
  const uvs: number[] = [];
  const ribbon: number[] = [];
  const indices: number[] = [];
  const crossSegments = 8;
  const length = curve.getLength();
  samples.forEach((point, index) => {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const tangentX = next.x - previous.x;
    const tangentZ = next.z - previous.z;
    const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
    const normalX = -tangentZ / tangentLength;
    const normalZ = tangentX / tangentLength;
    for (let c = 0; c <= crossSegments; c++) {
      const t = c / crossSegments;
      const x = point.x + normalX * width * (.5-t);
      const z = point.z + normalZ * width * (.5-t);
      vertices.push(x, terrainHeight(x,z)+heightOffset-(swale ? sampleSwaleDepth(x,z) : 0), z);
      uvs.push(x/1.3,z/1.3);
      ribbon.push(t,index/(samples.length-1)*length);
      if (index < samples.length-1 && c < crossSegments) {
        const a = index*(crossSegments+1)+c, b = a+crossSegments+1;
        indices.push(a,b,a+1,b,b+1,a+1);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("ribbon", new THREE.Float32BufferAttribute(ribbon, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const road = new THREE.Mesh(geometry, material);
  road.receiveShadow = true;
  scene.add(road);
}

function addZoneHighlight(scene: THREE.Scene, x: number, z: number, width: number, depth: number) {
  const geometry = new THREE.PlaneGeometry(width, depth, 5, 4);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = x + position.getX(index);
    const worldZ = z + position.getZ(index);
    position.setY(index, terrainHeight(worldX, worldZ) + 0.1);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: "#66d9aa",
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const highlight = new THREE.Mesh(geometry, material);
  highlight.name = "Managed_Zone_Ambient_Highlight";
  highlight.position.set(x, 0, z);
  highlight.renderOrder = 1;
  scene.add(highlight);
}

export function DigitalTwinScene({ getDemoMotions, treeProfiles, selectableTrees, resetKey, activeLayer, visible = true, selectedTree = null, focusKey=0, focusZone=null, onTreeSelect, selectedTrees, selectionMode='point', onTreesSelect, demoMotion, site }: Props) {
  const selectableRef=useRef(selectableTrees);selectableRef.current=selectableTrees;
  const getDemoMotionsRef=useRef(getDemoMotions);getDemoMotionsRef.current=getDemoMotions;
  const motionRef=useRef(demoMotion);motionRef.current=demoMotion;
  const profilesRef=useRef(treeProfiles);profilesRef.current=treeProfiles;
  const batchRef=useRef(selectedTrees);batchRef.current=selectedTrees;
  const modeRef=useRef(selectionMode);modeRef.current=selectionMode;
  const batchSelectRef=useRef(onTreesSelect);batchSelectRef.current=onTreesSelect;
  useEffect(()=>{if(controlsRef.current)controlsRef.current.enabled=selectionMode!=='box';},[selectionMode]);
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const onSelectRef = useRef(onTreeSelect); onSelectRef.current = onTreeSelect;
  const selectedRef = useRef(selectedTree); selectedRef.current = selectedTree;
  const focusTreeRef = useRef<((index:number)=>void) | null>(null);
  const focusZoneRef = useRef<((zone:number)=>void) | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const zoneMaterialRef = useRef<THREE.LineBasicMaterial[]>([]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    const params = new URLSearchParams(location.search);
    const requestedSite = site ?? params.get("site") ?? "hainan";
    const businessSite:Site=requestedSite in parks?requestedSite as Site:"hainan";
    const environmentSite:EnvironmentSite=parks[businessSite].sceneTemplate;
    const siteConfig = ENVIRONMENT_SITE_CONFIG[environmentSite];
    const skyPreview=params.get("homeTidewater")!=="0";
    // Close the visible far edge inside the existing terrain footprint.
    // Only peripheral elevations change; all managed tree/road coordinates stay intact.
    const landscapeHeight = (x:number,z:number) => baseLandscapeHeight(x,z) + (skyPreview
      ? THREE.MathUtils.smoothstep(-z,110,208)*(17+3*Math.sin(x*.017)+2*Math.cos(x*.039)) : 0);
    const homeCameraPosition=skyPreview?new THREE.Vector3(6,44,154):new THREE.Vector3(...siteConfig.camera.position);
    const homeCameraTarget=skyPreview?new THREE.Vector3(2,14,-8):new THREE.Vector3(...siteConfig.camera.target);
    const sampleMode = params.has("sample");
    const homeVisual = useHomeVisualProfile(params);
    const environmentRelease = useEnvironmentRelease(params);
    const naturalRelease = useNaturalRelease(params);
    const groundTrial = homeVisual || (sampleMode && params.get("groundTrial") === "1");
    const lightingTrial = homeVisual || (groundTrial && params.get("lightingTrial") === "1");
    const diagnostic = groundTrial && ["full","clay","base","albedo","normal","masks","full-flat","no-normal","soil","soil-direct","cover","selector"].includes(params.get("groundDiagnostic") ?? "")
      ? params.get("groundDiagnostic")! : "";
    const assetStart = performance.now();
    let groundReady = false;
    const groundManager = new THREE.LoadingManager(() => { groundReady = true; });
    scene.background = new THREE.Color("#a5c8c1");
    scene.fog = new THREE.FogExp2("#adc8b8", 0.00305);

    const camera = new THREE.PerspectiveCamera(44, host.clientWidth / host.clientHeight, 0.1, 760);
    camera.position.copy(homeCameraPosition);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const scenePixelRatio=()=>Math.min(window.devicePixelRatio,params.get('legacyRail')==='1'?1.6:1,
      Math.sqrt(1920*1080/Math.max(1,host.clientWidth*host.clientHeight)));
    renderer.setPixelRatio(scenePixelRatio());
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // Allocate the shadow depth texture before the first terrain frame.
    // With autoUpdate disabled, an uninitialized shadow sampler is invalid.
    renderer.shadowMap.needsUpdate = true;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(homeCameraTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.minDistance = 32;
    controls.maxDistance = 180;
    controls.minPolarAngle = 0.55;
    controls.maxPolarAngle = skyPreview?1.43:1.25;
    controls.maxAzimuthAngle = 0.75;
    controls.minAzimuthAngle = -0.75;
    controlsRef.current = controls;

    const sampleLighting = skyPreview ? addHomeTidewaterLighting(scene,renderer)
      : lightingTrial ? addSampleLighting(scene, renderer, homeVisual, naturalRelease && params.get("morningSky")!=="previous") : null;
    if (!sampleLighting) addMorningLighting(scene, renderer);

    const terrainGeometry = new THREE.PlaneGeometry(460, 420, 460, 420);
    terrainGeometry.rotateX(-Math.PI / 2);
    const positions = terrainGeometry.attributes.position;
    const colors: number[] = [];
    // These are deliberately near-neutral multipliers. The earlier dark
    // display colours were multiplied in linear space and flattened all PBR
    // detail into a single green field.
    const dark = new THREE.Color("#9aaa82");
    const light = new THREE.Color("#c4c69b");
    const distantGreen = new THREE.Color("#91a37f");
    const soilTint = new THREE.Color("#b1946a");
    const wetTint = new THREE.Color("#789486");
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const y = landscapeHeight(x, z);
      positions.setY(index, y-sampleSwaleDepth(x,z));
      const mix = THREE.MathUtils.clamp((y + 8) / 18, 0, 1);
      const outerBlend = Math.max(
        THREE.MathUtils.smoothstep(Math.abs(x), 116, 218),
        THREE.MathUtils.smoothstep(-z, 72, 208),
      );
      const broadNoise = (Math.sin(x * 0.057) + Math.cos(z * 0.071) + Math.sin((x - z) * 0.031)) / 3;
      const fineNoise = (Math.sin(x * 0.2 + z * 0.13) + 1) * 0.04;
      const color = dark.clone().lerp(light, mix * 0.64 + fineNoise + broadNoise * 0.08);
      const soilBand = THREE.MathUtils.smoothstep(Math.sin(x * 0.042 + z * 0.024), 0.45, 0.86) * (1 - outerBlend);
      const wetBand = THREE.MathUtils.smoothstep(Math.cos((x + z) * 0.036), 0.7, 0.94) * (1 - outerBlend);
      color.lerp(soilTint, soilBand * 0.29);
      color.lerp(wetTint, wetBand * 0.2);
      color.lerp(distantGreen, outerBlend * 0.22);
      // Keep the production blocks subtly managed, but never bleach them to
      // white: that historical treatment made the PBR floor read as a flat
      // beige exhibition plinth in the default camera.
      const productionCore = (1-THREE.MathUtils.smoothstep(Math.abs(x),112,145)) * (1-THREE.MathUtils.smoothstep(Math.abs(z),68,92));
      color.lerp(new THREE.Color("#adb292"), productionCore * .18);
      colors.push(color.r, color.g, color.b);
    }
    terrainGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    terrainGeometry.computeVertexNormals();
    const terrainUv = terrainGeometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) terrainUv.setXY(i,positions.getX(i)/2.1,positions.getZ(i)/2.1);

    // Soil is blended on the terrain itself, not intersecting translucent polygon fans.
    const roadLines = [
      { points: [new THREE.Vector2(-115, 62), new THREE.Vector2(-64, 40), new THREE.Vector2(-21, 10), new THREE.Vector2(15, -5), new THREE.Vector2(58, -38), new THREE.Vector2(112, -58)], width: 4.8, shoulderWidth: .85 },
      { points: [new THREE.Vector2(-58, -76), new THREE.Vector2(-42, -35), new THREE.Vector2(-35, 9), new THREE.Vector2(-29, 62)], width: 2.7, shoulderWidth: .65 },
      { points: [new THREE.Vector2(18, -74), new THREE.Vector2(29, -34), new THREE.Vector2(37, 5), new THREE.Vector2(55, 58)], width: 2.4, shoulderWidth: .6 },
      { points: [new THREE.Vector2(78, -66), new THREE.Vector2(74, -24), new THREE.Vector2(81, 18), new THREE.Vector2(91, 55)], width: 2.3, shoulderWidth: .58 },
    ];
    const groundVisuals = createGroundVisuals({
      manager: groundManager,
      heightAt: terrainHeight,
      roads: roadLines,
      ditches: [
        {id:"west", points:[[-65,-74],[-51,-34],[-45,8],[-39,61]],width:1.0,depth:.2},
        {id:"east", points:[[68,-66],[65,-24],[70,18],[79,55]],width:.85,depth:.16},
      ],
      anisotropy: Math.min(8,renderer.capabilities.getMaxAnisotropy()),
    });
    for (let i=0;i<positions.count;i++) {
      const x=positions.getX(i),z=positions.getZ(i);
      positions.setY(i,landscapeHeight(x,z)-groundVisuals.carveDepthAt(x,z));
    }
    terrainGeometry.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeometry, groundVisuals.terrainMaterial);
    terrain.receiveShadow = true;
    scene.add(terrain, groundVisuals.group);

    // Managed trees at the conventional 3 m × 7 m spacing, shared with the 2D spatial layers.
    const treePositions: TreeRecord[] = sceneTreeLayout().map(({x,z,scale,rotation,archetype})=>({x,z,scale,rotation,archetype,lod:3}));

    // Keep high-detail trees local to the inspection camera, not the entire grove.
    const fleetEnabled=businessSite==='hainan'&&params.get('legacyRail')!=='1';
    const railPerformanceMode=businessSite==='hainan'&&(fleetEnabled||params.get('homeRailPilot')==='1');
    const jointSampleEnabled=!fleetEnabled&&railPerformanceMode&&params.get('jointRow')!=='0';
    const presentationYaw=new Map(treePositions.map((tree,index)=>[tree,fleetEnabled?0:jointSampleYaw(index,tree.rotation,jointSampleEnabled)]));
    host.dataset.jointRailSample=JSON.stringify({...RAIL_JOINT_SAMPLE,enabled:jointSampleEnabled,railConnected:false});
    // Visual-only substitution: six existing B trees in C zone, no business mutations.
    const variantTrees=new Set(railPerformanceMode&&params.get('v20Pilot')!=='0'
      ? treePositions.slice(100,150).filter(tree=>tree.archetype==='B').slice(0,6):[]);
    const assetKey=(tree:TreeRecord):AssetArchetype=>variantTrees.has(tree)?'V20':tree.archetype;
    const assetTypes:AssetArchetype[]=variantTrees.size?[...ARCHETYPES,'V20']:ARCHETYPES;
    host.dataset.variantPilot=JSON.stringify({variant:'V20-R3',indices:treePositions.flatMap((t,i)=>variantTrees.has(t)?[i]:[]),experimental:true});
    let railShadowDirty=false, lastRailShadowUpdate=0;
    let railRowView=false;
    const railRowTrees=new Set(RAIL_JOINT_SAMPLE.indices.map(index=>treePositions[index]));
    const railPilot=!fleetEnabled&&railPerformanceMode?installHomeRailPilot(scene,host,treePositions,roadLines,groundVisuals.terrainHeightAt,(target,rotation,detail,wide)=>{
      cameraFlight=null;
      railRowView=!!wide;
      camera.fov=wide?70:44;camera.updateProjectionMatrix();
      forestDirty=true;
      controls.minDistance=3;controls.maxAzimuthAngle=Infinity;controls.minAzimuthAngle=-Infinity;
      camera.position.copy(target).add((wide?new THREE.Vector3(0,1.5,6.5):detail?new THREE.Vector3(3.2,.8,1.2):new THREE.Vector3(5,3,7)).applyAxisAngle(new THREE.Vector3(0,1,0),rotation));
      controls.target.copy(target);controls.update();renderer.shadowMap.needsUpdate=true;
    },()=>{railShadowDirty=true;},terrainHeight):null;
    const zoneFleet=fleetEnabled?installZoneFleet(scene,host,treePositions,terrainHeight,()=>{railShadowDirty=true;},target=>{
      cameraFlight=null;railRowView=true;forestDirty=true;camera.fov=55;camera.updateProjectionMatrix();
      controls.minDistance=3;controls.maxAzimuthAngle=Infinity;controls.minAzimuthAngle=-Infinity;
      cameraFlight={start:performance.now(),from:camera.position.clone(),targetFrom:controls.target.clone(),to:target.clone().add(alleyCamera()),targetTo:target.clone()};
    }):null;

    let observationIndex:number|null=null;
    const detachObservationCamera=fleetEnabled?installObservationCamera(renderer,scene,treePositions,terrainHeight,z=>zoneFleet?.position(z),index=>{
      if(index!==null&&!loadedLods.size)throw Error('树木模型尚未加载');
      observationIndex=index;
      selectionRing.visible=index===null&&lastSelected!==null;
      selectionStem.visible=false;batchRings.visible=index===null;
      updateForestInstances();
    }):undefined;
    let followingZone:number|null=null;
    const stopFollowing=()=>{followingZone=null;forestDirty=true;if(fleetEnabled)window.dispatchEvent(new CustomEvent('zone-follow-state',{detail:null}));};
    const startFollowing=(e:Event)=>{const z=(e as CustomEvent).detail;followingZone=Number.isInteger(z)&&z>=0&&z<4?z:null;cameraFlight=null;railRowView=true;forestDirty=true;camera.fov=55;camera.updateProjectionMatrix();window.dispatchEvent(new CustomEvent('zone-follow-state',{detail:followingZone}));};
    if(fleetEnabled)window.addEventListener('zone-fleet-follow',startFollowing);
    controls.addEventListener('start',stopFollowing);
    // Interaction-only adapter: logical records, transforms and instance counts are unchanged.
    const selectionRing = new THREE.Mesh(new THREE.RingGeometry(1.0,1.15,40),new THREE.MeshBasicMaterial({color:0x55d6a2,side:THREE.DoubleSide,depthWrite:false}));
    selectionRing.rotation.x = -Math.PI/2; selectionRing.visible = false; scene.add(selectionRing);
    const selectionStem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,17,0)]),new THREE.LineBasicMaterial({color:0xa9f2d5,depthTest:false,transparent:true,opacity:.85}));
    selectionStem.visible=false;selectionStem.renderOrder=1000;scene.add(selectionStem);
    let lastSelected: number | null = null;
    const batchRings=new THREE.InstancedMesh(new THREE.RingGeometry(2,2.35,24),new THREE.MeshBasicMaterial({color:0x79ffd0,side:THREE.DoubleSide,depthWrite:false,depthTest:false,transparent:true,opacity:.85}),200);
    batchRings.count=0;batchRings.frustumCulled=false;batchRings.renderOrder=10;scene.add(batchRings);
    let lastBatch:number[]|undefined;
    let lastSelectable:number[]|undefined;
    let lastProfiles:TreeProfile[]|undefined;
    const batchMatrix=new THREE.Object3D();
    const selectBox=document.createElement('div');
    selectBox.style.cssText='position:fixed;display:none;pointer-events:none;border:2px solid #7affcc;background:#55d6a222;z-index:32;';
    host.appendChild(selectBox);
    const pointerMove=(e:PointerEvent)=>{
      if(modeRef.current!=='box'||!pointerStart)return;
      selectBox.style.display='block';selectBox.style.left=Math.min(e.clientX,pointerStart.x)+'px';selectBox.style.top=Math.min(e.clientY,pointerStart.y)+'px';
      selectBox.style.width=Math.abs(e.clientX-pointerStart.x)+'px';selectBox.style.height=Math.abs(e.clientY-pointerStart.y)+'px';
    };
    let cameraFlight: {start:number;from:THREE.Vector3;targetFrom:THREE.Vector3;to:THREE.Vector3;targetTo:THREE.Vector3} | null = null;
    focusTreeRef.current = (index:number) => {
      if(selectedSceneTrees(treePositions.length,index,undefined,selectableRef.current).selected===null)return;
      stopFollowing();
      const tree=treePositions[index]; if(!tree)return;
      railRowView=false;camera.fov=44;camera.updateProjectionMatrix();forestDirty=true;
      controls.minDistance=8;
      cameraFlight={start:performance.now(),from:camera.position.clone(),targetFrom:controls.target.clone(),to:new THREE.Vector3(tree.x+18,terrainHeight(tree.x,tree.z)+27,tree.z+40),targetTo:new THREE.Vector3(tree.x,terrainHeight(tree.x,tree.z)+7,tree.z)};
    };
    focusZoneRef.current=(index:number)=>{
      const center=zoneFocusCenter(treePositions,index,selectableRef.current);if(!center)return;
      stopFollowing();railRowView=false;camera.fov=44;camera.updateProjectionMatrix();forestDirty=true;controls.minDistance=15;
      const {x,z}=center,y=terrainHeight(x,z);
      cameraFlight={start:performance.now(),from:camera.position.clone(),targetFrom:controls.target.clone(),to:new THREE.Vector3(x+8,y+45,z+80),targetTo:new THREE.Vector3(x,y+7,z)};
    };
    const pickRay = new THREE.Raycaster();
    const pickStart=new THREE.Vector3(),pickEnd=new THREE.Vector3(),onRay=new THREE.Vector3(),onTrunk=new THREE.Vector3();
    const canopy = new THREE.Sphere(),canopyHit = new THREE.Vector3();
    let pointerStart: {x:number;y:number;id:number}|null = null;
    const pointerDown=(e:PointerEvent)=>{cameraFlight=null;pointerStart=e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId}:null;if(pointerStart&&modeRef.current==='box')renderer.domElement.setPointerCapture(e.pointerId);};
    const pointerUp=(e:PointerEvent)=>{
      const start=pointerStart;pointerStart=null;
      selectBox.style.display='none';
      if(start&&modeRef.current==='box'&&visibleRef.current){
        const rect=renderer.domElement.getBoundingClientRect(),picked:number[]=[];
        camera.updateMatrixWorld();
        treePositions.forEach((tree,i)=>{
          if(selectableRef.current&&!selectableRef.current.includes(i))return;
          const v=new THREE.Vector3(tree.x,terrainHeight(tree.x,tree.z)+9*tree.scale,tree.z).project(camera);
          const x=rect.left+(v.x+1)*rect.width/2,y=rect.top+(1-v.y)*rect.height/2;
          if(v.z>=-1&&v.z<=1&&x>=Math.min(start.x,e.clientX)&&x<=Math.max(start.x,e.clientX)&&y>=Math.min(start.y,e.clientY)&&y<=Math.max(start.y,e.clientY))picked.push(i);
        });
        batchSelectRef.current?.(picked);return;
      }
      if(modeRef.current==='off'||!start||start.id!==e.pointerId||!visibleRef.current || !onSelectRef.current || Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;
      const rect=renderer.domElement.getBoundingClientRect();
      camera.updateMatrixWorld();
      pickRay.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
      let best=-1, distance=Infinity;
      // Analytical pick volumes: no extra draw calls or per-frame mesh raycasts.
      // Prefer visible trunks; use nearest crown only when no trunk was hit.
      treePositions.forEach((tree,index)=>{
        if(selectableRef.current&&!selectableRef.current.includes(index))return;
        const y=terrainHeight(tree.x,tree.z);
        pickStart.set(tree.x,y+.3,tree.z);pickEnd.set(tree.x,y+8*tree.scale,tree.z);
        const miss=pickRay.ray.distanceSqToSegment(pickStart,pickEnd,onRay,onTrunk);
        const d=pickRay.ray.origin.distanceTo(onRay);
        if(miss<(.75*tree.scale)**2&&d>camera.near&&d<distance){distance=d;best=index;}
      });
      if(best<0)treePositions.forEach((tree,index)=>{
        if(selectableRef.current&&!selectableRef.current.includes(index))return;
        canopy.center.set(tree.x,terrainHeight(tree.x,tree.z)+10*tree.scale,tree.z);canopy.radius=3.2*tree.scale;
        if(pickRay.ray.intersectSphere(canopy,canopyHit)){
          const d=pickRay.ray.origin.distanceTo(canopyHit);
          if(d>camera.near&&d<distance){distance=d;best=index;}
        }
      });
      if(best>=0)onSelectRef.current(best);
    };
    renderer.domElement.addEventListener('pointerdown',pointerDown);
    renderer.domElement.addEventListener('pointerup',pointerUp);
    const pointerCancel=()=>{pointerStart=null;selectBox.style.display='none';};
    renderer.domElement.addEventListener('pointermove',pointerMove);
    renderer.domElement.addEventListener('pointercancel',pointerCancel);
    const environmentLayout = naturalRelease ? createEnvironmentLayout({business:treePositions,
      roads:roadLines.map(road=>({...road,points:road.points.map(p=>({x:p.x,z:p.y}))})),
      heightAt:baseLandscapeHeight}) : undefined;
    // Production rubber models are restricted to the 200 managed trees.
    const environmentTreePositions: TreeRecord[] = [];
    if(environmentLayout) document.documentElement.dataset.environmentLayout=JSON.stringify({
      seed:environmentLayout.seed,rubber:0,smallTrees:48,shrubs:60,proxies:0,
      businessPositions:"unchanged",algorithm:"habitat-weighted-jitter-spacing",
    });
    const groundSample = groundTrial ? installGroundSample({
      terrain, ground: groundVisuals, roads: roadLines, heightAt: homeVisual ? landscapeHeight : terrainHeight,
      trees: homeVisual ? [...treePositions,...(environmentLayout?.rubber.slice(0,280)??[]),...(environmentLayout?.smallTrees??[])] : treePositions,
      manager: groundManager, clay: params.get("groundView") === "clay",
      surfaceTrial: homeVisual || (lightingTrial && params.get("surfaceTrial") === "1"),
      materialTrial: homeVisual || (lightingTrial && params.get("materialTrial") === "1"),
      antiTile: homeVisual || params.get("antiTile") === "2" ? "rotated" : params.get("antiTile") === "1",
      diagnostic,
      optimize: homeVisual || params.get("groundPerf") === "1",
      finish: homeVisual || params.get("groundFinish") === "1",
      bounds: homeVisual ? {minX:-230,maxX:230,minZ:-210,maxZ:210} : undefined,
      step: homeVisual ? 1 : undefined,
      wholeTerrain: environmentRelease,
      ditches: homeVisual ? [
        {points:[[-65,-74],[-51,-34],[-45,8],[-39,61]],width:1},
        {points:[[68,-66],[65,-24],[70,18],[79,55]],width:.85},
      ] : undefined,
    }) : null;
    if (groundSample) {
      // Preview-only reflectance correction; shared source textures and the original homepage stay unchanged.
      if (skyPreview) {
        const material=groundSample.mesh.material;
        material.color.setRGB(.78,.84,.79);

      }
      scene.add(groundSample.mesh);
      if(homeVisual)scene.add(landscapeSurround(landscapeHeight,groundSample.mesh.material,groundSample.field));
      document.documentElement.dataset.groundSample = JSON.stringify({
        bounds: groundSample.bounds, triangles: groundSample.triangles,
        businessTrees: treePositions.length, profile: environmentRelease ? "homepage-v2-whole-terrain" : homeVisual ? "homepage-v1" : "sample",
        newTextures: params.get("groundView") === "clay" ? 0 : (homeVisual || lightingTrial && params.get("materialTrial") === "1" ? 9 : 3),
      });
    }
    const sampleCover = groundSample && lightingTrial && (homeVisual || params.get("coverTrial") === "1")
      ? createSampleGroundCover({...groundSample,field:(x,z)=>({...groundSample.field(x,z),height:surroundHeight(x,z,groundSample.field)})},homeVisual ? {
        bounds: {minX:-380,maxX:380,minZ:-390,maxZ:150},spacing: 1.6,
      } : undefined) : null;
    if (sampleCover) {
      scene.add(sampleCover.group);
      document.documentElement.dataset.groundCover = JSON.stringify(sampleCover.stats);
    }
    scene.add(createTerraceWorkPaths(groundSample ? (x,z)=>groundSample.field(x,z).height : terrainHeight));
    const naturalEnvironmentStats = addNaturalEnvironment(scene,environmentRelease,
      environmentRelease && groundSample ? (x,z)=>groundSample.field(x,z).height : undefined,environmentLayout);
    // Keep authored vegetation visible while its replacements load. The registry
    // retires only tree proxies after every replacement asset is available.

    const forestRoot = new THREE.Group();
    forestRoot.name = "AF04_Mature_Family_v1";
    scene.add(forestRoot);
    const environmentForestRoot = new THREE.Group();
    environmentForestRoot.name = "Hainan_Environment_Forest";
    scene.add(environmentForestRoot);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    let cancelled = false;
    void mountEnvironmentAssetRegistry({
      scene,
      loader,
      layout: environmentLayout,
      heightAt: environmentRelease && groundSample ? (x, z) => groundSample.field(x, z).height : landscapeHeight,
      site: environmentSite,
      // Inherited verified GLBs replace only matching peripheral fallback instances.
      enabled: naturalRelease,
      isDisposed:()=>cancelled,
      onReady:()=>{railShadowDirty=true;},
    });
    const sources = new Map<string, SourcePart[]>();
    const loadedLods = new Set<LODLevel>();
    const batches: TreeBatch[] = [];
    const environmentBatches: TreeBatch[] = [];
    const instanceDummy = new THREE.Object3D();
    const composedInstanceMatrix = new THREE.Matrix4();
    const cameraPosition = new THREE.Vector3();
    const loadStartedAt = assetStart;
    const frameTimes: number[] = [];
    const gpuTimes: number[] = [];
    let firstGroveFrameMs: number | null = null;
    let allAssetsReadyMs: number | null = null;
    let activeTreeLimit = treePositions.length;
    let activeArchetypeFilter: Archetype | null = null;
    let lodCounts: [number, number, number, number] = [0, 0, 0, 0];
    let environmentLodCounts: [number, number, number, number] = [0, 0, 0, 0];
    let forestDirty = true;
    const classifiedTrees = new WeakSet<TreeRecord>();
    let previousShadowLayout = "";


    async function loadLOD(lod: LODLevel) {
      await Promise.all(assetTypes.map(async (archetype) => {
        const url = archetype==='V20' ? `/assets/trees/v20-home-pilot-r3/V20_LOD${lod}.glb` : `${TREE_ASSET_ROOT}/RT_Mature_${archetype}_LOD${lod}.glb`;
        const gltf = await loader.loadAsync(url);
        if (cancelled) return;
        const parts: SourcePart[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.updateWorldMatrix(true, false);
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => parts.push({
            geometry: archetype==='V20'?node.geometry.clone():prepareTreeGeometry(node.geometry, lod, material),
            material: archetype==='V20'?material.clone():prepareTreeMaterial(material, { lod }),
            nodeMatrix: node.matrixWorld.clone(),
          }));
        });
        if (parts.length !== 2) throw new Error(`${url}: expected 2 primitives, received ${parts.length}`);
        sources.set(`${archetype}:${lod}`, parts);
      }));
      if (cancelled) return;
      loadedLods.add(lod);
      assetTypes.forEach((archetype) => {
        const capacity = treePositions.filter((tree) => assetKey(tree) === archetype).length;
        sources.get(`${archetype}:${lod}`)?.forEach((source, part) => {
          const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
          mesh.name = `RT_Mature_${archetype}_LOD${lod}_P${part}`;
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.userData = { archetype, lod, part };
          forestRoot.add(mesh);
          batches.push({ archetype, lod, part, mesh });
        });
        if (lod >= 2 && archetype!=='V20') {
          const environmentCapacity = environmentTreePositions.filter((tree) => tree.archetype === archetype).length;
          sources.get(`${archetype}:${lod}`)?.forEach((source, part) => {
            const mesh = new THREE.InstancedMesh(source.geometry, source.material, environmentCapacity);
            mesh.name = `ENV_Mature_${archetype}_LOD${lod}_P${part}`;
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.castShadow = lightingTrial;
            mesh.receiveShadow = true;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.userData = { archetype, lod, part, role: "environment" };
            environmentForestRoot.add(mesh);
            environmentBatches.push({ archetype, lod, part, mesh });
          });
        }
      });
      forestDirty = true;
      document.documentElement.dataset.treeAssets = lod === 3 ? "lod3-ready" : `lod${lod}-ready`;
    }

    function availableLOD(preferred: LODLevel): LODLevel {
      for (let lod = preferred; lod <= 3; lod += 1) {
        if (loadedLods.has(lod as LODLevel)) return lod as LODLevel;
      }
      return 3;
    }

    function updateForestInstances() {
      if (!loadedLods.size) return;
      camera.getWorldPosition(cameraPosition);
      const slots = new Map(batches.map((batch) => [`${batch.archetype}:${batch.lod}:${batch.part}`, { batch, index: 0 }]));
      const environmentSlots = new Map(environmentBatches.map((batch) => [`${batch.archetype}:${batch.lod}:${batch.part}`, { batch, index: 0 }]));
      lodCounts = [0, 0, 0, 0];
      environmentLodCounts = [0, 0, 0, 0];
      const activeTrees = (activeArchetypeFilter
        ? treePositions.filter((tree) => tree.archetype === activeArchetypeFilter)
        : treePositions).slice(0, activeTreeLimit);
      const selection=selectedSceneTrees(treePositions.length,selectedRef.current,batchRef.current,selectableRef.current);
      for (const tree of activeTrees) {
        const visualArchetype=assetKey(tree);
        const ground = terrainHeight(tree.x, tree.z);
        const distance = cameraPosition.distanceTo(instanceDummy.position.set(tree.x, ground + 6.8, tree.z));
        const treeIndex=treePositions.indexOf(tree);
        const focused=observationIndex===null&&followingZone===null&&selection.selected===treeIndex;
        const batchSelected=observationIndex===null&&selection.batch.has(treeIndex);
        const instanceTint=focused?new THREE.Color(4,2,.3):batchSelected?new THREE.Color(2.5,1.8,.42):new THREE.Color(1,1,1);
        const lod = availableLOD(observationIndex!==null&&treePositions[observationIndex]===tree||focused&&distance<35?0:railViewLOD(chooseTreeLOD(distance, classifiedTrees.has(tree) ? tree.lod : undefined,
          homeVisual ? { distances: [8, 22, 65], hysteresis: [2, 4, 8] } : railPerformanceMode ? { distances: [12, 32, 160], hysteresis: [2, 4, 12] } : undefined),fleetEnabled?distance<18:railRowTrees.has(tree),railRowView));
        if (loadedLods.size === 4) classifiedTrees.add(tree);
        tree.lod = lod;
        lodCounts[lod] += 1;
        instanceDummy.position.set(tree.x, ground, tree.z);
        instanceDummy.rotation.set(0, presentationYaw.get(tree)??tree.rotation, 0);
        // Each managed tree takes its own recorded height and girth; see treeScale.
        const size=treeScale(profilesRef.current?.[treeIndex],visualArchetype,tree.scale);
        instanceDummy.scale.set(size.x,size.y,size.x);
        instanceDummy.updateMatrix();
        const parts = sources.get(`${visualArchetype}:${lod}`)?.length ?? 0;
        for (let part = 0; part < parts; part += 1) {
          const slot = slots.get(`${visualArchetype}:${lod}:${part}`);
          if (!slot) continue;
          const source = sources.get(`${visualArchetype}:${lod}`)?.[part];
          if (!source) continue;
          composedInstanceMatrix.multiplyMatrices(instanceDummy.matrix, source.nodeMatrix);
          slot.batch.mesh.setMatrixAt(slot.index, composedInstanceMatrix);
          slot.batch.mesh.setColorAt(slot.index,instanceTint);
          if(slot.batch.mesh.instanceColor)slot.batch.mesh.instanceColor.needsUpdate=true;
          slot.index += 1;
        }
      }
      slots.forEach(({ batch, index }) => {
        batch.mesh.count = index;
        if (index) {
          batch.mesh.instanceMatrix.needsUpdate = true;
          // Rebuild bounds only on a LOD/layout change, never per render.
          // Three uses these same world-space bounds in the camera and shadow passes.
          batch.mesh.computeBoundingSphere();
          batch.mesh.frustumCulled = true;
        }
      });
      for (const tree of environmentTreePositions) {
        const ground = landscapeHeight(tree.x, tree.z);
        const distance = cameraPosition.distanceTo(instanceDummy.position.set(tree.x, ground + 6.8, tree.z));
        const preferredLOD = Math.max(2, chooseTreeLOD(
          distance, classifiedTrees.has(tree) ? tree.lod : undefined,
          { distances: [0, 0, railRowView?90:145], hysteresis: [0, 0, 10] },
        )) as LODLevel;
        const lod: LODLevel = preferredLOD === 2 && loadedLods.has(2) ? 2 : 3;
        if (loadedLods.size === 4) classifiedTrees.add(tree);
        tree.lod = lod;
        environmentLodCounts[lod] += 1;
        instanceDummy.position.set(tree.x, ground, tree.z);
        instanceDummy.rotation.set(0, tree.rotation, 0);
        instanceDummy.scale.setScalar(tree.scale);
        instanceDummy.updateMatrix();
        const parts = sources.get(`${tree.archetype}:${lod}`)?.length ?? 0;
        for (let part = 0; part < parts; part += 1) {
          const slot = environmentSlots.get(`${tree.archetype}:${lod}:${part}`);
          const source = sources.get(`${tree.archetype}:${lod}`)?.[part];
          if (!slot || !source) continue;
          composedInstanceMatrix.multiplyMatrices(instanceDummy.matrix, source.nodeMatrix);
          slot.batch.mesh.setMatrixAt(slot.index, composedInstanceMatrix);
          slot.index += 1;
        }
      }
      environmentSlots.forEach(({ batch, index }) => {
        batch.mesh.count = index;
        if (index) {
          batch.mesh.instanceMatrix.needsUpdate = true;
          batch.mesh.computeBoundingSphere();
          batch.mesh.frustumCulled = true;
        }
      });
      forestDirty = false;
      // The sun and trees are static. Camera motion alone does not invalidate
      // the shadow map; changed caster LOD layouts do (including trial background trees).
      const shadowLayout = activeTrees.map(tree => `${tree.archetype}${tree.lod}`).join(",")
        + (lightingTrial ? environmentTreePositions.map(tree => `${tree.archetype}${tree.lod}`).join(",") : "");
      if (shadowLayout !== previousShadowLayout) {
        renderer.shadowMap.needsUpdate = true;
        previousShadowLayout = shadowLayout;
      }
    }

    const markForestDirty = () => { forestDirty = true; };
    controls.addEventListener("change", markForestDirty);

    const zoneMaterialRefs: THREE.LineBasicMaterial[] = [];
    const sceneLabels: THREE.Sprite[] = [];
    const registerSceneLabel = (label: THREE.Sprite) => {
      label.userData.baseScale = label.scale.clone();
      sceneLabels.push(label);
      const el=document.createElement('div');el.className='field-world-label';el.textContent=label.userData.labelText;host.appendChild(el);label.userData.domLabel=el;
    };
    // Zone outlines follow the planted rows rather than fixed rectangles.
    const zoneDefs: {name:string;count:string;x:number;z:number;w:number;d:number;labelX?:number;labelZ?:number}[] =
      [0,1,2,3].map(zone => ({ name: `${"ABCD"[zone]} 区`, count: "50 棵", ...sceneZoneBox(treePositions, zone) }));
    zoneDefs.forEach((zone) => {
      addZoneHighlight(scene, zone.x, zone.z, zone.w, zone.d);
      const corners = [
        [-zone.w / 2, -zone.d / 2], [zone.w / 2, -zone.d / 2], [zone.w / 2, zone.d / 2], [-zone.w / 2, zone.d / 2],
      ].map(([dx, dz]) => new THREE.Vector3(zone.x + dx, terrainHeight(zone.x + dx, zone.z + dz) + 0.55, zone.z + dz));
      const geometry = new THREE.BufferGeometry().setFromPoints([...corners, corners[0]]);
      const material = new THREE.LineBasicMaterial({ color: "#7be5b8", transparent: true, opacity: 0.46 });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      zoneMaterialRefs.push(material);
      const label = makeLabel(zone.name, zone.count);
      const labelX = zone.labelX ?? zone.x;
      const labelZ = zone.labelZ ?? zone.z;
      label.position.set(labelX, terrainHeight(labelX, labelZ) + 18, labelZ);
      registerSceneLabel(label);
      scene.add(label);
    });
    zoneMaterialRef.current = zoneMaterialRefs;

    const robot = new THREE.Group();
    const robotBase = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.5, 4.6), new THREE.MeshStandardMaterial({ color: "#dbe4e1", roughness: 0.48, metalness: 0.18 }));
    robotBase.position.y = 1.2;
    robotBase.castShadow = true;
    robot.add(robotBase);
    const robotTop = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.2, 2.2), new THREE.MeshStandardMaterial({ color: "#54636a", roughness: 0.42 }));
    robotTop.position.y = 2.8;
    robot.add(robotTop);
    robot.position.set(14, terrainHeight(14, -7), -7);
    robot.rotation.y = -0.7;
    // Retired placeholder: never represent the rail robot by a road-following box.
    robot.visible = false;
    scene.add(robot);
    const robotHalo = new THREE.Mesh(
      new THREE.RingGeometry(2.8, 3.25, 40),
      new THREE.MeshBasicMaterial({ color: "#69d7df", transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
    );
    robotHalo.rotation.x = -Math.PI / 2;
    robotHalo.position.set(14, terrainHeight(14, -7) + 0.22, -7);
    robotHalo.renderOrder = 3;
    robotHalo.visible = false;
    scene.add(robotHalo);
    const robotLabel = makeLabel("R1 · 作业中", "31 / 52", "#5aa7ff");
    robotLabel.position.set(14, terrainHeight(14, -7) + 9.5, -7);
    robotLabel.scale.set(16, 5.6, 1);
    registerSceneLabel(robotLabel);
    scene.add(robotLabel);

    const homeMarker = makeLabel("管护节点", "模拟位置", "#c7d7cf");
    homeMarker.position.set(-48, terrainHeight(-48, 18) + 7.5, 18);
    homeMarker.scale.set(14, 4.9, 1);
    registerSceneLabel(homeMarker);
    scene.add(homeMarker);

    const gl = renderer.getContext() as WebGL2RenderingContext;
    const gpuExtension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
      TIME_ELAPSED_EXT: number;
      GPU_DISJOINT_EXT: number;
    } | null;
    let pendingGpuQuery: WebGLQuery | null = null;
    let gpuQueryActive = false;
    const beginGpuQuery = () => {
      if (!gpuExtension || pendingGpuQuery) return;
      pendingGpuQuery = gl.createQuery();
      if (!pendingGpuQuery) return;
      gl.beginQuery(gpuExtension.TIME_ELAPSED_EXT, pendingGpuQuery);
      gpuQueryActive = true;
    };
    const endGpuQuery = () => {
      if (!gpuExtension || !gpuQueryActive) return;
      gl.endQuery(gpuExtension.TIME_ELAPSED_EXT);
      gpuQueryActive = false;
    };
    const pollGpuQuery = () => {
      if (!gpuExtension || !pendingGpuQuery) return;
      if (!gl.getQueryParameter(pendingGpuQuery, gl.QUERY_RESULT_AVAILABLE)) return;
      if (!gl.getParameter(gpuExtension.GPU_DISJOINT_EXT)) {
        gpuTimes.push(gl.getQueryParameter(pendingGpuQuery, gl.QUERY_RESULT) / 1e6);
        if (gpuTimes.length > 600) gpuTimes.splice(0, gpuTimes.length - 600);
      }
      gl.deleteQuery(pendingGpuQuery);
      pendingGpuQuery = null;
    };

    const getRuntimeSnapshot = (): RuntimeSnapshot => {
      const recentFrames = frameTimes.slice(-600);
      const recentGpu = gpuTimes.slice(-300);
      const frameTotal = recentFrames.reduce((sum, value) => sum + value, 0);
      const businessTreeCount = activeArchetypeFilter
        ? Math.min(activeTreeLimit, treePositions.filter((tree) => tree.archetype === activeArchetypeFilter).length)
        : activeTreeLimit;
      return {
        viewport: [host.clientWidth,host.clientHeight],
        renderBuffer: [renderer.domElement.width,renderer.domElement.height],
        pixelRatio: renderer.getPixelRatio(),
        frameSamples: recentFrames.length,
        gpuSamples: recentGpu.length,
        treeCount: businessTreeCount,
        businessTreeCount,
        environmentTreeCount: environmentTreePositions.length,
        naturalVegetationCount: naturalEnvironmentStats.naturalVegetationCount,
        smallTreeCount: naturalEnvironmentStats.smallTreeCount,
        shrubCount: naturalEnvironmentStats.shrubCount,
        distantProxyCount: naturalEnvironmentStats.distantProxyCount,
        totalVisualTreeCount: businessTreeCount + environmentTreePositions.length + naturalEnvironmentStats.smallTreeCount + naturalEnvironmentStats.distantProxyCount,
        fps: frameTotal ? (recentFrames.length * 1000) / frameTotal : 0,
        frameMsP95: percentile(recentFrames, 0.95),
        gpuMsMedian: recentGpu.length ? percentile(recentGpu, 0.5) : null,
        gpuMsP95: recentGpu.length ? percentile(recentGpu, 0.95) : null,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        lodCounts: [...lodCounts] as [number, number, number, number],
        environmentLodCounts: [...environmentLodCounts] as [number, number, number, number],
        firstGroveFrameMs,
        allAssetsReadyMs,
        loadedLods: [...loadedLods].sort(),
      };
    };

    const setTreeLimit = (count: number) => {
      activeArchetypeFilter = null;
      activeTreeLimit = THREE.MathUtils.clamp(Math.round(count), 1, treePositions.length);
      forestDirty = true;
    };

    const benchmarkCounts = async (counts = [50, 100, 200], sampleMs = 3000) => {
      const results: RuntimeSnapshot[] = [];
      for (const count of counts) {
        setTreeLimit(count);
        await new Promise((resolve) => setTimeout(resolve, 700));
        frameTimes.length = 0;
        gpuTimes.length = 0;
        await new Promise((resolve) => setTimeout(resolve, sampleMs));
        results.push(getRuntimeSnapshot());
      }
      setTreeLimit(treePositions.length);
      return results;
    };

    const resetRuntimeCamera = () => {
      stopFollowing();
      railRowView=false;camera.fov=44;camera.updateProjectionMatrix();
      cameraFlight=null;
      if(railPilot){controls.minDistance=32;controls.minAzimuthAngle=-.75;controls.maxAzimuthAngle=.75;}
      activeArchetypeFilter = null;
      activeTreeLimit = treePositions.length;
      // Re-enter the nominal default LOD distribution, not a history-dependent
      // state inside the hysteresis band after a camera tour.
      [...treePositions, ...environmentTreePositions].forEach(tree => classifiedTrees.delete(tree));
      scene.traverse((object) => { if (object instanceof THREE.Sprite) object.visible = true; });
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update(); // consume residual orbit momentum before the reset
      camera.position.copy(homeCameraPosition);
      controls.target.copy(homeCameraTarget);
      controls.update();
      sampleCover?.group.userData.updateVegetation?.(camera);
      controls.enableDamping = damping;
      forestDirty = true;
    };

    const focusArchetype = (archetype: Archetype) => {
      const tree = treePositions.find((candidate) => candidate.archetype === archetype);
      if (!tree) return;
      activeArchetypeFilter = archetype;
      activeTreeLimit = 1;
      scene.traverse((object) => { if (object instanceof THREE.Sprite) object.visible = false; });
      const ground = terrainHeight(tree.x, tree.z);
      controls.target.set(tree.x, ground + 6.5, tree.z);
      camera.position.set(tree.x + 17, ground + 11, tree.z + 22);
      controls.update();
      forestDirty = true;
    };

    resetCameraRef.current = resetRuntimeCamera;
    if(businessSite==='hainan')window.__HAINAN_RUNTIME__ = { getMetrics: getRuntimeSnapshot, benchmarkCounts, setTreeLimit, focusArchetype, resetCamera: resetRuntimeCamera };

    void (async () => {
      try {
        for (const lod of (homeVisual ? [3,2] : LOD_LEVELS) as LODLevel[]) {
          await loadLOD(lod);
          if (cancelled) return;
          updateForestInstances();
          renderer.render(scene, camera);
          if (lod === 3) {
            firstGroveFrameMs = performance.now() - loadStartedAt;
            document.documentElement.dataset.treeAssets = "first-grove";
          }
        }
        while (!groundReady && !cancelled) await new Promise(resolve => setTimeout(resolve, 25));
        await sampleLighting?.ready;
        if (cancelled) return;
        allAssetsReadyMs = performance.now() - loadStartedAt;
        document.documentElement.dataset.treeAssets = "complete";
      } catch (error) {
        console.error("AF-04 tree asset loading failed", error);
        document.documentElement.dataset.treeAssets = "failed";
      }
    })();

    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(scenePixelRatio());
      renderer.setSize(host.clientWidth, host.clientHeight);
      forestDirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let frame = 0;
    let previousFrame = performance.now();
    let lastMetrics = 0;
    let loadingNearTrees=false;
    const animate = (now: number) => {
      if(homeVisual&&!loadingNearTrees&&loadedLods.has(2)&&!loadedLods.has(0)&&
        (selectedRef.current!==null||treePositions.some(t=>Math.hypot(camera.position.x-t.x,camera.position.y-terrainHeight(t.x,t.z)-6.8,camera.position.z-t.z)<28))){
        loadingNearTrees=true;
        void(async()=>{try{await loadLOD(1);if(!cancelled)await loadLOD(0);forestDirty=true;}finally{loadingNearTrees=false;}})();
      }
      zoneFleet?.update((now-previousFrame)/1000,getDemoMotionsRef.current?.()??[]);
      if(followingZone!==null){const p=zoneFleet?.position(followingZone);if(p){const a=1-Math.exp(-Math.min(100,now-previousFrame)/220);controls.target.lerp(p,a);camera.position.lerp(p.clone().add(alleyCamera()),a);}}
      if(!visibleRef.current || document.hidden){ previousFrame=now; frame=requestAnimationFrame(animate); return; }
      railPilot?.update((now-previousFrame)/1000);
      if(cameraFlight){
        const t=Math.min(1,(now-cameraFlight.start)/(matchMedia('(prefers-reduced-motion: reduce)').matches?1:650));
        const eased=t*t*(3-2*t);
        camera.position.lerpVectors(cameraFlight.from,cameraFlight.to,eased);
        controls.target.lerpVectors(cameraFlight.targetFrom,cameraFlight.targetTo,eased);
        if(t===1)cameraFlight=null;
      }
      if(profilesRef.current!==lastProfiles){lastProfiles=profilesRef.current;forestDirty=true;}
      const scopeChanged=selectableRef.current!==lastSelectable;
      const selection=selectedSceneTrees(treePositions.length,selectedRef.current,batchRef.current,selectableRef.current);
      if(selection.selected!==lastSelected||scopeChanged){
        forestDirty=true;
        lastSelected=selection.selected;const tree=lastSelected===null?undefined:treePositions[lastSelected];
        selectionRing.visible=!!tree&&observationIndex===null;selectionStem.visible=false;
        if(tree)selectionStem.position.set(tree.x,terrainHeight(tree.x,tree.z)+.2,tree.z);
        if(tree)selectionRing.position.set(tree.x,terrainHeight(tree.x,tree.z)+0.12,tree.z);
      }
      controls.update();
      sampleCover?.group.userData.updateVegetation?.(camera);
      scene.children.find(child=>child.name.startsWith('Environment_AssetRegistry_'))?.children.forEach(child=>child.userData.updateVegetation?.(camera));
      if(batchRef.current!==lastBatch||scopeChanged){
        forestDirty=true;lastBatch=batchRef.current;let count=0;
        for(const index of selection.batch){const tree=treePositions[index];
          batchMatrix.position.set(tree.x,terrainHeight(tree.x,tree.z)+.2,tree.z);batchMatrix.rotation.set(-Math.PI/2,0,0);batchMatrix.updateMatrix();
          batchRings.setMatrixAt(count++,batchMatrix.matrix);
        }
        batchRings.count=count;batchRings.instanceMatrix.needsUpdate=true;
      }
      lastSelectable=selectableRef.current;
      if (forestDirty) updateForestInstances();
      const motion=motionRef.current;
      if(robot.visible&&motion?.phase==='running'&&motion.treeIndex!==null){
        const t=treePositions[motion.treeIndex];
        if(t){
          const tx=t.x+2.6,tz=t.z+1.5;
          const factor=motion.stage==='work'?1:1-Math.exp(-Math.min(now-previousFrame,64)/350);
          robot.rotation.y=Math.atan2(tx-robot.position.x,tz-robot.position.z);
          robot.position.x+=(tx-robot.position.x)*factor;robot.position.z+=(tz-robot.position.z)*factor;
          robot.position.y=terrainHeight(robot.position.x,robot.position.z);
          robotHalo.position.set(robot.position.x,robot.position.y+.22,robot.position.z);
        }
      }
      sceneLabels.forEach(label=>{label.visible=false;const el=label.userData.domLabel as HTMLDivElement;if(!el)return;const p=label.position.clone().project(camera);const show=label!==robotLabel&&activeArchetypeFilter===null&&selectedRef.current===null&&followingZone===null&&p.z>-1&&p.z<1&&Math.abs(p.x)<.95&&Math.abs(p.y)<.9;el.style.display=show?'block':'none';if(show)el.style.transform='translate(-50%,-50%) translate('+((p.x+1)*host.clientWidth/2)+'px,'+((1-p.y)*host.clientHeight/2)+'px)';});
      const frameDuration = now - previousFrame;
      previousFrame = now;
      if (frameDuration > 0 && document.visibilityState === "visible") {
        frameTimes.push(frameDuration);
        if (frameTimes.length > 800) frameTimes.splice(0, frameTimes.length - 800);
      }
      pollGpuQuery();
      if (diagnostic) {
        for(const child of scene.children) child.visible = child === groundSample?.mesh || child instanceof THREE.Light || child.type === "Object3D";
      }
      if (groundTrial && params.get("groundOnly") === "1") {
        for (const child of scene.children) {
          child.visible = child === terrain || child === groundVisuals.group || child === groundSample?.mesh
            || child instanceof THREE.Light || (child.type === "Object3D");
        }
      }
      // Slow arm motion does not require re-rendering every forest shadow every frame.
      // Pending updates survive pause/reset so the final pose is also refreshed.
      if(railShadowDirty && now-lastRailShadowUpdate>=250){
        renderer.shadowMap.needsUpdate=true;
        railShadowDirty=false;lastRailShadowUpdate=now;
      }
      beginGpuQuery();
      renderer.render(scene, camera);
      endGpuQuery();
      if (now-lastMetrics > 1000) {
        document.documentElement.dataset.runtimeMetrics = JSON.stringify(getRuntimeSnapshot());
        lastMetrics = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    if (sampleMode) {
      camera.position.set(-21, 19, 53);
      controls.target.set(-39, 3, 4);
      if (params.get("sampleView") === "close") {
        controls.minDistance = 8;
        controls.maxPolarAngle = 1.48;
        camera.position.set(-32, 5.2, 34);
        controls.target.set(-44, terrainHeight(-44,15), 15);
      }
      controls.update();
    }
    // Inspection-only close-up; the operational default/reset camera is unchanged.
    const environmentView=params.get("environmentView");
    if(environmentRelease && (environmentView==="shrubs" || environmentView==="trees")){
      const natural=scene.getObjectByName("Hainan_Natural_Vegetation");
      const inspected=natural?.getObjectByName(environmentView==="shrubs" ? "Forest_Edge_Crosscard_Shrubs" : "Natural_Small_Tree_Trunks");
      if(inspected instanceof THREE.InstancedMesh){
        const transform=new THREE.Matrix4(),point=new THREE.Vector3();
        inspected.getMatrixAt(environmentView==="shrubs" ? 14 : 3,transform);
        point.setFromMatrixPosition(transform);
        controls.minDistance=3;controls.maxPolarAngle=1.48;
        controls.target.copy(point).add(new THREE.Vector3(0,environmentView==="shrubs" ? .65 : 1.8,0));
        camera.position.copy(point).add(environmentView==="shrubs" ? new THREE.Vector3(3,2.6,5) : new THREE.Vector3(8,4,12));
        controls.update();
      }
    }
    if(diagnostic) {
      controls.minDistance=4;
      camera.position.set(-37,22,31);
      controls.target.set(-42,0,15);
      controls.update();
      if(params.get("sunTurn") === "1") scene.children.forEach(child=>{
        if(child instanceof THREE.DirectionalLight) {
          child.position.sub(child.target.position).applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2).add(child.target.position);
        }
      });
      renderer.shadowMap.needsUpdate=true;
    }

    return () => {
      cancelled = true;
      railPilot?.dispose();
      window.removeEventListener('zone-fleet-follow',startFollowing);controls.removeEventListener('start',stopFollowing);
      sceneLabels.forEach(l=>(l.userData.domLabel as HTMLElement)?.remove());
      zoneFleet?.dispose();
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener('pointerdown',pointerDown);
      renderer.domElement.removeEventListener('pointerup',pointerUp);
      renderer.domElement.removeEventListener('pointermove',pointerMove);
      renderer.domElement.removeEventListener('pointercancel',pointerCancel);
      selectBox.remove();
      detachObservationCamera?.();
      focusTreeRef.current=null;
      focusZoneRef.current=null;
      observer.disconnect();
      controls.dispose();
      controls.removeEventListener("change", markForestDirty);
      if (pendingGpuQuery) gl.deleteQuery(pendingGpuQuery);
      if(businessSite==='hainan')delete window.__HAINAN_RUNTIME__;
      delete document.documentElement.dataset.groundSample;
      delete document.documentElement.dataset.environmentLayout;
      delete document.documentElement.dataset.groundCover;
      delete document.documentElement.dataset.naturalEnvironment;
      resetCameraRef.current = null;
      sampleLighting?.dispose();
      renderer.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if (object.geometry) geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((material) => {
            materials.add(material);
            Object.values(material).forEach((value) => {
              if (value instanceof THREE.Texture) textures.add(value);
            });
          });
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      groundSample?.dispose();
      groundVisuals.dispose();
      sampleCover?.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [site]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (new URLSearchParams(location.search).has("sample")||focusZone!==null) return;
    resetCameraRef.current?.();
  }, [resetKey]);

  useEffect(() => {
    const colors = ["#7be5b8", "#79b9ff", "#72d69c", "#f0b64b", "#7adfb6", "#5aa7ff"];
    zoneMaterialRef.current.forEach((material) => material.color.set(colors[activeLayer]));
  }, [activeLayer]);

  // Selection does not move the view. Only a deliberate focus request does.
  useEffect(()=>{if(selectedRef.current!==null)focusTreeRef.current?.(selectedRef.current);},[focusKey,site]);
  useEffect(()=>{if(focusZone!==null&&selectedRef.current===null)focusZoneRef.current?.(focusZone);},[focusZone,focusKey,resetKey,site]);
  return <div className="scene-host" ref={hostRef} aria-label={`${sites[site??'hainan']}三维场景`} style={{visibility:visible?'visible':'hidden'}} />;
}

