import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  LINK_NAME,
  buildQuestion,
  isActivated,
  outcomeOf,
  pickValue,
  registerNoulAuthorizer,
  renderNoulLine,
  verdictFrom,
  type AuthorizerVerdict,
} from "../src/permission.js";
import { DEFAULTS } from "../src/config.js";
import { LOW } from "../src/core.js";
import type { JevRunner } from "../src/tools.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** 假 pi：只实现 events 总线，够验证 ready 幂等与决议观测 */
function fakePi(): {
  pi: ExtensionAPI;
  emit: (ch: string, data: unknown) => Promise<void>;
  count: (ch: string) => number;
} {
  const bus = new Map<string, ((d: unknown) => void)[]>();
  return {
    pi: {
      events: {
        on: (ch: string, h: (d: unknown) => void) => {
          bus.set(ch, [...(bus.get(ch) ?? []), h]);
        },
      },
    } as unknown as ExtensionAPI,
    emit: async (ch, data) => {
      for (const h of bus.get(ch) ?? []) h(data);
      await tick();
      await tick();
    },
    count: (ch) => (bus.get(ch) ?? []).length,
  };
}

const noulRunner = (noul: number, low = false): JevRunner =>
  (async () => ({
    answers: {
      gate: { type: "noul", noul, ...(low ? { _lowConfidence: true } : {}) },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
    _keySource: "auth.json",
  })) as unknown as JevRunner;

const errRunner: JevRunner = (async () => ({
  error: { code: "auth", message: "未配置 TypeSafe key" },
})) as unknown as JevRunner;

test("pickValue：命令 > 路径 > target > value > 预览", () => {
  assert.equal(
    pickValue({ command: " rm -rf /tmp ", path: "/x" }),
    "rm -rf /tmp",
  );
  assert.equal(pickValue({ path: "/x", value: "v" }), "/x");
  assert.equal(pickValue({ toolInputPreview: "p" }), "p");
  assert.equal(pickValue({}), "");
});

test("buildQuestion：带上工具名与具体内容，不留猜的空间", () => {
  const q = buildQuestion({
    toolName: "bash",
    surface: "bash",
    command: "git push --force",
    agentName: "fixer",
  });
  assert.match(q.question, /fixer/);
  assert.match(q.question, /bash/);
  assert.match(q.question, /git push --force/);
  assert.match(q.question, /放行/);
  assert.equal(q.trueMeans.includes("放行"), true);
  assert.equal(q.falseMeans.includes("拦截"), true);
  // 超长输入截断，别把整个文件塞给 Jev
  assert.equal(
    buildQuestion({ command: "x".repeat(5000) }).question.length < 2000,
    true,
  );
});

test("verdictFrom：概率映射 + 低置信/失败一律 defer", () => {
  const m = LOW.noulMargin; // 0.2
  assert.deepEqual(
    verdictFrom({ ok: true, pYes: 0.9, lowConfidence: false }, m),
    {
      kind: "allow",
    },
  );
  const deny = verdictFrom({ ok: true, pYes: 0.05, lowConfidence: false }, m, {
    command: "rm -rf /",
  });
  assert.equal(deny.kind, "deny");
  assert.match((deny as { reason: string }).reason, /0\.05/);
  assert.match((deny as { reason: string }).reason, /rm -rf/);
  assert.deepEqual(
    verdictFrom({ ok: true, pYes: 0.5, lowConfidence: false }, m),
    {
      kind: "defer",
    },
  );
  assert.deepEqual(
    verdictFrom({ ok: true, pYes: 0.65, lowConfidence: false }, m),
    {
      kind: "defer",
    },
  ); // 0.5+0.2 才放行
  assert.deepEqual(
    verdictFrom({ ok: true, pYes: 0.95, lowConfidence: true }, m),
    {
      kind: "defer",
    },
  );
  assert.deepEqual(verdictFrom({ ok: false, note: "auth: 未配置 key" }, m), {
    kind: "defer",
  });
});

test("outcomeOf：读概率与低置信，错误包络不当成结论", () => {
  assert.deepEqual(
    outcomeOf({
      answers: { gate: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 0, output_tokens: 0 },
      _keySource: "env",
    }),
    { ok: true, pYes: 0.8, lowConfidence: false },
  );
  const e = outcomeOf({ error: { code: "auth", message: "无 key" } });
  assert.equal(e.ok, false);
  assert.match(e.ok === false ? e.note : "", /auth/);
  assert.equal(
    outcomeOf({
      answers: {},
      usage: { input_tokens: 0, output_tokens: 0 },
      _keySource: "env",
    }).ok,
    false,
  );
});

test("registerNoulAuthorizer：ready 重复只挂一次，判决走 Jev 概率", async () => {
  const { pi, emit } = fakePi();
  const regs: { name: string; authorized: AuthorizerVerdict[] }[] = [];
  let disposed = 0;
  const handle = registerNoulAuthorizer(pi, {
    cfg: DEFAULTS,
    run: noulRunner(0.95),
    enabled: true,
    loadService: async () => ({
      service: {
        registerAuthorizer: (name: string, _authorize: unknown) => {
          regs.push({ name, authorized: [] });
          return () => {
            disposed += 1;
          };
        },
      },
      via: "fake",
    }),
  });

  await emit("permissions:ready", {
    sessionId: "s1",
    adjudicatesLocally: true,
  });
  await emit("permissions:ready", {
    sessionId: "s1",
    adjudicatesLocally: true,
  });
  assert.equal(regs.length, 1);
  assert.equal(regs[0].name, LINK_NAME);

  // 决议广播进内存环（面板可观测）
  await emit("permissions:decision", {
    requestId: "r1",
    surface: "bash",
    value: "rm -rf /",
    result: "deny",
    resolution: "authorizer_denied",
  });
  const st = handle.status();
  assert.equal(st.state, "registered");
  assert.deepEqual(st.sessions, ["s1"]);
  assert.equal(st.last[0].result, "deny");
  assert.match(renderNoulLine(st), /已挂链 jev-noul/);
  assert.equal(disposed, 0); // dispose 由 pi 卸载时调用，此处只确认注册返回了 disposer
});

test("registerNoulAuthorizer：authorize 回调 → Jev 判决 + 日志", async () => {
  const cases: { run: JevRunner; command: string; want: string }[] = [
    { run: noulRunner(0.99), command: "ls -la", want: "allow" },
    { run: noulRunner(0.01), command: "rm -rf /", want: "deny" },
    { run: noulRunner(0.55), command: "git push --force", want: "defer" },
    { run: errRunner, command: "anything", want: "defer" },
  ];
  for (const c of cases) {
    const { pi, emit } = fakePi();
    let authorize:
      | ((d: unknown, q: unknown, l: unknown) => Promise<AuthorizerVerdict>)
      | undefined;
    const reviews: string[] = [];
    registerNoulAuthorizer(pi, {
      cfg: DEFAULTS,
      run: c.run,
      enabled: true,
      loadService: async () => ({
        service: {
          registerAuthorizer: (_n: string, a: typeof authorize) => {
            authorize = a;
            return () => {};
          },
        },
        via: "fake",
      }),
    });
    await emit("permissions:ready", { sessionId: "s1" });
    assert.ok(authorize, "应已注册 authorize");
    const verdict = await authorize!(
      { toolName: "bash", surface: "bash", command: c.command },
      {},
      { review: (e: string) => reviews.push(e) },
    );
    assert.equal(verdict.kind, c.want, `${c.command} → ${c.want}`);
    assert.deepEqual(reviews, ["jev_noul"]);
  }
});

test("registerNoulAuthorizer：没装权限系统 → 只提示一次，不抛", async () => {
  const { pi, emit } = fakePi();
  const said: string[] = [];
  const handle = registerNoulAuthorizer(pi, {
    cfg: DEFAULTS,
    run: noulRunner(0.9),
    enabled: true,
    loadService: async () => undefined,
    onMissing: (d) => said.push(d),
  });
  await emit("permissions:ready", { sessionId: "s1" });
  await emit("permissions:ready", { sessionId: "s2" });
  assert.equal(said.length, 1);
  assert.equal(handle.status().state, "missing");
  assert.match(renderNoulLine(handle.status()), /未找到权限系统/);
});

test("registerNoulAuthorizer：enabled=false 时完全不碰权限系统", async () => {
  const { pi, emit } = fakePi();
  let loaded = 0;
  const handle = registerNoulAuthorizer(pi, {
    cfg: DEFAULTS,
    run: errRunner,
    enabled: false,
    loadService: async () => {
      loaded += 1;
      return undefined;
    },
  });
  await emit("permissions:ready", { sessionId: "s1" });
  assert.equal(loaded, 0);
  assert.equal(handle.status().state, "off");
  assert.match(renderNoulLine(handle.status()), /^关闭/);
});

test("isActivated：读权限系统 config.json 的 authorizerChain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-perm-"));
  const p = join(dir, "config.json");
  try {
    assert.equal(await isActivated(p), null); // 文件不存在
    await writeFile(p, JSON.stringify({ authorizerChain: ["other"] }));
    assert.equal(await isActivated(p), false);
    await writeFile(p, JSON.stringify({ authorizerChain: [LINK_NAME] }));
    assert.equal(await isActivated(p), true);
    await writeFile(p, "{ 坏 json");
    assert.equal(await isActivated(p), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
