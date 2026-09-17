import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * 07 号票：TypeSafe 官方 skill 的自动安装 / 检查更新 / 更新。
 *
 * 上游事实（2026-09 核对 docs.typesafe.ai/agent-skill）：官方 skill 位于
 * github.com/typesafe-ai/skills 的 skills/typesafe-ai/（SKILL.md + LICENSE）。官方推荐
 * `npx skills add typesafe-ai/skills --skill typesafe-ai -g`，那是交互式 CLI、落盘位置按
 * 它自己选的 agent 走，不保证落进 pi 的目录。这里直接用 codeload 的 tar.gz 取整棵子树：
 * 一次请求、内容可比对，ETag 还能做 If-None-Match 的廉价更新检查。
 *
 * pi 在 <agentDir>/skills/<name>/SKILL.md 递归发现 skill（docs/skills.md），
 * 所以落盘到全局配置目录即自动生效。
 */

export const SKILL_REPO = "typesafe-ai/skills";
export const SKILL_REF = "main";
/** 仓库内 skill 目录：上游将来往这里加文件（引用文档等）也会一起带走，不硬编码文件清单 */
export const SKILL_SUBPATH = "skills/typesafe-ai";

const TARBALL_URL = `https://codeload.github.com/${SKILL_REPO}/tar.gz/refs/heads/${SKILL_REF}`;
const ATOM_URL = `https://github.com/${SKILL_REPO}/commits/${SKILL_REF}.atom`;
/** HEAD 只探版本，给短超时；下载给宽一点 */
const HEAD_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 25_000;

export const SKILL_DIR = join(getAgentDir(), "skills", "typesafe-ai");
/** 清单写在 skill 目录之外：目录里只留上游文件，免得 pi 扫目录时见到我们的元数据 */
export const SKILL_STATE_PATH = join(getAgentDir(), "pi-jev-skill.json");

/** 本地安装清单：靠它区分「上游变了」和「本地被改过」 */
export interface SkillState {
  repo: string;
  ref: string;
  /** 上游 commit（来自 atom feed，失败时可能是空串，不阻塞安装） */
  commit: string;
  etag: string;
  /** 相对 skill 目录的路径 → sha256 */
  files: Record<string, string>;
  installedAt: string;
}

export type SkillSyncResult =
  | { status: "installed"; commit: string; etag: string; files: string[] }
  | {
      status: "updated";
      commit: string;
      from: string;
      etag: string;
      files: string[];
    }
  | { status: "up-to-date"; commit: string; files: string[] }
  /** 本地被手工改过：自动更新不该吃掉别人的改动，交给人决定 */
  | { status: "local-edits"; commit: string; files: string[] }
  | { status: "error"; message: string; installed: boolean };

export type SkillCheckResult = {
  status: "up-to-date" | "update-available" | "unknown";
  commit: string;
  detail?: string;
};

const sha256 = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const hashMap = (files: Map<string, Uint8Array>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [rel, data] of files) out[rel] = sha256(data);
  return out;
};

/** 只比 skill 内容：上游只改 README/其它 skill 时不该触发重装 */
const sameFiles = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

// ---------------------------------------------------------------------------
// tar.gz → 文件表：只为了取上游 skill 子树，不引第三方依赖
// ---------------------------------------------------------------------------

const decoder = new TextDecoder("utf-8");
/** ustar 的字符串字段：NUL 截断，尾部空格要去掉 */
const cstr = (buf: Uint8Array, off: number, len: number): string => {
  let end = off;
  while (end < off + len && buf[end] !== 0) end++;
  return decoder.decode(buf.subarray(off, end)).trim();
};
const octal = (buf: Uint8Array, off: number, len: number): number => {
  const m = cstr(buf, off, len).match(/[0-7]+/);
  return m ? parseInt(m[0], 8) : 0;
};
/**
 * 极简 tar 解析（只认归档里会出现的形态）：
 * 普通文件 + 目录 + pax 扩展头('x') + GNU 长名('L')；归档结束按全零块判断。
 */
export function parseTarGz(gz: Uint8Array): Map<string, Uint8Array> {
  const tar = gunzipSync(gz);
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  let paxPath: string | undefined;
  let gnuName: string | undefined;
  while (offset + 512 <= tar.length) {
    const name = cstr(tar, offset, 100);
    if (!name) break; // 全零块 = 归档结束
    const size = octal(tar, offset + 124, 12);
    const type = String.fromCharCode(tar[offset + 156] ?? 0);
    const prefix = cstr(tar, offset + 345, 155);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "X") {
      // pax 记录形如 "<len> path=<路径>\n"，用于超长路径
      const m = decoder.decode(data).match(/\d+ path=([^\n]*)\n/);
      if (m) paxPath = m[1];
      continue;
    }
    if (type === "L") {
      gnuName = decoder.decode(data).replace(/\0+$/, "");
      continue;
    }
    if (type !== "0" && type !== "\0" && type !== "") continue; // 目录/硬链等跳过
    out.set(paxPath ?? gnuName ?? (prefix ? `${prefix}/${name}` : name), data);
    paxPath = undefined;
    gnuName = undefined;
  }
  return out;
}

/** 剥掉 tar 顶层目录（github 归档是 <repo>-<ref>/），只留 SKILL_SUBPATH 子树 */
export function pickSkillFiles(
  tar: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, data] of tar) {
    const cut = path.indexOf("/");
    if (cut < 0) continue;
    const rest = path.slice(cut + 1);
    if (!rest.startsWith(`${SKILL_SUBPATH}/`)) continue;
    out.set(rest.slice(SKILL_SUBPATH.length + 1), data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 清单读写与本地漂移检测
// ---------------------------------------------------------------------------

export async function readSkillState(
  path: string = SKILL_STATE_PATH,
): Promise<SkillState | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as SkillState;
    return raw && typeof raw.files === "object" ? raw : null;
  } catch {
    return null; // 文件缺失/坏 JSON = 当作没装过
  }
}

