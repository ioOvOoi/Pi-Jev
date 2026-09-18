# Pi-Jev

把 **TypeSafe Jev（System One）**——一个校准过的、不生成文本的决策模型——接进 [pi](https://github.com/earendil-works/pi)。三个类型化决策工具、`/jev` 面板、官方 TypeSafe skill 自动安装与更新，以及让 Noul 在权限链上把关。

**English docs → [README.md](README.md)**

| | |
|---|---|
| 术语与语义 | [CONTEXT.md](CONTEXT.md)——Jev / state / question / probability vs confidence 词汇表 |
| 设计决策 | [docs/wayfinder/map.md](docs/wayfinder/map.md)——地图与 9 张决策票 |
| 变更记录 | [CHANGELOG.md](CHANGELOG.md) |

---

## Jev 是什么（以及不是什么）

给它一段 **state**（字符串 / 对象 / 数组，即待判断的原文或 JSON）和一到多个**类型化问题**，它返回带概率的结构化判断：

- **noul**——是否题 → `noul`：`yes` 的概率；
- **choice**——在明确的选项集中选一 → 选项、全概率分布、`confidence`；
- **score**——沿有序档位打分 → 概率加权分、各档概率、`confidence`。

Jev 不生成文本、不做对话。`confidence` 是分布**形状**的统计量（集中则高），而 **noul 答案没有 confidence**——这正是低置信判定按类型分开的原因（见下）。

## 安装

需要 pi 与 Node ≥ 20。

```bash
# 推荐：git 源，跟随 main，随 pi 更新
pi install git:github.com/ioOvOoi/Pi-Jev@main

# 或钉某个发布
pi install git:github.com/ioOvOoi/Pi-Jev@v0.1.0

# 本地开发
pi install /absolute/path/to/Pi-Jev
```

**没有构建步骤**：pi 直接加载 `./src/index.ts`；pi 在检出后自己跑 `npm install`，装掉唯一运行期依赖（`@typesafe-ai/sdk`）。更新就是 `pi update --extensions`（把克隆同步到 `main`）。

## 凭证

key 走 pi 原生凭证链，**永不进配置文件**：

1. `/login` → 选 **TypeSafe (Jev)** → 贴 [console.typesafe.ai](https://console.typesafe.ai) 的 key → pi 存入 `~/.pi/agent/auth.json`
2. 或设环境变量 `TYPESAFE_API_KEY`

解析顺序：`auth.json` → `TYPESAFE_API_KEY` → missing。`/jev` 面板显示当前用的是哪一源。缺 key 不抛异常：工具返回 `{ error: { code: "auth", ... } }`。

## 三个工具

三者都是**批量**：一个 `state` + 一张按 id 索引的问题表；答案按同一 id 返回；问几个问题都只花一次请求（并发受 `maxConcurrent` 限制）。

| 工具 | 返回 |
|---|---|
| `jev_noul` | `{ answers: { [id]: { type, noul, _lowConfidence? } }, usage }` |
| `jev_choice` | `{ answers: { [id]: { type, choice, probabilities, confidence, _lowConfidence? } }, usage }` |
| `jev_score` | `{ answers: { [id]: { type, score, probabilities, confidence, legend, _lowConfidence? } }, usage }` |

```jsonc
// jev_choice 入参
{
  "state": "用户要求把旧产物全删掉，仓库里还有未提交的改动",
  "questions": {
    "next": {
      "question": "下一步最该做什么？",
      "options": { "list": "先列目录看清现状", "del": "直接删掉旧产物", "ask": "先问用户" }
    }
  }
}

// 真端点返回（api.typesafe.ai）
{
  "answers": {
    "next": { "type": "choice", "choice": "list", "confidence": 0.81,
      "probabilities": { "list": 0.87, "del": 0, "ask": 0.13 } }
  },
  "usage": { "input_tokens": 362, "output_tokens": 38 },
  "_keySource": "auth.json"
}
```

**低置信标记**：`_lowConfidence: true` 只是提示，不改答案。

| 类型 | 触发条件 | 默认 |
|---|---|---|
| `choice` / `score` | `confidence` 低于阈值 | `0.5` |
| `noul` | 概率落在 `0.5 ± noulMargin` | `0.2` |

**失败不抛异常**：返回 `{ error: { code, message, hint? } }`，code 形如 `auth`、`rate_limit`、`timeout`、`bad_response`、`network`。

## 命令

| 命令 | 作用 |
|---|---|
| `/jev` | 状态面板：key 来源、模型、端点、阈值、并发、权限链、skill 状态、配置路径 |
| `/jev <命题>` | 试一枪：把输入本身当作 Noul 命题，返回其为真的校准概率 |
| `/jev-skill` | 官方 skill 状态 |
| `/jev-skill check` | 与上游比对（`up-to-date` / `update-available`） |
| `/jev-skill update` | 强制与上游同步 |

面板示例：

```
Jev (TypeSafe System One) 状态
   key:    ✓ auth.json（apikey…3ba9）
   model:  jev-latest   timeout: 30000ms   并发: 4
   低置信: choice<0.5  score<0.5  noul±0.2
   skill:  ✓ 已是最新 65a39f3
   把关:   已挂链 jev-noul（会话 1） · 激活状态未知 · 最近：无
   配置文件: ~/.pi/agent/pi-jev.json（缺失=全默认；改后重启会话生效）
   试一枪: /jev <命题>（返回该命题为真的校准概率）
```

## 官方 skill 自动装、自动更

启动时插件会把官方 TypeSafe skill（[`typesafe-ai/skills`](https://github.com/typesafe-ai/skills) 仓库的 `skills/typesafe-ai` 子树）同步到 `~/.pi/agent/skills/typesafe-ai`（pi 会自动发现），并在 `~/.pi/agent/pi-jev-skill.json` 记录 commit 与每文件 sha256。网络调用不阻塞启动，结果在会话开始时提示。

| 状态 | 含义 |
|---|---|
| `installed` | 首次同步：文件落盘 + 清单写入 |
| `up-to-date` | 上游没动（只发一次 HEAD） |
| `updated` | 上游变了：文件与清单一起刷新 |
| `local-edits` | 本地改过 → 不覆盖，直到 `/jev-skill update` |
| `error` | 上游布局变了（找不到 `SKILL.md`）：宁可吵，也不静默装个残的 |

## 配置

可选文件 `~/.pi/agent/pi-jev.json`（缺失或坏 JSON = 全默认）：

```json
{
  "model": "jev-latest",
  "timeoutMs": 30000,
  "maxConcurrent": 4,
  "lowConfidence": { "choice": 0.5, "score": 0.5, "noulMargin": 0.2 },
  "permission": { "enabled": true }
}
```

优先级：**配置文件显式字段 > 环境变量 > 内置默认**（key 刻意不在链上）。

| 环境变量 | 作用 |
|---|---|
| `PI_JEV_MODEL` | 模型名 |
| `PI_JEV_TIMEOUT` | 请求超时（ms） |
| `PI_JEV_MAX_CONCURRENT` | 批量并发上限 |
| `PI_JEV_PERMISSION` | `1/true/on/yes` 或 `0/false/off/no` 开关 Noul 把关 |
| `TYPESAFE_API_KEY` | key 兜底 |

脏值（`PI_JEV_TIMEOUT=abc`）会被忽略，而不是把配置污染成 NaN。

## Noul 把关（权限链）

装了 [`@gotgenes/pi-permission-system`](https://www.npmjs.com/package/@gotgenes/pi-permission-system) 后，插件把 Noul 注册成 **Authorizer Chain** 的一环。只有当请求进入 `ask` 态、且链上点名它时才会被咨询：

- 概率离 0.5 超过 `margin` → `allow` / `deny`
- 低置信，或 Jev 不可用（无 key / 超时）→ `defer`，把决定交回原链——**绝不静默放行**

要生效：把 `Noul` 加进权限系统的 `authorizerChain`，并保持 `permission.enabled`（或 `PI_JEV_PERMISSION=1`）。光注册不会拦任何东西；面板会显示链上是否真的点了名。

## 维护与 CI

- **没有构建产物**：入口是 TypeScript，由 pi 直接执行；不存在发不发、陈不陈的 `dist`。
- **自动更新**：以 `git:…@main` 安装后，`pi update --extensions` 会重新拉取并安装依赖。
- **CI**（`.github/workflows/ci.yml`）：每次 push/PR 跑 typecheck + 30 项单测（假 HTTP 端点，不需要 key）+ `npm pack --dry-run` 校验发布文件清单。

## 开发

```bash
npm install
npm run typecheck   # tsc，期望 0 错
npm test            # tsx --test 跑 30 项，不走网络、不需要 key
npm run smoke:live  # 真端点：三 tool 各批量一发（需要 key）
npm run smoke:skill # 真网络：上游 skill check/sync
```

目录：

```
src/            index.ts（扩展入口）· client.ts（SDK）· core.ts（runner）· tools.ts ·
                config.ts · auth.ts · provider.ts（/login provider）· skill.ts · permission.ts
test/           单测 + fake-endpoint.ts（不走网络）
scripts/        smoke:live / smoke:skill 探针
docs/wayfinder/ 决策地图与 9 张票
prototype/      04 号票拍板的核心层原型
research/       上游 API / provider-login / 权限系统调研
```

## 许可

MIT © ioOvOoi
