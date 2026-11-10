export type SalesShipmentStatus = 'planned' | 'in-transit' | 'received' | 'cancelled';

export type SalesInventory = {
  siteId: string;
  openingStockKg: number;
  stockKg: number;
  availableKg: number;
  heldKg: number;
  processedKg: number;
  processedBatches: number;
  dispatchedKg: number;
  inTransitKg: number;
  soldKg: number;
  salesRevenueCny: number;
  updatedAt: string;
  unit: 'kg_dry_rubber';
  mode: 'simulation';
};

export type SalesShipmentReceipt = {
  at: string;
  receivedKg: number;
  priceCnyPerKg: number;
  revenueCny: number;
  note: string;
  mode: 'simulation';
};

export type SalesShipment = {
  id: string;
  siteId: string;
  modelId: string;
  scenarioId: string;
  scenarioName: string;
  day: number;
  plannedDepartureAt: string;
  plannedKg: number;
  priceCnyPerKg: number;
  plannedRevenueCny: number;
  buyer: {id: string; name: string};
  status: SalesShipmentStatus;
  createdAt: string;
  departureAt?: string;
  cancelledAt?: string;
  receipt?: SalesShipmentReceipt;
  mode: 'simulation';
};

export const salesShipmentStatusLabels: Record<SalesShipmentStatus, string> = {
  planned: '待出货',
  'in-transit': '运输中',
  received: '已签收',
  cancelled: '已替换',
};
