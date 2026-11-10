export type EudrReadinessStatus = 'missing' | 'demo_prepared';
export type EudrGeometry = {type: 'Polygon'; coordinates: number[][][]};
export type EudrPlot = {
  id: string; name: string; zone: string; areaHa: number; geometry: EudrGeometry;
  mode: 'simulated'; source: string;
};
export type EudrGeoJson = {
  type: 'FeatureCollection';
  features: {type: 'Feature'; id: string; geometry: EudrGeometry;
    properties: {name: string; areaHa: number; mode: 'simulated'; source: string}}[];
};
export type EudrEvidence = {
  id: string; kind: 'legality' | 'deforestation'; title: string; mode: 'simulated';
  note: string; plotIds: string[]; recordedAt: string;
};
export type EudrParty = {name: string; country: string; address: string; email: string; mode: 'simulated'};
export type EudrRiskReview = {status: 'not_assessed'; summary: string; actions: string[]};
export type EudrRules = {
  checkedAt: string; cutoffDate: string; productScope: string;
  dates: {role: string; date: string}[]; role: string; geolocation: string;
  sources: {title: string; url: string}[];
};
export type EudrBatchReadiness = {
  id: string; title: string; dryKg: number; productName: string; hsCode: string; countryOfProduction: string;
  sourceTaskId: string; sourceTreeIds: string[]; sourceZones: string[];
  productionPeriod: {from: string; to: string} | null;
  plots: EudrPlot[]; geojson: EudrGeoJson; evidence: EudrEvidence[];
  supplier: EudrParty | null; buyer: EudrParty | null;
  status: EudrReadinessStatus; statusLabel: string; missing: string[]; nextStep: string;
  preparedAt: string | null; ddsReference: null; traceabilityNote: string; riskReview: EudrRiskReview;
  allocatedKg: number; remainingKg: number; checks: EudrCheck[];
};
export type EudrCheck = {key: string; label: string; ok: boolean; detail: string};
export type EudrShipment = {
  id: string; day: number; plannedDepartureAt: string; plannedKg: number; status: 'planned' | 'in-transit' | 'received';
  buyer: string | null; traceStatus: 'traceable' | 'unallocated' | 'shipped_untraced'; traceLabel: string;
  allocation: {parts: {batchId: string; title: string; kg: number}[]; allocatedAt: string; allocatedBy: string; sourceZones: string[]} | null;
};
export type EudrReadiness = {
  siteId: string; parkName: string; asOf: string; status: EudrReadinessStatus;
  summary: string; nextStep: string; batches: EudrBatchReadiness[]; rules: EudrRules;
  inventory: {openingStockKg: number; stockKg: number; availableKg: number; processedKg: number;
    dispatchedKg: number; soldKg: number; sourceAllocation: 'unknown' | 'partial'; note: string};
  shipments: EudrShipment[];
};
export type EudrExportPack = {
  format: 'rubber-eudr-demo-v1'; exportedAt: string; siteId: string; parkName: string;
  status: EudrReadinessStatus; disclaimer: string; rules: EudrRules; batch: EudrBatchReadiness; riskReview: EudrRiskReview;
  flowChain: {action: string; label: string; at: string; note: string}[];
  sourceRecord: {taskId: string; treeIndices: number[]; taskRevision: number};
  shipmentAllocation: {status: 'unknown' | 'allocated'; allocatedKg: number; remainingKg: number;
    shipments: {shipmentId: string; kg: number; allocatedAt: string}[]; note: string};
};
