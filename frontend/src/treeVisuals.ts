import * as THREE from "three";

export type TreeLODLevel = 0 | 1 | 2 | 3;

export type TreeMaterialOptions = {
  /** Supplying the LOD is preferred; the material-name fallback is for legacy callers. */
  lod?: TreeLODLevel;
  alphaCutoff?: number;
};

export type TreeLODPolicy = {
  /** Distances for the 0->1, 1->2 and 2->3 transitions, in world metres. */
  distances: readonly [number, number, number];
  /** Half-width of the stable band around each transition. */
  hysteresis: readonly [number, number, number];
};

/**
 * LOD3 starts later than in the previous 38/60/130 policy.  This deliberately
 * spends more triangles on readable mid-ground crowns and reserves cards for
 * the far field.  Validate the 160 m boundary against moving-camera P95 before
 * adopting it wholesale for the 360 environment trees.
 */
export const DEFAULT_TREE_LOD_POLICY: TreeLODPolicy = {
  distances: [38, 64, 160],
  hysteresis: [4, 6, 12],
};

const atlasTextureCache = new WeakMap<object, THREE.Texture>();

function isLeafMaterial(material: THREE.MeshStandardMaterial) {
  return /leaf|foliage/i.test(material.name);
}

function isCardAtlas(material: THREE.MeshStandardMaterial, lod?: TreeLODLevel) {
  return lod === 3 || /cluster|atlas|card/i.test(material.name);
}

/**
 * Reduces baked lighting in the LOD3 atlas without turning it into greyscale.
 * Base-level alpha is preserved; lower mip levels preserve cutout coverage.
 */
function createBalancedAtlas(source: THREE.Texture) {
  const image = source.image as CanvasImageSource & { width?: number; height?: number };
  if (!image || !image.width || !image.height || typeof document === "undefined") return source;

  const cached = atlasTextureCache.get(image as object);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;

  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let weightedLuminance = 0;
  let alphaWeight = 0;
  for (let index = 0; index < pixels.data.length; index += 4) {
    const alpha = pixels.data[index + 3] / 255;
    const luminance = pixels.data[index] * 0.2126
      + pixels.data[index + 1] * 0.7152
      + pixels.data[index + 2] * 0.0722;
    weightedLuminance += luminance * alpha;
    alphaWeight += alpha;
  }

  const mean = weightedLuminance / Math.max(alphaWeight, 1);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3] === 0) continue;
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    // Compress baked light/shadow, retain restrained local hue variation.
    const balancedLuminance = THREE.MathUtils.clamp(232 + (luminance - mean) * 0.48, 198, 250);
    pixels.data[index] = THREE.MathUtils.clamp(balancedLuminance + (red - luminance) * 0.42, 0, 255);
    pixels.data[index + 1] = THREE.MathUtils.clamp(balancedLuminance + (green - luminance) * 0.42, 0, 255);
    pixels.data[index + 2] = THREE.MathUtils.clamp(balancedLuminance + (blue - luminance) * 0.42, 0, 255);
  }
  context.putImageData(pixels, 0, 0);

  const texture = source.clone();
  texture.source = new THREE.TextureSource(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Default mip averaging dilutes fine leaf alpha below the cutout threshold.
  // Preserve the base-image coverage in each runtime mip instead of lowering
  // alphaTest by camera distance (which made distant cards become rectangles).
  const cutoff = .34;
  let covered = 0;
  for (let i=3;i<pixels.data.length;i+=4) if(pixels.data[i]/255>=cutoff) covered++;
  const coverage = covered/(canvas.width*canvas.height);
  const mips: HTMLCanvasElement[] = [canvas];
  for(let size=canvas.width/2;size>=1;size=Math.floor(size/2)) {
    const mip=document.createElement("canvas");
    mip.width=Math.max(1,Math.floor(size));
    mip.height=Math.max(1,Math.round(canvas.height*mip.width/canvas.width));
    const ctx=mip.getContext("2d",{willReadFrequently:true})!;
    ctx.drawImage(canvas,0,0,mip.width,mip.height);
    const rgba=ctx.getImageData(0,0,mip.width,mip.height);
    let lo=.25,hi=4;
    for(let pass=0;pass<12;pass++) {
      const scale=(lo+hi)/2;
      let count=0;
      for(let i=3;i<rgba.data.length;i+=4) if(rgba.data[i]/255*scale>=cutoff) count++;
      if(count/(mip.width*mip.height)<coverage) lo=scale; else hi=scale;
    }
    const scale=(lo+hi)/2;
    for(let i=0;i<rgba.data.length;i+=4) {
      // Canvas filters premultiplied RGB; fill transparent texels with neutral
      // atlas colour so trilinear edge sampling does not add a dark halo.
      if(rgba.data[i+3]===0) rgba.data[i]=rgba.data[i+1]=rgba.data[i+2]=232;
      rgba.data[i+3]=Math.min(255,Math.round(rgba.data[i+3]*scale));
    }
    ctx.putImageData(rgba,0,0);
    mips.push(mip);
    if(mip.width===1) break;
  }
  texture.mipmaps=mips;
  texture.generateMipmaps=false;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  atlasTextureCache.set(image as object, texture);
  return texture;
}

