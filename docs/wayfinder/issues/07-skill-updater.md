# 07-skill-updater

Type: task
Status: closed
Blocked by: 05

## Question

skill 自动安装/更新（对齐正常 skill 更新体验）：拉 github.com/typesafe-ai/skills 的 skills/typesafe-ai/（raw.githubusercontent.com），与本地 manifest（commit+hash）比对，有变才更新 ~/.pi/agent/skills/typesafe-ai/；提供手动更新命令。验收：安装/更新/无变化三态可观察。

## Resolution

**上游事实（核对 docs.typesafe.ai/agent-skill + 仓库）**：官方 skill = github.com/typesafe-ai/skills 的 skills/typesafe-ai/，只有 SKILL.md + LICENSE 两个文件；官方安装法是 `npx skills add typesafe-ai/skills --skill typesafe-ai -g`（交互式 CLI，落盘位置按它选的 agent 走，不保证是 pi 的目录）。

**改一处做法**：不走 raw.githubusercontent.com 逐文件拉，改用 codeload 的 tar.gz（一次请求拿整棵子树，且 ETag 能做 If-None-Match 的廉价更新检查）——上游将来往 skill 目录加文件（引用文档等）也能一起带走，不必硬编码文件清单。

**实现**：`src/skill.ts` —— codeload tar.gz → 自写极简 tar 解析（目录项/pax 长名/顶层层剥离）→ sha256 清单；清单落 `<agentDir>/pi-jev-skill.json`（skill 目录外，免得 pi 扫到元数据）；落盘目标 `<agentDir>/skills/typesafe-ai/`（pi 的全局 skill 发现路径，docs/skills.md）。

**三态**：`installed` / `up-to-date`（带 ETag 的 HEAD 得 304，不下载）/ `updated`；另有 `local-edits`（本地文件与清单不符时自动路径不覆盖，除非 force）与 `error`（上游布局变了要吵）。本地被删/改名的旧文件会清掉，用户自己加的文件不动。

**接入**：扩展加载时后台起同步（不 await 进启动路径），`session_start` 里只提示「刚装了/刚更新了/本地有改动/没装上」；`/jev-skill`（面板）· `/jev-skill check`（一个 HEAD 查更新）· `/jev-skill update`（force 同步）；`/jev` 面板加一行 skill 状态。

**证据**：7 个单测（tar/pax、三态、本地改动保护、上游缺 SKILL.md 报错、文件清理）+ 真网络冒烟 `scripts/smoke-skill.ts`：隔离目录 installed → up-to-date；真装到 C:\Users\Administrator\.pi\agent\skills\typesafe-ai（commit 65a39f39，LICENSE+SKILL.md）→ 复跑 up-to-date → checkSkill up-to-date；SKILL.md frontmatter 有 name/description（满足 pi 加载条件）。typecheck 0 错、21/21 测试过。

**遗留**：pi 无「列出已加载 skill」的 CLI（只有 --skill/--no-skills），「可被 pi 使用」的最终证据留到端到端冒烟（会话里 /skill:typesafe-ai 可用）。
