import { loadConfig } from "../src/config.js";
import { resolveKey } from "../src/auth.js";
import { makeRunner, type JevToolResult, type JevType } from "../src/core.js";

/** 终验：对真端点批量调三 tool（choice/score/noul）。默认打印人类可读摘要；--json 才输出原始 JSON。 */
const jsonMode = process.argv.includes("--json");

const cfg = await loadConfig();
const { key, source } = await resolveKey();
if (!key) {
  console.error("缺 key：先在 TUI 里 /login 选 TypeSafe，或设 TYPESAFE_API_KEY");
  process.exit(2);
}
console.log(`TypeSmoke · 实调 choice / score / noul · key 来源 ${source}（${key.slice(0, 4)}…${key.slice(-4)}）`);

const run = await makeRunner(cfg, resolveKey);

const state = "用户让 agent 整理本地缓存目录，并清掉过期的构建产物";
const CASES: Record<
  JevType,
  { ask: string; args: unknown; render: (a: Record<string, unknown>) => string }
> = {
  noul: {
    ask: "这条指令是否安全、且符合用户意图？",
    args: {
      state,
      questions: {
        gate: {
          question: "这条指令是否安全、且符合用户意图？",
          trueMeans: "可以放行",
          falseMeans: "应当拦截",
        },
      },
    },
    render: (a) => `${Math.round((Number(a.noul) || 0) * 100)}%`,
  },
  choice: {
    ask: "下一步最该做什么？",
    args: {
      state,
      questions: {
        next: {
          question: "下一步最该做什么？",
          options: {
            list: "先列目录看清现状",
            del: "直接删掉旧产物",
            ask: "先问用户",
          },
        },
      },
    },
    render: (a) => {
      const opt = String(a.choice);
      const label = (
        (CASES.choice.args as { questions: Record<string, { options: Record<string, string | null> }> })
          .questions.next.options[opt]
      );
      return label ? `${opt}（${label}）` : opt;
    },
  },
  score: {
    ask: "这条指令的危险程度",
    args: {
      state,
      questions: {
        danger: {
          question: "这条指令的危险程度",
          levels: ["无害", "需确认", "破坏性"],
        },
      },
    },
    render: (a) => {
      const levels = (
        (CASES.score.args as { questions: Record<string, { levels: string[] }> }).questions.danger.levels
      );
      const v = Number(a.score);
      return levels[v] == null ? String(a.score) : `${v}（${levels[v]}）`;
    },
  },
};

const describeAnswer = (type: JevType, a: Record<string, unknown>): string => {
  const low = a._lowConfidence === true ? " · 低置信" : "";
  return `${CASES[type].render(a)}${low}`;
};

let ok = 0;
let inTok = 0;
let outTok = 0;
const rows: string[] = [];
for (const type of ["choice", "score", "noul"] as JevType[]) {
  const r: JevToolResult = await run(type, CASES[type].args as never);
  if (jsonMode) console.log(JSON.stringify(r, null, 2));
  if ("error" in r) {
    const hint = r.error.hint ? `（${r.error.hint}）` : "";
    rows.push(`  [${type}] 失败 —— ${r.error.code}: ${r.error.message}${hint}`);
    continue;
  }
  ok++;
  inTok += r.usage.input_tokens;
  outTok += r.usage.output_tokens;
  const parts = Object.entries(r.answers).map(([qid, a]) => `${qid}：${describeAnswer(type, a as Record<string, unknown>)}`);
  rows.push(`  [${type}] 通过 —— ${parts.join("；")}`);
}

console.log(rows.join("\n"));
console.log(`\nusage 合计：输入 ${inTok} / 输出 ${outTok} token`);
console.log(ok === 3 ? "\nLIVE_SMOKE_OK（3/3 通过）" : `\nLIVE_SMOKE_FAIL（${3 - ok}/3 失败）`);
process.exit(ok === 3 ? 0 : 1);
