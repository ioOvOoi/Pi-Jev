# 02-typesafe-api-sdk

Type: research
Status: closed

## Question

TypeSafe API 与官方 JS/TS SDK 摸底：POST /v1/systemone 的请求/响应 schema（state、Choice/Score/Noul 字段、概率/置信度结构）、fan-out 批量问法、限流与错误码、TYPESAFE_ENDPOINT 覆盖；JS SDK 包名、依赖、Node 兼容性。产出：SDK vs 直接 fetch 的推荐 + 核心调用代码形状。来源：docs.typesafe.ai 的 api.md、sdk/javascript.md、primitives.md、patterns/fan-out.md。研究文件：research/typesafe-api-sdk.md

## Answer

研究文件 research/typesafe-api-sdk.md（librarian 两次派发均未写出文件，由主 agent 依据官方文档全文快照 /tmp/tsai-full.txt 整理）。

gist：单端点 POST <https://api.typesafe.ai/v1/systemone（Bearer）；请求> {state: string|object|array, model:"jev-latest", questions:{[id]:{type:noul|choice|score, instructions, criteria}}}，一次并行多问、可混型、fan-out 无需客户端循环；响应 {model, answers:{[id]:…}, usage}；Choice/Score 带 confidence（分布形状统计值），Noul 无（用原始概率阈值）；错误 401/422/429/529，429/529 指数退避（SDK 默认已处理）；官方 JS SDK @typesafe-ai/sdk（npm，Node≥20，ESM/CJS/TS，helpers choice/noul/score，RateLimitError/RetryPolicy）→ 推荐用 SDK 而非裸 fetch；env 惯例 TYPESAFE_API_KEY（+TYPESAFE_ENDPOINT 自定义端点，JS 侧字段待查 TypeSafeClientConfig）。
