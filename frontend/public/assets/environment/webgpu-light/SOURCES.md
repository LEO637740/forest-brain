# WebGPU lighting trial asset

- Asset: Rustig Koppie (Pure Sky), 2K HDR.
- Page: https://polyhaven.com/a/rustig_koppie_puresky
- Download: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rustig_koppie_puresky_2k.hdr
- Authors: Greg Zaal (original), Jarod Guest (sky edits).
- License: CC0, https://polyhaven.com/license
- Downloaded 2026-09-27, 4,047,254 bytes.
- SHA256: E70BF97A44982DB07FB952B1F74C07E818649C2BBDFEB6AD4F98AF7B4431A38F
- Only used by src/debug/trialLighting.ts. No homepage adoption.
- Original file is unchanged. Runtime exposure normalization; separate IBL copy caps the sun hotspot and replaces the lower hemisphere with restrained soil bounce. Background and environment share yaw; the measured sky sun sets direct-light orientation.
- This is a generic photographic morning lighting reference, not a Hainan capture or geographic/date-accurate solar model. Static panorama, not volumetric clouds; no cloud shadows or weather animation.
