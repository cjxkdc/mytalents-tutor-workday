# 后端架构与交接

依据 [AI Hackathon 文档](https://docs.google.com/document/d/19RpMFU-j86brJ3cA5dcMfT1mIn_Puz1thXAOfNRPAec/edit?tab=t.0) 末尾的 milestone、分工表和最新“只做后端”要求。

## 分工落点

| 范围 | 本轮实现 | 待联调内容 |
| --- | --- | --- |
| M0 | TypeScript 后端、启动、环境配置、Windows/Linux CI | 前端独立接入 |
| M1 | 领域类型；memory/local JSON/Sheets repository；审计；不可变 Policy version | 真实 Sheets 凭据和专用工作簿 |
| M2 | 三表/掌握度纯函数、权限、REST API、OpenAPI | 三角色前端页面 |
| M3 | 提交批改即自动生成三表；原子批写适配器 | 真实 Sheets 演示；当前测试使用模拟 transport |
| M4 | SVG 答题纸/QR、PNG/JPEG 裁剪、两阶段 AI gateway、扫描任务、准确率工具 | 真实模型和 20–30 页样卷实测；通用照片纠偏/PDF 处理未实现 |
| M5 后端 | 本人扫描上传、进度/考试/错题 API | 学生 Portal、Drive 文件存储适配器 |
| M6/M7/M8 | Activity 契约、报告证据 API、事件 outbox、通知接口 | 同学实现消息、调课、日报组装/签字、周报、日历/答疑、学生管理 CRUD、企业微信发送 |

扫描置信度不足或输入不合法时自动失败，返回可重试的错误；没有等待教师批准的状态。经理签日报属于同学的独立流程，不阻塞导入。

## 目录边界

```text
packages/contract/src/   共用类型、Zod 输入契约
backend/src/auth/         身份和学生范围权限
backend/src/domain/       纯推导、引用校验、State、错误
backend/src/services/     导入事务、扫描编排、报告事实
backend/src/repositories/ memory / local / Google Sheets
backend/src/scanning/     答题纸、二维码、裁剪、评估
backend/src/integrations/ AI、通知、文件存储端口
backend/src/http/         路由、错误响应、OpenAPI
backend/test/             行为和故障恢复测试
scripts/                  示例导入、契约导出、准确率测量
```

依赖方向 HTTP → service → domain/repository/provider。domain 不调用网络、时钟、AI 或 UI。改掌握度只需修改 derive 和 Policy；换存储只替换 repository；换 AI 只替换 provider。

## 数据规则

1. 使用稳定业务 ID，不能只用姓名。一次真实考试一个 attempt.id；重考用新 ID。更正原结果保留 ID 并提高 revision。
2. source + batchId 为幂等键。同键相同规范化 JSON 返回已有回执，不同内容返回 409。数组顺序属于请求内容，重试保持原顺序。
3. 低版本被拒绝，同版本不同内容被拒绝；全部校验通过才一次提交。失败不留半份三表或半笔审计。
4. 每题显式提供 DONE/W/C/BLANK。缺题是错误，不能默认为没做。DONE 满分、BLANK 零分、W/C 低于满分并支持部分分。
5. 已有考试记录的试卷定义冻结。改题目、满分或 rubric 必须新建 exam ID，避免改写历史。
6. 考试统计保存每次尝试；掌握度和建议使用每份试卷最近一次完成的尝试。按 completedAt 排序，同时间按 ID。更正不增加重考次数。
7. 掌握度阈值带版本，默认至少 2 道已作答证据。证据不足返回 mastery=null。BLANK 不证明“未学”；只有明确 observation 才能给出 not_covered。observation 的 assessedAt 不早于批改证据时优先。
8. C 生成检查建议，W 生成概念复习，BLANK 生成补做建议。只有粗心错误不会推断为“不懂”。这些是可解释规则输出，不冒充生成式 AI。
9. 推导结果含 evidence/policyVersion，批改含 source/importId。成功导入、Policy 激活、扫描完成/失败均有审计。

## 权限

- manager 访问全部学生，维护共享试卷/知识点/资源，激活规则，读审计。
- teacher 只读写分配给他的 studentIds；不能改共享课程，但可重复传入完全相同的课程快照。
- student 只读本人数据和上传本人扫描，不能发布成绩、改规则、读审计、取 rubric，也不能用扫描覆盖已记录考试。
- 本机 Demo 使用明确测试身份；真实环境使用服务器配置的 Bearer token。Authenticator 可替换为团队登录的 JWT/OIDC 校验器；当前没有密码登录、SSO 或浏览器 session。

## 运行边界

单实例 hackathon 后端。local repository 用锁文件排除第二写入进程，临时文件同步写完再重命名。正常退出释放锁；异常退出的残留锁，需先确认原进程已结束，再由操作者删除对应 `.lock`。

Sheets 每次事务重读源记录，用一个 spreadsheets.batchUpdate 提交源记录和三表。没有跨进程 compare-and-swap：部署副本数必须为 1，同学模块通过 API 写入，不要手动编辑 app-owned tabs。单批超过 1.8 MB 明确失败，扩容时替换数据库 repository。原子批写仅覆盖一个工作簿，不保证多个工作簿的全局事务。

扫描最多并发 2 个 job，原图仅存在进程内存，任务状态持久化。进程重启后未完成任务标记失败，需要重交原 job 和图片。未来可用 ArtifactStorage 接口和队列持久保存文件。

列表返回 offset cursor 和 stateRevision，跨页时 revision 变化应重新读取。事件消费者按 event.id 去重，保存自己的通知发送状态。
