import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 04 号票 Q4/Q5：独立配置文件，key 不在其中 */
export interface JevConfig {
  model: string;
  timeoutMs: number;
  maxConcurrent: number;
  lowConfidence: { choice: number; score: number; noulMargin: number };
}

export const DEFAULTS: JevConfig = {
  model: "jev-latest",
  timeoutMs: 30_000,
  maxConcurrent: 4,
  lowConfidence: { choice: 0.5, score: 0.5, noulMargin: 0.2 },
};

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-jev.json");

/** 只认有限数：env 里写了 "abc" 这类脏值不该把 timeout 变成 NaN 交给 SDK */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * 04 号票 Q6：配置文件显式字段 > env(PI_JEV_*) > 内置默认；文件缺失=全默认。
 * key 不在此链（见 auth.ts）。
 * opts.path 仅为测试注入，生产走 CONFIG_PATH。
 */
export async function loadConfig(
  opts: { path?: string } = {},
): Promise<JevConfig> {
  const cfg: JevConfig = structuredClone(DEFAULTS);
  const env = (k: string) => num(Number(process.env[k]));
  cfg.model = process.env.PI_JEV_MODEL || cfg.model;
  cfg.timeoutMs = env("PI_JEV_TIMEOUT") ?? cfg.timeoutMs;
  cfg.maxConcurrent = env("PI_JEV_MAX_CONCURRENT") ?? cfg.maxConcurrent;
  try {
    const file = JSON.parse(
      await readFile(opts.path ?? CONFIG_PATH, "utf8"),
    ) as Partial<JevConfig>;
    if (typeof file.model === "string" && file.model) cfg.model = file.model;
    cfg.timeoutMs = num(file.timeoutMs) ?? cfg.timeoutMs;
    cfg.maxConcurrent = num(file.maxConcurrent) ?? cfg.maxConcurrent;
    const lc = file.lowConfidence;
    if (lc) {
      cfg.lowConfidence.choice = num(lc.choice) ?? cfg.lowConfidence.choice;
      cfg.lowConfidence.score = num(lc.score) ?? cfg.lowConfidence.score;
      cfg.lowConfidence.noulMargin =
        num(lc.noulMargin) ?? cfg.lowConfidence.noulMargin;
    }
  } catch {
    // 文件缺失或坏 JSON = 全默认，正常路径
  }
  return cfg;
}
