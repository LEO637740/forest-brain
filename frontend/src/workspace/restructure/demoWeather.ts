import type { Site, Task } from '../model';

export type WeatherStatus = '草案' | '待复核' | '已批准' | '未采纳' | '待重新复核';
export type WeatherAction = 'save' | 'submit' | 'approve' | 'retain' | 'apply' | 'receipt' | 'invalidate';

export type WeatherDemoState = {
  status: WeatherStatus;
  start: string;
  end: string;
  version: number;
  applied: boolean;
  receipt: boolean;
  history: { action: string; time: string }[];
};

export type WeatherEvidence = {
  hour: number;
  rainMm: number | null;
  soilPct: number | null;
  kind: '观测' | '预测';
};

export const WEATHER_ACTION_LABELS: Record<WeatherAction, string> = {
  save: '保存草案',
  submit: '提交复核',
  approve: '批准方案',
  retain: '保留原方案',
  apply: '采用方案',
  receipt: '记录回执',
  invalidate: '标记失效',
};

export const WEATHER_EVIDENCE: WeatherEvidence[] = [
  { hour: 4, rainMm: 0.2, soilPct: 32, kind: '观测' },
  { hour: 5, rainMm: 1.8, soilPct: 34, kind: '观测' },
  { hour: 6, rainMm: 3.6, soilPct: 38, kind: '观测' },
  { hour: 7, rainMm: 1.1, soilPct: null, kind: '观测' },
  { hour: 8, rainMm: 0.3, soilPct: 37, kind: '预测' },
  { hour: 9, rainMm: 0, soilPct: 36, kind: '预测' },
  { hour: 10, rainMm: 0, soilPct: 35, kind: '预测' },
  { hour: 11, rainMm: 0, soilPct: 34, kind: '预测' },
  { hour: 12, rainMm: 0.1, soilPct: 33, kind: '预测' },
  { hour: 13, rainMm: 0.4, soilPct: 32, kind: '预测' },
  { hour: 14, rainMm: 0.8, soilPct: 31, kind: '预测' },
];

export const WEATHER_META = {
  title: 'C区作业窗口调整',
  date: '2026-09-22',
  source: '演示气象序列',
  scope: '海南 C区',
  taskId: 'HN-03',
  nature: '演示示例，非算法输出',
  baseline: { start: '06:00', end: '07:30' },
  proposal: { start: '08:00', end: '09:30' },
  rationale: '演示序列中的清晨降雨与原作业窗口重叠。候选方案将C区任务后移，保留原树组与机器人安排；其他分区不调整。',
  qualification: '该时窗用于验证决策交互，不代表已验证的农艺阈值。执行前仍需新的现场条件与设备受理记录。',
  constraints: [
    { label: '固定C区28棵，任务尚未开始', confirmed: true },
    { label: 'A、B、D区计划保持不变', confirmed: true },
    { label: '实时雨况与土壤阈值：待对接', confirmed: false },
    { label: '设备受理与服务端授权：待对接', confirmed: false },
  ] as { label: string; confirmed: boolean }[],
} as const;

export function initialWeatherState(_task?: Task): WeatherDemoState {
  return {
    status: '草案',
    start: '08:00',
    end: '09:30',
    version: 1,
    applied: false,
    receipt: false,
    history: [],
  };
}

