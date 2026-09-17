# 08-core-impl

Type: task
Status: open
Blocked by: 04, 05

## Question

按 04 定稿实现核心层：client + /jev + jev_choice/jev_score/jev_noul tools。验收：pi 会话里真实调 Jev 拿回结构化判断（含概率/置信度），错误路径可用。

## Resolution（进行中：单测/假端点已过，真端点待 key）

**已验**：

1. `npm run build`（tsc strict）0 错；`npm test` 30/30——`test/client.test.ts` 假端点覆盖三型问题、并发闸（maxConcurrent 观测）、401/429 错误码映射；`test/core.test.ts` 覆盖三 tool 批量签名、`_lowConfidence` 标记、错误包络。
2. 真 pi 进程里 `/jev` 面板渲染 key/model/阈值/并发/配置路径；`/jev <文本>` 试一枪走真调用链，无 key 时返回 `{"error":{"code":"auth",…}}` 包络（RPC 探针日志 `C:/Users/Administrator/AppData/Local/Temp/jev-perm-probe2/rpc.log`）。
3. 假端点接进真进程后三 tool 链路可达：09 号票探针里 Noul 提问真实打到 `POST /v1/systemone` 并落进判决（`mock.log` 三条带 `Authorization` 的请求）。

**待验（本票验收里的「真端点」部分）**：对 `api.typesafe.ai` 批量调三 tool 一次，留下结构化回答（含 `_lowConfidence`）——需要真 key，卡在 06 号票的真人 `/login`。终验（t6）一并取证后关票。
