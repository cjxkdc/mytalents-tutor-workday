# MyTalents Tutor Workday

MyTalents 助教工作台的 **TypeScript / Fastify 后端**。本轮没有前端页面、CSS、主题或设计 token；后续前端使用 API 和共享契约。

导入批改结果后，后端自动校验、保存、生成三表、掌握度、错题及跟进建议，写入审计和事件。没有教师审核关卡。日报、消息、调课、日历等同学负责的业务通过独立接口接入。

## 启动

需要 Node.js 24+、pnpm 11.25.0。首次安装后，一条命令启动后端：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

默认地址 `http://127.0.0.1:3100`，本地 JSON 持久化，无需 Google 或 AI 密钥。另开终端导入合成数据：

```sh
pnpm demo:seed
curl -H "X-Demo-User: demo-teacher" http://127.0.0.1:3100/api/v1/tables/marking
curl -H "X-Demo-User: demo-student-1" http://127.0.0.1:3100/api/v1/students/demo-student-1/learning-state
```

Windows PowerShell 使用 `curl.exe`。演示身份：demo-manager、demo-teacher、demo-student-1、demo-student-2。必须显式传身份。Demo 模式只允许本机合成数据，不能连接真实 Sheets 或在 production 下启动。

## 接入文档

- [API 说明](../docs/api.md)：前端、上游 AI 批改和同学模块接入。
- [OpenAPI](../packages/contract/openapi.json)：机器可读契约，也可从 `/openapi.json` 读取。
- [共享 TypeScript 契约](../packages/contract/src/index.ts)：记录类型、推导结果和 Zod 校验。
- [架构与里程碑](../docs/architecture.md)：模块边界、规则、完成情况和待联调内容。
- [Google / AI / 通知](../docs/integrations.md)：运行时凭据、Sheets tabs、gateway、事件。
- [扫描实测](../docs/scanning-evaluation.md)：答题纸、上传和 20–30 页准确率测量。
- [合成数据](../examples/import.synthetic.json)：可运行的完整输入；不含真实学生记录。

## 检查与构建

```sh
pnpm check
pnpm openapi
pnpm start
```

`check` 依次执行类型检查、测试、编译；`start` 使用编译结果。CI 在 Linux 和 Windows 执行相同检查。Sheets 测试使用模拟 transport；扫描测试使用生成的答题纸和假 AI，不代表真实模型准确率。

Google Sheets 和真实 AI 需要单独配置运行时凭据。当前未连接真实学生表、未调用真实模型，也未完成 20–30 页真实样卷实测。

## 协作约定

- 功能分支提交 PR 到 main，不直接合并。
- 前端放独立目录，推导规则保留在后端。
- 密钥放环境变量或仓库外的凭据文件；私密数据只放被忽略的目录。
- 改接口时同步契约、OpenAPI 和示例；改规则时发布新的 Policy version。
