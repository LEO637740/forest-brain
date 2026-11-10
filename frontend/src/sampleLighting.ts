import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { Sky } from "three/addons/objects/Sky.js";

/** Lighting-only experiment. Geometry, materials and camera are untouched.
 * The sky-only CC0 panorama contains no foreign terrain/buildings. Its warm
 * colour is restrained in memory; the downloaded source stays unmodified.
 */
export function addSampleLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  homepage = false,
  naturalMorning = false,
) {
  let disposed=false;
  let hdr: THREE.DataTexture | undefined;
  let environment: THREE.WebGLRenderTarget | undefined;
  renderer.toneMappingExposure=1;
  scene.background=new THREE.Color("#c4d3d5");
  scene.fog=new THREE.Fog("#c4d3d5",210,540);
  const fill=new THREE.HemisphereLight("#e0eafa","#716854",.42);
  const sun=new THREE.DirectionalLight("#fff5e6",2.5);
  sun.target.position.set(homepage ? 0 : -38,0,homepage ? -2 : 6);
  // Rear-side morning sun casts canopy shadows toward the visible road edge,
  // instead of putting nearly all shade behind the trees in this fixed view.
  sun.position.copy(sun.target.position).add(new THREE.Vector3(85,70,-55));
  sun.castShadow=true;
  sun.shadow.mapSize.set(4096,4096);
  Object.assign(sun.shadow.camera,{left:-66,right:66,top:52,bottom:-52,near:1,far:270});
  if(homepage) Object.assign(sun.shadow.camera,{left:-130,right:130,top:100,bottom:-100,near:1,far:450});
  sun.shadow.bias=-.00006;
  sun.shadow.normalBias=.024;
  sun.shadow.intensity=1;
  scene.add(fill,sun,sun.target);
  document.documentElement.dataset.lightingSample="loading";
  if(homepage) {
    // The sample HDR has a 4.75-degree sun, too low for this operational view.
    // Use one shared sun vector for the analytical sky, IBL and cast shadows.
    // No HDR disk with a second, contradictory shadow direction.
    const direction=new THREE.Vector3(85,70,-55).normalize();
    fill.intensity=.65;
    sun.position.copy(sun.target.position).addScaledVector(direction,180);
    const sky=new Sky();
    sky.scale.setScalar(600);
    const u=sky.material.uniforms;
    u.turbidity.value=naturalMorning ? 2.6 : 6;
    u.rayleigh.value=naturalMorning ? 2.3 : 1.3;
    u.mieCoefficient.value=naturalMorning ? .0045 : .006;
    u.mieDirectionalG.value=naturalMorning ? .73 : .8;
    u.sunPosition.value.copy(direction);
    if(naturalMorning) {
      // Higher frequency gives several cloud banks in the narrow homepage sky
      // band, rather than one huge flat-looking cloud. Shared with PMREM.
      u.cloudScale.value=.0014;
      u.cloudCoverage.value=.50;
      u.cloudDensity.value=.65;
      u.cloudElevation.value=.32;
    }
    // Normalize analytical sky radiance to the existing material/light scale.
    sky.material.fragmentShader=sky.material.fragmentShader.replace(
      "gl_FragColor = vec4( texColor, 1.0 );","gl_FragColor = vec4( texColor * 0.12, 1.0 );");
    sky.material.needsUpdate=true;
    // Direct sunlight belongs to the shadow-casting light, not unshadowed IBL.
    u.showSunDisc.value=0;
    const lightingScene=new THREE.Scene();
    lightingScene.add(sky);
    const pmrem=new THREE.PMREMGenerator(renderer);
    environment=pmrem.fromScene(lightingScene,.08,.1,1000);
    pmrem.dispose();
    u.showSunDisc.value=1;
    if(naturalMorning) {
      // The fixed operational camera looks slightly below the mathematical
      // horizon. Art-direct only the visible sky downward; PMREM above was
      // generated from the unshifted physical sky and shared sun direction.
      sky.material.uniforms.visualHorizonOffset={value:.32};
      sky.material.fragmentShader=sky.material.fragmentShader
        .replace(
          "varying vec3 vWorldPosition;",
          "varying vec3 vWorldPosition;\nuniform float visualHorizonOffset;",
        )
        .replace(
          "vec3 direction = normalize( vWorldPosition - cameraPosition );",
          "vec3 direction = normalize( vWorldPosition - cameraPosition );\ndirection = normalize( direction + vec3( 0.0, visualHorizonOffset, 0.0 ) );",
        );
      // Three Sky's built-in clouds stay static; no new per-frame render pass.
      sky.material.needsUpdate=true;
    }
    scene.environment=environment.texture;
    scene.environmentIntensity=naturalMorning ? .58 : .65;
    scene.add(sky);
    if(naturalMorning) {
      renderer.toneMappingExposure=1.03;
      scene.fog=new THREE.Fog("#b8cfda",220,560);
      fill.color.set("#dbeafb");
      fill.groundColor.set("#776f5e");
      fill.intensity=.58;
      sun.color.set("#fff7e9");
      sun.intensity=2.3;
    }
    document.documentElement.dataset.homeLighting=JSON.stringify({
      source:naturalMorning ? "analytical-sky-static-clouds" : "analytical-sky",
      sunElevationDegrees:Math.asin(direction.y)*180/Math.PI,
      shadowMap:4096,shadowBounds:[260,200],
    });
    document.documentElement.dataset.lightingSample="ready";
    renderer.shadowMap.needsUpdate=true;
    return {ready:Promise.resolve(),dispose:()=>{
      disposed=true;scene.environment=null;environment?.dispose();
      scene.remove(sky,fill,sun,sun.target);
      sky.geometry.dispose();sky.material.dispose();sun.shadow.map?.dispose();
      delete document.documentElement.dataset.lightingSample;
      delete document.documentElement.dataset.homeLighting;
    }};
  }
  const ready=new HDRLoader().setDataType(THREE.FloatType)
    .loadAsync("/assets/environment/lighting-sample/kloppenheim_06_puresky_1k.hdr")
    .then(texture=>{
      if(disposed){texture.dispose();return;}
      hdr=texture;
      const pixels=texture.image.data as Float32Array;
      // Reduce sunset chroma, and cap the solar hotspot so the shadow-casting
      // directional light supplies direct sun instead of double-lighting it.
      for(let i=0;i<pixels.length;i+=4){
        const l=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
        for(let c=0;c<3;c++) pixels[i+c]=Math.min(6,THREE.MathUtils.lerp(pixels[i+c],l,.48));
      }
      texture.mapping=THREE.EquirectangularReflectionMapping;
      texture.needsUpdate=true;
      const pmrem=new THREE.PMREMGenerator(renderer);
      environment=pmrem.fromEquirectangular(texture);
      pmrem.dispose();
      scene.environment=environment.texture;
      scene.environmentIntensity=.32;
      scene.background=texture;
      scene.backgroundIntensity=.8;
      scene.backgroundBlurriness=.08;
      if(!homepage) scene.backgroundRotation.y=scene.environmentRotation.y=.85;
      renderer.shadowMap.needsUpdate=true;
      document.documentElement.dataset.lightingSample="ready";
    }).catch(error=>{
      if(!disposed){document.documentElement.dataset.lightingSample="failed";console.error("Sample HDR lighting failed",error);}
    });
  return {ready,dispose:()=>{
    disposed=true;
    scene.environment=null;
    scene.background=null;
    hdr?.dispose();environment?.dispose();sun.shadow.map?.dispose();
    delete document.documentElement.dataset.lightingSample;
    delete document.documentElement.dataset.homeLighting;
  }};
}
