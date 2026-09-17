import {
 getAgentDir,
 readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
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
