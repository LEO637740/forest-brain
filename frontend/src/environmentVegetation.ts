import * as THREE from "three";

export type NaturalEnvironmentUpgradeStats = {
  smallTreeCount: number;
  shrubCount: number;
  distantProxyCount: number;
  triangles: number;
  drawCalls: number;
  addedDrawCalls: number;
  replacedMeshes: number;
};

type GeometryBuilder = {
  positions: number[];
  colors: number[];
  indices: number[];
};

const LEAF_MATERIAL = () => new THREE.MeshStandardMaterial({
  color: "#f2f5ef",
  vertexColors: true,
  side: THREE.DoubleSide,
  roughness: 0.98,
  metalness: 0,
});

function pushVertex(builder: GeometryBuilder, point: THREE.Vector3, color: THREE.Color) {
  builder.positions.push(point.x, point.y, point.z);
  builder.colors.push(color.r, color.g, color.b);
  return builder.positions.length / 3 - 1;
}

function addLeaf(
  builder: GeometryBuilder,
  center: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  width: number,
  roll: number,
  color: THREE.Color,
) {
  const forward = direction.clone().normalize();
  let side = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 0.01) side.set(1, 0, 0);
  side.normalize();
  const normal = new THREE.Vector3().crossVectors(side, forward).normalize();
  side.applyAxisAngle(forward, roll);
  normal.applyAxisAngle(forward, roll);

  const base = center.clone().addScaledVector(forward, -length * 0.42);
  const outline = [
    base,
    center.clone().addScaledVector(forward, -length * 0.23).addScaledVector(side, width * 0.72),
    center.clone().addScaledVector(forward, length * 0.08).addScaledVector(side, width),
    center.clone().addScaledVector(forward, length * 0.34).addScaledVector(side, width * 0.55),
    center.clone().addScaledVector(forward, length * 0.58),
    center.clone().addScaledVector(forward, length * 0.34).addScaledVector(side, -width * 0.55),
    center.clone().addScaledVector(forward, length * 0.08).addScaledVector(side, -width),
    center.clone().addScaledVector(forward, -length * 0.23).addScaledVector(side, -width * 0.72),
  ];
  const first = builder.positions.length / 3;
  pushVertex(builder, center.clone().addScaledVector(normal, width * 0.07), color);
  outline.forEach((point, index) => {
    const camber = index === 0 || index === 4 ? 0 : width * 0.045;
    pushVertex(builder, point.clone().addScaledVector(normal, camber), color);
  });
  for (let edge = 0; edge < 8; edge += 1) {
    builder.indices.push(first, first + 1 + edge, first + 1 + ((edge + 1) % 8));
  }
}

function addBranch(
  builder: GeometryBuilder,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius0: number,
  radius1: number,
  color: THREE.Color,
  sides = 5,
) {
  const axis = to.clone().sub(from).normalize();
  let tangent = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
  if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
  tangent.normalize();
  const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();
  const start = builder.positions.length / 3;
  for (let ring = 0; ring < 2; ring += 1) {
    const center = ring === 0 ? from : to;
    const radius = ring === 0 ? radius0 : radius1;
    for (let sideIndex = 0; sideIndex < sides; sideIndex += 1) {
      const angle = sideIndex / sides * Math.PI * 2;
      const point = center.clone()
        .addScaledVector(tangent, Math.cos(angle) * radius)
        .addScaledVector(bitangent, Math.sin(angle) * radius);
      pushVertex(builder, point, color);
    }
  }
  for (let sideIndex = 0; sideIndex < sides; sideIndex += 1) {
    const next = (sideIndex + 1) % sides;
    builder.indices.push(
      start + sideIndex, start + next, start + sides + next,
      start + sideIndex, start + sides + next, start + sides + sideIndex,
    );
  }
}

