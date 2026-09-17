import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import type { JevToolArgs, JevToolResult, JevType } from "./core.js";

/** Jev 不生成文本、不做对话：state 由调用方显式给出（04 号票 Q2） */
const STATE = Type.Unknown({
  description:
    "要评估的内容：文本 / JSON 对象 / 数组。由调用方显式给出，插件不会自动采集会话上下文",
});

const questionsOf = (value: TSchema) =>
  Type.Record(
    Type.String({ description: "问题 id；答案按同一 id 返回" }),
    value,
    {
      description:
        "以 id 为键的问题表（至少一条；同一 state 下一次请求并行回答全部问题）",
    },
  );

const NOUL_Q = Type.Object({
  question: Type.String({ description: "是否题文本" }),
  trueMeans: Type.Optional(
    Type.String({ description: "「是」代表什么（可选）" }),
  ),
  falseMeans: Type.Optional(
    Type.String({ description: "「否」代表什么（可选）" }),
  ),
});

const CHOICE_Q = Type.Object({
  question: Type.String({ description: "选择问题文本" }),
  options: Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Null()]),
    {
      description:
        "选项 → 描述（null 表示不描述），至少 2 个；返回所选选项 + 全概率分布 + confidence",
    },
  ),
});

const SCORE_Q = Type.Object({
  question: Type.String({ description: "打分问题文本" }),
  levels: Type.Array(Type.String(), {
    minItems: 2,
    description:
      "有序档位描述（从低到高），至少 2 档；返回概率加权分 + 各档概率 + confidence",
  }),
});

interface ToolSpec {
  type: JevType;
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: TSchema;
}

const SPECS: ToolSpec[] = [
  {
    type: "noul",
    name: "jev_noul",
    label: "Jev Noul（是否判断）",
    description:
      "用 TypeSafe Jev（System One）对给定 state 做「是/否」概率判断。返回 { answers: { [id]: { type, noul, _lowConfidence? } }, usage }；失败返回 { error: { code, message, hint? } }。不生成文本、不做对话。",
    promptSnippet:
      "jev_noul: 对给定 state 做是否判断（返回 yes 概率），支持一次多问",
    promptGuidelines: [
      "Use jev_noul when you need a calibrated yes/no probability about a piece of text or JSON state instead of your own guess.",
      "jev_noul 的 state 必须由你显式给出（传入待判断的原文/对象），插件不会自动读取会话。",
      "jev_noul 返回 _lowConfidence: true 表示概率贴近 0.5（阈值可配），此时结论应作为弱信号处理。",
    ],
    parameters: Type.Object({
      state: STATE,
      questions: questionsOf(NOUL_Q),
    }),
  },
  {
    type: "choice",
    name: "jev_choice",
    label: "Jev Choice（选项判断）",
    description:
      "用 TypeSafe Jev（System One）在给定选项集中选一，返回所选选项、全概率分布与 confidence。返回 { answers: { [id]: { type, choice, probabilities, confidence, _lowConfidence? } }, usage }；失败返回 { error: { code, message, hint? } }。",
    promptSnippet:
      "jev_choice: 在给定选项集中做校准选择（返回选择 + 概率分布）",
    promptGuidelines: [
      "Use jev_choice when the decision is a labelled classification over an explicit option set.",
      "jev_choice 的 options 至少 2 个；描述写成「该选项成立意味着什么」，值可为 null 表示不描述。",
      "jev_choice 返回 _lowConfidence: true 表示 confidence 低于阈值（概率分布平坦），不要当作确定结论。",
    ],
    parameters: Type.Object({
      state: STATE,
      questions: questionsOf(CHOICE_Q),
    }),
  },
  {
    type: "score",
    name: "jev_score",
    label: "Jev Score（有序档位打分）",
    description:
      "用 TypeSafe Jev（System One）沿有序档位打分，返回概率加权分（可落在档位之间）、各档概率与 confidence。返回 { answers: { [id]: { type, score, legend, probabilities, confidence, _lowConfidence? } }, usage }；失败返回 { error: { code, message, hint? } }。",
    promptSnippet: "jev_score: 沿有序档位打分（返回加权分 + 档位概率）",
    promptGuidelines: [
      "Use jev_score when the judgement is a position on an ordered rubric (severity, urgency, sentiment).",
      "jev_score 的 levels 从低到高排列、至少 2 档；分值是档位索引的概率加权期望，可落在两档之间。",
      "jev_score 返回 _lowConfidence: true 表示 confidence 低于阈值，此时应把它当倾向性信号。",
    ],
    parameters: Type.Object({
      state: STATE,
      questions: questionsOf(SCORE_Q),
    }),
  },
];

export type JevRunner = (
  type: JevType,
  args: JevToolArgs,
) => Promise<JevToolResult>;

/** 注册三 tool；runner 由 index.ts 组装（config + key 解析 + 并发闸都在那里） */
export function registerJevTools(pi: ExtensionAPI, run: JevRunner): void {
  for (const spec of SPECS) {
    pi.registerTool({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      promptSnippet: spec.promptSnippet,
      promptGuidelines: spec.promptGuidelines,
      parameters: spec.parameters,
      async execute(_toolCallId, params) {
        const result = await run(spec.type, params as JevToolArgs);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          details: result,
          isError: "error" in result,
        };
      },
    });
  }
}
