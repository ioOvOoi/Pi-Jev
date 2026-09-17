# 03-permission-system-api

Type: research
Status: closed

## Question

@gotgenes/pi-permission-system 扩展的钩子点摸底：权限判定流程在哪、能否插入异步外部判断（Jev Noul「该操作危险吗」）、配置形态。源码：C:/Users/Administrator/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system。产出：可行接入点 + 最小集成代码形状；不可行则给替代（插件自身在工具调用前拦截）。研究文件：research/permission-system-api.md

## Answer

可行，且有 first-class 接入点：**Authorizer Chain**——扩展调 getPermissionsService(sessionId).registerAuthorizer("jev-noul", authorize)，用户 config.json 写 "authorizerChain": ["jev-noul"] 激活。

签名原生异步：authorize(details, query, log): Promise<{kind:"allow"} | {kind:"deny", reason?} | {kind:"defer"}>（dist/public.d.ts:454-456,437-443）；details 含 toolName/command/path/surface/toolInputPreview 等（:373-410）。Jev Noul 的 REST 调用直接在回调里 await，按概率阈值映射 verdict。

约束：① 仅当确定性策略落到 "ask" 才触发（要 Jev 评审的 surface 须在 config 设 "ask"，如 "bash":{"*":"ask"}）；② 权限封顶——链所有者会把 external_directory/path 族已 allow 的降为 defer，Jev 无法越权放行（deny/defer 不受限）；③ 注册挂 permissions:ready（每 session ≥1 次且可能重复），handler 必须幂等（disposer 判重）。

备选钩子：pi 官方 pi.on("tool_call", async (event, ctx) => ({block:true, reason}))（docs/extensions.md:70-74），同样支持异步。

详情：research/permission-system-api.md
