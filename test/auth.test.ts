import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AA_ENV_KEY,
  AA_PROVIDER_ID,
  AA_REGISTER_URL,
  clearAaKey,
  resolveAaKey,
  saveAaKey,
} from "../src/auth.ts";

const tmp = await mkdtemp(join(tmpdir(), "pi-jev-aa-"));
let seq = 0;
/** 每个用例独立 auth.json，防止用例间串数据 */
const freshPath = () => join(tmp, `auth-${++seq}.json`);

/** 每个用例后清 AA_API_KEY，不让 env 兜底路径污染其它用例 */
const cleanEnv = (t: { after: (fn: () => void) => void }) =>
  t.after(() => {
    delete process.env[AA_ENV_KEY];
  });

test("写入→读取往返：key 按 pi 凭据格式落 auth.json，resolve 读回同值", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await saveAaKey("sk-aa-roundtrip", { path: p });
  assert.deepEqual(await resolveAaKey({ path: p }), {
    key: "sk-aa-roundtrip",
    source: "auth.json",
  });
  // 磁盘格式与 pi 凭据库一致：顶层 provider id → {type:"api_key", key}
  const raw = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  assert.deepEqual(raw[AA_PROVIDER_ID], { type: "api_key", key: "sk-aa-roundtrip" });
});

test("覆写：后写入的 key 覆盖旧值且不残留", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await saveAaKey("sk-old", { path: p });
  await saveAaKey("sk-new", { path: p });
  const aa = await resolveAaKey({ path: p });
  assert.equal(aa.key, "sk-new");
  assert.equal(aa.source, "auth.json");
});

test("清除：删除后读取回到 missing；重复清除返回 false", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await saveAaKey("sk-aa-clear", { path: p });
  assert.equal(await clearAaKey({ path: p }), true);
  const after = await resolveAaKey({ path: p });
  assert.equal(after.key, null);
  assert.equal(after.source, "missing");
  assert.equal(await clearAaKey({ path: p }), false);
});

test("缺失指引：无凭据无 env → missing，指引含注册地址与 env 变量名（不抛裸错）", async (t) => {
  cleanEnv(t);
  const p = freshPath(); // 文件不存在
  const aa = await resolveAaKey({ path: p });
  assert.equal(aa.source, "missing");
  assert.equal(aa.key, null);
  assert.ok(aa.guidance?.includes(AA_REGISTER_URL)); // artificialanalysis.ai
  assert.ok(aa.guidance?.includes(AA_ENV_KEY)); // AA_API_KEY
});

test("优先级：auth.json 凭据压过 env 兜底", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await saveAaKey("sk-from-file", { path: p });
  process.env[AA_ENV_KEY] = "sk-from-env";
  assert.deepEqual(await resolveAaKey({ path: p }), {
    key: "sk-from-file",
    source: "auth.json",
  });
});

test("env 兜底：无凭据文件时读 AA_API_KEY", async (t) => {
  cleanEnv(t);
  const p = freshPath(); // 文件不存在
  process.env[AA_ENV_KEY] = "sk-env-only";
  assert.deepEqual(await resolveAaKey({ path: p }), {
    key: "sk-env-only",
    source: "env",
  });
});

test("同一凭据链：写入保留 auth.json 里已有的其它 provider 条目", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await writeFile(p, JSON.stringify({ typesafe: { type: "api_key", key: "sk-ts" } }));
  await saveAaKey("sk-aa-preserve", { path: p });
  const raw = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  assert.deepEqual(raw.typesafe, { type: "api_key", key: "sk-ts" });
  assert.equal((raw[AA_PROVIDER_ID] as { key: string }).key, "sk-aa-preserve");
});

test("坏 auth.json：拒绝覆盖并抛错（不静默吞掉别家凭据）", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await writeFile(p, "{ not json");
  await assert.rejects(saveAaKey("sk-x", { path: p }));
  assert.equal(await readFile(p, "utf8"), "{ not json"); // 原样保留
});

test("空/纯空白 key 拒绝写入", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await assert.rejects(saveAaKey("   ", { path: p }));
  assert.equal(await clearAaKey({ path: p }), false); // 没写进去，自然没得清
});

test("坏文件读取不炸：损坏的 auth.json 只影响凭据源，不抛裸错", async (t) => {
  cleanEnv(t);
  const p = freshPath();
  await writeFile(p, "{ also not json");
  const aa = await resolveAaKey({ path: p });
  assert.equal(aa.key, null);
  assert.equal(aa.source, "missing");
  assert.ok(aa.guidance);
});