import * as THREE from "three";

/** Shared physical light rig for the homepage and the four-LOD review. */
export function addMorningLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, comparison = false) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  scene.background = new THREE.Color("#c4d3d5");
  if (!comparison) scene.fog = new THREE.Fog("#c4d3d5", 210, 540);
  scene.add(new THREE.HemisphereLight("#dce8f0", "#65604c", 1.65));
  const sun = new THREE.DirectionalLight("#fff1d7", 2.75);
  sun.position.set(-110, 64, 58);
  sun.castShadow = true;
  sun.shadow.mapSize.set(comparison ? 2048 : 4096, comparison ? 2048 : 4096);
  Object.assign(sun.shadow.camera, comparison
    ? { left: -40, right: 40, top: 28, bottom: -28, far: 260 }
    : { left: -118, right: 118, top: 78, bottom: -78, far: 260 });
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = .055;
  sun.shadow.intensity = .82;
  scene.add(sun);

  if (!comparison) {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        horizon: { value: new THREE.Color("#c4d3d5") },
        zenith: { value: new THREE.Color("#789cac") },
        cloud: { value: new THREE.Color("#edf0e9") },
      },
      vertexShader: `varying vec3 skyDirection;
        void main(){ skyDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 cloud; varying vec3 skyDirection;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
        void main(){ vec3 d=normalize(skyDirection); float h=max(d.y,0.0);
          vec3 color=mix(horizon,zenith,pow(h,.6));
          vec2 p=d.xz/max(d.y+.18,.06)*2.4;
          float n=noise(p)*.60+noise(p*2.07)*.27+noise(p*4.1)*.13;
          float c=smoothstep(.48,.73,n)*smoothstep(.02,.22,h)*.4;
          gl_FragColor=vec4(mix(color,cloud,c),1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    sky.name = "Morning_Sky";
    sky.renderOrder = -10;
    scene.add(sky);
  }
  return sun;
}
