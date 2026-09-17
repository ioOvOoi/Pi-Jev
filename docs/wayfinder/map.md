# Wayfinder 地图 — Pi-Jev 插件

Label: wayfinder:map

## Destination

Pi-Jev v0.1 装进 pi 可用：① /login 原生添加 Typesafe 平台 Key；② 官方 typesafe-ai skill 自动安装+检查更新+更新到全局 ~/.pi/agent/skills/；③ Jev 核心层（client + /jev 命令 + jev_choice/score/noul tools）接通，并落地 permission-system 危险操作 Noul 判断。插件以 git 包 git:github.com/ioOvOoi/Pi-Jev@main 注册进 settings.json packages。

## Notes

- 领域：pi 扩展（TypeScript）。Jev = TypeSafe 的 System One 决策模型：输入 state + 类型化问题，返回 Choice/Score/Noul 结构化判断（含概率+置信度），不生成文本、不做对话。
- 关键事实：API POST <https://api.typesafe.ai/v1/systemone，Authorization>: Bearer <KEY>，key 在 console.typesafe.ai/keys；官方 skill 在 github.com/typesafe-ai/skills（skills/typesafe-ai/SKILL.md，MIT）；pi 的 key 存 ~/.pi/agent/auth.json（{[providerId]:{type:"api_key",key}}，FileAuthStorageBackend）；provider-keys.json 是第三方 zai 工具的旁路记录，pi 鉴权链不读它；活文档 docs.typesafe.ai/llms.txt（页面加 .md 后缀可抓 Markdown）。
- 使用点分期（用户已批 1–6 全部）：v0.1 = ①核心层 ③permission-system；二期 = ②置信门控 ⑤loop-police；三期 = ④freerouter ⑥fabric/staffs。
- 官方 skill 安装法（喂 07 号票）：npx skills add typesafe-ai/skills --skill typesafe-ai；源 repo github.com/typesafe-ai/skills，skill 文件 skills/typesafe-ai/SKILL.md，更新即比对 GitHub main 后替换
- 包形态：git 包不发 npm；开发子模块挂 selfex/Pi-Jev（MyPi 仓库）。
- 本 tracker 由用户指定放本仓库 docs/wayfinder/，工单在 docs/wayfinder/issues/；研究产出写 research/（用文件而非 research/<name> 分支，简化）。
- 工作会话按票类型调用 skill：research→"research"，原型→"prototype"，访谈/评审→"grilling"+"domain-modeling"。

## Decisions so far

- [01 pi-provider-login-api](docs/wayfinder/issues/01-pi-provider-login-api.md): TypeSafe 可注册为 /login 原生 provider（registerProvider+auth.apiKey.login），key 由 pi 落 auth.json；provider-keys.json 是第三方旁路文件，pi 不读
- [02 typesafe-api-sdk](docs/wayfinder/issues/02-typesafe-api-sdk.md): 单端点 POST /v1/systemone，questions map 一次并行多问；官方 JS SDK @typesafe-ai/sdk 自带重试与类型，推荐 SDK 直用；Choice/Score 带 confidence，Noul 不带
- [03 permission-system-api](docs/wayfinder/issues/03-permission-system-api.md): 有一等接入点 Authorizer Chain（registerAuthorizer + config authorizerChain），Noul 概率→allow/deny/defer，仅 ask 态触发

- [04 · 核心层设计](issues/04-core-design.md): 八项决策定稿（三 tool 批量签名 JSON+_lowConfidence；/jev=面板+试一枪；配置文件>env>默认、key 除外；低置信=conf<0.5 / |p−0.5|<0.2）；原型 prototype/core.ts 拍板通过
- [05 · repo 骨架](issues/05-repo-skeleton.md): pi-jev 包 manifest + src/{index,config,auth}，pi install 本地路径入册；RPC 探针执行 /jev 面板成功 = 发现/加载/注册三证

- [07 · 官方 skill 自动装/更新](issues/07-skill-updater.md): codeload tar.gz 取 skills/typesafe-ai 子树 + sha256 清单；installed/up-to-date/updated 三态 + 本地改动保护；/jev-skill check|update
- [09 · Noul 把关（Authorizer Chain）](issues/09-permission-noul.md): ask 态触发链上 Noul —— pYes 距 0.5 超 margin 才 allow/deny，低置信或不可用一律 defer（守着不放行）；真 pi 进程四态（allow/deny/defer/无 key）日志留证

## Not yet specified

- 二期：置信门控——ask-user-question 前置 Jev 判断，低置信问人、高置信自动；confidence 语义已明确（Choice/Score 自带、Noul 无 → 用原始概率阈值），官方三段阈值法（高=自动/中=确认/低=转人）；等 04 核心设计定下切片成票
- 二期：loop-police / Monitor 空转检测——用 Score（空转等级）还是 Noul（卡死）待核心落地后定
- 三期：freerouter 意图路由 Choice 化
- 三期：fabric/staffs——派发角色路由（Choice: explorer/librarian/fixer/…）与 council 复核 fan-out
- 雾区候选：多 Key 管理/切换、用量与限流呈现（公开端点约 8 并发）、TYPESAFE_ENDPOINT 自定义部署

## Out of scope

- npm 发布（用户已定 git 包即可；将来需要再立项）
- 把 Jev 当聊天/文本生成模型接进 pi 模型槽（域上不可能：Jev 不生成文本）
- Claude Code 等非 pi 环境的接入（官方 skill 渠道已覆盖）
