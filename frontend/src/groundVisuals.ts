import * as THREE from "three";

/**
 * VC-A ground, road and drainage visuals.
 *
 * This module is deliberately data-agnostic: callers pass the existing road
 * centre lines and height sampler, so business coordinates and the 460 x 420
 * terrain remain authoritative. Two Phase-A CC0 sets plus one fine-gravel set
 * are documented in the corresponding public/assets/environment manifests.
 */

export type GroundHeightSampler = (x: number, z: number) => number;
export type GroundPoint = THREE.Vector2 | readonly [x: number, z: number];

export interface RoadVisualAlignment {
  id?: string;
  points: readonly GroundPoint[];
  /** Finished compacted carriageway width in metres. */
  width: number;
  /** Width of each compacted/litter transition. Defaults by road width. */
  shoulderWidth?: number;
  /** Raises the road above the sampled terrain. Defaults to 0.055 m. */
  surfaceLift?: number;
}

export interface DitchVisualAlignment {
  id?: string;
  points: readonly GroundPoint[];
  /** Top opening width in metres. */
  width: number;
  /** Depth at the damp invert. Defaults to 0.48 m. */
  depth?: number;
}

export interface GroundVisualOptions {
  heightAt: GroundHeightSampler;
  roads: readonly RoadVisualAlignment[];
  ditches?: readonly DitchVisualAlignment[];
  manager?: THREE.LoadingManager;
  assetRoot?: string;
  anisotropy?: number;
  roadSamples?: number;
}

export interface GroundVisualSystem {
  /** Add this group once, after the terrain mesh. */
  group: THREE.Group;
  /** Use this on the existing 460 x 420 terrain mesh. */
  terrainMaterial: THREE.MeshStandardMaterial;
  /** Depth removed by the representative ditch sections; zero below roads. */
  carveDepthAt: GroundHeightSampler;
  /** Base height minus carveDepthAt. Use for every terrain vertex. */
  terrainHeightAt: GroundHeightSampler;
  materials: readonly THREE.Material[];
  textures: readonly THREE.Texture[];
  dispose: () => void;
}

const DEFAULT_ASSET_ROOT = "/assets/environment/phase-a";

function point2(point: GroundPoint) {
  return point instanceof THREE.Vector2
    ? point.clone()
    : new THREE.Vector2(point[0], point[1]);
}

function loadPbrSet(
  loader: THREE.TextureLoader,
  root: string,
  asset: "forest_floor" | "brown_mud" | "gravel",
  anisotropy: number,
  textures: THREE.Texture[],
) {
  const load = (channel: "Diffuse" | "nor_gl" | "Rough") => {
    const texture = loader.load(`${root}/${asset}_${channel}.jpg`);
    texture.name = `VC-A_${asset}_${channel}`;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    texture.colorSpace = channel === "Diffuse" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    textures.push(texture);
    return texture;
  };
  return { map: load("Diffuse"), normalMap: load("nor_gl"), roughnessMap: load("Rough") };
}

