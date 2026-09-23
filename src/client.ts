import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import type { EntryType, Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import type { JevConfig } from "./config.ts";

/** 04 号票拍板：错误与成功同构，永不 throw 给 agent */
export type JevErrorCode =
  | "auth"
  | "validation"
  | "rate_limited"
  | "overloaded"
  | "network"
  | "timeout";

export interface JevError {
  error: { code: JevErrorCode; message: string; hint?: string };
}

export const AUTH_HINT = "运行 pi login 选 TypeSafe，或设 TYPESAFE_API_KEY";

export const err = (
  code: JevErrorCode,
  message: string,
  hint?: string,
): JevError => ({ error: { code, message, ...(hint ? { hint } : {}) } });

/** HTTP body 可能是任意形状，截断后再进错误消息，避免把大响应灌进上下文 */
const bodyText = (b: unknown): string => {
  const s = typeof b === "string" ? b : JSON.stringify(b ?? null);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
};

/** SDK 异常 → 04 号票错误码。子类必须先于基类判断（APIError 是那堆 4xx/5xx 的基类）。 */
export function mapSdkError(e: unknown): JevError {
  if (e instanceof APITimeoutError)
    return err(
      "timeout",
      `请求超时（单次 ${e.timeoutMs}ms，SDK 已按退避重试）`,
      "调大 timeoutMs 或 PI_JEV_TIMEOUT",
    );
  if (e instanceof APIUserAbortError) return err("network", "调用被取消");
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError)
    return err("auth", "TypeSafe key 缺失或无效", AUTH_HINT);
  if (e instanceof RateLimitError)
    return err(
      "rate_limited",
      "超限流",
      e.retryAfterMs ? `服务端建议 ${e.retryAfterMs}ms 后重试` : undefined,
    );
  if (e instanceof UnprocessableEntityError || e instanceof BadRequestError)
    return err("validation", `请求体校验失败：${bodyText(e.body)}`);
  if (e instanceof InternalServerError)
    return err(
      e.status === 503 || e.status === 529 ? "overloaded" : "network",
      `TypeSafe 返回 HTTP ${e.status}：${bodyText(e.body)}`,
    );
  if (e instanceof APIError)
    return err(
      e.status === 529 ? "overloaded" : "network",
      `HTTP ${e.status}：${bodyText(e.body)}`,
    );
  if (e instanceof APIConnectionError) return err("network", e.message);
  // SDK 侧自校验：key 缺失/含空白 → auth；questions 空、score 档位不足 → validation
  if (e instanceof TypeSafeError)
    return /key/i.test(e.message)
      ? err("auth", e.message, AUTH_HINT)
      : err("validation", e.message);
  return err("network", String((e as { message?: unknown })?.message ?? e));
}

/** 并发闸：公开端点约 8 并发上限，04 号票 Q5 默认 4 */
export class Semaphore {
  private readonly max: number;
  private running = 0;
  private readonly waiters: (() => void)[] = [];
  // 参数属性（constructor(private readonly max)）会让 node strip-types 拒载——
  // 手动展开字段赋值，语义不变（pi-staffs 宿主靠 strip-types 直载本包）。
  constructor(max: number) {
    this.max = max;
  }
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.max)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiters.shift()?.();
    }
  }
}

export interface JevAnswers {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

export type JevCallResult = JevAnswers | JevError;

export interface JevClientHandle {
  systemOne(state: unknown, questions: Questions): Promise<JevCallResult>;
}

/** 真 client：SDK 负责重试/超时/类型，我们只加并发闸与错误包络 */
export function createJevClient(key: string, cfg: JevConfig): JevClientHandle {
  let sdk: TypeSafeClient;
  try {
    sdk = new TypeSafeClient({
      apiKey: key,
      defaultModel: cfg.model,
      timeout: cfg.timeoutMs,
    });
  } catch (e) {
    // 构造期就会抛（key 缺失/非法），同样收敛成包络而不是炸掉 tool
    const mapped = mapSdkError(e);
    return { systemOne: async () => mapped };
  }
  const sem = new Semaphore(cfg.maxConcurrent);
  return {
    async systemOne(state, questions) {
      try {
        const r = await sem.withLock(() =>
          sdk.systemOne({
            state: state as EntryType,
            questions,
          } as SystemOneRequest),
        );
        return {
          model: r.model,
          answers: r.answers as Record<string, unknown>,
          usage: r.usage,
        };
      } catch (e) {
        return mapSdkError(e);
      }
    },
  };
}
