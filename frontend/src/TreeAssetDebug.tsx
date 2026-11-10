import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

type Props = { archetype: "A" | "B" | "C"; lod: 0 | 1 | 2 | 3 };

declare global {
  interface Window {
    __TREE_DEBUG__?: {
      ready: boolean;
      archetype: string;
      lod: number;
      bounds?: { min: number[]; max: number[]; size: number[] };
      nodes?: Array<{ name: string; position: number[]; scale: number[]; worldBounds: { min: number[]; max: number[] } }>;
    };
  }
}

export function TreeAssetDebug({ archetype, lod }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#c8d0cb");
    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 200);
    camera.position.set(18, 11, 23);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 6.5, 0);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight("#ffffff", "#677165", 2.5));
    const sun = new THREE.DirectionalLight("#fff0d6", 3.0);
    sun.position.set(-12, 22, 16);
    scene.add(sun);
    scene.add(new THREE.GridHelper(30, 30, "#50685c", "#91a299"));
    scene.add(new THREE.AxesHelper(3));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: "#9aa696", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    scene.add(ground);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    let treeRoot: THREE.Group | null = null;
    let disposed = false;
    window.__TREE_DEBUG__ = { ready: false, archetype, lod };
    void loader.loadAsync(`/assets/trees/mature-family-v1/RT_Mature_${archetype}_LOD${lod}.glb`).then((gltf) => {
      if (disposed) return;
      treeRoot = gltf.scene;
      treeRoot.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (material.transparent && material.side === THREE.DoubleSide) material.forceSinglePass = true;
        });
      });
      scene.add(treeRoot);
      treeRoot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(treeRoot);
      const size = box.getSize(new THREE.Vector3());
      scene.add(new THREE.Box3Helper(box, new THREE.Color("#f0b64b")));
      const nodes: NonNullable<Window["__TREE_DEBUG__"]>["nodes"] = [];
      treeRoot.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const nodeBox = new THREE.Box3().setFromObject(node);
        nodes.push({
          name: node.name,
          position: node.position.toArray(),
          scale: node.scale.toArray(),
          worldBounds: { min: nodeBox.min.toArray(), max: nodeBox.max.toArray() },
        });
      });
      window.__TREE_DEBUG__ = {
        ready: true,
        archetype,
        lod,
        bounds: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
        nodes,
      };
      document.documentElement.dataset.treeDebug = "ready";
    });

    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      delete window.__TREE_DEBUG__;
      host.removeChild(renderer.domElement);
    };
  }, [archetype, lod]);

  return (
    <main className="tree-debug-shell">
      <div className="tree-debug-host" ref={hostRef} />
      <aside className="tree-debug-readout">
        <strong>Mature {archetype} · LOD{lod}</strong>
        <span>GLTF scene direct render</span>
        <small>橙框：世界包围盒 · Grid：1 米</small>
      </aside>
    </main>
  );
}