function finishGeometry(builder: GeometryBuilder) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(builder.colors, 3));
  geometry.setIndex(builder.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCrownGeometry(form: "round" | "open" | "lobe") {
  const builder: GeometryBuilder = { positions: [], colors: [], indices: [] };
  // Near-neutral vertex tints preserve the existing per-instance natural greens.
  const colorA = new THREE.Color(form === "open" ? "#edf2e9" : "#e5eee1");
  const colorB = new THREE.Color(form === "lobe" ? "#dce8d9" : "#e1eadc");
  const random = seededRandom(form === "round" ? 7103 : form === "open" ? 9917 : 13249);
  const targetLeaves = form === "round" ? 408 : form === "open" ? 384 : 126;
  const leavesPerCluster = form === "lobe" ? 9 : 12;
  const clusterCount = Math.ceil(targetLeaves / leavesPerCluster);
  let emitted = 0;
  for (let cluster = 0; cluster < clusterCount && emitted < targetLeaves; cluster += 1) {
    let center = new THREE.Vector3();
    let attempts = 0;
    do {
      const theta = random() * Math.PI * 2;
      const radial = Math.sqrt(random()) * (form === "open" ? 0.78 : 0.72);
      const height = -0.48 + random() * 1.08;
      center.set(Math.cos(theta) * radial, height, Math.sin(theta) * radial * (form === "open" ? 0.72 : 0.88));
      attempts += 1;
      // Stable empty wedges and an uneven top edge keep the silhouette broken and non-spherical.
      const inNotch = form === "open"
        ? center.x > 0.05 && center.z > 0.12 && center.y > 0.05
        : center.x < -0.3 && center.z < -0.06 && center.y > 0.27;
      if (!inNotch || attempts > 12) break;
    } while (true);
    const outward = new THREE.Vector3(center.x, 0.18 + random() * 0.22, center.z).normalize();
    for (let leaf = 0; leaf < leavesPerCluster && emitted < targetLeaves; leaf += 1, emitted += 1) {
      const spreadAngle = random() * Math.PI * 2;
      const spreadRadius = 0.025 + random() * 0.075;
      const leafCenter = center.clone().add(new THREE.Vector3(
        Math.cos(spreadAngle) * spreadRadius,
        (random() - 0.5) * 0.085,
        Math.sin(spreadAngle) * spreadRadius,
      ));
      const direction = outward.clone().add(new THREE.Vector3(
        (random() - 0.5) * 0.75,
        (random() - 0.5) * 0.45,
        (random() - 0.5) * 0.75,
      )).normalize();
      addLeaf(
        builder,
        leafCenter,
        direction,
        0.09 + random() * 0.06,
        0.025 + random() * 0.02,
        random() * Math.PI * 2,
        emitted % 3 === 0 ? colorB : colorA,
      );
    }
  }
  return finishGeometry(builder);
}

function makeCrownBranchGeometry() {
  const builder: GeometryBuilder = { positions: [], colors: [], indices: [] };
  const bark = new THREE.Color("#716957");
  addBranch(builder, new THREE.Vector3(0, -0.75, 0), new THREE.Vector3(0, 0.16, 0), 0.055, 0.032, bark, 5);
  [0.1, 2.15, 4.2].forEach((angle, index) => {
    const from = new THREE.Vector3(0, -0.08 + index * 0.09, 0);
    const to = new THREE.Vector3(Math.cos(angle) * 0.54, 0.33 + index * 0.08, Math.sin(angle) * 0.47);
    addBranch(builder, from, to, 0.035, 0.012, bark, 5);
    addBranch(builder, to, to.clone().add(new THREE.Vector3(Math.cos(angle + 0.7) * 0.23, 0.18, Math.sin(angle + 0.7) * 0.2)), 0.013, 0.006, bark, 4);
  });
  return finishGeometry(builder);
}

function makeShrubGeometry() {
  const builder: GeometryBuilder = { positions: [], colors: [], indices: [] };
  const stem = new THREE.Color("#776f54");
  const leafColors = [new THREE.Color("#edf2e8"), new THREE.Color("#dce9d8"), new THREE.Color("#f1f0dc")];
  const tips: THREE.Vector3[] = [];
  for (let branch = 0; branch < 7; branch += 1) {
    const angle = branch / 7 * Math.PI * 2 + (branch % 2) * 0.31;
    const origin = new THREE.Vector3((branch % 3 - 1) * 0.05, 0, ((branch + 1) % 3 - 1) * 0.04);
    const tip = new THREE.Vector3(Math.cos(angle) * (0.38 + (branch % 2) * 0.1), 0.62 + (branch % 3) * 0.16, Math.sin(angle) * (0.38 + ((branch + 1) % 2) * 0.1));
    tips.push(tip);
    addBranch(builder, origin, tip, 0.022, 0.008, stem, 4);
  }
  const random = seededRandom(18427);
  tips.forEach((tip, branch) => {
    const angle = branch / tips.length * Math.PI * 2;
    for (let leaf = 0; leaf < 7; leaf += 1) {
      const leafAngle = angle + (leaf - 3) * 0.39 + (random() - 0.5) * 0.2;
      const center = tip.clone().add(new THREE.Vector3(Math.cos(leafAngle) * (0.08 + random() * 0.1), (leaf - 3) * 0.035, Math.sin(leafAngle) * (0.08 + random() * 0.1)));
      addLeaf(
        builder,
        center,
        new THREE.Vector3(Math.cos(leafAngle), 0.16 + leaf * 0.12, Math.sin(leafAngle)),
        0.25 + random() * 0.06,
        0.07 + random() * 0.025,
        leafAngle * 0.53 + leaf * 0.4,
        leafColors[(branch + leaf) % leafColors.length],
      );
    }
  });
  return finishGeometry(builder);
}

function makeProxyGeometry() {
  const builder: GeometryBuilder = { positions: [], colors: [], indices: [] };
  const colors = [new THREE.Color("#e7eee4"), new THREE.Color("#dae7d9"), new THREE.Color("#edf0e2")];
  const random = seededRandom(32041);
  const branchColor = new THREE.Color("#d0d8c9");
  const clusterCount = 24;
  const leavesPerCluster = 12;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const band = cluster % 3;
    const angle = random() * Math.PI * 2;
    const radius = 0.18 + random() * (0.72 - band * 0.08);
    const center = new THREE.Vector3(
      Math.cos(angle) * radius,
      0.16 + band * 0.27 + random() * 0.22,
      Math.sin(angle) * radius * 0.68,
    );
    // Omit two stable crown sectors so the distant wall reads as porous vegetation, not spheres.
    if ((center.x < -0.25 && center.z > 0.18 && band === 2) || (center.x > 0.42 && band === 1)) center.x *= 0.35;
    const branchBase = new THREE.Vector3(center.x * 0.28, 0.03 + band * 0.05, center.z * 0.28);
    addBranch(builder, branchBase, center, 0.009, 0.003, branchColor, 3);
    const outward = new THREE.Vector3(center.x, 0.22, center.z).normalize();
    for (let leaf = 0; leaf < leavesPerCluster; leaf += 1) {
      const spreadAngle = random() * Math.PI * 2;
      const leafCenter = center.clone().add(new THREE.Vector3(
        Math.cos(spreadAngle) * random() * 0.075,
        (random() - 0.5) * 0.08,
        Math.sin(spreadAngle) * random() * 0.065,
      ));
      const direction = outward.clone().add(new THREE.Vector3((random() - 0.5) * 0.9, (random() - 0.5) * 0.5, (random() - 0.5) * 0.9)).normalize();
      addLeaf(builder, leafCenter, direction, 0.07 + random() * 0.05, 0.035 + random() * 0.022, random() * Math.PI * 2, colors[(cluster + leaf) % colors.length]);
    }
  }
  return finishGeometry(builder);
}

