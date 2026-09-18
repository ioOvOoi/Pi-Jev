import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markLow,
  runJev,
  toSdkQuestion,
  validateArgs,
  makeRunner,
} from "../src/core.js";
import { DEFAULTS } from "../src/config.js";
import { startFakeTypeSafe } from "./fake-endpoint.js";

const ok = (answers: Record<string, unknown>) => ({
  model: "jev-latest",
  answers,
  usage: { input_tokens: 1, output_tokens: 2 },
});
const deps = (client: any) => ({
  client,
  keySource: "auth.json" as const,
});

test("validateArgs：state/questions 必填；每问 type 必填且按型查判据", () => {
  const q = (type: string, extra: object) => ({
    state: "s",
    questions: { a: { type, question: "q", ...extra } },
  });
  assert.equal(
    validateArgs({
      state: "",
      questions: { a: { type: "noul", question: "q" } },
    })?.error.code,
    "validation",
  );
  assert.equal(
    validateArgs({ state: "s", questions: {} })?.error.code,
    "validation",
  );
  assert.equal(
    validateArgs({ state: "s", questions: { a: { type: "noul" } } })?.error.code,
    "validation",
  );
  assert.equal(
    validateArgs({ state: "s", questions: { a: { question: "缺 type" } } })?.error
      .code,
    "validation",
  );
  assert.equal(
    validateArgs({
      state: "s",
      questions: { a: { type: "chat", question: "q" } },
    })?.error.code,
    "validation",
  );
  assert.equal(validateArgs(q("choice", { options: { x: "1" } }))?.error.code, "validation");
  assert.equal(validateArgs(q("score", { levels: ["一档"] }))?.error.code, "validation");
  assert.equal(validateArgs(q("noul", {})), null);
  assert.equal(
    validateArgs(q("choice", { options: { x: "1", y: null } })),
    null,
  );
  assert.equal(validateArgs(q("score", { levels: ["低", "高"] })), null);
  // 混型批量：一次请求里 noul + choice 共存
  assert.equal(
    validateArgs({
      state: "s",
      questions: {
        a: { type: "noul", question: "q1" },
        b: { type: "choice", question: "q2", options: { x: "1", y: null } },
      },
    }),
    null,
  );
});

test("toSdkQuestion：按问题的 type 字段映射成 SDK 问题形状", () => {
  assert.deepEqual(
    toSdkQuestion({ type: "noul", question: "是吗", trueMeans: "是", falseMeans: "否" }),
    {
      type: "noul",
      instructions: "是吗",
      criteria: { true: "是", false: "否" },
    },
  );
  assert.deepEqual(
    toSdkQuestion({ type: "choice", question: "哪个", options: { a: "甲", b: null } }),
    {
      type: "choice",
      instructions: "哪个",
      criteria: { a: "甲", b: null },
    },
  );
  assert.deepEqual(
    toSdkQuestion({ type: "score", question: "多严重", levels: ["轻", "重"] }),
    {
      type: "score",
      instructions: "多严重",
      criteria: ["轻", "重"],
    },
  );
});

test("markLow：choice/score 看 confidence（严格小于），noul 看离 0.5 的距离", () => {
  const low = (a: unknown) =>
    (a as { _lowConfidence?: boolean })._lowConfidence === true;
  assert.equal(low(markLow({ type: "choice", confidence: 0.49 })), true);
  assert.equal(low(markLow({ type: "choice", confidence: 0.5 })), false);
  assert.equal(low(markLow({ type: "score", confidence: 0.49 })), true);
  assert.equal(low(markLow({ type: "noul", noul: 0.31 })), true);
  // 注意：0.7-0.5 在浮点下是 0.19999…，仍 < 0.2，故用 0.75 代表「清楚不低置信」
  assert.equal(low(markLow({ type: "noul", noul: 0.75 })), false);
  assert.equal(low(markLow({ type: "noul", noul: 0.9 })), false);
  assert.equal(
    JSON.stringify(markLow({ type: "noul", noul: 0.9 })),
    JSON.stringify({ type: "noul", noul: 0.9 }),
  );
});

test("runJev：混型批量按 id 取答案 + 低置信标记 + usage/_keySource", async () => {
  const seen: any[] = [];
  const client = {
    systemOne: async (state: unknown, questions: any) => {
      seen.push({ state, questions });
      return ok({
        a: { type: "noul", noul: 0.5 },
        b: { type: "choice", choice: "x", confidence: 0.9 },
      });
    },
  };
  const r: any = await runJev(
    {
      state: "文本",
      questions: {
        a: { type: "noul", question: "问题一" },
        b: { type: "choice", question: "问题二", options: { x: "1", y: "2" } },
      },
    },
    deps(client),
  );
  assert.equal(r.answers.a._lowConfidence, true);
  assert.equal(r.answers.b._lowConfidence, undefined);
  assert.deepEqual(r.usage, { input_tokens: 1, output_tokens: 2 });
  assert.equal(r._keySource, "auth.json");
  assert.equal(seen.length, 1); // 一次请求带全部问题（含混型）
  assert.deepEqual(Object.keys(seen[0].questions), ["a", "b"]);
  assert.equal(seen[0].state, "文本");
});

test("runJev：client 的错误包络原样返回；校验不过时不发请求", async () => {
  let called = 0;
  const client = {
    systemOne: async () => {
      called++;
      return { error: { code: "rate_limited", message: "超限流" } };
    },
  };
  const r: any = await runJev(
    { state: "s", questions: { a: { type: "noul", question: "q" } } },
    deps(client),
  );
  assert.equal(r.error.code, "rate_limited");
  assert.equal(called, 1);
  const bad: any = await runJev({ state: "s", questions: {} }, deps(client));
  assert.equal(bad.error.code, "validation");
  assert.equal(called, 1);
});

test("makeRunner：缺 key 给 auth 包络且不发请求；key 出现后走真 client（每次调用重解析 key）", async (t) => {
  const fake = await startFakeTypeSafe();
  t.after(() => {
    delete process.env.TYPESAFE_BASE_URL;
    return fake.close();
  });
  process.env.TYPESAFE_BASE_URL = fake.url; // 建 client 前指向假端点
  let key: string | null = null;
  const run = await makeRunner(DEFAULTS, async () =>
    key
      ? { key, source: "env" as const }
      : { key: null, source: "missing" as const },
  );
  const first: any = await run({
    state: "s",
    questions: { a: { type: "noul", question: "q" } },
  });
  assert.equal(first.error.code, "auth");
  assert.equal(fake.bodies.length, 0);
  key = "sk-test"; // 模拟会话中途 /login 落 key：下一次调用应当用上
  const second: any = await run({
    state: "s",
    questions: { a: { type: "noul", question: "q" } },
  });
  assert.equal(second._keySource, "env", JSON.stringify(second));
  assert.equal(second.answers.a._lowConfidence, true); // 假端点 noul 固定 0.5
  assert.equal(fake.bodies.length, 1);
  assert.equal(fake.bodies[0].auth, "Bearer sk-test");
});
