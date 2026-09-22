import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** 04 号票 Q4/Q5；0.1.3 起阈值与并发恢复可配（0.1.2 砍过头） */
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

/** 走 pi 自己的目录解析（honors PI_CODING_AGENT_DIR），别手搓 ~/.pi/agent */
export const CONFIG_PATH = join(getAgentDir(), "pi-jev.json");

/** 只认有限数：env 里写了 "abc" 这类脏值不该把 timeout 变成 NaN 交给 SDK */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** 阈值必须在 (0,1) 开区间：越界（如 3）当没写，别把坏阈值带进判定 */
const frac = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 && n < 1 ? n : undefined;
};

/** 并发上限必须是 ≥1 的整数 */
const posInt = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
};

/**
 * 04 号票 Q6：配置文件显式字段 > env(PI_JEV_*) > 内置默认；文件缺失=全默认。
 * key 不在此链（见 auth.ts）。opts.path 仅为测试注入，生产走 CONFIG_PATH。
 */
export async function loadConfig(
  opts: { path?: string } = {},
): Promise<JevConfig> {
  const cfg: JevConfig = structuredClone(DEFAULTS);
  const env = (k: string) => num(Number(process.env[k]));
  cfg.model = process.env.PI_JEV_MODEL || cfg.model;
  cfg.timeoutMs = env("PI_JEV_TIMEOUT") ?? cfg.timeoutMs;
  cfg.maxConcurrent =
    posInt(Number(process.env.PI_JEV_MAX_CONCURRENT)) ?? cfg.maxConcurrent;
  try {
    const file = JSON.parse(
      await readFile(opts.path ?? CONFIG_PATH, "utf8"),
    ) as Partial<JevConfig>;
    if (typeof file.model === "string" && file.model) cfg.model = file.model;
    cfg.timeoutMs = num(file.timeoutMs) ?? cfg.timeoutMs;
    cfg.maxConcurrent = posInt(file.maxConcurrent) ?? cfg.maxConcurrent;
    const lc = file.lowConfidence;
    if (lc) {
      cfg.lowConfidence.choice = frac(lc.choice) ?? cfg.lowConfidence.choice;
      cfg.lowConfidence.score = frac(lc.score) ?? cfg.lowConfidence.score;
      cfg.lowConfidence.noulMargin =
        frac(lc.noulMargin) ?? cfg.lowConfidence.noulMargin;
    }
  } catch {
    // 文件缺失或坏 JSON = 全默认，正常路径
  }
  return cfg;
}
