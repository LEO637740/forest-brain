import * as THREE from "three";
import type { GroundVisualSystem, RoadVisualAlignment, GroundHeightSampler } from "./groundVisuals";

/** Reusable bounded visual ground patch; sample defaults remain unchanged.
 * Metre-scale relief is geometry; grains/leaves are PBR. No surveyed heights
 * are implied and no business tree or road record is changed.
 */
export const SAMPLE_BOUNDS = { minX: -66, maxX: -10, minZ: -24, maxZ: 48 };
export type GroundBounds = typeof SAMPLE_BOUNDS;
const STEP = .25;
const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;

function hash(x: number, z: number) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const u = smooth(x - ix, 0, 1), v = smooth(z - iz, 0, 1);
  return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), u), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}
function inside(x: number, z: number, b: GroundBounds) {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

function sampledPath(points: THREE.Vector3[], width: number) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const sampled=curve.getSpacedPoints(Math.ceil(curve.getLength()*2));
  const segments=sampled.slice(0,-1).map((a,i)=>{
    const b=sampled[i+1],dx=b.x-a.x,dz=b.z-a.z;
    return {x:a.x,z:a.z,dx,dz,inverseLengthSq:1/(dx*dx+dz*dz),
      minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minZ:Math.min(a.z,b.z),maxZ:Math.max(a.z,b.z)};
  });
  const blocks=[];
  for(let start=0;start<segments.length;start+=16){
    const slice=segments.slice(start,start+16);
    blocks.push({start,end:Math.min(start+16,segments.length),
      minX:Math.min(...slice.map(s=>s.minX)),maxX:Math.max(...slice.map(s=>s.maxX)),
      minZ:Math.min(...slice.map(s=>s.minZ)),maxZ:Math.max(...slice.map(s=>s.maxZ))});
  }
  return { segments, blocks, width,
    minX:Math.min(...sampled.map(p=>p.x)),maxX:Math.max(...sampled.map(p=>p.x)),
    minZ:Math.min(...sampled.map(p=>p.z)),maxZ:Math.max(...sampled.map(p=>p.z)) };
}
function nearest(path: ReturnType<typeof sampledPath>, x: number, z: number) {
  // All road/ditch effects saturate within eight metres of the path bounds.
  // Do not walk every centreline for distant hill vertices.
  if(x<path.minX-8 || x>path.maxX+8 || z<path.minZ-8 || z>path.maxZ+8)
    return {distance:1000,along:0,half:path.width*.5};
  let distanceSq = Infinity, along = 0;
  for(const block of path.blocks){
    const bx=Math.max(block.minX-x,0,x-block.maxX),bz=Math.max(block.minZ-z,0,z-block.maxZ);
    if(bx*bx+bz*bz>=distanceSq)continue;
    for (let i = block.start; i < block.end; i++) {
    const s=path.segments[i];
    const bx=Math.max(s.minX-x,0,x-s.maxX),bz=Math.max(s.minZ-z,0,z-s.maxZ);
    if(bx*bx+bz*bz>=distanceSq)continue;
    const t = THREE.MathUtils.clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)*s.inverseLengthSq, 0, 1);
    const dx=x-s.x-t*s.dx,dz=z-s.z-t*s.dz,d=dx*dx+dz*dz;
    if (d < distanceSq) { distanceSq = d; along = (i+t)*.5; }
    }
  }
  return { distance:Math.sqrt(distanceSq), along, half: path.width * .5 };
}

/** Clip only the old visual ribbons inside the opt-in patch. Geometry and
 * records outside the patch remain unchanged, including old culvert mouths.
 */