/** Shared runtime material preparation for both the homepage and LOD comparison. */
export function prepareTreeMaterial(source: THREE.Material, options: TreeMaterialOptions = {}) {
  const material = source.clone();
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  if (isLeafMaterial(material)) {
    material.roughness = 0.86;
    material.metalness = 0;
    material.emissive.set("#25391b");
    material.emissiveIntensity = 0.1;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;

    if (material.map && isCardAtlas(material, options.lod)) {
      material.map = createBalancedAtlas(material.map);
      material.color.set("#93ac70");
      material.emissive.set("#3b5630");
      material.emissiveIntensity = 0.14;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.alphaTest = options.alphaCutoff ?? 0.34;
      // Centre the MSAA edge transition on the coverage-preserving cutoff.
      // A one-sided derivative transition eroded thin distant leaves again.
      material.alphaToCoverage = true;
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
          float edgeWidth = max(fwidth(diffuseColor.a), .001);
          diffuseColor.a = smoothstep(alphaTest-edgeWidth*.5, alphaTest+edgeWidth*.5, diffuseColor.a);
          if (diffuseColor.a == 0.0) discard;
        `);
      };
      material.customProgramCacheKey = () => "vc-a-centred-card-coverage-v1";
    } else {
      material.color.set("#698949");
    }
  } else if (/body|bark|trunk/i.test(material.name)) {
    material.color.set("#d3c6af");
    material.roughness = 0.9;
    material.metalness = 0;
  }

  return material;
}

/**
 * Isolate runtime geometry without changing the source tree dimensions.
 * Coverage is corrected in texture mipmaps, never by shrinking leaf planes.
 */
export function prepareTreeGeometry(
  source: THREE.BufferGeometry,
  _lod: TreeLODLevel,
  _material?: THREE.Material,
) {
  return source.clone();
}

/**
 * Stateful distance selection.  Pass the tree's previously assigned LOD on
 * every update; the stable bands prevent a whole row oscillating at a boundary.
 */
export function chooseTreeLOD(
  distance: number,
  previousLOD?: TreeLODLevel,
  policy: TreeLODPolicy = DEFAULT_TREE_LOD_POLICY,
): TreeLODLevel {
  if (!Number.isFinite(distance) || distance < 0) return previousLOD ?? 3;

  if (previousLOD === undefined) {
    if (distance < policy.distances[0]) return 0;
    if (distance < policy.distances[1]) return 1;
    if (distance < policy.distances[2]) return 2;
    return 3;
  }

  let lod = previousLOD;
  while (lod < 3) {
    const boundary = lod as 0 | 1 | 2;
    if (distance <= policy.distances[boundary] + policy.hysteresis[boundary]) break;
    lod = (lod + 1) as TreeLODLevel;
  }
  while (lod > 0 && distance < policy.distances[lod - 1] - policy.hysteresis[lod - 1]) {
    lod = (lod - 1) as TreeLODLevel;
  }
  return lod;
}

/** Diagnostic helper: use crown diameter on screen to tune the final LOD2/3 boundary. */
export function projectedDiameterPixels(
  worldDiameter: number,
  distance: number,
  verticalFovDegrees: number,
  viewportHeightPixels: number,
) {
  if (worldDiameter <= 0 || distance <= 0 || viewportHeightPixels <= 0) return 0;
  const focalLengthPixels = viewportHeightPixels / (2 * Math.tan(THREE.MathUtils.degToRad(verticalFovDegrees) / 2));
  return worldDiameter * focalLengthPixels / distance;
}
