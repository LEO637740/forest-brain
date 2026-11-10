import {DATA, type Datum} from './analyticsData';
import type {Site} from './model';
import {treeScopeSeries} from '../../../shared/analyticsScope.ts';

export type AnalyticsResponse = {site: string; asOf: string; rows: Datum[]; source: {mode: string; label: string; rainfall: string}};
export type AnalyticsSource = {rows: Datum[]; label: string; rainfall: string; asOf: string; fallback: boolean; message: string};

export function analyticsSource(site: Exclude<Site, 'xian'>, response?: AnalyticsResponse, error?: string, treeIndices?:number[]): AnalyticsSource {
  const rows = response?.rows;
  if (!error && response?.site === site && rows?.length && rows.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && [d.actual, d.forecast, d.rain, d.taps].every(n => Number.isFinite(n) && n >= 0))) {
    return {rows: [...treeScopeSeries(rows,treeIndices)].sort((a, b) => a.date.localeCompare(b.date)).slice(-30), label: response.source.label, rainfall: response.source.rainfall, asOf: response.asOf, fallback: false, message: ''};
  }
  return {rows: treeScopeSeries(DATA[site],treeIndices), label: '本地固定模拟样本', rainfall: '本地模拟降雨；未接入园区雨量计', asOf: DATA[site].at(-1)!.date, fallback: true,
    message: error ? `后端读取失败：${error}。已回退到本地固定模拟样本。` : response ? '后端返回的分析序列不完整。已回退到本地固定模拟样本。' : '正在读取后端；暂展示本地固定模拟样本。'};
}

/** A comparison is shown only when every selected calendar date exists in both sources. */
export function matchingDates(selected: Datum[], candidate: AnalyticsSource, requireRemote: boolean): Datum[] | null {
  if (!selected.length || (requireRemote && candidate.fallback)) return null;
  const byDate = new Map(candidate.rows.map(row => [row.date, row]));
  const rows = selected.map(row => byDate.get(row.date));
  return rows.every((row): row is Datum => row !== undefined) ? rows : null;
}

export const perTap = (quantity: number, taps: number) => taps > 0 ? quantity / taps : 0;

export function analyticsCsv(rows: Datum[], scope: string, source: AnalyticsSource): string {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ['日期', '范围', '胶乳kg', '有效采割树次', '单次单树kg', '园区降雨mm', '数据来源', '降雨来源', '来源截至'];
  return '\ufeff' + [header, ...rows.map(d => [d.date, scope, d.actual.toFixed(3), d.taps, d.taps ? perTap(d.actual, d.taps).toFixed(4) : '', d.rain, source.label, source.rainfall, source.asOf])].map(row => row.map(cell).join(',')).join('\n');
}
