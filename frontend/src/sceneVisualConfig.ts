import * as THREE from "three";

// Phase A only: shared runtime materials. Frozen GLBs and business records are untouched.
export function prepareTreeMaterial(source: THREE.Material) {
  const material = source.clone();
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;
  if (/leaf|foliage/i.test(material.name)) {
    material.color.set("#698949");
    material.roughness = 0.86;
    material.metalness = 0;
    material.emissive.set("#25391b");
    material.emissiveIntensity = 0.12;
    if (material.map && /cluster/i.test(material.name)) {
      // Atlas RGB already contains baked colour/shading; multiplying by a second
      // green albedo made LOD3 much darker than the untextured LOD0–2 leaves.
      // Normalize only the runtime copy, preserving UVs and the alpha silhouette.
      const canvas = document.createElement("canvas");
      const originalImage = material.map.image as HTMLImageElement;
      canvas.width = originalImage.width;
      canvas.height = originalImage.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(originalImage, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let total = 0, weight = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = pixels.data[i + 3] / 255;
        total += (pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722) * alpha;
        weight += alpha;
      }
      const mean = total / Math.max(1, weight);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722;
        const value = THREE.MathUtils.clamp(240 + (luminance - mean) * .22, 206, 255);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      ctx.putImageData(pixels, 0, 0);
      const texture = material.map.clone();
      texture.source = new THREE.TextureSource(canvas);
      texture.needsUpdate = true;
      material.map = texture;
      material.color.multiplyScalar(1.14);
      material.transparent = false;
      material.depthWrite = true;
      // Low mip alpha must survive at L1 distances; .38 eroded entire distant crowns.
      material.alphaTest = .08;
      material.alphaToCoverage = true;
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
          // Preserve mip coverage at homepage range without thickening close leaf cards.
          float coverageThreshold = mix(.38,.08,smoothstep(80.0,145.0,length(vViewPosition)));
          diffuseColor.a = smoothstep(coverageThreshold,coverageThreshold+max(fwidth(diffuseColor.a),.001),diffuseColor.a);
          if(diffuseColor.a == 0.0) discard;
        `);
      };
      material.customProgramCacheKey = () => "phase-a-leaf-coverage-v1";
    }
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
  } else if (/body|bark|trunk/i.test(material.name)) {
    material.color.set("#d3c6af");
    material.roughness = .9;
    material.metalness = 0;
  }
  return material;
}

export function createGroundMaterials(manager: THREE.LoadingManager) {
  const loader = new THREE.TextureLoader(manager);
  const textures: THREE.Texture[] = [];
  const load = (asset: string, channel: string) => {
    const texture = loader.load(`/assets/environment/phase-a/${asset}_${channel}.jpg`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.colorSpace = channel === "Diffuse" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    textures.push(texture);
    return texture;
  };
  const soil = new THREE.MeshStandardMaterial({
    map: load("forest_floor", "Diffuse"), normalMap: load("forest_floor", "nor_gl"),
    roughnessMap: load("forest_floor", "Rough"), normalScale: new THREE.Vector2(.48, .48),
    roughness: .88, color: "#aeb39b", vertexColors: true,
  });
  // Blend measured-scale soil into the existing terrain only in the production core.
  soil.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 phasePosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nphasePosition = position;");
    shader.fragmentShader = "varying vec3 phasePosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec4 texel = mix(texture2D(map, vMapUv), texture2D(map, mat2(.8,-.6,.6,.8)*vMapUv*.79+vec2(.31,.67)), .38);
        float core = (1.0-smoothstep(112.0,145.0,abs(phasePosition.x))) * (1.0-smoothstep(68.0,92.0,abs(phasePosition.z)));
        float macro = sin(phasePosition.x*.083+sin(phasePosition.z*.12)*2.0)*sin(phasePosition.z*.071+cos(phasePosition.x*.09));
        float moss = smoothstep(-.2,.65,macro);
        vec3 moistSoil = texel.rgb * mix(vec3(.57,.59,.45),vec3(.32,.46,.23),moss);
        float fine = sin(phasePosition.x*1.7+phasePosition.z*.91)*sin(phasePosition.z*1.13);
        diffuseColor.rgb = mix(diffuseColor.rgb, moistSoil * (.9+.07*fine), core);
      #endif
    `);
  };
  soil.customProgramCacheKey = () => "phase-a-soil-v1";
  const road = new THREE.MeshStandardMaterial({
    map: load("brown_mud", "Diffuse"), normalMap: load("brown_mud", "nor_gl"),
    roughnessMap: load("brown_mud", "Rough"), normalScale: new THREE.Vector2(.36,.36),
    color: "#ffffff", roughness: .91, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  road.color.setRGB(1.65,1.52,1.28);
  const configureRibbon = (material: THREE.MeshStandardMaterial, drain: boolean) => {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = "attribute vec2 ribbon; varying vec2 vRibbon;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRibbon = ribbon;");
      shader.fragmentShader = "varying vec2 vRibbon;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #ifdef USE_MAP
          vec4 groundTexel = mix(texture2D(map,vMapUv),texture2D(map,mat2(.8,-.6,.6,.8)*vMapUv*.83+vec2(.2,.4)),.40);
          diffuseColor *= groundTexel;
        #endif
      `);
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float edge = abs(vRibbon.x*2.0-1.0);
        float breakup = .10*sin(vRibbon.y*1.9) + .06*sin(vRibbon.y*5.3+vRibbon.x*7.0);
        diffuseColor.a *= 1.0-smoothstep(.62+breakup,1.0,edge);
        float tracks = exp(-pow((abs(vRibbon.x-.5)-.24)/.068,2.0));
        diffuseColor.rgb *= ${drain ? "mix(.72,1.15,edge)" : "1.0-tracks*.16"};
      `);
    };
    material.customProgramCacheKey = () => `phase-a-ribbon-${drain}`;
  };
  configureRibbon(road, false);
  const edge = road.clone();
  edge.color.set("#c5bea5"); edge.opacity = .7;
  configureRibbon(edge, false);
  const drain = road.clone();
  drain.color.setRGB(1.05,.96,.77); drain.roughness = .65; drain.opacity = .62;
  configureRibbon(drain, true);
  return {soil, road, edge, drain, textures};
}