function clipOldRibbons(group: THREE.Group, b: GroundBounds) {
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
    }
  });
  for (const material of materials) {
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      shader.vertexShader = "varying vec2 gsClip;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\ngsClip = (modelMatrix * vec4(transformed,1.0)).xz;");
      shader.fragmentShader = "varying vec2 gsClip;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>\nfloat gsClipEdge=min(min(gsClip.x-(${b.minX}.0),${b.maxX}.0-gsClip.x),min(gsClip.y-(${b.minZ}.0),${b.maxZ}.0-gsClip.y));
        if(gsClipEdge>7.0) discard;`);
      shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>",
        "diffuseColor.a *= 1.0-smoothstep(0.0,7.0,gsClipEdge);\n#include <opaque_fragment>");
    };
    material.transparent = true;
    // These terrain ribbons do not require separate back/front transparency
    // passes; retaining two passes would add four redundant draw calls.
    material.forceSinglePass = true;
    material.customProgramCacheKey = () => key + "-sample-cut";
    material.needsUpdate = true;
  }
}

function sampleMaterial(ground: GroundVisualSystem, soil: THREE.Texture[], matched = false, candidates: THREE.Texture[] = [], antiTile: boolean | "rotated" = false, diagnostic = "", optimize = false, coverMask?: THREE.DataTexture, bounds = SAMPLE_BOUNDS, wholeTerrain = false) {
  const texture = (name: string) => {
    const found = ground.textures.find(t => t.name === `VC-A_${name}`);
    if (!found) throw new Error(`Missing ground sample texture: ${name}`);
    return found;
  };
  const material = new THREE.MeshStandardMaterial({
    name: "GroundSample_ThreeMatchedPbrLayers",
    map: texture("forest_floor_Diffuse"), normalMap: texture("forest_floor_nor_gl"),
    roughnessMap: texture("forest_floor_Rough"), roughness: 1,
    normalScale: new THREE.Vector2(.6, .6), metalness: 0,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      gsBounds: { value: new THREE.Vector4(bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ) },
      gsCoverMask: { value: coverMask ?? null },
      gsMud: { value: soil[0] }, gsMudN: { value: soil[1] }, gsMudR: { value: soil[2] },
      gsRoad: { value: candidates[0] ?? texture("gravel_Diffuse") }, gsRoadN: { value: candidates[1] ?? texture("gravel_nor_gl") }, gsRoadR: { value: candidates[2] ?? texture("gravel_Rough") },
      gsLeafD: { value: candidates[3] ?? texture("forest_floor_Diffuse") },
      gsLeafN: { value: candidates[4] ?? texture("forest_floor_nor_gl") },
      gsLeafR: { value: candidates[5] ?? texture("forest_floor_Rough") },
    });
    shader.vertexShader = "attribute vec4 gsSurface; varying vec4 gsLayers; varying vec2 gsWorld;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\ngsLayers=gsSurface; gsWorld=position.xz;");
    if(matched) {
      shader.vertexShader="attribute float gsCover; varying float gsCoverWeight;\n"+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace("gsLayers=gsSurface;", "gsCoverWeight=gsCover; gsLayers=gsSurface;");
    }
    shader.fragmentShader = `
      ${matched ? 'varying float gsCoverWeight;' : ''}
      uniform sampler2D gsCoverMask;
      uniform vec4 gsBounds;
      varying vec4 gsLayers; varying vec2 gsWorld;
      uniform sampler2D gsMud, gsMudN, gsMudR, gsRoad, gsRoadN, gsRoadR;
      uniform sampler2D gsLeafD, gsLeafN, gsLeafR;
      float gsHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float gsNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(gsHash(i),gsHash(i+vec2(1,0)),f.x),mix(gsHash(i+vec2(0,1)),gsHash(i+vec2(1,1)),f.x),f.y);}
      // Identical UV transforms and weights across PBR channels. The rotated
      // trial transforms tangent-space normal XY back with the inverse rotation.
      vec4 gsRotSample(sampler2D tex,vec2 uv,vec2 id,bool normalChannel){
        float angle=gsHash(id+41.7)*6.2831853;
        float c=cos(angle),s=sin(angle);
        mat2 r=mat2(c,s,-s,c);
        vec2 offset=vec2(gsHash(id+9.2),gsHash(id+73.1))*23.0;
        vec4 value=textureGrad(tex,r*uv+offset,r*dFdx(uv),r*dFdy(uv));
        if(normalChannel){
          vec3 n=value.xyz*2.0-1.0;
          n.xy=transpose(r)*n.xy;
          value.xyz=n*.5+.5;
        }
        return value;
      }
      vec4 gsSample(sampler2D tex,vec2 uv,bool normalChannel){
        ${antiTile === "rotated" ? `
        // Equilateral triangular lattice; continuous barycentric weights.
        // Every channel shares the same per-vertex transform and weights.
        vec2 p=mat2(1.0,0.0,-.577350269,1.154700538)*(gsWorld*.85);
        vec2 cell=floor(p),f=fract(p),a=cell,b=cell+vec2(1,0),d=cell+vec2(0,1);
        vec3 w=vec3(1.0-f.x-f.y,f.x,f.y);
        if(f.x+f.y>1.0){a=cell+vec2(1);w=vec3(f.x+f.y-1.0,1.0-f.y,1.0-f.x);}
        w=w*w;w/=dot(w,vec3(1));
        return gsRotSample(tex,uv,a,normalChannel)*w.x
          +gsRotSample(tex,uv,b,normalChannel)*w.y
          +gsRotSample(tex,uv,d,normalChannel)*w.z;
        ` : `
        ${antiTile ? `
        // Continuous selector, not per-square ownership. Each boundary uses
        // the same offset from both sides. Two samples; no hard weight power.
        vec2 q=mat2(.8,-.6,.6,.8)*gsWorld;
        float selector=9.0*(.64*gsNoise(q*.31)+.36*gsNoise(q*.67+vec2(17.2,8.4)));
        float index=floor(selector), blend=fract(selector);
        vec2 oa=sin(vec2(3.0,7.0)*index+vec2(.2,1.3))*9.0;
        vec2 ob=sin(vec2(3.0,7.0)*(index+1.0)+vec2(.2,1.3))*9.0;
        vec2 dx=dFdx(uv),dy=dFdy(uv);
        return mix(textureGrad(tex,uv+oa,dx,dy),textureGrad(tex,uv+ob,dx,dy),smoothstep(.15,.85,blend));
        ` : `
        vec2 cell=floor(gsWorld*.32), f=fract(gsWorld*.32);
        vec2 c0=cell, c1=cell+vec2(1,0), c2=cell+vec2(0,1);
        vec3 w=vec3(1.0-f.x-f.y,f.x,f.y);
        if(f.x+f.y>1.0){c0=cell+vec2(1); w=vec3(f.x+f.y-1.0,1.0-f.y,1.0-f.x);}
        w=pow(w,vec3(${matched ? '5.0' : '2.0'})); w/=dot(w,vec3(1));
        vec2 o0=vec2(gsHash(c0),gsHash(c0+19.17))*7.0;
        vec2 o1=vec2(gsHash(c1),gsHash(c1+19.17))*7.0;
        vec2 o2=vec2(gsHash(c2),gsHash(c2+19.17))*7.0;
        // Explicit gradients exclude the discontinuous hash offset from mip
        // selection. All three PBR channels use the same barycentric weights.
        vec2 dx=dFdx(uv),dy=dFdy(uv);
        return textureGrad(tex,uv+o0,dx,dy)*w.x+textureGrad(tex,uv+o1,dx,dy)*w.y+textureGrad(tex,uv+o2,dx,dy)*w.z;
        `}
        `}
      }
      vec4 gsTex(sampler2D tex,vec2 uv){return gsSample(tex,uv,false);}
      vec3 gsNormal(sampler2D tex,vec2 uv){return gsSample(tex,uv,true).xyz*2.0-1.0;}
      ${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      vec2 gsLuv=gsWorld/${candidates.length ? '1.3' : '2.2'}, gsMuv=gsWorld/1.0, gsRuv=gsWorld/${candidates.length ? '2.0' : '2.5'};
      float gsBorder=min(min(gsWorld.x-gsBounds.x,gsBounds.z-gsWorld.x),min(gsWorld.y-gsBounds.y,gsBounds.w-gsWorld.y));
      float gsTrialMix=smoothstep(0.0,7.0,gsBorder);
      float gsEdge=(gsNoise(gsWorld*3.1)-.5)*.28;
      float gsGravel=smoothstep(.03,.94,gsLayers.y+gsEdge*gsLayers.y*(1.0-gsLayers.y)*4.0);
      float gsLitter=clamp(gsLayers.x+gsEdge*.55,0.0,1.0)*(1.0-gsGravel)${candidates.length ? '* .70' : ''};
      float gsSoil=1.0-gsGravel-gsLitter;
      vec3 gsWeights=vec3(gsLitter,gsSoil,gsGravel);
      vec3 gsLeaf=gsTex(gsLeafD,gsLuv).rgb;
      gsLeaf=mix(gsLeaf,vec3(dot(gsLeaf,vec3(.2126,.7152,.0722))),.38)*vec3(.83,.85,.72);
      vec3 gsColor=gsLeaf*gsLitter + gsTex(gsMud,gsMuv).rgb*vec3(.76,.83,.69)*gsSoil
        + gsTex(gsRoad,gsRuv).rgb*vec3(.83,.80,.72)*gsGravel;
      float gsWet=clamp(gsLayers.z,0.0,1.0);
      gsColor*=mix(1.0,.77,gsWet);
      gsColor*=mix(.93,1.04,${antiTile ? '.65*gsNoise(mat2(.8,-.6,.6,.8)*gsWorld*.031)+.35*gsNoise(gsWorld*.071+19.7)' : 'gsNoise(gsWorld*.34)'});
      gsColor*=1.0-gsLayers.w*.12;
      // A second physical scale remains readable on distant slopes after fine
      // soil texels have mipmapped away. The same world sampling spans both meshes.
      vec2 gsWarp=vec2(gsNoise(gsWorld*.019),gsNoise(gsWorld*.023+37.0))-.5;
      vec2 gsMacroUv=gsWorld/18.0+gsWarp*1.7;
      vec3 gsMacro=mix(texture2D(gsMud,gsMacroUv).rgb,
        texture2D(gsMud,mat2(.713,-.701,.701,.713)*gsMacroUv*.731+vec2(7.13,3.71)).rgb,
        smoothstep(.2,.8,gsNoise(gsWorld*.037+13.0)));
      gsColor*=mix(vec3(.78),vec3(1.22),clamp(gsMacro*1.7,0.0,1.0));
      ${candidates.length ? `
      // Remove legacy gravel darkening from the scanned compacted soil.
      // Preserve source detail, with a restrained dry mineral lift.
      vec3 dirtSample=gsTex(gsRoad,gsRuv).rgb;
      dirtSample=mix(dirtSample,vec3(dot(dirtSample,vec3(.2126,.7152,.0722))),.25);
      gsColor=mix(gsColor,dirtSample*1.6,gsGravel);
      ` : ''}
      ${matched ? `
      // Muted organic soil beneath actual tuft footprints, not a second
      // unrelated noise field. Preserve bare road and damp drain material.
      gsColor*=mix(vec3(1),vec3(.72,.79,.65),gsCoverWeight*(1.0-gsGravel));
      gsColor*=mix(vec3(1),vec3(.79,.75,.68),smoothstep(.18,.7,gsWet));
      gsColor*=mix(vec3(1),vec3(1.06,1.03,.98),gsGravel);
      ` : ''}
      // Match the existing terrain exactly at the sample perimeter; this is
      // a bounded experiment, not a rectangular second terrain laid on top.
      vec2 oldUv=gsWorld/2.35;
      float oldBlend=.5+.5*sin(gsWorld.x*.047+sin(gsWorld.y*.031)*2.1);
      vec3 oldFloor=mix(texture2D(map,oldUv).rgb,texture2D(map,mat2(.8192,-.5736,.5736,.8192)*oldUv*.713+vec2(.173,.619)).rgb,.34+.18*oldBlend);
      oldFloor=mix(oldFloor,texture2D(map,mat2(.4226,.9063,-.9063,.4226)*oldUv*.437+vec2(.731,.287)).rgb,.17);
      float oldWet=smoothstep(.28,.86,.5+.25*sin(gsWorld.x*.024-gsWorld.y*.019)+.25*sin((gsWorld.x+gsWorld.y)*.011));
      float oldTrace=smoothstep(.72,.98,.5+.5*sin(gsWorld.x*.071+sin(gsWorld.y*.018)*2.4));
      oldFloor*=mix(vec3(1.04,1.02,.94),vec3(.68,.76,.62),oldWet*.28);
      oldFloor*=mix(vec3(1),vec3(.86,.79,.66),oldTrace*.15);
      float oldP=.5+.24*sin(gsWorld.x*.037+sin(gsWorld.y*.041)*2.0)+.20*sin(gsWorld.y*.083+gsWorld.x*.019);
      vec3 oldTint=mix(vec3(.34,.48,.23),vec3(.72,.62,.44),smoothstep(.28,.72,oldP));
      float oldBroad=.5+.5*sin(gsWorld.x*.013+sin(gsWorld.y*.017)*1.6);
      oldTint=mix(oldTint,vec3(.32,.39,.24),smoothstep(.62,.9,oldBroad)*.26);
      vec3 oldColor=mix(oldFloor,vec3(dot(oldFloor,vec3(.2126,.7152,.0722))),.36)*oldTint*1.65;
      oldColor*=mix(vec3(1),vec3(1.13,.94,.72),smoothstep(.44,.79,oldP)*(.45+.55*smoothstep(.25,.75,sin(gsWorld.x*.018-gsWorld.y*.027)*.5+.5))*.46);
      oldColor*=1.0-smoothstep(.66,.93,oldWet)*smoothstep(.2,.85,sin((gsWorld.x+gsWorld.y)*.032)*.5+.5)*.18;
      oldColor*=vec3(${ground.terrainMaterial.color.r},${ground.terrainMaterial.color.g},${ground.terrainMaterial.color.b});
      diffuseColor.rgb*=mix(oldColor,gsColor,gsTrialMix);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      float gsR=dot(gsWeights,vec3(gsTex(gsLeafR,gsLuv).g,gsTex(gsMudR,gsMuv).g,gsTex(gsRoadR,gsRuv).g));
      float roughnessFactor=mix(clamp(gsR,.73,.98),${matched ? '.69' : '.48'},gsWet);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
      vec3 mapN=normalize(gsNormal(gsLeafN,gsLuv)*gsLitter
        +gsNormal(gsMudN,gsMuv)*gsSoil
        +gsNormal(gsRoadN,gsRuv)*gsGravel);
      mapN.xy*=normalScale*mix(1.0,.7,gsWet);
      ${matched ? 'mapN.xy*=mix(1.0,.32,gsGravel)*mix(1.0,.55,gsWet);' : ''}
      normal=normalize(tbn*mapN);
    `);
    if(diagnostic === "normal") shader.fragmentShader=shader.fragmentShader.replace(
      "float roughnessFactor=mix", "diffuseColor.rgb=vec3(.45);\nfloat roughnessFactor=mix");
    if(diagnostic === "no-normal") shader.fragmentShader=shader.fragmentShader.replace(
      "normal=normalize(tbn*mapN);", "// Diagnostic: retain geometric normal only.");
    const output = diagnostic === "albedo" ? "diffuseColor.rgb" : diagnostic === "masks"
      ? "vec3(gsLayers.x,gsLayers.y,gsLayers.z)" : diagnostic === "soil" ? "gsTex(gsMud,gsMuv).rgb"
      : diagnostic === "soil-direct" ? "texture2D(gsMud,gsMuv).rgb"
      : diagnostic === "cover" ? (matched ? "vec3(gsCoverWeight)" : "vec3(0.0)")
      : diagnostic === "selector" ? "vec3(gsNoise(mat2(.8,-.6,.6,.8)*gsWorld*.31))" : "";
    if(output) shader.fragmentShader=shader.fragmentShader.replace("#include <opaque_fragment>",
      `outgoingLight=${output};\n#include <opaque_fragment>`);
    if(optimize && antiTile === "rotated") {
      // Cache transforms once per fragment rather than rebuilding them for
      // every PBR channel. Keep weights, UV scale and source textures identical.
      shader.fragmentShader=shader.fragmentShader.replace("vec4 gsRotSample", `
        mat2 gsRA,gsRB,gsRC;
        vec2 gsOA,gsOB,gsOC;
        vec3 gsW;
        void gsTransform(vec2 id,out mat2 r,out vec2 offset){
          float angle=gsHash(id+41.7)*6.2831853;
          float c=cos(angle),s=sin(angle);
          r=mat2(c,s,-s,c);
          offset=vec2(gsHash(id+9.2),gsHash(id+73.1))*23.0;
        }
        void gsInit(){
          vec2 p=mat2(1.0,0.0,-.577350269,1.154700538)*(gsWorld*.85);
          vec2 cell=floor(p),f=fract(p),a=cell,b=cell+vec2(1,0),d=cell+vec2(0,1);
          gsW=vec3(1.0-f.x-f.y,f.x,f.y);
          if(f.x+f.y>1.0){a=cell+vec2(1);gsW=vec3(f.x+f.y-1.0,1.0-f.y,1.0-f.x);}
          gsW=gsW*gsW;gsW/=dot(gsW,vec3(1));
          gsTransform(a,gsRA,gsOA);gsTransform(b,gsRB,gsOB);gsTransform(d,gsRC,gsOC);
        }
        vec4 gsCached(sampler2D tex,vec2 uv,mat2 r,vec2 offset,bool normalChannel){
          vec4 value=textureGrad(tex,r*uv+offset,r*dFdx(uv),r*dFdy(uv));
          if(normalChannel){vec3 n=value.xyz*2.0-1.0;n.xy=transpose(r)*n.xy;value.xyz=n*.5+.5;}
          return value;
        }
        vec4 gsRotSample`);
      const begin=shader.fragmentShader.indexOf("// Equilateral triangular lattice");
      const end=shader.fragmentShader.indexOf("\n      }",begin);
      shader.fragmentShader=shader.fragmentShader.slice(0,begin)+`
        return gsCached(tex,uv,gsRA,gsOA,normalChannel)*gsW.x
          +gsCached(tex,uv,gsRB,gsOB,normalChannel)*gsW.y
          +gsCached(tex,uv,gsRC,gsOC,normalChannel)*gsW.z;
        `+shader.fragmentShader.slice(end);
      shader.fragmentShader=shader.fragmentShader.replace("vec2 gsLuv=", "gsInit();\nvec2 gsLuv=");
      shader.fragmentShader=shader.fragmentShader.replace("vec3 gsLeaf=", "vec3 gsRoadColor=gsTex(gsRoad,gsRuv).rgb;\nvec3 gsLeaf=")
        .replace("+ gsTex(gsRoad,gsRuv).rgb*", "+ gsRoadColor*")
        .replace("vec3 dirtSample=gsTex(gsRoad,gsRuv).rgb;", "vec3 dirtSample=gsRoadColor;");
      // The old terrain contributes only in the seven-metre perimeter blend.
      // Gradients must be evaluated before the non-uniform branch.
      shader.fragmentShader=shader.fragmentShader.replace("vec2 oldUv=gsWorld/2.35;", `
        vec2 oldUv=gsWorld/2.35,oldDx=dFdx(oldUv),oldDy=dFdy(oldUv);
        if(gsTrialMix<1.0){`)
        .replace("texture2D(map,oldUv)","textureGrad(map,oldUv,oldDx,oldDy)")
        .replace("texture2D(map,mat2(.8192,-.5736,.5736,.8192)*oldUv*.713+vec2(.173,.619))","textureGrad(map,mat2(.8192,-.5736,.5736,.8192)*oldUv*.713+vec2(.173,.619),mat2(.8192,-.5736,.5736,.8192)*oldDx*.713,mat2(.8192,-.5736,.5736,.8192)*oldDy*.713)")
        .replace("texture2D(map,mat2(.4226,.9063,-.9063,.4226)*oldUv*.437+vec2(.731,.287))","textureGrad(map,mat2(.4226,.9063,-.9063,.4226)*oldUv*.437+vec2(.731,.287),mat2(.4226,.9063,-.9063,.4226)*oldDx*.437,mat2(.4226,.9063,-.9063,.4226)*oldDy*.437)")
        .replace("diffuseColor.rgb*=mix(oldColor,gsColor,gsTrialMix);", "diffuseColor.rgb*=mix(oldColor,gsColor,gsTrialMix);\n}else{diffuseColor.rgb*=gsColor;}");
    }
    if(coverMask) {
      // Independent world-space mask, no terrain-triangle interpolation.
      if(matched) shader.fragmentShader=shader.fragmentShader
        .replace("varying float gsCoverWeight;", "")
        .replace("vec2 gsLuv=", "vec2 gsCoverUv=(gsWorld-gsBounds.xy)/(gsBounds.zw-gsBounds.xy); float gsCoverInside=smoothstep(0.0,.012,min(min(gsCoverUv.x,gsCoverUv.y),min(1.0-gsCoverUv.x,1.0-gsCoverUv.y))); float gsCoverWeight=texture2D(gsCoverMask,gsCoverUv).r*gsCoverInside;\nvec2 gsLuv=");
      shader.fragmentShader=shader.fragmentShader.replace(
        "float gsTrialMix=smoothstep(0.0,7.0,gsBorder);",
        "float gsTrialMix=smoothstep(0.0,10.0,gsBorder);"
      ).replace("// Match the existing terrain exactly", `
        // Broad variation follows existing litter and moisture, not new tiles.
        float gsOrganic=smoothstep(.16,.65,gsLitter)*(1.0-gsGravel);
        gsColor*=mix(vec3(1.04,1.01,.96),vec3(.83,.86,.79),gsOrganic*.65);
        gsColor*=mix(vec3(1),vec3(.87,.90,.85),gsWet*(1.0-gsGravel));
        // Match the existing terrain exactly`);
    }
  };
  const compileGround=material.onBeforeCompile;
  if(wholeTerrain) material.onBeforeCompile=(shader,renderer)=>{
    compileGround.call(material,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace(
      /float gsTrialMix=smoothstep\(0\.0,(?:7|10)\.0,gsBorder\);/,
      "float gsTrialMix=1.0;");
  };
  if(diagnostic) material.fog=false;
  if(["albedo","masks","soil","soil-direct","cover","selector"].includes(diagnostic)) material.toneMapped=false;
  material.customProgramCacheKey = () => "ground-sample-matched-pbr-v1" + (matched ? "-surface-trial" : "") + (candidates.length ? "-scans" : "") + (antiTile === "rotated" ? "-rotated-v1" : antiTile ? "-continuous" : "") + diagnostic + (optimize ? "-cached" : "") + (coverMask ? "-finish" : "") + (wholeTerrain ? "-whole-terrain" : "");
  return material;
}

