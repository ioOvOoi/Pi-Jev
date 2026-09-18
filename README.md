# Pi-Jev

Bring **TypeSafe Jev (System One)** — a calibrated, non-generative decision model — into [pi](https://github.com/earendil-works/pi). Three typed decision tools, a `/jev` panel, the official TypeSafe skill auto-installed and auto-updated, and Noul as a permission-chain authorizer.

**中文文档 → [README.zh-CN.md](README.zh-CN.md)**

| | |
|---|---|
| Terms & semantics | [CONTEXT.md](CONTEXT.md) — glossary of Jev, state, questions, probability vs confidence |
| Design decisions | [docs/wayfinder/map.md](docs/wayfinder/map.md) — the map and its 9 decision tickets |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

---

## What Jev is (and is not)

You hand Jev a **state** (a string, object or array — the text/JSON to be judged) plus one or more **typed questions**, and it returns structured judgements with probabilities:

- **noul** — a yes/no question → `noul`: the probability of “yes”.
- **choice** — pick one from an explicit option set → the choice, the full probability distribution, and `confidence`.
- **score** — rate along ordered levels → a probability-weighted score, per-level probabilities, and `confidence`.

Jev does not generate prose and does not chat. `confidence` is a statistic of the distribution's *shape* (peaked = high), and **noul answers carry no confidence** — which is why low-confidence detection differs per type (see below).

## Install

Requires pi and Node ≥ 20.

```bash
# Recommended: git source, follows main, updates with pi
pi install git:github.com/ioOvOoi/Pi-Jev@main

# Pin a release instead
pi install git:github.com/ioOvOoi/Pi-Jev@v0.1.0

# Local development
pi install /absolute/path/to/Pi-Jev
```

There is **no build step**: pi loads `./src/index.ts` directly, and pi's own `npm install` on checkout installs the single runtime dependency (`@typesafe-ai/sdk`). Updating is `pi update --extensions` (reconciles the clone with `main`).

## Credentials

The API key travels pi's native credential chain and **never enters the config file**:

1. `/login` → choose **TypeSafe (Jev)** → paste the key from [console.typesafe.ai](https://console.typesafe.ai) → pi stores it in `~/.pi/agent/auth.json`
2. or set `TYPESAFE_API_KEY`

Resolution order: `auth.json` → `TYPESAFE_API_KEY` → missing. `/jev` shows which source is in use. Missing keys never throw: tools return `{ error: { code: "auth", ... } }`.

## Tools

All three tools are **batched**: one `state` plus a map of questions keyed by id; answers come back under the same ids, spending one request no matter how many questions you ask (capped by `maxConcurrent`).

| Tool | Returns |
|---|---|
| `jev_noul` | `{ answers: { [id]: { type, noul, _lowConfidence? } }, usage }` |
| `jev_choice` | `{ answers: { [id]: { type, choice, probabilities, confidence, _lowConfidence? } }, usage }` |
| `jev_score` | `{ answers: { [id]: { type, score, probabilities, confidence, legend, _lowConfidence? } }, usage }` |

```jsonc
// jev_choice input
{
  "state": "用户要求把旧产物全删掉，仓库里还有未提交的改动",
  "questions": {
    "next": {
      "question": "下一步最该做什么？",
      "options": { "list": "先列目录看清现状", "del": "直接删掉旧产物", "ask": "先问用户" }
    }
  }
}

// real response (api.typesafe.ai)
{
  "answers": {
    "next": { "type": "choice", "choice": "list", "confidence": 0.81,
      "probabilities": { "list": 0.87, "del": 0, "ask": 0.13 } }
  },
  "usage": { "input_tokens": 362, "output_tokens": 38 },
  "_keySource": "auth.json"
}
```

**Low confidence.** `_lowConfidence: true` is a hint, not a different answer:

| Type | Flag when | Default |
|---|---|---|
| `choice` / `score` | `confidence` below threshold | `0.5` |
| `noul` | probability sits within `0.5 ± noulMargin` | `0.2` |

**Errors never throw.** Failures come back as `{ error: { code, message, hint? } }` with codes such as `auth`, `rate_limit`, `timeout`, `bad_response`, `network`.

## Commands

| Command | What it does |
|---|---|
| `/jev` | Status panel: key source, model, endpoint, thresholds, concurrency, permission-chain state, skill state, config path |
| `/jev <text>` | One shot: runs the canned Noul question against that text (smoke test for key + chain) |
| `/jev-skill` | Official skill status |
| `/jev-skill check` | Compare local skill against upstream (`up-to-date` / `update-available`) |
| `/jev-skill update` | Force sync from upstream |

Sample panel:

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

## Official skill, auto-installed

On startup the plugin syncs the official TypeSafe skill — the `skills/typesafe-ai` subtree of [`typesafe-ai/skills`](https://github.com/typesafe-ai/skills) — into `~/.pi/agent/skills/typesafe-ai` (pi discovers it automatically), recording commit + per-file sha256 in `~/.pi/agent/pi-jev-skill.json`. The network call never blocks startup; the result is announced at session start.

| Status | Meaning |
|---|---|
| `installed` | First sync: files written, manifest recorded |
| `up-to-date` | Upstream unchanged (single HEAD request) |
| `updated` | Upstream moved: files and manifest refreshed |
| `local-edits` | Local files modified → never overwritten until `/jev-skill update` |
| `error` | Upstream layout changed (no `SKILL.md`): loud failure rather than a broken install |

## Configuration

Optional file `~/.pi/agent/pi-jev.json` (missing or malformed = all defaults):

```json
{
  "model": "jev-latest",
  "timeoutMs": 30000,
  "maxConcurrent": 4,
  "lowConfidence": { "choice": 0.5, "score": 0.5, "noulMargin": 0.2 },
  "permission": { "enabled": true }
}
```

Priority: **explicit config field > environment variable > built-in default** (the key is deliberately outside this chain).

| Env | Effect |
|---|---|
| `PI_JEV_MODEL` | Model name |
| `PI_JEV_TIMEOUT` | Request timeout (ms) |
| `PI_JEV_MAX_CONCURRENT` | Batch concurrency cap |
| `PI_JEV_PERMISSION` | `1/true/on/yes` or `0/false/off/no` to enable/disable Noul gating |
| `TYPESAFE_API_KEY` | Credential fallback |

Dirty values (`PI_JEV_TIMEOUT=abc`) are ignored rather than poisoning the config.

## Noul as a permission authorizer

With [`@gotgenes/pi-permission-system`](https://www.npmjs.com/package/@gotgenes/pi-permission-system) installed, the plugin registers Noul as a link in the **Authorizer Chain**. It is consulted only when a request reaches the `ask` state *and* the chain names it:

- probability more than `margin` away from 0.5 → `allow` / `deny`
- low confidence, or Jev unavailable (no key / timeout) → `defer`, handing the decision back to the original chain — **it never silently lets something through**

To activate it, add `Noul` to the permission system's `authorizerChain` and keep `permission.enabled` (or `PI_JEV_PERMISSION=1`). Registration alone does not gate anything; the panel shows whether the chain actually named it.

## Maintenance & CI

- **No build artifacts**: the entry point is TypeScript, executed by pi. Nothing to publish, nothing to go stale.
- **Auto-update**: installed from `git:…@main`, `pi update --extensions` re-fetches and re-installs dependencies.
- **CI** (`.github/workflows/ci.yml`) runs on every push/PR: typecheck + the 30 unit tests (fake HTTP endpoint, no API key needed) + `npm pack --dry-run` to validate the published file list.

## Development

```bash
npm install
npm run typecheck   # tsc, 0 errors expected
npm test            # 30 tests via tsx --test, no network, no key
npm run smoke:live  # real endpoint: one batch call per tool (needs a key)
npm run smoke:skill # real network: upstream skill check/sync
```

Layout:

```
src/            index.ts (extension entry) · client.ts (SDK) · core.ts (runner) · tools.ts ·
                config.ts · auth.ts · provider.ts (/login provider) · skill.ts · permission.ts
test/           unit tests + fake-endpoint.ts (no network)
scripts/        smoke:live / smoke:skill probes
docs/wayfinder/ the decision map and its 9 tickets
prototype/      the pinned core-layer prototype from ticket 04
research/       upstream API / provider-login / permission-system findings
```

## License

MIT © ioOvOoi
