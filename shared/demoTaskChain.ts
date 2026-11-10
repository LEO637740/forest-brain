export type DemoTreeAngle = {
  treeIndex: number;
  treeId: string;
  angleDeg: number;
  strategyId: string;
  runId: string;
  revision: number;
  adoptedAt: string;
};

export type DemoTaskStrategy = {
  strategyId: string;
  taskId: string;
  siteId: string;
  revision: number;
  mode: 'simulation';
  generator: 'demo_rules';
  generatedAt: string;
  adoptedAt: string | null;
  adoptedBy: string | null;
  title: string;
  summary: string;
  basis: string[];
  treeIndices: number[];
  parameters: {angleDeg: number; cutDepthMm: number; speedMmPerSec: number};
  adoptedAngles?: DemoTreeAngle[];
  surfaceAction: string;
};

export type DemoTaskReceipt = {
  receiptId: string;
  taskId: string;
  siteId: string;
  strategyId: string;
  strategyRevision: number;
  treeIndex: number;
  treeId: string;
  finishedAt: string;
  outcome: 'completed' | 'skipped' | 'cancelled';
  angleDeg: number;
  note: string;
  mode: 'simulation';
};

export function demoTaskAngle(strategy: DemoTaskStrategy, treeIndex: number): number {
  return strategy.adoptedAngles?.find(item => item.treeIndex === treeIndex)?.angleDeg ?? strategy.parameters.angleDeg;
}

export function demoTaskAngleRange(strategy: DemoTaskStrategy): string {
  const angles = strategy.treeIndices.map(index => demoTaskAngle(strategy, index));
  const low = Math.min(...angles), high = Math.max(...angles);
  return low === high ? String(low) : `${low}–${high}`;
}

export function makeDemoTaskReceipt(strategy: DemoTaskStrategy, treeIndex: number, outcome: DemoTaskReceipt['outcome'], finishedAt: string, note: string): DemoTaskReceipt {
  return {
    receiptId: `${strategy.taskId}:tree:${treeIndex}`,
    taskId: strategy.taskId, siteId: strategy.siteId,
    strategyId: strategy.strategyId, strategyRevision: strategy.revision,
    treeIndex, treeId: `T-${String(treeIndex+1).padStart(4,'0')}`,
    finishedAt, outcome, angleDeg: demoTaskAngle(strategy,treeIndex), note, mode:'simulation',
  };
}