function requireInstanced(group: THREE.Group, name: string) {
  const object = group.getObjectByName(name);
  if (!(object instanceof THREE.InstancedMesh)) throw new Error(`Natural environment mesh not found: ${name}`);
  return object;
}

function geometryTriangles(geometry: THREE.BufferGeometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
}

function materialTextures(material: THREE.Material) {
  const textures = new Set<THREE.Texture>();
  Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
  return textures;
}

/**
 * Replaces only the generated natural-vegetation assets inside the supplied group.
 * Business rubber-tree meshes and scene interaction state are deliberately untouched.
 */
export function upgradeNaturalEnvironment(
  group: THREE.Group,
  heightAt?: (x: number, z: number) => number,
): NaturalEnvironmentUpgradeStats {
  const cached = group.userData.naturalEnvironmentUpgradeStats as NaturalEnvironmentUpgradeStats | undefined;
  if (cached) return { ...cached };

  const trunk = requireInstanced(group, "Natural_Small_Tree_Trunks");
  const crownA = requireInstanced(group, "Natural_Small_Tree_Crowns_A");
  const crownB = requireInstanced(group, "Natural_Small_Tree_Crowns_B");
  const crownLobes = requireInstanced(group, "Natural_Small_Tree_Crown_Lobes");
  const shrubs = requireInstanced(group, "Forest_Edge_Crosscard_Shrubs");
  const proxies = requireInstanced(group, "Distant_Forest_Canopy_Proxies");
  if (trunk.count !== 80 || crownA.count + crownB.count !== 80 || crownLobes.count !== 80 || shrubs.count !== 320 || proxies.count !== 96) {
    throw new Error("Natural environment instance counts do not match the expected 80/320/96 layout.");
  }

  const targets = [crownA, crownB, crownLobes, shrubs, proxies];
  const oldGeometries = new Set(targets.map((mesh) => mesh.geometry));
  const oldMaterials = new Set<THREE.Material>();
  targets.forEach((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => oldMaterials.add(material)));

  // Count references from the owning scene so shared resources outside this vegetation group are never disposed.
  const geometryReferences = new Map<THREE.BufferGeometry, number>();
  const materialReferences = new Map<THREE.Material, number>();
  const textureReferences = new Map<THREE.Texture, number>();
  let root: THREE.Object3D = group;
  while (root.parent) root = root.parent;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometryReferences.set(object.geometry, (geometryReferences.get(object.geometry) ?? 0) + 1);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
      materialReferences.set(material, (materialReferences.get(material) ?? 0) + 1);
      materialTextures(material).forEach((texture) => textureReferences.set(texture, (textureReferences.get(texture) ?? 0) + 1));
    });
  });
  const targetGeometryReferences = new Map<THREE.BufferGeometry, number>();
  const targetMaterialReferences = new Map<THREE.Material, number>();
  const targetTextureReferences = new Map<THREE.Texture, number>();
  targets.forEach((mesh) => {
    targetGeometryReferences.set(mesh.geometry, (targetGeometryReferences.get(mesh.geometry) ?? 0) + 1);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
      targetMaterialReferences.set(material, (targetMaterialReferences.get(material) ?? 0) + 1);
      materialTextures(material).forEach((texture) => targetTextureReferences.set(texture, (targetTextureReferences.get(texture) ?? 0) + 1));
    });
  });

  const leafMaterial = LEAF_MATERIAL();
  crownA.geometry = makeCrownGeometry("round");
  crownB.geometry = makeCrownGeometry("open");
  crownLobes.geometry = makeCrownGeometry("lobe");
  shrubs.geometry = makeShrubGeometry();
  crownA.material = leafMaterial;
  crownB.material = leafMaterial;
  crownLobes.material = leafMaterial;
  shrubs.material = leafMaterial;
  trunk.castShadow = true;
  crownA.castShadow = true;
  crownB.castShadow = true;
  crownLobes.castShadow = true;
  shrubs.castShadow = true;

  const proxyMaterial = new THREE.MeshStandardMaterial({ color: "#edf2eb", vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  proxies.geometry = makeProxyGeometry();
  proxies.material = proxyMaterial;
  proxies.castShadow = false;

  if (heightAt) {
    const matrix = new THREE.Matrix4();
    const relatedMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const relatedPosition = new THREE.Vector3();
    const relatedRotation = new THREE.Quaternion();
    const relatedScale = new THREE.Vector3();
    for (let index = 0; index < trunk.count; index += 1) {
      trunk.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      const oldGround = position.y - scale.y * 0.5;
      const deltaY = heightAt(position.x, position.z) - oldGround;
      position.y += deltaY;
      matrix.compose(position, rotation, scale);
      trunk.setMatrixAt(index, matrix);

      const relatedMeshes = [crownLobes, index % 2 === 0 ? crownA : crownB];
      const relatedIndices = [index, Math.floor(index / 2)];
      relatedMeshes.forEach((mesh, relatedIndex) => {
        mesh.getMatrixAt(relatedIndices[relatedIndex], relatedMatrix);
        relatedMatrix.decompose(relatedPosition, relatedRotation, relatedScale);
        relatedPosition.y += deltaY;
        relatedMatrix.compose(relatedPosition, relatedRotation, relatedScale);
        mesh.setMatrixAt(relatedIndices[relatedIndex], relatedMatrix);
      });
    }
    [trunk, crownA, crownB, crownLobes].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });

    for (let index = 0; index < shrubs.count; index += 1) {
      shrubs.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      position.y = heightAt(position.x, position.z) - 0.02;
      const normal=new THREE.Vector3(heightAt(position.x-.2,position.z)-heightAt(position.x+.2,position.z),.4,
        heightAt(position.x,position.z-.2)-heightAt(position.x,position.z+.2)).normalize();
      rotation.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal));
      matrix.compose(position, rotation, scale);
      shrubs.setMatrixAt(index, matrix);
    }
    shrubs.instanceMatrix.needsUpdate = true;
  }

  const proxyMatrix = new THREE.Matrix4();
  const proxyPosition = new THREE.Vector3();
  const proxyRotation = new THREE.Quaternion();
  const proxyScale = new THREE.Vector3();
  for (let index = 0; index < proxies.count; index += 1) {
    proxies.getMatrixAt(index, proxyMatrix);
    proxyMatrix.decompose(proxyPosition, proxyRotation, proxyScale);
    const ground = heightAt
      ? heightAt(proxyPosition.x, proxyPosition.z)
      : proxyPosition.y - proxyScale.y * 0.34;
    proxyScale.y = Math.max(5.2, proxyScale.y * 3);
    proxyPosition.y = ground + 0.025;
    proxyMatrix.compose(proxyPosition, proxyRotation, proxyScale);
    proxies.setMatrixAt(index, proxyMatrix);
  }
  proxies.instanceMatrix.needsUpdate = true;

  const branchGeometry = makeCrownBranchGeometry();
  const branchMaterial = new THREE.MeshStandardMaterial({ color: "#6f6754", roughness: 1, metalness: 0, flatShading: true });
  const branches = new THREE.InstancedMesh(branchGeometry, branchMaterial, 80);
  branches.name = "Natural_Small_Tree_Crown_Branches";
  const trunkMatrix = new THREE.Matrix4();
  const lobeMatrix = new THREE.Matrix4();
  const trunkPosition = new THREE.Vector3();
  const trunkRotation = new THREE.Quaternion();
  const trunkScale = new THREE.Vector3();
  const lobePosition = new THREE.Vector3();
  const lobeRotation = new THREE.Quaternion();
  const lobeScale = new THREE.Vector3();
  for (let index = 0; index < 80; index += 1) {
    trunk.getMatrixAt(index, trunkMatrix);
    crownLobes.getMatrixAt(index, lobeMatrix);
    trunkMatrix.decompose(trunkPosition, trunkRotation, trunkScale);
    lobeMatrix.decompose(lobePosition, lobeRotation, lobeScale);
    const ground = trunkPosition.y - trunkScale.y * 0.5;
    const crownScale = new THREE.Vector3(lobeScale.x / 0.62, lobeScale.y / 0.72, lobeScale.z / 0.64);
    const crownPosition = new THREE.Vector3(trunkPosition.x, ground + trunkScale.y * 0.9, trunkPosition.z);
    trunkMatrix.compose(crownPosition, trunkRotation, crownScale);
    branches.setMatrixAt(index, trunkMatrix);
  }
  branches.instanceMatrix.needsUpdate = true;
  branches.frustumCulled = false;
  branches.castShadow = true;
  branches.receiveShadow = true;
  group.add(branches);

  oldGeometries.forEach((geometry) => {
    if ((geometryReferences.get(geometry) ?? 0) === (targetGeometryReferences.get(geometry) ?? 0)) geometry.dispose();
  });
  oldMaterials.forEach((material) => {
    if ((materialReferences.get(material) ?? 0) !== (targetMaterialReferences.get(material) ?? 0)) return;
    const textures = materialTextures(material);
    material.dispose();
    textures.forEach((texture) => {
      if ((textureReferences.get(texture) ?? 0) === (targetTextureReferences.get(texture) ?? 0)) texture.dispose();
    });
  });

  const renderedMeshes = [trunk, crownA, crownB, crownLobes, branches, shrubs, proxies];
  const triangles = renderedMeshes.reduce((sum, mesh) => sum + geometryTriangles(mesh.geometry) * mesh.count, 0);
  if (triangles > 900_000) throw new Error(`Natural vegetation triangle budget exceeded: ${triangles}`);
  const stats: NaturalEnvironmentUpgradeStats = {
    smallTreeCount: 80,
    shrubCount: 320,
    distantProxyCount: 96,
    triangles,
    drawCalls: renderedMeshes.length,
    addedDrawCalls: 1,
    replacedMeshes: 5,
  };
  group.userData.naturalEnvironmentUpgradeStats = stats;
  return { ...stats };
}
