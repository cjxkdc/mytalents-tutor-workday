# API 接入说明

Base URL：`http://127.0.0.1:3100`。机器契约 `GET /openapi.json`；类型见 [共享契约](../packages/contracts/src/index.ts)。所有示例使用合成数据。

## 认证与错误

本机 Demo：`X-Demo-User: demo-manager|demo-teacher|demo-student-1|demo-student-2`。真实环境：`Authorization: Bearer <server-issued-token>`。角色和学生范围由服务器配置，不接受客户端自报权限。不要把 manager/service token 放入前端包；团队正式登录通过 Authenticator 接入。

```json
{"error":{"code":"REVISION_CONFLICT","message":"Changed record requires a higher revision","requestId":"req-1"}}
```

422 为字段/业务校验错误；字段错误附 issues 数组。401 未认证，403 越权，404 未找到，409 幂等/版本冲突，413 过大，429 扫描繁忙，502/503 外部服务不可用。响应均 no-store。

## 导入与更正

`POST /api/v1/imports`，body 为 ImportBatch。新导入 201，相同请求重试 200。前端读取 JSON 文件后直接发送 JSON；CSV/旧表头/外部 AI 应先映射为标准契约。

```json
{
  "schemaVersion":"1.0", "source":"external-marker", "batchId":"upload-1001",
  "attempts":[{
    "id":"attempt-1001", "revision":1, "studentId":"demo-student-1", "examId":"algebra-test-1",
    "completedAt":"2026-10-13T15:00:00+11:00", "markedAt":"2026-10-13T15:30:00+11:00",
    "marks":[
      {"questionId":"q1","outcome":"DONE","score":2},
      {"questionId":"q2","outcome":"W","score":0},
      {"questionId":"q3","outcome":"C","score":1},
      {"questionId":"q4","outcome":"BLANK","score":0}
    ]
  }]
}
```

先 `pnpm demo:seed` 建立本例引用的实体；首次也可由 manager 在一个批次提交全部实体。完整例子见 [import.synthetic.json](../examples/import.synthetic.json)。可选数组：students、knowledgePoints、exams、attempts、masteryObservations、activities、resources。未传数组为空；ai-scan 来源保留给扫描服务。

成功回执包含 id（source/batchId）、source、batchId、hash、createdBy、status、completedAt、changedRecords、studentIds、policyVersion、replayed。成功表示源记录、三表、审计已存入所选 repository；local 模式不写 Google。`GET /api/v1/imports/{source}/{batchId}` 查回执。

更正：新 batchId、原 attempt.id、revision+1、完整 marks。重考：新 attempt.id、revision=1。网络超时/503 后先重发**相同 body 和 batchId**。校验后自动执行全部后续操作，没有 approve/confirm 请求。

## 读取接口

列表参数 `?cursor=0&limit=100`，limit 最大 500，响应 `{items,total,nextCursor,stateRevision}`。nextCursor=null 为结束；读取期间 revision 变化应从头获取。

| 请求 | 返回/用途 | 角色 |
| --- | --- | --- |
| GET `/api/v1/me` | 当前 Principal | 全部 |
| GET `/api/v1/students` | 权限内学生快照 | 全部 |
| GET `/api/v1/exams` | 试卷；学生响应剔除 rubric | 全部 |
| GET `/api/v1/knowledge-points` | 共享知识点 | 全部 |
| GET `/api/v1/resources` | 补充练习资源 | 全部 |
| GET `/api/v1/tables/marking` | MarkingRow 批改记录 | 按学生授权过滤 |
| GET `/api/v1/tables/progress` | ProgressRow 掌握度 | 同上 |
| GET `/api/v1/tables/examStatistics` | ExamStatisticsRow 每次考试统计 | 同上 |
| GET `/api/v1/students/{studentId}/learning-state` | student/progress/exams/followUps/resources/policyVersion/stateRevision | 该学生/授权员工 |
| GET `/api/v1/students/{studentId}/mistakes` | 历次 W/C/BLANK，含证据 | 同上 |
| GET `/api/v1/policies` | activeVersion 和 items | 员工 |
| POST `/api/v1/policies` | 激活不可变新 Policy 并重算 | manager |
| GET `/api/v1/audit` | actorId/action/recordIds/importId/policyVersion | manager |
| GET `/api/v1/events` | 通知 outbox | 员工，学生范围过滤 |
| GET `/api/v1/sheets-schema` | schemaVersion 和 tables 的 name/columns | 员工 |

三表支持额外 studentId 查询。mastery=null 显示“资料不足”，不能映射为“未学”。band=high/medium/low 为语义值，颜色留给前端。后端没有样式。

## 给同学的日报、消息、日历接口

通过导入接口的 activities 提交真实出勤、已完成答疑、已完成家长反馈，用业务来源 ID/revision 去重。

```json
{
  "schemaVersion":"1.0","source":"calendar-module","batchId":"qa-42-v1",
  "activities":[{"id":"qa-42","revision":1,"studentId":"demo-student-1","kind":"qa_completed","questionCount":3,"occurredAt":"2026-10-13T16:00:00+11:00"}]
}
```

attendance 要求 mode=onsite|online；parent_feedback_completed 要求 referenceId 指向已完成反馈。草稿和预约不可记成 completed。

`GET /api/v1/report-facts?date=2026-10-13` 返回 Sydney 日期的 markedAttempts、completedAssessments、activities，以及当前 followUps、coverage。元素均有记录 ID。日报模块按 studentId 去重到校人数/答疑人数，汇总题数，按 attempt ID 数批改份数，按 completedAssessments.kind 区分 SAC/Practice SAC。coverage 只说明已导入记录，空列表不能证明当天实际为零。经理签名由日报模块基于认证身份显式保存。

outbox 事件含 id/at/type/referenceId/studentIds/policyVersion。消费端按 id 去重，保存发送状态后推进 cursor。本轮核心不调用企业微信。

## 扫描

详见 [扫描流程](scanning-evaluation.md)。POST `/api/v1/answer-sheets` 返回 printable SVG；POST `/api/v1/scan-jobs` 接受 base64 PNG/JPEG、返回 202；GET `/api/v1/scan-jobs/{jobId}` 返回 queued/processing/completed/failed。未配置 AI 时返回 503，不生成假成绩。
