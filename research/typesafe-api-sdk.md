# 调研：TypeSafe API 与官方 JS/TS SDK（供 Pi-Jev 集成决策）

依据：官方文档全文快照（docs.typesafe.ai llms-full，本地缓存 /tmp/tsai-full.txt，818KB）。注：librarian 两次派发均未产出文件，本文由主 agent 直接从缓存整理。

## 结论（TL;DR）

1. **单一 HTTP 端点**：POST <https://api.typesafe.ai/v1/systemone，Authorization>: Bearer <KEY>，Content-Type: application/json。一次请求 = 一个 state + 一个 questions map；问题并行评估、互相独立、可混用三种类型。
2. **三种问题**：noul（yes/no → `noul` 概率，**无 confidence**）；choice（→ `choice` + `probabilities` 和为 1 + `confidence`）；score（→ `score` 概率加权值、可落在档位之间 + `legend` + `probabilities` + `confidence`）。
3. **官方 JS SDK：@typesafe-ai/sdk**（npm，Node ≥20，ESM+CJS+TS 类型，文档引用 v0.6.0）。类型化构造器 choice()/noul()/score()、错误类（RateLimitError/AuthenticationError/UnprocessableEntityError 等）、RetryPolicy。**推荐 SDK 而非裸 fetch**：429/529 指数退避官方建议且 SDK 默认已处理，代价仅一个依赖（pi 扩展即 Node TS）。
4. **环境变量惯例**：TYPESAFE_API_KEY（SDK 默认读取）；TYPESAFE_ENDPOINT 自定义端点（Python SDK 明确 base_url=os.environ["TYPESAFE_ENDPOINT"]；JS 侧对应 TypeSafeClientConfig，具体字段名需查包源码确认）。模型名：`jev-latest`（SDK 默认；文档示例亦见 jev-1.12）。
5. **fan-out**：把多个窄问题放进同一 questions map 一次发出（官方 "Ask a lot of questions" 模式 + Speculative Fan-Out pattern，/patterns/fan-out），无需客户端并发循环；答案用确定性规则/加权和合成（composite scoring）。

## 请求 schema

```json
{
  "state": "Help! My payouts have been failing for 3 days.",   // string | object | array
  "model": "jev-latest",
  "questions": {
    "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?",
                   "criteria": { "true": "Explicitly time-sensitive", "false": "No urgency expressed" } },
    "department": { "type": "choice", "instructions": "Which team should handle this?",
                    "criteria": { "billing": "Payments, invoicing, refunds", "technical": "Bugs, outages, integrations", "sales": null } },
    "frustration": { "type": "score", "instructions": "How frustrated is the customer?",
                     "criteria": ["Calm", "Frustrated", "Very angry"] }   // ≥2 个有序档位
  }
}
```

- state 推荐用 object（命名字段，如 {ticket, order, refund_policy}），关系清晰；string 适合单一文本；array 适合消息序列。
- criteria：noul={true,false 描述}；choice=map<选项, 描述|null>（对比式 rubric）；score=有序数组。questions 的 key 自选，不进模型，仅用于取答案。

## 响应 schema

```json
{
  "model": "jev-latest",
  "answers": {
    "is_urgent": { "type": "noul", "noul": 0.92 },
    "department": { "type": "choice", "choice": "technical",
                    "probabilities": {"billing":0.08,"technical":0.85,"sales":0.07}, "confidence": 0.82 },
    "frustration": { "type": "score", "score": 1.6, "legend": {"0":"Calm","1":"Frustrated","2":"Very angry"},
                     "probabilities": {"0":0.05,"1":0.3,"2":0.65}, "confidence": 0.78 }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

## 错误与限流

| 状态 | 含义 |
|---|---|
| 401 | key 缺失/无效 |
| 422 | 请求体校验失败（缺字段/问题畸形，body 指明字段） |
| 429 | 超限流，指数退避重试 |
| 529 | 服务过载，稍后重试 |

SDK（RateLimitError 等）默认自动退避；裸 fetch 需自实现。公开端点并发参考值约 8（早前调研，待实测校准）。

## Confidence 语义（喂 04/置信门控）

confidence 是概率分布「形状」的统计量（集中=高、平坦=低），Choice/Score 自带，**Noul 不带**。官方三段阈值法：高置信→自动执行；中置信→谨慎/确认/补信息；低置信→不行动、转人工。阈值随动作风险抬升（不同操作不同阈值）。Noul 类判断直接用原始 noul 概率定阈值。

## SDK vs fetch（JS）

```ts
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
const client = new TypeSafeClient();               // 读 TYPESAFE_API_KEY
const r = await client.systemOne({ state: {...}, questions: { category: choice("…", {billing:null, technical:null, other:null}) } });
r.answers.category.choice;                          // 类型随 questions 推断
```

SDK 源码：github.com/typesafe-ai/typesafe-sdk-js（v0.6.0）。结论：用 SDK；仅当要避免依赖时才裸 fetch（需自写重试）。

## 对后续票的输入

- 04 核心设计：client 封装用 @typesafe-ai/sdk；Noul 阈值判断无 confidence 可用。
- 06 login-key：key 从 auth.json 链取（见 01 号票），或 TYPESAFE_API_KEY env 回退。
- 07 skill-updater：官方安装 `npx skills add typesafe-ai/skills --skill typesafe-ai`；源 repo github.com/typesafe-ai/skills。

## 来源

- docs.typesafe.ai/api（端点/schema/错误）；/concepts/state；/concepts/system-one；/confidence；/patterns/fan-out；/sdk/javascript（+api 索引）
- 快照：/tmp/tsai-full.txt（llms-full，2026-09-17）
