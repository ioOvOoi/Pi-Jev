import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULTS } from "../src/config.js";

const tmp = await mkdtemp(join(tmpdir(), "pi-jev-cfg-"));
const withFile = async (content: unknown, name: string) => {
  const p = join(tmp, name);
  await writeFile(
    p,
    typeof content === "string" ? content : JSON.stringify(content),
  );
  return p;
};
/** 每个用例后清 env，避免互相污染 */
const cleanEnv = (t: { after: (fn: () => void) => void }) =>
  t.after(() => {
    for (const k of ["PI_JEV_MODEL", "PI_JEV_TIMEOUT", "PI_JEV_MAX_CONCURRENT"])
      delete process.env[k];
  });

test("无配置文件 + 无 env = 全默认", async (t) => {
  cleanEnv(t);
  assert.deepEqual(
    await loadConfig({ path: join(tmp, "nope.json") }),
    DEFAULTS,
  );
});

test("env 生效；脏 env（非数字）被忽略", async (t) => {
  cleanEnv(t);
  process.env.PI_JEV_MODEL = "jev-env";
  process.env.PI_JEV_TIMEOUT = "1234";
  process.env.PI_JEV_PERMISSION = "abc";
  const cfg = await loadConfig({ path: join(tmp, "nope.json") });
  assert.equal(cfg.model, "jev-env");
  assert.equal(cfg.timeoutMs, 1234);
  assert.equal(cfg.permission.enabled, true); // 脏值当没写
  assert.equal(cfg.maxConcurrent, DEFAULTS.maxConcurrent);
});

test("配置文件显式字段 > env；未写的字段继续用 env/默认", async (t) => {
  cleanEnv(t);
  const path = await withFile(
    {
      model: "jev-file",
      lowConfidence: { score: 0.9 },
      permission: { enabled: false },
    },
    "file-wins.json",
  );
  process.env.PI_JEV_MODEL = "jev-env";
  process.env.PI_JEV_TIMEOUT = "1234";
  const cfg = await loadConfig({ path });
  assert.equal(cfg.model, "jev-file"); // 文件压 env
  assert.equal(cfg.timeoutMs, 1234); // 文件没写 → env
  assert.equal(cfg.lowConfidence.score, 0.9); // 部分覆盖
  assert.equal(cfg.lowConfidence.choice, DEFAULTS.lowConfidence.choice);
  assert.equal(cfg.permission.enabled, false); // 文件显式关把关
});

test("坏 JSON / 坏类型 / 未知字段：回落默认且不夹带 key", async (t) => {
  cleanEnv(t);
  assert.deepEqual(
    await loadConfig({ path: await withFile("{ not json", "bad.json") }),
    DEFAULTS,
  );
  const cfg = await loadConfig({
    path: await withFile(
      {
        timeoutMs: "x",
        maxConcurrent: null,
        lowConfidence: { choice: 3 },
        model: "",
        apiKey: "sk-leak",
        key: "sk-leak",
      },
      "junk.json",
    ),
  });
  assert.deepEqual(cfg, DEFAULTS);
  assert.equal(Object.keys(cfg).includes("apiKey"), false);
  assert.equal(JSON.stringify(cfg).includes("sk-leak"), false);
});
