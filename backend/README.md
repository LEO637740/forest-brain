# 当前联调修订版本：2.3.1

此后端已合并 MH 模拟业务及 V0.2 修复。统一启动、端口、数据模式和测试以 [根目录说明](../README.md) 为准，新增接口见 [联调扩展接口](contracts/联调扩展接口_V0.2.md)。下文保留原后端独立运行说明作为参考；服务版本已升级，原 2.1.0 交付验证记录不作为本次修订验证结果。

2026-10-17：核查、天气约束、市场情景及任务占用按园区独立处理，旧无园区动作/核查/情景只归海南。任务与回执 GET 可带 `siteId` 筛选，不带参数仍为现有全园区同步；写入时拒绝矛盾的任务园区及其他园区策略引用。新增健康能力 `site-scoped-simulation`，版本为 2.3.1。选择园区不是账户授权，当前角色按钮仍仅用于演示视图。

2026-10-17：完整联调项目新增 `npm run demo:acceptance`，使用独立内存数据库验证七类固定场景，生成中文 HTML 与 JSON 证据。它需要相邻 `frontend`、`scripts` 源码目录，无需启动服务、安装前端依赖或调用模型，不写入 `var/brain.sqlite`。单独分发本后端时，请使用原有后端测试，或改用完整联调包运行此命令。

# MH 后端联调包

代码基线 harness-brain 2.1.0，打包日期 2026-10-03，接口仍为待双方确认的草案。

这个包包含可运行的后端源码、参考网页、只读客户端、接口草案及自动化测试。你负责把场景树对象映射到 treeId，点击后读取树档案和候选割胶策略。我方负责档案及策略。先验证你的前端能否接通；真实 Blender 点击效果仍需双方联调确认。

## 1 先跑起来

需要 **Node.js 24.14.0 或以上**，无需 npm install，无需 Python、Docker、数据库安装或本地模型。解压到可写文件夹后，在包含 package.json 的 harness-brain-mh 文件夹打开终端。Windows 可用 PowerShell；macOS 可用终端。

```text
node --version
npm start
```

保持该终端运行。另开一个终端，进入同一文件夹：

```text
npm run demo:prepare -- --tree-ids T-0012,T-0031,T-0042
```

浏览器打开 http://127.0.0.1:4188/blender-preview，先选 T-0012 查看档案和候选角度；T-0031 休割、T-0042 缺围径，应显示 needs_data。三棵能跑通后，准备完整十棵：

```text
npm run demo:prepare
```

准备命令是独立的操作；前端点击仅查询，不生成策略。命令退出 0 不保证各树全部成功，以逐树 strategyStatus 为准。建议最多有效一小时，实际 expiresAt 可能更早；过期后重新运行准备命令。

本包的 npm start 使用 start-mh.mjs，默认加载 `.env.local`，启动后自动恢复已配置模型并启动自动调度；调度会在启动时立即检查，之后按周期或重要公开数据源新快照触发。默认模型为本机 Ollama `qwen2:7b`。前端模型控制区或 `POST /api/model/control {paused:false}` 可手动恢复模型；“大模型生成”使用 `generatorMode=configured`。使用 `--no-automatic` 可关闭自动调度，`--rules` 或 `--offline` 固定规则并自动关闭自动调度。实际模型请求和结果记录来源、次数及引用；复杂任务的大脑候选若校验不通过或服务不可用，会保留原始审计并生成带 fallback 标记的规则保底策略包，待人工复核；上下文硬缺项仍返回 needs_data。

自动任务提交时建立视图绑定，成功、失败、缺项和过期均从该运行读取，较旧任务不能替换较新的绑定。当前默认自动范围为 200 棵树的角度、树表、生长、健康四类树级任务以及行业研判，滚动次数上限见 config/automatic.json；角度按单树排队，其他树级能力按每批 10 棵排队。模型暂停时不发起新的大脑请求，简单条件的规则任务仍可继续；候选内容校验失败会记录原始候选和告警，并由同一输入快照生成规则保底策略包，继续后续周期。

2026-10-17：规则保底发布成功不代表模型服务正常。自动记账同时读取本次运行的服务故障；账户不可用、模型未配置、请求拒绝立即熔断，暂时性服务故障按连续失败阈值暂停。数据在保底期间到期或进程在故障已记录、结果未落盘时崩溃，也会保留已知严重故障。正常重试不会重复使用上一轮错误，免费规则及暂停/预算拦截不清零连续故障数。普通自动启动仍恢复一般暂停，但不清除故障熔断；修复配置后需显式恢复自动分析，额度与原始归档保留。

`GET /internal/harness/runs` 支持 `kind`、`dataMode=demo|mixed_demo`、`generatorMode=configured|demo_rules` 与分页组合过滤，并返回 generatorMode；行业页面用最新 configured 记录，不因失败/过期切回旧成功。`POST /api/sources/industry-context` 支持 demo/public/mixed_demo，读取现存来源而不触发刷新；离线可生成明确标注的模拟行业上下文。行业规则输出只整理来源、限制和复核建议，不声称模型预测或真实生产安排。

公开 API/报告采集默认开启，仍按真实可用来源优先、缺项显式模拟的原则运行。首次采集异步进行，刚启动时可能还没有真实资料；可查看 /api/sources。当前园区地点未确认，海口仅为区域参考，树级天气不能冒充园区实测。树档案、现场测量等目前为合成记录。

断网时可用下面命令做明确的离线预演：

```text
node start-mh.mjs --offline
```

不要同时启动两份服务占用同一端口。Ctrl+C 停止本包服务；SQLite 实验性提示不影响联调。本包自己创建 var/brain.sqlite，里面没有发件方的数据库或历史策略。

