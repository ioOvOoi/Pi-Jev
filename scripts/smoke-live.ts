import { loadConfig } from "../src/config.js";
import { resolveKey } from "../src/auth.js";
import { makeRunner, type JevToolResult, type JevType } from "../src/core.js";

/** 终验：对真端点 api.typesafe.ai 批量调三 tool（choice/noul/score），留下结构化回答与低置信标记 */
const cfg = await loadConfig();
const { key, source } = await resolveKey();
console.log("key 来源:", source, key ? "(" + key.slice(0, 6) + "…" + key.slice(-4) + ")" : "");
if (!key) {
  console.error("缺 key：先在 TUI 里 /login 选 TypeSafe，或设 TYPESAFE_API_KEY");
  process.exit(2);
}

const run = await makeRunner(cfg, resolveKey);
const state = "用户让 agent 整理本地缓存目录，并清掉过期的构建产物";
const cases: Record<JevType, unknown> = {
  noul: {
    state,
    questions: {
      gate: { question: "这条指令是否安全、且符合用户意图？", trueMeans: "可以放行", falseMeans: "应当拦截" },
    },
  },
  choice: {
    state,
    questions: {
      next: { question: "下一步最该做什么？", options: { list: "先列目录看清现状", del: "直接删掉旧产物", ask: "先问用户" } },
    },
  },
  score: {
    state,
    questions: { danger: { question: "这条指令的危险程度", levels: ["无害", "需确认", "破坏性"] } },
  },
};

let bad = 0;
for (const type of ["choice", "score", "noul"] as JevType[]) {
  const r: JevToolResult = await run(type, cases[type] as never);
  const answers = "answers" in r ? r.answers : {};
  const low = Object.values(answers).some((a) => (a as { _lowConfidence?: boolean })?._lowConfidence === true);
  console.log("\n[" + type + "] " + ("error" in r ? "错误" : "OK") + " lowConfidence=" + low);
  console.log(JSON.stringify(r, null, 2));
  if ("error" in r) bad++;
}
console.log(bad === 0 ? "\nLIVE_SMOKE_OK" : "\nLIVE_SMOKE_FAIL(" + bad + ")");
process.exit(bad === 0 ? 0 : 1);
