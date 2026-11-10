import * as THREE from 'three/webgpu';

// Runtime-only calibration. Frozen textures and GLBs remain untouched.
export function calibrateCanopy(material: THREE.MeshStandardNodeMaterial, lod=0) {
  const mean = new THREE.Color(1, 1, 1);
  let coverage: number | null = null;
  const image = material.map?.image as (CanvasImageSource & {width:number;height:number}) | undefined;
  if (image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const sum = [0, 0, 0]; let weight = 0, covered = 0;
    const linear = (v: number) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3] / 255;
      if (a < .34) continue;
      covered++; weight += a;
      for (let c = 0; c < 3; c++) sum[c] += linear(rgba[i + c]) * a;
    }
    if (weight) mean.setRGB(...sum.map(v => v / weight) as [number, number, number]);
    coverage = covered / (rgba.length / 4);
  }
  const original = { color: material.color.clone(), emissive: material.emissive.clone(), intensity: material.emissiveIntensity };
  const target = new THREE.Color('#698949');
  const corrected = new THREE.Color(target.r / Math.max(.1, mean.r), target.g / Math.max(.1, mean.g), target.b / Math.max(.1, mean.b));
  let enabledNow=true, distanceMatch=true;
  const apply=(enabled:boolean)=>{
    enabledNow=enabled;
    material.color.copy(enabled ? corrected : original.color);
    // Modest linear-radiance compensation only; no alpha/geometry change.
    if(enabled&&distanceMatch&&lod===3)material.color.multiplyScalar(1.12);
    material.emissive.copy(enabled ? new THREE.Color('#25391b') : original.emissive);
    material.emissiveIntensity=enabled?.1:original.intensity;
  };
  return {
    diagnostics: { name: material.name, atlasLinearMean: mean.toArray(), alphaCoverage: coverage, correctedMultiplier: corrected.toArray() },
    apply,
    distanceMatch(enabled:boolean){distanceMatch=enabled;apply(enabledNow);},
  };
}
