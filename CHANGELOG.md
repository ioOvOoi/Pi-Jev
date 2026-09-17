# Changelog

All notable changes to Pi-Jev. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [0.1.0] — 2026-09-17

First release: TypeSafe Jev (System One) inside pi.

### Added

- **Login**: registers the `typesafe` provider with pi's native `/login` flow; the key lands in `~/.pi/agent/auth.json`. Resolution order `auth.json` → `TYPESAFE_API_KEY` → missing; the key never enters the config file.
- **Tools**: `jev_noul`, `jev_choice`, `jev_score` — batched (`state` + `questions` map, one request per call), returning `answers` + `usage`, with `_lowConfidence` hints and a non-throwing `{ error: { code, message, hint? } }` envelope.
- **Commands**: `/jev` status panel, `/jev <text>` one-shot probe, `/jev-skill [check|update]`.
- **Official skill auto-install/update**: syncs the `skills/typesafe-ai` subtree of `typesafe-ai/skills` into `~/.pi/agent/skills/typesafe-ai` with a sha256 manifest, `local-edits` protection, and an `error` state that refuses to install a partial skill.
- **Noul as authorizer**: registers a link in the permission system's Authorizer Chain — probability-based `allow`/`deny`, always `defer` on low confidence or unavailability.
- **Config**: optional `~/.pi/agent/pi-jev.json` with priority *file field > env > default*; env vars `PI_JEV_MODEL`, `PI_JEV_TIMEOUT`, `PI_JEV_MAX_CONCURRENT`, `PI_JEV_PERMISSION`.
- **Docs**: `README.md` (English) + `README.zh-CN.md`, `CONTEXT.md` glossary, `docs/wayfinder/` decision map with 9 closed tickets.

### Notes

- No build step: pi loads `src/index.ts` directly; CI runs typecheck, 30 unit tests (fake endpoint, no key) and `npm pack --dry-run`.
- Verified against the live endpoint: three tools in batch, `_keySource: "auth.json"`, and real `/jev` panel/probe runs inside pi.