function makeTerrainMaterial(forest: ReturnType<typeof loadPbrSet>) {
  const material = new THREE.MeshStandardMaterial({
    ...forest,
    name: "VC-A_Macro_Forest_Floor",
    color: "#c1c6aa",
    vertexColors: false,
    roughness: 0.9,
    metalness: 0,
    normalScale: new THREE.Vector2(0.42, 0.42),
  });

  // Three decorrelated samples suppress the obvious 2.1 m wallpaper repeat.
  // Very-low-frequency colour variation separates damp hollows, litter and
  // compacted production traces without adding meshes or vegetation.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vcWorldPosition;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvcWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
    shader.fragmentShader = `varying vec3 vcWorldPosition;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        mat2 vcRotateA = mat2(.8192, -.5736, .5736, .8192);
        mat2 vcRotateB = mat2(.4226, .9063, -.9063, .4226);
        vec2 vcUv = vcWorldPosition.xz / 2.35;
        vec3 vcA = texture2D(map, vcUv).rgb;
        vec3 vcB = texture2D(map, vcRotateA * vcUv * .713 + vec2(.173, .619)).rgb;
        vec3 vcC = texture2D(map, vcRotateB * vcUv * .437 + vec2(.731, .287)).rgb;
        float vcBlend = .5 + .5 * sin(vcWorldPosition.x * .047 + sin(vcWorldPosition.z * .031) * 2.1);
        vec3 vcFloor = mix(vcA, vcB, .34 + .18 * vcBlend);
        vcFloor = mix(vcFloor, vcC, .17);
        float vcWet = smoothstep(.28, .86,
          .5 + .25 * sin(vcWorldPosition.x * .024 - vcWorldPosition.z * .019)
             + .25 * sin((vcWorldPosition.x + vcWorldPosition.z) * .011));
        float vcTrace = smoothstep(.72, .98,
          .5 + .5 * sin(vcWorldPosition.x * .071 + sin(vcWorldPosition.z * .018) * 2.4));
        vcFloor *= mix(vec3(1.04, 1.02, .94), vec3(.68, .76, .62), vcWet * .28);
        vcFloor *= mix(vec3(1.0), vec3(.86, .79, .66), vcTrace * .15);
        float patches = .5+.24*sin(vcWorldPosition.x*.037+sin(vcWorldPosition.z*.041)*2.0)
          +.20*sin(vcWorldPosition.z*.083+vcWorldPosition.x*.019);
        vec3 grassSoil = mix(vec3(.34,.48,.23),vec3(.72,.62,.44),smoothstep(.28,.72,patches));
        float broad = .5+.5*sin(vcWorldPosition.x*.013+sin(vcWorldPosition.z*.017)*1.6);
        grassSoil=mix(grassSoil,vec3(.32,.39,.24),smoothstep(.62,.9,broad)*.26);
        // Preserve the sampled albedo. The previous mix replaced almost all
        // texture with a uniform material colour, so PBR detail disappeared.
        diffuseColor.rgb *= mix(vcFloor,vec3(dot(vcFloor,vec3(.2126,.7152,.0722))),.36)
          * grassSoil * 1.65;
        float vcSoilPatch = smoothstep(.44,.79,patches)
          * (.45 + .55*smoothstep(.25,.75,sin(vcWorldPosition.x*.018-vcWorldPosition.z*.027)*.5+.5));
        float vcDampPatch = smoothstep(.66,.93,vcWet)
          * smoothstep(.2,.85,sin((vcWorldPosition.x+vcWorldPosition.z)*.032)*.5+.5);
        diffuseColor.rgb *= mix(vec3(1.0),vec3(1.13,.94,.72),vcSoilPatch*.46);
        diffuseColor.rgb *= 1.0-vcDampPatch*.18;
      #endif
    `);
  };
  material.customProgramCacheKey = () => "vc-a-ground-albedo-v2";
  return material;
}

function makeRoadMaterial(
  mud: ReturnType<typeof loadPbrSet>,
  name: string,
  color: THREE.ColorRepresentation,
  normalScale: number,
) {
  const material = new THREE.MeshStandardMaterial({
    ...mud,
    name,
    color,
    roughness: 0.92,
    metalness: 0,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: true,
    depthWrite: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec2 vcRoadUv; varying vec2 vcRibbon;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvcRibbon = vcRoadUv;",
    );
    shader.fragmentShader = `varying vec2 vcRibbon;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        mat2 vcRoadRotate = mat2(.866, -.5, .5, .866);
        vec3 vcRoadA = texture2D(map, vMapUv).rgb;
        vec3 vcRoadB = texture2D(map, vcRoadRotate * vMapUv * .77 + vec2(.37, .19)).rgb;
        vec3 vcRoadTex = mix(vcRoadA, vcRoadB, .31);
        diffuseColor *= vec4(vcRoadTex * 1.35, 1.0);
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      float vcWheel = exp(-pow((abs(vcRibbon.x) - .47) / .105, 2.0));
      float vcLongBreakup = .5 + .5 * sin(vcRibbon.y * .41 + sin(vcRibbon.y * .09));
      diffuseColor.rgb *= 1.0 - vcWheel * (.12 + .075 * vcLongBreakup);
      diffuseColor.rgb *= .94 + .055*sin(vcRibbon.y*.19 + sin(vcRibbon.y*.047)*1.7);
      float vcEdgeNoise = .035*sin(vcRibbon.y*2.1)+.025*sin(vcRibbon.y*5.7);
      diffuseColor.a *= 1.0-smoothstep(.76+vcEdgeNoise,1.0,abs(vcRibbon.x));
      if(diffuseColor.a<.015) discard;
    `);
  };
  material.customProgramCacheKey = () => `vc-a-road-${name}`;
  return material;
}

