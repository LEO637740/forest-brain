import * as THREE from 'three/webgpu';
import { attribute, mix, normalMap, positionWorld, sin, texture, uniform, vec2, vec3 } from 'three/tsl';

/** Bounded TSL migration probe, NOT a replacement for the homepage shader.
 * Reuses source PBR assets and gsSurface masks/relief. Two offset samples use
 * identical coordinates and weights across albedo, normals and roughness.
 * Full rotated stochastic sampling/cover mask is deliberately not claimed. */
export async function trialGroundMaterial() {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const sets = await Promise.all(['dirt', 'leaves_forest_ground'].map(async name =>
    Promise.all(['Diffuse', 'nor_gl', 'Rough'].map(async channel => {
      const t = await loader.loadAsync(`/assets/environment/material-candidates/${name}_${channel}.jpg`);
      t.colorSpace = channel === 'Diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      textures.push(t);
      return t;
    }))));
  const xz = positionWorld.xz;
  const uv = xz.mul(.28);
  const weight = sin(xz.x.mul(.19).add(sin(xz.y.mul(.23)))).mul(.23).add(.5);
  const surface = attribute('gsSurface', 'vec4');
  const litter = surface.x.mul(surface.y.oneMinus());
  const sampled = (t: THREE.Texture) => mix(texture(t, uv), texture(t, uv.add(vec2(.37, .63))), weight);
  const material = new THREE.MeshStandardNodeMaterial();
  material.name = 'WebGPU_trial_ground_TSL';
  const understory=uniform(1);
  material.colorNode = mix(sampled(sets[0][0]).rgb, sampled(sets[1][0]).rgb, litter)
    .mul(mix(1, .72, surface.z)).mul(mix(1, mix(.63,.88,understory), surface.w));
  // Existing root mask attenuates indirect illumination, not sunlight.
  // This is a bounded contact approximation, not SSAO or real-time GI.
  material.aoNode=mix(1,.68,surface.w.mul(understory));
  const n = mix(sampled(sets[0][1]).xyz.mul(2).sub(1), sampled(sets[1][1]).xyz.mul(2).sub(1), litter).normalize();
  material.normalNode = normalMap(n.mul(.5).add(vec3(.5)), vec2(.7));
  material.roughnessNode = mix(sampled(sets[0][2]).g, sampled(sets[1][2]).g, litter)
    .mul(mix(1, .75, surface.z)).clamp(.45, 1);
  return { material, textures, setUnderstory:(enabled:boolean)=>{understory.value=enabled?1:0;} };
}