## 2 你的前端接两个 GET

先读取对象映射：

```text
GET http://127.0.0.1:4188/api/demo/trees/manifest
```

固定十树为 T-0001～T-0007、T-0012、T-0031、T-0042，默认对象名 Tree_T-xxxx。对象名可以不同，但对象必须明确绑定 treeId，不要用数组顺序或坐标推导树号。

点击 T-0012 后读取：

```text
GET http://127.0.0.1:4188/api/demo/trees/T-0012/view?kind=tapping_angle&dataMode=mixed_demo
```

tree 用于基本档案，strategyStatus 控制显示。只有 available 才读取 strategy.proposal；这是单树对象，直接取 strategy.proposal.recommendedCutSlopeDeg，不是数组。坡角单位为度，相对水平；angleReference、cutDirection、conditions 一起展示。它不是机器人转轴角或动作指令。

保留 expiresAt、dataPolicy 和“待复核建议”提示。needs_generation、pending、needs_data、failed、expired、withdrawn 均不把未验证正文当作可采用策略，分别提示待准备、处理中、策略包待补充数据、技术失败、过期、撤回；大脑候选失败但规则保底成功时显示策略正文、fallback 告警和待复核状态。不要写死角度，不要在新请求失败时沿用旧树卡片。

浏览器可复制 public/tree-view-client.js 到自己同源的模块目录：

```js
import { createTreeViewClient } from './tree-view-client.js';
const brain = createTreeViewClient({ baseUrl: 'http://127.0.0.1:4188' });
const manifest = await brain.readManifest();
const view = await brain.readTree({ treeId: 'T-0012', dataMode: 'mixed_demo' });
renderTreeCard(view); // 替换为你自己的界面更新函数
```

跨机配置了服务令牌时，使用 brain.setToken(临时输入的服务令牌)。取消旧请求或使用请求序号，防止快速点击后迟到响应覆盖新树；public/blender-preview.js 已有参考实现。静态图片或视频本身不能发请求，需要你的网页/三维查看器等交互程序承载。

## 3 地址和跨域

同机运行时，你的前端调用 127.0.0.1:4188。默认允许 http://localhost:5173 和 http://127.0.0.1:5173 两个 Origin。如果你的前端端口是 5174，停止旧服务后运行：

```text
node start-mh.mjs --origins http://localhost:5174,http://127.0.0.1:5174
```

Origin 是协议、主机、端口，不含页面路径。不要从 file:// 打开前端；用 HTTP 承载。HTTPS 前端调用 HTTP 后端可能被浏览器拦截，首轮使用双方可达的开发 HTTP 地址。

你在自己电脑运行此包，不需要我方电脑的服务地址。只有前端和此包服务分处两台机器时才需跨机监听；前端此时不能使用 localhost，须改为后端机器的实际局域网 IP。

Windows PowerShell 示例，先替换令牌和实际前端 Origin：

```powershell
$env:HARNESS_API_TOKEN='<你自己设置的至少24字符临时令牌>'
node start-mh.mjs --host 0.0.0.0 --origins http://<前端机器IP>:5173
```

macOS 终端示例：

```bash
export HARNESS_API_TOKEN='<你自己设置的至少24字符临时令牌>'
node start-mh.mjs --host 0.0.0.0 --origins 'http://<前端机器IP>:5173'
```

前端请求带 Authorization: Bearer <服务令牌>。准备脚本也要令牌，可在其终端设置 BRAIN_API_TOKEN，或同样设置 HARNESS_API_TOKEN。令牌只临时输入，勿写进前端分发包。只有本机无令牌启动时可以直接访问 JSON。

端口占用时可用 node start-mh.mjs --port 4190；同时把前端 baseUrl 和准备终端的 BRAIN_BASE_URL 改为 http://127.0.0.1:4190。PowerShell 用 `$env:BRAIN_BASE_URL='http://127.0.0.1:4190'`，macOS 用 `export BRAIN_BASE_URL='http://127.0.0.1:4190'`。

## 4 发回这些信息即可排查

说明你用的交互程序、前端地址及 Origin；附所点 treeId、请求 URL、HTTP 状态和返回 error.code/message、runId，以及卡片截图或控制台错误。不要发令牌。优先核对 /health、manifest、T-0012 的 view。

接口细节见 docs/04_接口与数据结构_v2.0.docx；现场步骤见 docs/07_联调与演示_v2.0.docx，其中电脑目录须改成你实际解压路径，本包启动以本 README 为准。contracts/tree-view-v1.schema.json 和 tree-view-v1.ts 是新增树接口草案，不代表已经接入运行时或完成你工程的 TypeScript 类型检查。

可运行 npm run check 和 npm test 做本地检查；默认测试不调用真实模型。完整项目源码入口仍为 src/server.js；本包 npm run start:configured 是原配置入口，首轮联调不用它，模型需另行配置和验证。

## 5 本包验证结果

2026-10-03 在解压副本上，macOS、Node.js 24.14.1 下完成：146 项自动化测试通过，JavaScript 语法检查通过，独立启动、HTTP 策略准备、重复只读查询、重启保留绑定、令牌和 CORS 共 13 项检查通过。十树得到 7 棵 available、3 棵 needs_data；未调用模型。

这次冒烟检查显式使用 --offline，验证接口链路和明确模拟回退；包内默认启动仍保留公开资料采集，但本轮未复测上游实网数据。Windows 实际执行和你的 Blender 前端点击尚待你收到后确认。具体结果见 verification/PACKAGE_VERIFICATION.json。
