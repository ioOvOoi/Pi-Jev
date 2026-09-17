import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeError,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import { createJevClient, mapSdkError } from "../src/client.js";
import { DEFAULTS } from "../src/config.js";
import { startFakeTypeSafe } from "./fake-endpoint.js";

const h = new Headers({ "x-typesafe-request-id": "req_1" });

test("mapSdkError：SDK 异常 → 04 号票错误码", () => {
  assert.equal(mapSdkError(new APITimeoutError(1000)).error.code, "timeout");
  assert.equal(mapSdkError(new APIUserAbortError()).error.code, "network");
  assert.equal(
    mapSdkError(new AuthenticationError(401, { message: "bad key" }, h)).error
      .code,
    "auth",
  );
  assert.equal(
    mapSdkError(new PermissionDeniedError(403, {}, h)).error.code,
    "auth",
  );
  assert.equal(
    mapSdkError(new RateLimitError(429, {}, h)).error.code,
    "rate_limited",
  );
  assert.equal(
    mapSdkError(new UnprocessableEntityError(422, { detail: "x" }, h)).error
      .code,
    "validation",
  );
  assert.equal(
    mapSdkError(new BadRequestError(400, {}, h)).error.code,
    "validation",
  );
  assert.equal(
    mapSdkError(new InternalServerError(503, {}, h)).error.code,
    "overloaded",
  );
  assert.equal(
    mapSdkError(new InternalServerError(500, {}, h)).error.code,
    "network",
  );
  assert.equal(mapSdkError(new APIError(529, {}, h)).error.code, "overloaded");
  assert.equal(
    mapSdkError(new APIConnectionError("dns")).error.code,
    "network",
  );
  assert.match(mapSdkError(new APIConnectionError("dns")).error.message, /dns/);
  assert.equal(
    mapSdkError(new TypeSafeError("The API key is missing or empty")).error
      .code,
    "auth",
  );
  assert.equal(
    mapSdkError(
      new TypeSafeError("score criteria must be at least two entries"),
    ).error.code,
    "validation",
  );
  assert.equal(mapSdkError(new Error("boom")).error.code, "network");
  assert.equal(
    mapSdkError(new RateLimitError(429, {}, h)).error.hint,
    undefined,
  );
});

test("真 SDK 路径（假端点）：请求体/鉴权头正确，答案带 _lowConfidence", async (t) => {
  const fake = await startFakeTypeSafe();
  t.after(() => {
    delete process.env.TYPESAFE_BASE_URL;
    return fake.close();
  });
  process.env.TYPESAFE_BASE_URL = fake.url;
  const client = createJevClient("sk-fake-123456", DEFAULTS);
  const r: any = await client.systemOne("payouts failing", {
    a: {
      type: "noul",
      instructions: "是否要立刻处理？",
      criteria: { true: null, false: null },
    },
  });
  assert.equal(r.error, undefined);
  assert.equal(r.answers.a.noul, 0.5);
  assert.equal(r.usage.input_tokens, 7);
  assert.equal(fake.bodies[0].url, "/v1/systemone");
  assert.equal(fake.bodies[0].auth, "Bearer sk-fake-123456");
  assert.equal(fake.bodies[0].body.state, "payouts failing");
  assert.equal(fake.bodies[0].body.model, DEFAULTS.model);
});

test("并发闸：maxConcurrent=1 时三个并发调用实测并发为 1", async (t) => {
  const fake = await startFakeTypeSafe({ delayMs: 60 });
  t.after(() => {
    delete process.env.TYPESAFE_BASE_URL;
    return fake.close();
  });
  process.env.TYPESAFE_BASE_URL = fake.url;
  const client = createJevClient("sk-fake", { ...DEFAULTS, maxConcurrent: 1 });
  const call = () =>
    client.systemOne("s", {
      a: { type: "noul", instructions: "q", criteria: null },
    });
  await Promise.all([call(), call(), call()]);
  assert.equal(fake.maxConcurrent, 1);
  assert.equal(fake.bodies.length, 3);
});

test("HTTP 错误进包络：401/429（SDK 自带重试后仍失败）", async (t) => {
  const unauthorized = await startFakeTypeSafe({
    status: 401,
    body: { message: "invalid key" },
  });
  t.after(() => {
    delete process.env.TYPESAFE_BASE_URL;
    return unauthorized.close();
  });
  process.env.TYPESAFE_BASE_URL = unauthorized.url;
  const r: any = await createJevClient("sk-bad", DEFAULTS).systemOne("s", {
    a: { type: "noul", instructions: "q", criteria: null },
  });
  assert.equal(r.error.code, "auth");
  assert.match(r.error.hint, /pi login/);

  const limited = await startFakeTypeSafe({
    status: 429,
    body: { message: "slow down" },
  });
  process.env.TYPESAFE_BASE_URL = limited.url;
  const r2: any = await createJevClient("sk-fake", DEFAULTS).systemOne("s", {
    a: { type: "noul", instructions: "q", criteria: null },
  });
  assert.equal(r2.error.code, "rate_limited");
  await limited.close();
});
