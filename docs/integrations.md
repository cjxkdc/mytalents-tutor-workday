# 存储、AI 和通知适配

## Google Sheets

运行时服务使用自己的 Google 凭据，不依赖 Codex 连接器或浏览器登录状态。

1. 在团队 Google Cloud 项目启用 Sheets API，创建最小权限服务账号。
2. 新建专用工作簿，把它以 Editor 权限共享给该服务账号；不要给整个 Drive 授权。
3. 把凭据 JSON 放在仓库外，设置 GOOGLE_APPLICATION_CREDENTIALS 为绝对路径；部署环境也可使用 Google Application Default Credentials。
4. 复制 `.env.example` 为 `.env`，设置 REPOSITORY=sheets、GOOGLE_SPREADSHEET_ID、AUTH_MODE=token 和 API_KEYS_JSON。token 配置格式见示例，使用独立随机长 token。
5. 用服务端 manager 身份导入一次标准 JSON，调用三表 GET 验证，再在 Google Sheets 检查投影。

应用只使用 Sheets scope。源数据与三表位于同一工作簿；已有非 MT_ tab 保留。初始化时若发现同名保留 tab 但没有有效 MT_Meta 标记会拒绝，不覆盖。

| Tab | 数据 |
| --- | --- |
| MT_Meta | owner、schemaVersion、revision、activePolicy |
| MT_students / MT_knowledgePoints / MT_exams | 学生及课程源记录 |
| MT_attempts / MT_masteryObservations | 批改与明确掌握度观察 |
| MT_activities / MT_resources | 日报事实、补充资源 |
| MT_policies / MT_imports | 规则版本和幂等回执 |
| MT_audit / MT_outbox / MT_scanJobs | 审计、通知事件、扫描状态 |
| MT_Marking / MT_Progress / MT_ExamStatistics | 可读的三表投影 |

源 tab 是 id + JSON 两列；三表逐列展开，可通过 `/api/v1/sheets-schema` 取得列名。写入显式使用 stringValue/numberValue，文本不被当公式执行。source、policyVersion、evidence 支持追溯。

Google [batchUpdate 文档](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate) 保证同一请求的更新一起应用。适配器把源记录、回执和三表写成一笔 batch。提交后响应丢失时，下一次重试会重新读取幂等回执，避免重复计数。网络失败不会伪装成同步成功。

要求一个后端写入进程，不直接手改 app-owned tab；Sheets 没有跨进程 CAS。超过单批大小/单格限制会拒绝，不能静默截断。当前模拟 transport 测试覆盖成功、失败、响应丢失、保留无关 tab；真实账号集成尚待配置。

## 原表、外部 AI、其他平台

统一入口是 ImportBatch。接入方负责把自己的列名、学生 ID、试卷/题号和来源版本映射为 contracts 中的字段；不凭姓名猜匹配。Marking → attempts；Progress → masteryObservations；Exam Statistics → 有逐题依据的 attempts，或后续专用历史统计适配器。仅有总分的历史表不足以生成逐题记录，不能虚构题目结果。

新的数据库实现 Repository 接口即可替换存储；新导入器产出相同 ImportBatch；Google Drive、其他文件存储实现 ArtifactStorage。当前没有通用旧表自动识别、Drive 上传实现或多个工作簿全局事务。

## AI gateway 契约

配置 AI_GATEWAY_URL（HTTPS base URL）、AI_GATEWAY_TOKEN 后启用。默认 UnconfiguredAi 明确拒绝请求。你可以直接实现 AiProvider 替换 gateway，不影响推导和前端。

POST `<base>/recognize`：

```json
{"schemaVersion":"1.0","instruction":"...","input":{"questionId":"q1","mimeType":"image/png","imageBase64":"..."}}
```

响应：`{"text":"x = 3","confidence":0.95}`。

POST `<base>/grade`：

```json
{"schemaVersion":"1.0","instruction":"...","input":{"question":{"id":"q1","knowledgePointIds":["linear"],"maxScore":2,"prompt":"2x = 6","rubric":"x = 3 earns 2 points"},"transcript":"x = 3"}}
```

响应：`{"outcome":"DONE","score":2,"feedback":"Correct","confidence":0.95}`。

两个调用都用 Bearer token，超时 30 秒，不跟随重定向。第一步忠实转写，第二步依据 rubric 评分；图片/答案文本只能作为数据，不能当系统指令。响应通过 Zod、置信度、题目满分等校验后才导入。错误不返回模型密钥或原始供应商响应。confidence 是模型自报值，不代表校准后的正确率，仍需样卷实测。

## 通知与同学模块

ImportService 在同一事务追加 DomainEvent，通知模块读取 `/api/v1/events` 并实现 NotificationAdapter。按 event.id 去重、保存 delivery 状态；企业微信 Webhook 及中文消息 prompt 属于同学模块，本轮没有发送外部消息。ArtifactStorage 是供后续 Drive 上传实现的接口，当前扫描原图不持久保存。
