# 05-repo-skeleton

Type: task
Status: closed

## Question

仓库骨架落地：package.json（pi 扩展入口）、tsconfig、src/ 最小可加载扩展、README；在 MyPi settings.json packages 注册 git:github.com/ioOvOoi/Pi-Jev@main 并验证 pi 能加载空扩展不报错。答案记录文件清单与注册方式。

## Resolution

骨架已落在子模块 `Pi-Jev`（commit b443a05）：

- `package.json`：name `pi-jev`、`keywords:[pi-package]`、`pi.extensions:[./src/index.ts]`（目录包 manifest 形态）；
- `tsconfig.json`（NodeNext/ES2022/strict，noEmit——jiti 免编译加载，build 即类型门禁）；
- `src/index.ts` 入口工厂（async）：已注册 `/jev` 面板；t2 挂 registerProvider、t3 挂三 tool、t5 挂 authorizer；
- `src/config.ts`（loadConfig，Q4-Q6 优先级）、`src/auth.ts`（resolveKey 三源）；
- 安装：`pi install C:/Users/Administrator/.pi/selfex/Pi-Jev` → `~/.pi/agent/settings.json` 条目，`pi list` 可见。

**证据**：

1. `npm run build`（tsc strict）0 错；
2. RPC 探针 `pi --mode rpc --offline --no-session` 发 `/jev` → 返回 `{"command":"prompt","success":true}` 且收到 notify：面板文本（key/model/阈值/配置路径正确渲染）。

—— 结题。
