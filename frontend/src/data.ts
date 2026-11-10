export const operations = [
  { key: "plan", label: "计划作业任务", value: "156", unit: "项", meta: "较昨日 +12%", tone: "green" },
  { key: "done", label: "已完成任务", value: "93", unit: "项", meta: "完成率 59.6%", tone: "green" },
  { key: "attention", label: "需关注任务", value: "11", unit: "项", meta: "较昨日 +4", tone: "amber" },
  { key: "robot", label: "机器人在线", value: "2 / 2", unit: "台", meta: "在线率 100%", tone: "blue" },
  { key: "yield", label: "预计产胶量", value: "42.5", unit: "kg", meta: "较昨日 +6.3%", tone: "green" },
] as const;

export const attentions = [
  {
    kind: "发现新数据",
    level: "B区",
    title: "发现新病虫，部分区域疑似白粉病口径扩散",
    detail: "预计今日午后至该园区中部大棚，建议将A区、B区的晴晒作业窗口顺延至明日。",
    meta: "今天 06:20",
    tone: "blue",
  },
  {
    kind: "发现叶片异常",
    level: "C区",
    title: "C区部分树叶现病虫害较明显发现皮层，流胶现象少",
    detail: "建议尽快现场排查采样场核。",
    meta: "今天 07:15",
    tone: "red",
  },
  {
    kind: "产量重点比降",
    level: "D区",
    title: "D区近7日产胶较上周下降12.6%，建议关注",
    detail: "建议关注增强度与树体健康状况。",
    meta: "昨天 18:40",
    tone: "amber",
  },
  {
    kind: "作业策略建议",
    level: "全区域",
    title: "根据当前气象和土壤情况，建议采取3天割",
    detail: "3天割胶模式数据较好，并逐步过渡中至完全恢复。",
    meta: "今天 09:30",
    tone: "green",
  },
] as const;

export const layerModes = ["综合态势", "作业", "健康", "风险", "产胶", "机器人"];

// 产胶趋势：实际产量 vs 预计产量
export const yieldData = {
  actual: [52, 48, 51, 49, 53, 50, 54],
  predicted: [50, 49, 50, 51, 52, 51, 53],
};

// 异常趋势：堆叠数据（异常累积、防治异常、设备异常、其他）
export const anomalyData = {
  dates: ["06.08", "06.09", "06.10", "06.11", "06.12", "06.13", "06.14"],
  categories: [
    { name: "异常累积", color: "#f08b82", values: [3, 4, 3, 5, 4, 6, 5] },
    { name: "防治异常", color: "#9bc8ff", values: [2, 3, 2, 3, 3, 4, 3] },
    { name: "设备异常", color: "#8eeac5", values: [1, 2, 2, 2, 2, 3, 2] },
    { name: "其他", color: "#b8b8b8", values: [1, 1, 1, 2, 1, 2, 1] },
  ],
};
