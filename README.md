# 胶林大脑

胶林大脑融合版是一个橡胶林生产管理与数字孪生演示项目，包含园区与单树数据、生产计划、任务与机器人模拟、收胶加工和销售台账，以及生产助理。项目使用模拟或混合数据，三维场景与机器人动作不代表真实设备接入。

## 环境与启动

需要 Node.js 24.14.0 或更高版本。首次使用时，在项目根目录运行：

```sh
npm --prefix frontend ci
node start-fusion.mjs --demo
```

打开 <http://127.0.0.1:4298/>。`--demo` 使用离线规则演示；默认运行 `node start-fusion.mjs` 使用已配置的模型和公开资料，`--demo-data` 使用模拟资料和已配置的模型。`node start-fusion.mjs --check` 执行启动预检。端口可通过 `--frontend-port` 和 `--backend-port` 调整。

macOS 也可以运行 `启动融合主版本.command`；Windows 可以运行 `启动融合版.ps1`。

要使用模型，将 `backend/.env.example` 复制为 `backend/.env.local` 并填写自己的配置。请不要提交密钥；运行数据库、本地配置、依赖目录和构建产物均不纳入版本管理。

## 项目结构

- `frontend/`：React 前端、三维场景与静态资源。
- `backend/`：业务接口、模型调用、策略与测试。
- `shared/`：前后端共享的业务代码。
- `scripts/`：启动和验收辅助脚本。
- `start-fusion.mjs`：融合版启动入口。

## 开发检查

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix backend test
```

多人协作时建议从 `main` 新建分支，完成修改后通过 Pull Request 合并。示例数据、模型生成结果和业务建议需要结合来源及人工判断，不应直接视为现场生产结论。
