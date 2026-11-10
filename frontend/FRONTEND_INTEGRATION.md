# 前后端联调 V0.2

本前端已连接包内后端 2.2.0；树号映射覆盖 200 棵树。使用根目录 `node start.mjs` 统一启动，避免前端连入旧后端。

- 树级策略查询：`GET /api/demo/trees/{treeId}/view?kind=...&dataMode=mixed_demo`。默认 mixed_demo，启动器的 HARNESS_DATA_MODE 统一前后端；当前园区现场数据仍以标注的模拟输入为主。
- 策略采用：`POST /api/simulation/actions`，服务端校验模式、当前绑定、过期与撤回。动作和策略版本分开保存。
- 任务同步：服务端 revision 乐观锁，前端只提交发生变化的任务并合并同 ID 的服务端版本；HTTP 200 仍需检查 conflicts。已完成任务不能回退。
- 排队和恢复：在进入切割前请求 `/api/simulation/strategy-validity` 并读取 `/api/simulation/constraints`；过期、撤回、换版或无法核验时阻塞并提示。已开割参数冻结。
- 天气约束来自独立状态接口，最近 200 条操作日志仅用于审计。缺少参考预报时显示未就绪，不隐式使用 morning 模拟结果冒充参考预报。
- 健康图层与分析页使用同一 park-health 有效性判断。失效、撤回、失败显示待更新，不推断为零风险。
- 分析页日期与 CSV 来自当前展示数据；后端断开时醒目标记本地模拟回退，两园区按共同日期比较。

配置和安装见根目录 README.md。浏览器访问、策略准备与模拟业务动作的权限范围不同；页面读操作不自动生成模型请求。
