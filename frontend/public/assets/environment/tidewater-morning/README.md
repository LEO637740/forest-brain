# Fixed morning HDR

Generated 2026-09-28 from src/debug/trialTidewaterAtmosphere.ts and trialTidewaterClouds.ts.
Upstream https://github.com/dgreenheck/tidewater ; MIT attribution in THIRD_PARTY_NOTICES.md.
The .bin files contain gzip little-endian RGBA16F, 2048 x 1024, linear sRGB, equirectangular, flipY=true. Binary extension avoids automatic HTTP Content-Encoding handling; the loader decompresses explicitly.
background contains solar disk; ambient excludes it and uses soil radiance below horizon.
Sun direction [.7858739156,.4738286536,-.3973519798], RGB [9.689453125,8.185546875,6.2412109375], transmission 1.
Cloud coverage parameter .58, 4 samples, fixed time 0; no wind or spatial cloud shadows.
These are generated assets, not downloaded photographs. Frozen trees unchanged.
