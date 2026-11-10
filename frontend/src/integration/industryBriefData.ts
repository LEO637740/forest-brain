import type {ContextSnapshot, RunResponse, Strategy} from './contracts';

export type IndustryStrategy = Extract<Strategy, {kind: 'industry_brief'}>;
export type IndustryRecord = NonNullable<ContextSnapshot['modules']['industry']>['records'][number];
export type IndustryRunList = {items: {runId: string; kind: string; status: string; createdAt: string}[]; nextCursor: string | null};

// The server returns newest-first. A failed or pending latest run must stay visible.
export function latestIndustryRunId(list: IndustryRunList | undefined): string | undefined {
  return list?.items.find(item => item.kind === 'industry_brief')?.runId;
}

export function assessIndustry(run: RunResponse | undefined, context: ContextSnapshot | undefined, error?: string, now = Date.now()) {
  const unavailable = (status: string, message: string) => ({available: false, status, message, strategy: undefined as IndustryStrategy | undefined});
  if (error) return unavailable('unavailable', `行业记录读取失败：${error}`);
  if (!run) return unavailable('pending', '正在读取已保存的行业研判…');
  if (run.status === 'queued' || run.status === 'running') return unavailable(run.status, run.status === 'queued' ? '最新行业研判等待分析；当前没有新的管理建议。' : '最新行业研判正在分析；完成后才能查看建议。');
  if (run.status === 'failed') return unavailable('failed', `最新行业研判失败：${run.error.message}`);
  if (run.status === 'needs_data') return unavailable('needs_data', '最新行业研判需要补充数据，尚未形成建议。');
  if (run.status !== 'succeeded') return unavailable('unavailable', '行业研判状态待核验。');
  const strategy = run.strategy;
  if (strategy.kind !== 'industry_brief') return unavailable('unavailable', '该记录不是行业研判，请重新读取。');
  if (strategy.qualityReview?.status === 'withdrawn') return unavailable('withdrawn', '行业建议已撤回，不能继续作为管理依据。');
  if (!(Date.parse(strategy.expiresAt) > now)) return unavailable('expired', '行业建议已过期，等待重新准备；下方输入仅供历史追溯。');
  if (!context) return unavailable('pending', '正在读取本次行业输入，暂不展示建议正文。');
  if (context.snapshotId !== strategy.inputSnapshot.snapshotId || context.version !== strategy.inputSnapshot.version) return unavailable('unavailable', '行业结果与输入版本不一致，暂不展示建议。');
  if (!context.modules.industry) return unavailable('needs_data', '本次输入缺少行业资料，暂不展示建议。');
  return {available: true, status: 'available', message: '建议可查看 · 待人工复核', strategy};
}

export function industryRecordState(record: IndustryRecord, now = Date.now()): string {
  const mode = {simulated: '模拟演示', forecast: '公开预报', measured: '公开统计', estimated: '估计资料'}[record.provenance.mode];
  if (record.quality !== 'valid') return `${mode} · ${record.quality === 'missing' ? '缺少数据' : '待核验'}`;
  if (!(Date.parse(record.expiresAt) > now)) return `${mode} · 已过期`;
  return mode;
}

export function industrySourceUrl(record: IndustryRecord): string | undefined {
  try {const url = new URL(record.sourceUrl); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;} catch {return undefined;}
}

export function industryTime(value: string | undefined): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false}) : '时间待核验';
}