export function installGroundSample(options: {
  terrain: THREE.Mesh<THREE.BufferGeometry>;
  ground: GroundVisualSystem;
  roads: RoadVisualAlignment[];
  heightAt: GroundHeightSampler;
  trees: readonly { x: number; z: number }[];
  manager: THREE.LoadingManager;
  clay?: boolean;
  surfaceTrial?: boolean;
  materialTrial?: boolean;
  antiTile?: boolean | "rotated";
  diagnostic?: string;
  optimize?: boolean;
  finish?: boolean;
  bounds?: GroundBounds;
  step?: number;
  ditches?: { points: number[][]; width: number }[];
  wholeTerrain?: boolean;
}) {
  const { terrain, ground, heightAt } = options;
  const b = options.bounds ?? SAMPLE_BOUNDS;
  const step = options.step ?? STEP;
  const maskWidth=Math.ceil((b.maxX-b.minX)*10),maskHeight=Math.ceil((b.maxZ-b.minZ)*10);
  const coverMask=options.finish ? new THREE.DataTexture(new Uint8Array(maskWidth*maskHeight),maskWidth,maskHeight,THREE.RedFormat) : undefined;
  if(coverMask){
    coverMask.minFilter=THREE.LinearMipmapLinearFilter;coverMask.magFilter=THREE.LinearFilter;
    coverMask.generateMipmaps=true;coverMask.needsUpdate=true;
  }
  const paths = options.roads.map(road => sampledPath(road.points.map(p =>
    p instanceof THREE.Vector2 ? new THREE.Vector3(p.x, 0, p.y) : new THREE.Vector3(p[0], 0, p[1])), road.width));
  const ditches=(options.ditches ?? [{points:[[-65,-74],[-51,-34],[-45,8],[-39,61]],width:1}])
    .map(d=>sampledPath(d.points.map(p=>new THREE.Vector3(p[0],0,p[1])),d.width));
  const trees = options.trees.filter(t => options.wholeTerrain || (t.x > b.minX-10 && t.x < b.maxX+10 && t.z > b.minZ-10 && t.z < b.maxZ+10));
  // All root/canopy masks saturate by eight metres. A small spatial index
  // avoids scanning hundreds of tree roots for every terrain vertex.
  const treeCells=new Map<number,typeof trees>();
  for(const tree of trees){
    const key=(Math.floor(tree.x/8)+64)*128+Math.floor(tree.z/8)+64;
    const bucket=treeCells.get(key) ?? [];
    bucket.push(tree);treeCells.set(key,bucket);
  }
  const rootDistanceAt=(x:number,z:number)=>{
    const cx=Math.floor(x/8),cz=Math.floor(z/8);
    let nearestSq=64;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      for(const tree of treeCells.get((cx+dx+64)*128+cz+dz+64) ?? []){
        nearestSq=Math.min(nearestSq,(x-tree.x)**2+(z-tree.z)**2);
      }
    }
    return Math.sqrt(nearestSq);
  };

  const field = (x: number, z: number) => {
    const edge = options.wholeTerrain ? 1 : smooth(Math.min(x-b.minX,b.maxX-x,z-b.minZ,b.maxZ-z),0,5);
    const roadSamples = paths.map(path => nearest(path, x, z));
    const road = roadSamples.reduce((a,c) => a.distance-a.half < c.distance-c.half ? a : c);
    const roadEdge = road.distance - road.half;
    const grain = noise(x*1.3,z*1.3), patches = noise(x*.19+13,z*.19-9);
    const roadMask = 1-smooth(roadEdge+(grain-.5)*.24,-.18,1.3);
    const core = 1-smooth(roadEdge,-.3,.4);
    const shoulder = (1-smooth(roadEdge,.1,2.5))*(1-core);
    const rut = Math.exp(-(((road.distance-road.half*.53)/.22)**2))*(1-smooth(roadEdge,-.3,.15));
    const rootDistance = rootDistanceAt(x,z);
    const protectRoot = smooth(rootDistance,.55,1.7);
    const canopy = 1-smooth(rootDistance,2,8);
    const dn = ditches.map(d=>nearest(d,x,z)).reduce((a,c)=>a.distance<c.distance?a:c);
    const drainWidth = (dn.half*1.32) + noise(dn.along*.24,7)*.32;
    const drainDistance = dn.distance + (noise(x*.9,z*.9)-.5)*.13;
    const drainProfile = (1-smooth(drainDistance,.14,drainWidth+1.05))**1.65;
    const drainVisible = smooth(roadEdge,.5,2.0);
    const drain = drainProfile * drainVisible;
    const micro = (noise(x*.74,z*.74)-.5)*.19 + (noise(x*1.8,z*1.8)-.5)*.045;
    const meso = (noise(x*.24,z*.24)-.5)*.37 + (noise(x*.11+17,z*.11)-.5)*.19;
    const crown = .085 * (1-Math.min(1,(road.distance/road.half)**2));
    let offset = (micro+meso)*(1-core*(options.surfaceTrial ? .985 : .94));
    offset += core*(.055+crown) - rut*.038*(.6+noise(road.along*.52,2)*.4);
    offset += shoulder*.08*(.4+patches);
    offset -= drain*(.28+noise(dn.along*.31,9)*.12);
    // Only the perimeter uses the old ditch cut; the interior replaces it.
    const originalY = heightAt(x,z)-(edge<1 ? ground.carveDepthAt(x,z) : 0);
    const height = lerp(originalY,heightAt(x,z)+offset*protectRoot,edge);
    const wet = Math.min(.9,drain*.8+(1-core)*smooth(.57,.84,patches)*.25+rut*.2);
    const woodland=smooth(Math.max(Math.abs(x)-120,-z-65),0,90);
    const litter = THREE.MathUtils.clamp(.08+canopy*.7+woodland*(.16+noise(x*.045,z*.045)*.35)+(patches-.5)*.28-drain*.4-shoulder*.25,.02,.85);
    return { height, litter, roadMask, wet, contact: (1-smooth(rootDistance,.28,1.25)) };
  };

  const cols = Math.round((b.maxX-b.minX)/step), rows = Math.round((b.maxZ-b.minZ)/step);
  const geometry = new THREE.PlaneGeometry(b.maxX-b.minX,b.maxZ-b.minZ,cols,rows);
  geometry.rotateX(-Math.PI/2);
  geometry.translate((b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2);
  const pos = geometry.attributes.position, uv = geometry.attributes.uv;
  const layers: number[] = [];
  for (let i=0;i<pos.count;i++) {
    const x=pos.getX(i), z=pos.getZ(i), f=field(x,z);
    const flat=["albedo","normal","masks","full-flat","soil","soil-direct","cover","selector"].includes(options.diagnostic ?? "");
    let height=f.height;
    if(options.wholeTerrain){
      // The fine patch meets a 1m outer grid. Match the intervening edge
      // vertices to its linear edge exactly, not another displaced sample.
      if(x===b.minX || x===b.maxX)height=lerp(field(x,Math.floor(z)).height,field(x,Math.ceil(z)).height,z-Math.floor(z));
      else if(z===b.minZ || z===b.maxZ)height=lerp(field(Math.floor(x),z).height,field(Math.ceil(x),z).height,x-Math.floor(x));
    }
    pos.setY(i,flat ? 0 : options.diagnostic === "base" ? heightAt(x,z) : height);
    uv.setXY(i,x/2.2,z/2.2);
    layers.push(f.litter,f.roadMask,f.wet,f.contact);
  }
  geometry.setAttribute("gsSurface",new THREE.Float32BufferAttribute(layers,4));
  if(options.surfaceTrial) geometry.setAttribute("gsCover",new THREE.Float32BufferAttribute(new Float32Array(pos.count),1));
  geometry.computeVertexNormals();
  const loader = new THREE.TextureLoader(options.manager);
  const sampleTextures = options.clay ? [] : ["Diffuse","nor_gl","Rough"].map(channel => {
    const t=loader.load(`/assets/environment/ground-sample/grass_path_${channel}.jpg`);
    t.colorSpace=channel==="Diffuse" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.anisotropy=8;
    return t;
  });
  const candidateTextures = options.materialTrial && !options.clay
    ? ["dirt","leaves_forest_ground"].flatMap(asset=>["Diffuse","nor_gl","Rough"].map(channel=>{
      const t=loader.load(`/assets/environment/material-candidates/${asset}_${channel}.jpg`);
      t.colorSpace=channel==="Diffuse" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
    })) : [];
  const material = options.clay || options.diagnostic === "clay" || options.diagnostic === "base"
    ? new THREE.MeshStandardMaterial({color:"#adaba3",roughness:.88,name:"GroundSample_ClayGeometryOnly"})
    : sampleMaterial(ground,sampleTextures,options.surfaceTrial,candidateTextures,options.antiTile,options.diagnostic,options.optimize,coverMask,b,options.wholeTerrain);
  const mesh = new THREE.Mesh(geometry,material);
  mesh.name = "GroundSample_LocalContinuousSurface";
  mesh.receiveShadow = !options.diagnostic;
  // Receive the existing tree shadows. Sub-metre self-shadowing at the
  // overview's 4096 map texel scale creates grid acne, so relief is lit by
  // geometric normals rather than adding this patch to that shadow map.
  mesh.castShadow = false;

  // Replace faces rather than placing another opaque surface above the old
  // floor. Integer patch boundaries align with the old 1 m grid exactly.
  const oldPos = terrain.geometry.attributes.position;
  const oldIndex = terrain.geometry.index!;
  const indices: number[] = [];
  for (let i=0;i<oldIndex.count;i+=3) {
    const a=oldIndex.getX(i),c=oldIndex.getX(i+1),d=oldIndex.getX(i+2);
    const x=(oldPos.getX(a)+oldPos.getX(c)+oldPos.getX(d))/3;
    const z=(oldPos.getZ(a)+oldPos.getZ(c)+oldPos.getZ(d))/3;
    if (!inside(x,z,b)) indices.push(a,c,d);
  }
  terrain.geometry.setIndex(indices);
  if(options.wholeTerrain){
    // Reuse the existing outer mesh and the exact same PBR inputs; no new
    // map extent, dense far-field grid, duplicate texture set or extra grass.
    const outerLayers=new Float32Array(oldPos.count*4);
    for(let i=0;i<oldPos.count;i++){
      const x=oldPos.getX(i),z=oldPos.getZ(i);
      if(x>b.minX && x<b.maxX && z>b.minZ && z<b.maxZ)continue;
      const f=field(x,z);
      oldPos.setY(i,f.height);
      outerLayers.set([f.litter,f.roadMask,f.wet,f.contact],i*4);
    }
    terrain.geometry.setAttribute("gsSurface",new THREE.BufferAttribute(outerLayers,4));
    terrain.geometry.setAttribute("gsCover",new THREE.BufferAttribute(new Float32Array(oldPos.count),1));
    oldPos.needsUpdate=true;
    terrain.geometry.computeVertexNormals();
    terrain.geometry.computeBoundingSphere();
    terrain.material=material;
    // The surface now contains these roads/drains. Keep actual culvert mouths.
    ground.group.traverse(object=>{
      if(object instanceof THREE.Mesh && !object.name.startsWith("VC-A_Culvert_Mouth"))object.visible=false;
    });
  }else clipOldRibbons(ground.group,b);
  return { mesh, bounds: b, step, triangles: geometry.index!.count/3, field, coverMask,
    dispose: () => { geometry.dispose(); material.dispose(); coverMask?.dispose(); [...sampleTextures,...candidateTextures].forEach(t=>t.dispose()); } };
}
