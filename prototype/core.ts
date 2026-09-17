/**
 * Pi-Jev 核心层原型（stub）—— 供 04-core-design 拍板用。
 * client 是 stub：不联网，返回罐头答案；08-core-impl 换成 @typesafe-ai/sdk。
 * 运行：npx tsx prototype/core.ts
 */

// ---------- 配置（Q4/Q5/Q6：独立配置文件 > env > 内置默认；key 不进配置） ----------

export interface JevConfig {
  model: string;            // 默认 jev-latest
  timeoutMs: number;        // 默认 30_000
  maxConcurrent: number;    // 默认 4（公开端点 ~8 上限，给 permission 链留余量）
  lowConfidence: {
    choice: number;         // confidence < 该值 → _lowConfidence（默认 0.5）
    score: number;          // 默认 0.5
    noulMargin: number;     // |p-0.5| < 该值 → _lowConfidence（默认 0.2，即 [0.3,0.7]）
  };
}

const DEFAULTS: JevConfig = {
  model: "jev-latest", timeoutMs: 30_000, maxConcurrent: 4,
  lowConfidence: { choice: 0.5, score: 0.5, noulMargin: 0.2 },
};

// ponytail: 一次读盘不做 watch；改配置重启会话生效
export async function loadConfig(): Promise<JevConfig> {
  const cfg: JevConfig = structuredClone(DEFAULTS);
  // env 先套（Q6：文件显式写的字段压过 env）
  if (process.env.PI_JEV_MODEL) cfg.model = process.env.PI_JEV_MODEL;
  if (process.env.PI_JEV_TIMEOUT) cfg.timeoutMs = +process.env.PI_JEV_TIMEOUT;
  if (process.env.PI_JEV_MAX_CONCURRENT) cfg.maxConcurrent = +process.env.PI_JEV_MAX_CONCURRENT;
  // 配置文件后套，仅覆盖显式出现的字段
  try {
    const file = JSON.parse(await readFile(join(homedir(), ".pi/agent/pi-jev.json"), "utf8"));
    if (file.model != null) cfg.model = file.model;
    if (file.timeoutMs != null) cfg.timeoutMs = file.timeoutMs;
    if (file.maxConcurrent != null) cfg.maxConcurrent = file.maxConcurrent;
    if (file.lowConfidence) Object.assign(cfg.lowConfidence, file.lowConfidence);
  } catch { /* 文件缺失 = 全默认，正常路径 */ }
  return cfg;
}

// ---------- 凭证（01 号票结论：auth.json 链 / TYPESAFE_API_KEY，不进配置文件） ----------

export type KeySource = "auth.json" | "env" | "missing";
export async function resolveKey(): Promise<{ key: string | null; source: KeySource }> {
  try {  // TODO(08): 换 ctx.modelRegistry.getApiKeyForProvider("typesafe")
    const auth = JSON.parse(await readFile(join(homedir(), ".pi/agent/auth.json"), "utf8"));
    const k = auth?.typesafe?.key; if (k) return { key: k, source: "auth.json" };
  } catch { /* 无文件 */ }
  return process.env.TYPESAFE_API_KEY ? { key: process.env.TYPESAFE_API_KEY, source: "env" } : { key: null, source: "missing" };
}

// ---------- 错误包络（与成功同构，永不 throw 给 agent） ----------

export type JevError = { error: { code: "auth" | "validation" | "rate_limited" | "overloaded" | "network" | "timeout"; message: string; hint?: string } };
const mapHttp = (status: number): JevError["error"] =>
  status === 401 ? { code: "auth", message: "TypeSafe key 缺失或无效", hint: "运行 pi login 选 TypeSafe，或设 TYPESAFE_API_KEY" }
  : status === 422 ? { code: "validation", message: "请求体校验失败（见服务端返回）" }
  : status === 429 ? { code: "rate_limited", message: "超限流" }
  : status === 529 ? { code: "overloaded", message: "TypeSafe 过载" }
  : { code: "network", message: `HTTP ${status}` };

// ---------- stub client（08 号票换成 @typesafe-ai/sdk；429/529 SDK 自带退避） ----------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class StubTypeSafeClient {
  constructor(private cfg: JevConfig) {}
  // 签名与 SDK 一致：一次请求 = state + questions map（Q8：批量）
  async systemOne(req: { state: unknown; questions: Record<string, unknown> }): Promise<{ answers: Record<string, any>; usage: { input_tokens: number; output_tokens: number } }> {
    await sleep(200); // 模拟网络
    const answers: Record<string, any> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      const type = (q as any).type;
      answers[id] = type === "noul" ? { type, noul: 0.82 }
        : type === "choice" ? { type, choice: "technical", probabilities: { billing: 0.08, technical: 0.85, sales: 0.07 }, confidence: 0.82 }
        : { type: "score", score: 1.6, legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" }, probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 }, confidence: 0.78 };
    }
    return { answers, usage: { input_tokens: 312, output_tokens: 48 } };
  }
}

// ---------- 低置信标记（Q1/Q7） ----------

