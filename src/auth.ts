import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 04 号票：key 永远来自 pi auth.json 或 TYPESAFE_API_KEY，不进配置文件 */
export type KeySource = "auth.json" | "env" | "missing";

export const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

export async function resolveKey(): Promise<{ key: string | null; source: KeySource }> {
  try {
    const auth = JSON.parse(await readFile(AUTH_PATH, "utf8"));
    const k = auth?.typesafe?.key ?? auth?.typesafe?.apiKey ?? auth?.providers?.typesafe?.key ?? auth?.providers?.typesafe?.apiKey;
    if (typeof k === "string" && k) return { key: k, source: "auth.json" };
  } catch {
    // 无 auth.json
  }
  return process.env.TYPESAFE_API_KEY
    ? { key: process.env.TYPESAFE_API_KEY, source: "env" }
    : { key: null, source: "missing" };
}
