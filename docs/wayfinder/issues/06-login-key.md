# 06-login-key

Type: task
Status: open
Blocked by: 01, 05

## Question

（前提已被 01 号研究修正）TypeSafe 的 key 走 pi 原生路径：扩展用 pi.registerProvider + createProvider({auth:{apiKey:{login}}}) 注册成 /login 原生 provider，key 由 pi 存入 ~/.pi/agent/auth.json（{[providerId]:{type:"api_key",key}}）。待决策：① 是否还做 /jev login 命令把 key 同步写 provider-keys.json（仅为兼容第三方 zai 管理工具的旁路记录，pi 鉴权不读它）；② 若做，两处 key 不一致时以谁为准。

## Resolution（代码侧定稿，待真人 /login 复核）

**入口**：不再自造 `/jev login`。pi 原生 `/login` 即唯一入口——扩展注册 `pi.registerProvider({id:"typesafe", auth:{apiKey:{login}}}`，`login(interaction)` 里 `prompt({type:"secret"})` 取 key，返回 `{type:"api_key", key}`（与 pi 的 `ApiKeyCredential` 定义逐字对齐），由 pi 落 `auth.json`。**不做 provider-keys.json 旁路写**：那是第三方 zai 管理工具的文件，pi 鉴权链不读，同步写只会制造第二真相源；故不存在"两处不一致以谁为准"的问题——若用户手工往里塞 key，插件不认。

**key 解析（三源，落 `src/auth.ts`）**：`readStoredCredential("typesafe")`（pi 官方凭据读取 API，非自解析 JSON）→ env `TYPESAFE_API_KEY` → missing。key 永不进配置文件（04 号票配置优先级"文件>env>默认"明确排除 key）。面板展示用路径由 `getAgentDir()` 解析，尊重 `PI_CODING_AGENT_DIR`。

**证据**：

1. `npm run build`（tsc strict）0 错；
2. 登录契约单测：注册捕获的 provider.auth.apiKey.login 收到 prompt `{"type":"secret","message":"TypeSafe API key（console.typesafe.ai → API keys）"}`，返回 `{"type":"api_key","key":"…"}`；`resolve({credential})` → `{"auth":{"apiKey":…},"source":"auth.json"}`，空凭据 → undefined；
3. RPC 探针执行 `/jev`，三种 `PI_CODING_AGENT_DIR` 隔离环境下面板分别渲染：`✗ 未配置` / `✓ env（ts-env…6789）` / `✓ auth.json（ts-fix…abcd）`——key 来源呈现按票面验收。

**待复核（真人）**：TUI 内 `/login` 选 TypeSafe 输入真 key → `auth.json` 出现该 provider 条目。管道喂 stdin 驱不动 TUI（stdin 被当聊天消息），只能人工。

—— 代码侧结题。

（2026-09-17 复检）真 pi 进程里跑 `/jev`：凭据库与 env 皆无 key 时面板渲染 `key: ✗ 未配置 —— 运行 pi login 选 TypeSafe，或设 TYPESAFE_API_KEY`，即 missing 态符合预期（auth.json/env 两态证据见上）。真人 `/login` 一步仍未发生，故本票留 open。
