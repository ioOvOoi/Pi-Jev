# Wayfinder 地图 — Pi-Jev 插件

Label: wayfinder:map

## Destination

Pi-Jev v0.1 装进 pi 可用：① /login 原生添加 Typesafe 平台 Key；② 官方 typesafe-ai skill 自动安装+检查更新+更新到全局 ~/.pi/agent/skills/；③ Jev 核心层（client + /jev 命令 + jev_choice/score/noul tools）接通，并落地 permission-system 危险操作 Noul 判断。插件以 git 包 git:github.com/ioOvOoi/Pi-Jev@main 注册进 settings.json packages。

## Notes

- 领域：pi 扩展（TypeScript）。Jev = TypeSafe 的 System One 决策模型：输入 state + 类型化问题，返回 Choice/Score/Noul 结构化判断（含概率+置信度），不生成文本、不做对话。
- 关键事实：API POST <https://api.typesafe.ai/v1/systemone，Authorization>: Bearer <KEY>，key 在 console.typesafe.ai/keys；官方 skill 在 github.com/typesafe-ai/skills（skills/typesafe-ai/SKILL.md，MIT）；pi 的 key 存 ~/.pi/agent/provider-keys.json（{[providerId]:{activeKeyName,keys:[{name,apiKey}]}}）；活文档 docs.typesafe.ai/llms.txt（页面加 .md 后缀可抓 Markdown）。
- 使用点分期（用户已批 1–6 全部）：v0.1 = ①核心层 ③permission-system；二期 = ②置信门控 ⑤loop-police；三期 = ④freerouter ⑥fabric/staffs。
- 包形态：git 包不发 npm；开发子模块挂 selfex/Pi-Jev（MyPi 仓库）。
- 本 tracker 由用户指定放本仓库 docs/wayfinder/，工单在 docs/wayfinder/issues/；研究产出写 research/（用文件而非 research/<name> 分支，简化）。
- 工作会话按票类型调用 skill：research→"research"，原型→"prototype"，访谈/评审→"grilling"+"domain-modeling"。

## Decisions so far

（图刚立；研究票 pi-provider-login-api、typesafe-api-sdk、permission-system-api 派发中）

## Not yet specified

- 二期：置信门控——ask-user-question 前置 Jev 判断，低置信问人、高置信自动；等核心层置信度语义稳定后才能切片成票
- 二期：loop-police / Monitor 空转检测——用 Score（空转等级）还是 Noul（卡死）待核心落地后定
- 三期：freerouter 意图路由 Choice 化
- 三期：fabric/staffs——派发角色路由（Choice: explorer/librarian/fixer/…）与 council 复核 fan-out
- 雾区候选：多 Key 管理/切换、用量与限流呈现（公开端点约 8 并发）、TYPESAFE_ENDPOINT 自定义部署

## Out of scope

- npm 发布（用户已定 git 包即可；将来需要再立项）
- 把 Jev 当聊天/文本生成模型接进 pi 模型槽（域上不可能：Jev 不生成文本）
- Claude Code 等非 pi 环境的接入（官方 skill 渠道已覆盖）
