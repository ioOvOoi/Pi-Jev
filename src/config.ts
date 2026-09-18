import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** 04 号票 Q4/Q5；0.1.2 瘦身：只留真正被调的项，低置信阈值与并发在 core/client 里固定 */
export interface JevConfig {
  model: string;
  timeoutMs: number;
  /** 09 号票：Noul 把关总开关（链名是否被权限系统点名仍由用户配置决定） */
  permission: { enabled: boolean };
}

export const DEFAULTS: JevConfig = {
  model: "jev-latest",
  timeoutMs: 30_000,
  permission: { enabled: true },
};

/** 走 pi 自己的目录解析（honors PI_CODING_AGENT_DIR），别手搓 ~/.pi/agent */
export const CONFIG_PATH = join(getAgentDir(), "pi-jev.json");

/** 只认有限数：env 里写了 "abc" 这类脏值不该把 timeout 变成 NaN 交给 SDK */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** env 开关：只认明确的真/假词，脏值当没写（别让 "abc" 变 truthy） */
const bool = (v: string | undefined): boolean | undefined =>
  v === undefined
    ? undefined
    : /^(1|true|on|yes)$/i.test(v)
      ? true
      : /^(0|false|off|no)$/i.test(v)
        ? false
        : undefined;

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
  cfg.permission.enabled =
    bool(process.env.PI_JEV_PERMISSION) ?? cfg.permission.enabled;
  try {
    const file = JSON.parse(
      await readFile(opts.path ?? CONFIG_PATH, "utf8"),
    ) as Partial<JevConfig>;
    if (typeof file.model === "string" && file.model) cfg.model = file.model;
    cfg.timeoutMs = num(file.timeoutMs) ?? cfg.timeoutMs;
    if (typeof file.permission?.enabled === "boolean")
      cfg.permission.enabled = file.permission.enabled;
  } catch {
    // 文件缺失或坏 JSON = 全默认，正常路径
  }
  return cfg;
}
