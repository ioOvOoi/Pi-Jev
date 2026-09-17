# 调研：pi 扩展能否把自定义 provider「TypeSafe」注册进 /login 并落 key 到 provider-keys.json

日期：调查基于 pi-coding-agent **v0.85.1**（本机安装版本）。

## 一、结论（TL;DR）

1. **可以注册 provider 出现在 /login**：用 `pi.registerProvider(id, config)`；若要自定义登录交互，用 `createProvider({ auth: { apiKey: { login(interaction) {...} } } })`。登录取得的 key 会被 pi 存入 **auth.json**（`~/.pi/agent/auth.json`，格式 `{ [providerId]: { type: "api_key", key } }`），**不是 provider-keys.json**。
2. **provider-keys.json 不是 pi 的文件**：pi 0.85.1 的 dist 全量检索 0 处引用；本机所有已装扩展（pi-ollama-cloud / pi-freerouter / pi-commandcode-provider / pi-env / pi-openviking 等）源码也 0 处引用。其结构 `{[providerId]:{activeKeyName,keys:[{name,apiKey}]}}` 由**外部第三方工具**写入（同目录存在 `provider-keys.json.bak-zai-2026-09-16103931`、`models-store.json.bak-zai-...` 备份，指向某个 "zai" 系管理工具）。
3. **即使 TypeSafe key 被写进 provider-keys.json，pi 也不会用它鉴权**。pi 的凭证链是：runtime 覆盖 → `apiKey: "$ENV"` 配置 → auth.json（FileAuthStorageBackend，见 pi dist core/auth-storage.js:17,284）。所以「落 provider-keys.json」只能靠 /jev login 之类的自定义命令直写 JSON，属纯记录用途。

## 二、证据链

- `docs/custom-provider.md`：`pi.registerProvider()` 完整文档，含 `auth.apiKey.login(interaction) → { type:"api_key", key }` 与 `resolve({credential})` 骨架；`apiKey: "$MY_API_KEY"` 支持 `$ENV` / `!command` / `${ENV}` 语法。
- `pi-ollama-cloud/index.ts`（默认导出）：`pi.registerProvider("ollama-cloud", { name, baseUrl, apiKey:"$OLLAMA_API_KEY", api:"openai-completions", models, refreshModels })`；README 明确 key 放 **auth.json**。
- `pi-ollama-cloud/utils.ts` → getCloudApiKey：走 `ctx.modelRegistry.getApiKeyForProvider("ollama-cloud")`（auth.json 链）+ env 回退，**不读 provider-keys.json**。
- pi dist `core/auth-storage.js`：`FileAuthStorageBackend(normalizedAuthPath)`；`config.js:436-438` `getAuthJsonPath() = join(getAgentDir(), "auth.json")`；migrations.js 把旧 apiKey 迁往 auth.json。dist 内搜索 "provider-keys"/"activeKeyName" 均 0 命中。
- 本机 `~/.pi/agent/provider-keys.json` 实测存在，含 opencode-go / xiaomi-token-plan-cn / pateway / ollama-cloud 条目——ollama-cloud 的 key 同时也在 auth.json 链生效，说明 provider-keys.json 是旁路记录，非 pi 数据源。
- grep 工具注：本会话 pi-fff 搜索扩展有 spiral 保护，部分全目录模式搜索被拦，已用分目录搜索补齐；pi-ollama-cloud 包确实存在于 npm node_modules（settings.json packages 含 "npm:pi-ollama-cloud"）。

## 三、可行路径

### 路径 A（pi 原生，key 落 auth.json —— 推荐）

若 TypeSafe 最终仍要通过 pi 发模型请求，走标准注册：

```ts
import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createProvider({
    id: "typesafe",
    name: "TypeSafe",
    baseUrl: "https://typesafe.example/v1",
    auth: {
      apiKey: {
        name: "TypeSafe API key",
        async login(interaction) {
          return { type: "api_key", key: await interaction.prompt({ type: "secret", message: "TypeSafe API key" }) };
        },
        async resolve({ credential }) {
          return credential?.key ? { auth: { apiKey: credential.key }, source: "stored API key" } : undefined;
        },
      },
    },
    models: [ /* 至少一个模型定义，否则 /model 不可选 */ ],
    api: openAICompletionsApi(),
  }));
}
```

注意：registerProvider 的目标是**聊天模型 streaming API**（anthropic-messages / openai-completions / …）。TypeSafe 是非聊天 REST 决策 API，没有对应 `api` 实现，pi 不会替你调用它；注册仅解决「出现在 /login、key 托管」这一层。

### 路径 B（/jev login 自管 provider-keys.json —— 满足原需求的唯一路径）

pi 不认识 provider-keys.json，所以只能自写命令直写该文件：

```ts
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

pi.registerCommand("jev-login", {
  description: "保存 TypeSafe key 到 provider-keys.json",
  handler: async (_args, ctx) => {
    const apiKey = await ctx.ui.prompt({ type: "secret", message: "TypeSafe API key" });
    const file = join(ctx.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(process.env.USERPROFILE!, ".pi", "agent"), "provider-keys.json");
    let data: any = {};
    try { data = JSON.parse(readFileSync(file, "utf8")); } catch { /* 首次创建 */ }
    data["typesafe"] = { activeKeyName: "密钥 1", keys: [{ name: "密钥 1", apiKey }] };
    writeFileSync(file, JSON.stringify(data, null, 2));
    ctx.ui.notify("TypeSafe key 已写入 provider-keys.json", "info");
  },
});
```

注意：`ctx.ui.prompt` 的确切签名需按当前版本 ExtensionContext 校对（ollama-cloud 用的是 `ctx.ui.notify` / `ctx.ui.setStatus`；secret 输入在 custom-provider.md 里对应 login(interaction) 的 `interaction.prompt({type:"secret"})`）。若拿不到交互 prompt，可用 `!command` 配置语法从环境/命令注入。

### 建议

- 若目的只是「key 托管 + /login 可见」→ 路径 A，接受 key 落 auth.json 而非 provider-keys.json。
- 若硬性要求落 provider-keys.json（供外部 zai 系工具消费）→ 路径 B，并同时在 pi 侧用 `apiKey: "$TYPESAFE_API_KEY"` 或 auth.json 保证 pi 自身能用上 key。
- 两者可叠加：A 管 pi 鉴权，B 管外部共享。
