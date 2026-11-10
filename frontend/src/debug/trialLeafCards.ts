import * as THREE from 'three/webgpu';
import { texture, reference, uniform, normalView, transformNormalToView, vec3, mix } from 'three/tsl';

/** Isolated trial: same cutout in main/shadow pass, mild leaf-cluster normal bias. */
export function trialLeafCards(material: THREE.MeshStandardNodeMaterial) {
  const cutoff=uniform(.34), normalBlend=uniform(0);
  // Three's renderer uses the same texture reference; typings omit its vec4 swizzle.
  const typedTexture=texture(material.map!);
  const alpha=(reference('map','texture',material) as unknown as typeof typedTexture).a;
  material.alphaTestNode=cutoff.sub(alpha.fwidth().max(.001).mul(.5));
  material.alphaToCoverage=true;
  // normalView already handles back faces. Up is transformed once into view space.
  // This approximates a cluster of upward-facing leaves, not a flat billboard sheet.
  material.normalNode=mix(normalView,transformNormalToView(vec3(0,1,0)),normalBlend).normalize();
  return (stage:number)=>{
    cutoff.value=stage>=3?.48:.34;
    normalBlend.value=stage>=2?.25:0;
    material.alphaTest=stage>=1?cutoff.value:0;
  };
}
