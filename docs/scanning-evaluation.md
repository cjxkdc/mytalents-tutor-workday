# 扫描流程和准确率实测

## 自动流程

1. manager 导入试卷与 rubric，学生已存在。
2. `POST /api/v1/answer-sheets` body：`{"studentId":"demo-student-1","examId":"algebra-test-1","attemptId":"scan-attempt-1"}`。返回每页 SVG、二维码身份和裁剪区域。SVG 是可打印答题纸；不包含网站 UI。
3. 学生在对应编号区域作答，取得完整、平整、竖直的 PNG/JPEG 页面。最多 16 题、每页 4 题。通用手机照片透视矫正、PDF 输入尚未实现。
4. `POST /api/v1/scan-jobs`：

```json
{
  "jobId":"scan-job-1","studentId":"demo-student-1","examId":"algebra-test-1",
  "attemptId":"scan-attempt-1","revision":1,"completedAt":"2026-10-13T15:00:00+11:00",
  "pages":[{"pageNumber":1,"imageBase64":"plain-base64-without-data-url-prefix"}]
}
```

202 后轮询 job URL。每页必须一次齐全，二维码须匹配学生、试卷版本、attempt、页号，校验页面位置后裁剪。识别和评分分两步；每一步都校验置信度，所有结果通过规则后自动导入三表，不存在老师审核状态。

job 返回 status、tries、policyVersion、examRevision、importId 或 error。failed 后可以重发相同内容和 jobId；更换图片则用新 jobId。学生不能覆盖已有考试；员工更正用新 jobId、同 attemptId、更高 revision。试卷变更要生成新的答题纸。

原图只在内存，不写入审计/日志/Sheets；学生答案和反馈会作为成绩证据存储。重启时未完成任务变 failed，需重新上传。当前并发最多 2 个任务，繁忙返回 429。

## 20–30 页实测

准备 20–30 页获得适当授权且去标识化的真实样卷，覆盖 DONE/W/C/BLANK、部分分、清晰度和字迹差异。先独立制作 ground truth，再调用已配置模型，避免用模型自身答案当标准答案。

把人工答案与真实模型输出分别保存为同结构 JSON，pageId 和 questionId 一一对应：

```json
{
  "datasetId":"pilot-01","kind":"real_scans",
  "items":[{"pageId":"page-01","questionId":"q1","outcome":"DONE","score":2,"transcript":"x = 3"}]
}
```

```sh
pnpm evaluate data/private/gold.json data/private/predictions.json
```

报告含页数、题数、结果分类准确率、分数完全正确率、匹配题的平均绝对分差、转写完全匹配率和差异题 ID。漏掉的预测在准确率中算失败，不能通过少交困难样例提高结果；MAE 单独明确仅在已有预测上计算。重复 ID 或未知预测题会被拒绝。

milestoneSampleSizeMet 只检查 real_scans 标签和 20–30 页规模，不保证样本代表性或模型可靠性。合成数据必须用 kind=synthetic；即使满分也不满足真实样卷 milestone。

本仓库测试验证二维码、裁剪、编排和错误处理，使用合成页面与 mock AI。**目前没有真实模型准确率数字，也没有完成 M4 实测验收。**
