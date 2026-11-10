# Local overview basemap

The map uses local vector outlines by default. No external map request is needed
when navigating world → China → province → park → plot → tree. Street tiles remain
an optional, explicitly selected OpenStreetMap layer with their attribution.

- World: Natural Earth, 1:110m Admin 0 Countries, downloaded 2026-10-30 from
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
- License: public domain, https://www.naturalearthdata.com/about/terms-of-use/
- China provinces: existing `china-provinces.json` supplied with this project;
  this change reuses the existing outlines and does not assert a new license or survey.
- Prepared by `frontend/scripts/prepare-local-basemap.mjs`: remove unused feature
  properties, simplify outlines for overview display, project once to Web Mercator.
  Output is `frontend/src/workspace/spatial/localBasemapData.ts`.
- At park/tree scale, the metric grid and supplied park boundaries, plots and tree
  coordinates are used. This is a coordinate map, not street, satellite or terrain imagery.
  Existing measured/simulated source labels remain authoritative for business data.

Regenerate explicitly from the downloaded GeoJSON with:
`node scripts/prepare-local-basemap.mjs /path/to/ne_110m_admin_0_countries.geojson`
No download or generation is required for ordinary startup or builds.
