# Third-party code used by the prototype

## Tidewater fixed cumulus trial — 2026-09-28

Source: https://github.com/dgreenheck/tidewater/blob/main/src/sky/Clouds.js
Source snapshot retained in `output/tidewater-source/Clouds.js`.
Copyright (c) 2026 DRG Software Solutions LLC; MIT grant reproduced below.
Upstream CREDITS explicitly publishes the author's Sky Pro-derived cloud code under MIT.

- `src/vendor/tidewaterClouds.ts`: noise, weather field, SDF, density, erosion,
  multiple-scattering lighting and detailed view-march equations extracted from that source.
- `src/debug/trialTidewaterClouds.ts`: adapter to Three's WebGPU device; fixed time,
  deterministic four-sample panorama instead of temporal accumulation; coverage 0.58
  instead of upstream default 0.45; no cirrus, wind animation or spatial cloud shadows.
- Existing atmospheric adapter composites cloud radiance/transmittance into background
  and disk-free environment. No reference-project media or third-party models imported.
- This extends the earlier atmosphere-only entry below; exclusions there describe that earlier stage.

## Tidewater atmosphere WGSL — independent WebGPU trial, 2026-09-28

Pinned source: https://github.com/dgreenheck/tidewater/tree/4811ba48d795197de5621985f404e765c0b7c0ef

- `src/vendor/tidewaterAtmosphere.ts`: extracted WGSL from `src/sky/Atmosphere.js`:
  medium, transmittance, multiple-scattering and sky-view LUT equations and sampling.
- `src/debug/trialTidewaterAtmosphere.ts`: Three-device adapter, fixed daytime panorama,
  one-time GPU readback, PMREM, soil lower hemisphere and horizon extension.
  Solar limb-darkening equation adapted from `src/sky/Sky.js`.
- Copyright (c) 2026 DRG Software Solutions LLC. The MIT grant reproduced below
  applies to these code portions too. Upstream LICENSE and CREDITS were checked.
- No third-party models/textures/audio from Tidewater are imported. No clouds,
  cloud shadows, GTAO, CSM, TAAU, bloom or lens-flare implementation is imported.
- Prior noise-only entry below describes the earlier 2026-09-24 integration.

## Tidewater noise utilities

Source: https://github.com/dgreenheck/tidewater/blob/main/src/util/Noise.js

Retrieved 2026-09-24. Adapted in `src/vendor/tidewaterNoise.ts` with TypeScript types; unused utilities omitted. `src/environmentLayout.ts` uses these utilities and the habitat/exclusion/spacing approach described in Tidewater's `src/world/vegetation/Scatter.js`, with Hainan-specific rules, counts and constraints. No Tidewater assets or WebGPU engine were imported. `src/sampleLighting.ts` uses the already-installed Three.js Sky (retaining its package license) and its built-in static clouds, not Tidewater's volumetric cloud implementation.

MIT License

Copyright (c) 2026 DRG Software Solutions LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
