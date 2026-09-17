import { choice, noul, score } from "@typesafe-ai/sdk";
import type {
  ChoiceCriteria,
  EntryType,
  Question,
  Questions,
  ScoreCriteria,
} from "@typesafe-ai/sdk";
import {
  AUTH_HINT,
  createJevClient,
  err,
  type JevClientHandle,
  type JevError,
} from "./client.js";
import type { JevConfig } from "./config.js";
import type { KeySource } from "./auth.js";

export type JevType = "noul" | "choice" | "score";

/** tool 面参数（04 号票 Q2/Q8：state 显式传入、questions 批量） */
export interface JevToolArgs {
  state: unknown;
  questions: Record<string, Record<string, unknown>>;
}

export interface JevToolOk {
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
  /** 诊断用：这次的 key 来自 auth.json 还是 env（04 号票原型保留字段） */
  _keySource: KeySource;
}

export type JevToolResult = JevToolOk | JevError;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 入库前的本地校验，省一次注定 422 的网络往返 */
export function validateArgs(
  type: JevType,
  args: JevToolArgs,
): JevError | null {
  if (args?.state == null || args.state === "")
    return err("validation", "state 为必填（文本 / JSON 对象 / 数组）");
  if (!isRecord(args?.questions) || Object.keys(args.questions).length === 0)
    return err("validation", "questions 至少一问：{ [id]: { question, … } }");
  for (const [id, q] of Object.entries(args.questions)) {
    if (!isRecord(q) || typeof q.question !== "string" || !q.question.trim())
      return err("validation", `questions.${id}: question 文本为必填`);
    if (type === "choice") {
      const opts = q.options;
      if (!isRecord(opts) || Object.keys(opts).length < 2)
        return err(
          "validation",
          `questions.${id}: choice 需要 options 至少 2 个选项 { 选项: 描述|null }`,
        );
    }
    if (type === "score") {
      const levels = q.levels;
      if (!Array.isArray(levels) || levels.length < 2)
        return err(
          "validation",
          `questions.${id}: score 需要 levels 至少 2 档（有序）`,
        );
    }
  }
  return null;
}

/** tool 面问题 → SDK 类型化问题（04 号票：签名即拍板对象） */
export function toSdkQuestion(
  type: JevType,
  q: Record<string, unknown>,
): Question {
  const instructions = q.question as EntryType;
  if (type === "noul")
    return noul(instructions, {
      true: (q.trueMeans ?? null) as EntryType,
      false: (q.falseMeans ?? null) as EntryType,
    });
  if (type === "choice")
    return choice(instructions, q.options as ChoiceCriteria);
  return score(instructions, q.levels as unknown as ScoreCriteria);
}

/** 04 号票 Q1/Q7：choice/score 看自带 confidence，noul 看离 0.5 的距离 */
export function markLow(answer: unknown, cfg: JevConfig): unknown {
  if (!isRecord(answer)) return answer;
  const a = answer as { type?: string; confidence?: number; noul?: number };
  const low =
    a.type === "noul"
      ? typeof a.noul === "number" &&
        Math.abs(a.noul - 0.5) < cfg.lowConfidence.noulMargin
      : (a.type === "choice" || a.type === "score") &&
        typeof a.confidence === "number" &&
        a.confidence < cfg.lowConfidence[a.type];
  return low ? { ...a, _lowConfidence: true } : a;
}

export interface JevDeps {
  cfg: JevConfig;
  client: JevClientHandle;
  keySource: KeySource;
}

/** 三 tool 共用的执行体：校验 → 映射 → 一次批量请求 → 低置信标记 */
export async function runJev(
  type: JevType,
  args: JevToolArgs,
  deps: JevDeps,
): Promise<JevToolResult> {
  const bad = validateArgs(type, args);
  if (bad) return bad;
  const questions: Questions = Object.fromEntries(
    Object.entries(args.questions).map(([id, q]) => [
      id,
      toSdkQuestion(type, q),
    ]),
  );
  const r = await deps.client.systemOne(args.state, questions);
  if ("error" in r) return r;
  return {
    answers: Object.fromEntries(
      Object.entries(r.answers).map(([id, a]) => [id, markLow(a, deps.cfg)]),
    ),
    usage: r.usage,
    _keySource: deps.keySource,
  };
}

/** 缺 key 时的占位 client：直接回 auth 包络，不建真 client、不发请求 */
const NO_KEY_CLIENT: JevClientHandle = {
  systemOne: async () => err("auth", "未配置 TypeSafe key", AUTH_HINT),
};

/**
 * 组装执行器：key 每次调用重解析（会话中途 pi login 落 key 后，tool 立刻可用），
 * cfg 固定（原型规则：改配置重启会话生效）；client 按 key+cfg 指纹缓存，
 * 这样并发闸跨调用共享，而不是每次调用新建。
 */
export async function makeRunner(
  cfg: JevConfig,
  resolveKey: () => Promise<{ key: string | null; source: KeySource }>,
): Promise<(type: JevType, args: JevToolArgs) => Promise<JevToolResult>> {
  let cache: { sig: string; client: JevClientHandle } | null = null;
  return async (type, args) => {
    const { key, source } = await resolveKey();
    let client = NO_KEY_CLIENT;
    if (key) {
      const sig = `${key}|${cfg.model}|${cfg.timeoutMs}|${cfg.maxConcurrent}`;
      if (cache?.sig !== sig) cache = { sig, client: createJevClient(key, cfg) };
      client = cache.client;
    }
    return runJev(type, args, { cfg, client, keySource: source });
  };
}
