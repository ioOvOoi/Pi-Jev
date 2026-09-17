# 09-permission-noul

Type: task
Status: closed
Blocked by: 03, 08

## Question

按 03 结论把 Noul 危险判断接入 permission-system（或其替代拦截点）。验收：高危操作触发 Jev 判断，低置信/拒绝路径可观察。

## Resolution

**做法（03 号票结论的落地）**：`src/permission.ts` 监听 `permissions:ready`（按 sessionId 幂等）→ `getPermissionsService(sessionId).registerAuthorizer("jev-noul", authorize)`；链名 `jev-noul` 必须由用户写进权限系统 `config.json` 的 `authorizerChain`（注册≠生效，opt-in；插件只读该文件判断激活，绝不代写）。`authorize(details)` 把 ask 的事实（command > path > target > value > 输入预览，截 1200 字）+ 调用方（子 agent 名）压成一段自然语言问题问 Noul：`pYes` 距 0.5 超过 `lowConfidence.noulMargin`（默认 0.2）→ allow/deny；低置信或 Jev 不可用 → **defer**（交还下一环/人工，绝不放行）。deny 的 reason 带 pYes、阈值与被拦内容，直接给到发起方。

**接不上也不炸**：权限系统是可选依赖，按「裸名 → agent 目录包 → createRequire 解析」三路 import 试；全失败 → 一次性通知给安装提示（`onMissing`）。`PI_JEV_PERMISSION=0` 或 `config.permission.enabled=false` 关掉。面板 `/jev` 有一行把关状态（挂链/激活/最近判决）。

**证据（真 pi 进程 + 假 TypeSafe 端点；脚本与日志在 `C:/Users/Administrator/AppData/Local/Temp/jev-perm-probe2/`）**：权限配置临时替换为 `{"authorizerChain":["jev-noul"],"permission":{"bash":{"*":"ask"}}}`（trap 自动还原，diff 校验 `RESTORED_OK`），env 给 `TYPESAFE_API_KEY=sk-fake…` + `TYPESAFE_BASE_URL=http://127.0.0.1:8731`（SDK 读它，单元测试同款）：

| 场景 | 假端点回答 | `PI_JEV_PERM_LOG` | 真进程后果 |
| --- | --- | --- | --- |
| A 安全 | noul=0.95 | `verdict:"allow"`（fabric_exec 与内层 bash 各一次） | `ls -la` 真执行，agent 报成功 |
| B 危险 | noul=0.05 | `verdict:"deny"` | 未执行；发起方收到「Jev Noul 判定 `rm -rf` 为危险命令，放行概率 0.05（阈值 0.70）」 |
| C 低置信 | noul=0.50 | `pYes":0.5,"lowConfidence":true,"verdict":"defer"` | 未执行；headless 报「触发审批，当前无交互 UI 可授权」 |
| D 无 key | — | `note":"auth: 未配置 TypeSafe key","verdict":"defer"` | 未执行（守着不放行） |

另有 `test/permission.test.ts` 覆盖纯函数判决（allow/deny/defer 边界、低置信、错误映射）与 `renderNoulLine`；`npm run build` 0 错、`npm test` 30/30。

—— 结题。
