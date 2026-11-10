import type {ContextSnapshot, RunResponse, Strategy} from './contracts';

type Finding = Extract<Strategy, {kind: 'pest_risk'}>['proposal']['findings'][number];
export type HealthAssessment = {
  available: boolean;
  message: string;
  treeIds: string[];
  findings: Finding[];
  generatedAt?: string;
};

/** Only a current result with its matching target snapshot can establish absence of risk. */
export function assessHealth(result?: RunResponse, context?: ContextSnapshot, error?: string, now = Date.now()): HealthAssessment {
  const treeIds = context?.targetSnapshot.treeIds || [];
  const unavailable = (message: string): HealthAssessment => ({available: false, message, treeIds, findings: []});
  if (error) return unavailable(`健康结果读取失败：${error}；状态待更新`);
  if (!result) return unavailable('健康结果尚未就绪；状态待更新');
  if (result.status !== 'succeeded') return unavailable(result.status === 'failed' ? `健康分析失败：${result.error.message}；状态待更新` : result.status === 'needs_data' ? '健康分析需要补充数据；状态待更新' : '健康分析进行中；状态待更新');
  const strategy = result.strategy;
  if (strategy.qualityReview?.status === 'withdrawn') return unavailable('健康建议已撤回；状态待更新');
  if (!(Date.parse(strategy.expiresAt) > now)) return unavailable('健康建议已过期；状态待更新');
  if (strategy.kind !== 'pest_risk') return unavailable('当前结果不是健康分析；状态待更新');
  if (!context || !treeIds.length || context.snapshotId !== strategy.inputSnapshot.snapshotId || context.targetSnapshot.targetSnapshotId !== strategy.targetSnapshotId) return unavailable('健康分析快照尚未匹配；状态待更新');
  return {available: true, message: '当前有效健康分析', treeIds, findings: strategy.proposal.findings.filter(f => treeIds.includes(f.treeId)), generatedAt: strategy.generatedAt};
}
