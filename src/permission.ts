/**
 * 09 号票：Noul 把关 —— 把 Jev（System One 的「危险吗」判断）接进
 * @gotgenes/pi-permission-system 的 Authorizer Chain。
 *
 * 语义（03 号票结论）：
 * - 只有确定性策略落到 `ask` 的请求才走到链上；allow/deny 不经过我们。
 * - 注册 ≠ 生效：用户还需在权限系统 config.json 写 "authorizerChain": ["jev-noul"]（opt-in）。
 * - Jev 不可用 / 低置信 → defer（交还下一环或人工）——把关宁可多问一句，绝不放行。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { appendFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { JevConfig } from "./config.js";
import { LOW, type JevToolResult } from "./core.js";
import type { JevRunner } from "./tools.js";

/** 链上链名：权限系统 config.json 的 authorizerChain 要写这个名字 */
export const LINK_NAME = "jev-noul";
export const READY_CHANNEL = "permissions:ready";
export const DECISION_CHANNEL = "permissions:decision";

/** 全局作用域权限配置（只读它来判断「是否已激活」，绝不代用户写） */
export const PERMISSION_CONFIG_PATH = join(
  getAgentDir(),
  "extensions",
  "pi-permission-system",
  "config.json",
);

export type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" };

/** 从 PromptPermissionDetails 里抽出来的可读事实（不搬 payload，省 token） */
export interface AskFacts {
  toolName?: string;
  surface?: string | null;
  command?: string;
  path?: string;
  target?: string;
  value?: string | null;
  toolInputPreview?: string;
  agentName?: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** 一次 ask 的「主值」：命令 > 路径 > target > 显式 value > 输入预览 */
export function pickValue(f: AskFacts): string {
  for (const v of [f.command, f.path, f.target, f.value, f.toolInputPreview])
    if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

const PREVIEW_MAX = 1200;

/** 交给 Jev 的提问：把 ask 的事实压成一段文本，避免模型凭工具名猜 */
export function buildQuestion(f: AskFacts): {
  question: string;
  trueMeans: string;
  falseMeans: string;
} {
  const value = pickValue(f).slice(0, PREVIEW_MAX);
  const who = f.agentName ? `子 agent「${f.agentName}」` : "当前会话";
  const head = [
    `${who} 请求执行工具 ${f.toolName ?? "未知"}`,
    f.surface ? `（权限表面 ${f.surface}）` : "",
    "。",
  ].join("");
  return {
    question: `${head}具体内容：
${value || "（无内容）"}

这次操作是否安全、且符合用户意图，可以直接放行？`,
    trueMeans: "可以放行（安全且符合用户意图）",
    falseMeans: "应当拦截（危险、破坏性，或明显违背用户意图）",
  };
}

/** Jev 一次判断的结果（只有 pYes 用于判决；低置信按 04 号票阈值） */
export type NoulOutcome =
  | { ok: true; pYes: number; lowConfidence: boolean }
  | { ok: false; note: string };

/** 概率 + 低置信 → 链上判决（纯函数，便于单测） */
export function verdictFrom(
  out: NoulOutcome,
  margin: number,
  f: AskFacts = {},
): AuthorizerVerdict {
  if (!out.ok) return { kind: "defer" }; // Jev 不可用：交还人工，不放行
  const { pYes } = out;
  if (out.lowConfidence || Math.abs(pYes - 0.5) < margin)
    return { kind: "defer" };
  if (pYes >= 0.5 + margin) return { kind: "allow" };
  const digest = pickValue(f).slice(0, 200);
  return {
    kind: "deny",
    reason: [
      `Jev Noul 判定这是危险操作（放行概率 ${pYes.toFixed(2)}，阈值 ${(0.5 + margin).toFixed(2)}）。`,
      digest ? `被拦的命令：${digest}` : "",
      "请改用更小范围/更明确的操作，把意图写清楚再试，或让用户亲自执行。",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** 从 tool 返回包络里读 noul 概率与低置信标记 */
export function outcomeOf(r: JevToolResult): NoulOutcome {
  if ("error" in r)
    return { ok: false, note: `${r.error.code}: ${r.error.message}` };
  const a = r.answers?.gate;
  if (!isRecord(a) || typeof a.noul !== "number")
    return { ok: false, note: "回答里没有 noul 概率" };
  return { ok: true, pYes: a.noul, lowConfidence: a._lowConfidence === true };
}

// ---------------------------------------------------------------------------
// 可选依赖：权限系统扩展可能没装。按「裸名 → agent 目录里的包 → createRequire」
// 依次试，全失败就安静退化（面板给安装提示），绝不让插件加载失败。
// ---------------------------------------------------------------------------

type AuthorizeFn = (
  details: unknown,
  query: unknown,
  log: unknown,
) => Promise<AuthorizerVerdict>;

interface RegisterableService {
  registerAuthorizer(name: string, authorize: AuthorizeFn): () => void;
}

/** 权限系统模块的公开面（只用到这一处） */
interface PermissionModule {
  getPermissionsService?: (
    sessionId: string,
  ) => RegisterableService | undefined;
}

function serviceCandidates(): string[] {
  const pkg = "@gotgenes/pi-permission-system";
  const dir = join(getAgentDir(), "npm", "node_modules", pkg);
  const out = [pkg];
  try {
    const req = createRequire(join(getAgentDir(), "npm", "index.cjs"));
    out.push(pathToFileURL(req.resolve(pkg)).href);
  } catch {
    // 包不带 exports 解析或没装：退回猜路径
    out.push(pathToFileURL(join(dir, "src", "service.ts")).href);
  }
  out.push(pathToFileURL(join(dir, "src", "service.ts")).href);
  return out;
}

async function defaultLoadService(
  sessionId: string,
): Promise<{ service: RegisterableService; via: string } | undefined> {
  for (const spec of serviceCandidates()) {
    try {
      // 非字面量说明符：TS 无权推断模块类型，运行时再验形状
      const mod = (await import(spec)) as PermissionModule;
      const svc = mod?.getPermissionsService?.(sessionId);
      if (svc && typeof svc.registerAuthorizer === "function")
        return { service: svc, via: spec };
    } catch {
      // 候选不可用：试下一个
    }
  }
  return undefined;
}

export interface NoulStatus {
  enabled: boolean;
  /** registered=已挂上链；missing=没找到权限系统；off=被配置关掉 */
  state: "registered" | "missing" | "off" | "pending";
  sessions: string[];
  /** 权限系统 config.json 是否写了我们的链名（注册≠生效的最后一步） */
  activated: boolean | null;
  last: { at: string; result: string; surface: string; value: string }[];
  detail?: string;
}

export interface NoulDeps {
  cfg: JevConfig;
  run: JevRunner;
  enabled: boolean;
  /** 测试注入点；生产走 defaultLoadService */
  loadService?: (
    sessionId: string,
  ) => Promise<{ service: RegisterableService; via: string } | undefined>;
  /** 观测：每次判决追加一行 JSONL（探针/排障用，不设则只进内存环） */
  debugPath?: string;
  /** 找服务失败时的说话口子（由 index.ts 接上 UI，只喊一次） */
  onMissing?: (detail: string) => void;
}

const RING_MAX = 5;

/** 读权限系统全局配置，看 authorizerChain 是否已包含我们 */
export async function isActivated(
  path = PERMISSION_CONFIG_PATH,
): Promise<boolean | null> {
  try {
    const cfg = JSON.parse(await readFile(path, "utf8")) as {
      authorizerChain?: unknown;
    };
    const chain = cfg.authorizerChain;
    return Array.isArray(chain) && chain.includes(LINK_NAME);
  } catch {
    return null; // 文件不存在/坏 JSON：权限系统可能没装
  }
}

/** 未激活时给用户的一行可照抄配置 */
export function activationHint(): string {
  return `在 ${PERMISSION_CONFIG_PATH} 里加 "authorizerChain": ["${LINK_NAME}"]`;
}

export function renderNoulLine(s: NoulStatus): string {
  if (!s.enabled)
    return "关闭（config.permission.enabled=false 或 PI_JEV_PERMISSION=0）";
  const state =
    s.state === "registered"
      ? `已挂链 ${LINK_NAME}（会话 ${s.sessions.length}）`
      : s.state === "missing"
        ? `未找到权限系统：${s.detail ?? "未安装 @gotgenes/pi-permission-system"}`
        : s.state === "off"
          ? "关闭"
          : "等待 permissions:ready";
  const act =
    s.activated === true
      ? "已激活"
      : s.activated === false
        ? `未激活（${activationHint()}）`
        : "激活状态未知";
  const tail = s.last.length
    ? `最近：${s.last.map((d) => `${d.result}:${d.surface}`).join(" / ")}`
    : "最近：无";
  return `${state} · ${act} · ${tail}`;
}

/**
 * 挂上 Noul 把关。返回句柄（面板读状态用），并自行处理
 * 「ready 可能重复」「服务可能不存在」两种现实。
 */
export function registerNoulAuthorizer(
  pi: ExtensionAPI,
  deps: NoulDeps,
): { status: () => NoulStatus } {
  const disposers = new Map<string, () => void>();
  const last: NoulStatus["last"] = [];
  const status: NoulStatus = {
    enabled: deps.enabled,
    state: deps.enabled ? "pending" : "off",
    sessions: [],
    activated: null,
    last,
  };
  let missingSaid = false;

  const load = deps.loadService ?? defaultLoadService;

  const record = (entry: {
    facts: AskFacts;
    outcome: NoulOutcome | null;
    verdict: AuthorizerVerdict;
  }): void => {
    const line = {
      at: new Date().toISOString(),
      tool: entry.facts.toolName ?? null,
      surface: entry.facts.surface ?? null,
      value: pickValue(entry.facts).slice(0, 500),
      pYes: entry.outcome?.ok ? entry.outcome.pYes : null,
      lowConfidence: entry.outcome?.ok ? entry.outcome.lowConfidence : null,
      note: entry.outcome && !entry.outcome.ok ? entry.outcome.note : null,
      verdict: entry.verdict.kind,
    };
    if (deps.debugPath) {
      // 观测文件写失败不该影响权限流程
      void appendFile(deps.debugPath, JSON.stringify(line) + "\n").catch(
        () => {},
      );
    }
  };

  const authorize = async (
    details: unknown,
    _query: unknown,
    log: unknown,
  ): Promise<AuthorizerVerdict> => {
    const d = (isRecord(details) ? details : {}) as AskFacts;
    const facts: AskFacts = {
      toolName: d.toolName,
      surface: d.surface ?? null,
      command: d.command,
      path: d.path,
      target: d.target,
      value: d.value ?? null,
      toolInputPreview: d.toolInputPreview,
      agentName: d.agentName ?? null,
    };
    let outcome: NoulOutcome | null = null;
    let verdict: AuthorizerVerdict = { kind: "defer" };
    try {
      const r: JevToolResult = await deps.run({
        state: pickValue(facts) || `${facts.toolName ?? "tool"}`,
        questions: { gate: buildQuestion(facts) },
      });
      outcome = outcomeOf(r);
      verdict = verdictFrom(outcome, LOW.noulMargin, facts);
    } catch (e) {
      // 任何意外都按「不放行」处理：把决定交还人工
      outcome = { ok: false, note: e instanceof Error ? e.message : String(e) };
    }
    record({ facts, outcome, verdict });
    try {
      const l = log as {
        review?: (e: string, d?: Record<string, unknown>) => void;
      };
      l.review?.("jev_noul", {
        surface: facts.surface ?? null,
        tool: facts.toolName ?? null,
        value: pickValue(facts).slice(0, 200),
        pYes: outcome?.ok ? outcome.pYes : null,
        verdict: verdict.kind,
      });
    } catch {
      // 日志失败不影响判决
    }
    return verdict;
  };

  const onReady = async (data: unknown): Promise<void> => {
    if (!deps.enabled) return;
    const ev = isRecord(data) ? data : {};
    const sessionId = typeof ev.sessionId === "string" ? ev.sessionId : null;
    if (!sessionId || disposers.has(sessionId)) return; // ready 会重复：幂等
    const found = await load(sessionId);
    if (!found) {
      status.state = "missing";
      status.detail = "未安装 @gotgenes/pi-permission-system";
      if (!missingSaid) {
        missingSaid = true;
        deps.onMissing?.(status.detail);
      }
      return;
    }
    try {
      const dispose = found.service.registerAuthorizer(LINK_NAME, authorize);
      if (typeof dispose === "function") disposers.set(sessionId, dispose);
      status.sessions.push(sessionId);
      status.state = "registered";
      status.detail = `via ${found.via}`;
    } catch (e) {
      // 重复注册/同会话二次 ready：记下但不当失败
      status.state = "missing";
      status.detail = e instanceof Error ? e.message : String(e);
    }
  };

  pi.events.on(READY_CHANNEL, (data: unknown) => {
    void onReady(data);
  });

  // 观测链：权限系统每次决议都广播，留最近几条给面板（含 authorizer_allowed/denied）
  pi.events.on(DECISION_CHANNEL, (data: unknown) => {
    const ev = isRecord(data) ? data : {};
    last.unshift({
      at: new Date().toISOString(),
      result: String(ev.result ?? ev.decision ?? "?"),
      surface: String(ev.surface ?? "?"),
      value: String(ev.value ?? "").slice(0, 120),
    });
    if (last.length > RING_MAX) last.pop();
  });

  return {
    status: () => {
      void isActivated().then((a) => {
        status.activated = a;
      });
      status.enabled = deps.enabled;
      return status;
    },
  };
}
