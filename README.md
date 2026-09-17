# Pi-Jev

把 [TypeSafe](https://console.typesafe.ai) 的 **Jev（System One）** 决策模型接进 pi：三个类型化决策工具、`/jev` 面板、官方 skill 自动安装与更新，以及让 Noul 在权限链上把关。

术语与语义见 [CONTEXT.md](CONTEXT.md)；架构决策见 [docs/wayfinder/map.md](docs/wayfinder/map.md)。

## 安装

```bash
pi install /absolute/path/to/Pi-Jev       # 本地路径
pi install git:github.com/ioOvOoi/Pi-Jev  # 或 git 源
```

装完 pi 启动时加载 `src/index.ts`（`package.json` 的 `pi.extensions`）。

## 凭证

key 走 pi 原生凭证链，**永不进配置文件**：

1. `/login` → 选 **TypeSafe (Jev)** → 贴 API key；pi 落到 `~/.pi/agent/auth.json`
2. 或设环境变量 `TYPESAFE_API_KEY`

`/jev` 面板首行显示当前 key 来源（`auth.json` / `env` / `missing`）。

## 三个工具

| 工具 | 语义 | 返回 |
|---|---|---|
| `jev_noul` | 是否题，返回 yes 概率 | `{ answers: { [id]: { type, noul, _lowConfidence? } }, usage }` |
| `jev_choice` | 在选项集（≥2）中选一 | `{ answers: { [id]: { type, choice, probabilities, confidence, _lowConfidence? } }, usage }` |
| `jev_score` | 沿有序档位打分 | 同上，`score` 替代 `choice` |

- 每个工具都是**批量**：`state`（string/object/array，必须显式传入，插件不自动读会话）+ `questions`（`{ [id]: {...} }`），答案按同一 id 返回。
- `_lowConfidence`：choice/score 看 `confidence`（默认 < 0.5）；noul 看概率是否落在 `0.5 ± noulMargin`（默认 0.2）。只是提示，不改答案。
- 失败不抛异常，返回 `{ error: { code, message, hint? } }` 包络。

## 命令

- `/jev` —— 状态面板（key 来源、模型、端点、权限链、skill 状态）
- `/jev <文本>` —— 试一枪：对这段文本跑一次 Noul
- `/jev-skill` —— skill 状态；`/jev-skill check` 查更新；`/jev-skill update` 强制同步

### 官方 skill

插件把 TypeSafe 官方 skill（`typesafe-ai/skills` 的 `skills/typesafe-ai` 子树）装到 `~/.pi/agent/skills/typesafe-ai`，清单与版本号记在 `~/.pi/agent/pi-jev-skill.json`：

- 启动时自动同步（网络调用不阻塞启动，结果在会话开始时提示）
- 首次 = `installed`；上游没动 = `up-to-date`（只发一次 HEAD）；上游变了 = `updated`
- 本地改过 → `local-edits`，不覆盖；`/jev-skill update` 才覆盖
- 上游布局变了（找不到 SKILL.md）→ `error`，宁可吵也不静默装个残的

## 配置

可选文件 `~/.pi/agent/pi-jev.json`（不存在或坏 JSON = 全默认）：

```json
{
  "model": "jev-latest",
  "timeoutMs": 30000,
  "maxConcurrent": 4,
  "lowConfidence": { "choice": 0.5, "score": 0.5, "noulMargin": 0.2 },
  "permission": { "enabled": true }
}
```

优先级：**配置文件显式字段 > 环境变量 > 内置默认**（key 不在链上，见「凭证」）。
env：`PI_JEV_MODEL`、`PI_JEV_TIMEOUT`、`PI_JEV_MAX_CONCURRENT`、`PI_JEV_PERMISSION`（只认明 确的真/假词，脏值当没写）。

## Noul 把关（权限链）

装了 `@gotgenes/pi-permission-system` 后，插件把 Noul 注册成 **Authorizer Chain** 的一环：只在该请求处于 `ask` 态、且链上点名它时才触发，用 Jev 的 yes 概率判决——

- 概率离 0.5 超过 margin → `allow` / `deny`
- 低置信，或 Jev 不可用（无 key / 超时）→ `defer`，交回原链（**守着不放行**）

要它生效：把 Noul 加进权限系统的 `authorizerChain`，并保持 `permission.enabled`（或 `PI_JEV_PERMISSION=1`）。

## 开发

```bash
npm test           # tsx --test：30 项单测（假端点，不打真网络）
npm run typecheck  # tsc 0 错
npm run smoke:live # 真端点冒烟：三 tool 各一发（需要 key）
```