function minuteOf(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function windowIssue(window: { start: string; end: string }): string | undefined {
  const start = minuteOf(window.start);
  const end = minuteOf(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return '请使用有效的 HH:MM 时间，且结束时间必须晚于开始时间';
  }
  if (start < 4 * 60 || end > 14 * 60) return '超出本样板气象证据范围（04:00–14:00）';
  return undefined;
}

function changed(
  state: WeatherDemoState,
  action: WeatherAction,
  now: string,
  patch: Partial<WeatherDemoState>,
): { state: WeatherDemoState } {
  return {
    state: {
      ...state,
      ...patch,
      history: [...state.history, { action: WEATHER_ACTION_LABELS[action], time: now }],
    },
  };
}

function rejected(state: WeatherDemoState, error: string): { state: WeatherDemoState; error: string } {
  return { state, error };
}

export function transitionWeather(
  state: WeatherDemoState,
  action: WeatherAction,
  now: string,
  window?: { start: string; end: string },
): { state: WeatherDemoState; error?: string } {
  if (action === 'save') {
    if (state.status !== '草案' && state.status !== '待重新复核') {
      return rejected(state, '当前复核版本已冻结，不能再修改时间窗口');
    }
    const nextWindow = window ?? { start: state.start, end: state.end };
    const issue = windowIssue(nextWindow);
    if (issue) return rejected(state, issue);
    const last = state.history[state.history.length - 1];
    if (last?.action === WEATHER_ACTION_LABELS[action] && nextWindow.start === state.start && nextWindow.end === state.end) return { state };
    return changed(state, action, now, {
      start: nextWindow.start,
      end: nextWindow.end,
      version: state.version + 1,
    });
  }

  if (action === 'submit') {
    if (state.status === '待复核') {
      if (!window || (window.start === state.start && window.end === state.end)) return { state };
      return rejected(state, '当前复核版本已冻结，不能再修改时间窗口');
    }
    if (state.status !== '草案' && state.status !== '待重新复核') {
      return rejected(state, '只有草案或待重新复核方案可以提交复核');
    }
    const nextWindow = window ?? { start: state.start, end: state.end };
    const issue = windowIssue(nextWindow);
    if (issue) return rejected(state, issue);
    const edited = nextWindow.start !== state.start || nextWindow.end !== state.end;
    return changed(state, action, now, {
      status: '待复核',
      start: nextWindow.start,
      end: nextWindow.end,
      version: edited ? state.version + 1 : state.version,
    });
  }

  if (action === 'approve') {
    if (state.status === '已批准') return { state };
    if (state.status !== '待复核') return rejected(state, '只有待复核方案可以批准');
    return changed(state, action, now, { status: '已批准' });
  }

  if (action === 'retain') {
    if (state.status === '未采纳') return { state };
    if (state.status !== '草案' && state.status !== '待复核' && state.status !== '已批准') {
      return rejected(state, '当前方案不能选择维持原安排');
    }
    if (state.applied) return rejected(state, '已采用的方案不能改为未采纳');
    return changed(state, action, now, { status: '未采纳' });
  }

  if (action === 'apply') {
    if (state.applied) return { state };
    if (state.status !== '已批准') return rejected(state, '只有已批准方案可以采用');
    return changed(state, action, now, { applied: true });
  }

  if (action === 'receipt') {
    if (state.receipt) return { state };
    if (!state.applied) return rejected(state, '方案尚未采用，不能生成回执');
    return changed(state, action, now, { receipt: true });
  }

  if (action === 'invalidate') {
    if (state.status === '待重新复核') return { state };
    if (state.status !== '待复核' && state.status !== '已批准') {
      return rejected(state, '只有待复核或已批准方案可标记为待重新复核');
    }
    if (state.applied) return rejected(state, '方案已采用，不能用失效操作绕过新版本的复核与采用');
    return changed(state, action, now, { status: '待重新复核' });
  }

  return rejected(state, '不支持的演示动作');
}

export function buildStationSummary(
  tasks: Task[],
  scope: 'all' | Site,
): {
  production: Task[];
  trial: Task[];
  total: number;
  done: number;
  running: number;
  waiting: number;
  cancelled: number;
} {
  const matching = scope === 'all' ? tasks : tasks.filter((task) => task.site === scope);
  const production = matching.filter((task) => task.site !== 'xian');
  const trial = matching.filter((task) => task.site === 'xian');

  return {
    production,
    trial,
    total: matching.length,
    done: matching.filter((task) => task.status === '已完成').length,
    running: matching.filter((task) => task.status === '执行中').length,
    waiting: matching.filter((task) => task.status === '待开始' || task.status === '待处理').length,
    cancelled: matching.filter((task) => task.status === '已取消').length,
  };
}