const writeState = async (path: string, state: SkillState): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
};

/** 返回被本地改过或丢了的文件（相对路径）；空数组 = 磁盘与清单一致 */
async function localDrift(dir: string, state: SkillState): Promise<string[]> {
  const drifted: string[] = [];
  for (const [rel, hash] of Object.entries(state.files)) {
    try {
      const cur = await readFile(join(dir, rel));
      if (sha256(cur) !== hash) drifted.push(rel);
    } catch {
      drifted.push(rel);
    }
  }
  return drifted;
}

/** atom feed 首页第一条 commit；失败不影响安装（只是版本号不显示） */
async function fetchCommit(
  doFetch: typeof fetch,
  fallback: string,
): Promise<string> {
  try {
    const res = await doFetch(ATOM_URL, {
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    const m = (await res.text()).match(/commit\/([0-9a-f]{40})/i);
    return m?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

export interface SkillSyncOptions {
  /** 测试注入；生产走真实 GitHub 与全局 skill 目录 */
  dir?: string;
  statePath?: string;
  fetchImpl?: typeof fetch;
  /** true = 用户显式要求同步（/jev-skill update）：跳过 ETag 快路径，并允许覆盖本地改动 */
  force?: boolean;
}

/**
 * 安装或更新官方 skill。
 * 快路径：带上上次的 ETag 做 HEAD，304 直接返回，不下载。
 * 安全线：上游有变但本地文件与清单不符（有人手工改过）时不动磁盘，除非 force。
 */
export async function syncSkill(
  opts: SkillSyncOptions = {},
): Promise<SkillSyncResult> {
  const dir = opts.dir ?? SKILL_DIR;
  const statePath = opts.statePath ?? SKILL_STATE_PATH;
  const doFetch = opts.fetchImpl ?? fetch;
  const state = await readSkillState(statePath);
  try {
    let etag = state?.etag ?? "";
    if (state && !opts.force) {
      const head = await doFetch(TARBALL_URL, {
        method: "HEAD",
        headers: state.etag ? { "If-None-Match": state.etag } : {},
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      });
      if (head.status === 304)
        return {
          status: "up-to-date",
          commit: state.commit,
          files: Object.keys(state.files),
        };
      if (!head.ok) throw new Error(`HEAD ${head.status}`);
      etag = head.headers.get("etag") ?? etag;
    }

    const res = await doFetch(TARBALL_URL, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const freshEtag = res.headers.get("etag") ?? etag;
    const upstream = pickSkillFiles(
      parseTarGz(new Uint8Array(await res.arrayBuffer())),
    );
    if (!upstream.has("SKILL.md"))
      throw new Error(`上游 ${SKILL_SUBPATH} 里没有 SKILL.md（布局变了？）`);
    const hashes = hashMap(upstream);

    // 内容没变（ETag 变了但 skill 没变，例如上游只改 README）：刷新清单，不写盘
    if (state && sameFiles(state.files, hashes)) {
      if (freshEtag !== state.etag)
        await writeState(statePath, { ...state, etag: freshEtag });
      return {
        status: "up-to-date",
        commit: state.commit,
        files: Object.keys(hashes),
      };
    }

    if (state && !opts.force) {
      const drifted = await localDrift(dir, state);
      if (drifted.length)
        return { status: "local-edits", commit: state.commit, files: drifted };
    }

    // 落盘：内容变了就整体写一遍（文件少，不做逐字节 diff）
    for (const [rel, data] of upstream) {
      const target = join(dir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    // 清掉上游已删/改名的旧文件；用户自己加的文件不在清单里，不动
    for (const rel of Object.keys(state?.files ?? {}))
      if (!(rel in hashes)) await rm(join(dir, rel), { force: true });

    const commit = await fetchCommit(doFetch, state?.commit ?? "");
    await writeState(statePath, {
      repo: SKILL_REPO,
      ref: SKILL_REF,
      commit,
      etag: freshEtag,
      files: hashes,
      installedAt: state?.installedAt ?? new Date().toISOString(),
    });
    return state
      ? {
          status: "updated",
          commit,
          from: state.commit,
          etag: freshEtag,
          files: Object.keys(hashes),
        }
      : {
          status: "installed",
          commit,
          etag: freshEtag,
          files: Object.keys(hashes),
        };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
      installed: state !== null,
    };
  }
}

/**
 * 只探「有没有更新」（一个 HEAD）。ETag 变了但 skill 内容没变的情况会误报有更新，
 * 真正决定要不要写盘的是 syncSkill，所以这里只当提示。
 */
export async function checkSkill(
  opts: { statePath?: string; fetchImpl?: typeof fetch } = {},
): Promise<SkillCheckResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const state = await readSkillState(opts.statePath ?? SKILL_STATE_PATH);
  if (!state) return { status: "unknown", commit: "", detail: "尚未安装" };
  try {
    const head = await doFetch(TARBALL_URL, {
      method: "HEAD",
      headers: state.etag ? { "If-None-Match": state.etag } : {},
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (head.status === 304 || head.headers.get("etag") === state.etag)
      return { status: "up-to-date", commit: state.commit };
    if (!head.ok) throw new Error(`HTTP ${head.status}`);
    return {
      status: "update-available",
      commit: state.commit,
      detail: head.headers.get("etag") ?? "",
    };
  } catch (e) {
    return {
      status: "unknown",
      commit: state.commit,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
