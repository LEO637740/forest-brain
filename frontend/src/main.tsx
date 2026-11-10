import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
const TreeAssetDebug = React.lazy(()=>import('./TreeAssetDebug').then(module=>({default:module.TreeAssetDebug})));
const LODComparison = React.lazy(()=>import('./debug/LODComparison').then(module=>({default:module.LODComparison})));
const VariantPerformance = React.lazy(()=>import('./debug/VariantPerformance').then(module=>({default:module.VariantPerformance})));
import "./styles.css";

// Keep the experimental renderer out of the production homepage bundle path.
const WebGPUTrial = React.lazy(() => import("./debug/WebGPUTrial"));
const RailWorkSample = React.lazy(() => import("./debug/RailWorkSample"));

const params = new URLSearchParams(window.location.search);
document.body.classList.toggle("scene-review", params.has("sceneOnly") || params.has("sample"));
const debugArchetype = params.get("treeDebug");
const debugLod = Number(params.get("lod") ?? 0);
const debugMode = debugArchetype === "A" || debugArchetype === "B" || debugArchetype === "C";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><React.Suspense fallback={<div role="status">正在加载视图…</div>}>
    {params.has("railSample") ? <React.Suspense fallback={<div>正在载入作业样区…</div>}><RailWorkSample /></React.Suspense> : params.has("webgpuTrial") ? <React.Suspense fallback={<div>正在加载渲染验证…</div>}><WebGPUTrial /></React.Suspense> : params.has("variantPerf") ? <VariantPerformance /> : params.has("lodCompare") ? <LODComparison /> : debugMode
      ? <TreeAssetDebug archetype={debugArchetype} lod={Math.min(3, Math.max(0, debugLod)) as 0 | 1 | 2 | 3} />
      : <App />}
  </React.Suspense></React.StrictMode>,
);
