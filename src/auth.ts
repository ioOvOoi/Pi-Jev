import {
 getAgentDir,
 readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TYPESAFE_PROVIDER_ID } from "./provider.js";

/** 04 号票：key 永远来自 pi 凭据库或 TYPESAFE_API_KEY，绝不进配置文件 */
export type KeySource = "auth.json" | "env" | "missing";

export const ENV_KEY = "TYPESAFE_API_KEY";

/** 展示用路径：走 pi 自己的配置目录解析（honors PI_CODING_AGENT_DIR），避免手搓 ~/.pi/agent */
export const AUTH_PATH = join(getAgentDir(), "auth.json");

/**
 * 解析 Jev key。优先 pi 原生凭据库（/login 落盘处，用 pi 的读取 API 而非自己解析文件），
 * 其次 env；两者皆无 = missing。面板据此显示来源。
 */
export async function resolveKey(): Promise<{
 key: string | null;
 source: KeySource;
}> {
 try {
  const cred = readStoredCredential(TYPESAFE_PROVIDER_ID);
  if (cred?.type === "api_key" && cred.key)
   return { key: cred.key, source: "auth.json" };
 } catch {
  // 凭据库缺失/损坏 → 落到 env，不因读文件失败而炸掉面板
 }
 const env = process.env[ENV_KEY];
 return env ? { key: env, source: "env" } : { key: null, source: "missing" };
}

// ============================ AA key（02 号票） ============================

/** AA 在 auth.json 的顶层 key（provider id）：与 TypeSafe 同法存 {type:"api_key",key} */
export const AA_PROVIDER_ID = "artificialanalysis";
/** AA 的 env 兜底变量名（spec 用户决策：AA_API_KEY 与 Jev key 同一凭据链） */
export const AA_ENV_KEY = "AA_API_KEY";
/** 免费 key 注册地址：缺失指引里给用户看，别让调用方各自拼裸错 */
export const AA_REGISTER_URL = "https://artificialanalysis.ai";

/** AA key 解析结果：missing 时自带注册指引，读取方直接展示即可 */
export interface AaKeyResult {
  key: string | null;
  source: KeySource;
  /** 仅 source==="missing" 时给出：怎么配置 + 注册地址 */
  guidance?: string;
}

/**
 * 解析 AA key：优先级与 Jev key 一致（凭据库 > env > missing）。
 * opts.path 仅为测试注入，生产走 AUTH_PATH。
 */
export async function resolveAaKey(
  opts: { path?: string } = {},
): Promise<AaKeyResult> {
  try {
    const cred = readStoredCredential(AA_PROVIDER_ID, opts.path ?? AUTH_PATH);
    if (cred?.type === "api_key" && cred.key)
      return { key: cred.key, source: "auth.json" };
  } catch {
    // 凭据库缺失/损坏 → 落到 env（与 resolveKey 同策略）
  }
  const env = process.env[AA_ENV_KEY];
  if (env) return { key: env, source: "env" };
  // 缺失不是异常：带指引返回，读取方据此提示用户注册
  return {
    key: null,
    source: "missing",
    guidance: `AA API key 未设置：运行 /jev aa 交互写入，或设环境变量 ${AA_ENV_KEY}。免费 key 注册：${AA_REGISTER_URL}`,
  };
}

/**
 * 读写 auth.json 的最小 helper：整文件读-改-写，保留其它 provider 的凭据。
 * 格式与 pi 自己写入一致（2 空格缩进）；坏文件拒绝覆盖，宁可失败让用户人工处理。
 */
async function updateAuthJson(
  path: string,
  fn: (data: Record<string, unknown>) => void,
): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  let data: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`内容不是对象：${path}`);
      }
      data = parsed as Record<string, unknown>;
    } catch (e) {
      // 坏 JSON 意味着可能有别家凭据不可读：整文件拒绝写，不静默覆盖
      throw new Error(
        `auth.json 读取失败，未做更改：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  fn(data);
  // mode 0o600 与 pi 写凭据同款（仅属主可读）；Windows 忽略 mode 无害
  await writeFile(path, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/** 把 AA key 存入 auth.json（覆写同名 provider 条目） */
export async function saveAaKey(
  key: string,
  opts: { path?: string } = {},
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("AA API key 不能为空");
  await updateAuthJson(opts.path ?? AUTH_PATH, (data) => {
    data[AA_PROVIDER_ID] = { type: "api_key", key: trimmed };
  });
}

/** 从 auth.json 清除 AA key；返回是否真的删掉了 */
export async function clearAaKey(
  opts: { path?: string } = {},
): Promise<boolean> {
  let removed = false;
  await updateAuthJson(opts.path ?? AUTH_PATH, (data) => {
    if (AA_PROVIDER_ID in data) {
      delete data[AA_PROVIDER_ID];
      removed = true;
    }
  });
  return removed;
}
