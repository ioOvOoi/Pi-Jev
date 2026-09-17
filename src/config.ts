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

/** 04 号票 Q6：配置文件显式字段 > env(PI_JEV_*) > 内置默认；文件缺失=全默认 */
export async function loadConfig(): Promise<JevConfig> {
  const cfg: JevConfig = structuredClone(DEFAULTS);
  if (process.env.PI_JEV_MODEL) cfg.model = process.env.PI_JEV_MODEL;
  if (process.env.PI_JEV_TIMEOUT) cfg.timeoutMs = Number(process.env.PI_JEV_TIMEOUT);
  if (process.env.PI_JEV_MAX_CONCURRENT) cfg.maxConcurrent = Number(process.env.PI_JEV_MAX_CONCURRENT);
  try {
    const file = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Partial<JevConfig>;
    if (file.model != null) cfg.model = file.model;
    if (file.timeoutMs != null) cfg.timeoutMs = file.timeoutMs;
    if (file.maxConcurrent != null) cfg.maxConcurrent = file.maxConcurrent;
    if (file.lowConfidence) Object.assign(cfg.lowConfidence, file.lowConfidence);
  } catch {
    // 文件缺失或坏 JSON = 默认，正常路径
  }
  return cfg;
}
