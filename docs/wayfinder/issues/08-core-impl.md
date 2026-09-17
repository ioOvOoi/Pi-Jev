# 08-core-impl

Type: task
Status: closed
Blocked by: 04, 05

## Question

按 04 定稿实现核心层：client + /jev + jev_choice/jev_score/jev_noul tools。验收：pi 会话里真实调 Jev 拿回结构化判断（含概率/置信度），错误路径可用。

## Resolution（真端点已通）

**已验**：

1. `npm run build`（tsc strict）0 错；`npm test` 30/30——`test/client.test.ts` 假端点覆盖三型问题、并发闸（maxConcurrent 观测）、401/429 错误码映射；`test/core.test.ts` 覆盖三 tool 批量签名、`_lowConfidence` 标记、错误包络。
2. 真 pi 进程里 `/jev` 面板渲染 key/model/阈值/并发/配置路径；`/jev <文本>` 试一枪走真调用链，无 key 时返回 `{"error":{"code":"auth",…}}` 包络（RPC 探针日志 `C:/Users/Administrator/AppData/Local/Temp/jev-perm-probe2/rpc.log`）。
3. 假端点接进真进程后三 tool 链路可达：09 号票探针里 Noul 提问真实打到 `POST /v1/systemone` 并落进判决（`mock.log` 三条带 `Authorization` 的请求）。

**真端点复核 ✓（2026-09-17）**：`npm run smoke:live` 对 `api.typesafe.ai/v1/systemone` 批量调三 tool 一次通过（`LIVE_SMOKE_OK`，`_keySource: "auth.json"`）：

- choice：`{ choice: "list", confidence: 0.81, probabilities: { list: 0.87, del: 0, ask: 0.13 } }`（0.81 ≥ 0.5，未标低置信）
- score：`{ score: 0.8, confidence: 0.44, legend { 0: 无害, 1: 需确认, 2: 破坏性 }, probabilities { 0: 0.29, 1: 0.62, 2: 0.09 }, _lowConfidence: true }`（0.44 < 0.5，标记正确）
- noul：`{ noul: 0.81 }`（离 0.5 超 margin，未标）

即结构化答案 + 概率分布 + 低置信标记 + usage 在真端点下全部成立，本票结题。

**`/jev` 试一枪复核 ✓（2026-09-17）**：真 pi 进程（`pi --mode rpc -e …/src/index.ts`）执行 `/jev 今晚先写文档还是先改代码`，通知里回来 `{ answers: { smoke: { type: "noul", noul: 0.18 } }, usage: { input_tokens: 297, output_tokens: 21 }, _keySource: "auth.json" }`（0.18 离 0.5 超 margin，未标低置信）——面板 → 试一枪 → 真端点全链路通。
