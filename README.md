# Pi-Jev

Bring **TypeSafe Jev (System One)** — a calibrated, non-generative decision model — into [pi](https://github.com/earendil-works/pi). Three typed decision tools, a `/jev` panel, and the official TypeSafe skill auto-installed and auto-updated.

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

A single `jev` tool, **batched and mixed-type**: one `state` plus a map of questions keyed by id, each question carrying its own `type` (noul / choice / score); answers come back under the same ids, spending one request no matter how many questions you ask (capped by `maxConcurrent`).

| Tool | Returns |
|---|---|
| `jev` | `{ answers: { [id]: noul shape, or choice shape (choice, probabilities, confidence), or score shape (score, legend, probabilities, confidence) — by each question's type, plus _lowConfidence? } }, usage,_keySource } |`

```jsonc
// jev input (a choice question; different ids may carry different types)
{
  "state": "用户要求把旧产物全删掉，仓库里还有未提交的改动",
  "questions": {
    "next": {
      "type": "choice",
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
| `/jev` | Status panel: key source, model, skill state, config path |
| `/jev-skill` | Official skill status |
| `/jev-skill check` | Compare local skill against upstream (`up-to-date` / `update-available`) |
| `/jev-skill update` | Force sync from upstream |

Sample panel:

```
Jev (TypeSafe System One) 状态
   key:    ✓ auth.json（apikey…3ba9）
   model:  jev-latest   timeout: 30000ms
   skill:  ✓ 已是最新 65a39f3
   配置文件: ~/.pi/agent/pi-jev.json（缺失=全默认；改后重启会话生效）
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
  "lowConfidence": { "choice": 0.5, "score": 0.5, "noulMargin": 0.2 }
}
```

Priority: **explicit config field > environment variable > built-in default** (the key is deliberately outside this chain).

| Env | Effect |
|---|---|
| `PI_JEV_MODEL` | Model name |
| `PI_JEV_TIMEOUT` | Request timeout (ms) |
| `PI_JEV_MAX_CONCURRENT` | Batch concurrency cap |
| `TYPESAFE_API_KEY` | Credential fallback |

Dirty values (`PI_JEV_TIMEOUT=abc`) are ignored rather than poisoning the config.

## Maintenance & CI

- **No build artifacts**: the entry point is TypeScript, executed by pi. Nothing to publish, nothing to go stale.
- **Auto-update**: installed from `git:…@main`, `pi update --extensions` re-fetches and re-installs dependencies.
- **CI** (`.github/workflows/ci.yml`) runs on every push/PR: typecheck + the 21 unit tests (fake HTTP endpoint, no API key needed) + `npm pack --dry-run` to validate the published file list.

## Development

```bash
npm install
npm run typecheck   # tsc, 0 errors expected
npm test            # 21 tests via tsx --test, no network, no key
npm run smoke:live  # real endpoint: one batch call per tool (needs a key)
npm run smoke:skill # real network: upstream skill check/sync
```

Layout:

```
src/            index.ts (extension entry) · client.ts (SDK) · core.ts (runner) · tools.ts ·
                config.ts · auth.ts · provider.ts (/login provider) · skill.ts
test/           unit tests + fake-endpoint.ts (no network)
scripts/        smoke:live / smoke:skill probes
docs/wayfinder/ the decision map and its 9 tickets
prototype/      the pinned core-layer prototype from ticket 04
research/       upstream API / provider-login / permission-system findings
```

## License

MIT © ioOvOoi