function markLow(a: any, cfg: JevConfig): any {
  if (a?.type === "noul" && Math.abs(a.noul - 0.5) < cfg.lowConfidence.noulMargin) return { ...a, _lowConfidence: true };
  if ((a?.type === "choice" || a?.type === "score") && a.confidence < cfg.lowConfidence[a.type]) return { ...a, _lowConfidence: true };
  return a;
}

// ---------- 三个 tool（Q8：批量 questions；签名即拍板对象） ----------

// jev_noul:    { state, questions: { [id]: { question, trueMeans?, falseMeans? } } }
// jev_choice:  { state, questions: { [id]: { question, options: { [option]: string | null } } } }
// jev_score:   { state, questions: { [id]: { question, levels: string[] /* ≥2 */ } } }
// 返回:        { answers: { [id]: <answer + _lowConfidence?> }, usage }
//              或 { error: { code, message, hint? } }（key 缺失/限流/超时等）

export function makeJevTool(cfg: JevClient, type: "noul" | "choice" | "score") {
  return async (args: { state: unknown; questions: Record<string, any> }) => {
    if (!args?.state || !args?.questions || !Object.keys(args.questions).length)
      return { error: { code: "validation", message: "state 与 questions（至少一问）为必填" } } satisfies JevError;
    const { key, source } = await resolveKey();
    if (!key) return { error: { code: "auth", message: "未配置 TypeSafe key", hint: "pi login 选 TypeSafe，或设 TYPESAFE_API_KEY" } } satisfies JevError;
    const questions = Object.fromEntries(Object.entries(args.questions).map(([id, q]) => [id, toSdkQuestion(type, q)]));
    try {  // ponytail: 全局信号量而非按 provider 隔离，v0.1 单插件足够
      return await SEM.withLock(cfg.cfg.maxConcurrent, async () => {
        const r = await cfg.client.systemOne({ state: args.state, questions });
        return { answers: Object.fromEntries(Object.entries(r.answers).map(([id, a]) => [id, markLow(a, cfg.cfg)])), usage: r.usage, _keySource: source };
      });
    } catch (e: any) {
      return { error: e?.status ? mapHttp(e.status) : { code: e?.name === "TimeoutError" ? "timeout" : "network", message: String(e?.message ?? e) } } satisfies JevError;
    }
  };
}

const toSdkQuestion = (type: string, q: any) =>
  type === "noul" ? { type, instructions: q.question, criteria: { true: q.trueMeans ?? "", false: q.falseMeans ?? "" } }
  : type === "choice" ? { type, instructions: q.question, criteria: q.options }
  : { type, instructions: q.question, criteria: q.levels };

// ---------- /jev 命令（Q3：状态面板 + 试一枪） ----------

export async function jevCommand(args: string, cfg: JevClient) {
  if (!args.trim()) {
    const { source } = await resolveKey();
    return [
      `Jev (TypeSafe System One) 状态`,
      `  key:      ${source === "missing" ? "✗ 未配置（pi login 或 TYPESAFE_API_KEY）" : `✓ ${source}`}`,
      `  model:    ${cfg.cfg.model}    timeout: ${cfg.cfg.timeoutMs}ms    并发: ${cfg.cfg.maxConcurrent}`,
      `  低置信:   choice<${cfg.cfg.lowConfidence.choice}  score<${cfg.cfg.lowConfidence.score}  noul±${cfg.cfg.lowConfidence.noulMargin}`,
      `  配置文件: ~/.pi/agent/pi-jev.json（缺失=全默认）`,
      `  试一枪:   /jev <任意文本>`,
    ].join("\n");
  }
  // 试一枪：固定罐头 Noul 问题，只为验证 key 与链路
  return JSON.stringify(await makeJevTool(cfg, "noul")({ state: args, questions: { smoke: { question: "这段文本是否描述了需要立即处理的问题？" } } }), null, 2);
}

// ---------- 小工具（原型自带，08 号票可换实现） ----------

import { readFile } from "node:fs/promises";
import { join, homedir } from "node:path";

class Semaphore {  // maxConcurrent 限流
  private n = 0; private q: (() => void)[] = [];
  constructor(private max: number) {}
  async withLock<T>(n: number, fn: () => Promise<T>): Promise<T> {
    this.max = n;
    while (this.n >= this.max) await new Promise<void>(r => this.q.push(r));
    this.n++; try { return await fn(); } finally { this.n--; this.q.shift()?.(); }
  }
}
const SEM = new Semaphore(4);

// ---------- 组装入口（08 号票接 pi.registerTool / pi.registerCommand） ----------

type JevClient = { cfg: JevConfig; client: StubTypeSafeClient };
export async function createJev(): Promise<JevClient> { return { cfg: await loadConfig(), client: new StubTypeSafeClient(DEFAULTS) }; }

// ---------- 自检 ----------

if (process.argv[1]?.endsWith("core.ts")) {
  const cfg = await createJev();
  console.log(await jevCommand("", cfg));
  const r = await makeJevTool(cfg, "choice")({ state: " payouts failing for 3 days", questions: { dept: { question: "哪个团队处理？", options: { billing: "账务", technical: "故障", sales: null } } } });
  console.log(JSON.stringify(r));
  const bad = await makeJevTool(cfg, "noul")({ state: "", questions: {} });
  console.log(JSON.stringify(bad));
}
