# 04 · 核心层设计（core-design）

> 标签: wayfinder:grilling · 状态: **closed** · 阻塞: 01,02,03,05 · 被阻塞: 08

## Question

核心层怎么设计：工具面（哪几个 tool、返回形状）、/jev 命令语义、配置面（文件/env/优先级/范围）、低置信标记的数学定义。

## Resolution（已拍板）

反应原型 `prototype/core.ts`（stub client，可跑）+ `prototype/README.md`（决策表）经用户拍板通过。

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 工具返回 | 结构化 JSON（SDK answer 原样）+ 低于阈值附 `_lowConfidence: true` |
| Q2 | state 来源 | 显式参数，不自动采集会话 |
| Q3 | /jev v0.1 | 无参=状态面板；`/jev <文本>`=罐头 Noul 试一枪 |
| Q4 | 配置 | 独立配置文件 `~/.pi/agent/pi-jev.json`，缺失回退内置默认 |
| Q5 | 配置范围 | `{model, timeoutMs, maxConcurrent, lowConfidence:{choice, score, noulMargin}}` |
| Q6 | 优先级 | 配置文件显式字段 > env(PI_JEV_*) > 内置默认；**key 除外**（TYPESAFE_API_KEY / auth.json） |
| Q7 | 低置信 | choice/score: confidence<0.5；noul: |p−0.5|<0.2（均可配） |
| Q8 | 调用粒度 | 批量：questions map 以 id 为键，一次 API 请求 |

工具签名与错误码枚举（auth/validation/rate_limited/overloaded/network/timeout）见 `prototype/README.md`；实现以 `prototype/core.ts` 为基准，08-core-impl 换真 client。

—— 结题。资产：`prototype/core.ts`、`prototype/README.md`、`CONTEXT.md`（词汇表）。