function curveFor(points: readonly GroundPoint[]) {
  if (points.length < 2) throw new Error("Ground visual alignment needs at least two points.");
  return new THREE.CatmullRomCurve3(points.map((value) => {
    const point = point2(value);
    return new THREE.Vector3(point.x, 0, point.y);
  }), false, "centripetal");
}

function pushQuad(target: number[], a: number, b: number, c: number, d: number) {
  // Rows advance along the tangent and columns along normal=(-tz, 0, tx).
  // normal x tangent points +Y, so this winding is front-facing from above.
  target.push(a, b, c, b, d, c);
}

function buildRoadMesh(
  alignment: RoadVisualAlignment,
  heightAt: GroundHeightSampler,
  materials: readonly THREE.Material[],
  sampleCount: number,
) {
  const curve = curveFor(alignment.points);
  const samples = curve.getSpacedPoints(sampleCount);
  const halfRoad = alignment.width * 0.5;
  const shoulder = alignment.shoulderWidth ?? THREE.MathUtils.clamp(alignment.width * 0.32, 0.85, 1.45);
  const outer = halfRoad + shoulder;
  const lift = alignment.surfaceLift ?? 0.055;
  // Dense near the road edge: the small height break reads as a constructed,
  // crowned farm road rather than a texture ribbon.
  const cross = [-outer, -halfRoad, -halfRoad * .72, 0, halfRoad * .72, halfRoad, outer];
  const vertices: number[] = [];
  const uvs: number[] = [];
  const roadUv: number[] = [];
  const roadIndices: number[] = [];
  const shoulderIndices: number[] = [];
  const length = curve.getLength();

  samples.forEach((point, row) => {
    const previous = samples[Math.max(0, row - 1)];
    const next = samples[Math.min(samples.length - 1, row + 1)];
    const tangent = next.clone().sub(previous).setY(0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    cross.forEach((offset) => {
      const x = point.x + normal.x * offset;
      const z = point.z + normal.z * offset;
      const roadRatio = Math.min(1, Math.abs(offset) / halfRoad);
      const shoulderRatio = THREE.MathUtils.clamp((Math.abs(offset) - halfRoad) / shoulder, 0, 1);
      const crown = Math.abs(offset) <= halfRoad ? .055 * (1 - roadRatio * roadRatio) : 0;
      const shoulderDrop = shoulderRatio * (lift + .035);
      vertices.push(x, heightAt(x, z) + lift + crown - shoulderDrop, z);
      uvs.push(x / 3, z / 3);
      roadUv.push(offset / Math.max(outer, .001), row / sampleCount * length);
    });
  });

  const columns = cross.length;
  for (let row = 0; row < samples.length - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const target = Math.abs((cross[column] + cross[column + 1]) * .5) <= halfRoad
        ? roadIndices : shoulderIndices;
      const a = row * columns + column;
      pushQuad(target, a, a + 1, a + columns, a + columns + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("vcRoadUv", new THREE.Float32BufferAttribute(roadUv, 2));
  geometry.setIndex([...roadIndices, ...shoulderIndices]);
  geometry.addGroup(0, roadIndices.length, 0);
  geometry.addGroup(roadIndices.length, shoulderIndices.length, 1);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, [...materials]);
  mesh.name = `VC-A_Road_${alignment.id ?? "alignment"}`;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}

interface FlatSegment { a: THREE.Vector2; b: THREE.Vector2; road: RoadVisualAlignment }

function segmentsFor(road: RoadVisualAlignment): FlatSegment[] {
  const points = road.points.map(point2);
  return points.slice(0, -1).map((a, index) => ({ a, b: points[index + 1], road }));
}

function distanceToRoads(point: THREE.Vector3, roads: readonly RoadVisualAlignment[]) {
  let clearance = Infinity;
  const test = new THREE.Vector2(point.x, point.z);
  roads.forEach((road) => segmentsFor(road).forEach(({ a, b }) => {
    const line = new THREE.Line3(new THREE.Vector3(a.x, 0, a.y), new THREE.Vector3(b.x, 0, b.y));
    const closest = new THREE.Vector3();
    line.closestPointToPoint(new THREE.Vector3(test.x, 0, test.y), true, closest);
    const shoulder = road.shoulderWidth ?? THREE.MathUtils.clamp(road.width * .32, .85, 1.45);
    clearance = Math.min(clearance, test.distanceTo(new THREE.Vector2(closest.x, closest.z)) - road.width * .5 - shoulder * .42);
  }));
  return clearance;
}

function addCulvertMouth(
  group: THREE.Group,
  point: THREE.Vector3,
  tangent: THREE.Vector3,
  heightAt: GroundHeightSampler,
  depth: number,
  material: THREE.Material,
  index: number,
) {
  const radius = THREE.MathUtils.clamp(depth * .56, .22, .36);
  const geometry = new THREE.CircleGeometry(radius, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `VC-A_Culvert_Mouth_${index}`;
  mesh.position.set(point.x, heightAt(point.x, point.z) - depth * .52, point.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.clone().setY(0).normalize());
  mesh.renderOrder = 1;
  group.add(mesh);
}

function buildDitch(
  alignment: DitchVisualAlignment,
  roads: readonly RoadVisualAlignment[],
  heightAt: GroundHeightSampler,
  bankMaterial: THREE.Material,
  bedMaterial: THREE.Material,
  culvertMaterial: THREE.Material,
) {
  const curve = curveFor(alignment.points);
  const samples = curve.getSpacedPoints(150);
  const half = alignment.width * .5;
  const depth = alignment.depth ?? .48;
  // Broad banks meet uncut terrain; a narrow low invert is embedded between
  // them. This covers the coarse-grid excavation instead of leaving a black
  // seam between the terrain and the old narrow lining.
  const cross = [-half-1.1, -half, -half*.35, half*.35, half, half+1.1];
  const profile = [.01, -.035, -depth, -depth, -.035, .01];
  const vertices: number[] = [];
  const uvs: number[] = [];
  const bankIndices: number[] = [];
  const bedIndices: number[] = [];
  const hidden = samples.map((point) => distanceToRoads(point, roads) < 0);

  samples.forEach((point, row) => {
    const previous = samples[Math.max(0, row - 1)];
    const next = samples[Math.min(samples.length - 1, row + 1)];
    const tangent = next.clone().sub(previous).setY(0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    cross.forEach((offset, column) => {
      const x = point.x + normal.x * offset;
      const z = point.z + normal.z * offset;
      vertices.push(x, heightAt(x, z) + .018 + profile[column], z);
      uvs.push(x / 1.4, z / 1.4);
    });
  });

  for (let row = 0; row < samples.length - 1; row += 1) {
    if (hidden[row] || hidden[row + 1]) continue;
    for (let column = 0; column < cross.length - 1; column += 1) {
      const target = column === 2 ? bedIndices : bankIndices;
      const a = row * cross.length + column;
      pushQuad(target, a, a + 1, a + cross.length, a + cross.length + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...bankIndices, ...bedIndices]);
  geometry.addGroup(0, bankIndices.length, 0);
  geometry.addGroup(bankIndices.length, bedIndices.length, 1);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, [bankMaterial, bedMaterial]);
  mesh.name = `VC-A_Ditch_${alignment.id ?? "alignment"}`;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);
  let mouthIndex = 0;
  hidden.forEach((isHidden, row) => {
    if (!row || isHidden === hidden[row - 1]) return;
    const previous = samples[Math.max(0, row - 1)];
    const next = samples[Math.min(samples.length - 1, row + 1)];
    const tangent = next.clone().sub(previous).normalize();
    addCulvertMouth(group, samples[row], tangent, heightAt, depth, culvertMaterial, ++mouthIndex);
  });
  return group;
}

export function createGroundVisuals(options: GroundVisualOptions): GroundVisualSystem {
  const ditchSamples = (options.ditches ?? []).map(ditch => {
    const samples=curveFor(ditch.points).getSpacedPoints(200);
    return {...ditch,samples,minX:Math.min(...samples.map(p=>p.x)),maxX:Math.max(...samples.map(p=>p.x))};
  });
  const carveDepthAt = (x: number, z: number) => {
    let cut = 0;
    for (const ditch of ditchSamples) {
      const pad=ditch.width*.5+1.5;
      if (x<ditch.minX-pad ||
          x>ditch.maxX+pad ||
          z<ditch.samples[0].z-pad || z>ditch.samples[ditch.samples.length-1].z+pad) continue;
      let distance = Infinity;
      for (let i = 0; i < ditch.samples.length - 1; i++) {
        const a = ditch.samples[i], b = ditch.samples[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const t = THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
        distance = Math.min(distance, Math.hypot(x-a.x-t*dx,z-a.z-t*dz));
      }
      const half = ditch.width * .5;
      if (distance > half + .8) continue;
      // Cut slightly wider/deeper than the lining to avoid the coarse terrain
      // intersecting the ditch walls between grid samples.
      if (distanceToRoads(new THREE.Vector3(x,0,z),options.roads)<-.25) continue;
      const profile = 1-THREE.MathUtils.smoothstep(distance,half*.35,half+.7);
      cut = Math.max(cut, ((ditch.depth ?? .48)+.08)*profile);
    }
    return cut;
  };
  const terrainHeightAt = (x: number,z: number) => options.heightAt(x,z)-carveDepthAt(x,z);
  const root = options.assetRoot ?? DEFAULT_ASSET_ROOT;
  const textures: THREE.Texture[] = [];
  const loader = new THREE.TextureLoader(options.manager ?? THREE.DefaultLoadingManager);
  const anisotropy = options.anisotropy ?? 8;
  const forest = loadPbrSet(loader, root, "forest_floor", anisotropy, textures);
  const mud = loadPbrSet(loader, root, "brown_mud", anisotropy, textures);
  const gravel = loadPbrSet(loader, "/assets/environment/vc-a", "gravel", anisotropy, textures);
  const terrainMaterial = makeTerrainMaterial(forest);
  const roadMaterial = makeRoadMaterial(gravel, "Compacted_Surface", "#ddd2b7", .4);
  const shoulderMaterial = makeRoadMaterial(gravel, "Road_Shoulder", "#a1a17a", .28);
  // The bank is the same forest soil, not a second brown ribbon. Recreate
  // the shader explicitly: Material.clone does not copy onBeforeCompile.
  const ditchBankMaterial = makeTerrainMaterial(forest);
  ditchBankMaterial.name = "VC-A_Ditch_Banks";
  ditchBankMaterial.side = THREE.DoubleSide;
  ditchBankMaterial.normalScale.set(.28,.28);
  const ditchBedMaterial = new THREE.MeshStandardMaterial({
    ...mud, name: "VC-A_Damp_Ditch_Bed", color: "#aaa18a", roughness: .72,
    normalScale: new THREE.Vector2(.22,.22),
    side: THREE.DoubleSide,
  });
  const culvertMaterial = new THREE.MeshStandardMaterial({
    name: "VC-A_Culvert_Interior", color: "#202a25", roughness: .82,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const materials: THREE.Material[] = [
    terrainMaterial, roadMaterial, shoulderMaterial,
    ditchBankMaterial, ditchBedMaterial, culvertMaterial,
  ];

  const group = new THREE.Group();
  group.name = "VC-A_Ground_Visuals";
  options.roads.forEach((road) => {
    group.add(buildRoadMesh(
      road,
      options.heightAt,
      [roadMaterial, shoulderMaterial],
      options.roadSamples ?? 180,
    ));
  });
  // Do not overlay circular junction patches: they read as traffic islands.
  // All roads use the same world-space material scale at their intersections.
  options.ditches?.forEach((ditch) => {
    group.add(buildDitch(
      ditch, options.roads, options.heightAt,
      ditchBankMaterial, ditchBedMaterial, culvertMaterial,
    ));
  });

  const dispose = () => {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  };
  return { group, terrainMaterial, materials, textures, dispose, carveDepthAt, terrainHeightAt };
}
