# 04-core-design 反应原型

拍板对象：`prototype/core.ts`（stub client，不联网、`npx tsx prototype/core.ts` 可跑）。

## 已定决策（grilling R1-R3）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 工具返回 | 结构化 JSON（SDK answer 原样）+ 低于阈值附 `_lowConfidence: true` |
| Q2 | state 来源 | 显式参数，调用方给什么评什么；不自动采集会话 |
| Q3 | /jev v0.1 | 无参=状态面板（key/模型/阈值/配置来源）；`/jev <文本>`=罐头 Noul 试一枪验证链路 |
| Q4 | 配置 | 独立配置文件 `~/.pi/agent/pi-jev.json`，缺失回退内置默认 |
| Q5 | 配置范围 | `{model, timeoutMs, maxConcurrent, lowConfidence:{choice, score, noulMargin}}` |
| Q6 | 优先级 | 配置文件显式字段 > env(PI_JEV_*) > 内置默认；**key 除外**（TYPESAFE_API_KEY / auth.json，不进配置） |
| Q7 | 低置信定义 | choice/score：confidence<0.5；noul：\|p−0.5\|<0.2（都可配） |
| Q8 | 调用粒度 | **批量**：每次调用带 questions map（对齐 SDK，一次 API 请求）；agent 按 id 取答案 |

## 工具签名（拍板重点）

```
jev_noul   { state, questions: { [id]: { question, trueMeans?, falseMeans? } } }
jev_choice { state, questions: { [id]: { question, options: { [option]: 描述|null } } } }
jev_score  { state, questions: { [id]: { question, levels: string[] /* ≥2 */ } } }

成功 → { answers: { [id]: <noul|choice|score 答案 + _lowConfidence?> }, usage }
失败 → { error: { code: auth|validation|rate_limited|overloaded|network|timeout, message, hint? } }
```

## 反应点

1. 批量签名形状（questions map 以 id 为键）顺不顺手？
2. /jev 面板字段够不够？
3. 错误码枚举要不要增减？
4. `_keySource` 这类诊断字段要不要留？

拍板通过后：08-core-impl 按 `prototype/core.ts` 换真 client（@typesafe-ai/sdk）实现。
