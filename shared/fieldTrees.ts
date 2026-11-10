export type FieldTreeInput = {
  treeId: string;
  sourceTreeId?: string;
  variety: string | null;
  circumferenceCm: number | null;
  heightM: number | null;
  measurementHeightM: number | null;
  latitude?: number | null;
  longitude?: number | null;
  elevationM?: number | null;
};

/** WGS84 GeoJSON Polygon with one closed exterior ring, in longitude/latitude order. */
export type FieldPolygon = {type: 'Polygon'; coordinates: [number, number][][]};
export type FieldBoundaries = {
  park: FieldPolygon;
  zones: {zoneId: 'A' | 'B' | 'C' | 'D'; polygon: FieldPolygon}[];
};

export type FieldBoundaryRecord = FieldBoundaries & {
  recordId: string; siteId: string; sourceName: string; observedAt: string; importedAt: string;
  provenanceMode: 'measured' | 'simulated'; coordinateSystem: 'WGS84';
};

export type FieldTreeImport = {
  siteId: string;
  sourceName: string;
  observedAt: string;
  provenanceMode: 'measured' | 'simulated';
  coordinateSystem: 'WGS84';
  elevationDatum?: string;
  records: FieldTreeInput[];
  boundaries?: FieldBoundaries;
};

export type FieldTreeRecord = FieldTreeInput & {
  recordId: string;
  siteId: string;
  sourceName: string;
  observedAt: string;
  importedAt: string;
  provenanceMode: 'measured' | 'simulated';
  coordinateSystem: 'WGS84';
  elevationDatum: string | null;
};

export type FieldTreeCatalog = {
  siteId: string;
  items: FieldTreeRecord[];
  importedCount: number;
  savedCount?: number;
  boundaries?: FieldBoundaryRecord;
};
