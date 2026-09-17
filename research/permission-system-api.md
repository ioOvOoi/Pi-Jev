# Jev Noul 危险判断 × @gotgenes/pi-permission-system 接入点摸底

## 结论（先行）

**可行，且有一等公民接入点：Authorizer Chain（authorizerChain + registerAuthorizer）。**
扩展官方预留了「外部决策者」缝隙：当某次请求的确定性策略落到 `ask` 时，会按配置顺序调用注册的 authorizer 链；链接回调签名是
`authorize(details, query, log): Promise<AuthorizerVerdict>` —— **原生异步**，Jev Noul 的 REST 调用（返回 yes 概率）可直接在回调里 await，按阈值映射为 `allow` / `deny` / `defer`。

关键约束：
1. **只在 `ask` 状态触发**——必须在 config.json 里把要 Jev 评审的 surface 设为 `"ask"`（如 `"bash": {"*": "ask"}`），`allow`/`deny` 不会走链。
2. **opt-in 激活**——仅注册不生效，须在 config.json 写 `"authorizerChain": ["jev-noul"]`。
3. **权限封顶**——链所有者会把 link 在 `external_directory`/`path` 表面族的 `allow` 降级为 `defer`，Jev 无法越权放行目录外访问（deny/defer 不受限）。
4. 注册挂在 `permissions:ready`（每 session 至少一次、可能重复，handler 必须幂等，用 disposer 判重）。

## 证据（路径:行）

- README（authorizerChain 机制总述）：`@gotgenes/pi-permission-system/README.md`，"The optional `authorizerChain` field … registers a link via `getPermissionsService(sessionId).registerAuthorizer(name, authorize)`"
- 文档（触发时机=ask、链序=配置序、封顶不变量）：`docs/configuration.md:212-256`
- 文档（注册范式、幂等、ready 事件契约）：`docs/cross-extension-api.md` Ready Event 段
- 类型定义（异步签名）：`dist/public.d.ts:454-456` — `authorize(...): Promise<AuthorizerVerdict>`
- 判决类型：`dist/public.d.ts:437-443` — `{ kind: "allow" } | { kind: "deny"; reason?: string } | { kind: "defer" }`
- 回调入参：`dist/public.d.ts:373-410` `PromptPermissionDetails`（requestId / toolName / command / path / surface / value / toolInputPreview / payload 等）
- 决议广播：`docs/cross-extension-api.md` Resolution 表 — `authorizer_allowed` / `authorizer_denied`，可观测
- pi 官方备选钩子：`docs/extensions.md:70-74` — `pi.on("tool_call", async (event, ctx) => … return { block: true, reason })`，同样支持异步

## 最小集成代码形状

新建扩展（如 `~/.pi/agent/extensions/pi-jev-noul/index.ts`）：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const JEV_URL = "http://127.0.0.1:8000/judge"; // 返回 { probability: number }

async function askJev(value: string, toolName?: string): Promise<"yes" | "no" | "unknown"> {
  try {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: toolName ?? "", value }),
      signal: AbortSignal.timeout(5000), // REST 挂了别卡死权限流
    });
    const { probability } = await res.json();
    return probability >= 0.9 ? "no" : probability >= 0.5 ? "yes" : "unknown";
  } catch {
    return "unknown";
  }
}

export default function (pi: ExtensionAPI) {
  let dispose: (() => void) | undefined;

  pi.events.on("permissions:ready", (data: any) => {
    const { sessionId } = data;
    if (dispose || !sessionId) return;          // ready 可能重复，幂等
    void (async () => {
      const { getPermissionsService } = await import("@gotgenes/pi-permission-system");
      const perms = getPermissionsService(sessionId);
      if (!perms) return;
      dispose = perms.registerAuthorizer("jev-noul", async (details, _query, log) => {
        const value = details.command ?? details.path ?? details.value ?? "";
        const verdict = await askJev(value, details.toolName);
        log.review("jev_noul", { value, verdict });
        if (verdict === "no")  return { kind: "deny", reason: "Jev Noul 判定为危险操作" };
        if (verdict === "yes") return { kind: "allow" };
        return { kind: "defer" };               // REST 失败/低置信 → 交还下一环或人工
      });
    })();
  });

  pi.on("session_shutdown", () => { dispose?.(); dispose = undefined; });
}
```

config.json（`~/.pi/agent/extensions/pi-permission-system/config.json`）：

```jsonc
{
  "permission": {
    "*": "ask"          // 或至少把要 Jev 评审的 surface 设为 ask
  },
  "authorizerChain": ["jev-noul"]
}
```

## 备选方案（若不走 permission-system）

pi 原生 `pi.on("tool_call", ...)`（extensions.md:70）：回调可 async，返回 `{ block: true, reason }` 即拦截。
代价：绕过 permission-system 的规则引擎/审计日志/会话批准，且与 ask 弹窗并存时序不明确 —— **仅当 Jev 需要在 allow/deny 状态也插手（permission-system 做不到）时才选它**；默认选 authorizerChain。
